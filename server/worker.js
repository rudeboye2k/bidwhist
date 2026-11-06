/*
 * Cloudflare Worker + Durable Object for Bid Whist — serves the game AND runs
 * online play from one Worker, so the site and server share a URL.
 *
 *   Static files (index.html, js/, styles.css) are served by Workers Static
 *   Assets before this script runs. This script only sees /api/* requests:
 *     POST /api/new            → mint a fresh game key
 *     GET  /api/health         → liveness check
 *     WS   /api/room/:code/ws  → join that room's Durable Object
 *
 *   GameRoom — ONE Durable Object per game key (idFromName(code)), so every
 *   game is a separate object with its own state and sockets. Rooms can't
 *   collide.
 *
 * Hibernation-safe: Cloudflare may evict an idle room from memory between
 * moves while sockets stay open. So the room is saved to Durable Object
 * storage after every change and restored on wake, and each socket's player
 * token rides on the socket itself (serializeAttachment) rather than in memory.
 */

// js/room-core.js pulls in engine.js + ai.js through its own require()s. wrangler
// bundles with esbuild, which treats these UMD files as CommonJS, so a plain
// default import gives us their module.exports.
import RoomCore from '../js/room-core.js';

const { Room } = RoomCore;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function makeCode() {
  // Ambiguity-free alphabet (no O/0/I/1) for keys people read aloud.
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/new' && request.method === 'POST') return json({ code: makeCode() });
    if (url.pathname === '/api/health') return json({ ok: true, service: 'bidwhist' });

    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      return stub.fetch(request);
    }

    // Anything else that isn't a static file.
    if (env.ASSETS && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return json({ error: 'not-found' }, 404);
  },
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    // Restore the saved game before handling any request or socket message.
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get('room');
      if (saved) this.room = Room.fromJSON(saved);
    });
  }

  _ensureRoom(code) {
    if (!this.room) this.room = new Room(code, {});
    return this.room;
  }

  async _save() {
    if (this.room) await this.state.storage.put('room', this.room.toJSON());
    await this._syncAlarm();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = ((url.pathname.match(/room\/([A-Za-z0-9]+)\//) || [])[1] || 'ROOM').toUpperCase();
    this._ensureRoom(code);

    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server);   // hibernatable socket
    server.serializeAttachment({ token: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- socket lifecycle (hibernation handlers) ----

  async webSocketMessage(ws, raw) {
    if (!this.room) this._ensureRoom('ROOM'); // defensive: should be restored already
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
    catch (_) { return this._send(ws, { type: 'error', error: 'bad-json' }); }
    const meta = ws.deserializeAttachment() || {};

    if (msg.type === 'hello') {
      // Reclaim a seat if the socket carries a token this room still knows;
      // otherwise take a fresh seat.
      let r, token;
      if (msg.token && this.room.seatOf(msg.token) != null) {
        r = this.room.reclaim(msg.token); token = msg.token;
        this.room.setProfile(token, msg.name, msg.avatar); // refresh on reconnect
      } else {
        r = this.room.join(msg.name, msg.avatar); token = r.token;
      }
      if (r.error === 'full' || msg.watch) {
        // Table's full (or they asked to watch): they come in as a spectator
        // and can take a seat when one opens or a bot is playing one.
        if (r.token) this.room.leave(r.token);
        ws.serializeAttachment({ token: null, watcher: true, name: msg.name, avatar: msg.avatar });
        this._send(ws, { type: 'welcome', token: null, seat: null, watcher: true });
        return this._broadcast();
      }
      if (r.error) return this._send(ws, { type: 'error', error: r.error });
      ws.serializeAttachment({ token });
      await this._save();
      this._send(ws, { type: 'welcome', token, seat: r.seat, host: !!r.host });
      return this._broadcast();
    }

    if (msg.type === 'sit' && meta.watcher && !meta.token) {
      const r = this.room.sitIn(meta.name, meta.avatar);
      if (r.error) return this._send(ws, { type: 'error', error: r.error });
      ws.serializeAttachment({ token: r.token });
      await this._save();
      this._send(ws, { type: 'welcome', token: r.token, seat: r.seat, host: !!r.host });
      return this._broadcast(r.events);
    }

    if (!meta.token) return this._send(ws, { type: 'error', error: 'say-hello' });

    let out;
    if (msg.type === 'start') out = this.room.start(meta.token);
    else if (msg.type === 'nextHand') out = this.room.nextHand(meta.token);
    else if (msg.type === 'intent') out = this.room.submit(meta.token, msg.intent);
    else if (msg.type === 'profile') out = this.room.setProfile(meta.token, msg.name, msg.avatar) || { events: [] };
    else if (msg.type === 'team') out = this.room.chooseTeam(meta.token, msg.team);
    else if (msg.type === 'teamName') out = this.room.setTeamName(meta.token, msg.team, msg.name);
    else if (msg.type === 'seatSwap') out = this.room.hostSwap(meta.token, msg.a, msg.b);
    else if (msg.type === 'addBot') out = this.room.addBot(meta.token, msg.seat);
    else if (msg.type === 'kickBot') out = this.room.kickBot(meta.token, msg.seat);
    else if (msg.type === 'toLobby') out = this.room.toLobby(meta.token);
    else if (msg.type === 'react') out = this.room.react(meta.token, msg.id);
    else if (msg.type === 'rules') out = this.room.setRules(meta.token, msg.rules);
    else if (msg.type === 'renege') out = this.room.callRenege(meta.token);
    else if (msg.type === 'leave') {
      out = this.room.leave(meta.token);       // mid-game: a bot takes the seat
      ws.serializeAttachment({ token: null }); // this socket no longer holds a seat
    }
    else return this._send(ws, { type: 'error', error: 'unknown-type' });

    if (out && out.error) return this._send(ws, { type: 'error', error: out.error });
    // Reactions are just chatter: no need to persist the room for them.
    if (msg.type !== 'react') await this._save();
    this._broadcast(out && out.events);
  }

  // Turn timer: one Durable Object alarm, always set to the current deadline.
  async _syncAlarm() {
    try {
      if (this.room && this.room.deadline) await this.state.storage.setAlarm(this.room.deadline);
      else await this.state.storage.deleteAlarm();
    } catch (_) { /* alarms unavailable: the timer simply doesn't fire */ }
  }

  async alarm() {
    if (!this.room) return;
    const out = this.room.timeout();
    if (out.events.length) {
      await this._save();
      this._broadcast(out.events);
    } else {
      await this._syncAlarm(); // woke early (clock skew): re-arm
    }
  }

  async webSocketClose(ws, code) {
    await this._dropSocket(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (_) { /* already closed */ }
  }

  async webSocketError(ws) {
    await this._dropSocket(ws);
  }

  async _dropSocket(ws) {
    const meta = ws.deserializeAttachment() || {};
    if (!meta.token || !this.room) return;
    // Only mark the player away if no other open socket still holds their seat
    // (e.g. they reconnected in a new tab before the old one closed).
    const others = this.state.getWebSockets().filter((s) => s !== ws);
    const stillHere = others.some((s) => (s.deserializeAttachment() || {}).token === meta.token);
    // A bot covers the seat immediately (even if it was their turn); they get
    // it back if they reconnect with their token.
    const out = stillHere ? { events: [] } : this.room.drop(meta.token);
    await this._save();
    this._broadcast(out.events, ws);
  }

  // ---- fan-out ----

  _send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* socket gone */ }
  }

  // Push each connected socket its own tailored snapshot (its own hand only),
  // plus the shared event stream for animation.
  _broadcast(events, except) {
    const sockets = this.state.getWebSockets();
    const watchers = sockets.filter((s) => s !== except && (s.deserializeAttachment() || {}).watcher && !(s.deserializeAttachment() || {}).token).length;
    for (const ws of sockets) {
      if (ws === except) continue;
      const meta = ws.deserializeAttachment() || {};
      const view = this.room.viewFor(meta.token);
      view.watchers = watchers;
      view.watching = !meta.token && !!meta.watcher;
      this._send(ws, { type: 'state', view, events: events || [] });
    }
  }
}
