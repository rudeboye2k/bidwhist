/* Give Me Da Kitty — play.js
 * Running a game: solo (in-browser room) and online (WebSocket) — events, views, turns, lobby, results.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

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
function startSolo(opts) {
  opts = opts || {};
  if (!opts.tutorial) T.on = false;
  G.daily = opts.daily || null;
  const rules = opts.rules || E.cleanRules(G.nextRules || G.rules);
  // The Daily Deal is the day's fixed deal with default rules and fresh bots.
  const room = opts.daily ? RoomCore.dailyRoom(opts.daily)
    : new RoomCore.Room('SOLO', rules, opts.seed ? { rng: mulberry32(opts.seed) } : undefined);
  if (!opts.rules && !opts.daily) G.nextRules = null;
  // The table keeps learning across games this session (a lesson starts fresh).
  if (!opts.daily) room.learner = opts.tutorial ? AI.createLearner() : G.learner;
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
        case 'nextHand': if (opts.daily) return; out = room.nextHand(token); break;
        case 'intent':
          out = room.submit(token, msg.intent);
          if (opts.daily && !(out && out.error)) Daily.moves.push(msg.intent); // for the server's replay
          break;
        case 'profile': out = room.setProfile(token, msg.name, msg.avatar); break;
        case 'react': out = room.react(token, msg.id); break;
        case 'say': out = room.say(token, msg.text); break;
        case 'rules': if (opts.daily) return; out = room.setRules(token, msg.rules); break;
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

// A shareable deep link (#join=CODE): a friend who opens it lands on the join
// panel with the key filled in.
function inviteLink(code) {
  return location.origin + location.pathname + '#join=' + encodeURIComponent(code);
}

// The online table you were last seated at, so a closed tab or a dead phone
// battery is one tap from getting your seat back (the saved token reclaims it).
const LAST_TABLE = 'bidwhist.lastTable';
const REJOIN_MS = 12 * 60 * 60 * 1000;
function rememberTable(code) {
  try { localStorage.setItem(LAST_TABLE, JSON.stringify({ code, at: Date.now() })); } catch (_) { /* ignore */ }
}
function forgetTable() {
  try { localStorage.removeItem(LAST_TABLE); } catch (_) { /* ignore */ }
}
function recentTable() {
  try {
    const t = JSON.parse(localStorage.getItem(LAST_TABLE) || 'null');
    if (t && /^[A-Z0-9]{3,8}$/.test(t.code) && Date.now() - t.at < REJOIN_MS && localStorage.getItem(tokenKey(t.code))) return t.code;
  } catch (_) { /* ignore */ }
  return null;
}
function renderRejoin() {
  const code = recentTable();
  $('btn-rejoin').hidden = !code;
  $('rejoin-code').textContent = code || '';
}
function rejoinTable() {
  const code = recentTable();
  const base = serverOrError();
  if (!code || !base) return;
  $('splash').classList.remove('show');
  openOnlineSetup();
  $('join-code').value = code;
  connectRoom(base, code, false);
}
function copyText(text, btn, label) {
  const done = () => { if (btn) { btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = label), 1400); } };
  const fail = () => { try { window.prompt('Copy this:', text); } catch (_) { /* ignore */ } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
  else fail();
}

// A friend opened an invite link (#join=CODE): open
// the online panel with the key pre-filled, ready for one tap on Join.
function handleDeepLink() {
  const h = location.hash || '';
  const m = h.match(/join=([A-Za-z0-9]{3,8})/i);
  if (!m) return false;
  const code = m[1].toUpperCase();
  $('splash').classList.remove('show');
  openOnlineSetup();
  $('join-code').value = code;
  const note = document.querySelector('#modal-online .modal-note');
  if (note) note.textContent = `You've been invited to table ${code} — just tap “Join a Table”.`;
  return true;
}

function openOnlineSetup() {
  $('online-error').textContent = '';
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
  const base = serverOrError();
  if (!base) return;
  setOnlineError('Creating table…');
  try {
    const code = await Net.newCode(base);
    connectRoom(base, code, true);
  } catch (e) {
    setOnlineError('Could not reach the game server — check your connection and try again.');
  }
}

function joinTable() {
  const base = serverOrError();
  const code = ($('join-code').value || '').trim().toUpperCase();
  if (!base) return;
  if (!/^[A-Z0-9]{3,6}$/.test(code)) return setOnlineError('Enter a valid game key.');
  connectRoom(base, code, false);
}

// The game server is this website (see Net.serverBase).
function serverOrError() {
  const base = Net.serverBase();
  if (!base) setOnlineError('Online play needs the website — open givemedakitty.com.');
  return base;
}
function setOnlineError(msg) { $('online-error').textContent = msg || ''; }

