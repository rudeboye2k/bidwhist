// Teams + leaving, end-to-end against the real Worker (wrangler dev).
const { chromium } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log((ok ? 'PASS  ' : 'FAIL  ') + name); };

function bot(code, name, opts = {}) {
  const c = { name, seat: null, view: null, errors: [], moves: 0, ws: new WebSocket(`${WS}/api/room/${code}/ws`) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'hello', name })));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'welcome') c.seat = m.seat;
    if (m.type === 'error') c.errors.push(m.error);
    if (m.type !== 'state') return;
    c.view = m.view;
    const me = m.view.seats.find((s) => s.you); if (me) c.seat = me.seat;
    const v = m.view;
    if (!c.play || v.turn !== c.seat || !v.you) return;
    if (opts.dropOnTurnAfter != null && c.moves >= opts.dropOnTurnAfter && v.need === 'play') {
      c.dropped = { turn: v.turn, need: v.need }; c.ws.terminate(); return; // vanish mid-turn
    }
    const send = (intent) => { c.moves++; c.ws.send(JSON.stringify({ type: 'intent', intent })); };
    if (v.need === 'bid') send({ type: 'bid', bid: v.you.mustBid ? { amount: 3, type: 'uptown' } : { pass: true } });
    else if (v.need === 'declare-suit') send({ type: 'declare', trump: 'S' });
    else if (v.need === 'declare-dir') send({ type: 'declare', direction: 'uptown' });
    else if (v.need === 'discard') send({ type: 'discard', cardIds: v.you.hand.slice(0, 6).map((x) => x.id) });
    else if (v.need === 'play') send({ type: 'play', cardId: v.you.legalIds[0] });
  });
  return c;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(ORIGIN + '/');
  await page.evaluate(() => localStorage.setItem('bidwhist.profile', JSON.stringify({ name: 'Ann', avatar: 'cartoon:5.2' })));
  await page.reload(); await wait(400);
  await page.click('#btn-play-online'); await page.click('#btn-host');
  await page.waitForSelector('#modal-lobby.show', { timeout: 10000 });
  const code = (await page.textContent('#lobby-code')).trim();

  const bea = bot(code, 'Bea', { dropOnTurnAfter: 4 });
  await wait(600);
  const cal = bot(code, 'Cal');
  await wait(800);
  check('Bea seated on Team B, Cal on Team A (auto)', bea.seat % 2 === 1 && cal.seat % 2 === 0);

  // Cal picks Team B to partner Bea
  cal.ws.send(JSON.stringify({ type: 'team', team: 1 })); await wait(600);
  check('Cal switched to Team B — partners with Bea', cal.seat % 2 === 1 && (cal.seat + 2) % 4 === bea.seat);

  // Captains name teams: Ann (first on A) in the browser UI; Bea (first on B) over the socket
  await page.waitForSelector('.team-card.team-a .team-name-input', { timeout: 5000 });
  await page.fill('.team-card.team-a .team-name-input', 'Spade Kings');
  await page.press('.team-card.team-a .team-name-input', 'Enter'); await wait(700);
  bea.ws.send(JSON.stringify({ type: 'teamName', team: 1, name: 'Diamond Divas' })); await wait(500);
  cal.ws.send(JSON.stringify({ type: 'teamName', team: 1, name: 'Hijack' })); await wait(500);
  check('Cal (not captain) could not rename Team B', cal.errors.includes('not-captain'));
  check('both team names reached everyone', bea.view.teams[0].name === 'Spade Kings' && bea.view.teams[1].name === 'Diamond Divas');
  const bTitle = (await page.textContent('.team-card.team-b .team-title')).trim();
  check('Ann sees Team B as "Diamond Divas"', bTitle === 'Diamond Divas');
  await page.screenshot({ path: OUT + '/teams-lobby.png' });

  // Start; the empty Team A seat becomes a bot
  bea.play = true; cal.play = true;
  await page.click('#btn-start-online'); await wait(800);
  check('empty seat filled by a bot at start', bea.view.seats.filter((s) => s.kind === 'ai').length === 1);
  const scoreLabels = [(await page.textContent('#label-us')).trim(), (await page.textContent('#label-them')).trim()];
  check('scoreboard shows team names', scoreLabels[0] === 'Spade Kings' && scoreLabels[1] === 'Diamond Divas');

  // Ann plays in the browser; Cal leaves after a few moves; Bea drops mid-turn
  const tc = (q) => page.evaluate((s) => { const e = document.querySelector(s); if (e && !e.disabled) { e.click(); return true; } return false; }, q);
  let calLeft = false, sawSummary = false;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (!calLeft && cal.moves >= 3) { cal.ws.send(JSON.stringify({ type: 'leave' })); calLeft = true; }
    if (await page.$('#modal-summary.show')) { sawSummary = true; break; }
    const hint = (await page.textContent('#action-bar').catch(() => '')) || '';
    if (await page.$('.bid-col .btn.primary')) await tc('.bid-col .btn.primary:not(:disabled)');
    else if (/name trump/i.test(hint)) { await tc('.action-bar .suit-pick'); await tc('.action-bar .chipbtn.wide:not(.suit-pick)'); await tc('.action-bar > .btn.primary'); }
    else if (/which way/i.test(hint)) await tc('.action-bar .chipbtn.wide');
    else if (/pick six|kitty is yours/i.test(hint)) { await tc('.action-bar .btn.ghost'); await wait(120); await tc('.action-bar .btn.primary'); }
    else if (/your play|you lead/i.test(hint)) await tc('.hand .card:not(.disabled)');
    await wait(220);
  }
  await page.screenshot({ path: OUT + '/teams-summary.png' });
  const talk = await page.textContent('#log');
  check('Cal left mid-game', calLeft);
  check('Bea dropped on her own turn', !!bea.dropped);
  check('hand still finished — no stall', sawSummary);
  check('table talk announced the bot takeover', /Cal<\/?b?>?\s*left the table|Cal left the table/.test(talk));
  const v = await page.evaluate(() => window.__lastView || null);
  const seatInfo = await page.evaluate(() => [...document.querySelectorAll('.nameplate .prole')].map((e) => e.textContent));
  check('seats show who left / who is away', seatInfo.some((t) => /left · bot/.test(t)) && seatInfo.some((t) => /away · bot playing/.test(t)));
  const summary = await page.textContent('#summary-body');
  check('results use team names', /Spade Kings|Diamond Divas/.test(summary));
  check('no browser errors', pageErrors.length === 0);
  if (pageErrors.length) console.log(pageErrors);
  console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
  await browser.close(); process.exit(results.every((r) => r[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
