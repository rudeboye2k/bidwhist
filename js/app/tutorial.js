/* Give Me Da Kitty — tutorial.js
 * Learn to Play: the guided hand and its lessons.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// ---- Learn to Play: a guided hand ------------------------------------------
// A real hand on a fixed deal (found by search so it shows everything worth
// teaching: you outbid a 3 with a 4, name Spades Uptown, bury, follow suit,
// trump, see a joker and your partner win books — and make it). A lesson
// card explains each moment; on your turn only the move being taught is
// allowed, with the reason. Everything is computed by the same coach the
// Coach option uses, so the lesson always matches the cards on the table.
// Lesson 2 (No-Trump & Downtown) is a second fixed deal: everyone passes, you
// (the dealer) must bid, and a fistful of low cards makes 3 No-Trump Downtown.
const TUTORIAL_SEED = 1789;
const LESSON2_SEED = 9255;
const T = { on: false, lesson: 1, seen: {}, auto: false, bid: null, decl: null, play: null, wonBid: false, books: 0 };
const L2 = () => T.lesson === 2;

const mulberry32 = E.seededRng; // same deals as ever: it's the same generator

// Show a lesson card; resolves with the chosen button's value.
let lessonDone = null;
function lesson(kicker, title, html, buttons) {
  return new Promise((resolve) => {
    if (!T.on) { resolve('skip'); return; }
    const plain = (t) => String(t).replace(/&rsquo;/g, '’');
    $('lesson-kicker').textContent = plain(kicker);
    $('lesson-title').textContent = plain(title);
    $('lesson-body').innerHTML = html;
    const box = $('lesson-actions');
    box.innerHTML = '';
    for (const b of buttons || [{ label: 'Next', value: 'next', primary: true }]) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.primary ? 'primary' : 'ghost');
      el.textContent = String(b.label).replace(/&rsquo;/g, '’');
      el.addEventListener('click', () => { $('modal-lesson').classList.remove('show'); lessonDone = null; resolve(b.value); });
      box.appendChild(el);
    }
    lessonDone = resolve;
    $('modal-lesson').classList.add('show');
    // Phones: bring the table back into view behind the lesson.
    if (window.innerWidth <= 760) { try { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (_) { window.scrollTo(0, 0); } }
    setTimeout(() => { const f = box.querySelector('.btn.primary') || box.querySelector('.btn'); if (f) f.focus(); }, 60);
  });
}
function exitTutorial() {
  T.on = false; T.auto = false;
  $('modal-lesson').classList.remove('show');
  if (lessonDone) { const r = lessonDone; lessonDone = null; r('exit'); }
  log('Lesson over — the hand is yours to finish. Good luck!', true);
  if (G.view) setupTurn(G.view);
}

async function startTutorial(n) {
  const which = n === 2 ? 2 : 1; // (called straight from click handlers too)
  Object.assign(T, { on: true, lesson: which, seen: {}, auto: false, bid: null, decl: null, play: null, wonBid: false, books: 0 });
  for (const id of ['splash', 'modal-howto', 'modal-summary', 'modal-gameover']) $(id).classList.remove('show');
  if (which === 2) return startLesson2();
  const a = await lesson('Learn to Play · 1 of 3', 'Welcome to the table',
    '<p>Bid Whist is played by <b>four people in two teams</b>. Your <b>partner</b> sits across from you — that&rsquo;s Marcus. ' +
    'The players on your left and right (Pearl and Deacon) are the other team.</p><p>You and your partner win or lose <i>together</i>.</p>');
  if (a === 'exit') return;
  const b = await lesson('Learn to Play · 2 of 3', 'How you win',
    '<p>Each hand is played as <b>12 rounds called books</b>: everyone plays one card, and the best card takes the book.</p>' +
    '<p>Before playing, there&rsquo;s an <b>auction</b>. The team that bids highest has to take that many books; the other team tries to stop them.</p>' +
    '<p>Make your bid and you score points. Get stopped (<b>set</b>) and you lose points. <b>First team to 7 wins.</b></p>');
  if (b === 'exit') return;
  const c = await lesson('Learn to Play · 3 of 3', 'How this lesson works',
    '<p>We&rsquo;ll play one real hand together. I&rsquo;ll explain each step as it happens.</p>' +
    '<p>When it&rsquo;s your turn, <b>only the right move is lit up</b> — tap it and I&rsquo;ll tell you why it&rsquo;s right. You can leave any time with <i>Exit lesson</i>.</p>',
    [{ label: 'Deal the cards', value: 'go', primary: true }]);
  if (c === 'exit') return;
  startSolo({ seed: TUTORIAL_SEED, rules: E.cleanRules(E.DEFAULT_RULES), tutorial: true });
}

async function startLesson2() {
  const a = await lesson('Lesson 2 · 1 of 2', 'No-Trump: no boss suit',
    '<p>So far, the bidder named a <b>trump</b> suit that beats everything. Add <b>No-Trump</b> to your bid and there is <i>no</i> trump at all: ' +
    'the <b>suit that&rsquo;s led</b> wins the book, and if you can&rsquo;t follow you just throw something away.</p>' +
    '<p>That makes the jokers worthless — they can&rsquo;t win a thing. In exchange, a No-Trump bid <b>scores double</b>.</p>');
  if (a === 'exit') return;
  const b = await lesson('Lesson 2 · 2 of 2', 'Downtown: low cards win',
    '<p>Every hand runs <b>Uptown</b> (high cards win: A, K, Q…) or <b>Downtown</b> (low cards win: <b>A, 2, 3, 4…</b> — the ace is the best card either way, and the king is the worst Downtown).</p>' +
    '<p>A hand full of little cards is junk Uptown, but Downtown it&rsquo;s a winner. Let&rsquo;s play one.</p>',
    [{ label: 'Deal the cards', value: 'go', primary: true }]);
  if (b === 'exit') return;
  startSolo({ seed: LESSON2_SEED, rules: E.cleanRules(E.DEFAULT_RULES), tutorial: true });
}

const suitWord = (s) => `${E.SUIT_GLYPHS[s]} ${E.SUIT_NAMES[s]}`;
function handFacts(hand) {
  const by = { S: [], H: [], D: [], C: [] };
  let jokers = 0, aces = 0;
  for (const c of hand) { if (c.joker) jokers++; else { by[c.suit].push(c); if (c.rank === 14) aces++; } }
  const longest = E.SUITS.slice().sort((a, b) => by[b].length - by[a].length)[0];
  return { by, jokers, aces, longest, n: by[longest].length };
}

async function tutorialDeal() {
  if (T.seen.deal) return;
  T.seen.deal = true;
  const v = G.view;
  if (v && v.you) {
    G.hands = G.hands || [[], [], [], []]; G.hands[G.viewSeat] = v.you.hand;
    G.kitty = new Array(v.kittySize || 6).fill(null);
    renderPlates(); renderKitty('back'); renderHand();
  }
  await wait(700);
  const f = handFacts(v && v.you ? v.you.hand : []);
  if (L2()) {
    const hand = v && v.you ? v.you.hand : [];
    const low = hand.filter((c) => !c.joker && (c.rank <= 7 || c.rank === 14)).sort((x, y) => (x.rank % 14) - (y.rank % 14));
    const high = hand.filter((c) => !c.joker && c.rank >= 11 && c.rank <= 13).length;
    await lesson('The deal', 'Your 12 cards',
      `<p>Look closely: <b>${high} face card${high === 1 ? '' : 's'}</b>, but <b>${low.length} low cards</b> — ${low.slice(0, 6).map((c) => E.cardLabel(c)).join(', ')}${low.length > 6 ? '…' : ''}.</p>` +
      `<p>Uptown, those little cards would lose every time. Downtown, they&rsquo;re the ones that win.</p>`);
    return;
  }
  await lesson('The deal', 'Your 12 cards',
    `<p>The deck has 54 cards — a regular deck <b>plus two jokers</b>. Everyone gets <b>12</b>, and the last <b>6</b> go face-down in the middle: that&rsquo;s the <b>kitty</b> 🐱. The kitty goes to whoever wins the auction.</p>` +
    `<p>Your cards are along the bottom, sorted by suit. Look at what you&rsquo;re holding: ` +
    `${f.jokers ? `<b>${f.jokers === 2 ? 'both jokers' : 'a joker'}</b> (the strongest cards in the game), ` : ''}` +
    `<b>${f.n} ${E.SUIT_NAMES[f.longest]}</b>${f.aces ? ` and <b>${f.aces} ace${f.aces > 1 ? 's' : ''}</b>` : ''}. That&rsquo;s a good-looking hand.</p>`);
}

// Before your move: what's the lesson for this decision?
function tutorialLock(view) {
  T.play = null;
  const hand = myHand();
  if (view.need === 'bid') {
    let bid = AI.chooseBid(hand, G.high, G.rules, !!(view.you && view.you.mustBid), () => 0.5, null, G.viewSeat).bid;
    if (bid.pass || !E.isLegalBid(bid, G.high, G.rules)) {
      bid = null;
      for (let a = G.rules.minBid; a <= 7 && !bid; a++) if (E.isLegalBid({ amount: a, type: 'suit' }, G.high, G.rules)) bid = { amount: a, type: 'suit' };
    }
    T.bid = bid;
  } else if (view.need === 'declare-suit') {
    T.decl = AI.chooseDeclare(hand, 'suit');
  } else if (view.need === 'declare-dir') {
    T.decl = AI.chooseDeclare(hand, 'notrump');
  } else if (view.need === 'discard') {
    G.coachIds = new Set(AI.chooseDiscards(hand, G.contract).map((c) => c.id));
  } else if (view.need === 'play') {
    T.play = coachPlay(view);
  }
}
// The one-line instruction in the action bar, plus auto-play if chosen.
function tutorialTip(view) {
  const line = (html) => { const d = document.createElement('div'); d.className = 'lesson-tip'; d.innerHTML = html; $('action-bar').insertBefore(d, $('action-bar').firstChild); };
  let act = null;
  if (view.need === 'bid' && T.bid) {
    line(T.bid.type === 'notrump'
      ? `👉 Tap <b>${T.bid.amount}</b>, then <b>Bid ${T.bid.amount} No-Trump</b>.`
      : `👉 Tap <b>${T.bid.amount}</b>, then <b>Bid ${T.bid.amount}</b>.`);
    act = () => G.resolve && G.resolve(T.bid);
  } else if (view.need === 'declare-suit' && T.decl) {
    line(`👉 Tap <b>${suitWord(T.decl.trump)}</b>, then <b>${T.decl.direction === 'uptown' ? 'Uptown' : 'Downtown'}</b>, then the gold button.`);
    act = () => G.resolve && G.resolve(T.decl);
  } else if (view.need === 'declare-dir' && T.decl) {
    line(`👉 Tap <b>${T.decl.direction === 'uptown' ? 'Uptown' : 'Downtown'}</b>.`);
    act = () => G.resolve && G.resolve(T.decl.direction);
  } else if (view.need === 'discard') {
    line('👉 Tap the <b>six outlined cards</b>, then <b>Bury Six</b>.');
    act = () => { G.discardPicks = new Set(G.coachIds); renderHand(); updateDiscardBar(); G.resolve && G.resolve(null); };
  } else if (view.need === 'play' && T.play) {
    line(`👉 Play the <b>${E.cardLabel(T.play.card)}</b> — ${T.play.why}.`);
    act = () => G.resolve && G.resolve(T.play.card);
  }
  if (T.auto && act) setTimeout(act, 650);
}

// Lessons that appear once your turn is on screen (skipped in auto mode).
async function tutorialTurn(view) {
  if (!T.on || T.auto) return;
  const mine = view.you && view.turn === view.you.seat && view.need;
  if (!mine) return;
  if (view.need === 'bid' && !T.seen.bid) {
    T.seen.bid = true;
    const said = [1, 2, 3].map((k) => (G.viewSeat + k) % 4).filter((s) => G.bids[s])
      .map((s) => `${seatName(s)} ${G.bids[s].pass ? 'passed' : 'bid <b>' + E.describeBid(G.bids[s]) + '</b>'}`);
    const f = handFacts(myHand());
    if (L2()) {
      const pts = T.bid ? T.bid.amount : 3;
      await lesson('The auction', 'Everyone passed — and you&rsquo;re the dealer',
        `<p>${said.length ? said.join(', ') + '. ' : ''}When the first three players pass, the <b>dealer must bid</b> (that&rsquo;s a table rule you can switch off).</p>` +
        `<p>No suit here is strong enough for trump — but all those low cards are. Bid <b>${pts} No-Trump</b>: you&rsquo;ll get the kitty, then call it <b>Downtown</b>. ` +
        `Make it and it scores double.</p>`,
        [{ label: 'Got it', value: 'ok', primary: true }]);
      return;
    }
    await lesson('The auction', 'Your bid',
      `<p>Everyone gets <b>one bid</b>, starting left of the dealer. A bid is a number from <b>3 to 7</b>: the books <i>over six</i> your team promises to take. ` +
      `Bid <b>4</b> means <b>10</b> of the 13 books (the kitty counts as one). You can also add <b>No-Trump</b>, but let&rsquo;s keep it simple.</p>` +
      (said.length ? `<p>So far: ${said.join(', ')}.</p>` : '') +
      (G.high && G.highSeat === (G.viewSeat + 2) % 4
        ? `<p>Yes — that 3 is your own partner&rsquo;s bid. You&rsquo;re allowed to outbid your partner, and you should when your hand is the stronger one: then <i>you</i> get the kitty and name trump.</p>` : '') +
      `<p>A four beats a three. With ${f.jokers ? 'a joker, ' : ''}${f.n} ${E.SUIT_NAMES[f.longest]}${f.aces ? ` and ${f.aces} ace${f.aces > 1 ? 's' : ''}` : ''}, you can take plenty of books — so <b>bid ${T.bid ? T.bid.amount : 4}</b> and win the kitty.</p>`,
      [{ label: 'Got it', value: 'ok', primary: true }]);
  } else if ((view.need === 'declare-suit' || view.need === 'declare-dir') && !T.seen.decl) {
    T.seen.decl = true;
    const d = T.decl || {};
    if (view.need === 'declare-dir') {
      const down = d.direction !== 'uptown';
      const low = myHand().filter((c) => !c.joker && (c.rank <= 5 || c.rank === 14)).length;
      await lesson('The call', down ? 'Call it Downtown' : 'Call it Uptown',
        `<p>In No-Trump there&rsquo;s no suit to name — you only pick the <b>direction</b>.</p>` +
        (down ? `<p>With the kitty you hold <b>${low} cards from ace to five</b>. Downtown, those are your winners — so call <b>Downtown</b>.</p>`
          : `<p>Your high cards are your winners here — so call <b>Uptown</b>.</p>`),
        [{ label: 'Got it', value: 'ok', primary: true }]);
      return;
    }
    const n = myHand().filter((c) => c.suit === d.trump || c.joker).length;
    await lesson('Naming trump', d.trump ? `Pick ${E.SUIT_NAMES[d.trump]} — and Uptown` : 'Pick a direction',
      `<p><b>Trump</b> is the boss suit: any trump card beats every card of the other suits. Since you won the bid, <i>you</i> choose it — after seeing the kitty.</p>` +
      `<p>You also pick the <b>direction</b>: <b>Uptown</b> means high cards win (A, K, Q…), <b>Downtown</b> means low cards win (A, 2, 3…).</p>` +
      (d.trump ? `<p>With the kitty you hold <b>${n} trumps</b> if you call ${E.SUIT_NAMES[d.trump]} (the jokers are trumps too), and they&rsquo;re high cards — so call <b>${suitWord(d.trump)}, ${d.direction === 'uptown' ? 'Uptown' : 'Downtown'}</b>.</p>` : ''),
      [{ label: 'Got it', value: 'ok', primary: true }]);
  } else if (view.need === 'discard' && !T.seen.discard) {
    T.seen.discard = true;
    if (G.contract && G.contract.type === 'notrump') {
      const jk = myHand().filter((c) => c.joker).length;
      await lesson('The kitty', 'Bury six cards',
        `<p>Same as before: put <b>six face-down</b> — they&rsquo;re your team&rsquo;s first book.</p>` +
        `<p>${jk ? `${jk === 2 ? 'Both jokers go' : 'The joker goes'} first: in No-Trump ${jk === 2 ? 'they' : 'it'} can&rsquo;t win anything. ` : ''}` +
        `${G.contract.direction === 'downtown' ? 'Then your <b>high</b> cards — queens and jacks lose Downtown.' : 'Then your <b>low</b> cards — they lose Uptown.'} I&rsquo;ve outlined the six to bury.</p>`,
        [{ label: 'Got it', value: 'ok', primary: true }]);
      return;
    }
    await lesson('The kitty', 'Bury six cards',
      `<p>You&rsquo;re holding 18 cards but you&rsquo;ll only play 12, so you put <b>six face-down</b>. They count as your team&rsquo;s <b>first book</b> — you&rsquo;re already one up!</p>` +
      `<p>Bury cards that won&rsquo;t win anything: low cards in your short suits. Keep your trumps and your aces. I&rsquo;ve outlined the six to bury.</p>`,
      [{ label: 'Got it', value: 'ok', primary: true }]);
  } else if (view.need === 'play' && T.play) {
    const trick = liveTrickFromView(view), c = G.contract, card = T.play.card;
    const led = trick.length ? E.trickLedSuit(trick, c) : null;
    const trumpCard = c.type !== 'notrump' && (card.joker || card.suit === c.trump);
    if (!trick.length && !T.seen.lead && c.type === 'notrump') {
      T.seen.lead = true;
      await lesson('The play', 'You lead the first book',
        `<p>With no trump, whoever plays the best card <b>of the suit that was led</b> takes the book — nobody can trump in.</p>` +
        `<p>${c.direction === 'downtown' ? 'Downtown, &ldquo;best&rdquo; means lowest (the ace, then the 2, 3…). ' : ''}Lead the <b>${E.cardLabel(card)}</b>: ${T.play.why}.</p>`,
        [{ label: 'Got it', value: 'ok', primary: true }]);
    } else if (!trick.length && !T.seen.lead) {
      T.seen.lead = true;
      await lesson('The play', 'You lead the first book',
        `<p>The bidder leads first. Whatever suit is <b>led</b>, everyone must <b>follow suit</b> if they can. The highest card of the led suit wins the book — <i>unless</i> someone plays a trump.</p>` +
        `<p>${trumpCard ? `Leading trump pulls the other team&rsquo;s trumps out early, so they can&rsquo;t use them to steal your books. ` : ''}Lead the <b>${E.cardLabel(card)}</b>: ${T.play.why}.</p>`,
        [{ label: 'Got it', value: 'ok', primary: true }]);
    } else if (led && E.effectiveSuit(card, c) === led && !T.seen.follow && myHand().some((x) => E.effectiveSuit(x, c) !== led)) {
      T.seen.follow = true;
      await lesson('The play', 'Follow suit',
        `<p>${led === c.trump ? 'Trump' : E.SUIT_NAMES[led]} was led and you have ${myHand().filter((x) => E.effectiveSuit(x, c) === led).length === 1 ? 'one, so you <b>must</b> play it' : 'some, so you <b>must</b> play one'} — that&rsquo;s why your other cards are dimmed.</p>` +
        `<p>Play the <b>${E.cardLabel(card)}</b>: ${T.play.why}.</p>`, [{ label: 'Got it', value: 'ok', primary: true }]);
    } else if (led && trumpCard && led !== c.trump && !T.seen.trump) {
      T.seen.trump = true;
      await lesson('The play', 'Out of the suit? Trump it!',
        `<p>You don&rsquo;t have any ${E.SUIT_NAMES[led]}, so you&rsquo;re free to play anything — and a <b>trump</b> beats every ${E.SUIT_NAMES[led]} on the table.</p>` +
        `<p>Play the <b>${E.cardLabel(card)}</b> and take the book.</p>`, [{ label: 'Got it', value: 'ok', primary: true }]);
    } else if (led && c.type === 'notrump' && E.effectiveSuit(card, c) !== led && !T.seen.throwoff) {
      T.seen.throwoff = true;
      await lesson('The play', 'Can&rsquo;t follow? Throw off',
        `<p>You&rsquo;re out of ${E.SUIT_NAMES[led]}. In a trump hand you&rsquo;d trump it — in No-Trump you can&rsquo;t, so whatever you play can&rsquo;t win this book.</p>` +
        `<p>Throw away the card you need least: the <b>${E.cardLabel(card)}</b>.</p>`, [{ label: 'Got it', value: 'ok', primary: true }]);
    } else if (/partner has it/.test(T.play.why) && !T.seen.partner) {
      T.seen.partner = true;
      await lesson('The play', 'Let your partner have it',
        `<p>Your partner&rsquo;s card is already winning this book, and books count for the whole team. No need to spend a good card — <b>throw your cheapest one</b>.</p>`,
        [{ label: 'Got it', value: 'ok', primary: true }]);
    }
  }
}

async function tutorialKitty() {
  await lesson('The auction', 'You won it — give me da kitty!',
    `<p>Highest bid takes the kitty. Those six cards are going into your hand now, so you&rsquo;ll have <b>18</b> to choose from.</p>` +
    (L2() ? `<p>That&rsquo;s the prize for winning the bid: you see the extra cards <i>before</i> you pick the direction.</p>`
      : `<p>That&rsquo;s the prize for winning the bid: you see the extra cards <i>before</i> you decide what trump is.</p>`));
}
async function tutorialCalled(c) {
  if (T.seen.called) return;
  T.seen.called = true;
  const need = 6 + c.amount, set = 8 - c.amount;
  await lesson('The call', 'Everyone knows the deal now',
    `<p>Trump is <b>${c.type === 'notrump' ? 'none (No-Trump)' : suitWord(c.trump)}</b>, running <b>${c.direction === 'uptown' ? 'Uptown' : 'Downtown'}</b>. You&rsquo;ll see it in the corner of the table the whole hand.</p>` +
    `<p>Your team needs <b>${need} books</b>. If the other team takes <b>${set}</b>, you&rsquo;re <b>set</b> and lose ${c.amount} points.</p>`);
}
async function tutorialJoker(seat, card) {
  T.seen.joker = true;
  if (G.contract && G.contract.type === 'notrump') {
    await lesson('The play', card.joker === 'big' ? 'The Big Joker — worth nothing here' : 'The Little Joker — worth nothing here',
      `<p>${isMe(seat) ? 'You' : seatName(seat)} just threw a joker away. In a trump hand it&rsquo;s a top card; in No-Trump it can&rsquo;t win a book, so it&rsquo;s only good for throwing off.</p>`);
    return;
  }
  await lesson('The play', card.joker === 'big' ? 'That&rsquo;s the Big Joker' : 'That&rsquo;s the Little Joker',
    `<p>The two jokers are the <b>highest trumps</b> — the Big Joker beats everything, then the Little Joker, then the ace of trump. ` +
    `${isMe(seat) ? 'Nice — that one&rsquo;s yours.' : `${seatName(seat)} just played it.`}</p>` +
    `<p>(In a No-Trump hand the jokers can&rsquo;t win anything — they&rsquo;re throw-offs.)</p>`);
}
async function tutorialBook(winner) {
  T.books++;
  if (T.books === 1) {
    const us = myTeam();
    await lesson('The play', `${isMe(winner) ? 'You' : seatName(winner)} took the book`,
      `<p>The winning card takes the book, and that player <b>leads the next one</b>.` +
      (G.contract && G.contract.direction === 'downtown' && G.lastTrick
        ? ` Downtown, the <b>${E.cardLabel(G.lastTrick.cards.find((p) => p.seat === winner).card)}</b> was the lowest card of the suit led — so it won.` : '') +
      `</p>` +
      `<p>Keep an eye on the gold badge on each nameplate and the <b>scoreboard</b>: your team has <b>${G.books[us]}</b> book${G.books[us] === 1 ? '' : 's'} so far (the kitty counts as one).</p>`);
  } else if (T.books === 4 && !T.auto) {
    const r = await lesson('Nice work', 'You&rsquo;ve got the hang of it',
      `<p>That&rsquo;s the whole game: follow suit when you can, trump when you can&rsquo;t, and let your partner win when they&rsquo;ve got it.</p>` +
      `<p>Want to keep playing the rest of the hand yourself, or watch me finish it?</p>`,
      [{ label: 'I&rsquo;ll keep playing', value: 'me', primary: true }, { label: 'Finish the hand for me', value: 'auto' }]);
    if (r === 'auto') { T.auto = true; if (G.view) setupTurn(G.view); }
  }
}
async function tutorialScore(r) {
  const us = myTeam();
  const mine = r.bidTeam === us;
  const books = r.books[r.bidTeam];
  await lesson('Scoring', r.made ? (r.boston ? 'A Boston!' : 'You made it!') : 'Set!',
    `<p>${mine ? 'Your team' : 'Their team'} took <b>${books}</b> books and needed <b>${r.needed}</b>.</p>` +
    (r.made
      ? (r.contract && r.contract.type === 'notrump' && r.delta === (books - 6) * 2
        ? `<p>A made bid scores <b>every book over six</b> — and No-Trump counts double: (${books} − 6) × 2 = <b>${r.delta} points</b>.</p>`
        : `<p>A made bid scores <b>every book over six</b>: ${books} − 6 = <b>${r.delta} points</b>. That&rsquo;s why it pays to take extra books even after you&rsquo;ve made it.</p>`)
      : `<p>Getting set costs the bid: <b>${r.delta} points</b>.</p>`) +
    (L2() ? `<p>If you&rsquo;d been set, you&rsquo;d have lost double too: ${(r.contract ? r.contract.amount : 3) * 2} points. <b>First team to 7 wins the game.</b></p>`
      : `<p>If you&rsquo;d been set, you&rsquo;d have lost ${r.contract ? r.contract.amount : 4} instead. No-Trump bids score double either way. <b>First team to 7 wins the game.</b></p>`));
  if (L2()) {
    const end2 = await lesson('Lesson 2 done', 'No-Trump & Downtown',
      `<ol class="lesson-recap"><li><b>No-Trump</b>: no boss suit — the led suit wins, and jokers are throw-offs.</li>` +
      `<li><b>Downtown</b>: low cards win (ace, 2, 3…). Pick it when your hand is full of little cards.</li>` +
      `<li>No-Trump scores <b>double</b> — made or set.</li>` +
      `<li>If everyone passes, the <b>dealer must bid</b>.</li></ol>`,
      [{ label: 'Play the Computer', value: 'play', primary: true }, { label: 'Replay Lesson 2', value: 'again' }, { label: 'Back to the Menu', value: 'menu' }]);
    T.on = false; T.auto = false;
    if (end2 === 'play') startSolo();
    else if (end2 === 'again') startTutorial(2);
    else if (end2 === 'menu') { $('splash').classList.add('show'); }
    return;
  }
  const end = await lesson('That&rsquo;s Bid Whist!', 'You&rsquo;re ready to play',
    `<ol class="lesson-recap"><li><b>Bid</b> a number (books over six) — highest bid wins the kitty.</li>` +
    `<li><b>Name trump</b> and Uptown or Downtown, then <b>bury six</b>.</li>` +
    `<li><b>Follow suit</b> if you can; if you can&rsquo;t, <b>trump</b> it or throw off.</li>` +
    `<li>Make your bid to score every book over six. First to 7 wins.</li></ol>` +
    `<p>Tip: turn on <b>Coach</b> in Table Rules and it&rsquo;ll keep suggesting moves while you play.</p>`,
    [{ label: 'Play the Computer', value: 'play', primary: true }, { label: 'Lesson 2: No-Trump', value: 'l2' }, { label: 'Replay the Lesson', value: 'again' }, { label: 'Back to the Menu', value: 'menu' }]);
  T.on = false; T.auto = false;
  if (end === 'play') startSolo();
  else if (end === 'l2') startTutorial(2);
  else if (end === 'again') startTutorial();
  else if (end === 'menu') { $('splash').classList.add('show'); }
}
