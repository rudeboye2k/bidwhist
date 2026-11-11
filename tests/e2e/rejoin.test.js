// Rejoin: close the tab mid-game, come back, one tap gets your seat back.
const { chromium } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('bidwhist.sound', 'off'); localStorage.setItem('bidwhist.profile', JSON.stringify({ name: 'Rejoiner', avatar: 'cat' })); } catch (_) {}
  });
  const errs = [];
  const open = async () => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto(ORIGIN + '/'); return pg; };

  let p = await open();
  check('no rejoin button before you have played online', !(await p.isVisible('#btn-rejoin')));
  await p.click('#btn-play-online');
  await p.click('#btn-host');
  await p.waitForSelector('#modal-lobby.show', { timeout: 20000 });
  const code = (await p.textContent('#lobby-code')).trim();
  await p.click('#btn-start-online');
  await p.waitForFunction(() => document.querySelectorAll('#hand .card').length >= 12, null, { timeout: 20000 });
  await p.close(); // tab closed mid-game

  p = await open();
  check(`splash offers "Back to table ${code}"`, await p.isVisible('#btn-rejoin') && (await p.textContent('#rejoin-code')) === code);
  await p.screenshot({ path: `${OUT}/rejoin-splash.png` });
  await p.click('#btn-rejoin');
  // While you were gone a bot played your seat, so the hand may be over:
  // the result comes up, and as host you can deal the next one.
  await p.waitForFunction(() => document.querySelectorAll('#hand .card:not(.back)').length >= 1
    || document.getElementById('modal-summary').classList.contains('show'), null, { timeout: 20000 });
  check('back in your own seat', /Rejoiner/.test(await p.textContent('#plate-0')));
  check('still the host', await p.evaluate(() => !!(G.view && G.view.hostToken)));
  if (await p.isVisible('#modal-summary.show')) {
    check('between hands: the result shows with a Deal button', !(await p.isDisabled('#btn-next-hand')));
    await p.click('#btn-next-hand');
  }
  await p.waitForFunction(() => document.querySelectorAll('#hand .card:not(.back)').length >= 12, null, { timeout: 20000 });
  check('playing again with a fresh hand', true);

  // Leaving the table forgets it.
  {
    await p.evaluate(() => forgetTable());
    await p.close();
    p = await open();
    check('after leaving, no rejoin button', !(await p.isVisible('#btn-rejoin')));
  }
  check('no page errors', errs.length === 0);
  if (errs.length) console.log(errs);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
