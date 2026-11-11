/* Give Me Da Kitty — effects.js
 * Sound, vibration, banners, confetti, celebrations and the trump-call announcement.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

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

// ---- turn alerts (online) ------------------------------------------------------
// When it's your turn and the game isn't on screen: the tab title says so, and
// (if you switched it on in Look & Sound) a notification taps you on the shoulder.
const TITLE = document.title;
const TurnAlert = {
  supported: typeof Notification !== 'undefined',
  on() {
    try { return this.supported && Notification.permission === 'granted' && localStorage.getItem('bidwhist.notify') === 'on'; } catch (_) { return false; }
  },
  async enable(want) {
    if (want && this.supported && Notification.permission !== 'granted') {
      try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
    }
    const ok = want && this.supported && Notification.permission === 'granted';
    try { localStorage.setItem('bidwhist.notify', ok ? 'on' : 'off'); } catch (_) { /* ignore */ }
    return ok;
  },
  yourTurn(text) {
    if (!document.hidden) return;
    document.title = '● Your turn — Give Me Da Kitty';
    if (!this.on()) return;
    const opts = { body: text, icon: 'img/icon-192.png', badge: 'img/favicon-32.png', tag: 'gmdk-turn', renotify: true };
    const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : Promise.resolve(null);
    reg.then((r) => (r ? r.showNotification('Give Me Da Kitty', opts) : new Notification('Give Me Da Kitty', opts)))
      .catch(() => { /* notifications blocked */ });
  },
  clear() {
    document.title = TITLE;
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration)
      navigator.serviceWorker.getRegistration().then((r) => r && r.getNotifications({ tag: 'gmdk-turn' }))
        .then((list) => (list || []).forEach((n) => n.close())).catch(() => { /* ignore */ });
  },
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) TurnAlert.clear(); });
