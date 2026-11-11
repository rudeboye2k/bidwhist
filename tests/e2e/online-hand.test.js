// Full online hand against the REAL worker (workerd via wrangler dev): the page
// is served by the Worker itself, so the server URL must auto-resolve.
const { chromium } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(ORIGIN + '/');
  await page.waitForTimeout(500);

  await page.click('#btn-play-online');
  const noServerBox = await page.evaluate(() => !document.getElementById('online-server'));
  console.log('server is this site (no server box):', noServerBox);
  await page.screenshot({ path: OUT + '/real-online-modal.png' });

  await page.click('#btn-host');                       // no URL typed at all
  await page.waitForSelector('#modal-lobby.show', { timeout: 10000 });
  const code = (await page.textContent('#lobby-code')).trim();
  const invite = await page.evaluate(() => {
    const b = document.getElementById('btn-copy-link'); // read the link the button would copy
    return location.origin + location.pathname + '#join=' + document.getElementById('lobby-code').textContent.trim();
  });
  console.log('hosted room:', code, '| QR present:', !!(await page.$('#lobby-qr svg')));

  // Second human joins over a raw socket and plays legally.
  const ws = new WebSocket(`${WS}/api/room/${code}/ws`);
  let mySeat = null;
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', name: 'Bea' })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'welcome') { mySeat = msg.seat; return; }
    if (msg.type !== 'state') return;
    const v = msg.view;
    if (!global.hostAvatarSeen && v.seats && v.seats[0].avatar) { global.hostAvatarSeen = v.seats[0].avatar; }
    if (v.turn !== mySeat || !v.you) return;
    const send = (intent) => ws.send(JSON.stringify({ type: 'intent', intent }));
    if (v.need === 'bid') send({ type: 'bid', bid: v.you.mustBid ? { amount: v.rules.minBid, type: 'uptown' } : { pass: true } });
    else if (v.need === 'declare-suit') send({ type: 'declare', trump: 'S' });
    else if (v.need === 'declare-dir') send({ type: 'declare', direction: 'uptown' });
    else if (v.need === 'discard') send({ type: 'discard', cardIds: v.you.hand.slice(0, 6).map((c) => c.id) });
    else if (v.need === 'play') send({ type: 'play', cardId: (v.you.legalIds && v.you.legalIds[0]) || v.you.hand[0].id });
  });
  await page.waitForTimeout(1200);
  const roster = await page.$$eval('#lobby-roster .r-name', (els) => els.map((e) => e.textContent));
  console.log('lobby roster:', roster.join(' | '));
  await page.screenshot({ path: OUT + '/real-lobby.png' });

  await page.click('#btn-start-online');
  const tc = async (s) => { try { await page.click(s, { timeout: 400 }); return true; } catch (_) { return false; } };
  const deadline = Date.now() + 120000;
  let sawSummary = false;
  while (Date.now() < deadline) {
    if (await page.$('#modal-summary.show')) { sawSummary = true; break; }
    const hint = (await page.textContent('#action-bar').catch(() => '')) || '';
    if (await page.$('.bid-col .btn.primary')) { if (!(await tc('.bid-col .btn.primary:not(:disabled)'))) await tc('.bid-col .btn.ghost'); }
    else if (/name trump/i.test(hint)) { await tc('.action-bar .suit-pick'); await tc('.action-bar .chipbtn.wide:not(.suit-pick)'); await tc('.action-bar > .btn.primary'); }
    else if (/which way/i.test(hint)) await tc('.action-bar .chipbtn.wide');
    else if (/pick six|kitty is yours/i.test(hint)) { await tc('.action-bar .btn.ghost'); await page.waitForTimeout(120); await tc('.action-bar .btn.primary'); }
    else if (/your play|you lead/i.test(hint)) await tc('.hand .card:not(.disabled)');
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: OUT + '/real-summary.png' });
  console.log('full hand reached summary:', sawSummary,
    '| summary:', sawSummary ? (await page.textContent('#summary-title')).trim() + ' — ' + (await page.textContent('#summary-stamp')).trim() : '-');
  console.log('Bea received host avatar:', global.hostAvatarSeen);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
  ws.close(); await browser.close();
  process.exit(errors.length || !sawSummary ? 1 : 0);
})().catch((e) => { console.error('driver failed:', e); process.exit(2); });
