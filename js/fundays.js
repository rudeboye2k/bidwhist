/*
 * Fun & obscure days — a table of light-hearted observances (most from the
 * nationaltoday.com "obscure holidays" list, plus Buy Nothing Day,
 * GivingTuesday, Krampusnacht and Repeal Day). Pure data + date logic, no DOM:
 * the browser gets the global `FunDays`, Node gets module.exports.
 *
 * Each row: [id, month (1–12), day, name, emoji (first one is the emblem),
 *            scene effect, palette, line].
 * `day` is a number for fixed dates, or a rule for days that move:
 *   'mon-last' last Monday · 'fri1' first Friday · 'fri2' second Friday ·
 *   'tg+1' the day after Thanksgiving · 'tg+5' the Tuesday after Thanksgiving.
 * Effects: float (the emoji drift up), bubbles, snow, stars, fireworks, leaves,
 * confetti, rain. Month-long observances are marked on the 1st.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.FunDays = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PALETTES = {
    party: ['#ff5ea8', '#ffd23f', '#3ee7c9', '#8b6cff'],
    space: ['#8b6cff', '#3ee7c9', '#c4f1ff', '#ff5ea8'],
    nature: ['#7ed957', '#f5c542', '#3aa676', '#a3d9ff'],
    warm: ['#ff8a3d', '#ffd23f', '#ff5e5e', '#ffe3b3'],
    cool: ['#5aa9ff', '#c4f1ff', '#8b6cff', '#ffffff'],
    calm: ['#c9b7ff', '#9fe3d6', '#ffe8b0', '#ffffff'],
    dark: ['#b388ff', '#6a5acd', '#ff6b6b', '#e8e0ff'],
    red: ['#ff4d5e', '#ffb3ba', '#ffffff', '#c8102e'],
    money: ['#3ecf8e', '#f5c542', '#ffffff', '#2b8a5e'],
    pink: ['#ff6fb5', '#ffc2e2', '#ffffff', '#c13c86'],
    gold: ['#f0cd78', '#fff1c4', '#e8a33d', '#ffffff'],
  };

  const ROWS = [
    // ---- the four you asked for ----
    ['buynothing', 11, 'tg+1', 'Buy Nothing Day', '🛍️ 🚫 ✋ 🌱', 'float', 'calm', 'Skip the checkout line today. Deal a hand instead — it’s free.'],
    ['givingtuesday', 12, 'tg+5', 'GivingTuesday', '💝 🤝 🎁 ❤️', 'float', 'pink', 'A global day of generosity. Give a little — a gift, a hand, a kind word.'],
    ['krampusnacht', 12, 5, 'Krampusnacht', '👹 🔔 ❄️ 🌲', 'snow', 'dark', 'St. Nick’s horned sidekick is out tonight. Best play nice at the table.'],
    ['repealday', 12, 5, 'Repeal Day', '🍸 🎷 🥂 🎉', 'fireworks', 'gold', 'December 5, 1933: Prohibition ended. Raise a glass — responsibly.'],

    // ---- January ----
    ['mementomori', 1, 3, 'Memento Mori Day', '💀 🕯️ ⏳', 'stars', 'calm', '“Remember you die” — so play the good cards while you’ve got them.'],
    ['bubblewrap', 1, 'mon-last', 'Bubble Wrap Appreciation Day', '🫧 📦 💥', 'bubbles', 'cool', 'Pop. Pop. Pop. Go ahead — you’ve earned it.'],
    ['crapper', 1, 27, 'Thomas Crapper Day', '🚽 🧻 🛁', 'float', 'cool', 'Honoring the plumber who made the flush famous.'],
    ['inane', 1, 30, 'National Inane Answering Message Day', '📞 📼 🤪', 'float', 'party', 'Beep. Leave your weirdest voicemail after the tone.'],
    ['hellfreezing', 1, 31, 'Hell is Freezing Over Day', '🔥 ❄️ 🥶', 'snow', 'cool', 'It finally happened: the day the impossible came true.'],

    // ---- February ----
    ['sofa', 2, 1, 'Pull Your Sofa Off the Wall Month', '🛋️ 📏 🏠', 'float', 'warm', 'Give that couch some breathing room this month.'],
    ['sneeze', 2, 2, 'The Record of a Sneeze Day', '🤧 🎞️ 🎬', 'float', 'calm', 'In 1894 Edison filmed a sneeze. Bless you, Fred Ott.'],
    ['wearred', 2, 'fri1', 'National Wear Red Day', '❤️ 👗 ♥️', 'float', 'red', 'Wear red for heart health — red suits count too.'],
    ['et', 2, 9, 'Extraterrestrial Culture Day', '👽 🛸 🪐', 'stars', 'space', 'Greetings, Earthlings. Take us to your dealer.'],
    ['spilledmilk', 2, 11, 'Don’t Cry Over Spilled Milk Day', '🥛 🐄 😌', 'float', 'cool', 'Got set last hand? Wipe it up and deal again.'],
    ['differentname', 2, 13, 'Get a Different Name Day', '🏷️ ✍️ 🎭', 'float', 'party', 'Try on a new name today — change yours in Profile.'],
    ['cowflying', 2, 18, 'Cow Milked While Flying in an Airplane Day', '🐄 ✈️ 🥛', 'float', 'cool', 'Elm Farm Ollie, 1930: the first cow to fly — and be milked aloft.'],
    ['thumb', 2, 18, 'Thumb Appreciation Day', '👍 👍🏽 👍🏿', 'float', 'warm', 'Two thumbs up for the digits that tap your cards.'],
    ['tile', 2, 23, 'National Tile Day', '🧱 🔷 🔶', 'float', 'cool', 'Every grout line tells a story.'],
    ['petessake', 2, 26, 'For Pete’s Sake Day', '😤 🙄 🃏', 'float', 'party', 'For Pete’s sake — lead trump already!'],
    ['swordswallow', 2, 27, 'International Sword Swallowers Day', '🗡️ 🎪 😮', 'float', 'warm', 'Please do not try this at the card table.'],

    // ---- March ----
    ['umbrella', 3, 1, 'National Umbrella Month', '☂️ 🌂 🌧️', 'rain', 'cool', 'Rain or shine, the game goes on.'],
    ['debunking', 3, 11, 'Debunking Day', '🔍 🧐 ❌', 'float', 'calm', 'Myth: you can’t win from a weak hand. Busted.'],
    ['rattlesnake', 3, 'fri2', 'World’s Largest Rattlesnake Roundup', '🐍 🤠 🌵', 'float', 'warm', 'Sweetwater, Texas keeps it rattling every March.'],
    ['redefiningwealth', 3, 15, 'International Redefining Wealth Day', '💎 ❤️ 🤝', 'float', 'money', 'Real wealth: good friends around a good table.'],
    ['worldcontact', 3, 15, 'World Contact Day', '📡 👽 🌌', 'stars', 'space', 'Sending good vibes to the cosmos. Anybody out there?'],
    ['alienabduction', 3, 20, 'Alien Abduction Day', '🛸 👽 🐄', 'stars', 'space', 'If your partner vanishes mid-hand, check the sky.'],
    ['theatrechildren', 3, 20, 'World Day of Theatre for Children and Young People', '🎭 🧒 🎟️', 'confetti', 'party', 'Curtain up for the next generation of performers.'],
    ['colour', 3, 21, 'International Colour Day', '🌈 🎨 🖍️', 'confetti', 'party', 'Paint the table every colour of the rainbow.'],
    ['atheist', 3, 23, 'Atheist Day', '🔬 📚 💭', 'stars', 'calm', 'A day for reason, questions and good conversation.'],
    ['makeup', 3, 26, 'Make Up Your Own Holiday Day', '🎉 🤪 🃏', 'confetti', 'party', 'Today is officially Bid Whist Day. We said so.'],
    ['joe', 3, 27, 'National Joe Day', '☕ 👋 🧢', 'float', 'warm', 'Shout-out to every Joe at the table.'],
    ['scribble', 3, 27, 'Scribble Day', '✏️ 🖍️ 🌀', 'confetti', 'party', 'Doodle on the scorecard. Nobody’s checking.'],
    ['barnum', 3, 28, 'Barnum & Bailey Day', '🎪 🐘 🤹', 'confetti', 'party', 'Step right up to the greatest game on earth!'],

    // ---- April ----
    ['walkaround', 4, 4, 'National Walk Around Things Day', '🚶 🌳 🔄', 'float', 'nature', 'Take the long way around. Then come back and play.'],
    ['chakri', 4, 6, 'Chakri Day', '🇹🇭 👑 🏯', 'stars', 'gold', 'Thailand honors the founding of the Chakri dynasty.'],
    ['nohousework', 4, 7, 'National No Housework Day', '🧹 🚫 🛋️', 'float', 'party', 'The dishes can wait. The cards cannot.'],
    ['asmr', 4, 9, 'International ASMR Day', '🎧 ✨ 🫧', 'bubbles', 'calm', 'Listen… to the soft shuffle of the deck.'],
    ['nameyourself', 4, 9, 'National Name Yourself Day', '🏷️ 😎 ✨', 'float', 'party', 'Pick a name you love — set it in your Profile.'],
    ['submarine', 4, 11, 'National Submarine Day', '🚢 🌊 🐟', 'bubbles', 'cool', 'Dive deep — your trump is down there somewhere.'],
    ['wildguess', 4, 15, 'Take A Wild Guess Day', '🎲 ❓ 🤞', 'float', 'party', 'Bid seven blind. What could go wrong?'],
    ['foursquare', 4, 16, 'Foursquare Day', '4️⃣ 📍 🟦', 'confetti', 'party', 'Check in at the card table: four players, four squares.'],
    ['genius', 4, 16, 'National Reveal the Genius Within Day', '🧠 💡 ✨', 'stars', 'gold', 'Your inner genius knows exactly when to go Downtown.'],
    ['conversations', 4, 17, 'International Day of Mastering Conversations That Matter', '💬 🤝 💭', 'float', 'calm', 'Talk it out across the table today.'],
    ['keepoffgrass', 4, 21, 'Keep Off the Grass Day', '🌱 🚫 🌿', 'leaves', 'nature', 'Stay on the felt. The grass needs a break.'],
    ['richter', 4, 26, 'Richter Scale Day', '📈 🌍 💥', 'float', 'warm', 'Measure the shake when you run a Boston.'],
    ['woodywoodpecker', 4, 27, 'Woody Woodpecker Day', '🐦 🌲 🔨', 'float', 'red', 'Ha-ha-ha-HA-ha! A birthday for the woodpecker.'],

    // ---- May ----
    ['trackydack', 5, 1, 'Tracky Dack Day', '👖 🛋️ 😌', 'float', 'party', 'Tracksuit pants on. Comfy cards only.'],
    ['lumpyrug', 5, 3, 'Lumpy Rug Day', '🧶 🏠 😵', 'float', 'warm', 'Today we celebrate the rugs that trip us up.'],
    ['paranormal', 5, 3, 'National Paranormal Day', '👻 🔮 🕯️', 'stars', 'dark', 'Who keeps stealing the kitty? Spooky.'],
    ['lostsock', 5, 9, 'Lost Sock Memorial Day', '🧦 🕯️ 😢', 'float', 'party', 'Gone but not forgotten. Rest in pairs.'],
    ['odometer', 5, 12, 'National Odometer Day', '🚗 🔢 🛣️', 'float', 'cool', 'How many hands have you played? We’re counting.'],
    ['coughdrop', 5, 13, 'Cough Drop Day', '🍬 😷 🍯', 'float', 'red', 'Soothe that throat before you call your trump.'],
    ['frogjumping', 5, 13, 'National Frog Jumping Day', '🐸 🌿 💦', 'float', 'nature', 'For Mark Twain’s celebrated jumping frog of Calaveras County.'],
    ['chickendance', 5, 14, 'Dance Like a Chicken Day', '🐔 💃 🎶', 'confetti', 'party', 'Flap, flap, clap clap clap. Now deal.'],
    ['cherrydessert', 5, 26, 'National Cherry Dessert Day', '🍒 🥧 🍨', 'float', 'red', 'A cherry on top for every made bid today.'],
    ['cellophanetape', 5, 27, 'National Cellophane Tape Day', '🎞️ ✂️ 📦', 'float', 'cool', 'Holding things together since 1930.'],
    ['nothingtofear', 5, 27, 'Nothing to Fear Day', '🦁 💪 ⭐', 'stars', 'gold', 'Bid big. There’s nothing to fear but a set.'],
    ['whatyouthink', 5, 31, 'What You Think Upon Grows Day', '🌱 🧠 🌻', 'leaves', 'nature', 'Think about winning hands. Watch them grow.'],

    // ---- June ----
    ['guemes', 6, 17, 'Commemoration of General Don Martín Miguel de Güemes', '🇦🇷 🎖️ 🐎', 'stars', 'cool', 'Argentina remembers a hero of its war of independence.'],
    ['pink', 6, 23, 'National Pink Day', '💗 🩷 🌸', 'confetti', 'pink', 'Think pink — even the felt is jealous.'],
    ['handshake', 6, 24, 'National Handshake Day', '🤝 🤝🏽 🤝🏿', 'float', 'warm', 'Shake on it: good game, partner.'],
    ['tau', 6, 28, 'Tau Day', '🥧 🔢 ⭕', 'stars', 'space', 'τ = 6.283… twice the pie, twice the fun.'],
    ['asteroid', 6, 30, 'International Asteroid Day', '☄️ 🪐 🔭', 'stars', 'space', 'Look up — and keep an eye on the sky.'],

    // ---- July ----
    ['ufo', 7, 2, 'World UFO Day', '🛸 👽 🌌', 'stars', 'space', 'Unidentified flying… object? Or just a thrown card?'],
    ['disobedience', 7, 3, 'Disobedience Day', '😈 🙅 🎉', 'confetti', 'party', 'Break a (house) rule. Just one.'],
    ['jerseyweek', 7, 4, 'Be Nice to Jersey Week', '🗽 ❤️ 🌊', 'float', 'red', 'Jersey, we love you. Fuhgeddaboudit.'],
    ['differenteyes', 7, 12, 'National Different Colored Eyes Day', '👁️ 🌈 ✨', 'confetti', 'party', 'Here’s looking at you — in two colours.'],
    ['geekness', 7, 13, 'Embrace Your Geekness Day', '🤓 💾 🧪', 'stars', 'space', 'Count the cards. Calculate the odds. Be proud.'],
    ['foolsparadise', 7, 13, 'Fool’s Paradise Day', '🏝️ 🤡 🍹', 'float', 'party', 'Live blissfully unaware of your partner’s hand.'],
    ['pandemonium', 7, 14, 'Pandemonium Day', '🌀 🎉 🙃', 'confetti', 'party', 'Chaos at the table? Embrace it.'],
    ['uglytruck', 7, 20, 'National Ugly Truck Contest Day', '🛻 🏆 🔧', 'float', 'warm', 'Rust is a feature. So is a bad hand.'],
    ['stilts', 7, 27, 'Walk On Stilts Day', '🦒 🎪 🤸', 'float', 'party', 'Rise above the competition today.'],
    ['lipstick', 7, 29, 'National Lipstick Day', '💄 💋 ❤️', 'float', 'red', 'A red-letter — and red-lip — day.'],

    // ---- August ----
    ['cleanfloors', 8, 3, 'Clean Your Floors Day', '🧽 ✨ 🧹', 'bubbles', 'cool', 'Mop first, Boston later.'],
    ['tarantula', 8, 8, 'National Tarantula Appreciation Day', '🕷️ 🕸️ 🌙', 'float', 'dark', 'Eight legs, zero card tricks.'],
    ['abai', 8, 10, 'Abai Day', '🇰🇿 📜 🪶', 'stars', 'gold', 'Kazakhstan celebrates the poet Abai Kunanbaev.'],
    ['nospongebob', 8, 15, 'National No Sponge Bob Day', '🧽 🚫 🫧', 'bubbles', 'cool', 'Today: no square pants allowed.'],
    ['nevergiveup', 8, 18, 'Never Give Up Day', '💪 🔥 🏆', 'fireworks', 'warm', 'Down 5–0? Never give up.'],
    ['sparktheworld', 8, 26, 'National Spark the World Day', '✨ 🌍 💡', 'fireworks', 'gold', 'One kind spark can light up the whole table.'],

    // ---- September ----
    ['acnepositivity', 9, 1, 'Acne Positivity Day', '💛 😊 ✨', 'float', 'pink', 'Every face at the table is a good one.'],
    ['ampersand', 9, 8, 'National Ampersand Day', '✍️ 🔤 ➕', 'float', 'gold', 'Bid & make it & run a Boston.'],
    ['weirdos', 9, 9, 'Wonderful Weirdos Day', '🦄 🤪 🌈', 'confetti', 'party', 'Here’s to every wonderful weirdo at the table.'],
    ['cartonnage', 9, 18, 'National Cartonnage Day', '📦 🏺 🎨', 'float', 'warm', 'Ancient Egypt’s papier-mâché art, honored today.'],
    ['equinox', 9, 23, 'The September Equinox', '🌗 🍂 ☀️', 'leaves', 'nature', 'Day and night, perfectly balanced — like a good partnership.'],
    ['ajday', 9, 27, 'National AJ Day', '🅰️ 🃏 🎉', 'confetti', 'party', 'Shout-out to every AJ. Ace-Jack, anyone?'],

    // ---- October ----
    ['skeptics', 10, 13, 'International Skeptics Day', '🤨 🔍 ❓', 'float', 'calm', 'You really think that bid’s going to make?'],
    ['greatfuneral', 10, 30, 'Create a Great Funeral Day', '🕊️ 💐 🎺', 'stars', 'calm', 'Plan the send-off you’d actually enjoy.'],

    // ---- November ----
    ['punctuality', 11, 1, 'National Consciousness Month for Punctuality and Civility', '⏰ 🎩 🤝', 'float', 'gold', 'Be on time. Be kind. Lead on your turn.'],
    ['redhair', 11, 5, 'National Love Your Red Hair Day', '👩‍🦰 🧡 👨‍🦰', 'float', 'warm', 'Celebrating every redhead at the table.'],
    ['hugabear', 11, 7, 'Hug a Bear Day', '🧸 🐻 🤗', 'float', 'warm', 'Teddy bears only, please.'],
    ['retinol', 11, 7, 'National Retinol Day', '🧴 ✨ 💆', 'bubbles', 'pink', 'Glow up — skincare edition.'],
    ['occult', 11, 18, 'International Occult Day', '🔮 🌙 ✨', 'stars', 'dark', 'Your crystal ball says: bid five.'],
    ['absurdity', 11, 20, 'National Absurdity Day', '🙃 🎩 🐙', 'confetti', 'party', 'Lead the Big Joker in No-Trump. Absurd!'],
    ['freckles', 11, 22, 'Love Your Freckles Day', '🌟 😊 ✨', 'confetti', 'pink', 'Every freckle is a little star.'],
    ['blase', 11, 25, 'Blasé Day', '😑 🥱 🤷', 'float', 'calm', 'Oh, another Boston? How… nice.'],

    // ---- December ----
    ['takeitinear', 12, 8, 'Take it in the Ear Day', '👂 🎵 🎧', 'float', 'party', 'Turn the sound on and take it all in.'],
    ['deadwhales', 12, 10, 'Festival for the Souls of Dead Whales', '🐋 🌊 🕯️', 'bubbles', 'cool', 'A Japanese tradition honoring the great whales.'],
    ['lostfound', 12, 12, 'Lost and Found Day', '🔎 🧤 🔑', 'float', 'warm', 'Found: your lucky deck. Lost: our dignity.'],
    ['halcyon', 12, 14, 'Halcyon Days', '🐦 🌊 ☀️', 'stars', 'calm', 'Calm seas and peaceful days ahead.'],
    ['plunger', 12, 18, 'Wear a Plunger on Your Head Day', '🪠 🤪 👑', 'float', 'party', 'Yes, it’s real. Yes, we’re doing it.'],
    ['dotis', 12, 20, 'Dot Your I’s Day', '✍️ 🔵 ℹ️', 'confetti', 'party', 'Check the details before you bid.'],
    ['mathematics', 12, 22, 'Mathematics Day', '➗ 🔢 📐', 'stars', 'space', 'Six plus your bid: the only math that matters.'],
    ['noelday', 12, 25, 'A’Phabet Day or No “L” Day', '🔤 🚫 🎄', 'float', 'party', 'A No-“L” Christmas: Noe, Noe, Noe!'],
    ['whiners', 12, 26, 'National Whiners Day', '😭 🍼 🙄', 'float', 'party', 'Got set? Today you’re allowed to whine.'],
    ['enormouschanges', 12, 30, 'Festival of Enormous Changes at the Last Minute', '🔄 ⏰ 🤯', 'confetti', 'party', 'Change your mind. Change your bid. It’s allowed today.'],
    ['resolution', 12, 30, 'National Resolution Planning Day', '📝 🎯 ✨', 'stars', 'gold', 'Resolution #1: run more Bostons.'],
    ['unlucky', 12, 31, 'Unlucky Day', '🍀 🐈‍⬛ 🪞', 'stars', 'dark', 'Black cat crossed the table? Shuffle twice.'],
  ];

  function nthWeekday(year, month, weekday, n) {
    if (n > 0) {
      const first = new Date(year, month, 1).getDay();
      return new Date(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
    }
    const lastDay = new Date(year, month + 1, 0);
    return new Date(year, month, lastDay.getDate() - ((lastDay.getDay() - weekday + 7) % 7));
  }
  function dateFor(row, year) {
    const m = row[1] - 1, d = row[2];
    if (typeof d === 'number') return new Date(year, m, d);
    if (d === 'mon-last') return nthWeekday(year, m, 1, -1);
    if (d === 'fri1') return nthWeekday(year, m, 5, 1);
    if (d === 'fri2') return nthWeekday(year, m, 5, 2);
    const thanksgiving = nthWeekday(year, 10, 4, 4);
    if (d === 'tg+1') return new Date(year, 10, thanksgiving.getDate() + 1);
    if (d === 'tg+5') return new Date(year, 10, thanksgiving.getDate() + 5); // rolls into December as needed
    throw new Error('unknown date rule ' + d);
  }

  const LIST = ROWS.map((r) => {
    const emoji = r[4].split(' ');
    return {
      id: r[0], name: r[3], kind: 'fun', rule: r[2], month: r[1],
      date: (y) => dateFor(r, y), before: 0, after: 0,
      greeting: r[3], line: r[7], emoji, emblem: emoji[0], fx: r[5],
      lights: 'bunting', palette: PALETTES[r[6]] || PALETTES.party, pieces: emoji.slice(0, 3), solemn: false,
    };
  });

  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // All fun days that fall on `date` (several can share a day).
  function on(date) {
    const d = date || new Date();
    return LIST.filter((f) => same(f.date(d.getFullYear()), d));
  }
  function byId(id) { return LIST.find((f) => f.id === id) || null; }

  // What to show on `date`, given the federal-holiday module:
  //   table — the scene that dresses the table: the federal holiday whenever
  //           one is in its window (Christmas lights stay up all week), else
  //           the day's first fun day;
  //   stage — the start-screen showpiece: the federal holiday on its actual
  //           date, otherwise that day's fun day if there is one;
  //   also  — everything else happening that day ("Also today").
  function scene(date, Holidays, includeFun) {
    const d = date || new Date();
    const fed = Holidays.holidayOn(d);
    const fedToday = !!(fed && same(fed.when, d));
    const fun = includeFun === false ? [] : on(d);
    const table = fed || fun[0] || null;
    const stage = fedToday || !fun.length ? fed : fun[0];
    const also = [fed, ...fun].filter((x) => x && x !== stage);
    return { table, stage, also };
  }

  return { LIST, PALETTES, on, byId, scene };
});
