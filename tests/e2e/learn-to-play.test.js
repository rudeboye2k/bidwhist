// Play the whole Learn-to-Play lesson like a student would.
const { chromium, devices } = require('./helpers');
const { ORIGIN, WS, OUT } = require('./helpers');
const OUTDIR = OUT + '/learn';
require('fs').mkdirSync(OUTDIR, { recursive: true });
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

async function runLesson(b, label, opts, finishForMe) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(ORIGIN + '/');
  await p.click('#btn-learn');
  const titles = [];
  const shots = new Set();
  let moves = 0, wrongTries = 0, done = false, autoOn = false, scoreSeen = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (await p.isVisible('#modal-lesson.show')) {
      const title = (await p.textContent('#lesson-title')).trim();
      if (titles[titles.length - 1] !== title) titles.push(title);
      const slug = title.replace(/[^a-z]+/gi, '-').toLowerCase().slice(0, 30);
      if (!shots.has(slug) && (label === 'phone' || shots.size < 40)) { shots.add(slug); await p.waitForTimeout(250); await p.screenshot({ path: `${OUTDIR}/${label}-${String(shots.size).padStart(2, '0')}-${slug}.png` }); }
      if (/made it|Set!|Boston/i.test(title)) scoreSeen = (await p.textContent('#score-us')).trim();
      if (/ready to play/i.test(title)) { done = true; break; }
      if (/hang of it/i.test(title) && finishForMe) { await p.click('#lesson-actions .btn:has-text("Finish the hand")'); autoOn = true; }
      else await p.click('#lesson-actions .btn.primary');
      await p.waitForTimeout(200);
      continue;
    }
    const tip = await p.$('#action-bar .lesson-tip');
    if (tip && !autoOn) {
      const bar = await p.textContent('#action-bar');
      if (await p.$('#action-bar .bid-go')) {
        // the student tries Pass first — it must be off
        if (!wrongTries) { wrongTries++; check(`${label}: Pass is switched off during the lesson bid`, await p.$eval('#action-bar .bid-go .btn.ghost', (x) => x.disabled)); }
        const amt = (await tip.textContent()).match(/Tap (\d)/)[1];
        await p.click(`#action-bar .chipbtn:text-is("${amt}")`);
        await p.click('#action-bar .bid-go .btn.primary:not(.nt)');
      } else if (await p.$('#action-bar .suit-pick')) {
        const disabled = await p.$$eval('#action-bar .suit-pick', (x) => x.filter((e) => e.disabled).length);
        check(`${label}: only the taught trump suit can be picked (${4 - disabled} enabled)`, disabled === 3);
        await p.click('#action-bar .suit-pick:not(:disabled)');
        await p.click('#action-bar .chipbtn.wide:not(.suit-pick):not(:disabled)');
        await p.click('#action-bar > .btn.primary');
      } else if (await p.$('#btn-discard-done')) {
        const outlined = await p.$$('#hand .card.coach');
        check(`${label}: six cards outlined to bury`, outlined.length === 6);
        for (let i = 0; i < 6; i++) await p.click('#hand .card.coach:not(.selected) >> nth=0', { force: true });
        await p.click('#btn-discard-done');
      } else if (/Play the/.test(bar)) {
        const lit = await p.$$('#hand .card:not(.disabled)');
        if (moves === 0) check(`${label}: on a play, only the taught card is playable (${lit.length})`, lit.length === 1);
        await p.click('#hand .card.coach', { force: true, timeout: 3000 }).catch(() => {});
        moves++;
      }
      await p.waitForTimeout(350);
      continue;
    }
    await p.waitForTimeout(150);
  }
  check(`${label}${finishForMe ? ' (finish for me)' : ''}: the lesson runs start to finish`, done);
  const want = ['Welcome to the table', 'How you win', 'How this lesson works', 'Your 12 cards', 'Your bid', 'You won it — give me da kitty!',
    'Pick Spades — and Uptown', 'Everyone knows the deal now', 'Bury six cards', 'You lead the first book'];
  check(`${label}: lessons come in teaching order`, want.every((w, i) => titles[i] === w));
  check(`${label}: covers follow suit, trumping, a joker, partner and scoring`,
    ['Follow suit', 'Out of the suit? Trump it!', 'Let your partner have it', 'You made it!'].every((w) => titles.includes(w) || finishForMe) &&
    titles.some((t) => /Joker/.test(t)));
  check(`${label}: the scoreboard shows the points during the scoring lesson (${scoreSeen})`, scoreSeen === '5');
  check(`${label}: no page errors`, errs.length === 0);
  if (errs.length) console.log(errs);
  console.log(`  ${label} lessons:`, titles.join(' → '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await runLesson(b, 'desk', { viewport: { width: 1366, height: 768 } }, false);
  await runLesson(b, 'phone', devices['iPhone 13'], false);
  await runLesson(b, 'auto', { viewport: { width: 1366, height: 768 } }, true);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
