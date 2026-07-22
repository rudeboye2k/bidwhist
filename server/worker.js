/*
 * Cloudflare Worker + Durable Object for Bid Whist online play.
 *
 *   Worker (fetch)         — routes HTTP + WebSocket upgrades.
 *   GameRoom (Durable Obj) — ONE per join code (env.GAME_ROOM.idFromName(code)),
 *                            so every game is a separate object with its own
 *                            state and sockets. Rooms cannot collide.
 *
 * The heavy lifting lives in room-core.js (unit-tested in Node). This file is
 * just transport: sockets in, validated intents to the Room, snapshots + event
 * streams back out. WebSocket Hibernation keeps idle rooms cheap.
 */

// room-core.js pulls in engine.js + ai.js through its own require()s. wrangler
// bundles with esbuild, which treats these UMD files as CommonJS, so a plain
// default import gives us their module.exports — no globals, no build hacks.
import RoomCore from './room-core.js';

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
  // Ambiguity-free alphabet (no O/0/I/1) for codes people read aloud.
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Mint a fresh code and hand it back (host flow). The room is created lazily
    // on first WebSocket connect, so an unused code costs nothing.
    if (url.pathname === '/api/new' && request.method === 'POST') {
      return json({ code: makeCode() });
    }

    // WebSocket join: /api/room/:code/ws
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return json({ error: 'not-found' }, 404);
  },
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;         // RoomCore.Room, created on first connect
    this.sockets = new Map(); // ws -> { token }
    this.code = null;
  }

  _ensureRoom(code) {
    if (!this.room) {
      this.code = code;
      this.room = new RoomCore.Room(code, {});
    }
    return this.room;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = (url.pathname.match(/room\/([A-Za-z0-9]+)\//) || [])[1] || 'ROOM';
    this._ensureRoom(code.toUpperCase());

    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server); // hibernatable
    this.sockets.set(server, { token: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- socket lifecycle (hibernation handlers) ----

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return this._send(ws, { type: 'error', error: 'bad-json' }); }
    const meta = this.sockets.get(ws) || {};

    if (msg.type === 'hello') {
      // Reclaim a seat if the socket carries a token this room still knows;
      // otherwise take a fresh seat.
      let r, token;
      if (msg.token && this.room.seatOf(msg.token) != null) {
        r = this.room.reclaim(msg.token); token = msg.token;
      } else {
        r = this.room.join(msg.name); token = r.token;
      }
      if (r.error) return this._send(ws, { type: 'error', error: r.error });
      meta.token = token;
      this.sockets.set(ws, meta);
      this._send(ws, { type: 'welcome', token, seat: r.seat, host: !!r.host });
      return this._broadcast();
    }

    if (!meta.token) return this._send(ws, { type: 'error', error: 'say-hello' });

    let out;
    if (msg.type === 'start') out = this.room.start(meta.token);
    else if (msg.type === 'nextHand') out = this.room.nextHand(meta.token);
    else if (msg.type === 'intent') out = this.room.submit(meta.token, msg.intent);
    else if (msg.type === 'leave') { this.room.leave(meta.token); out = { events: [] }; }
    else return this._send(ws, { type: 'error', error: 'unknown-type' });

    if (out && out.error) return this._send(ws, { type: 'error', error: out.error });
    this._broadcast(out && out.events);
  }

  async webSocketClose(ws) {
    const meta = this.sockets.get(ws);
    if (meta && meta.token) this.room.setConnected(meta.token, false);
    this.sockets.delete(ws);
    this._broadcast();
  }

  async webSocketError(ws) {
    this.sockets.delete(ws);
  }

  // ---- fan-out ----

  _send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* socket gone */ }
  }

  // Push each connected socket its own tailored snapshot (its own hand only),
  // plus the shared event stream for animation.
  _broadcast(events) {
    for (const [ws, meta] of this.sockets) {
      const view = this.room.viewFor(meta.token);
      this._send(ws, { type: 'state', view, events: events || [] });
    }
  }
}
