/*
 * Bid Whist rules engine — pure logic, no DOM.
 * Works in the browser (global `Engine`) and in Node (module.exports) so the
 * same code drives the app and the test suite.
 *
 * Vocabulary:
 *   book     — a trick. 12 tricks per hand + the kitty book = 13 books.
 *   uptown   — high cards win (A high ... 2 low).
 *   downtown — low cards win (A still highest, then 2, 3, ... K lowest).
 *   contract — { amount, type: 'uptown'|'downtown'|'notrump', trump, direction }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SUIT_GLYPHS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  const DEFAULT_RULES = {
    minBid: 3,            // lowest permitted bid (3 or 4 are both common)
    gameTarget: 7,        // first team to this score wins; -gameTarget loses
    noTrumpDoubles: true, // no-trump contracts score double, made or set
    kittyIsBook: true,    // the kitty/discard counts as the bidders' first book
    forcedDealerBid: true,// if the first three pass, dealer must bid the minimum
    sportKitty: false,    // kitty is exposed to the whole table when picked up
    bostonDoubles: false, // a made 7-bid (Boston) scores double
  };

  // ---- deck -----------------------------------------------------------------

  function newDeck() {
    const deck = [];
    for (const suit of SUITS)
      for (let rank = 2; rank <= 14; rank++)
        deck.push({ id: suit + rank, suit, rank, joker: null });
    deck.push({ id: 'JB', suit: 'J', rank: 0, joker: 'big' });
    deck.push({ id: 'JL', suit: 'J', rank: 0, joker: 'little' });
    return deck;
  }

  function shuffle(deck, rng) {
    rng = rng || Math.random;
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function deal(deck) {
    const hands = [[], [], [], []];
    // 12 cards each, 6 to the kitty. Order is irrelevant once shuffled.
    for (let i = 0; i < 48; i++) hands[i % 4].push(deck[i]);
    return { hands, kitty: deck.slice(48, 54) };
  }

  // ---- bidding --------------------------------------------------------------

  // Numeric rank of a bid for comparison. At the same number, no-trump outranks
  // uptown/downtown; uptown and downtown at the same number are equal, so a
  // later bidder must go up a number (or to no-trump) to take it.
  function bidValue(bid) {
    if (!bid || bid.pass) return 0;
    return bid.amount * 2 + (bid.type === 'notrump' ? 1 : 0);
  }

  function isLegalBid(bid, currentHigh, rules) {
    rules = rules || DEFAULT_RULES;
    if (bid.pass) return true;
    if (bid.amount < rules.minBid || bid.amount > 7) return false;
    return bidValue(bid) > bidValue(currentHigh);
  }

  function describeBid(bid) {
    if (!bid || bid.pass) return 'Pass';
    const t = bid.type === 'notrump' ? 'No-Trump'
      : bid.type === 'downtown' ? 'Downtown' : 'Uptown';
    return bid.amount + ' ' + t;
  }

  // Books the defenders need to set this bid: 13 - (6 + amount) + 1 = 8 - amount.
  function booksToSet(amount) {
    return 8 - amount;
  }

  // ---- card ranking ---------------------------------------------------------

  // The suit a card belongs to for follow-suit purposes. In trump contracts the
  // jokers are the top two trumps; in no-trump they belong to no suit at all.
  function effectiveSuit(card, contract) {
    if (!card.joker) return card.suit;
    return contract.type === 'notrump' ? null : contract.trump;
  }

  // Strength of a card within its own suit for the contract's direction.
  // Uptown: A(14) high down to 2. Downtown: A high, then 2, 3, ... K lowest.
  function rankPower(rank, direction) {
    if (direction === 'downtown') return rank === 14 ? 15 : 15 - rank;
    return rank;
  }

  // Comparable power of a played card given the led suit. Jokers in a trump
  // contract beat every natural trump; in no-trump they can never win.
  function cardPower(card, contract, ledSuit) {
    const dir = contract.type === 'notrump' ? contract.direction : contract.type;
    if (card.joker) {
      if (contract.type === 'notrump') return 0;
      return card.joker === 'big' ? 1000 : 999;
    }
    if (contract.type !== 'notrump' && card.suit === contract.trump)
      return 500 + rankPower(card.rank, dir);
    if (card.suit === ledSuit) return rankPower(card.rank, dir);
    return 0;
  }

  // Led suit of a trick-in-progress. In no-trump a led joker sets no suit; the
  // first non-joker card played determines what must be followed.
  function trickLedSuit(trick, contract) {
    for (const play of trick) {
      const s = effectiveSuit(play.card, contract);
      if (s) return s;
    }
    return null;
  }

  function legalPlays(hand, trick, contract) {
    if (trick.length === 0) return hand.slice(); // any card may be led
    const led = trickLedSuit(trick, contract);
    if (!led) return hand.slice(); // no-trump, only jokers down so far
    const follow = hand.filter((c) => effectiveSuit(c, contract) === led);
    return follow.length ? follow : hand.slice();
  }

  function trickWinner(trick, contract) {
    const led = trickLedSuit(trick, contract);
    let best = trick[0];
    let bestPower = cardPower(best.card, contract, led);
    for (let i = 1; i < trick.length; i++) {
      const p = cardPower(trick[i].card, contract, led);
      if (p > bestPower) { best = trick[i]; bestPower = p; }
    }
    return best.player;
  }

  // ---- scoring --------------------------------------------------------------

  // books = total books for the bidding team, kitty book already included.
  function scoreHand(amount, contract, books, rules) {
    rules = rules || DEFAULT_RULES;
    const needed = 6 + amount;
    const made = books >= needed;
    let mult = 1;
    if (contract.type === 'notrump' && rules.noTrumpDoubles) mult *= 2;
    if (amount === 7 && rules.bostonDoubles) mult *= 2;
    const delta = made ? (books - 6) * mult : -amount * mult;
    return { made, needed, delta, over: books - 6 };
  }

  function gameOver(scores, rules) {
    rules = rules || DEFAULT_RULES;
    const t = rules.gameTarget;
    if (scores[0] >= t || scores[1] <= -t) return 0;
    if (scores[1] >= t || scores[0] <= -t) return 1;
    return null;
  }

  // ---- display helpers ------------------------------------------------------

  function cardLabel(card) {
    if (card.joker) return card.joker === 'big' ? 'Big Joker' : 'Little Joker';
    return (RANK_NAMES[card.rank] || String(card.rank)) + SUIT_GLYPHS[card.suit];
  }

  function rankLabel(rank) {
    return RANK_NAMES[rank] || String(rank);
  }

  // Sort a hand for display: suits grouped, jokers first, direction-aware.
  function sortHand(hand, direction) {
    const suitOrder = { S: 0, H: 1, C: 2, D: 3, J: -1 };
    return hand.slice().sort((a, b) => {
      if (!!a.joker !== !!b.joker) return a.joker ? -1 : 1;
      if (a.joker && b.joker) return a.joker === 'big' ? -1 : 1;
      if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
      return rankPower(b.rank, direction) - rankPower(a.rank, direction);
    });
  }

  return {
    SUITS, SUIT_NAMES, SUIT_GLYPHS, DEFAULT_RULES,
    newDeck, shuffle, deal,
    bidValue, isLegalBid, describeBid, booksToSet,
    effectiveSuit, rankPower, cardPower, trickLedSuit, legalPlays, trickWinner,
    scoreHand, gameOver,
    cardLabel, rankLabel, sortHand,
  };
});
