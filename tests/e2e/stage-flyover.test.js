// The holiday start screen (fun days + federal holidays) and the first-book
// flyover during play.
const { chromium, devices } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
const stage = (p) => p.evaluate(() => ({
  title: (document.querySelector('.stage-title') || {}).textContent || '',
  chips: [...document.querySelectorAll('.stage-chip')].map((c) => c.textContent),
  table: document.documentElement.getAttribute('data-holiday'),
  canvas: !!document.querySelector('.stage-canvas'),
  sideways: document.documentElement.scrollWidth > innerWidth,
}));

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 800 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));

    // A fun day inside a federal holiday's window: fun day on stage, holiday on the table.
    await p.goto(ORIGIN + '/?date=2026-11-27');
    let s = await stage(p);
    check(`${name}: Nov 27 stage is Buy Nothing Day`, s.title === 'Buy Nothing Day' && s.canvas);
    check(`${name}: …the table keeps Thanksgiving week`, s.table === 'thanksgiving' && s.chips.some((c) => /Thanksgiving/.test(c)));
    check(`${name}: no sideways scroll`, !s.sideways);
    // The stage sits at the top of the screen (not hanging off it) and the menu is reachable.
    await p.waitForTimeout(1300); // after its 1s zoom-in entrance
    check(`${name}: stage starts on screen`, await p.$eval('.holiday-stage', (e) => e.getBoundingClientRect().top >= -1));
    await p.$eval('#btn-deal-in', (e) => e.scrollIntoView());
    check(`${name}: Play button reachable`, await p.isVisible('#btn-deal-in'));

    // Two fun days on one date.
    await p.goto(ORIGIN + '/?date=2026-12-05');
    s = await stage(p);
    check(`${name}: Dec 5 is Krampusnacht, Repeal Day also today`, s.title === 'Krampusnacht' && s.chips.some((c) => /Repeal Day/.test(c)));
    await p.screenshot({ path: `${OUT}/stage-${name}-dec5.png` });

    // Fun days can be switched off separately.
    await p.evaluate(() => setFunDaysOn(false));
    s = await stage(p);
    check(`${name}: fun days off → no stage on Dec 5`, !s.title && !s.table);
    await p.evaluate(() => setFunDaysOn(true));

    // Federal holiday on its day: holiday on stage.
    await p.goto(ORIGIN + '/?date=2026-12-25');
    s = await stage(p);
    check(`${name}: Christmas Day takes the stage`, s.title === 'Merry Christmas!' && s.chips.some((c) => /No “L”/.test(c)));

    // First book of the hand → flyover, which never blocks a tap.
    await p.goto(ORIGIN + '/?holiday=christmas');
    await p.evaluate(() => { window.__fly = []; const f = window.holidayFlyover; window.holidayFlyover = (id) => { window.__fly.push(id); return f(id); }; });
    await p.click('#btn-deal-in');
    const t0 = Date.now();
    let flew = false, during = null;
    while (Date.now() - t0 < 120000 && !flew) {
      if (await p.$('#action-bar .bid-go')) {
        const passBtn = await p.$('#action-bar .bid-go .btn.ghost:not(:disabled)');
        await (passBtn || await p.$('#action-bar .bid-go .btn.primary:not(:disabled)')).click();
      } else if (await p.$('#action-bar .suit-pick')) {
        await p.click('#action-bar .suit-pick'); await p.click('#action-bar .chipbtn.wide:not(.suit-pick)'); await p.click('#action-bar > .btn.primary');
      } else if (await p.$('#action-bar .chipbtn.wide')) await p.click('#action-bar .chipbtn.wide');
      else if (await p.$('#btn-discard-done')) { await p.click('#action-bar .btn.ghost'); await p.click('#btn-discard-done'); }
      else if (/Your play/.test(await p.textContent('#action-bar'))) await p.$eval('#hand .card:not(.disabled)', (e) => e.click()).catch(() => {});
      if ((await p.evaluate(() => window.__fly.length)) > 0) {
        flew = true;
        during = await p.evaluate(() => {
          const c = document.querySelector('canvas.flyover');
          return c ? { taps: getComputedStyle(c).pointerEvents } : null;
        });
      }
      await p.waitForTimeout(150);
    }
    check(`${name}: the first book sets off the Christmas flyover`, flew && (await p.evaluate(() => window.__fly[0])) === 'christmas');
    check(`${name}: the flyover lets taps through`, !during || during.taps === 'none');
    await p.waitForTimeout(4800);
    check(`${name}: …and cleans itself up`, !(await p.$('canvas.flyover')));
    check(`${name}: only once per hand`, (await p.evaluate(() => window.__fly.length)) === 1);
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
