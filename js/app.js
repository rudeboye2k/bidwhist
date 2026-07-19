/* Bid Whist table — UI + game flow. Depends on engine.js and ai.js (globals). */
(function () {
  'use strict';

  const E = window.Engine;
  const AI = window.AI;

  const NAMES = ['You', 'Pearl', 'Marcus', 'Deacon'];
  const TEAM_NAME = ['Us', 'Them'];
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const STORAGE_KEY = 'bidwhist.rules';

  function loadRules() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { ...E.DEFAULT_RULES, ...(saved || {}) };
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
  };

  // ---- logging & messages ---------------------------------------------------

  function log(html, hl) {
    const p = document.createElement('p');
    if (hl) p.className = 'hl';
    p.innerHTML = html;
    const box = $('log');
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  function tableMsg(text) {
    $('table-msg').textContent = text || '';
  }

  // ---- card DOM -------------------------------------------------------------

  function cardEl(card, faceUp) {
    const el = document.createElement('div');
    if (!faceUp) { el.className = 'card back'; return el; }
    if (card.joker) {
      el.className = 'card joker' + (card.joker === 'big' ? ' big' : '');
      el.innerHTML = '<span class="idx">JOKER</span><span class="pip">🃏</span>';
      el.title = E.cardLabel(card);
      return el;
    }
    const red = card.suit === 'H' || card.suit === 'D';
    el.className = 'card ' + (red ? 'red' : 'black');
    const r = E.rankLabel(card.rank);
    const g = E.SUIT_GLYPHS[card.suit];
    el.innerHTML =
      `<span class="idx">${r}<small>${g}</small></span>` +
      `<span class="pip">${g}</span>` +
      `<span class="idx flip">${r}<small>${g}</small></span>`;
    el.title = E.cardLabel(card);
    return el;
  }

  // ---- rendering ------------------------------------------------------------

  function sortDirection() {
    if (!G.contract) return 'uptown';
    return G.contract.type === 'notrump' ? G.contract.direction : G.contract.type;
  }

  function renderScores() {
    $('score-us').textContent = G.scores[0];
    $('score-them').textContent = G.scores[1];
    $('score-target').textContent = 'first to ' + G.rules.gameTarget;
    $('books-us').textContent = G.books[0];
    $('books-them').textContent = G.books[1];
  }

  function renderContractLine() {
    const line = $('contract-line');
    if (!G.contract) { line.textContent = 'No contract yet'; $('set-meter').innerHTML = ''; return; }
    const c = G.contract;
    const who = G.highSeat === 0 ? 'You' : NAMES[G.highSeat];
    let desc = c.amount + ' ' +
      (c.type === 'notrump'
        ? 'No-Trump (' + (c.direction === 'uptown' ? 'high' : 'low') + ')'
        : (c.type === 'uptown' ? 'Uptown' : 'Downtown') + ' in ' + E.SUIT_NAMES[c.trump]);
    line.innerHTML = `<b>${who}</b>: ${desc} — needs ${6 + c.amount} books`;
    renderSetMeter();
  }

  function renderSetMeter() {
    const m = $('set-meter');
    if (!G.contract) { m.innerHTML = ''; return; }
    const bidTeam = G.highSeat % 2;
    const defTeam = 1 - bidTeam;
    const needed = 6 + G.contract.amount;
    const toSet = E.booksToSet(G.contract.amount);
    if (G.books[bidTeam] >= needed) {
      m.innerHTML = `<span class="safe">Contract made — every extra book scores.</span>`;
    } else if (G.books[defTeam] >= toSet) {
      m.innerHTML = `<span class="danger">The bid is set — ${TEAM_NAME[defTeam]} stopped it.</span>`;
    } else {
      m.innerHTML =
        `${TEAM_NAME[bidTeam]} need <b>${needed - G.books[bidTeam]}</b> more to make it. ` +
        `<span class="${defTeam === 0 ? 'safe' : 'danger'}">${TEAM_NAME[defTeam]} need ` +
        `<b>${toSet - G.books[defTeam]}</b> to set.</span>`;
    }
  }

  function renderOppHands() {
    for (const seat of [1, 2, 3]) {
      const box = $('opp-hand-' + seat);
      box.innerHTML = '';
      const n = G.hands ? G.hands[seat].length : 0;
      for (let i = 0; i < n; i++) box.appendChild(cardEl(null, false));
    }
  }

  function renderKitty(state) {
    const k = $('kitty');
    k.innerHTML = '';
    k.classList.remove('gone', 'sported');
    if (state === 'gone') { k.classList.add('gone'); return; }
    const faceUp = state === 'sported';
    if (faceUp) k.classList.add('sported');
    for (const card of G.kitty) k.appendChild(cardEl(card, faceUp));
  }

  function renderSeatsMeta(turnSeat) {
    for (let s = 0; s < 4; s++) {
      const plate = $('plate-' + s);
      plate.classList.toggle('turn', turnSeat === s);
      plate.classList.toggle('dealer', G.dealer === s);
    }
  }

  function renderBidChips() {
    for (let s = 0; s < 4; s++) {
      const chip = $('chip-' + s);
      const bid = G.bids[s];
      if (!bid) { chip.classList.remove('show'); chip.innerHTML = ''; continue; }
      chip.classList.add('show');
      chip.innerHTML = bid.pass
        ? '<span class="chip-pass">pass</span>'
        : '“' + E.describeBid(bid) + '”';
    }
  }

  function renderHand() {
    const box = $('hand');
    box.innerHTML = '';
    if (!G.hands) return;
    const cards = E.sortHand(G.hands[0], sortDirection());
    const overlap = cards.length > 13 ? -40 : -26;
    box.style.setProperty('--overlap', overlap + 'px');
    cards.forEach((card, i) => {
      const el = cardEl(card, true);
      el.style.setProperty('--deal-delay', (i * 0.03) + 's');
      const playable =
        (G.awaiting === 'play' && G.legalIds.has(card.id)) ||
        G.awaiting === 'discard';
      if (!playable && (G.awaiting === 'play' || G.awaiting === 'discard'))
        el.classList.add('disabled');
      if (G.awaiting === 'discard' && G.discardPicks.has(card.id))
        el.classList.add('selected');
      el.addEventListener('click', () => onHandCardClick(card));
      box.appendChild(el);
    });
  }

  function addPlayedCard(seat, card) {
    const wrap = document.createElement('div');
    wrap.className = 'played from-' + seat;
    wrap.appendChild(cardEl(card, true));
    $('trick').appendChild(wrap);
  }

  async function collectTrick(winnerSeat) {
    const t = $('trick');
    t.classList.add('collect', 'to-' + winnerSeat);
    await wait(520);
    t.className = 'trick';
    t.innerHTML = '';
  }

  // ---- action bar -----------------------------------------------------------

  function actionHint(text) {
    $('action-bar').innerHTML = `<div class="action-hint">${text}</div>`;
  }

  function showBidPanel(mustBid) {
    const bar = $('action-bar');
    bar.innerHTML = '';
    const sel = { amount: null, type: 'uptown' };

    const mkChip = (label, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn' + (cls ? ' ' + cls : '');
      b.textContent = label;
      return b;
    };

    const amounts = [], types = {};
    const amountCol = document.createElement('div'); amountCol.className = 'bid-col';
    const amountRow = document.createElement('div'); amountRow.className = 'bid-group';
    amountRow.innerHTML = '<span class="lbl">Books over six</span>';
    for (let a = G.rules.minBid; a <= 7; a++) {
      const b = mkChip(String(a));
      b.addEventListener('click', () => { sel.amount = a; refresh(); });
      amounts.push({ a, b }); amountRow.appendChild(b);
    }
    amountCol.appendChild(amountRow);

    const typeRow = document.createElement('div'); typeRow.className = 'bid-group';
    typeRow.innerHTML = '<span class="lbl">Direction</span>';
    for (const [t, label] of [['uptown', 'Uptown'], ['downtown', 'Downtown'], ['notrump', 'No-Trump']]) {
      const b = mkChip(label, 'wide');
      b.addEventListener('click', () => { sel.type = t; refresh(); });
      types[t] = b; typeRow.appendChild(b);
    }
    amountCol.appendChild(typeRow);
    bar.appendChild(amountCol);

    const goCol = document.createElement('div'); goCol.className = 'bid-col';
    const bidBtn = document.createElement('button');
    bidBtn.type = 'button'; bidBtn.className = 'btn primary'; bidBtn.textContent = 'Place Bid';
    const passBtn = document.createElement('button');
    passBtn.type = 'button'; passBtn.className = 'btn ghost'; passBtn.textContent = 'Pass';
    if (mustBid) { passBtn.disabled = true; passBtn.title = 'Dealer must bid — the table passed to you.'; }
    goCol.appendChild(bidBtn); goCol.appendChild(passBtn);
    bar.appendChild(goCol);

    const legal = (a, t) => E.isLegalBid({ amount: a, type: t }, G.high, G.rules);

    function refresh() {
      // default to the cheapest legal call
      if (sel.amount === null) {
        outer: for (let a = G.rules.minBid; a <= 7; a++)
          for (const t of ['uptown', 'notrump'])
            if (legal(a, t)) { sel.amount = a; if (!legal(a, sel.type)) sel.type = t; break outer; }
      }
      for (const { a, b } of amounts) {
        b.disabled = !['uptown', 'downtown', 'notrump'].some((t) => legal(a, t));
        b.classList.toggle('on', sel.amount === a);
      }
      for (const t of Object.keys(types)) {
        types[t].disabled = sel.amount === null || !legal(sel.amount, t);
        types[t].classList.toggle('on', sel.type === t);
      }
      bidBtn.disabled = sel.amount === null || !legal(sel.amount, sel.type);
    }
    refresh();

    bidBtn.addEventListener('click', () => {
      if (G.resolve) G.resolve({ amount: sel.amount, type: sel.type });
    });
    passBtn.addEventListener('click', () => { if (G.resolve && !mustBid) G.resolve({ pass: true }); });
  }

  function showDeclareSuit() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint">Name your trump:</div>';
    const row = document.createElement('div'); row.className = 'bid-group';
    for (const s of E.SUITS) {
      const count = G.hands[0].filter((c) => c.suit === s).length;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn wide';
      b.style.color = (s === 'H' || s === 'D') ? '#e0705f' : '';
      b.innerHTML = `${E.SUIT_GLYPHS[s]} <small>(${count})</small>`;
      b.title = E.SUIT_NAMES[s];
      b.addEventListener('click', () => { if (G.resolve) G.resolve(s); });
      row.appendChild(b);
    }
    bar.appendChild(row);
  }

  function showDeclareDirection() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint">No-Trump — which way does it run?</div>';
    const row = document.createElement('div'); row.className = 'bid-group';
    for (const [d, label] of [['uptown', 'Uptown (high wins)'], ['downtown', 'Downtown (low wins)']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbtn wide'; b.textContent = label;
      b.addEventListener('click', () => { if (G.resolve) G.resolve(d); });
      row.appendChild(b);
    }
    bar.appendChild(row);
  }

  function showDiscardBar() {
    const bar = $('action-bar');
    bar.innerHTML = '<div class="action-hint" id="discard-hint"></div>';
    const auto = document.createElement('button');
    auto.type = 'button'; auto.className = 'btn ghost'; auto.textContent = 'Auto-pick';
    auto.addEventListener('click', () => {
      G.discardPicks = new Set(AI.chooseDiscards(G.hands[0], G.contract).map((c) => c.id));
      renderHand(); updateDiscardBar();
    });
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'btn primary'; done.id = 'btn-discard-done';
    done.textContent = 'Bury Six';
    done.addEventListener('click', () => {
      if (G.discardPicks.size === 6 && G.resolve) G.resolve(null);
    });
    bar.appendChild(auto); bar.appendChild(done);
    updateDiscardBar();
  }

  function updateDiscardBar() {
    const hint = $('discard-hint');
    const done = $('btn-discard-done');
    if (!hint || !done) return;
    hint.textContent = `The kitty is yours — pick six to bury (${G.discardPicks.size}/6). They count as your first book.`;
    done.disabled = G.discardPicks.size !== 6;
  }

  // ---- human input plumbing -------------------------------------------------

  function humanInput(kind) {
    G.awaiting = kind;
    return new Promise((res) => {
      G.resolve = (v) => { G.awaiting = null; G.resolve = null; res(v); };
    });
  }

  function onHandCardClick(card) {
    if (G.awaiting === 'play' && G.legalIds.has(card.id)) {
      const chosen = card;
      if (G.resolve) G.resolve(chosen);
    } else if (G.awaiting === 'discard') {
      if (G.discardPicks.has(card.id)) G.discardPicks.delete(card.id);
      else if (G.discardPicks.size < 6) G.discardPicks.add(card.id);
      renderHand(); updateDiscardBar();
    }
  }

  // ---- game flow ------------------------------------------------------------

  async function startHand() {
    if (G.nextRules) { G.rules = G.nextRules; G.nextRules = null; }
    G.handNo++;
    G.bids = [null, null, null, null];
    G.high = null; G.highSeat = null; G.plans = {};
    G.contract = null;
    G.books = [0, 0];
    G.memory = new Set();
    G.discardPicks = new Set();
    $('trick').innerHTML = '';

    const dealt = E.deal(E.shuffle(E.newDeck()));
    G.hands = dealt.hands; G.kitty = dealt.kitty;

    log(`— Hand ${G.handNo}. <b>${NAMES[G.dealer]}</b> deal${G.dealer === 0 ? '' : 's'}. —`, true);
    renderScores(); renderContractLine(); renderBidChips();
    renderOppHands(); renderKitty('back'); renderHand();
    renderSeatsMeta(null);
    tableMsg('');

    await wait(600);
    await runBidding();
  }

  async function runBidding() {
    for (let i = 1; i <= 4; i++) {
      const seat = (G.dealer + i) % 4;
      const mustBid = G.rules.forcedDealerBid && seat === G.dealer && !G.high;
      renderSeatsMeta(seat);

      let bid;
      if (seat === 0) {
        showBidPanel(mustBid);
        tableMsg(mustBid ? 'The table passed it to you, dealer.' : 'Your call.');
        bid = await humanInput('bid');
        tableMsg('');
        if (!bid.pass) G.plans[0] = { type: bid.type };
      } else {
        await wait(850);
        const res = AI.chooseBid(G.hands[seat], G.high, G.rules, mustBid);
        bid = res.bid;
        if (!bid.pass) G.plans[seat] = res.plan;
      }

      G.bids[seat] = bid;
      renderBidChips();
      if (bid.pass) {
        log(`${NAMES[seat]} pass${seat === 0 ? '' : 'es'}.`);
      } else {
        G.high = bid; G.highSeat = seat;
        log(`<b>${NAMES[seat]}</b> bid${seat === 0 ? '' : 's'} <b>${E.describeBid(bid)}</b>.`);
      }
    }
    renderSeatsMeta(null);

    if (!G.high) {
      log('All four pass — cards go in. New deal.', true);
      actionHint('Thrown in. Dealing again…');
      G.dealer = (G.dealer + 1) % 4;
      await wait(1200);
      return startHand();
    }
    await declareAndKitty();
  }

  async function declareAndKitty() {
    const seat = G.highSeat;
    const bid = G.high;
    actionHint(`${NAMES[seat]} won the auction at ${E.describeBid(bid)}.`);

    if (seat === 0) {
      let trump = null, direction;
      if (bid.type === 'notrump') {
        showDeclareDirection();
        direction = await humanInput('declare-dir');
      } else {
        showDeclareSuit();
        trump = await humanInput('declare-suit');
        direction = bid.type;
      }
      G.contract = { amount: bid.amount, type: bid.type, trump, direction };
    } else {
      await wait(900);
      const plan = G.plans[seat];
      G.contract = { amount: bid.amount, type: bid.type, trump: plan.trump, direction: plan.direction };
    }

    const c = G.contract;
    log(`<b>${NAMES[seat]}</b> ${c.type === 'notrump'
      ? 'calls No-Trump, running ' + (c.direction === 'uptown' ? 'uptown' : 'downtown')
      : 'names <b>' + E.SUIT_NAMES[c.trump] + '</b> trump, ' + c.type}.`, true);
    renderContractLine();

    // kitty pickup
    if (G.rules.sportKitty) {
      renderKitty('sported');
      tableMsg(`${NAMES[seat]} sports the kitty.`);
      await wait(2000);
      tableMsg('');
    }
    if (G.rules.kittyIsBook) G.books[seat % 2]++;

    G.hands[seat] = G.hands[seat].concat(G.kitty);
    renderKitty('gone');

    if (seat === 0) {
      G.awaiting = 'discard'; // before render so cards become selectable
      renderHand();
      showDiscardBar();
      await humanInput('discard');
      G.hands[0] = G.hands[0].filter((card) => !G.discardPicks.has(card.id));
      G.discardPicks = new Set();
    } else {
      await wait(1100);
      const discards = AI.chooseDiscards(G.hands[seat], G.contract);
      const ids = new Set(discards.map((card) => card.id));
      G.hands[seat] = G.hands[seat].filter((card) => !ids.has(card.id));
      log(`${NAMES[seat]} takes the kitty and buries six.`);
    }

    renderScores(); renderOppHands(); renderHand();
    await runPlay();
  }

  async function runPlay() {
    let leader = G.highSeat;
    tableMsg(leader === 0 ? 'You lead.' : NAMES[leader] + ' leads.');

    for (let t = 0; t < 12; t++) {
      const trick = [];
      for (let i = 0; i < 4; i++) {
        const seat = (leader + i) % 4;
        renderSeatsMeta(seat);
        let card;
        if (seat === 0) {
          const legal = E.legalPlays(G.hands[0], trick, G.contract);
          G.legalIds = new Set(legal.map((c) => c.id));
          G.awaiting = 'play'; // before render so illegal cards dim
          renderHand();
          actionHint(trick.length === 0 ? 'You lead — pick a card.' : 'Your play.');
          card = await humanInput('play');
          G.legalIds = new Set();
        } else {
          await wait(seat === 2 ? 800 : 700);
          card = AI.choosePlay(G.hands[seat], trick, G.contract, seat, G.memory);
        }
        G.hands[seat] = G.hands[seat].filter((c) => c.id !== card.id);
        trick.push({ player: seat, card });
        G.memory.add(card.id);
        addPlayedCard(seat, card);
        if (seat === 0) { renderHand(); actionHint('&nbsp;'); }
        else renderOppHands();
        if (trick.length === 1) tableMsg('');
      }

      const winner = E.trickWinner(trick, G.contract);
      renderSeatsMeta(null);
      await wait(950);
      G.books[winner % 2]++;
      log(`<b>${NAMES[winner]}</b> take${winner === 0 ? '' : 's'} the book (${E.cardLabel(trick.find((p) => p.player === winner).card)}).`);
      renderScores(); renderSetMeter();
      await collectTrick(winner);
      leader = winner;
      if (t < 11) tableMsg('');
    }
    await endHand();
  }

  async function endHand() {
    const bidTeam = G.highSeat % 2;
    const res = E.scoreHand(G.contract.amount, G.contract, G.books[bidTeam], G.rules);
    G.scores[bidTeam] += res.delta;
    renderScores();

    const boston = G.books[bidTeam] === 13;
    const stamp = $('summary-stamp');
    const isUs = bidTeam === 0;
    stamp.className = 'stamp ' + (res.made ? 'made' : 'set');
    stamp.textContent = res.made ? (boston ? 'BOSTON!' : 'BID MADE') : 'SET!';

    $('summary-title').textContent =
      `${NAMES[G.highSeat]} bid ${E.describeBid(G.high)}`;
    const deltaCls = (isUs ? res.delta >= 0 : res.delta < 0) ? 'pos' : 'neg';
    $('summary-body').innerHTML =
      `${TEAM_NAME[bidTeam]} took <b>${G.books[bidTeam]}</b> of 13 books` +
      (G.rules.kittyIsBook ? ' (kitty included)' : '') +
      ` — needed <b>${res.needed}</b>.` +
      `<span class="delta ${deltaCls}">${res.delta >= 0 ? '+' : ''}${res.delta} ${TEAM_NAME[bidTeam]}</span>` +
      `Score: Us <b>${G.scores[0]}</b> · Them <b>${G.scores[1]}</b>`;
    log(res.made
      ? `<b>${TEAM_NAME[bidTeam]}</b> make it: ${res.delta >= 0 ? '+' : ''}${res.delta}.`
      : `<b>${TEAM_NAME[bidTeam]}</b> get set: ${res.delta}.`, true);

    const winner = E.gameOver(G.scores, G.rules);
    await wait(400);
    if (winner !== null) return endGame(winner);
    $('modal-summary').classList.add('show');
  }

  function endGame(winner) {
    const stamp = $('gameover-stamp');
    stamp.className = 'stamp ' + (winner === 0 ? 'made' : 'set');
    stamp.textContent = winner === 0 ? 'GAME' : 'BUSTED';
    $('gameover-title').textContent = winner === 0
      ? 'You and Marcus take the game!'
      : 'Pearl and Deacon take the game.';
    $('gameover-body').innerHTML =
      `Final score: Us <b>${G.scores[0]}</b> · Them <b>${G.scores[1]}</b> after ${G.handNo} hand${G.handNo > 1 ? 's' : ''}.`;
    log(winner === 0 ? '<b>Game — Us.</b>' : '<b>Game — Them.</b>', true);
    $('modal-gameover').classList.add('show');
  }

  function newGame() {
    G.scores = [0, 0];
    G.handNo = 0;
    G.dealer = Math.floor(Math.random() * 4);
    $('log').innerHTML = '';
    startHand();
  }

  // ---- settings -------------------------------------------------------------

  function settingsToForm() {
    const f = $('settings-form');
    const r = G.nextRules || G.rules;
    f.minBid.value = String(r.minBid);
    f.gameTarget.value = String(r.gameTarget);
    for (const k of ['noTrumpDoubles', 'kittyIsBook', 'forcedDealerBid', 'sportKitty', 'bostonDoubles'])
      f[k].checked = !!r[k];
  }

  function formToSettings() {
    const f = $('settings-form');
    const r = {
      minBid: parseInt(f.minBid.value, 10),
      gameTarget: parseInt(f.gameTarget.value, 10),
      noTrumpDoubles: f.noTrumpDoubles.checked,
      kittyIsBook: f.kittyIsBook.checked,
      forcedDealerBid: f.forcedDealerBid.checked,
      sportKitty: f.sportKitty.checked,
      bostonDoubles: f.bostonDoubles.checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
    if (G.running) G.nextRules = r; else G.rules = r;
    renderScores();
  }

  // ---- wiring ---------------------------------------------------------------

  $('btn-deal-in').addEventListener('click', () => {
    $('splash').classList.remove('show');
    G.running = true;
    startHand();
  });
  $('btn-next-hand').addEventListener('click', () => {
    $('modal-summary').classList.remove('show');
    G.dealer = (G.dealer + 1) % 4;
    startHand();
  });
  $('btn-rematch').addEventListener('click', () => {
    $('modal-gameover').classList.remove('show');
    newGame();
  });
  $('btn-new-game').addEventListener('click', () => {
    if (!G.running) return;
    if (confirm('Start a fresh game? Current scores will be wiped.')) newGame();
  });
  $('btn-settings').addEventListener('click', () => { settingsToForm(); $('modal-settings').classList.add('show'); });
  $('btn-settings-done').addEventListener('click', () => { formToSettings(); $('modal-settings').classList.remove('show'); });
  $('btn-rules').addEventListener('click', () => $('modal-howto').classList.add('show'));
  $('btn-howto-done').addEventListener('click', () => $('modal-howto').classList.remove('show'));

  renderScores();
  actionHint('Waiting on the deal…');
})();
