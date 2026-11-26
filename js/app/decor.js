/* Give Me Da Kitty — decor.js
 * Holiday decorations for US federal holidays (dates and scenes: js/holidays.js).
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// Each holiday dresses the room in layers, all of them beneath the cards and
// none of them catching taps:
//   · a strand along the header — swaying bunting or twinkling bulbs, with a
//     few holiday ornaments hanging from it;
//   · a ring of twinkling lights around the table rail (bulb holidays);
//   · an ambient effect — fireworks, snow, falling leaves or twinkling stars —
//     in the page background and on the felt under the cards;
//   · a showpiece on the start screen: a floating emblem, a shimmering
//     greeting and the effect playing behind it;
//   · win confetti in the holiday's colours (with themed pieces mixed in).
// Days of remembrance (Memorial Day, Veterans Day, MLK Day) stay gentle: stars
// and bunting, no fireworks or emoji confetti. "Reduce motion" gets the
// decorations without the movement.
// On by default; Table Rules → Look & sound turns it off. For a preview, add
// ?holiday=<id> to the address (e.g. ?holiday=july4), or ?holiday=off.
const HOLIDAY_PREF = 'bidwhist.holidays';
const Decor = { holiday: null, timers: [], resizeTimer: null };

function holidaysOn() {
  try { return localStorage.getItem(HOLIDAY_PREF) !== 'off'; } catch (_) { return true; }
}
function setHolidaysOn(on) {
  try { localStorage.setItem(HOLIDAY_PREF, on ? 'on' : 'off'); } catch (_) { /* ignore */ }
  applyHoliday();
}

// Which holiday to show right now (null = none).
// The Table Rules switch always wins; a ?holiday= preview only picks which one.
function currentHoliday() {
  if (!holidaysOn()) return null;
  const q = new URLSearchParams(location.search).get('holiday');
  if (q === 'off') return null;
  if (q && Holidays.byId(q)) return Holidays.byId(q);
  return Holidays.holidayOn(new Date());
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const el = (cls, parent, text) => {
  const d = document.createElement('div');
  d.className = cls;
  d.setAttribute('aria-hidden', 'true');
  if (text != null) d.textContent = text;
  if (parent) parent.appendChild(d);
  return d;
};
const small = () => window.innerWidth <= 600;

function clearHoliday() {
  for (const t of Decor.timers) clearInterval(t);
  Decor.timers = [];
  for (const n of document.querySelectorAll('.hol')) n.remove();
  document.documentElement.removeAttribute('data-holiday');
  document.querySelector('.topbar').classList.remove('holiday');
  Decor.holiday = null;
}

function applyHoliday() {
  clearHoliday();
  const h = currentHoliday();
  if (!h) return;
  Decor.holiday = h;
  const root = document.documentElement;
  root.setAttribute('data-holiday', h.id);
  root.style.setProperty('--hol-a', h.palette[0]);
  root.style.setProperty('--hol-b', h.palette[1]);
  root.style.setProperty('--hol-c', h.palette[2] || h.palette[0]);

  buildStrand(h);
  if (h.lights === 'bulbs') buildRailLights(h);
  // Ambient effect: behind the whole page, on the felt (under the cards), and behind the start screen card.
  const back = el('hol hol-fx hol-fx-page');
  document.body.insertBefore(back, document.body.firstChild);
  const felt = el('hol hol-fx hol-fx-felt');
  document.querySelector('#table .rail').insertAdjacentElement('afterend', felt);
  const splash = el('hol hol-fx hol-fx-splash');
  $('splash').insertBefore(splash, $('splash').firstChild);
  for (const [layer, n] of [[back, 1], [felt, 0.4], [splash, 0.7]]) startEffect(h, layer, n);

  // Faint emblem in the open felt.
  const emblem = el('hol holiday-emblem', null, h.emblem);
  felt.insertAdjacentElement('afterend', emblem);

  // Start screen showpiece.
  const hero = el('hol holiday-hero');
  el('hero-emblem', hero, h.emblem);
  const g = el('hero-greeting', hero, h.greeting);
  g.setAttribute('aria-hidden', 'false');
  const kicker = document.querySelector('.splash-kicker');
  kicker.parentNode.insertBefore(hero, kicker);
}

// ---- the strand along the header -------------------------------------------
function buildStrand(h) {
  const top = document.querySelector('.topbar');
  top.classList.add('holiday');
  const strand = el(`hol hol-strand hol-${h.lights}`, top);
  const w = top.getBoundingClientRect().width || window.innerWidth;
  const step = h.lights === 'bulbs' ? 26 : 30;
  const n = Math.max(8, Math.floor(w / step));
  const ornamentEvery = small() ? 7 : 9;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 100;
    // The strand sags between two hooks: a shallow curve across the bar.
    const sag = Math.sin(((i + 0.5) / n) * Math.PI * (small() ? 2 : 4));
    const y = 2 + Math.abs(sag) * 6;
    const colour = h.palette[i % h.palette.length];
    const ornament = h.emoji && i % ornamentEvery === Math.floor(ornamentEvery / 2);
    const item = el(ornament ? 'ornament' : h.lights === 'bulbs' ? 'bulb' : 'flag', strand, ornament ? h.emoji[(i / ornamentEvery | 0) % h.emoji.length] : null);
    item.style.left = x + '%';
    item.style.top = y + 'px';
    item.style.setProperty('--c', colour);
    item.style.animationDelay = (-(i * 0.37) % 3).toFixed(2) + 's';
  }
  // Rebuild when the header changes width (rotation, resize).
  window.removeEventListener('resize', onDecorResize);
  window.addEventListener('resize', onDecorResize);
}
function onDecorResize() {
  clearTimeout(Decor.resizeTimer);
  Decor.resizeTimer = setTimeout(() => {
    if (!Decor.holiday) return;
    for (const n of document.querySelectorAll('.hol-strand, .hol-rail')) n.remove();
    buildStrand(Decor.holiday);
    if (Decor.holiday.lights === 'bulbs') buildRailLights(Decor.holiday);
  }, 200);
}

