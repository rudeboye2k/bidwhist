// Host lobby controls, end-to-end on the real Worker (wrangler dev).
const { chromium } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n); };
function sock(code, name) {
  const c = { view: null, seat: null, errors: [], ws: new WebSocket(`${WS}/api/room/${code}/ws`) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'hello', name })));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'error') c.errors.push(m.error);
    if (m.type !== 'state') return;
    c.view = m.view; const me = m.view.seats.find((s) => s.you); if (me) c.seat = me.seat;
    const v = m.view;
    if (!c.play || v.turn !== c.seat || !v.you) return;
    const send = (intent) => c.ws.send(JSON.stringify({ type: 'intent', intent }));
    if (v.need === 'bid') send({ type: 'bid', bid: v.you.mustBid ? { amount: 3, type: 'uptown' } : { pass: true } });
    else if (v.need === 'declare-suit') send({ type: 'declare', trump: 'S' });
    else if (v.need === 'declare-dir') send({ type: 'declare', direction: 'uptown' });
    else if (v.need === 'discard') send({ type: 'discard', cardIds: v.you.hand.slice(0, 6).map((x) => x.id) });
    else if (v.need === 'play') send({ type: 'play', cardId: v.you.legalIds[0] });
  });
  return c;
}
const row = (seat) => `.team-card.team-${seat % 2 ? 'b' : 'a'} .roster li:nth-child(${seat < 2 ? 1 : 2})`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ORIGIN + '/');
  await page.evaluate(() => localStorage.setItem('bidwhist.profile', JSON.stringify({ name: 'Hal', avatar: 'cartoon:5.2' })));
  await page.reload(); await wait(400);
  await page.click('#btn-play-online'); await page.click('#btn-host');
  await page.waitForSelector('#modal-lobby.show');
  const code = (await page.textContent('#lobby-code')).trim();
  const amy = sock(code, 'Amy'); await wait(800);
  check('Amy joined on Team B (seat 1)', amy.seat === 1);

  await page.click(`${row(3)} .seat-act`); await wait(600);           // + Bot in seat 3
  check('host added a bot to seat 3', amy.view.seats[3].kind === 'ai');

  await page.click(row(1)); await wait(150);                          // tap Amy…
  const hint = await page.textContent('#teams-hint');
  await page.screenshot({ path: OUT + '/host-pick.png' });
  check('picking a player shows the move prompt', /Now tap the seat to move Amy/.test(hint));
  await page.click(row(2)); await wait(700);                          // …then the open seat on Team A
  check('Amy moved to seat 2 — now the host\'s partner', amy.seat === 2);

  await page.click(`${row(3)} .seat-act`); await wait(600);           // Kick the bot
  check('host kicked the bot — seat 3 open again', amy.view.seats[3].kind === 'empty');
  const amyTriesKick = amy.ws.send(JSON.stringify({ type: 'addBot', seat: 3 })); void amyTriesKick; await wait(400);
  check('non-host cannot add bots', amy.errors.includes('not-host'));

  const lou = sock(code, 'Lou'); await wait(800);
  check('late player Lou took an open seat', lou.seat === 1 || lou.seat === 3);
  await page.screenshot({ path: OUT + '/host-lobby.png' });

  // play one hand, then host returns everyone to the lobby
  amy.play = true; lou.play = true;
  await page.click('#btn-start-online'); await wait(600);
  const tc = (q) => page.evaluate((s) => { const e = document.querySelector(s); if (e && !e.disabled) { e.click(); return true; } return false; }, q);
  const deadline = Date.now() + 150000; let summary = false;
  while (Date.now() < deadline) {
    if (await page.$('#modal-summary.show')) { summary = true; break; }
    const h = (await page.textContent('#action-bar').catch(() => '')) || '';
    if (await page.$('.bid-col .btn.primary')) await tc('.bid-col .btn.primary:not(:disabled)');
    else if (/name trump/i.test(h)) { await tc('.action-bar .suit-pick'); await tc('.action-bar .chipbtn.wide:not(.suit-pick)'); await tc('.action-bar > .btn.primary'); }
    else if (/which way/i.test(h)) await tc('.action-bar .chipbtn.wide');
    else if (/pick six|kitty is yours/i.test(h)) { await tc('.action-bar .btn.ghost'); await wait(120); await tc('.action-bar .btn.primary'); }
    else if (/your play|you lead/i.test(h)) await tc('.hand .card:not(.disabled)');
    await wait(220);
  }
  check('a hand was played', summary);
  await page.evaluate(() => document.getElementById('btn-to-lobby').click()); await wait(900);
  check('host returned the table to the lobby', !!(await page.$('#modal-lobby.show')) && !(await page.$('#modal-summary.show')));
  check('scores reset in the lobby', amy.view.phase === 'lobby' && amy.view.scores.join() === '0,0');
  const botSeat = amy.view.seats.find((s) => s.kind === 'ai').seat;
  await page.click(`${row(botSeat)} .seat-act`); await wait(600);
  const neo = sock(code, 'Neo'); await wait(800);
  check('after kicking a bot, a newcomer gets that seat', neo.seat === botSeat);
  check('no browser errors', errs.length === 0); if (errs.length) console.log(errs);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
