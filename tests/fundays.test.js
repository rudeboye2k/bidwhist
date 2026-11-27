// Fun & obscure days: dates, rule-based days, and how they share the stage
// with federal holidays. Run: node tests/fundays.test.js
'use strict';
const F = require('../js/fundays.js');
const H = require('../js/holidays.js');

let fails = 0;
const check = (name, ok) => { if (!ok) { fails++; console.error('FAIL ' + name); } else console.log('ok   ' + name); };
const at = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const ids = (s) => F.on(at(s)).map((f) => f.id);

check('about a hundred fun days', F.LIST.length >= 100);
check('ids are unique', new Set(F.LIST.map((f) => f.id)).size === F.LIST.length);
check('every day has a name, line, emblem, effect and palette',
  F.LIST.every((f) => f.name && f.line && f.emblem && ['float', 'bubbles', 'snow', 'stars', 'fireworks', 'leaves', 'confetti', 'rain'].includes(f.fx) && f.palette.length >= 3));

// Rule-based dates.
check('Buy Nothing Day 2026 is the day after Thanksgiving (Nov 27)', ids('2026-11-27').includes('buynothing'));
check('GivingTuesday 2026 is Dec 1', ids('2026-12-01').includes('givingtuesday'));
check('GivingTuesday 2027 is Nov 30', ids('2027-11-30').includes('givingtuesday'));
check('Krampusnacht and Repeal Day share Dec 5', ids('2026-12-05').join() === 'krampusnacht,repealday');
check('Bubble Wrap Day 2027 is the last Monday of January (Jan 25)', ids('2027-01-25').includes('bubblewrap'));
check('National Wear Red Day 2027 is the first Friday of February (Feb 5)', ids('2027-02-05').includes('wearred'));
check('Rattlesnake Roundup 2027 is the second Friday of March (Mar 12)', ids('2027-03-12').includes('rattlesnake'));
check('fixed dates: Tau Day is June 28', ids('2027-06-28').includes('tau'));
check('a plain day has none', ids('2027-03-03').length === 0);

// Sharing the stage with federal holidays.
let s = F.scene(at('2026-11-27'), H);
check('Nov 27: table keeps Thanksgiving week, stage is Buy Nothing Day', s.table.id === 'thanksgiving' && s.stage.id === 'buynothing' && s.also.some((x) => x.id === 'thanksgiving'));
s = F.scene(at('2026-11-26'), H);
check('Thanksgiving Day itself: Thanksgiving takes the stage', s.stage.id === 'thanksgiving');
s = F.scene(at('2026-12-25'), H);
check('Christmas Day: Christmas on stage, No-"L" Day as also-today', s.stage.id === 'christmas' && s.also.some((x) => x.id === 'noelday'));
s = F.scene(at('2026-12-18'), H);
check('Dec 18: Christmas lights on the table, the plunger on stage', s.table.id === 'christmas' && s.stage.id === 'plunger');
s = F.scene(at('2026-12-05'), H);
check('Dec 5: Krampusnacht on stage, Repeal Day also today', s.stage.id === 'krampusnacht' && s.also.map((x) => x.id).join() === 'repealday');
s = F.scene(at('2026-12-05'), H, false);
check('fun days switched off: nothing on Dec 5', !s.stage && !s.table);
s = F.scene(at('2027-03-03'), H);
check('ordinary day: nothing', !s.stage && !s.table && !s.also.length);

console.log(fails ? `\n${fails} failure(s)` : '\nAll fun-day tests passed.');
process.exit(fails ? 1 : 0);