// ---- lights around the table rail ------------------------------------------
function buildRailLights(h) {
  const table = $('table');
  const ring = el('hol hol-rail');
  table.querySelector('.rail').insertAdjacentElement('afterend', ring);
  const r = table.getBoundingClientRect();
  const W = r.width - 12, H = r.height - 12;
  const per = Math.max(24, Math.round((W + H) * 2 / 34));
  // Walk the rectangle's perimeter, placing a bulb every so often.
  for (let i = 0; i < per; i++) {
    let d = (i / per) * 2 * (W + H), x, y;
    if (d < W) { x = d; y = 0; } else if ((d -= W) < H) { x = W; y = d; } else if ((d -= H) < W) { x = W - d; y = H; } else { d -= W; x = 0; y = H - d; }
    const b = el('rail-bulb', ring);
    b.style.left = (6 + x) + 'px';
    b.style.top = (6 + y) + 'px';
    b.style.setProperty('--c', h.palette[i % h.palette.length]);
    b.style.animationDelay = (-(i % 5) * 0.6).toFixed(1) + 's';
  }
}

// ---- ambient effects --------------------------------------------------------
function startEffect(h, layer, density) {
  const calm = reduceMotion();
  const scale = (small() ? 0.6 : 1) * density;
  if (h.fx === 'fireworks') {
    if (calm) return sprinkleStars(h, layer, Math.round(18 * scale));
    const burst = () => { if (!document.hidden && layer.isConnected) firework(h, layer); };
    burst(); setTimeout(burst, 700);
    Decor.timers.push(setInterval(burst, Math.round(rand(1700, 2400) / Math.max(0.5, density))));
    sprinkleStars(h, layer, Math.round(10 * scale));
  } else if (h.fx === 'snow') {
    const n = Math.round(44 * scale);
    for (let i = 0; i < n; i++) {
      const f = el('flake', layer);
      const size = rand(2, 6);
      Object.assign(f.style, { left: rand(0, 100) + '%', width: size + 'px', height: size + 'px', opacity: rand(0.45, 0.95).toFixed(2),
        animationDuration: rand(9, 18).toFixed(1) + 's', animationDelay: (-rand(0, 18)).toFixed(1) + 's' });
      f.style.setProperty('--drift', rand(-40, 40).toFixed(0) + 'px');
    }
  } else if (h.fx === 'leaves') {
    const n = Math.round(16 * scale);
    const shapes = ['🍂', '🍁', '🍂', '🍃'];
    for (let i = 0; i < n; i++) {
      const lf = el('leaf', layer, pick(shapes));
      Object.assign(lf.style, { left: rand(0, 100) + '%', fontSize: rand(14, 26).toFixed(0) + 'px',
        animationDuration: rand(11, 20).toFixed(1) + 's', animationDelay: (-rand(0, 20)).toFixed(1) + 's' });
      lf.style.setProperty('--drift', rand(-90, 90).toFixed(0) + 'px');
      lf.style.setProperty('--spin', (rand(-1, 1) > 0 ? 1 : -1) * rand(180, 540) + 'deg');
    }
  } else {
    sprinkleStars(h, layer, Math.round(30 * scale));
  }
}

function sprinkleStars(h, layer, n) {
  for (let i = 0; i < n; i++) {
    const s = el('twinkle', layer, i % 3 ? '✦' : '★');
    Object.assign(s.style, { left: rand(0, 100) + '%', top: rand(0, 100) + '%', fontSize: rand(7, 16).toFixed(0) + 'px',
      color: h.palette[i % h.palette.length], animationDuration: rand(2.4, 4.8).toFixed(1) + 's', animationDelay: (-rand(0, 5)).toFixed(1) + 's' });
  }
}

// One firework: a spark climbs, then bursts into a ring of sparks that fall and fade.
function firework(h, layer) {
  const r = layer.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = rand(0.12, 0.88) * r.width, y = rand(0.12, 0.5) * r.height;
  const colour = pick(h.palette.filter((c) => c !== '#1d1d1d')) || '#fff';
  const boom = el('boom', layer);
  boom.style.left = x + 'px'; boom.style.top = y + 'px';
  boom.style.setProperty('--c', colour);
  boom.style.setProperty('--rise', Math.round(r.height - y) + 'px');
  const n = small() ? 14 : 20, reach = rand(50, 95) * (small() ? 0.75 : 1);
  for (let i = 0; i < n; i++) {
    const s = el('spark', boom);
    const a = (i / n) * Math.PI * 2;
    s.style.setProperty('--dx', (Math.cos(a) * reach).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * reach).toFixed(1) + 'px');
  }
  setTimeout(() => boom.remove(), 2300);
}

// Win confetti in the holiday's colours (themed pieces unless it's a solemn day).
function holidayConfetti() {
  const h = Decor.holiday;
  return h ? { colors: h.palette, pieces: h.solemn ? [] : (h.pieces || []) } : null;
}
