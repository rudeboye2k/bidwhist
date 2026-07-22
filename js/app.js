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
  function teamLabel(team) { return team === myTeam() ? 'Us' : 'Them'; }
  function seatName(seat) {
    if (G.mode === 'online' && G.view && G.view.seats) {
      if (seat === G.viewSeat) return 'You';
      const s = G.view.seats[seat];
      return (s && s.name) || 'Player';
    }
    if (seat === 0 && G.profile && G.profile.name) return G.profile.name;
    return NAMES[seat];
  }
  function seatVerb(seat, base) { return seat === G.viewSeat ? base : base + 's'; }

  // ---- profile & avatars ----------------------------------------------------
  // Your name + avatar, saved locally. The avatar is always a small image data
  // URL (an uploaded photo, or a rendered cartoon) so it shares cleanly online.

  const PROFILE_KEY = 'bidwhist.profile';
  const CARTOONS = ['🦊','🐼','🐵','🐸','🐯','🦁','🐰','🐨','🐷','🐮','🐔','🐧','🐙','🦄','🐲','🐺','🦉','🐱','🐶','🐹','🐗','🦝','🐻','🦖','🐳','🦓','🐴','🐝'];
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
  function cartoonFor(seed) {
    const h = hashStr(seed);
    const p = PALETTE[(h >>> 8) % PALETTE.length];
    return { emoji: CARTOONS[h % CARTOONS.length], c1: p[0], c2: p[1] };
  }
  function randomCartoon() {
    const emoji = CARTOONS[Math.floor(Math.random() * CARTOONS.length)];
    const p = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    return { emoji, c1: p[0], c2: p[1] };
  }
  // Render a cartoon spec to a small PNG data URL (so it travels online).
  function cartoonImage(spec) {
    const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, spec.c1); g.addColorStop(1, spec.c2);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.font = '58px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(spec.emoji, S / 2, S / 2 + 4);
    return c.toDataURL('image/png');
  }
  // Cover-crop an uploaded image to a small JPEG data URL.
  function processAvatarFile(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
          const x = c.getContext('2d');
          const scale = Math.max(S / img.width, S / img.height);
          const w = img.width * scale, h = img.height * scale;
          x.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          res(c.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = rej; img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (p && p.name && p.avatar) return p;
    } catch (_) { /* fall through */ }
    return { name: 'You', avatar: cartoonImage(randomCartoon()) }; // random cartoon by default
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) { /* ignore */ }
  }

  // Avatar to draw for a seat: an image for the local player / online players,
  // a name-derived cartoon for solo AI seats and avatarless online seats.
  function avatarSpecFor(seat) {
    if (G.mode === 'online' && G.view && G.view.seats) {
      const s = G.view.seats[seat];
      if (s && s.avatar) return { img: s.avatar };
      return cartoonFor(((s && s.name) || 'seat') + '#' + seat);
    }
    if (seat === 0) return { img: G.profile.avatar };
    return cartoonFor(NAMES[seat] + '#' + seat);
  }
  function applyAvatar(el, spec) {
    if (!el) return;
    if (spec.img) { el.style.backgroundImage = `url("${spec.img}")`; el.textContent = ''; }
    else { el.style.backgroundImage = `linear-gradient(135deg, ${spec.c1}, ${spec.c2})`; el.textContent = spec.emoji; }
  }

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
    learner: AI.createLearner(), // adapts across hands within this session
    mode: 'local',               // 'local' | 'online'
    viewSeat: 0,                 // this client's server seat (0 for local)
    view: null,                  // last server snapshot (online)
    net: null,                   // Net controller (online)
    profile: loadProfile(),      // { name, avatar } saved locally
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
    const us = myTeam(), them = 1 - us;
    $('score-us').textContent = G.scores[us];
    $('score-them').textContent = G.scores[them];
    $('score-target').textContent = 'first to ' + G.rules.gameTarget;
    $('books-us').textContent = G.books[us];
    $('books-them').textContent = G.books[them];
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

  // Render every server seat except mine (slot 0) as face-down backs at its slot.
  function renderOppHands() {
    for (const p of [1, 2, 3]) { const box = $('opp-hand-' + p); if (box) box.innerHTML = ''; }
    if (!G.hands) return;
    for (let seat = 0; seat < 4; seat++) {
      if (seat === G.viewSeat) continue;
      const box = $('opp-hand-' + slot(seat));
      if (!box) continue;
      const n = G.hands[seat] ? G.hands[seat].length : 0;
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
      if (nameEl) nameEl.textContent = seatName(seat);
      if (roleEl) {
        let role = seat === G.viewSeat ? 'you'
          : seat === (G.viewSeat + 2) % 4 ? 'your partner' : SLOT_ROLE[slot(seat)];
        if (G.mode === 'online' && G.view && G.view.seats) {
          const s = G.view.seats[seat];
          if (s && s.kind === 'ai') role += ' · bot';
          else if (s && s.kind === 'human' && !s.connected) role += ' · away';
        }
        roleEl.textContent = role;
      }
      plate.classList.toggle('you', seat === G.viewSeat);
    }
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
    for (let p = 0; p < 4; p++) { const c = $('chip-' + p); if (c) { c.classList.remove('show'); c.innerHTML = ''; } }
    for (let seat = 0; seat < 4; seat++) {
      const chip = $('chip-' + slot(seat));
      if (!chip) continue;
      const html = bidChipHtml(seat);
      if (html == null) continue;
      chip.classList.add('show');
      chip.innerHTML = html;
    }
  }

  function renderHand() {
    const box = $('hand');
    box.innerHTML = '';
    if (!G.hands || !G.hands[G.viewSeat]) return;
    const cards = E.sortHand(G.hands[G.viewSeat], sortDirection());
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
    wrap.className = 'played from-' + slot(seat);
    wrap.appendChild(cardEl(card, true));
    $('trick').appendChild(wrap);
  }

  async function collectTrick(winnerSeat) {
    const t = $('trick');
    t.classList.add('collect', 'to-' + slot(winnerSeat));
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
      const count = G.hands[G.viewSeat].filter((c) => c.suit === s).length;
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
      G.discardPicks = new Set(AI.chooseDiscards(G.hands[G.viewSeat], G.contract).map((c) => c.id));
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

    log(`— Hand ${G.handNo}. <b>${seatName(G.dealer)}</b> deal${G.dealer === 0 ? '' : 's'}. —`, true);
    renderScores(); renderContractLine(); renderBidChips();
    renderOppHands(); renderKitty('back'); renderHand();
    renderPlates(); renderSeatsMeta(null);
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
        const res = AI.chooseBid(G.hands[seat], G.high, G.rules, mustBid, Math.random, G.learner, seat);
        bid = res.bid;
        if (!bid.pass) G.plans[seat] = res.plan;
      }

      G.bids[seat] = bid;
      renderBidChips();
      if (bid.pass) {
        log(`${NAMES[seat]} pass${seat === 0 ? '' : 'es'}.`);
      } else {
        bid._seat = seat;
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
    renderBidChips(); // reveal the trump suit on the declarer's chip

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
      `${seatName(G.highSeat)} bid ${E.describeBid(G.high)}`;
    const deltaCls = (isUs ? res.delta >= 0 : res.delta < 0) ? 'pos' : 'neg';
    const us = myTeam(), them = 1 - us;
    $('summary-body').innerHTML =
      `${teamLabel(bidTeam)} took <b>${G.books[bidTeam]}</b> of 13 books` +
      (G.rules.kittyIsBook ? ' (kitty included)' : '') +
      ` — needed <b>${res.needed}</b>.` +
      `<span class="delta ${deltaCls}">${res.delta >= 0 ? '+' : ''}${res.delta} ${teamLabel(bidTeam)}</span>` +
      `Score: Us <b>${G.scores[us]}</b> · Them <b>${G.scores[them]}</b>`;
    log(res.made
      ? `<b>${teamLabel(bidTeam)}</b> make it: ${res.delta >= 0 ? '+' : ''}${res.delta}.`
      : `<b>${teamLabel(bidTeam)}</b> get set: ${res.delta}.`, true);

    // The table learns from the hand. Calibrate off the AI's own declared hands
    // (not the human's), and always update the per-seat read on every player.
    AI.observeHand(G.learner, {
      declarerSeat: G.highSeat, amount: G.contract.amount, needed: res.needed,
      bidTeamBooks: G.books[bidTeam], made: res.made,
      calibrate: G.highSeat !== 0,
    });
    maybeShowRead();

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
      ? `${seatName(0)} and ${seatName(2)} take the game!`
      : `${seatName(1)} and ${seatName(3)} take the game.`;
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

  // ---- online play ----------------------------------------------------------
  // The server owns the game. We render its per-player snapshots, animate the
  // event stream, and — on our turn — reuse the very same input panels as local
  // play by pointing G.resolve at an intent-sender instead of a local promise.

  const Online = {
    base: '', code: '', name: '', token: null, isHost: false,
    conn: null, queue: [], draining: false, started: false,
  };

  function tokenKey(code) { return 'bidwhist.token.' + code; }

  function openOnlineSetup() {
    $('online-error').textContent = '';
    $('online-server').value = Net.serverBase();
    renderOnlineProfile();
    $('modal-online').classList.add('show');
  }

  // Show the current player (avatar + name) in the online setup.
  function renderOnlineProfile() {
    applyAvatar($('online-avatar'), { img: G.profile.avatar });
    $('online-pname').textContent = G.profile.name;
  }
  function renderSplashProfile() {
    applyAvatar($('splash-avatar'), { img: G.profile.avatar });
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
      setOnlineError('Could not reach the server. Check the URL. (' + (e.message || e) + ')');
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
    if (!/^https?:\/\//.test(base)) { setOnlineError('Enter your server URL (https://…workers.dev).'); return ''; }
    Net.saveServer(base);
    return base;
  }
  function setOnlineError(msg) { $('online-error').textContent = msg || ''; }

  function connectRoom(base, code, isHost) {
    Object.assign(Online, { base, code, isHost, queue: [], draining: false, started: false });
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
      onError() { setOnlineError('Connection error. Check the server URL.'); },
    });
  }

  function onServerMessage(msg) {
    if (msg.type === 'welcome') {
      Online.token = msg.token;
      Online.isHost = !!msg.host;
      try { localStorage.setItem(tokenKey(Online.code), msg.token); } catch (_) { /* ignore */ }
      G.mode = 'online';
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
        'illegal-play': 'You can\'t play that card.',
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
      G.view = msg.view; // expose the fresh roster so names resolve during animation
      await animateEvents(msg.events || []);
      applyView(msg.view);
    }
    Online.draining = false;
  }

  const PACE = { bid: 480, play: 560, trick: 820 };

  async function animateEvents(events) {
    for (const ev of events) {
      switch (ev.t) {
        case 'deal':
          G.bids = [null, null, null, null];
          G.dealer = ev.dealer; G.handNo = ev.handNo;
          $('trick').innerHTML = '';
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
            ? 'calls No-Trump, running ' + (c.direction === 'uptown' ? 'uptown' : 'downtown')
            : 'names <b>' + E.SUIT_NAMES[c.trump] + '</b> trump, ' + c.type}.`, true);
          break;
        }
        case 'kitty':
          if (ev.sport && ev.cards) {
            G.kitty = ev.cards; renderKitty('sported');
            tableMsg(`${seatName(ev.seat)} sports the kitty.`);
            await wait(1800); tableMsg('');
          }
          renderKitty('gone');
          break;
        case 'leadturn':
          tableMsg(ev.seat === G.viewSeat ? 'You lead.' : seatName(ev.seat) + ' leads.');
          break;
        case 'play':
          addPlayedCard(ev.seat, ev.card);
          if (ev.seat !== G.viewSeat) { G.hands[ev.seat] && G.hands[ev.seat].pop(); renderOppHands(); }
          tableMsg('');
          await wait(PACE.play);
          break;
        case 'trick':
          await wait(PACE.trick - PACE.play);
          log(`<b>${seatName(ev.winner)}</b> ${seatVerb(ev.winner, 'take')} the book.`);
          await collectTrick(ev.winner);
          break;
        case 'handend':
          showOnlineSummary(ev.result);
          await wait(300);
          break;
        case 'gameover':
          showOnlineGameover(ev.winner, ev.scores);
          await wait(200);
          break;
        default: break;
      }
    }
  }

  function applyView(view) {
    G.view = view;
    if (view.rules) G.rules = Object.assign({}, G.rules, view.rules);
    G.scores = view.scores.slice();
    G.books = view.books.slice();
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
    G.kitty = new Array(6).fill(null);

    if (view.phase === 'lobby') { showLobby(view); return; }
    Online.started = true;
    $('splash').classList.remove('show');
    $('modal-online').classList.remove('show');
    $('modal-lobby').classList.remove('show');

    renderScores(); renderContractLine(); renderPlates();
    renderOppHands(); renderBidChips(); renderSeatsMeta(view.turn);
    renderKitty(view.phase === 'bidding' ? 'back' : 'gone');
    renderHand();
    setupTurn(view);
  }

  function setupTurn(view) {
    const mine = view.you && view.turn === view.you.seat && view.need;
    if (!mine) {
      G.awaiting = null; G.resolve = null; G.legalIds = new Set();
      renderHand();
      if (view.phase === 'handover') actionHint(view.result && view.hostToken ? 'Deal the next hand when ready.' : 'Hand over.');
      else if (view.phase === 'gameover') actionHint('&nbsp;');
      else actionHint(view.turn != null ? `Waiting on <b>${seatName(view.turn)}</b>…` : '&nbsp;');
      return;
    }
    G._sent = false;
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
      G.resolve = (suit) => send({ type: 'declare', trump: suit });
      showDeclareSuit();
    } else if (view.need === 'declare-dir') {
      G.resolve = (dir) => send({ type: 'declare', direction: dir });
      showDeclareDirection();
    } else if (view.need === 'discard') {
      G.awaiting = 'discard'; G.discardPicks = new Set();
      G.resolve = () => send({ type: 'discard', cardIds: [...G.discardPicks] });
      renderHand(); showDiscardBar();
    } else if (view.need === 'play') {
      G.awaiting = 'play';
      G.legalIds = new Set(view.you.legalIds || []);
      G.resolve = (card) => send({ type: 'play', cardId: card.id });
      renderHand(); actionHint('Your play.');
    }
  }

  function showLobby(view) {
    $('lobby-code').textContent = Online.code;
    const roster = $('lobby-roster'); roster.innerHTML = '';
    const seatLetter = ['S', 'W', 'N', 'E'];
    view.seats.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'team-' + (s.team === 0 ? 'a' : 'b');
      const av = document.createElement('span');
      av.className = 'avatar';
      if (s.kind === 'empty') { av.classList.add('seat-empty'); av.textContent = seatLetter[s.seat]; }
      else applyAvatar(av, s.avatar ? { img: s.avatar } : cartoonFor((s.name || 'seat') + '#' + s.seat));
      const nm = document.createElement('span');
      nm.className = 'r-name';
      nm.textContent = s.kind === 'empty' ? '— open —' : (s.you ? 'You' : (s.name || 'Player'));
      li.appendChild(av); li.appendChild(nm);
      const tag = s.you ? '<span class="r-tag you">you</span>'
        : s.isHost ? '<span class="r-tag host">host</span>'
        : s.kind === 'ai' ? '<span class="r-tag">bot</span>'
        : s.kind === 'empty' ? '<span class="r-tag">open</span>'
        : (!s.connected ? '<span class="r-tag">away</span>' : '');
      if (tag) li.insertAdjacentHTML('beforeend', tag);
      roster.appendChild(li);
    });
    $('btn-start-online').style.display = view.hostToken ? '' : 'none';
    $('lobby-wait').style.display = view.hostToken ? 'none' : '';
    $('modal-online').classList.remove('show');
    $('splash').classList.remove('show');
    $('modal-lobby').classList.add('show');
  }

  function showOnlineSummary(r) {
    const bidTeam = r.bidTeam;
    const stamp = $('summary-stamp');
    stamp.className = 'stamp ' + (r.made ? 'made' : 'set');
    stamp.textContent = r.made ? (r.boston ? 'BOSTON!' : 'BID MADE') : 'SET!';
    $('summary-title').textContent = `${seatName(r.highSeat)} bid ${E.describeBid(r.bid)}`;
    const us = myTeam(), them = 1 - us;
    const deltaCls = (bidTeam === myTeam() ? r.delta >= 0 : r.delta < 0) ? 'pos' : 'neg';
    $('summary-body').innerHTML =
      `${teamLabel(bidTeam)} took <b>${r.books[bidTeam]}</b> of 13 books — needed <b>${r.needed}</b>.` +
      `<span class="delta ${deltaCls}">${r.delta >= 0 ? '+' : ''}${r.delta} ${teamLabel(bidTeam)}</span>` +
      `Score: Us <b>${r.scores[us]}</b> · Them <b>${r.scores[them]}</b>`;
    const btn = $('btn-next-hand');
    btn.textContent = Online.isHost ? 'Deal Next Hand' : 'Waiting for host…';
    btn.disabled = !Online.isHost;
    $('modal-summary').classList.add('show');
  }

  function showOnlineGameover(winner, scores) {
    const us = myTeam();
    const iWon = winner === us;
    const stamp = $('gameover-stamp');
    stamp.className = 'stamp ' + (iWon ? 'made' : 'set');
    stamp.textContent = iWon ? 'GAME' : 'BUSTED';
    $('gameover-title').textContent = iWon ? 'Your team takes the game!' : 'The other team takes it.';
    $('gameover-body').innerHTML = `Final: Us <b>${scores[us]}</b> · Them <b>${scores[1 - us]}</b>.`;
    const btn = $('btn-rematch');
    btn.textContent = Online.isHost ? 'Run It Back' : 'Waiting for host…';
    btn.disabled = !Online.isHost;
    $('modal-gameover').classList.add('show');
  }

  // ---- profile editor -------------------------------------------------------

  let editorImg = null;      // pending uploaded image data URL
  let editorCartoon = null;  // pending cartoon spec (overrides the image)

  function openProfileEditor() {
    editorImg = G.profile.avatar;
    editorCartoon = null;
    $('profile-name').value = G.profile.name === 'You' ? '' : G.profile.name;
    refreshProfilePreview();
    $('modal-profile').classList.add('show');
  }
  function refreshProfilePreview() {
    applyAvatar($('profile-preview'), editorCartoon || { img: editorImg || G.profile.avatar });
  }
  function saveProfileFromEditor() {
    const name = ($('profile-name').value || '').trim().slice(0, 16) || 'You';
    let avatar = G.profile.avatar;
    if (editorCartoon) avatar = cartoonImage(editorCartoon);
    else if (editorImg) avatar = editorImg;
    G.profile = { name, avatar };
    saveProfile(G.profile);
    $('modal-profile').classList.remove('show');
    renderPlates();
    renderOnlineProfile();
    renderSplashProfile();
    if (G.mode === 'online' && Online.conn) Online.conn.send({ type: 'profile', name, avatar });
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
    G.mode = 'local'; G.viewSeat = 0; G.running = true;
    startHand();
  });
  $('btn-next-hand').addEventListener('click', () => {
    $('modal-summary').classList.remove('show');
    if (G.mode === 'online') { if (Online.isHost) Online.conn.send({ type: 'nextHand' }); return; }
    G.dealer = (G.dealer + 1) % 4;
    startHand();
  });
  $('btn-rematch').addEventListener('click', () => {
    $('modal-gameover').classList.remove('show');
    if (G.mode === 'online') { if (Online.isHost) Online.conn.send({ type: 'start' }); return; }
    newGame();
  });
  $('btn-new-game').addEventListener('click', () => {
    if (!G.running) return;
    if (G.mode === 'online') { location.reload(); return; }
    if (confirm('Start a fresh game? Current scores will be wiped.')) newGame();
  });

  // Online setup + lobby wiring.
  $('btn-play-online').addEventListener('click', () => { $('splash').classList.remove('show'); openOnlineSetup(); });
  $('btn-online-back').addEventListener('click', () => { $('modal-online').classList.remove('show'); $('splash').classList.add('show'); });
  $('btn-host').addEventListener('click', hostTable);
  $('btn-join').addEventListener('click', joinTable);
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('btn-start-online').addEventListener('click', () => { if (Online.isHost) Online.conn.send({ type: 'start' }); });
  $('btn-leave-online').addEventListener('click', () => {
    try { Online.conn && Online.conn.send({ type: 'leave' }); Online.conn && Online.conn.close(); } catch (_) { /* ignore */ }
    location.reload();
  });
  $('btn-copy-key').addEventListener('click', () => {
    const done = () => { const b = $('btn-copy-key'); b.textContent = 'Copied!'; setTimeout(() => (b.textContent = 'Copy game key'), 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(Online.code).then(done, done); else done();
  });
  $('btn-reconnect').addEventListener('click', () => {
    $('modal-disconnect').classList.remove('show');
    connectRoom(Online.base, Online.code, Online.isHost);
  });
  $('btn-quit-online').addEventListener('click', () => location.reload());
  $('btn-settings').addEventListener('click', () => { settingsToForm(); $('modal-settings').classList.add('show'); });
  $('btn-settings-done').addEventListener('click', () => { formToSettings(); $('modal-settings').classList.remove('show'); });

  // Profile editor wiring.
  $('btn-profile').addEventListener('click', openProfileEditor);
  $('btn-edit-profile').addEventListener('click', openProfileEditor);
  $('splash-profile').addEventListener('click', openProfileEditor);
  $('btn-profile-cancel').addEventListener('click', () => $('modal-profile').classList.remove('show'));
  $('btn-profile-save').addEventListener('click', saveProfileFromEditor);
  $('btn-upload-avatar').addEventListener('click', () => $('avatar-file').click());
  $('btn-shuffle-avatar').addEventListener('click', () => { editorCartoon = randomCartoon(); editorImg = null; refreshProfilePreview(); });
  $('avatar-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try { editorImg = await processAvatarFile(file); editorCartoon = null; refreshProfilePreview(); }
    catch (_) { /* ignore unreadable image */ }
    e.target.value = '';
  });
  $('btn-rules').addEventListener('click', () => $('modal-howto').classList.add('show'));
  $('btn-howto-done').addEventListener('click', () => $('modal-howto').classList.remove('show'));

  renderScores();
  renderPlates(); // show the profile + AI avatars before the first deal
  renderSplashProfile();
  actionHint('Waiting on the deal…');
})();
