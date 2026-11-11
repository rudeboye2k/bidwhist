/* Give Me Da Kitty — core.js
 * Shared state and helpers: seats, names, profile & avatars, saved rules, the game state G.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
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
