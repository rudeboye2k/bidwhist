// Watching a game in progress: no fake "You", south hand face-down, chip in place.
const { chromium, devices } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
function sock(code, name, play) {
  const ws = new WebSocket(`${WS}/api/room/${code}/ws`);
  const c = { ws, view: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw); if (m.type !== 'state') return; c.view = m.view; const v = m.view;
    if (!play || !v.you || v.turn !== v.you.seat) return;
    const send = (intent) => setTimeout(() => ws.send(JSON.stringify({ type: 'intent', intent })), 400);
    if (v.need === 'bid') send({ type: 'bid', bid: v.you.mustBid || v.you.seat === 0 && !v.high ? { amount: 4, type: 'suit' } : { pass: true } });
    else if (v.need === 'declare-suit') send({ type: 'declare', trump: 'D', direction: 'uptown' });
    else if (v.need === 'declare-dir') send({ type: 'declare', direction: 'uptown' });
    else if (v.need === 'discard') send({ type: 'discard', cardIds: v.you.hand.slice(0, v.you.hand.length - 12).map((x) => x.id) });
    else if (v.need === 'play') send({ type: 'play', cardId: v.you.legalIds[0] });
  });
  c.ready = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', name })); r(); }));
  return c;
}
(async () => {
  const code = (await (await fetch(ORIGIN + '/api/new', { method: 'POST' })).json()).code;
  const P = [sock(code, 'Mrs. Weir', true), sock(code, 'Pearl P', true), sock(code, 'Eddie', true), sock(code, 'Marc', true)];
  for (const p of P) { await p.ready; await wait(150); }
  P[0].ws.send(JSON.stringify({ type: 'start' }));
  await wait(2500);
  const b = await chromium.launch();
  for (const [label, opts] of [['desk', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    const pg = await b.newPage(opts);
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(`${ORIGIN}/#join=${code}`);
    await pg.waitForSelector('#modal-online.show'); await pg.click('#btn-join');
    await pg.waitForFunction(() => /watching/i.test(document.getElementById('action-bar').textContent), null, { timeout: 15000 }).catch(() => {});
    await wait(2500);
    const roles = await pg.$$eval('.nameplate .prole', (x) => x.map((e) => e.textContent).join(' | '));
    const names = await pg.$$eval('.nameplate .pname', (x) => x.map((e) => e.textContent).join(' | '));
    const hint = await pg.textContent('#action-bar');
    check(`${label}: watcher sees no "you" / "your partner" seats (${roles})`, !/\byou\b|your partner/i.test(roles));
    check(`${label}: the bottom seat shows its real name (${names})`, names.includes('Mrs. Weir'));
    check(`${label}: the prompt names who's up — never "You is up" ("${hint.trim()}")`, !/You is up/.test(hint));
    const backs = await pg.$$eval('#hand .card.back', (x) => x.length);
    check(`${label}: the bottom player's hand shows face-down (${backs} cards)`, backs >= 1);
    const contract = await pg.textContent('#contract-line');
    check(`${label}: contract line names the bidder, not "You" ("${contract.trim().slice(0, 40)}")`, !/^You\b/.test(contract.trim()));
    await pg.screenshot({ path: `${OUT}/watch2-${label}.png` });
    check(`${label}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await pg.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  for (const p of P) p.ws.close();
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
