/* Bid Whist table — UI + game flow. Depends on engine.js and ai.js (globals). */
(function () {
  'use strict';

  const E = window.Engine;
  const AI = window.AI;

  const NAMES = ['You', 'Pearl', 'Marcus', 'Deacon'];
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Seat rotation: the local player always sits South. In local play viewSeat is
  // 0 (identity); online it's whatever seat the server gave us, so every server
  // seat is drawn at screen slot (serverSeat - viewSeat) mod 4 — 0 south (me),
  // 1 west, 2 north (partner), 3 east.
  function slot(seat) { return (seat - G.viewSeat + 4) % 4; }
  function myTeam() { return G.viewSeat % 2; }
  // Is this seat the person at this screen? Never true for a watcher, who
  // just sees the table from seat 1's side.
  function isMe(seat) { return seat === G.viewSeat && !(typeof Online !== 'undefined' && Online.watching); }
  // Online, teams carry the names their captains chose; solo it's Us / Them.
  function teamLabel(team) {
    if (G.mode === 'online' && G.view && G.view.teams && G.view.teams[team]) return G.view.teams[team].name;
    return team === myTeam() ? 'Us' : 'Them';
  }
  // Start / deal-next powers come from the server (they pass on if the host leaves).
  function amHost() { return G.view ? !!G.view.hostToken : !!(typeof Online !== 'undefined' && Online.isHost); }
  function seatName(seat) {
    if (G.view && G.view.seats) {
      if (isMe(seat)) return 'You';
      const s = G.view.seats[seat];
      return (s && s.name) || 'Player';
    }
    if (seat === 0 && G.profile && G.profile.name) return G.profile.name;
    return NAMES[seat];
  }
  function seatVerb(seat, base) { return isMe(seat) ? base : base + (/(s|sh|ch|x)$/.test(base) ? 'es' : 's'); }
  // "You & Marcus" — the two players on a team, by name.
  function teamNames(team) {
    return [team, team + 2].map((s) => (isMe(s) ? 'You' : seatName(s))).join(' & ');
  }

  // ---- profile & avatars ----------------------------------------------------
  // Your name + avatar, saved locally and shared online. An avatar value is one
  // of two things:
  //   'cartoon:E.P'          — an animal (CARTOONS[E]) on a gradient (PALETTE[P]).
  //                            Drawn as live text with the device's own emoji
  //                            font, so it shows on every phone, tablet and
  //                            desktop. (Rasterizing emoji into an image was
  //                            unreliable — some devices drew a blank.)
  //   'data:image/jpeg;...'  — an uploaded photo, cropped small.

  const PROFILE_KEY = 'bidwhist.profile';
  // Order is part of the wire format — append only. All are Emoji 5.0 (2017) or
  // older, so even years-old Android/Samsung phones have them.
  const CARTOONS = ['🦊','🐼','🐵','🐸','🐯','🦁','🐰','🐨','🐷','🐮','🐔','🐧','🐙','🦄','🐲','🐺','🦉','🐱','🐶','🐹','🐗','🐻','🦖','🐳','🦓','🐴','🐝'];
  const PALETTE = [
    ['#f0932b','#eb4d4b'], ['#22a6b3','#6ab04c'], ['#e056fd','#686de0'],
    ['#f9ca24','#f0932b'], ['#7ed6df','#30336b'], ['#eb4d4b','#6c5ce7'],
    ['#badc58','#009432'], ['#ff7979','#b53471'], ['#f6b93b','#0a3d62'],
    ['#e77f67','#cf6a87'], ['#3dc1d3','#182c61'], ['#ffb8b8','#3742fa'],
  ];

  function hashStr(s) {
    let h = 2166136261 >>> 0; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function cartoonSpec(e, p) {
    const c = PALETTE[p % PALETTE.length];
    return { emoji: CARTOONS[e % CARTOONS.length], c1: c[0], c2: c[1], code: `cartoon:${e % CARTOONS.length}.${p % PALETTE.length}` };
  }
  function cartoonFor(seed) {
    const h = hashStr(seed);
    return cartoonSpec(h % CARTOONS.length, (h >>> 8) % PALETTE.length);
  }
  function randomCartoon() {
    return cartoonSpec(Math.floor(Math.random() * CARTOONS.length), Math.floor(Math.random() * PALETTE.length));
  }
  // Stored/shared avatar value → something applyAvatar can draw. Anything
  // unrecognized falls back to a cartoon derived from `seed`.
  function avatarFrom(value, seed) {
    const m = /^cartoon:(\d{1,2})\.(\d{1,2})$/.exec(value || '');
    if (m) return cartoonSpec(+m[1], +m[2]);
    if (/^data:image\/(jpeg|png|webp);/.test(value || '')) return { img: value };
    return cartoonFor(seed || 'player');
  }

  // Cover-crop an uploaded photo to a small JPEG. createObjectURL avoids
  // loading a 12 MB phone photo into a giant base64 string first.
  function processAvatarFile(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
          const x = c.getContext('2d');
          const scale = Math.max(S / img.naturalWidth, S / img.naturalHeight);
          const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
          x.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          res(c.toDataURL('image/jpeg', 0.78));
        } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('unreadable image')); };
      img.src = url;
    });
  }

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (p && p.name && p.avatar) {
        // Old canvas-rendered cartoons were PNG data URLs and could be blank on
        // some devices — swap them for a live cartoon. Photos (JPEG) are kept.
        if (/^data:image\/png;/.test(p.avatar)) { p.avatar = randomCartoon().code; saveProfile(p); }
        return p;
      }
    } catch (_) { /* fall through */ }
    return { name: 'You', avatar: randomCartoon().code }; // random cartoon by default
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) { /* ignore */ }
  }

  // Avatar to draw for a seat: the player's own choice when known, otherwise a
  // name-derived cartoon (solo AI seats, avatarless online seats).
  function avatarSpecFor(seat) {
    if (G.view && G.view.seats) {
      const s = G.view.seats[seat];
      return avatarFrom(s && s.avatar, ((s && s.name) || 'seat') + '#' + seat);
    }
    if (seat === 0) return avatarFrom(G.profile.avatar, 'you#0');
    return cartoonFor(NAMES[seat] + '#' + seat);
  }
  function applyAvatar(el, spec) {
    if (!el) return;
    if (spec.img) {
      el.classList.add('photo');
      el.style.backgroundImage = `url("${spec.img}")`;
      el.textContent = '';
    } else {
      el.classList.remove('photo');
      el.style.backgroundImage = `linear-gradient(135deg, ${spec.c1}, ${spec.c2})`;
      el.innerHTML = `<span class="avatar-emoji" aria-hidden="true">${spec.emoji}</span>`;
    }
  }

  const STORAGE_KEY = 'bidwhist.rules';

  function loadRules() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return E.cleanRules({ ...E.DEFAULT_RULES, ...(saved || {}) });
    } catch (_) { return { ...E.DEFAULT_RULES }; }
  }

  const G = {
    rules: loadRules(),
    nextRules: null,       // settings edits apply at the next hand
    scores: [0, 0],
    dealer: Math.floor(Math.random() * 4),
    handNo: 0,
    hands: null, kitty: null,
    bids: [null, null, null, null],
    high: null, highSeat: null, plans: {},
    contract: null,
    books: [0, 0],
    memory: new Set(),
    awaiting: null,        // 'bid' | 'declare-suit' | 'declare-dir' | 'discard' | 'play'
    resolve: null,         // pending human-input resolver
    legalIds: new Set(),
    discardPicks: new Set(),
    running: false,
    learner: AI.createLearner(), // adapts across hands within this session
    mode: 'local',               // 'local' | 'online'
    viewSeat: 0,                 // this client's server seat (0 for local)
    view: null,                  // last server snapshot (online)
    net: null,                   // Net controller (online)
    profile: loadProfile(),      // { name, avatar } saved locally
    handResult: null,            // { highSeat, made, delta } shown on the seat
    liveTrick: [],               // cards on the felt right now (winning-card glow)
    seatBooks: [0, 0, 0, 0],     // books each player has taken this hand
    shownIds: new Set(),         // cards already drawn in your hand (no re-deal animation)
  };

  // ---- sound, vibration & table effects -----------------------------------
  // Every sound is synthesized with Web Audio (no files to download). Off
  // switch lives in the menu and in Table Rules; it also silences vibration.
  const Sound = (() => {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('bidwhist.sound') !== 'off'; } catch (_) { /* default on */ }
    function ac() {
      if (!on) return null;
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        try { ctx = new C(); } catch (_) { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function out(c, node, gain) {
      const g = c.createGain(); g.gain.value = gain;
      node.connect(g); g.connect(c.destination);
      return g;
    }
    // A short filtered noise burst — card snaps, shuffles, swishes.
    function noise(dur, freq, q, gain, when) {
      const c = ac(); if (!c) return;
      const t = c.currentTime + (when || 0);
      const len = Math.max(1, Math.ceil(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      src.connect(f); out(c, f, gain);
      src.start(t);
    }
    function tone(freq, dur, gain, when, type) {
      const c = ac(); if (!c) return;
      const t = c.currentTime + (when || 0);
      const o = c.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    }
    const fx = {
      card: () => noise(0.06, 2600, 1.1, 0.55),
      collect: () => noise(0.24, 800, 0.6, 0.3),
      shuffle: () => { for (let i = 0; i < 10; i++) noise(0.05, 1800 + Math.random() * 1400, 1, 0.32, i * 0.055); },
      turn: () => tone(880, 0.12, 0.05),
      kitty: () => { tone(659.25, 0.18, 0.1); tone(987.77, 0.3, 0.1, 0.11); },
      call: () => { tone(392, 0.22, 0.11, 0, 'triangle'); tone(523.25, 0.22, 0.11, 0.12, 'triangle'); tone(783.99, 0.45, 0.12, 0.24, 'triangle'); },
      made: () => { tone(523.25, 0.3, 0.1, 0, 'triangle'); tone(783.99, 0.4, 0.1, 0.1, 'triangle'); },
      chime: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.6, 0.11, i * 0.1, 'triangle')),
      set: () => { tone(220, 0.35, 0.12, 0, 'triangle'); tone(164.8, 0.55, 0.12, 0.16, 'triangle'); },
    };
    return {
      play(name) { try { if (fx[name]) fx[name](); } catch (_) { /* audio is optional */ } },
      buzz(pattern) { try { if (on && navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* ignore */ } },
      get on() { return on; },
      set(v) {
        on = !!v;
        try { localStorage.setItem('bidwhist.sound', on ? 'on' : 'off'); } catch (_) { /* ignore */ }
        if (on) ac();
      },
    };
  })();

  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Big italic call-out across the felt ("Give me da kitty!").
  let bannerTimer = null;
  function showBanner(text, sub, ms) {
    const b = $('table-banner'); if (!b) return;
    b.innerHTML = `<span class="tb-main">${text}</span>` + (sub ? `<span class="tb-sub">${sub}</span>` : '');
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms || 1500);
  }

  function confetti(n) {
    if (reduceMotion()) return;
    const box = document.createElement('div');
    box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
    const colors = ['#f0cd78', '#d4a94e', '#f6efdd', '#e0705f', '#7fc97f', '#b3382e'];
    for (let i = 0; i < (n || 90); i++) {
      const p = document.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      p.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      if (i % 3 === 0) p.style.borderRadius = '50%';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4800);
  }

  // The trump call, announced across the table before the first card: who
  // called it, the contract, and what it takes to make or set it. Stays up
  // ~2.5s (a short confirmation when it's your own call); a tap skips it.
  function announceContract(seat, c) {
    return new Promise((resolve) => {
      const el = $('trump-call');
      if (!el || !c) { resolve(); return; }
      const banner = $('table-banner');
      if (banner) banner.classList.remove('show'); // the kitty call has had its moment
      const mine = isMe(seat);
      const ours = seat % 2 === myTeam() && !Online.watching;
      const dir = c.direction === 'uptown' ? 'Uptown' : 'Downtown';
      const red = c.trump === 'H' || c.trump === 'D';
      const glyph = c.type === 'notrump'
        ? '<span class="tc-glyph nt">NT</span>'
        : `<span class="tc-glyph ${red ? 'red' : 'blk'} suit-${c.trump}">${E.SUIT_GLYPHS[c.trump]}</span>`;
      const contract = c.type === 'notrump'
        ? `${c.amount} No-Trump, ${dir}`
        : `${c.amount} ${dir} in <span class="tc-suit ${red ? 'red' : 'blk'} suit-${c.trump}">${E.SUIT_NAMES[c.trump]}</span>`;
      const need = 6 + c.amount, set = 8 - c.amount;
      const who = mine ? 'You call it' : `${seatName(seat)} calls it`;
      const sub = ours
        ? `Your team needs <b>${need}</b> books · they set you with <b>${set}</b>`
        : `${seatName(seat)}&rsquo;s team needs <b>${need}</b> books · set them with <b>${set}</b>`;
      el.innerHTML = `${glyph}<span class="tc-text"><span class="tc-who">${who}</span>` +
        `<span class="tc-contract">${contract}</span><span class="tc-sub">${sub}</span>` +
        `<span class="tc-how">${c.direction === 'uptown' ? 'High cards win' : 'Low cards win — ace still tops'}${c.type === 'notrump' ? ' · no trump suit' : ''}</span></span>`;
      el.classList.remove('show', 'quick'); void el.offsetWidth;
      el.classList.add('show');
      if (mine) el.classList.add('quick');
      replay($('trump-badge'), 'pulse');
      Sound.play('call');
      announce(`${mine ? 'You call' : seatName(seat) + ' calls'} ${E.describeContract(c)}. ` +
        `${ours ? 'Your' : 'Their'} team needs ${need} books.`);
      let done = false;
      const table = $('table');
      const finish = () => {
        if (done) return;
        done = true;
        el.classList.remove('show', 'quick');
        table.removeEventListener('pointerdown', finish);
        setTimeout(resolve, 180); // let it fade before the first card
      };
      table.addEventListener('pointerdown', finish);
      setTimeout(finish, mine ? 1300 : 2500);
    });
  }

  // Re-trigger a CSS entrance animation (stamps slamming down, shakes).
  function replay(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  // Dress the hand-summary / game-over dialog for the moment.
  function celebrate(modalId, kind, ours) {
    const m = document.querySelector('#' + modalId + ' .modal');
    m.classList.remove('boston', 'is-set', 'is-made', 'shake');
    m.classList.add(kind === 'boston' ? 'boston' : kind === 'set' ? 'is-set' : 'is-made');
    replay(m.querySelector('.stamp'), 'slam');
    if (kind === 'set') { replay(m, 'shake'); Sound.play('set'); Sound.buzz(ours ? 60 : 20); }
    else if (kind === 'boston') { Sound.play('chime'); Sound.buzz([30, 50, 30, 50, 60]); if (ours) confetti(110); }
    else if (kind === 'win') { Sound.play('chime'); Sound.buzz([30, 50, 30]); confetti(130); }
    else Sound.play('made');
  }

  // ---- logging & messages ---------------------------------------------------

  function log(html, hl) {
    const p = document.createElement('p');
    if (hl) p.className = 'hl';
    p.innerHTML = html;
    const box = $('log');
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  // Occasionally voice what the AI has learned about the human's bidding —
  // makes the "they're reading you" adaptation visible at the table.
  function maybeShowRead() {
    const me = G.learner.seats[0];
    if (me.declares < 4 || G.handNo % 3 !== 0) return;
    const opp = Math.random() < 0.5 ? NAMES[1] : NAMES[3]; // an opponent, not your partner
    let line = null;
    if (me.surplus < -0.8) line = `${opp} mutters: "You bid big — we just sit back and set you."`;
    else if (me.surplus > 0.9) line = `${opp} nods: "You play it safe. We can't let you steal the cheap ones."`;
    else if (me.madeRate > 0.8) line = `${opp} squints: "You've been making everything. Time to press."`;
    if (line) log(`<i>${line}</i>`);
  }

  function tableMsg(text) {
    $('table-msg').textContent = text || '';
  }

  // ---- card DOM -------------------------------------------------------------

  function cardEl(card, faceUp) {
    const el = document.createElement('div');
    if (!faceUp) { el.className = 'card back'; return el; }
    if (card.joker) {
      // Big Joker in gold, Little Joker in silver. In No-Trump they're dead
      // cards, and the face says so.
      const big = card.joker === 'big';
      const dead = !!(G.contract && G.contract.type === 'notrump');
      el.className = 'card joker ' + (big ? 'big' : 'little') + (dead ? ' dead' : '');
      el.innerHTML =
        `<span class="idx">&#9733;<small>${big ? 'BIG' : 'LIL'}</small></span><span class="pip">&#9733;</span>` +
        `<span class="jlab"><b>${big ? 'Big' : 'Little'}</b>${dead ? 'throw-off' : 'joker'}</span>` +
        `<span class="idx flip">&#9733;<small>${big ? 'BIG' : 'LIL'}</small></span>`;
      el.title = E.cardLabel(card) + (dead ? ' — dead in No-Trump' : '');
      if (G.contract && G.contract.type !== 'notrump') el.classList.add('trump');
      el.setAttribute('aria-label', cardWords(card));
      return el;
    }
    const red = card.suit === 'H' || card.suit === 'D';
    el.className = 'card ' + (red ? 'red' : 'black') + ' suit-' + card.suit;
    if (G.contract && G.contract.type !== 'notrump' && card.suit === G.contract.trump) el.classList.add('trump');
    const r = E.rankLabel(card.rank);
    const g = E.SUIT_GLYPHS[card.suit];
    el.innerHTML =
      `<span class="idx">${r}<small>${g}</small></span>` +
      `<span class="pip">${g}</span>` +
      `<span class="idx flip">${r}<small>${g}</small></span>`;
    el.title = E.cardLabel(card);
    el.setAttribute('aria-label', cardWords(card));
    return el;
  }

  // "Queen of Hearts" — for screen readers.
  const RANK_WORDS = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  function cardWords(card) {
    if (card.joker) return card.joker === 'big' ? 'Big Joker' : 'Little Joker';
    return `${RANK_WORDS[card.rank] || card.rank} of ${E.SUIT_NAMES[card.suit]}`;
  }
  function announce(text) {
    const el = $('sr-live'); if (!el) return;
    el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30);
  }

  // ---- rendering ------------------------------------------------------------

  function sortDirection() {
    if (!G.contract) return 'uptown';
    return G.contract.type === 'notrump' ? G.contract.direction : G.contract.type;
  }

  function renderScores() {
    const us = myTeam(), them = 1 - us;
    $('score-us').textContent = G.scores[us];
    $('score-them').textContent = G.scores[them];
    $('score-target').textContent = 'first to ' + G.rules.gameTarget;
    $('books-us').textContent = G.books[us];
    $('books-them').textContent = G.books[them];
    $('mini-us').textContent = G.scores[us];     // compact header score (phones)
    $('mini-them').textContent = G.scores[them];
    for (const [id, t] of [['label-us', us], ['label-them', them],
      ['mini-label-us', us], ['mini-label-them', them]]) {
      const el = $(id); if (el) { el.textContent = teamLabel(t); el.title = teamLabel(t); }
    }
    // Progress toward the game target (red when a team is in the hole).
    for (const [id, t] of [['bar-us', us], ['bar-them', them]]) {
      const el = $(id); if (!el) continue;
      const sc = G.scores[t], target = G.rules.gameTarget || 7;
      el.style.width = Math.min(100, Math.abs(sc) / target * 100) + '%';
      el.classList.toggle('neg', sc < 0);
    }
  }

  function renderContractLine() {
    const line = $('contract-line');
    if (!G.contract) { line.textContent = 'No contract yet'; $('set-meter').innerHTML = ''; return; }
    const c = G.contract;
    const who = seatName(G.highSeat);
    let desc = c.amount + ' ' +
      (c.type === 'notrump'
        ? 'No-Trump (' + (c.direction === 'uptown' ? 'high' : 'low') + ')'
        : (c.type === 'uptown' ? 'Uptown' : 'Downtown') + ' in ' + E.SUIT_NAMES[c.trump]);
    line.innerHTML = `<b>${who}</b>: ${desc} — needs ${6 + c.amount} books`;
    renderSetMeter();
    renderTrumpBadge();
  }

  // Always-on reminder of what's trump (and which way it runs).
  function renderTrumpBadge() {
    const b = $('trump-badge');
    const c = G.contract;
    if (!c) { b.hidden = true; b.innerHTML = ''; renderTools(); return; }
    if (c.type === 'notrump') {
      b.innerHTML = `<span class="tb-glyph nt">NT</span><span class="tb-text"><b>No-Trump</b><small>${c.direction === 'uptown' ? 'Uptown · high wins' : 'Downtown · low wins'}</small></span>`;
    } else {
      const red = c.trump === 'H' || c.trump === 'D';
      b.innerHTML = `<span class="tb-glyph ${red ? 'red' : 'blk'} suit-${c.trump}">${E.SUIT_GLYPHS[c.trump]}</span>` +
        `<span class="tb-text"><b>${E.SUIT_NAMES[c.trump]}<span class="tb-word"> trump</span></b><small>${c.type === 'uptown' ? 'Uptown · high wins' : 'Downtown · low wins'}</small></span>`;
    }
    b.title = 'Trump this hand';
    b.hidden = false;
    renderTools();
  }

  // Corner tools: Last book, Call renege, reactions.
  function renderTools() {
    const v = G.view;
    const playing = !!(v && (v.phase === 'playing' || v.phase === 'handover'));
    $('btn-last-book').hidden = !(G.lastTrick && G.lastTrick.cards && G.lastTrick.cards.length === 4 && playing);
    $('btn-renege').hidden = !(v && v.rules && v.rules.renege && v.phase === 'playing' && !Online.watching);
    $('btn-react').hidden = !G.running || Online.watching;
  }

  function showLastBook() {
    const t = G.lastTrick; if (!t) return;
    const box = $('lastbook');
    box.innerHTML = '';
    for (const p of t.cards) {
      const spot = document.createElement('div');
      spot.className = 'lb-spot at-' + slot(p.seat) + (p.seat === t.winner ? ' won' : '');
      spot.appendChild(cardEl(p.card, true));
      const nm = document.createElement('span'); nm.className = 'lb-name';
      nm.textContent = isMe(p.seat) ? 'You' : seatName(p.seat);
      spot.appendChild(nm);
      box.appendChild(spot);
    }
    const lead = t.cards[0];
    $('lastbook-note').textContent = `${isMe(lead.seat) ? 'You' : seatName(lead.seat)} led · ` +
      `${isMe(t.winner) ? 'you' : seatName(t.winner)} took it with the ${E.cardLabel(t.cards.find((p) => p.seat === t.winner).card)}.`;
    $('modal-lastbook').classList.add('show');
  }

  // ---- reactions ----------------------------------------------------------------
  function buildReactMenu() {
    const m = $('react-menu');
    m.innerHTML = '';
    E.REACTIONS.forEach((txt, id) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.className = 'react-opt' + (txt.length <= 2 ? ' emoji' : '');
      b.textContent = txt;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Online.conn) Online.conn.send({ type: 'react', id });
        toggleReactMenu(false);
      });
      m.appendChild(b);
    });
    // Or type your own.
    const form = document.createElement('form');
    form.className = 'react-say';
    form.innerHTML = '<input type="text" maxlength="60" placeholder="Say something…" aria-label="Type a message" autocomplete="off" enterkeyhint="send">' +
      '<button type="submit" class="btn primary small">Send</button>';
    const input = form.querySelector('input');
    form.addEventListener('click', (e) => e.stopPropagation());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !Online.conn) return;
      Online.conn.send({ type: 'say', text });
      input.value = '';
      toggleReactMenu(false);
    });
    m.appendChild(form);
  }
  function toggleReactMenu(open) {
    const m = $('react-menu');
    if (open === undefined) open = m.hidden;
    m.hidden = !open;
    $('btn-react').setAttribute('aria-expanded', String(open));
  }
  function showReaction(seat, id) {
    const text = E.REACTIONS[id]; if (!text) return;
    showBubble(seat, text);
  }
  function esc(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function showBubble(seat, text) {
    const host = $('seat-' + slot(seat)); if (!host) return;
    host.querySelectorAll('.react-bubble').forEach((b) => b.remove());
    const b = document.createElement('div');
    b.className = 'react-bubble' + (text.length <= 2 ? ' emoji' : '') + (text.length > 18 ? ' long' : '');
    b.textContent = text;
    host.appendChild(b);
    Sound.play('turn');
    if (!isMe(seat)) announce(`${seatName(seat)}: ${text}`);
    setTimeout(() => b.remove(), text.length > 18 ? 4200 : 2800);
    if (text.length > 18) b.style.animationDuration = '4.2s';
  }

  // ---- coach --------------------------------------------------------------------
  // The same brain the computer players use, offered as a suggestion.
  function coachOn() { try { return localStorage.getItem('bidwhist.coach') === 'on'; } catch (_) { return false; } }
  function myHand() { return (G.hands && G.hands[G.viewSeat] || []).filter((c) => !c.back); }
  function liveTrickFromView(view) {
    return (view && view.trick ? view.trick : []).map((p) => ({ player: p.seat, card: p.card }));
  }
  function bossCard(card) {
    if (card.joker) return G.contract && G.contract.type !== 'notrump';
    const dir = sortDirection();
    const mine = new Set(myHand().map((c) => c.id));
    for (let r = 2; r <= 14; r++) {
      const id = card.suit + r;
      if (r === card.rank || mine.has(id) || G.memory.has(id)) continue;
      if (E.rankPower(r, dir) > E.rankPower(card.rank, dir)) return false;
    }
    return true;
  }
  function coachPlay(view) {
    const trick = liveTrickFromView(view);
    const hand = myHand();
    const card = AI.choosePlay(hand, trick, G.contract, G.viewSeat, G.memory, 'regular');
    const c = G.contract, seat = G.viewSeat;
    const isTrump = (x) => c.type !== 'notrump' && (x.joker || x.suit === c.trump);
    let why;
    if (!trick.length) {
      if (isTrump(card)) why = 'lead trump to pull theirs';
      else if (bossCard(card)) why = 'lead your boss card — nobody can top it';
      else why = 'lead low and let your partner work';
    } else {
      const led = E.trickLedSuit(trick, c);
      const partnerHas = E.trickWinner(trick, c) === (seat + 2) % 4;
      const wins = E.trickWinner(trick.concat([{ player: seat, card }]), c) === seat;
      if (partnerHas && !wins) why = 'your partner has it — throw your cheapest card';
      else if (wins && led && E.effectiveSuit(card, c) !== led && isTrump(card)) why = "you're out of the suit — trump it";
      else if (wins) why = 'this takes the book as cheaply as possible';
      else if (led && E.effectiveSuit(card, c) !== led) why = "you're out of the suit — throw off your weakest card";
      else why = "can't win this one — throw low";
    }
    return { card, why };
  }
  function coachBidText(mustBid) {
    const r = AI.chooseBid(myHand(), G.high, G.rules, mustBid, Math.random, null, G.viewSeat);
    if (r.bid.pass) return 'Coach: pass on this one.';
    const p = r.plan;
    const where = p.type === 'notrump' ? `in No-Trump (${p.direction})` : `${p.direction} in ${E.SUIT_NAMES[p.trump]}`;
    return `Coach: bid <b>${E.describeBid(r.bid)}</b> — you look strongest ${where}, before the kitty.`;
  }

  // ---- table record ----------------------------------------------------------------
  const SOLO_REC_KEY = 'bidwhist.soloRecord';
  function soloRecord() {
    try { return JSON.parse(localStorage.getItem(SOLO_REC_KEY)) || { games: 0, wins: 0, bostons: 0 }; }
    catch (_) { return { games: 0, wins: 0, bostons: 0 }; }
  }
  function noteSoloGame(won) {
    const r = soloRecord(); r.games++; if (won) r.wins++;
    try { localStorage.setItem(SOLO_REC_KEY, JSON.stringify(r)); } catch (_) { /* ignore */ }
  }
  function noteSoloBoston() {
    const r = soloRecord(); r.bostons++;
    try { localStorage.setItem(SOLO_REC_KEY, JSON.stringify(r)); } catch (_) { /* ignore */ }
  }
  function recordHtml() {
    const R = G.view && G.view.record;
    if (!R) return '';
    const us = myTeam(), them = 1 - us;
    let html = '<div class="record"><h3>Table record</h3>';
    html += `<p>Games: ${teamLabel(us)} <b>${R.teamWins[us]}</b> · ${teamLabel(them)} <b>${R.teamWins[them]}</b>` +
      ` &nbsp;·&nbsp; Bostons: <b>${R.bostons[us]}</b>–<b>${R.bostons[them]}</b>` +
      ` &nbsp;·&nbsp; Sets: <b>${R.sets[us]}</b>–<b>${R.sets[them]}</b></p>`;
    const pairs = Object.values(R.pairs || {}).filter((p) => p.wins > 0).sort((a, b) => b.wins - a.wins || a.games - b.games);
    if (pairs.length && !Online.local) html += `<p>Best duo: <b>${pairs[0].names.join(' & ')}</b> (${pairs[0].wins}–${pairs[0].games - pairs[0].wins})</p>`;
    const players = Object.values(R.players || {}).filter((p) => p.bids > 0).sort((a, b) => (b.made / b.bids) - (a.made / a.bids) || b.bids - a.bids);
    if (players.length) html += `<p>Best bidder: <b>${players[0].name}</b> (made ${players[0].made} of ${players[0].bids})</p>`;
    if (Online.local) {
      const L = soloRecord();
      html += `<p class="lifetime">All-time vs the computer: <b>${L.wins}–${L.games - L.wins}</b> · Bostons <b>${L.bostons}</b></p>`;
    }
    return html + '</div>';
  }
  function renderRecordLine() {
    const el = $('sb-record'); if (!el) return;
    const R = G.view && G.view.record;
    if (!R || !R.games) { el.innerHTML = ''; return; }
    const us = myTeam();
    el.innerHTML = `Games won: ${teamLabel(us)} <b>${R.teamWins[us]}</b> · ${teamLabel(1 - us)} <b>${R.teamWins[1 - us]}</b>`;
  }

  function renderSetMeter() {
    const m = $('set-meter');
    if (!G.contract) { m.innerHTML = ''; return; }
    const bidTeam = G.highSeat % 2;
    const defTeam = 1 - bidTeam;
    const needed = 6 + G.contract.amount;
    const toSet = E.booksToSet(G.contract.amount);
    const defIsUs = defTeam === myTeam();
    if (G.books[bidTeam] >= needed) {
      m.innerHTML = `<span class="safe">Contract made — every extra book scores.</span>`;
    } else if (G.books[defTeam] >= toSet) {
      m.innerHTML = `<span class="danger">The bid is set — ${teamLabel(defTeam)} stopped it.</span>`;
    } else {
      m.innerHTML =
        `${teamLabel(bidTeam)} need <b>${needed - G.books[bidTeam]}</b> more to make it. ` +
        `<span class="${defIsUs ? 'safe' : 'danger'}">${teamLabel(defTeam)} need ` +
        `<b>${toSet - G.books[defTeam]}</b> to set.</span>`;
    }
  }

  // Opponents' hidden hands aren't drawn — in Bid Whist everyone always holds
  // the same number of cards, so card backs add nothing. Each seat is a clean
  // player tag (avatar + name + bid) instead. Kept as a no-op so callers stand.
  function renderOppHands() {
    for (const p of [1, 2, 3]) { const box = $('opp-hand-' + p); if (box) box.innerHTML = ''; }
  }

  // The kitty: a squared-up pile of six with the kitty card on top — or, when
  // sported, the six cards face up for the whole table.
  function renderKitty(state) {
    const k = $('kitty');
    k.innerHTML = '';
    k.className = 'kitty';
    if (state === 'gone') { k.classList.add('gone'); return; }
    if (state === 'sported') {
      k.classList.add('sported');
      for (const card of G.kitty) k.appendChild(cardEl(card, true));
      return;
    }
    k.classList.add('pile');
    for (let i = 0; i < 5; i++) {
      const c = cardEl(null, false); c.style.setProperty('--i', i); k.appendChild(c);
    }
    const top = document.createElement('div');
    top.className = 'card kitty-face'; top.style.setProperty('--i', 5);
    top.innerHTML = '<span class="kf-cat">🐱</span><span class="kf-lab">kitty</span>';
    k.appendChild(top);
  }

  // The high bidder hollers for it and the pile slides over to their seat.
  async function kittyToSeat(seat) {
    const k = $('kitty');
    if (!k || k.classList.contains('gone')) return;
    showBanner('Give me da kitty!', isMe(seat) ? '' : '&mdash; ' + seatName(seat), 1700);
    Sound.play('kitty');
    await wait(160);
    k.classList.add('taking', 'to-' + slot(seat));
    await wait(1100);
  }

  function renderSeatsMeta(turnSeat) {
    for (let seat = 0; seat < 4; seat++) {
      const plate = $('plate-' + slot(seat));
      if (!plate) continue;
      plate.classList.toggle('turn', turnSeat === seat);
      plate.classList.toggle('dealer', G.dealer === seat);
    }
  }

  // Names/roles per slot. Static in local mode; driven by the roster online
  // (partner across from you, opponents left/right, AI + disconnect flags).
  const SLOT_ROLE = ['south', 'west', 'partner', 'east'];
  function renderPlates() {
    for (let seat = 0; seat < 4; seat++) {
      const plate = $('plate-' + slot(seat));
      if (!plate) continue;
      applyAvatar(plate.querySelector('.avatar'), avatarSpecFor(seat));
      const nameEl = plate.querySelector('.pname');
      const roleEl = plate.querySelector('.prole');
      const mine = isMe(seat);
      const myName = mine ? ownName() : null;
      if (nameEl) nameEl.textContent = mine ? myName : seatName(seat);
      if (roleEl) {
        let role = mine ? (myName === 'You' ? 'add your name' : 'you')
          : Online.watching ? ['south', 'west', 'north', 'east'][slot(seat)]
          : seat === (G.viewSeat + 2) % 4 ? 'your partner' : SLOT_ROLE[slot(seat)];
        if (G.mode === 'online' && G.view && G.view.seats) {
          const s = G.view.seats[seat];
          if (s && s.kind === 'ai') role += s.left ? ' · left · bot' : ' · bot';
          else if (s && s.kind === 'human' && !s.connected) role += ' · away · bot playing';
        }
        roleEl.textContent = role;
      }
      plate.classList.toggle('you', isMe(seat));
    }
    renderPlateBooks();
  }

  // Your own name, as the table sees it (online: what the server has).
  function ownName() {
    if (G.mode === 'online' && G.view && G.view.seats && G.view.seats[G.viewSeat])
      return G.view.seats[G.viewSeat].name || G.profile.name;
    return G.profile.name || 'You';
  }

  // Gold badge on each nameplate: books that player has taken this hand.
  function renderPlateBooks(bumpSeat) {
    for (let seat = 0; seat < 4; seat++) {
      const plate = $('plate-' + slot(seat));
      const b = plate && plate.querySelector('.np-books');
      if (!b) continue;
      const n = G.contract ? (G.seatBooks[seat] || 0) : 0;
      b.textContent = n ? String(n) : '';
      b.title = n ? `${n} book${n > 1 ? 's' : ''} this hand` : '';
      b.classList.toggle('show', n > 0);
      if (seat === bumpSeat && n) replay(b, 'bump');
    }
  }

  // "+1" floats up off the seat that took the book.
  function bookPop(seat) {
    const el = $('seat-' + slot(seat));
    if (!el) return;
    const p = document.createElement('span');
    p.className = 'book-pop'; p.textContent = '+1 book';
    el.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  // Colored suit glyph + name, e.g. ♥ Hearts (red) / ♠ Spades.
  function suitHtml(suit) {
    const red = suit === 'H' || suit === 'D';
    return `<span class="chip-suit ${red ? 'red' : 'blk'}">${E.SUIT_GLYPHS[suit]} ${E.SUIT_NAMES[suit]}</span>`;
  }

  // What to show on a seat's chip. Once a trump contract is declared, the
  // winning bidder's chip reveals the suit ("4 Downtown in ♥ Hearts").
  function bidChipHtml(seat) {
    if (G.contract && seat === G.highSeat) {
      const c = G.contract;
      if (c.type === 'notrump')
        return `“${c.amount} No-Trump (${c.direction === 'uptown' ? 'high' : 'low'})”`;
      const dir = c.type === 'uptown' ? 'Uptown' : 'Downtown';
      return `“${c.amount} ${dir} in ${suitHtml(c.trump)}”`;
    }
    const bid = G.bids[seat];
    if (!bid) return null;
    return bid.pass ? '<span class="chip-pass">pass</span>' : '“' + E.describeBid(bid) + '”';
  }

  function renderBidChips() {
    for (let p = 0; p < 4; p++) {
      const c = $('chip-' + p);
      if (c) { c.classList.remove('show', 'chip-made', 'chip-set'); c.innerHTML = ''; }
    }
    for (let seat = 0; seat < 4; seat++) {
      const chip = $('chip-' + slot(seat));
      if (!chip) continue;
      const html = bidChipHtml(seat);
      if (html == null) continue;
      chip.classList.add('show');
      chip.innerHTML = html;
      // At hand's end, mark the declarer's seat made or set, right on the board.
      if (G.handResult && seat === G.handResult.highSeat) {
        const r = G.handResult;
        chip.classList.add(r.made ? 'chip-made' : 'chip-set');
        chip.insertAdjacentHTML('beforeend',
          ` <span class="chip-result">${r.made ? 'made' : 'set'} ${r.delta >= 0 ? '+' : ''}${r.delta}</span>`);
      }
    }
  }

  function renderHand() {
    const box = $('hand');
    box.innerHTML = '';
    if (!G.hands || !G.hands[G.viewSeat]) return;
    if (Online.watching) {
      for (let i = 0; i < G.hands[G.viewSeat].length; i++) box.appendChild(cardEl(null, false));
      box.classList.add('watching');
      layoutHand();
      return;
    }
    box.classList.remove('watching');
    const cards = E.sortHand(G.hands[G.viewSeat].filter((c) => !c.back), sortDirection(), G.contract);
    cards.forEach((card, i) => {
      const el = cardEl(card, true);
      // Only cards that just arrived (the deal, the kitty) animate in.
      if (!G.shownIds.has(card.id)) el.style.setProperty('--deal-delay', (i * 0.03) + 's');
      else el.classList.add('settled');
      const playable =
        (G.awaiting === 'play' && G.legalIds.has(card.id)) ||
        G.awaiting === 'discard';
      if (!playable && (G.awaiting === 'play' || G.awaiting === 'discard'))
        el.classList.add('disabled');
      if (G.awaiting === 'discard' && G.discardPicks.has(card.id))
        el.classList.add('selected');
      if (G.coachIds && G.coachIds.has(card.id)) el.classList.add('coach');
      if (playable) {
        el.setAttribute('role', 'button'); el.tabIndex = 0;
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHandCardClick(card); }
        });
      }
      el.addEventListener('click', () => onHandCardClick(card));
      box.appendChild(el);
    });
    G.shownIds = new Set(cards.map((c) => c.id));
    layoutHand();
  }

  // Fan the hand to fit whatever width this screen has. Cards overlap just
  // enough to fit; if that would leave less than a comfortable tap target
  // (e.g. 18 cards after picking up the kitty on a phone), split into two
  // overlapping rows instead.
  function layoutHand() {
    const box = $('hand');
    box.querySelectorAll('.hand-break').forEach((b) => b.remove());
    const cards = [...box.querySelectorAll('.card')];
    box.classList.remove('two-rows');
    if (!cards.length) return;
    const cw = cards[0].getBoundingClientRect().width || cards[0].offsetWidth || 74;
    const cs = getComputedStyle(box);
    const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxStep = cw * 0.7, MIN_TAP = 21; // px of each card left to tap
    // 3px of slack so sub-pixel rounding never wraps the last card onto its own line.
    const stepFor = (n) => (n <= 1 ? cw : Math.min(maxStep, (avail - cw - 3) / (n - 1)));
    let rows = 1;
    if (stepFor(cards.length) < MIN_TAP && cards.length > 9) rows = 2;
    const perRow = Math.ceil(cards.length / rows);
    const step = stepFor(perRow);
    cards.forEach((el, i) => {
      const first = i % perRow === 0;
      el.style.marginLeft = first ? '0px' : (step - cw) + 'px';
      el.classList.toggle('row2', rows === 2 && i >= perRow);
      if (rows === 2 && i === perRow) {
        const br = document.createElement('span'); br.className = 'hand-break';
        box.insertBefore(br, el);
      }
    });
    if (rows === 2) box.classList.add('two-rows');
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layoutHand, 120); });
  window.addEventListener('orientationchange', () => setTimeout(layoutHand, 250));

  function addPlayedCard(seat, card) {
    const wrap = document.createElement('div');
    wrap.className = 'played from-' + slot(seat);
    wrap.dataset.seat = String(seat);
    wrap.appendChild(cardEl(card, true));
    $('trick').appendChild(wrap);
    G.liveTrick.push({ player: seat, card });
    markWinning();
    Sound.play('card');
  }

  // Glow on whichever card is taking the book right now.
  function markWinning() {
    if (!G.contract || !G.liveTrick.length) return;
    const w = E.trickWinner(G.liveTrick, G.contract);
    for (const el of $('trick').querySelectorAll('.played'))
      el.classList.toggle('winning', el.dataset.seat === String(w));
  }

  function clearTrick() {
    const t = $('trick');
    t.className = 'trick'; t.innerHTML = '';
    G.liveTrick = [];
  }

  async function collectTrick(winnerSeat) {
    const t = $('trick');
    t.classList.add('won');
    await wait(260);
    t.classList.add('collect', 'to-' + slot(winnerSeat));
    Sound.play('collect');
    G.seatBooks[winnerSeat] = (G.seatBooks[winnerSeat] || 0) + 1;
    bookPop(winnerSeat);
    renderPlateBooks(winnerSeat);
    await wait(520);
    clearTrick();
  }

  // ---- action bar -----------------------------------------------------------

  function actionHint(text) {
    $('action-bar').innerHTML = `<div class="action-hint">${text}</div>`;
  }

  // Bidding: just the number — or the number + No-Trump. Whoever bids highest
  // takes the kitty, THEN names trump and Uptown/Downtown. A four is a four:
  // to beat it, bid five, or four No-Trump.
  function showBidPanel(mustBid) {
    const bar = $('action-bar');
    bar.innerHTML = '';
    const sel = { amount: null };

    const amounts = [];
    const amountCol = document.createElement('div'); amountCol.className = 'bid-col';
    const amountRow = document.createElement('div'); amountRow.className = 'bid-group';
    amountRow.innerHTML = '<span class="lbl">Your bid (books over six)</span>';
    for (let a = G.rules.minBid; a <= 7; a++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn'; b.textContent = String(a);
      b.addEventListener('click', () => { sel.amount = a; refresh(); });
      amounts.push({ a, b }); amountRow.appendChild(b);
    }
    amountCol.appendChild(amountRow);
    bar.appendChild(amountCol);

    const goCol = document.createElement('div'); goCol.className = 'bid-col bid-go';
    const bidBtn = document.createElement('button');
    bidBtn.type = 'button'; bidBtn.className = 'btn primary';
    const ntBtn = document.createElement('button');
    ntBtn.type = 'button'; ntBtn.className = 'btn primary nt';
    const passBtn = document.createElement('button');
    passBtn.type = 'button'; passBtn.className = 'btn ghost'; passBtn.textContent = 'Pass';
    if (mustBid) { passBtn.disabled = true; passBtn.title = 'Dealer must bid — the table passed to you.'; }
    goCol.appendChild(bidBtn); goCol.appendChild(ntBtn); goCol.appendChild(passBtn);
    bar.appendChild(goCol);

    const legal = (a, t) => E.isLegalBid({ amount: a, type: t }, G.high, G.rules);

    function refresh() {
      // default to the cheapest legal call
      if (sel.amount === null) {
        for (let a = G.rules.minBid; a <= 7; a++) if (legal(a, 'suit') || legal(a, 'notrump')) { sel.amount = a; break; }
      }
      for (const { a, b } of amounts) {
        b.disabled = !legal(a, 'suit') && !legal(a, 'notrump');
        b.classList.toggle('on', sel.amount === a);
      }
      const a = sel.amount;
      bidBtn.innerHTML = a === null ? 'Bid' : `Bid ${a}`;
      ntBtn.innerHTML = a === null ? 'No-Trump' : `Bid ${a} No<span class="nt-long">-Trump</span>`;
      bidBtn.disabled = a === null || !legal(a, 'suit');
      ntBtn.disabled = a === null || !legal(a, 'notrump');
      explain.innerHTML = a === null ? '' : bidExplain(a);
    }
    // Plain-English line: what this bid promises.
    const top = document.createElement('div');
    top.className = 'bid-explain';
    const explain = document.createElement('span');
    if (coachOn()) top.insertAdjacentHTML('beforeend', `<span class="coach-tip">${coachBidText(mustBid)}</span> `);
    top.appendChild(explain);
    bar.insertBefore(top, bar.firstChild);
    refresh();

    bidBtn.addEventListener('click', () => { if (G.resolve) G.resolve({ amount: sel.amount, type: 'suit' }); });
    ntBtn.addEventListener('click', () => { if (G.resolve) G.resolve({ amount: sel.amount, type: 'notrump' }); });
    passBtn.addEventListener('click', () => { if (G.resolve && !mustBid) G.resolve({ pass: true }); });
  }

  function bidExplain(a) {
    const R = G.rules;
    return `<b>${a}</b>: your team needs <b>${6 + a}</b> of 13 books` +
      (R.kittyIsBook ? ' (the kitty counts as one)' : '') +
      `. Win the bid, take the kitty, then name trump and Uptown or Downtown. ` +
      `<b>${a} No-Trump</b> beats a ${a}` + (R.noTrumpDoubles ? ' and scores double' : '') +
      `. They set you with <b>${8 - a}</b>.`;
  }

  // You won the bid and the kitty's in your hand: pick the trump suit AND
  // the direction, then confirm.
  function showDeclareSuit() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint declare-hint">You won it — the kitty&rsquo;s in your hand. Name trump and pick a direction:</div>';
    const sel = { trump: null, direction: null };
    const hand = G.hands[G.viewSeat].filter((c) => !c.back);
    const suitRow = document.createElement('div'); suitRow.className = 'bid-group';
    const suitBtns = {};
    for (const s of E.SUITS) {
      const count = hand.filter((c) => c.suit === s).length;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn wide suit-pick suit-' + s + ((s === 'H' || s === 'D') ? ' red' : '');
      b.innerHTML = `${E.SUIT_GLYPHS[s]} <small>${E.SUIT_NAMES[s]} (${count})</small>`;
      b.title = E.SUIT_NAMES[s];
      b.addEventListener('click', () => { sel.trump = s; refresh(); });
      suitBtns[s] = b; suitRow.appendChild(b);
    }
    const dirRow = document.createElement('div'); dirRow.className = 'bid-group';
    const dirBtns = {};
    for (const [d, label] of [['uptown', 'Uptown <small>(high wins)</small>'], ['downtown', 'Downtown <small>(low wins)</small>']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn wide'; b.innerHTML = label;
      b.addEventListener('click', () => { sel.direction = d; refresh(); });
      dirBtns[d] = b; dirRow.appendChild(b);
    }
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'btn primary';
    go.addEventListener('click', () => { if (sel.trump && sel.direction && G.resolve) G.resolve({ trump: sel.trump, direction: sel.direction }); });
    function refresh() {
      for (const s of E.SUITS) suitBtns[s].classList.toggle('on', sel.trump === s);
      for (const d of Object.keys(dirBtns)) dirBtns[d].classList.toggle('on', sel.direction === d);
      go.disabled = !(sel.trump && sel.direction);
      go.textContent = sel.trump && sel.direction
        ? `${E.SUIT_NAMES[sel.trump]} · ${sel.direction === 'uptown' ? 'Uptown' : 'Downtown'}`
        : 'Name Trump';
    }
    bar.appendChild(suitRow); bar.appendChild(dirRow); bar.appendChild(go);
    refresh();
  }

  function showDeclareDirection() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint">You won it in No-Trump — the kitty&rsquo;s in your hand. Which way does it run?</div>';
    const row = document.createElement('div'); row.className = 'bid-group';
    for (const [d, label] of [['uptown', 'Uptown (high wins)'], ['downtown', 'Downtown (low wins)']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn wide'; b.textContent = label;
      b.addEventListener('click', () => { if (G.resolve) G.resolve(d); });
      row.appendChild(b);
    }
    bar.appendChild(row);
  }

  function kittySize() { return (G.view && G.view.kittySize) || 6; }

  function showDiscardBar() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint" id="discard-hint"></div>';
    const auto = document.createElement('button');
    auto.type = 'button'; auto.className = 'btn ghost'; auto.textContent = 'Auto-pick';
    auto.addEventListener('click', () => {
      G.discardPicks = new Set(AI.chooseDiscards(G.hands[G.viewSeat], G.contract).map((c) => c.id));
      renderHand(); updateDiscardBar();
    });
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'btn primary'; done.id = 'btn-discard-done';
    done.textContent = kittySize() === 4 ? 'Bury Four' : 'Bury Six';
    done.addEventListener('click', () => {
      if (G.discardPicks.size === kittySize() && G.resolve) G.resolve(null);
    });
    bar.appendChild(auto); bar.appendChild(done);
    updateDiscardBar();
  }

  function updateDiscardBar() {
    const hint = $('discard-hint');
    const done = $('btn-discard-done');
    if (!hint || !done) return;
    const k = kittySize();
    hint.textContent = `The kitty is yours — pick ${k === 4 ? 'four' : 'six'} to bury (${G.discardPicks.size}/${k}).` +
      (G.rules.kittyIsBook ? ' They count as your first book.' : '');
    done.disabled = G.discardPicks.size !== k;
  }

  // ---- your input -----------------------------------------------------------

  function onHandCardClick(card) {
    if (G.awaiting === 'play' && G.legalIds.has(card.id)) {
      const chosen = card;
      if (G.resolve) G.resolve(chosen);
    } else if (G.awaiting === 'discard') {
      if (G.discardPicks.has(card.id)) G.discardPicks.delete(card.id);
      else if (G.discardPicks.size < kittySize()) G.discardPicks.add(card.id);
      renderHand(); updateDiscardBar();
    }
  }

  // ---- online play ----------------------------------------------------------
  // The server owns the game. We render its per-player snapshots, animate the
  // event stream, and — on our turn — reuse the very same input panels as local
  // play by pointing G.resolve at an intent-sender instead of a local promise.

  const Online = {
    base: '', code: '', name: '', token: null, isHost: false,
    conn: null, queue: [], draining: false, started: false, local: false, watching: false,
  };

  // ---- solo -------------------------------------------------------------------
  // Solo runs the exact same room engine as online play (js/room-core.js), just
  // in the browser: a local "connection" hands it your moves and feeds its
  // snapshots back through the same renderer. One game, two transports.
  function startSolo() {
    const room = new RoomCore.Room('SOLO', E.cleanRules(G.nextRules || G.rules));
    G.nextRules = null;
    room.learner = G.learner; // the table keeps learning across games this session
    let token = null;
    const deliver = (obj) => setTimeout(() => onServerMessage(obj), 0);
    const conn = {
      local: true, room,
      send(msg) {
        let out = null;
        switch (msg.type) {
          case 'hello': {
            const r = room.join(msg.name, msg.avatar); token = r.token;
            deliver({ type: 'welcome', token, seat: r.seat, host: true });
            return;
          }
          case 'start': out = room.start(token); break;
          case 'nextHand': out = room.nextHand(token); break;
          case 'intent': out = room.submit(token, msg.intent); break;
          case 'profile': out = room.setProfile(token, msg.name, msg.avatar); break;
          case 'react': out = room.react(token, msg.id); break;
          case 'say': out = room.say(token, msg.text); break;
          case 'rules': out = room.setRules(token, msg.rules); break;
          case 'renege': out = room.callRenege(token); break;
          default: return;
        }
        if (out && out.error) deliver({ type: 'error', error: out.error });
        else deliver({ type: 'state', view: room.viewFor(token), events: (out && out.events) || [] });
      },
      close() { /* nothing to close */ },
    };
    Object.assign(Online, { base: '', code: 'SOLO', isHost: true, queue: [], draining: false, started: false, local: true, watching: false, conn });
    G.mode = 'local'; G.viewSeat = 0; G.running = true; G.view = null;
    G.memory = new Set(); G.liveTrick = []; G.seatBooks = [0, 0, 0, 0];
    $('log').innerHTML = '';
    for (const id of ['modal-summary', 'modal-gameover']) $(id).classList.remove('show');
    clearTrick();
    conn.send({ type: 'hello', name: G.profile.name, avatar: G.profile.avatar });
    conn.send({ type: 'start' });
  }

  function tokenKey(code) { return 'bidwhist.token.' + code; }

  // A shareable deep link that carries the game key AND the host's actual server,
  // so a friend who opens it lands pre-filled and ready to join — regardless of
  // what default server their own app has.
  function inviteLink(code) {
    const base = location.origin + location.pathname;
    let link = base + '#join=' + encodeURIComponent(code);
    // Only carry the server when it isn't simply this site (keeps the link and
    // QR short in the normal one-Worker setup).
    const srv = Online.base || Net.serverBase();
    if (srv && srv !== location.origin) link += '&s=' + encodeURIComponent(srv);
    return link;
  }
  function copyText(text, btn, label) {
    const done = () => { if (btn) { btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = label), 1400); } };
    const fail = () => { try { window.prompt('Copy this:', text); } catch (_) { /* ignore */ } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  }

  // A friend opened an invite link (#join=CODE&s=SERVER): save the server, open
  // the online panel with the key pre-filled, ready for one tap on Join.
  function handleDeepLink() {
    const h = location.hash || '';
    const m = h.match(/join=([A-Za-z0-9]{3,8})/i);
    if (!m) return false;
    const code = m[1].toUpperCase();
    const sm = h.match(/[&#?]s=([^&]+)/);
    if (sm) { try { Net.saveServer(decodeURIComponent(sm[1])); } catch (_) { /* ignore */ } }
    $('splash').classList.remove('show');
    openOnlineSetup();
    $('join-code').value = code;
    const note = document.querySelector('#modal-online .modal-note');
    if (note) note.textContent = `You've been invited to table ${code} — just tap “Join a Table”.`;
    return true;
  }

  function openOnlineSetup() {
    $('online-error').textContent = '';
    $('online-server').value = Net.serverBase();
    $('online-advanced').open = !Net.serverBase(); // only shown when there's no default
    renderOnlineProfile();
    $('modal-online').classList.add('show');
  }

  // Show the current player (avatar + name) in the online setup.
  function renderOnlineProfile() {
    applyAvatar($('online-avatar'), avatarFrom(G.profile.avatar, 'you#0'));
    $('online-pname').textContent = G.profile.name;
  }
  function renderSplashProfile() {
    applyAvatar($('splash-avatar'), avatarFrom(G.profile.avatar, 'you#0'));
    $('splash-pname').textContent = G.profile.name;
  }

  async function hostTable() {
    const base = readServer();
    if (!base) return;
    setOnlineError('Creating table…');
    try {
      const code = await Net.newCode(base);
      connectRoom(base, code, true);
    } catch (e) {
      showServerProblem('Could not reach the game server. (' + (e.message || e) + ')');
    }
  }

  function joinTable() {
    const base = readServer();
    const code = ($('join-code').value || '').trim().toUpperCase();
    if (!base) return;
    if (!/^[A-Z0-9]{3,6}$/.test(code)) return setOnlineError('Enter a valid game key.');
    connectRoom(base, code, false);
  }

  function readServer() {
    const base = ($('online-server').value || '').trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(base)) { showServerProblem('Enter your server URL (https://…workers.dev).'); return ''; }
    Net.saveServer(base);
    return base;
  }
  function setOnlineError(msg) { $('online-error').textContent = msg || ''; }
  // Connection trouble: say so and reveal the (normally hidden) server field.
  function showServerProblem(msg) { setOnlineError(msg); $('online-advanced').open = true; }

  function connectRoom(base, code, isHost) {
    Object.assign(Online, { base, code, isHost, queue: [], draining: false, started: false, local: false, watching: false });
    let saved = null;
    try { saved = localStorage.getItem(tokenKey(code)); } catch (_) { /* ignore */ }
    Online.token = saved;
    setOnlineError('Connecting…');
    Online.conn = Net.connect(base, code, {
      onOpen() {
        Online.conn.send({
          type: 'hello', name: G.profile.name, avatar: G.profile.avatar,
          token: saved || undefined,
        });
      },
      onMessage: onServerMessage,
      onClose() { if (Online.started) $('modal-disconnect').classList.add('show'); },
      onError() { showServerProblem('Connection error — could not open the table.'); },
    });
  }

  function onServerMessage(msg) {
    if (msg.type === 'welcome') {
      Online.token = msg.token;
      Online.isHost = !!msg.host;
      Online.watching = !!msg.watcher && !msg.token;
      if (!Online.local && msg.token) { try { localStorage.setItem(tokenKey(Online.code), msg.token); } catch (_) { /* ignore */ } }
      G.mode = Online.local ? 'local' : 'online';
      G.viewSeat = msg.seat != null ? msg.seat : 0;
      G.running = true;
      setOnlineError('');
      $('modal-online').classList.remove('show');
      return;
    }
    if (msg.type === 'error') {
      const human = {
        full: 'That table is full.', 'not-host': 'Only the host can do that.',
        'not-your-turn': 'Hold on — not your turn.', 'illegal-bid': 'That bid isn\'t legal.',
        'illegal-play': 'You can\'t play that card.', 'slow-down': 'Easy — one reaction at a time.',
        'between-hands': 'Rule changes apply between hands.',
      }[msg.error] || ('Server: ' + msg.error);
      if (!Online.started) setOnlineError(human); else tableMsg(human);
      return;
    }
    if (msg.type === 'state') {
      Online.queue.push(msg);
      drainOnline();
    }
  }

  async function drainOnline() {
    if (Online.draining) return;
    Online.draining = true;
    while (Online.queue.length) {
      const msg = Online.queue.shift();
      PACE = Online.local ? PACE_SOLO : PACE_ONLINE;
      G.view = msg.view; // expose the fresh roster so names resolve during animation
      await animateEvents(msg.events || []);
      applyView(msg.view);
    }
    Online.draining = false;
  }

  const PACE_ONLINE = { bid: 480, play: 560, trick: 820 };
  const PACE_SOLO = { bid: 760, play: 680, trick: 900 };
  let PACE = PACE_ONLINE;

  async function animateEvents(events) {
    for (const ev of events) {
      switch (ev.t) {
        case 'deal':
          G.bids = [null, null, null, null];
          G.handResult = null;
          G.dealer = ev.dealer; G.handNo = ev.handNo;
          G.seatBooks = [0, 0, 0, 0]; G.contract = null; G.memory = new Set(); G.lastTrick = null;
          clearTrick(); renderPlateBooks(); renderTrumpBadge();
          log(`— Hand ${ev.handNo}. <b>${seatName(ev.dealer)}</b> ${seatVerb(ev.dealer, 'deal')}. —`, true);
          Sound.play('shuffle');
          $('modal-summary').classList.remove('show');
          $('modal-gameover').classList.remove('show');
          tableMsg('');
          break;
        case 'bid':
          G.bids[ev.seat] = ev.bid;
          renderBidChips();
          log(ev.bid.pass
            ? `${seatName(ev.seat)} ${seatVerb(ev.seat, 'pass')}.`
            : `<b>${seatName(ev.seat)}</b> ${seatVerb(ev.seat, 'bid')} <b>${E.describeBid(ev.bid)}</b>.`);
          await wait(PACE.bid);
          break;
        case 'auction':
          tableMsg('');
          log(`<b>${seatName(ev.highSeat)}</b> won the auction at <b>${E.describeBid(ev.bid)}</b>.`, true);
          break;
        case 'throwin':
          log('All four pass — cards go in. New deal.', true);
          await wait(400);
          break;
        case 'declare': {
          const c = ev.contract; G.contract = c; G.highSeat = ev.seat;
          renderContractLine();
          log(`<b>${seatName(ev.seat)}</b> ${c.type === 'notrump'
            ? seatVerb(ev.seat, 'call') + ' No-Trump, running ' + (c.direction === 'uptown' ? 'uptown' : 'downtown')
            : seatVerb(ev.seat, 'name') + ' <b>' + E.SUIT_NAMES[c.trump] + '</b> trump, ' + c.type}.`, true);
          // Nobody plays until the call has been announced to the table.
          await announceContract(ev.seat, c);
          break;
        }
        case 'kitty':
          if (ev.sport && ev.cards) {
            G.kitty = ev.cards; renderKitty('sported');
            tableMsg(`${seatName(ev.seat)} sports the kitty.`);
            await wait(1800); tableMsg('');
            showBanner('Give me da kitty!', isMe(ev.seat) ? '' : '&mdash; ' + seatName(ev.seat), 1500);
          } else {
            await kittyToSeat(ev.seat);
          }
          renderKitty('gone');
          break;
        case 'leadturn':
          tableMsg(isMe(ev.seat) ? 'You lead.' : seatName(ev.seat) + ' leads.');
          break;
        case 'play':
          G.memory.add(ev.card.id);
          addPlayedCard(ev.seat, ev.card);
          if (!isMe(ev.seat)) { G.hands[ev.seat] && G.hands[ev.seat].pop(); renderOppHands(); if (ev.seat === G.viewSeat) renderHand(); }
          else if (G.hands && G.hands[ev.seat]) {
            // Your card leaves your hand the moment it's on the felt.
            G.hands[ev.seat] = G.hands[ev.seat].filter((c) => c.id !== ev.card.id);
            renderHand();
          }
          tableMsg('');
          await wait(PACE.play);
          break;
        case 'trick':
          await wait(PACE.trick - PACE.play);
          {
            const w = (ev.cards || []).find((p) => p.player === ev.winner);
            log(`<b>${seatName(ev.winner)}</b> ${seatVerb(ev.winner, 'take')} the book` + (w ? ` (${E.cardLabel(w.card)}).` : '.'));
            G.lastTrick = { cards: (ev.cards || []).map((p) => ({ seat: p.player, card: p.card })), winner: ev.winner };
          }
          await collectTrick(ev.winner);
          break;
        case 'discard':
          if (!isMe(ev.seat)) log(`${seatName(ev.seat)} takes the kitty and buries ${kittySize() === 4 ? 'four' : 'six'}.`);
          break;
        case 'react':
          showReaction(ev.seat, ev.id);
          break;
        case 'say':
          showBubble(ev.seat, ev.text);
          log(`<b>${esc(seatName(ev.seat))}</b>: ${esc(ev.text)}`);
          break;
        case 'renege':
          if (ev.ok) {
            const msg = `${seatName(ev.caller)} ${ev.atCount ? 'caught' : seatVerb(ev.caller, 'call')} a renege on ${seatName(ev.offender)}` +
              (ev.atCount ? ' at the count' : '') + ` — ${ev.books} books go to ${teamLabel(ev.caller % 2)}.`;
            log(`<b>${msg}</b>`, true);
            showBanner('Renege!', `${seatName(ev.offender)} &mdash; ${ev.books} books`, 1900);
            Sound.play('set');
          } else {
            log(`${seatName(ev.caller)} ${seatVerb(ev.caller, 'call')} renege — no renege found. Play on.`);
          }
          await wait(500);
          break;
        case 'timeout':
          log(`${seatName(ev.seat)} ran out of time — the computer moved for ${isMe(ev.seat) ? 'you' : 'them'}.`);
          break;
        case 'sitIn':
          log(`<b>${ev.name}</b> sat down at the table.`, true);
          break;
        case 'rules':
          log('Table rules updated for the next hand.', true);
          break;
        case 'handend':
          if (Online.local) {
            maybeShowRead();
            if (ev.result.boston && ev.result.bidTeam === myTeam()) noteSoloBoston();
          }
          G.handResult = { highSeat: ev.result.highSeat, made: ev.result.made, delta: ev.result.delta };
          renderBidChips();
          showOnlineSummary(ev.result);
          await wait(300);
          break;
        case 'lobby':
          log('Back in the lobby — rearrange seats, then start a new game.', true);
          break;
        case 'botTakeover':
          log(`<b>${ev.name || 'A player'}</b> left the table — a bot takes the seat.`, true);
          break;
        case 'gameover':
          if (Online.local) noteSoloGame(ev.winner === myTeam());
          showOnlineGameover(ev.winner, ev.scores);
          await wait(200);
          break;
        default: break;
      }
    }
  }

  // Turn timer (online, host's choice): a countdown on the player who's up.
  let clockTimer = null;
  function startTurnClock(view) {
    clearInterval(clockTimer); clockTimer = null;
    document.querySelectorAll('.np-timer').forEach((x) => x.remove());
    if (view.turnMsLeft == null || view.turn == null) return;
    const end = Date.now() + view.turnMsLeft;
    const plate = $('plate-' + slot(view.turn)); if (!plate) return;
    const t = document.createElement('span'); t.className = 'np-timer'; plate.appendChild(t);
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      t.textContent = left + 's';
      t.classList.toggle('low', left <= 10);
      if (left === 10 && isMe(view.turn)) { Sound.play('turn'); announce('Ten seconds left.'); }
      if (left <= 0) { clearInterval(clockTimer); clockTimer = null; }
    };
    tick(); clockTimer = setInterval(tick, 1000);
  }

  function applyView(view) {
    G.view = view;
    // Your seat can change in the lobby when you switch teams.
    const meSeat = view.seats && view.seats.find((x) => x.you);
    if (meSeat) G.viewSeat = meSeat.seat;
    if (view.rules) G.rules = Object.assign({}, G.rules, view.rules);
    G.scores = view.scores.slice();
    G.books = view.books.slice();
    if (view.seatBooks) G.seatBooks = view.seatBooks.slice();
    G.handNo = view.handNo;
    G.dealer = view.dealer;
    G.highSeat = view.high ? view.high.seat : null;
    G.high = view.high ? { amount: view.high.amount, type: view.high.type, _seat: view.high.seat } : null;
    G.contract = view.contract;
    G.bids = view.bids.slice();
    G.hands = [0, 1, 2, 3].map((s) => {
      if (view.you && s === view.you.seat) return view.you.hand;
      const n = view.counts[s] || 0;
      const arr = []; for (let i = 0; i < n; i++) arr.push({ id: 'b' + s + '_' + i, back: true });
      return arr;
    });
    G.kitty = new Array(view.kittySize || 6).fill(null);
    G.lastTrick = view.lastTrick || G.lastTrick;

    Online.watching = !!view.watching && !view.you;
    if (view.phase === 'lobby') {
      $('modal-summary').classList.remove('show');
      $('modal-gameover').classList.remove('show');
      clearTrick();
      G.handResult = null; G.contract = null;
      showLobby(view); return;
    }
    Online.started = true;
    $('splash').classList.remove('show');
    $('modal-online').classList.remove('show');
    $('modal-lobby').classList.remove('show');

    Online.watching = !!view.watching && !view.you;
    renderScores(); renderContractLine(); renderPlates(); renderRecordLine();
    renderOppHands(); renderBidChips(); renderSeatsMeta(view.turn);
    startTurnClock(view);
    // The pile sits on the felt through the bidding; the high bidder takes it
    // the moment the auction closes.
    renderKitty(view.phase === 'bidding' ? 'back' : 'gone');
    renderHand();
    setupTurn(view);
  }

  function setupTurn(view) {
    const mine = view.you && view.turn === view.you.seat && view.need;
    G.coachIds = null;
    if (Online.watching) {
      G.awaiting = null; G.resolve = null; G.legalIds = new Set();
      renderHand();
      const open = view.seats.some((x) => x.kind === 'empty' || x.kind === 'ai');
      actionHint(`You're watching${view.turn != null ? ` — <b>${seatName(view.turn)}</b> is up` : ''}.`);
      if (open) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn primary'; b.textContent = 'Take a seat';
        b.addEventListener('click', () => Online.conn && Online.conn.send({ type: 'sit' }));
        $('action-bar').appendChild(b);
      }
      return;
    }
    if (!mine) {
      G.awaiting = null; G.resolve = null; G.legalIds = new Set();
      renderHand();
      if (view.phase === 'handover') actionHint(view.result && view.hostToken ? 'Deal the next hand when ready.' : 'Hand over.');
      else if (view.phase === 'gameover') actionHint('&nbsp;');
      else actionHint(view.turn != null ? `Waiting on <b>${seatName(view.turn)}</b>…` : '&nbsp;');
      return;
    }
    G._sent = false;
    if (Online.lastCue !== view.need + ':' + view.handNo + ':' + (view.counts || []).join(',')) {
      Online.lastCue = view.need + ':' + view.handNo + ':' + (view.counts || []).join(',');
      if (view.need === 'bid' || view.need === 'play') { Sound.play('turn'); Sound.buzz(12); }
      announce({ bid: 'Your turn to bid.', play: 'Your turn to play.', discard: 'Pick cards to bury.',
        'declare-suit': 'Name your trump.', 'declare-dir': 'Pick uptown or downtown.' }[view.need] || 'Your turn.');
    }
    const send = (intent) => {
      if (G._sent) return;
      G._sent = true; G.resolve = null; G.awaiting = null; G.legalIds = new Set();
      Online.conn.send({ type: 'intent', intent });
      actionHint('&nbsp;'); renderHand();
    };
    if (view.need === 'bid') {
      G.resolve = (bid) => send({ type: 'bid', bid });
      showBidPanel(!!(view.you && view.you.mustBid));
      tableMsg('Your call.');
    } else if (view.need === 'declare-suit') {
      G.resolve = (d) => send({ type: 'declare', trump: d.trump, direction: d.direction });
      showDeclareSuit();
      if (coachOn()) {
        const d = AI.chooseDeclare(myHand(), 'suit');
        coachLine(`Coach: name <b>${E.SUIT_GLYPHS[d.trump]} ${E.SUIT_NAMES[d.trump]}, ${d.direction === 'uptown' ? 'Uptown' : 'Downtown'}</b> — your strongest pick with the kitty.`);
      }
    } else if (view.need === 'declare-dir') {
      G.resolve = (dir) => send({ type: 'declare', direction: dir });
      showDeclareDirection();
      if (coachOn()) {
        const up = AI.chooseDeclare(myHand(), 'notrump').direction === 'uptown';
        coachLine(`Coach: run it <b>${up ? 'Uptown' : 'Downtown'}</b> — your ${up ? 'high' : 'low'} cards are stronger.`);
      }
    } else if (view.need === 'discard') {
      G.awaiting = 'discard'; G.discardPicks = new Set();
      G.resolve = () => send({ type: 'discard', cardIds: [...G.discardPicks] });
      if (coachOn()) G.coachIds = new Set(AI.chooseDiscards(myHand(), G.contract).map((c) => c.id));
      renderHand(); showDiscardBar();
      if (coachOn()) coachLine("Coach: the outlined cards are the ones I'd bury.");
    } else if (view.need === 'play') {
      G.awaiting = 'play';
      G.legalIds = new Set(view.you.legalIds || []);
      G.resolve = (card) => send({ type: 'play', cardId: card.id });
      const ntJokerHold = G.contract && G.contract.type === 'notrump' && !(view.trick && view.trick.length) &&
        myHand().some((c) => c.joker && !G.legalIds.has(c.id));
      let tip = '';
      if (coachOn()) {
        const s2 = coachPlay(view);
        G.coachIds = new Set([s2.card.id]);
        tip = `Coach: ${E.cardLabel(s2.card)} — ${s2.why}.`;
      }
      renderHand(); actionHint('Your play.' + (ntJokerHold ? ' (Jokers are throw-offs in No-Trump — no leading them.)' : ''));
      if (tip) coachLine(tip);
    }
  }

  function coachLine(html) {
    const d = document.createElement('div'); d.className = 'coach-tip'; d.innerHTML = html;
    $('action-bar').insertBefore(d, $('action-bar').firstChild);
  }

  // Lobby: two team cards. Picking a team picks your partner; the first player
  // on a team is its captain and gets an editable team name.
  const teamNameInputs = {};
  let pendingLobby = null; // a lobby update that arrived while the captain was typing
  let hostPick = null;     // host seat-assign: the seat tapped first
  function teamNameInput(team) {
    if (teamNameInputs[team]) return teamNameInputs[team];
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 18; inp.className = 'team-name-input';
    inp.setAttribute('aria-label', 'Team name'); inp.autocomplete = 'off';
    let t = null;
    const send = () => Online.conn && Online.conn.send({ type: 'teamName', team, name: inp.value });
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(send, 450); });
    inp.addEventListener('change', () => { clearTimeout(t); send(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (pendingLobby) { const v = pendingLobby; pendingLobby = null; showLobby(v); }
    }, 0));
    teamNameInputs[team] = inp;
    return inp;
  }

  function showLobby(view) {
    // Don't rebuild under the captain's fingers — apply once they finish typing.
    if (Object.values(teamNameInputs).some((i) => i === document.activeElement)) { pendingLobby = view; return; }
    $('lobby-code').textContent = Online.code;
    const link = inviteLink(Online.code);
    if (window.QRCode) QRCode.render($('lobby-qr'), link);
    const box = $('lobby-teams');
    box.innerHTML = '';
    if (hostPick !== null && (!view.hostToken || hostPick > 3)) hostPick = null;
    const pickName = hostPick !== null ? (view.seats[hostPick].you ? 'yourself' : (view.seats[hostPick].name || 'the open seat')) : '';
    $('teams-hint').textContent = !view.hostToken
      ? 'Pick a team to choose your partner. The first player on a team is its captain and names it.'
      : hostPick !== null
        ? `Now tap the seat to move ${pickName} to (tap again to cancel).`
        : 'You’re the host: tap a player, then tap a seat to move them. Add or kick bots to open seats for friends.';
    $('teams-hint').classList.toggle('active', hostPick !== null);
    const me = view.seats.find((x) => x.you);
    const myTeamNow = me ? me.team : null;
    for (const team of [0, 1]) {
      const info = (view.teams && view.teams[team]) || { name: team ? 'Team B' : 'Team A' };
      const card = document.createElement('div');
      card.className = 'team-card team-' + (team ? 'b' : 'a') + (myTeamNow === team ? ' mine' : '');

      const head = document.createElement('div'); head.className = 'team-head';
      if (info.youAreCaptain) {
        const inp = teamNameInput(team);
        inp.value = info.name;
        head.appendChild(inp);
        head.insertAdjacentHTML('beforeend', '<span class="team-captain">★ You’re captain — name your team</span>');
      } else {
        const h = document.createElement('h3'); h.className = 'team-title'; h.textContent = info.name;
        head.appendChild(h);
        const cap = view.seats[info.captainSeat];
        const c = document.createElement('span'); c.className = 'team-captain';
        c.textContent = cap ? `★ Captain: ${cap.name || 'Player'}` : 'No captain yet — join to name it';
        head.appendChild(c);
      }
      card.appendChild(head);

      const ul = document.createElement('ul'); ul.className = 'roster';
      for (const seatNo of [team, team + 2]) {
        const s = view.seats[seatNo];
        const li = document.createElement('li');
        const av = document.createElement('span'); av.className = 'avatar';
        if (s.kind === 'empty') { av.classList.add('seat-empty'); av.textContent = '+'; }
        else applyAvatar(av, avatarFrom(s.avatar, (s.name || 'seat') + '#' + s.seat));
        const nm = document.createElement('span'); nm.className = 'r-name';
        nm.textContent = s.kind === 'empty' ? (view.hostToken ? 'Open' : 'Open seat') : (s.name || 'Player');
        if (s.seat === info.captainSeat) { nm.insertAdjacentHTML('afterbegin', '<span class="cap-star" title="Team captain">★</span>'); }
        li.appendChild(av); li.appendChild(nm);
        const tags = [];
        if (s.you) tags.push('<span class="r-tag you">you</span>');
        if (s.isHost) tags.push('<span class="r-tag host">host</span>');
        if (s.kind === 'ai' && !view.hostToken) tags.push('<span class="r-tag">bot</span>'); // host sees a Kick button instead
        else if (s.kind === 'human' && !s.connected) tags.push('<span class="r-tag">away</span>');
        li.insertAdjacentHTML('beforeend', tags.join(''));
        if (view.hostToken) {
          // Host: tap a seat, then another, to swap them; add or kick bots.
          li.classList.add('assignable');
          if (hostPick === s.seat) li.classList.add('picked');
          else if (hostPick !== null) li.classList.add('drop-target');
          li.addEventListener('click', () => {
            if (hostPick === null) hostPick = s.seat;
            else if (hostPick === s.seat) hostPick = null;
            else { Online.conn && Online.conn.send({ type: 'seatSwap', a: hostPick, b: s.seat }); hostPick = null; }
            showLobby(G.view);
          });
          const act = (label, type) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'seat-act'; b.textContent = label;
            b.addEventListener('click', (e) => { e.stopPropagation(); hostPick = null; Online.conn && Online.conn.send({ type, seat: s.seat }); });
            li.appendChild(b);
          };
          if (s.kind === 'ai') act('Kick', 'kickBot');
          else if (s.kind === 'empty') act('+ Bot', 'addBot');
        }
        ul.appendChild(li);
      }
      card.appendChild(ul);

      if (me && myTeamNow !== team) {
        const open = [team, team + 2].some((n) => view.seats[n].kind === 'empty');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn ghost small join-team';
        btn.textContent = open ? `Join ${info.name}` : 'Team full';
        btn.disabled = !open;
        btn.addEventListener('click', () => Online.conn && Online.conn.send({ type: 'team', team }));
        card.appendChild(btn);
      } else if (me) {
        card.insertAdjacentHTML('beforeend', '<p class="team-you">Your team</p>');
      }
      box.appendChild(card);
    }
    $('btn-start-online').style.display = view.hostToken ? '' : 'none';
    $('lobby-wait').style.display = view.hostToken || Online.watching ? 'none' : '';
    const canSit = Online.watching && view.seats.some((x) => x.kind === 'empty' || x.kind === 'ai');
    $('btn-sit').hidden = !canSit;
    if (Online.watching) {
      $('teams-hint').textContent = canSit ? 'You\'re watching. Grab the open seat — or keep watching.'
        : 'The table\'s full — you\'re watching. You can take a seat if one opens.';
    }
    $('lobby-watchers').textContent = view.watchers ? `${view.watchers} watching` : '';
    renderLobbyMe(view);
    $('modal-online').classList.remove('show');
    $('splash').classList.remove('show');
    $('modal-lobby').classList.add('show');
  }

  // "Playing as" strip in the lobby: your name + avatar as the table sees
  // them, with a button to change them before the deal.
  function renderLobbyMe(view) {
    const me = view.seats.find((x) => x.you);
    $('lobby-me').hidden = !me;
    if (!me) return;
    applyAvatar($('lobby-avatar'), avatarFrom(me.avatar || G.profile.avatar, (me.name || 'seat') + '#' + me.seat));
    $('lobby-pname').textContent = me.name || G.profile.name;
  }

  function showOnlineSummary(r) {
    const bidTeam = r.bidTeam;
    const stamp = $('summary-stamp');
    stamp.className = 'stamp ' + (r.made ? 'made' : 'set');
    stamp.textContent = r.made ? (r.boston ? 'BOSTON!' : 'BID MADE') : 'SET!';
    $('summary-title').textContent = `${seatName(r.highSeat)} bid ${r.contract ? E.describeContract(r.contract) : E.describeBid(r.bid)}`;
    const us = myTeam(), them = 1 - us;
    const deltaCls = (bidTeam === myTeam() ? r.delta >= 0 : r.delta < 0) ? 'pos' : 'neg';
    $('summary-body').innerHTML =
      `${teamLabel(bidTeam)} took <b>${r.books[bidTeam]}</b> of 13 books — needed <b>${r.needed}</b>.` +
      `<span class="delta ${deltaCls}">${r.delta >= 0 ? '+' : ''}${r.delta} ${teamLabel(bidTeam)}</span>` +
      `Score: ${teamLabel(us)} <b>${r.scores[us]}</b> · ${teamLabel(them)} <b>${r.scores[them]}</b>`;
    const btn = $('btn-next-hand');
    btn.textContent = Online.local ? 'Next Hand' : amHost() ? 'Deal Next Hand' : 'Waiting for host…';
    btn.disabled = !amHost();
    if (r.penalties && r.penalties.length)
      $('summary-body').insertAdjacentHTML('afterbegin', `<span class="renege-note">Renege penalty: ${r.penalties.map((p) => `${seatName(p.seat)} −${p.books}`).join(', ')} books</span>`);
    const wasOpen = $('modal-summary').classList.contains('show');
    $('modal-summary').classList.add('show');
    if (!wasOpen) celebrate('modal-summary', !r.made ? 'set' : r.boston ? 'boston' : 'made', bidTeam === myTeam());
  }

  function showOnlineGameover(winner, scores) {
    const us = myTeam();
    const iWon = winner === us;
    const stamp = $('gameover-stamp');
    stamp.className = 'stamp ' + (iWon ? 'made' : 'set');
    stamp.textContent = iWon ? 'GAME' : 'BUSTED';
    $('gameover-title').textContent = iWon ? `${teamNames(us)} take the game!` : `${teamNames(1 - us)} take the game.`;
    $('gameover-body').innerHTML = `Final: ${teamLabel(us)} <b>${scores[us]}</b> · ${teamLabel(1 - us)} <b>${scores[1 - us]}</b>.` + recordHtml();
    const btn = $('btn-rematch');
    btn.textContent = amHost() ? 'Run It Back' : 'Waiting for host…';
    btn.disabled = !amHost();
    $('btn-to-lobby').hidden = Online.local || !amHost();
    const wasOpen = $('modal-gameover').classList.contains('show');
    $('modal-gameover').classList.add('show');
    if (!wasOpen) celebrate('modal-gameover', iWon ? 'win' : 'set', true);
  }

  // ---- profile editor -------------------------------------------------------

  let editorImg = null;      // pending uploaded image data URL
  let editorCartoon = null;  // pending cartoon spec (overrides the image)

  function openProfileEditor() {
    editorImg = G.profile.avatar;
    editorCartoon = null;
    $('profile-name').value = G.profile.name === 'You' ? '' : G.profile.name;
    $('profile-error').textContent = '';
    refreshProfilePreview();
    $('modal-profile').classList.add('show');
  }
  function refreshProfilePreview() {
    applyAvatar($('profile-preview'), editorCartoon || avatarFrom(editorImg || G.profile.avatar, 'you#0'));
  }
  function saveProfileFromEditor() {
    const name = ($('profile-name').value || '').trim().slice(0, 16) || 'You';
    let avatar = G.profile.avatar;
    if (editorCartoon) avatar = editorCartoon.code;
    else if (editorImg) avatar = editorImg;
    G.profile = { name, avatar };
    saveProfile(G.profile);
    $('modal-profile').classList.remove('show');
    renderPlates();
    renderOnlineProfile();
    renderSplashProfile();
    if (Online.conn) Online.conn.send({ type: 'profile', name, avatar });
  }

  // ---- settings -------------------------------------------------------------

  const RULE_CHECKS = ['noTrumpDoubles', 'kittyIsBook', 'forcedDealerBid', 'sportKitty', 'bostonDoubles', 'noJokers', 'ntMinFour', 'renege'];

  // Online, only the host edits the rules (everyone sees them).
  function rulesLocked() { return G.mode === 'online' && !amHost(); }

  function settingsToForm() {
    const f = $('settings-form');
    const r = E.cleanRules(G.nextRules || (G.view && G.mode === 'online' && G.view.rules) || G.rules);
    f.minBid.value = String(r.minBid);
    f.gameTarget.value = String(r.gameTarget);
    for (const k of RULE_CHECKS) f[k].checked = !!r[k];
    f.leadRule.value = r.leadRule;
    f.aiLevel.value = r.aiLevel;
    f.turnTimer.value = String(r.turnTimer);
    const locked = rulesLocked();
    for (const el of f.elements) el.disabled = locked;
    $('rules-lock').hidden = !locked;
    for (const el of document.querySelectorAll('.online-only')) el.hidden = G.mode !== 'online';
  }

  function formToSettings() {
    if (rulesLocked()) return;
    const f = $('settings-form');
    const r = E.cleanRules({
      minBid: parseInt(f.minBid.value, 10),
      gameTarget: parseInt(f.gameTarget.value, 10),
      leadRule: f.leadRule.value, aiLevel: f.aiLevel.value,
      turnTimer: parseInt(f.turnTimer.value, 10),
      ...Object.fromEntries(RULE_CHECKS.map((k) => [k, f[k].checked])),
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch (_) { /* ignore */ }
    if (!Online.conn) { G.rules = r; renderScores(); return; }
    // Rules change between hands: now if we're between hands, else at the next deal.
    const between = G.view && ['lobby', 'handover', 'gameover'].includes(G.view.phase);
    if (between) { Online.conn.send({ type: 'rules', rules: r }); G.nextRules = null; }
    else { G.nextRules = r; log('Rule changes will apply from the next hand.', true); }
  }

  // ---- wiring ---------------------------------------------------------------

  $('btn-deal-in').addEventListener('click', () => {
    $('splash').classList.remove('show');
    startSolo();
  });
  // Rule edits made mid-hand go to the table just before the next deal.
  function flushRules() {
    if (G.nextRules && Online.conn && amHost()) { Online.conn.send({ type: 'rules', rules: G.nextRules }); G.nextRules = null; }
  }
  $('btn-next-hand').addEventListener('click', () => {
    $('modal-summary').classList.remove('show');
    if (Online.conn && amHost()) { flushRules(); Online.conn.send({ type: 'nextHand' }); }
  });
  $('btn-to-lobby').addEventListener('click', () => {
    $('modal-gameover').classList.remove('show');
    if (G.mode === 'online' && amHost()) { flushRules(); Online.conn.send({ type: 'toLobby' }); }
  });
  $('btn-rematch').addEventListener('click', () => {
    $('modal-gameover').classList.remove('show');
    if (Online.conn && amHost()) { flushRules(); Online.conn.send({ type: 'start' }); }
  });
  $('btn-new-game').addEventListener('click', () => {
    if (!G.running) return;
    if (G.mode === 'online') { location.reload(); return; }
    if (confirm('Start a fresh game? Current scores will be wiped.')) startSolo();
  });

  // Online setup + lobby wiring.
  $('btn-play-online').addEventListener('click', () => { $('splash').classList.remove('show'); openOnlineSetup(); });
  $('btn-online-back').addEventListener('click', () => { $('modal-online').classList.remove('show'); $('splash').classList.add('show'); });
  $('btn-host').addEventListener('click', hostTable);
  $('btn-join').addEventListener('click', joinTable);
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('btn-start-online').addEventListener('click', () => { if (amHost()) Online.conn.send({ type: 'start' }); });
  $('btn-leave-online').addEventListener('click', () => {
    try { Online.conn && Online.conn.send({ type: 'leave' }); Online.conn && Online.conn.close(); } catch (_) { /* ignore */ }
    location.reload();
  });
  $('btn-copy-link').addEventListener('click', () => copyText(inviteLink(Online.code), $('btn-copy-link'), 'Copy invite link'));
  // Phones/tablets: the native share sheet (Messages, WhatsApp, …) is the
  // easiest way to send an invite by text.
  if (navigator.share) {
    $('btn-share-link').hidden = false;
    $('btn-copy-link').classList.replace('primary', 'ghost');
    $('btn-share-link').addEventListener('click', () => {
      navigator.share({
        title: 'Give Me Da Kitty',
        text: `Pull up a chair — Give Me Da Kitty 🃏 · Bid Whist with your crew. Game key: ${Online.code}`,
        url: inviteLink(Online.code),
      }).catch(() => { /* cancelled */ });
    });
  }

  // Phone header: the nav collapses behind a ☰ toggle.
  const closeMenu = () => { document.querySelector('.topbar').classList.remove('menu-open'); $('btn-menu').setAttribute('aria-expanded', 'false'); };
  $('btn-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = document.querySelector('.topbar').classList.toggle('menu-open');
    $('btn-menu').setAttribute('aria-expanded', String(open));
  });
  $('topnav').addEventListener('click', closeMenu);
  document.addEventListener('click', (e) => { if (!e.target.closest('.topbar')) closeMenu(); });
  $('btn-copy-key').addEventListener('click', () => copyText(Online.code, $('btn-copy-key'), 'Copy key only'));
  $('btn-reconnect').addEventListener('click', () => {
    $('modal-disconnect').classList.remove('show');
    connectRoom(Online.base, Online.code, Online.isHost);
  });
  $('btn-quit-online').addEventListener('click', () => location.reload());
  $('btn-settings').addEventListener('click', () => { settingsToForm(); renderPrefs(); $('modal-settings').classList.add('show'); });

  // Look & sound — personal preferences, applied instantly (not table rules).
  const FELTS = ['green', 'burgundy', 'midnight', 'purple'];
  function currentFelt() {
    const f = document.documentElement.getAttribute('data-felt');
    return FELTS.includes(f) ? f : 'green';
  }
  function setFelt(f) {
    if (!FELTS.includes(f)) f = 'green';
    document.documentElement.setAttribute('data-felt', f);
    try { localStorage.setItem('bidwhist.felt', f); } catch (_) { /* ignore */ }
    renderPrefs();
  }
  function renderPrefs() {
    const f = currentFelt();
    for (const b of document.querySelectorAll('.felt-pick')) {
      const on = b.dataset.felt === f;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    }
    $('pref-sound').checked = Sound.on;
    $('pref-coach').checked = coachOn();
    $('pref-big').checked = document.documentElement.getAttribute('data-cards') === 'big';
    $('pref-four').checked = document.documentElement.getAttribute('data-deck') === 'four';
    const sb = $('btn-sound');
    sb.textContent = Sound.on ? 'Sound On' : 'Sound Off';
    sb.setAttribute('aria-pressed', String(Sound.on));
  }
  for (const b of document.querySelectorAll('.felt-pick')) b.addEventListener('click', () => setFelt(b.dataset.felt));
  const prefToggle = (id, key, attr, val) => $(id).addEventListener('change', (e) => {
    try { localStorage.setItem(key, e.target.checked ? 'on' : 'off'); } catch (_) { /* ignore */ }
    if (attr) {
      if (e.target.checked) document.documentElement.setAttribute(attr, val);
      else document.documentElement.removeAttribute(attr);
    }
    renderHand();
    if (G.view && !Online.watching) setupTurn(G.view); // refresh coach marks
  });
  prefToggle('pref-coach', 'bidwhist.coach', null);
  prefToggle('pref-big', 'bidwhist.bigCards', 'data-cards', 'big');
  prefToggle('pref-four', 'bidwhist.fourColor', 'data-deck', 'four');

  // Table tools.
  buildReactMenu();
  $('btn-react').addEventListener('click', (e) => { e.stopPropagation(); toggleReactMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#table-tools')) toggleReactMenu(false); });
  $('btn-last-book').addEventListener('click', showLastBook);
  $('btn-lastbook-done').addEventListener('click', () => $('modal-lastbook').classList.remove('show'));
  $('btn-renege').addEventListener('click', () => {
    if (Online.conn && confirm('Call a renege on the other team? If nobody reneged, play just goes on.')) Online.conn.send({ type: 'renege' });
  });
  $('btn-sit').addEventListener('click', () => Online.conn && Online.conn.send({ type: 'sit' }));

  // Installable + offline solo: cache the app with a service worker.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ }));
  }
  $('pref-sound').addEventListener('change', (e) => { Sound.set(e.target.checked); renderPrefs(); if (Sound.on) Sound.play('card'); });
  $('btn-sound').addEventListener('click', () => { Sound.set(!Sound.on); renderPrefs(); if (Sound.on) Sound.play('card'); });
  renderPrefs();

  // Your own nameplate opens the profile editor.
  const ownPlate = $('plate-0');
  ownPlate.addEventListener('click', () => { if (!$('splash').classList.contains('show') && !Online.watching) openProfileEditor(); });
  ownPlate.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileEditor(); } });
  $('btn-settings-done').addEventListener('click', () => { formToSettings(); $('modal-settings').classList.remove('show'); });

  // Profile editor wiring.
  $('btn-profile').addEventListener('click', openProfileEditor);
  $('btn-edit-profile').addEventListener('click', openProfileEditor);
  $('btn-lobby-profile').addEventListener('click', openProfileEditor);
  $('splash-profile').addEventListener('click', openProfileEditor);
  $('btn-profile-cancel').addEventListener('click', () => $('modal-profile').classList.remove('show'));
  $('btn-profile-save').addEventListener('click', saveProfileFromEditor);
  $('btn-upload-avatar').addEventListener('click', () => $('avatar-file').click());
  $('btn-shuffle-avatar').addEventListener('click', () => { editorCartoon = randomCartoon(); editorImg = null; refreshProfilePreview(); });
  $('avatar-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    $('profile-error').textContent = '';
    try { editorImg = await processAvatarFile(file); editorCartoon = null; refreshProfilePreview(); }
    catch (_) { $('profile-error').textContent = "Couldn't read that photo. Try a JPG or PNG (or take a screenshot of it)."; }
    e.target.value = '';
  });
  $('btn-rules').addEventListener('click', () => $('modal-howto').classList.add('show'));
  $('btn-howto-done').addEventListener('click', () => $('modal-howto').classList.remove('show'));

  renderScores();
  renderTools();
  renderPlates(); // show the profile + AI avatars before the first deal
  renderSplashProfile();
  actionHint('Waiting on the deal…');
  handleDeepLink(); // if opened from an invite link, jump to the join panel
})();