function connectRoom(base, code, isHost) {
  G.daily = null;
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
    onError() { setOnlineError('Connection error — could not open the table.'); },
  });
}

function onServerMessage(msg) {
  if (msg.type === 'welcome') {
    Online.token = msg.token;
    Online.isHost = !!msg.host;
    Online.watching = !!msg.watcher && !msg.token;
    if (!Online.local && msg.token) {
      try { localStorage.setItem(tokenKey(Online.code), msg.token); } catch (_) { /* ignore */ }
      rememberTable(Online.code);
    }
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
    if (T.on) await tutorialTurn(msg.view);
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
        G.handResult = null; Online.summaryFor = null;
        G.dealer = ev.dealer; G.handNo = ev.handNo;
        G.seatBooks = [0, 0, 0, 0]; G.contract = null; G.memory = new Set(); G.lastTrick = null;
        clearTrick(); renderPlateBooks(); renderTrumpBadge();
        log(`— Hand ${ev.handNo}. <b>${seatName(ev.dealer)}</b> ${seatVerb(ev.dealer, 'deal')}. —`, true);
        if (T.on) await tutorialDeal();
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
        if (T.on && isMe(ev.highSeat)) T.wonBid = true;
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
        if (T.on) await tutorialCalled(c);
        break;
      }
      case 'kitty':
        if (T.on && isMe(ev.seat) && !T.seen.kitty) { T.seen.kitty = true; await tutorialKitty(); }
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
        if (T.on && ev.card.joker && !T.seen.joker) { await wait(500); await tutorialJoker(ev.seat, ev.card); }
        if (!isMe(ev.seat)) { G.hands[ev.seat] && G.hands[ev.seat].pop(); if (ev.seat === G.viewSeat) renderHand(); }
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
        if (T.on) await tutorialBook(ev.winner);
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
        if (T.on) { G.scores = ev.result.scores.slice(); G.books = ev.result.books.slice(); renderScores(); await tutorialScore(ev.result); break; }
        if (G.daily) finishDaily(ev.result);
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
  renderBidChips(); renderSeatsMeta(view.turn);
  startTurnClock(view);
  // The pile sits on the felt through the bidding; the high bidder takes it
  // the moment the auction closes.
  renderKitty(view.phase === 'bidding' ? 'back' : 'gone');
  renderHand();
  setupTurn(view);
  // Arrived between hands (reconnected, or a bot finished the hand while you
  // were away): bring up the result, so the host still has a Deal button.
  if (!T.on && view.phase === 'handover' && view.result && Online.summaryFor !== view.handNo) showOnlineSummary(view.result);
  if (!T.on && view.phase === 'gameover' && !$('modal-gameover').classList.contains('show') && Online.summaryFor !== 'over' + view.handNo) {
    const winner = E.gameOver(view.scores, G.rules);
    if (winner !== null) { Online.summaryFor = 'over' + view.handNo; showOnlineGameover(winner, view.scores); }
  }
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
    const cue = { bid: 'Your turn to bid.', play: 'Your turn to play.', discard: 'Pick cards to bury.',
      'declare-suit': 'Name your trump.', 'declare-dir': 'Pick uptown or downtown.' }[view.need] || 'Your turn.';
    announce(cue);
    if (G.mode === 'online') TurnAlert.yourTurn(cue);
  }
  const send = (intent) => {
    if (G._sent) return;
    G._sent = true; G.resolve = null; G.awaiting = null; G.legalIds = new Set();
    Online.conn.send({ type: 'intent', intent });
    actionHint('&nbsp;'); renderHand();
  };
  if (T.on) tutorialLock(view);
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
    if (T.on && T.play) { G.legalIds = new Set([T.play.card.id]); G.coachIds = new Set([T.play.card.id]); }
    renderHand(); actionHint('Your play.' + (ntJokerHold ? ' (Jokers are throw-offs in No-Trump — no leading them.)' : ''));
    if (tip) coachLine(tip);
  }
  if (T.on) tutorialTip(view);
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
  btn.textContent = G.daily ? 'Today’s Leaderboard' : Online.local ? 'Next Hand' : amHost() ? 'Deal Next Hand' : 'Waiting for host…';
  btn.disabled = !amHost() && !G.daily;
  if (r.penalties && r.penalties.length)
    $('summary-body').insertAdjacentHTML('afterbegin', `<span class="renege-note">Renege penalty: ${r.penalties.map((p) => `${seatName(p.seat)} −${p.books}`).join(', ')} books</span>`);
  Online.summaryFor = G.handNo;
  G.reviewTricks = r.tricks || null;
  $('btn-review-hand').hidden = !(r.tricks && r.tricks.length) || T.on;
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
