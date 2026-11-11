// Daily Deal: play today's hand, post the score, see it on the board; review
// the hand book by book; the button turns into "see the board" once played.
const { chromium, devices } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

// Play whatever's legal until the hand is over.
async function playHand(p) {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    if (await p.isVisible('#modal-summary.show')) return true;
    if (await p.$('#action-bar .bid-go')) {
      const passBtn = await p.$('#action-bar .bid-go .btn.ghost:not(:disabled)');
      await (passBtn || await p.$('#action-bar .bid-go .btn.primary:not(:disabled)')).click();
    } else if (await p.$('#action-bar .suit-pick')) {
      await p.click('#action-bar .suit-pick');
      await p.click('#action-bar .chipbtn.wide:not(.suit-pick)');
      await p.click('#action-bar > .btn.primary');
    } else if (await p.$('#action-bar .chipbtn.wide')) {
      await p.click('#action-bar .chipbtn.wide');
    } else if (await p.$('#btn-discard-done')) {
      await p.click('#action-bar .btn.ghost');
      await p.click('#btn-discard-done');
    } else if (/Your play/.test(await p.textContent('#action-bar'))) {
      await p.$eval('#hand .card:not(.disabled)', (e) => e.click()).catch(() => {});
    }
    await p.waitForTimeout(250);
  }
  return false;
}

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desk', { viewport: { width: 1366, height: 768 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript((n) => {
      try { localStorage.setItem('bidwhist.sound', 'off'); localStorage.setItem('bidwhist.profile', JSON.stringify({ name: n, avatar: 'cat' })); } catch (_) {}
    }, 'Daily ' + name);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(ORIGIN + '/');
    await p.click('#btn-daily');
    await p.waitForSelector('#modal-daily.show');
    await p.waitForFunction(() => !/Loading/.test(document.getElementById('daily-board').textContent));
    check(`${name}: the Daily Deal opens with a Deal button`, await p.isVisible('#btn-daily-play'));
    await p.screenshot({ path: `${OUT}/daily-${name}-open.png` });
    await p.click('#btn-daily-play');
    const done = await playHand(p);
    check(`${name}: today's hand plays to the end`, done);
    check(`${name}: the summary offers the leaderboard`, /Leaderboard/i.test(await p.textContent('#btn-next-hand')));
    // review the hand
    check(`${name}: "Review the hand" is offered`, await p.isVisible('#btn-review-hand'));
    await p.click('#btn-review-hand');
    const first = await p.textContent('#lastbook-title');
    check(`${name}: review starts at book 1 (${first})`, /^Book 1 of 1[23]$/.test(first));
    check(`${name}: four cards shown, one winner`, (await p.$$('#lastbook .lb-spot')).length === 4 && (await p.$$('#lastbook .lb-spot.won')).length === 1);
    check(`${name}: can't go before book 1`, await p.isDisabled('#btn-review-prev'));
    for (let i = 0; i < 13; i++) if (!(await p.isDisabled('#btn-review-next'))) await p.click('#btn-review-next');
    const last = await p.textContent('#lastbook-title');
    check(`${name}: steps through to the last book (${last})`, /^Book (1[23]) of \1$/.test(last) && await p.isDisabled('#btn-review-next'));
    await p.screenshot({ path: `${OUT}/daily-${name}-review.png` });
    await p.click('#btn-lastbook-done');
    check(`${name}: back on the summary after the review`, await p.isVisible('#modal-summary.show'));
    // post + board
    await p.click('#btn-next-hand');
    await p.waitForSelector('#modal-daily.show');
    await p.waitForFunction(() => !/Loading/.test(document.getElementById('daily-board').textContent));
    await p.waitForTimeout(300);
    const mine = await p.$('#daily-board li.you .r-name');
    check(`${name}: your score is on today's board`, !!mine && (await mine.textContent()) === 'Daily ' + name);
    check(`${name}: no second try today`, !(await p.isVisible('#btn-daily-play')));
    check(`${name}: note shows your score`, /You scored [+-]?\d+ today/.test(await p.textContent('#daily-note')));
    await p.screenshot({ path: `${OUT}/daily-${name}-board.png` });
    // reload: the splash button opens the board, still no replay
    await p.reload();
    await p.click('#btn-daily');
    await p.waitForSelector('#modal-daily.show');
    check(`${name}: after a reload it's still one try`, !(await p.isVisible('#btn-daily-play')));
    check(`${name}: no page errors`, errs.length === 0);
    if (errs.length) console.log(errs);
    await ctx.close();
  }
  // Same cards for everyone: two fresh players get the same first hand.
  const hands = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
    const p = await ctx.newPage();
    await p.goto(ORIGIN + '/');
    await p.click('#btn-daily');
    await p.click('#btn-daily-play');
    await p.waitForFunction(() => document.querySelectorAll('#hand .card').length >= 12);
    hands.push(await p.$$eval('#hand .card', (xs) => xs.map((x) => x.textContent.trim()).join(',')));
    await ctx.close();
  }
  check('everyone gets the same cards today', hands[0] === hands[1] && hands[0].length > 10);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
