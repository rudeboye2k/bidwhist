/*
 * Cloudflare Worker + Durable Object for Bid Whist — serves the game AND runs
 * online play from one Worker, so the site and server share a URL.
 *
 *   Static files (js/, styles.css, images) are served by Workers Static
 *   Assets before this script runs. This script sees /api/* requests, plus the
 *   page and the service worker (wrangler.toml run_worker_first), which it
 *   stamps with this deploy's version so every release busts old caches:
 *     GET  / , /index.html, /sw.js → the file, with __V__ → the version id
 *     POST /api/new            → mint a fresh game key
 *     GET  /api/health         → liveness check
 *     WS   /api/room/:code/ws  → join that room's Durable Object
 *     GET  /api/daily/:date    → that day's Daily Deal leaderboard
 *     POST /api/daily/:date    → post a Daily Deal score (checked by replaying the moves)
 *
 *   GameRoom — ONE Durable Object per game key (idFromName(code)), so every
 *   game is a separate object with its own state and sockets. Rooms can't
 *   collide.
 *
 * Hibernation-safe: Cloudflare may evict an idle room from memory between
 * moves while sockets stay open. So the room is saved to Durable Object
 * storage after every change and restored on wake, and each socket's player
 * token rides on the socket itself (serializeAttachment) rather than in memory.
 * A table nobody has touched for a week is deleted (see IDLE_MS).
 */

// js/room-core.js pulls in engine.js + ai.js through its own require()s. wrangler
// bundles with esbuild, which treats these UMD files as CommonJS, so a plain
// default import gives us their module.exports.
import RoomCore from '../js/room-core.js';
import Engine from '../js/engine.js';

const { Room, replayDaily } = RoomCore;

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

// Files whose __V__ tokens become the deploy's version (cache busting with no
// hand-edited ?v= numbers). Matches `run_worker_first` in wrangler.toml.
const STAMPED = new Set(['/', '/index.html', '/sw.js']);

function versionTag(env) {
  const id = env.VERSION && env.VERSION.id; // version_metadata binding
  return id ? String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) : 'dev';
}

