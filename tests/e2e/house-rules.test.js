// Solo with house rules (no jokers, renege, sharp AI) + big cards: win the bid, bury four, see the renege button.
const { chromium, devices } = require('./helpers');
const { ORIGIN, WS, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('bidwhist.rules', JSON.stringify({ noJokers: true, renege: true, aiLevel: 'sharp' }));
        localStorage.setItem('bidwhist.bigCards', 'on'); localStorage.setItem('bidwhist.sound', 'off');
      } catch (_) {}
    });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(ORIGIN + '/');
    await p.click('#btn-deal-in');
    await p.waitForSelector('#action-bar .chipbtn', { timeout: 20000 });
    const jokers = await p.$$eval('#hand .card.joker', (x) => x.length);
    check(`${name}: no jokers dealt`, jokers === 0);
    for (const c of await p.$$('#action-bar .chipbtn')) if ((await c.textContent()).trim() === '7' && !(await c.isDisabled())) await c.click();
    const ok = await p.$('#action-bar .btn.primary:not(:disabled)');
    if (ok) await ok.click();
    // declare whatever is offered first
    await p.waitForFunction(() => /Name trump|which way|bury|Waiting|Your play/i.test(document.getElementById('action-bar').textContent), null, { timeout: 30000 });
    if (await p.$('#action-bar .suit-pick')) {
      await p.click('#action-bar .suit-pick');
      await p.click('#action-bar .chipbtn.wide:not(.suit-pick)');
      await p.click('#action-bar > .btn.primary');
    } else if (await p.$('#action-bar .chipbtn.wide')) await p.click('#action-bar .chipbtn.wide');
    const gotKitty = await p.waitForSelector('#btn-discard-done', { timeout: 8000 }).then(() => true).catch(() => false);
    if (gotKitty) {
      const label = await p.textContent('#btn-discard-done');
      const hand = await p.$$eval('#hand .card', (x) => x.length);
      check(`${name}: kitty is 4 cards → "Bury Four" with 16 in hand`, /Four/i.test(label) && hand === 16);
      await p.screenshot({ path: `${OUT}/house-${name}-discard.png` });
      await p.click('#action-bar .btn.ghost'); await p.click('#btn-discard-done');
      await p.waitForTimeout(1500);
      check(`${name}: 12 cards after burying four`, (await p.$$eval('#hand .card', (x) => x.length)) === 12);
    } else console.log(`(${name}: someone outbid 7 — skipping kitty checks)`);
    await p.waitForFunction(() => document.getElementById('trump-badge') && !document.getElementById('trump-badge').hidden, null, { timeout: 20000 }).catch(() => {});
    check(`${name}: "Call renege" button shown under the renege rule`, await p.isVisible('#btn-renege'));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/house-${name}-play.png` });
    const audit = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(`${name}: no sideways scroll with big cards`, audit);
    check(`${name}: no page errors`, errs.length === 0);
    await ctx.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
