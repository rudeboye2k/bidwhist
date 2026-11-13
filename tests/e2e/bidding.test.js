// Bidding: number only → win → name trump + direction (kitty still down) → take the kitty → bury.
const { chromium, devices } = require('./helpers');
const { ORIGIN, WS, OUT } = require('./helpers');
const OUTDIR = OUT + '/bid';
require('fs').mkdirSync(OUTDIR, { recursive: true });
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']], ['se', devices['iPhone SE']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); localStorage.removeItem('bidwhist.rules'); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let won = false;
    for (let attempt = 0; attempt < 6 && !won; attempt++) {
      await p.goto(ORIGIN + '/');
      await p.click('#btn-deal-in');
      await p.waitForSelector('#action-bar .bid-go', { timeout: 30000 });
      await p.waitForTimeout(500);
      const bar = await p.innerText('#action-bar');
      if (attempt === 0) {
        check(`${name}: bid panel has no Uptown/Downtown choice`, !/Uptown|Downtown/.test(bar.replace(/Uptown or Downtown/g, '')));
        check(`${name}: bid buttons read "Bid N" and "Bid N No…"`, /Bid \d\b/i.test(bar) && /Bid \d No/i.test(bar));
        check(`${name}: kitty pile on the table during bidding`, !(await p.$eval("#kitty", (k) => k.classList.contains("gone"))));
        await p.screenshot({ path: `${OUTDIR}/${name}-1-bid.png` });
      }
      for (const c of await p.$$('#action-bar .chipbtn')) if ((await c.textContent()).trim() === '7' && !(await c.isDisabled())) await c.click();
      const bid = await p.$('#action-bar .bid-go .btn.primary:not(.nt):not(:disabled)');
      if (!bid) continue;
      await bid.click();
      const declare = await p.waitForFunction(() => /Name trump and pick a direction/.test(document.getElementById('action-bar').textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
      if (!declare) continue;
      won = true;
      await p.waitForTimeout(900);
      const n = await p.$$eval('#hand .card', (x) => x.length);
      check(`${name}: you name trump from your own 12 cards (${n} cards)`, n === 12);
      check(`${name}: kitty pile still on the table while you call`, !(await p.$eval('#kitty', (k) => k.classList.contains('gone'))));
      const log = await p.textContent('#log');
      check(`${name}: table talk shows a plain number bid`, /bid 7\./.test(log));
      const go = await p.$('#action-bar .btn.primary');
      check(`${name}: can't confirm until suit AND direction are picked`, await go.isDisabled());
      await p.click('#action-bar .suit-pick.suit-H');
      check(`${name}: still waiting on a direction`, await go.isDisabled());
      await p.screenshot({ path: `${OUTDIR}/${name}-2-declare.png` });
      await p.click('#action-bar .chipbtn:has-text("Downtown")');
      check(`${name}: confirm button reads "Hearts · Downtown"`, /Hearts · Downtown/.test(await go.textContent()));
      await go.click();
      await p.waitForSelector('#btn-discard-done', { timeout: 10000 });
      const badge = await p.textContent('#trump-badge');
      check(`${name}: trump badge shows Hearts, Downtown`, /Hearts/.test(badge) && /Downtown/.test(badge));
      check(`${name}: then bury six`, (await p.textContent('#btn-discard-done')).includes('Six'));
      check(`${name}: the kitty is in your hand after the call (18 cards)`, (await p.$$eval('#hand .card', (x) => x.length)) === 18);
      check(`${name}: kitty pile is gone from the table`, await p.$eval('#kitty', (k) => k.classList.contains('gone')));
      await p.screenshot({ path: `${OUTDIR}/${name}-3-bury.png` });
      check(`${name}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    check(`${name}: won a bid to test with`, won);
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
