// Load once online, go offline, reload, and play the computer. Then keyboard-play a card.
const { chromium } = require('./helpers');
const { ORIGIN, WS, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(ORIGIN + '/');
  const ready = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check('service worker installed', ready);
  await p.waitForTimeout(800);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  check('page loads with no connection', await p.isVisible('#btn-deal-in'));
  await p.click('#btn-deal-in');
  const bid = await p.waitForSelector('#action-bar .chipbtn', { timeout: 20000 }).then(() => true).catch(() => false);
  check('solo game runs offline (got to bidding)', bid);
  // keyboard: pass the bid with the keyboard, then play cards with Tab + Enter
  await p.focus('#action-bar .btn.ghost');
  await p.keyboard.press('Enter');
  const playable = await p.waitForFunction(() => document.querySelector('#hand .card[tabindex="0"]'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  if (playable) {
    const before = await p.$$eval('#hand .card', (x) => x.length);
    await p.focus('#hand .card[tabindex="0"]');
    const label = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
    console.log('bar before:', (await p.textContent('#action-bar')).slice(0, 80), '| focused:', await p.evaluate(() => document.activeElement.className));
    await p.keyboard.press('Enter');
    await p.waitForTimeout(900);
    console.log('bar after:', (await p.textContent('#action-bar')).slice(0, 80), '| trick:', await p.$$eval('#trick .played', (x) => x.length));
    const still = await p.$$eval('#hand .card', (x, l) => x.some((c) => c.getAttribute('aria-label') === l), label);
    check(`keyboard plays a card ("${label}" left the hand)`, !still);
  } else check('reached a playable turn (hand may have ended by bot bids)', false);
  const live = await p.textContent('#sr-live');
  check('screen-reader announcement region is used', live.length > 0);
  check('no page errors', errs.length === 0);
  if (errs.length) console.log(errs);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
