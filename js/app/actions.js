/* Give Me Da Kitty — actions.js
 * Your turn: the bid panel, naming trump, burying, and card taps.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// ---- action bar -----------------------------------------------------------

function actionHint(text) {
  $('action-bar').innerHTML = `<div class="action-hint">${text}</div>`;
}

// Bidding: just the number — or the number + No-Trump. Whoever bids highest
// names trump and Uptown/Downtown from their own 12 cards, THEN takes the kitty. A four is a four:
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

  const legal0 = (a, t) => E.isLegalBid({ amount: a, type: t }, G.high, G.rules);
  // In a lesson only the bid being taught can be made.
  const lock = T.on && T.bid;
  const legal = (a, t) => legal0(a, t) && (!lock || (a === lock.amount && t === lock.type));
  if (lock) { sel.amount = lock.amount; passBtn.disabled = true; }

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
    `. Win the bid, name trump and Uptown or Downtown, then take the kitty. ` +
    `<b>${a} No-Trump</b> beats a ${a}` + (R.noTrumpDoubles ? ' and scores double' : '') +
    `. They set you with <b>${8 - a}</b>.`;
}

// You won the bid: pick the trump suit AND the direction from your own 12
// cards, then confirm — the kitty comes after.
function showDeclareSuit() {
  const bar = $('action-bar');
  bar.innerHTML = '<div class="action-hint declare-hint">You won the bid. Name trump and pick a direction &mdash; then the kitty&rsquo;s yours:</div>';
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
    if (T.on && T.decl && T.decl.trump !== s) b.disabled = true;
    suitBtns[s] = b; suitRow.appendChild(b);
  }
  const dirRow = document.createElement('div'); dirRow.className = 'bid-group';
  const dirBtns = {};
  for (const [d, label] of [['uptown', 'Uptown <small>(high wins)</small>'], ['downtown', 'Downtown <small>(low wins)</small>']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chipbtn wide'; b.innerHTML = label;
    b.addEventListener('click', () => { sel.direction = d; refresh(); });
    if (T.on && T.decl && T.decl.direction !== d) b.disabled = true;
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
  bar.innerHTML = '<div class="action-hint">You won it in No-Trump. Which way does it run? Then the kitty&rsquo;s yours.</div>';
  const row = document.createElement('div'); row.className = 'bid-group';
  for (const [d, label] of [['uptown', 'Uptown (high wins)'], ['downtown', 'Downtown (low wins)']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chipbtn wide'; b.textContent = label;
    if (T.on && T.decl && T.decl.direction !== d) b.disabled = true; // lesson: the taught call only
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
  if (T.on) auto.hidden = true;
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
    if (T.on && G.coachIds && !G.coachIds.has(card.id)) return; // lesson: bury the outlined cards
    if (G.discardPicks.has(card.id)) G.discardPicks.delete(card.id);
    else if (G.discardPicks.size < kittySize()) G.discardPicks.add(card.id);
    renderHand(); updateDiscardBar();
  }
}
