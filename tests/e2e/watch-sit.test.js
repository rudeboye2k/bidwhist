// Browser as a watcher: full lobby → "watching" → seat opens → Take a seat → playing (with turn clock).
const { chromium } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
function sock(code, name) {
  const ws = new WebSocket(`${WS}/api/room/${code}/ws`);
  const c = { ws, view: null };
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'state') c.view = m.view; });
  c.ready = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', name })); r(); }));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}
(async () => {
  const code = (await (await fetch(ORIGIN + '/api/new', { method: 'POST' })).json()).code;
  const P = ['Ann', 'Ben', 'Cy', 'Di'].map((n) => sock(code, n));
  for (const p of P) { await p.ready; await wait(150); }
  P[0].send({ type: 'rules', rules: { turnTimer: 30 } });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${ORIGIN}/#join=${code}`);
  await page.waitForSelector('#modal-online.show');
  await page.click('#btn-join');
  await page.waitForSelector('#modal-lobby.show', { timeout: 8000 });
  await wait(400);
  const hint = await page.textContent('#teams-hint');
  check('full lobby: browser joins as a watcher', /watching/i.test(hint));
  check('no seat to take yet', await page.isHidden('#btn-sit'));
  await page.screenshot({ path: OUT + '/watch-lobby.png' });
  P[3].send({ type: 'leave' });
  await page.waitForSelector('#btn-sit:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('a seat opens: "Take a seat" appears', await page.isVisible('#btn-sit'));
  await page.click('#btn-sit');
  await wait(800);
  const seated = await page.evaluate(() => [...document.querySelectorAll('#lobby-teams .r-name')].some((x) => x.textContent.includes('You')));
  check('watcher is now seated in the lobby', seated);
  P[0].send({ type: 'start' });
  await page.waitForSelector('#modal-lobby:not(.show)', { timeout: 8000 }).catch(() => {});
  await wait(2500);
  check('turn clock shows on the player who is up', await page.$('.np-timer') !== null);
  check('Table Rules locked for a non-host', await page.evaluate(() => { document.getElementById('btn-settings').click(); return document.querySelector('#settings-form select[name=minBid]').disabled && !document.getElementById('rules-lock').hidden; }));
  await page.screenshot({ path: OUT + '/watch-seated.png' });
  check('no page errors', errs.length === 0);
  if (errs.length) console.log(errs);
  console.log(`\n${pass}/${pass + fail} passed`);
  for (const p of P) p.ws.close();
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
