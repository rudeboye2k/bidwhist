// Holiday decorations: on by default, previewable with ?holiday=, and the
// Table Rules switch turns them off (and the choice sticks).
const { chromium, devices } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
const decor = (p) => p.evaluate(() => ({
  id: document.documentElement.getAttribute('data-holiday'),
  garland: !!document.querySelector('.hol-strand'),
  emblem: !!document.querySelector('.holiday-emblem'),
  greeting: (document.querySelector('.hero-greeting') || {}).textContent || '',
  fx: !!document.querySelector('.hol-fx-page'),
}));

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(ORIGIN + '/?holiday=july4');
    let d = await decor(p);
    check(`${name}: preview shows the Fourth of July`, d.id === 'july4' && d.garland && d.emblem && d.fx && /Fourth of July/.test(d.greeting));
    await p.waitForTimeout(1200);
    check(`${name}: fireworks are going off`, (await p.$$('.hol-fx .boom')).length > 0);
    await p.screenshot({ path: `${OUT}/holiday-${name}-july4.png` });

    // The emblem never blocks a tap on the felt (it sits underneath).
    await p.click('#btn-deal-in');
    await p.waitForFunction(() => document.querySelectorAll('#hand .card').length >= 12);
    check(`${name}: decorations let taps through`, await p.$$eval('.hol', (xs) => xs.every((e) => getComputedStyle(e).pointerEvents === 'none')));
    // Nothing decorative sits on top of a card in your hand.
    check(`${name}: cards stay on top`, await p.$$eval('#hand .card', (cs) => cs.every((c) => {
      const r = c.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 8, r.top + 8);
      return e && e.closest('.card') === c;
    })));

    // Switch it off in Table Rules: decorations go, and stay gone on reload.
    await p.$eval('#btn-settings', (e) => e.click());
    check(`${name}: the switch is on by default`, await p.isChecked('#pref-holiday'));
    await p.$eval('#pref-holiday', (e) => e.click());
    d = await decor(p);
    check(`${name}: switching off removes the decorations`, !d.id && !d.garland && !d.emblem && !d.fx);
    await p.goto(ORIGIN + '/');
    d = await decor(p);
    check(`${name}: off stays off after a reload`, !d.id && !d.garland);
    await p.$eval('#btn-settings', (e) => e.click());
    check(`${name}: the switch shows off`, !(await p.isChecked('#pref-holiday')));
    await p.$eval('#pref-holiday', (e) => e.click());
    await p.goto(ORIGIN + '/?holiday=christmas');
    d = await decor(p);
    check(`${name}: switching back on brings them back`, d.id === 'christmas' && /Merry Christmas/.test(d.greeting));
    await p.goto(ORIGIN + '/?holiday=off');
    d = await decor(p);
    check(`${name}: ?holiday=off hides them for that visit`, !d.id);
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
