// A Boston stays on screen until you tap — long enough for a screenshot — even
// when it wins the game or the next hand has already been dealt online.
const { chromium, devices } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

const BOSTON = {
  bidTeam: 0, highSeat: 0, bid: { amount: 4, type: 'suit' },
  contract: { amount: 4, type: 'uptown', trump: 'S', direction: 'uptown' },
  books: [13, 0], needed: 10, delta: 7, made: true, boston: true, scores: [7, 0], penalties: [], tricks: [],
};
const shown = (p, id) => p.$eval('#' + id, (m) => m.classList.contains('show'));

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(ORIGIN + '/');
    await p.click('#btn-deal-in');
    await p.waitForFunction(() => document.querySelectorAll('#hand .card').length >= 12);

    // 1) A Boston that wins the game: the final score waits for a tap.
    await p.evaluate((r) => { showOnlineSummary(r); window.__over = animateEvents([{ t: 'gameover', winner: 0, scores: [7, 0] }]); }, BOSTON);
    await p.waitForTimeout(6000);
    check(`${name}: Boston still up after 6 seconds`, await shown(p, 'modal-summary'));
    check(`${name}: stamp reads BOSTON!`, (await p.textContent('#summary-stamp')).trim() === 'BOSTON!');
    check(`${name}: final score hasn't covered it`, !(await shown(p, 'modal-gameover')));
    check(`${name}: button offers the final score`, (await p.textContent('#btn-next-hand')).trim() === 'See the Final Score' && !(await p.isDisabled('#btn-next-hand')));
    await p.screenshot({ path: `${OUT}/boston-${name}.png` });
    await p.click('#btn-next-hand');
    await p.evaluate(() => window.__over);
    check(`${name}: tap → final score`, await shown(p, 'modal-gameover') && !(await shown(p, 'modal-summary')));
    await p.evaluate(() => document.getElementById('modal-gameover').classList.remove('show'));

    // 2) Online: the host deals the next hand while you're still admiring it.
    await p.evaluate((r) => {
      Online.summaryFor = null; showOnlineSummary(Object.assign({}, r, { scores: [3, 0] }));
      window.__deal = animateEvents([{ t: 'deal', dealer: 1, handNo: 9 }]);
    }, BOSTON);
    await p.waitForTimeout(3000);
    check(`${name}: next deal waits behind the Boston`, await shown(p, 'modal-summary'));
    check(`${name}: you can tap Continue`, (await p.textContent('#btn-next-hand')).trim() === 'Continue' && !(await p.isDisabled('#btn-next-hand')));
    await p.click('#btn-next-hand');
    await p.evaluate(() => window.__deal);
    check(`${name}: tap → on to the next hand`, !(await shown(p, 'modal-summary')) && !(await p.evaluate(() => Boston.open)));

    // 3) An ordinary made bid isn't held.
    await p.evaluate((r) => { Online.summaryFor = null; showOnlineSummary(Object.assign({}, r, { boston: false, books: [11, 2] })); }, BOSTON);
    check(`${name}: a plain made bid doesn't hold the table`, !(await p.evaluate(() => Boston.open)));
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