async function stamped(request, env) {
  // Ask for the full file every time: a 304 for an unchanged index.html would
  // keep the browser on the old version tag after a deploy changed the scripts.
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  const res = await env.ASSETS.fetch(new Request(request, { headers }));
  if (res.status !== 200) return res; // e.g. /index.html → redirect to /
  const body = (await res.text()).replaceAll('__V__', versionTag(env));
  const out = new Headers(res.headers);
  for (const h of ['ETag', 'Last-Modified', 'Content-Length']) out.delete(h);
  out.set('Cache-Control', 'no-cache');
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.set('X-Frame-Options', 'SAMEORIGIN');
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (env.ASSETS && STAMPED.has(url.pathname) && (request.method === 'GET' || request.method === 'HEAD'))
      return stamped(request, env);
    if (url.pathname === '/api/new' && request.method === 'POST') return json({ code: makeCode() });
    if (url.pathname === '/api/health') return json({ ok: true, service: 'bidwhist' });

    const d = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (d && (request.method === 'GET' || request.method === 'POST')) {
      // Only today's deal (UTC) takes scores; yesterday's and tomorrow's are
      // allowed too, for players just either side of midnight UTC.
      const near = [-1, 0, 1].map((k) => Engine.dailyDate(new Date(Date.now() + k * 864e5)));
      if (!near.includes(d[1])) return json({ error: 'bad-date' }, 400);
      const stub = env.DAILY_BOARD.get(env.DAILY_BOARD.idFromName(d[1]));
      const res = await stub.fetch(new Request('https://daily/' + d[1] + url.search, request));
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

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

// A table with no saved change for this long, and nobody connected, is deleted
// so abandoned games don't pile up in storage. Its key then starts a fresh table.
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.active = Date.now(); // last saved change
    // Restore the saved game before handling any request or socket message.
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get(['room', 'active']);
      if (saved.get('room')) this.room = Room.fromJSON(saved.get('room'));
      if (saved.get('active')) this.active = saved.get('active');
    });
  }

  _ensureRoom(code) {
    if (!this.room) this.room = new Room(code, {});
    return this.room;
  }

  async _save() {
    this.active = Date.now();
    if (this.room) await this.state.storage.put({ room: this.room.toJSON(), active: this.active });
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
    else if (msg.type === 'say') out = this.room.say(meta.token, msg.text);
    else if (msg.type === 'rules') out = this.room.setRules(meta.token, msg.rules);
    else if (msg.type === 'renege') out = this.room.callRenege(meta.token);
    else if (msg.type === 'leave') {
      out = this.room.leave(meta.token);       // mid-game: a bot takes the seat
      ws.serializeAttachment({ token: null }); // this socket no longer holds a seat
    }
    else return this._send(ws, { type: 'error', error: 'unknown-type' });

    if (out && out.error) return this._send(ws, { type: 'error', error: out.error });
    // Reactions are just chatter: no need to persist the room for them.
    if (msg.type !== 'react' && msg.type !== 'say') await this._save();
    this._broadcast(out && out.events);
  }

  // One Durable Object alarm serves two clocks: the turn timer (the current
  // deadline) and the idle clean-up (a week after the last change).
  async _syncAlarm() {
    try {
      if (!this.room) return await this.state.storage.deleteAlarm();
      const idleAt = this.active + IDLE_MS;
      await this.state.storage.setAlarm(this.room.deadline ? Math.min(this.room.deadline, idleAt) : idleAt);
    } catch (_) { /* alarms unavailable: the timer simply doesn't fire */ }
  }

  async alarm() {
    if (!this.room) return;
    if (Date.now() >= this.active + IDLE_MS) {
      if (!this.state.getWebSockets().length) {
        this.room = null;
        await this.state.storage.deleteAlarm();
        await this.state.storage.deleteAll();
        return;
      }
      this.active = Date.now(); // someone's still sitting there: check again later
      await this.state.storage.put('active', this.active);
    }
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

// ---- Daily Deal leaderboard -------------------------------------------------
// One Durable Object per date. A score is only taken after replaying the
// posted moves on that day's deal, so the number on the board is what really
// happened. One entry per device; the first finished hand is the one that counts.
const DAILY_TOP = 50;

function cleanName(name) {
  const plain = String(name || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return Engine.filterChat(plain) || 'Player';
}

export class DailyBoard {
  constructor(state) { this.state = state; }

  async _board(device) {
    const all = [...(await this.state.storage.list({ prefix: 'e:' })).values()];
    all.sort((a, b) => b.net - a.net || b.books - a.books || a.at - b.at);
    const top = all.slice(0, DAILY_TOP).map((e, i) => ({
      rank: i + 1, name: e.name, avatar: e.avatar, net: e.net, books: e.books, you: !!device && e.device === device,
    }));
    const mineIdx = device ? all.findIndex((e) => e.device === device) : -1;
    const you = mineIdx < 0 ? null : { rank: mineIdx + 1, net: all[mineIdx].net, books: all[mineIdx].books };
    return { total: all.length, top, you };
  }

  async fetch(request) {
    const date = new URL(request.url).pathname.slice(1);
    if (request.method === 'GET') {
      const device = new URL(request.url).searchParams.get('device') || '';
      return Response.json(await this._board(/^[A-Za-z0-9-]{8,64}$/.test(device) ? device : null));
    }
    let body;
    try { body = await request.json(); } catch (_) { return Response.json({ error: 'bad-json' }, { status: 400 }); }
    const device = String(body.device || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(device)) return Response.json({ error: 'bad-device' }, { status: 400 });
    const key = 'e:' + device;
    if (!(await this.state.storage.get(key))) {
      const score = replayDaily(date, body.moves);
      if (score.error) return Response.json({ error: score.error }, { status: 400 });
      const avatar = typeof body.avatar === 'string' && body.avatar.length <= 40 ? body.avatar : null;
      await this.state.storage.put(key, { device, name: cleanName(body.name), avatar, net: score.net, books: score.books, at: Date.now() });
      // A day's board is only interesting for a while: clear it out after a week.
      await this.state.storage.setAlarm(Date.now() + 7 * 864e5);
    }
    return Response.json(await this._board(device));
  }

  async alarm() { await this.state.storage.deleteAll(); }
}
