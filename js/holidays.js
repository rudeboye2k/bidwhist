/*
 * US federal holidays (5 U.S.C. 6103) and the table decorations for each.
 * Pure date logic — no DOM — so it runs in the browser (global `Holidays`)
 * and in Node for tests. Dates are local calendar dates (the player's own day).
 *
 * Each holiday shows its decorations for a short window: `before` days ahead
 * of the date through `after` days past it (e.g. Thanksgiving week, Christmas
 * from the 18th). Fixed dates are decorated on the date itself, not on the
 * weekday the government observes them.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Holidays = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // n-th weekday (0 = Sunday) of a month; n = -1 for the last one.
  function nthWeekday(year, month, weekday, n) {
    if (n > 0) {
      const first = new Date(year, month, 1).getDay();
      return new Date(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
    }
    const lastDay = new Date(year, month + 1, 0);
    return new Date(year, month, lastDay.getDate() - ((lastDay.getDay() - weekday + 7) % 7));
  }

  const MON = 1, THU = 4;
  // id, name, date rule, decoration window, greeting, emoji (garland + emblem), accent colours.
  const LIST = [
    { id: 'newyear', name: "New Year's Day", date: (y) => new Date(y, 0, 1), before: 1, after: 0,
      greeting: 'Happy New Year!', emoji: ['🎉', '🥂', '✨', '🎊'], emblem: '🎉', colors: ['#f0cd78', '#e8e8f0'] },
    { id: 'mlk', name: 'Martin Luther King Jr. Day', date: (y) => nthWeekday(y, 0, MON, 3), before: 2, after: 0,
      greeting: 'Honoring Dr. Martin Luther King Jr.', emoji: ['✊🏾', '🕊️', '⭐'], emblem: '🕊️', colors: ['#f0cd78', '#9fc4ff'] },
    { id: 'presidents', name: "Washington's Birthday (Presidents' Day)", date: (y) => nthWeekday(y, 1, MON, 3), before: 2, after: 0,
      greeting: "Happy Presidents' Day!", emoji: ['🇺🇸', '🏛️', '⭐'], emblem: '🏛️', colors: ['#c8423a', '#3a5fb0'] },
    { id: 'memorial', name: 'Memorial Day', date: (y) => nthWeekday(y, 4, MON, -1), before: 2, after: 0,
      greeting: 'Memorial Day — we remember.', emoji: ['🇺🇸', '🕊️', '⭐'], emblem: '🇺🇸', colors: ['#c8423a', '#3a5fb0'] },
    { id: 'juneteenth', name: 'Juneteenth National Independence Day', date: (y) => new Date(y, 5, 19), before: 1, after: 0,
      greeting: 'Happy Juneteenth!', emoji: ['✊🏾', '⭐', '🎉', '❤️', '🖤', '💚'], emblem: '✊🏾', colors: ['#c8423a', '#2f8f4e'] },
    { id: 'july4', name: 'Independence Day', date: (y) => new Date(y, 6, 4), before: 3, after: 0,
      greeting: 'Happy Fourth of July!', emoji: ['🎆', '🇺🇸', '🎇', '⭐'], emblem: '🎆', colors: ['#c8423a', '#3a5fb0'] },
    { id: 'labor', name: 'Labor Day', date: (y) => nthWeekday(y, 8, MON, 1), before: 2, after: 0,
      greeting: 'Happy Labor Day!', emoji: ['🛠️', '🌭', '🇺🇸'], emblem: '🛠️', colors: ['#c8423a', '#3a5fb0'] },
    { id: 'columbus', name: "Columbus Day / Indigenous Peoples' Day", date: (y) => nthWeekday(y, 9, MON, 2), before: 2, after: 0,
      greeting: "Happy Indigenous Peoples' Day & Columbus Day!", emoji: ['🍂', '🍁', '🌽'], emblem: '🍁', colors: ['#d9822b', '#a0522d'] },
    { id: 'veterans', name: 'Veterans Day', date: (y) => new Date(y, 10, 11), before: 1, after: 0,
      greeting: 'Thank you, veterans.', emoji: ['🇺🇸', '🎖️', '⭐'], emblem: '🎖️', colors: ['#c8423a', '#3a5fb0'] },
    { id: 'thanksgiving', name: 'Thanksgiving Day', date: (y) => nthWeekday(y, 10, THU, 4), before: 3, after: 3,
      greeting: 'Happy Thanksgiving!', emoji: ['🦃', '🍂', '🥧', '🌽'], emblem: '🦃', colors: ['#d9822b', '#a0522d'] },
    { id: 'christmas', name: 'Christmas Day', date: (y) => new Date(y, 11, 25), before: 7, after: 1,
      greeting: 'Merry Christmas!', emoji: ['🎄', '🎁', '❄️', '⭐'], emblem: '🎄', colors: ['#c8423a', '#2f8f4e'] },
  ];

  const DAY = 24 * 60 * 60 * 1000;
  const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Whole days from a to b (both local dates), safe across daylight-saving changes.
  const daysBetween = (a, b) => Math.round((dayOnly(b) - dayOnly(a)) / DAY);

  // The holiday whose decoration window covers `date` (default: today), or null.
  function holidayOn(date) {
    const d = dayOnly(date || new Date());
    for (const y of [d.getFullYear(), d.getFullYear() + 1]) {
      for (const h of LIST) {
        const when = h.date(y);
        const diff = daysBetween(when, d); // negative = before the holiday
        if (diff >= -h.before && diff <= h.after) return Object.assign({}, h, { when });
      }
    }
    return null;
  }

  function byId(id) { return LIST.find((h) => h.id === id) || null; }

  // Every federal holiday's date in a year (for tests and docs).
  function datesIn(year) { return LIST.map((h) => ({ id: h.id, name: h.name, date: h.date(year) })); }

  return { LIST, holidayOn, byId, datesIn, nthWeekday };
});
