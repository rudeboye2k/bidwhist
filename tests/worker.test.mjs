// Server checks that don't need Cloudflare: the version stamp on the page and
// service worker, and the idle-table clean-up alarm. Fakes the Durable Object
// storage and the static-assets binding.
// Run: node tests/worker.test.mjs
import worker, { GameRoom, DailyBoard } from '../server/worker.js';
import E from '../js/engine.js';
import AI from '../js/ai.js';
import RC from '../js/room-core.js';

let fails = 0;
const check = (name, ok) => { if (!ok) { fails++; console.error('FAIL ' + name); } else console.log('ok   ' + name); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- version stamp ----
const FILES = { '/': '<script src="js/app/main.js?v=__V__"></script>', '/sw.js': "const CACHE = 'gmdk-__V__';" };
let lastAssetReq = null;
const ASSETS = {
  async fetch(req) {
    lastAssetReq = req;
    const p = new URL(req.url).pathname;
    if (p === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
    if (!(p in FILES)) return new Response('nope', { status: 404 });
    return new Response(FILES[p], { headers: { ETag: '"abc"', 'Content-Type': 'text/html' } });
  },
};
const env = { ASSETS, VERSION: { id: '1a2b3c4d-5e6f-7a8b-9c0d' } };
{
  const res = await worker.fetch(new Request('https://x.test/?join=ABCDE', { headers: { 'If-None-Match': '"abc"' } }), env);
  const body = await res.text();
  check('page gets the version stamp', body.includes('main.js?v=1a2b3c4d5e"'));
  check('no stale 304: conditional headers dropped', !lastAssetReq.headers.get('If-None-Match'));
  check('stamped page is no-cache, no ETag', res.headers.get('Cache-Control') === 'no-cache' && !res.headers.get('ETag'));
  const sw = await (await worker.fetch(new Request('https://x.test/sw.js'), env)).text();
  check('service worker cache name stamped', sw.includes("'gmdk-1a2b3c4d5e'"));
  const red = await worker.fetch(new Request('https://x.test/index.html'), env);
  check('/index.html redirect passes through', red.status === 307);
  const dev = await (await worker.fetch(new Request('https://x.test/'), { ASSETS })).text();
  check('no version binding → "dev"', dev.includes('?v=dev"'));
}

// ---- idle clean-up ----
const store = new Map();
let alarm = null, sockets = [];
const state = {
  blockConcurrencyWhile: (f) => f(),
  getWebSockets: () => sockets,
  storage: {
    async get(k) { return Array.isArray(k) ? new Map(k.filter((x) => store.has(x)).map((x) => [x, store.get(x)])) : store.get(k); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v); },
    async setAlarm(t) { alarm = t; },
    async deleteAlarm() { alarm = null; },
    async deleteAll() { store.clear(); },
  },
};
const WEEK = 7 * 864e5;
{
  const g = new GameRoom(state, {}); await tick();
  g._ensureRoom('ABCDE'); g.room.join('Ed', 'cat'); await g._save();
  check('saving arms the idle alarm a week out', Math.abs(alarm - (Date.now() + WEEK)) < 2000);
  const g2 = new GameRoom(state, {}); await tick();
  check('room + activity restored on wake', !!g2.room && g2.active === store.get('active'));
  g2.active -= WEEK + 1; sockets = [{}]; await g2.alarm();
  check('idle but someone connected: kept, re-armed', store.has('room') && alarm > Date.now() + WEEK - 2000);
  g2.active -= WEEK + 1; sockets = []; await g2.alarm();
  check('idle and empty: deleted', store.size === 0 && alarm === null && g2.room === null);
}

// ---- Daily Deal leaderboard ----
// Play the day's hand with the computer's choices for seat 0, keeping the moves.
function playDaily(date, pick) {
  const room = RC.dailyRoom(date); const { token } = room.join('You'); room.start(token);
  const moves = [];
  for (let g = 0; g < 100 && !['handover', 'gameover'].includes(room.phase); g++) {
    const hand = room.hands[0]; let m;
    if (room.need === 'bid') m = { type: 'bid', bid: AI.chooseBid(hand, room.high, room.rules, room._mustBid(0), () => 0.5, null, 0).bid };
    else if (room.need === 'declare-suit') { const d = AI.chooseDeclare(hand, 'suit'); m = { type: 'declare', trump: d.trump, direction: d.direction }; }
    else if (room.need === 'declare-dir') m = { type: 'declare', direction: AI.chooseDeclare(hand, 'notrump').direction };
    else if (room.need === 'discard') m = { type: 'discard', cardIds: AI.chooseDiscards(hand, room.contract).map((c) => c.id) };
    else { const legal = E.allowedPlays(hand, room.trick, room.contract, room.rules); m = { type: 'play', cardId: legal[pick % legal.length].id }; }
    room.submit(token, m); moves.push(m);
  }
  return { moves, score: RC.dailyScore(room.lastResult) };
}
{
  const today = E.dailyDate();
  const a = playDaily(today, 0), b = playDaily(today, 1);
  check('the same moves replay to the same score', JSON.stringify(RC.replayDaily(today, a.moves)) === JSON.stringify(a.score));
  check("another day's moves don't replay", !!RC.replayDaily(E.dailyDate(new Date(Date.now() - 5 * 864e5)), a.moves).error);

  const kv = new Map(); let dalarm = null;
  const board = new DailyBoard({ storage: {
    async get(k) { return kv.get(k); }, async put(k, v) { kv.set(k, v); },
    async list({ prefix }) { return new Map([...kv].filter(([k]) => k.startsWith(prefix))); },
    async setAlarm(t) { dalarm = t; }, async deleteAll() { kv.clear(); },
  } });
  const post = (body) => board.fetch(new Request('https://daily/' + today, { method: 'POST', body: JSON.stringify(body) }));
  let r = await post({ device: 'device-aaaa1111', name: 'Ed <b>', avatar: 'cat', moves: a.moves });
  let j = await r.json();
  check('a real hand goes on the board', r.ok && j.total === 1 && j.top[0].net === a.score.net && j.top[0].you);
  check('names are cleaned', j.top[0].name === 'Ed b');
  r = await post({ device: 'device-aaaa1111', name: 'Ed', moves: b.moves });
  j = await r.json();
  check('one entry per device (the first counts)', j.total === 1 && j.top[0].net === a.score.net);
  r = await post({ device: 'device-bbbb2222', name: 'Cheat', moves: a.moves.slice(0, -1).concat([{ type: 'play', cardId: 'XX' }]) });
  check('tampered moves are refused', r.status === 400 && kv.size === 1);
  r = await post({ device: 'device-cccc3333', name: 'Bea', moves: b.moves });
  j = await r.json();
  const order = j.top.map((e) => e.net);
  check('board is sorted best first', j.total === 2 && order[0] >= order[1]);
  check('the board clears itself after a week', Math.abs(dalarm - (Date.now() + 7 * 864e5)) < 5000);
  const g = await (await board.fetch(new Request('https://daily/' + today + '?device=device-cccc3333'))).json();
  check('GET marks your own row', g.top.some((e) => e.you && e.name === 'Bea') && g.you && g.you.net === b.score.net);
  const far = await worker.fetch(new Request('https://x.test/api/daily/2020-01-01'), { DAILY_BOARD: null });
  check('only dates around today are taken', far.status === 400);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
