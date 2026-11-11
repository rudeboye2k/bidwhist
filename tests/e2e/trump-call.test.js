// The trump call is announced before the first card: timing, tap-to-skip, own call.
const { chromium, devices } = require('./helpers');
const { ORIGIN, WS, OUT } = require('./helpers');
const OUTDIR = OUT + '/call';
require('fs').mkdirSync(OUTDIR, { recursive: true });
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

// Watch the DOM from inside the page: when the call shows/hides and when the first card lands.
const watcher = () => {
  window.__t = { shows: [], hides: [], firstCard: null };
  const call = document.getElementById('trump-call');
  new MutationObserver(() => {
    const on = call.classList.contains('show');
    (on ? window.__t.shows : window.__t.hides).push(performance.now());
    if (on) window.__t.text = call.innerText;
  }).observe(call, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => {
    if (window.__t.firstCard === null && document.querySelector('#trick .played')) window.__t.firstCard = performance.now();
  }).observe(document.getElementById('trick'), { childList: true });
};

async function botWins(p) {
  // pass every bid until someone else wins; returns once the call has been shown
  for (let i = 0; i < 400; i++) {
    const shown = await p.evaluate(() => window.__t && window.__t.shows.length > 0);
    if (shown) return true;
    const pass = await p.$('#action-bar .bid-go .btn.ghost:not(:disabled)');
    if (pass) { await pass.click(); continue; }
    const forced = await p.$('#action-bar .bid-go .btn.primary:not(:disabled)'); // dealer stuck: bid it
    if (forced) { return false; }
    await p.waitForTimeout(100);
  }
  return false;
}

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    // 1) a computer player calls it: announcement, then ≥2.3s before the first card
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      await p.goto(ORIGIN + '/');
      await p.evaluate(watcher);
      await p.click('#btn-deal-in');
      ok = await botWins(p);
    }
    check(`${name}: a computer player's call is announced on the table`, ok);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUTDIR}/${name}-bot-call.png` });
    await p.waitForFunction(() => window.__t.firstCard !== null, null, { timeout: 20000 }).catch(() => {});
    const t = await p.evaluate(() => window.__t);
    const gap = (t.firstCard - t.shows[0]) / 1000;
    check(`${name}: names the caller and the contract ("${(t.text || '').split('\n').slice(0, 2).join(' / ')}")`, /calls it/i.test(t.text) && /(Uptown|Downtown)/.test(t.text) && /needs \d+ books/.test(t.text));
    check(`${name}: the first card waits until the call has been shown (${gap.toFixed(2)}s)`, gap >= 2.3);
    check(`${name}: the call is cleared before the first card`, t.hides.length > 0 && t.hides[0] <= t.firstCard);
    check(`${name}: the trump badge stays up afterwards`, await p.isVisible('#trump-badge'));
    // 2) tap to skip
    let skipped = null;
    for (let attempt = 0; attempt < 5 && skipped === null; attempt++) {
      await p.goto(ORIGIN + '/');
      await p.evaluate(watcher);
      await p.click('#btn-deal-in');
      if (!(await botWins(p))) continue;
      await p.waitForTimeout(400);
      await p.click('#trump-call', { force: true });
      await p.waitForFunction(() => window.__t.firstCard !== null, null, { timeout: 20000 }).catch(() => {});
      const t2 = await p.evaluate(() => window.__t);
      skipped = (t2.hides[0] - t2.shows[0]) / 1000;
    }
    check(`${name}: tapping skips the wait (${skipped !== null ? skipped.toFixed(2) : '?'}s)`, skipped !== null && skipped < 1.2);
    // 3) your own call: shorter confirmation
    let own = null;
    for (let attempt = 0; attempt < 6 && own === null; attempt++) {
      await p.goto(ORIGIN + '/');
      await p.evaluate(watcher);
      await p.click('#btn-deal-in');
      await p.waitForSelector('#action-bar .bid-go', { timeout: 30000 });
      for (const c of await p.$$('#action-bar .chipbtn')) if ((await c.textContent()).trim() === '7' && !(await c.isDisabled())) await c.click();
      const bid = await p.$('#action-bar .bid-go .btn.primary:not(.nt):not(:disabled)');
      if (!bid) continue;
      await bid.click();
      const got = await p.waitForSelector('#action-bar .suit-pick', { timeout: 15000 }).then(() => true).catch(() => false);
      if (!got) continue;
      await p.click('#action-bar .suit-pick.suit-S');
      await p.click('#action-bar .chipbtn:has-text("Uptown")');
      await p.click('#action-bar > .btn.primary');
      await p.waitForTimeout(450);
      await p.screenshot({ path: `${OUTDIR}/${name}-own-call.png` });
      await p.waitForFunction(() => window.__t.hides.length > 0, null, { timeout: 8000 }).catch(() => {});
      const t3 = await p.evaluate(() => window.__t);
      own = { text: t3.text || '', dur: (t3.hides[0] - t3.shows[0]) / 1000 };
    }
    check(`${name}: your own call gets a short confirmation (${own ? own.dur.toFixed(2) : '?'}s, "${own ? own.text.split('\n')[0] : ''}")`, own && /You call it/i.test(own.text) && own.dur < 1.8);
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
