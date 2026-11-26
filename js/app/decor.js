/* Give Me Da Kitty — decor.js
 * Holiday decorations for US federal holidays (dates and themes: js/holidays.js).
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// A garland along the header, a greeting on the start screen and a faint
// emblem on the felt — all drawn underneath the cards, with no layout shift.
// On by default; Table Rules → Look & sound turns it off. For a preview, add
// ?holiday=<id> to the address (e.g. ?holiday=july4), or ?holiday=off.
const HOLIDAY_PREF = 'bidwhist.holidays';

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

function applyHoliday() {
  for (const el of document.querySelectorAll('.holiday-garland, .holiday-emblem, .holiday-greeting')) el.remove();
  const root = document.documentElement;
  root.removeAttribute('data-holiday');
  document.querySelector('.topbar').classList.remove('holiday');
  const h = currentHoliday();
  if (!h) return;
  root.setAttribute('data-holiday', h.id);
  root.style.setProperty('--hol-a', h.colors[0]);
  root.style.setProperty('--hol-b', h.colors[1]);

  // Garland: the holiday's emoji, repeated along the bottom edge of the header.
  const garland = document.createElement('div');
  garland.className = 'holiday-garland';
  garland.setAttribute('aria-hidden', 'true');
  garland.textContent = Array.from({ length: 40 }, (_, i) => h.emoji[i % h.emoji.length]).join(' ');
  const top = document.querySelector('.topbar');
  top.classList.add('holiday');
  top.appendChild(garland);

  // Emblem: one big, faint emoji in the open felt, beneath everything else.
  const emblem = document.createElement('div');
  emblem.className = 'holiday-emblem';
  emblem.setAttribute('aria-hidden', 'true');
  emblem.textContent = h.emblem;
  const rail = document.querySelector('#table .rail');
  rail.insertAdjacentElement('afterend', emblem);

  // Greeting on the start screen.
  const greet = document.createElement('p');
  greet.className = 'holiday-greeting';
  greet.textContent = `${h.emoji[0]} ${h.greeting} ${h.emoji[0]}`;
  const kicker = document.querySelector('.splash-kicker');
  kicker.parentNode.insertBefore(greet, kicker);
}
