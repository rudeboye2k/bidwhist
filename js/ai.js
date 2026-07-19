/*
 * Bid Whist AI — heuristic bidding and play. No DOM; usable from Node for
 * simulation. Depends on engine.js.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports)
    module.exports = factory(require('./engine.js'));
  else root.AI = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  // ---- hand evaluation ------------------------------------------------------

  function bySuit(hand) {
    const map = { S: [], H: [], D: [], C: [], J: [] };
    for (const c of hand) map[c.suit].push(c);
    return map;
  }

  // Estimated books this hand wins with `trump` as trump in `direction`.
  // Tuned against simulation, not theory — see tests/simulate.js.
  function evalTrump(hand, trump, direction) {
    const suits = bySuit(hand);
    const jokers = suits.J.length;
    const trumps = suits[trump];
    let est = jokers * 1.0;

    const power = (r) => Engine.rankPower(r, direction);
    const top3 = direction === 'uptown' ? [14, 13, 12] : [14, 2, 3];

    for (const c of trumps) {
      if (c.rank === top3[0]) est += 1.0;
      else if (c.rank === top3[1]) est += 0.7;
      else if (c.rank === top3[2]) est += 0.45;
    }
    est += Math.max(0, trumps.length + jokers - 3) * 0.65;

    for (const s of ['S', 'H', 'D', 'C']) {
      if (s === trump) continue;
      const cards = suits[s];
      for (const c of cards) {
        if (c.rank === top3[0]) est += 0.85;
        else if (c.rank === top3[1] && cards.length >= 2) est += 0.4;
      }
      if (trumps.length + jokers >= 4) {
        if (cards.length === 0) est += 0.8;
        else if (cards.length === 1) est += 0.45;
      }
      void power; // direction is fully captured by top3
    }
    return est;
  }

  function evalNoTrump(hand, direction) {
    const suits = bySuit(hand);
    const top3 = direction === 'uptown' ? [14, 13, 12] : [14, 2, 3];
    let est = 0;
    for (const s of ['S', 'H', 'D', 'C']) {
      const cards = suits[s];
      for (const c of cards) {
        if (c.rank === top3[0]) est += 1.0;
        else if (c.rank === top3[1]) est += cards.length >= 2 ? 0.65 : 0.3;
        else if (c.rank === top3[2]) est += cards.length >= 3 ? 0.35 : 0.15;
      }
      est += Math.max(0, cards.length - 4) * 0.5; // long-suit tricks once bosses run
    }
    return est; // jokers are dead weight in no-trump
  }

  // Best available contract for this hand, with an estimated team book count.
  // Team estimate = own post-kitty strength + partner + kitty book.
  function bestPlan(hand) {
    let best = null;
    for (const trump of ['S', 'H', 'D', 'C']) {
      for (const direction of ['uptown', 'downtown']) {
        const est = evalTrump(hand, trump, direction);
        if (!best || est > best.est)
          best = { type: direction, trump, direction, est };
      }
    }
    for (const direction of ['uptown', 'downtown']) {
      const est = evalNoTrump(hand, direction) - 0.2; // NT is riskier: no ruffs
      if (est > best.est) best = { type: 'notrump', trump: null, direction, est };
    }
    // Own tricks improve after ditching 6 of 18 cards; partner ~2; kitty book 1.
    best.teamBooks = best.est * 1.15 + 4.2;
    return best;
  }

  // ---- bidding --------------------------------------------------------------

  // Returns {pass:true} or {amount, type} plus a private plan for later.
  function chooseBid(hand, currentHigh, rules, mustBid, rng) {
    rng = rng || Math.random;
    const plan = bestPlan(hand);
    const noise = (rng() - 0.5) * 0.8;
    let maxAmount = Math.floor(plan.teamBooks + noise) - 6;
    maxAmount = Math.min(7, maxAmount);

    // Minimum bid that beats the table. Our type matters: no-trump can match
    // the current number; uptown/downtown must exceed it.
    const cur = Engine.bidValue(currentHigh);
    let amount = rules.minBid;
    while (
      amount <= 7 &&
      !Engine.isLegalBid({ amount, type: plan.type }, currentHigh, rules)
    ) amount++;

    if (amount <= 7 && amount <= maxAmount)
      return { bid: { amount, type: plan.type }, plan };

    if (mustBid) {
      // Dealer stuck by three passes: bid the floor with the best plan.
      let a = rules.minBid;
      while (!Engine.isLegalBid({ amount: a, type: plan.type }, currentHigh, rules)) a++;
      return { bid: { amount: Math.min(a, 7), type: plan.type }, plan };
    }
    void cur;
    return { bid: { pass: true }, plan };
  }

  // ---- kitty discard --------------------------------------------------------

  // From 18 cards keep the best 12 for the contract; return the 6 discards.
  function chooseDiscards(hand, contract) {
    const keepValue = (c) => {
      if (c.joker) return contract.type === 'notrump' ? -1 : 2000;
      const dir = contract.type === 'notrump' ? contract.direction : contract.type;
      const p = Engine.rankPower(c.rank, dir);
      if (contract.type !== 'notrump' && c.suit === contract.trump) return 1000 + p;
      return p;
    };
    return hand.slice().sort((a, b) => keepValue(a) - keepValue(b)).slice(0, 6);
  }

  // ---- trick play -----------------------------------------------------------

  function currentWinner(trick, contract) {
    if (!trick.length) return null;
    return Engine.trickWinner(trick, contract);
  }

  // memory = Set of card ids already played this hand (shared, updated by app).
  // Returns the card to play. `seat` is this AI's seat; partner = (seat+2)%4.
  function choosePlay(hand, trick, contract, seat, memory) {
    const legal = Engine.legalPlays(hand, trick, contract);
    if (legal.length === 1) return legal[0];
    const dir = contract.type === 'notrump' ? contract.direction : contract.type;
    const power = (c) => Engine.cardPower(c, contract, Engine.trickLedSuit(trick, contract) || Engine.effectiveSuit(c, contract));
    const inSuitPower = (c) => c.joker ? (contract.type === 'notrump' ? 0 : (c.joker === 'big' ? 1000 : 999)) : Engine.rankPower(c.rank, dir);

    // Is `card` the strongest still-unseen card of its suit? (boss card)
    const isBoss = (card) => {
      if (card.joker) return contract.type !== 'notrump';
      for (let r = 2; r <= 14; r++) {
        if (r === card.rank) continue;
        if (Engine.rankPower(r, dir) > Engine.rankPower(card.rank, dir) &&
            !memory.has(card.suit + r)) return false;
      }
      if (contract.type !== 'notrump' && card.suit === contract.trump)
        return !(!memory.has('JB') || !memory.has('JL'));
      return true;
    };

    if (trick.length === 0) {
      // Leading. Prefer a boss card; declarer-side leads trumps to pull them.
      const bosses = legal.filter(isBoss);
      if (bosses.length) {
        const trumpBoss = bosses.find((c) => contract.type !== 'notrump' &&
          (c.joker || c.suit === contract.trump));
        return trumpBoss || bosses.sort((a, b) => inSuitPower(b) - inSuitPower(a))[0];
      }
      // No boss: lead low from the longest side suit toward partner.
      const suits = {};
      for (const c of legal) {
        const s = Engine.effectiveSuit(c, contract) || 'J';
        (suits[s] = suits[s] || []).push(c);
      }
      let bestSuit = null;
      for (const s of Object.keys(suits)) {
        if (contract.type !== 'notrump' && s === contract.trump) continue;
        if (!bestSuit || suits[s].length > suits[bestSuit].length) bestSuit = s;
      }
      const pool = bestSuit ? suits[bestSuit] : legal;
      return pool.sort((a, b) => inSuitPower(a) - inSuitPower(b))[0];
    }

    const winnerSeat = currentWinner(trick, contract);
    const partnerWinning = winnerSeat === (seat + 2) % 4;
    const lastToPlay = trick.length === 3;
    const winnerPower = Math.max(...trick.map((p) =>
      Engine.cardPower(p.card, contract, Engine.trickLedSuit(trick, contract))));
    const led = Engine.trickLedSuit(trick, contract);
    const beats = legal.filter((c) => Engine.cardPower(c, contract, led) > winnerPower);

    if (partnerWinning) {
      // Partner has it: only overtake if partner's card is weak and we are last.
      if (lastToPlay || winnerPower >= 500 || (led && winnerPower >= Engine.rankPower(dir === 'downtown' ? 3 : 12, dir)))
        return legal.sort((a, b) => power(a) - power(b))[0];
    }
    if (beats.length) {
      // Win as cheaply as possible.
      return beats.sort((a, b) => power(a) - power(b))[0];
    }
    // Can't win: throw the least valuable card (in NT, jokers first).
    return legal.sort((a, b) => {
      const va = a.joker && contract.type === 'notrump' ? -1 : inSuitPower(a);
      const vb = b.joker && contract.type === 'notrump' ? -1 : inSuitPower(b);
      return va - vb;
    })[0];
  }

  return { bestPlan, evalTrump, evalNoTrump, chooseBid, chooseDiscards, choosePlay };
});
