// Online features against the real Worker (wrangler dev / workerd), raw sockets.
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(code, name, extra) {
  const ws = new WebSocket(`${WS}/api/room/${code}/ws`);
  const c = { ws, msgs: [], events: [], view: null, welcome: null, errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.type === 'welcome') c.welcome = m;
    if (m.type === 'state') { c.view = m.view; c.events.push(...m.events); }
    if (m.type === 'error') c.errors.push(m.error);
  });
  c.ready = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify(Object.assign({ type: 'hello', name }, extra || {}))); r(); }));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(50); } return false; };
  return c;
}

(async () => {
  const code = (await (await fetch(ORIGIN + '/api/new', { method: 'POST' })).json()).code;
  const A = client(code, 'Ann'); await A.ready; await A.until(() => A.welcome);
  // host sets house rules in the lobby
  A.send({ type: 'rules', rules: { turnTimer: 20, renege: true, aiLevel: 'sharp', ntMinFour: true } });
  await A.until(() => A.view && A.view.rules.turnTimer === 20);
  check('host sets house rules (timer 20s, renege, sharp AI)', A.view.rules.turnTimer === 20 && A.view.rules.renege && A.view.rules.aiLevel === 'sharp');
  const B = client(code, 'Ben'); await B.ready; await B.until(() => B.welcome);
  B.send({ type: 'rules', rules: { turnTimer: 0 } });
  await B.until(() => B.errors.length);
  check('non-host cannot change rules', B.errors.includes('not-host'));
  const C = client(code, 'Cy'); await C.ready; await C.until(() => C.welcome);
  const D = client(code, 'Di'); await D.ready; await D.until(() => D.welcome);
  const W = client(code, 'Wes'); await W.ready; await W.until(() => W.welcome);
  check('fifth person comes in as a watcher', W.welcome.watcher === true && W.welcome.token === null);
  await A.until(() => A.view && A.view.watchers === 1);
  check('players see the watcher count', A.view.watchers === 1);
  check('watcher view hides every hand', W.view && W.view.you === null && W.view.watching === true);
  // reactions
  A.send({ type: 'react', id: 0 });
  await W.until(() => W.events.some((e) => e.t === 'react'));
  check('a reaction reaches everyone, watchers included', W.events.some((e) => e.t === 'react' && e.id === 0) && B.events.some((e) => e.t === 'react'));
  W.send({ type: 'react', id: 1 });
  await W.until(() => W.errors.length);
  check('watchers can\'t react', W.errors.includes('say-hello'));
  // start; timer
  A.send({ type: 'start' });
  await A.until(() => A.view && A.view.phase === 'bidding');
  const v = A.view;
  check('turn clock runs for the player who is up', v.turnMsLeft > 15000 && v.turnMsLeft <= 20000);
  const up = v.turn;
  const t0 = Date.now();
  const sawTimeout = await A.until(() => A.events.some((e) => e.t === 'timeout'), 30000);
  check(`idle player timed out and a bot moved for them (~${((Date.now() - t0) / 1000).toFixed(1)}s)`, sawTimeout && A.events.find((e) => e.t === 'timeout').seat === up);
  // a player leaves → bot → watcher sits in
  D.send({ type: 'leave' });
  await W.until(() => W.view && W.view.seats.some((s) => s.kind === 'ai'));
  W.send({ type: 'sit' });
  await W.until(() => W.msgs.filter((m) => m.type === 'welcome').length >= 2);
  const w2 = W.msgs.filter((m) => m.type === 'welcome').pop();
  check('watcher takes the bot\'s seat mid-game', w2.token && w2.seat === 3);
  await W.until(() => W.view && W.view.you && W.view.you.hand.length > 0);
  check('...and gets that seat\'s hand', W.view.you && W.view.you.hand.length >= 11);
  check('record + last-book fields in the view', A.view.record && 'lastTrick' in A.view && A.view.kittySize === 6);
  console.log(`\n${pass}/${pass + fail} passed`);
  for (const c of [A, B, C, D, W]) c.ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
