// Play Lesson 2 (No-Trump & Downtown) like a student would.
const { chromium, devices } = require('./helpers');
const { ORIGIN, OUT } = require('./helpers');
const OUTDIR = OUT + '/learn2';
require('fs').mkdirSync(OUTDIR, { recursive: true });
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

async function runLesson(b, label, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bidwhist.sound', 'off'); } catch (_) {} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(ORIGIN + '/');
  // How to Play → Lesson 2
  await p.$eval('#splash', (e) => e.classList.remove('show'));
  await p.$eval('#btn-rules', (e) => e.click());
  await p.click('#btn-howto-learn2');
  const titles = [];
  const shots = new Set();
  let done = false, scoreSeen = null, bidLock = null, dirLock = null, buried = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (await p.isVisible('#modal-lesson.show')) {
      const title = (await p.textContent('#lesson-title')).trim();
      if (titles[titles.length - 1] !== title) titles.push(title);
      const slug = title.replace(/[^a-z]+/gi, '-').toLowerCase().slice(0, 30);
      if (!shots.has(slug)) { shots.add(slug); await p.waitForTimeout(250); await p.screenshot({ path: `${OUTDIR}/${label}-${String(shots.size).padStart(2, '0')}-${slug}.png` }); }
      if (/made it|Set!|Boston/i.test(title)) scoreSeen = (await p.textContent('#score-us')).trim();
      if (/^No-Trump & Downtown$/.test(title)) { done = true; break; }
      if (/hang of it/i.test(title)) await p.click('#lesson-actions .btn:has-text("Finish the hand")');
      else await p.$eval('#lesson-actions .btn.primary', (e) => e.click());
      await p.waitForTimeout(200);
      continue;
    }
    const tip = await p.$('#action-bar .lesson-tip');
    if (tip) {
      if (await p.$('#action-bar .bid-go')) {
        bidLock = await p.$$eval('#action-bar .bid-go .btn', (xs) => xs.map((x) => x.textContent.trim() + (x.disabled ? ':off' : ':on')).join(' | '));
        const amt = (await tip.textContent()).match(/Tap (\d)/)[1];
        await p.click(`#action-bar .chipbtn:text-is("${amt}")`);
        await p.click('#action-bar .bid-go .btn.primary.nt');
      } else if (await p.$('#action-bar .chipbtn.wide')) {
        dirLock = await p.$$eval('#action-bar .chipbtn.wide', (xs) => xs.map((x) => x.textContent.trim() + (x.disabled ? ':off' : ':on')).join(' | '));
        await p.click('#action-bar .chipbtn.wide:not(:disabled)');
      } else if (await p.$('#btn-discard-done')) {
        buried = await p.$$eval('#hand .card.coach', (xs) => xs.length);
        for (let i = 0; i < 6; i++) await p.click('#hand .card.coach:not(.selected) >> nth=0', { force: true });
        await p.click('#btn-discard-done');
      } else if (/Play the/.test(await p.textContent('#action-bar'))) {
        await p.click('#hand .card.coach', { force: true, timeout: 3000 }).catch(() => {});
      }
      await p.waitForTimeout(350);
      continue;
    }
    await p.waitForTimeout(150);
  }
  check(`${label}: lesson 2 runs start to finish`, done);
  check(`${label}: only "Bid 3 No-Trump" is allowed (${bidLock})`, /Bid 3:off \| Bid 3 No-Trump:on \| Pass:off/.test(bidLock || ''));
  check(`${label}: only Downtown can be called (${dirLock})`, /Uptown.*:off \| Downtown.*:on/.test(dirLock || ''));
  check(`${label}: six cards outlined to bury`, buried === 6);
  const want = ['No-Trump: no boss suit', 'Downtown: low cards win', 'Your 12 cards', 'Everyone passed — and you’re the dealer',
    'Call it Downtown', 'Everyone knows the deal now', 'You won it — give me da kitty!', 'Bury six cards', 'You lead the first book'];
  check(`${label}: lessons come in teaching order`, want.every((w, i) => titles[i] === w));
  check(`${label}: covers the joker throw-off and scoring`, titles.some((t) => /worth nothing here/.test(t)) && titles.includes('You made it!'));
  check(`${label}: No-Trump scores double (${scoreSeen})`, scoreSeen === '6');
  check(`${label}: no page errors`, errs.length === 0);
  if (errs.length) console.log(errs);
  console.log(`  ${label} lessons:`, titles.join(' → '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await runLesson(b, 'desk', { viewport: { width: 1366, height: 768 } });
  await runLesson(b, 'phone', devices['iPhone 13']);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
