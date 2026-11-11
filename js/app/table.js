/* Give Me Da Kitty — table.js
 * Drawing the table: log, cards, scores, kitty, seats, chips, hand, tricks, tools, reactions, coach, records.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

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
  if (!G.lastTrick) return;
  Review.tricks = null;
  drawBook(G.lastTrick);
  $('lastbook-title').textContent = 'Last book';
  $('review-nav').hidden = true;
  $('btn-lastbook-done').textContent = 'Back to the Table';
  $('modal-lastbook').classList.add('show');
}

// Draw one book (four cards around the little table, the winner glowing).
function drawBook(t) {
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
    `${isMe(t.winner) ? 'you' : seatName(t.winner)} took it with the ${E.cardLabel(t.cards.find((p) => p.seat === t.winner).card)}.` +
    (t.renege != null ? ` ${isMe(t.renege) ? 'You' : seatName(t.renege)} reneged here.` : '');
}

// "Review the hand": the finished hand, book by book.
const Review = { tricks: null, i: 0 };
function openReview(tricks) {
  if (!tricks || !tricks.length) return;
  Review.tricks = tricks; Review.i = 0;
  $('review-nav').hidden = false;
  $('btn-lastbook-done').textContent = 'Done';
  stepReview(0);
  $('modal-lastbook').classList.add('show');
}
function stepReview(d) {
  const n = Review.tricks.length;
  Review.i = Math.max(0, Math.min(n - 1, Review.i + d));
  drawBook(Review.tricks[Review.i]);
  $('lastbook-title').textContent = `Book ${Review.i + 1} of ${n}`;
  $('btn-review-prev').disabled = Review.i === 0;
  $('btn-review-next').disabled = Review.i === n - 1;
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
function coachOn() {
  if (T.on) return false;
  try { return localStorage.getItem('bidwhist.coach') === 'on'; } catch (_) { return false; }
}
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
    // Only one card of the led suit? Then that's the whole reason.
    const follow = hand.filter((x) => E.effectiveSuit(x, c) === led);
    if (led && follow.length === 1 && follow[0].id === card.id && !wins && !partnerHas) {
      const one = led === c.trump ? 'trump' : E.SUIT_NAMES[led].toLowerCase().replace(/s$/, '');
      why = `it's your only ${one}, so it has to go`;
    }
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
