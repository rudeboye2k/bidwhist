// US federal holiday dates and decoration windows.
// Run: node tests/holidays.test.js
'use strict';
const H = require('../js/holidays.js');

let fails = 0;
const check = (name, ok) => { if (!ok) { fails++; console.error('FAIL ' + name); } else console.log('ok   ' + name); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const on = (s) => { const [y, m, d] = s.split('-').map(Number); return H.holidayOn(new Date(y, m - 1, d, 12)); };

// Known dates (checked against the OPM federal holiday calendars).
const KNOWN = {
  2026: { newyear: '2026-01-01', mlk: '2026-01-19', presidents: '2026-02-16', memorial: '2026-05-25', juneteenth: '2026-06-19',
    july4: '2026-07-04', labor: '2026-09-07', columbus: '2026-10-12', veterans: '2026-11-11', thanksgiving: '2026-11-26', christmas: '2026-12-25' },
  2027: { mlk: '2027-01-18', presidents: '2027-02-15', memorial: '2027-05-31', labor: '2027-09-06', columbus: '2027-10-11', thanksgiving: '2027-11-25' },
  2028: { mlk: '2028-01-17', presidents: '2028-02-21', memorial: '2028-05-29', labor: '2028-09-04', columbus: '2028-10-09', thanksgiving: '2028-11-23' },
};
for (const [year, want] of Object.entries(KNOWN)) {
  const got = Object.fromEntries(H.datesIn(+year).map((h) => [h.id, ymd(h.date)]));
  for (const [id, date] of Object.entries(want)) check(`${year} ${id} is ${date}`, got[id] === date);
}
check('all 11 federal holidays are listed', H.LIST.length === 11);

// Decoration windows.
check('Thanksgiving Day itself', (on('2026-11-26') || {}).id === 'thanksgiving');
check('Thanksgiving week: Monday before', (on('2026-11-23') || {}).id === 'thanksgiving');
check('Thanksgiving week: Sunday after', (on('2026-11-29') || {}).id === 'thanksgiving');
check('not the week before Thanksgiving', on('2026-11-19') === null);
check('Christmas from the 18th', (on('2026-12-18') || {}).id === 'christmas');
check('…through the 26th', (on('2026-12-26') || {}).id === 'christmas');
check('nothing on Dec 28', on('2026-12-28') === null);
check("New Year's Eve shows next year's New Year", (on('2026-12-31') || {}).id === 'newyear');
check("New Year's Day", (on('2027-01-01') || {}).id === 'newyear');
check('Fourth of July from July 1', (on('2026-07-01') || {}).id === 'july4');
check('Memorial Day weekend (Saturday)', (on('2026-05-23') || {}).id === 'memorial');
check('an ordinary day has no decorations', on('2026-03-10') === null);
check('every holiday has a greeting, garland and emblem', H.LIST.every((h) => h.greeting && h.emoji.length >= 3 && h.emblem && h.colors.length === 2));

console.log(fails ? `\n${fails} failure(s)` : '\nAll holiday tests passed.');
process.exit(fails ? 1 : 0);
