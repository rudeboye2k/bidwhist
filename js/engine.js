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
    noJokers: false,      // play with 52 cards: 12 each and a 4-card kitty
    ntMinFour: false,     // a No-Trump bid must be at least 4
    leadRule: 'bidder',   // who leads the first book: 'bidder' or 'left' (of the dealer)
    renege: false,        // follow-suit isn't enforced; a renege can be called (3-book penalty)
    aiLevel: 'regular',   // computer players: 'easy' | 'regular' | 'sharp'
    turnTimer: 0,         // online: seconds before a bot plays an idle player's turn (0 = off)
  };

  // Quick reactions players can pop over their seat (online and solo). Index
  // is the wire format — append only.
  const REACTIONS = [
    'Run a Boston!', "Set 'em!", 'Partner! 😩', 'Who dealt this?', 'Give me da kitty!',
    'Nice book!', 'Too slow!', 'Uh-oh…', '😂', '🔥', '😤', '👏', '🙌', '😱',
  ];

  // ---- chat word filter ---------------------------------------------------
  // Typed table talk is masked ("f***") for profanity and slurs. Words are
  // checked after undoing common dodges (sh1t, $hit, fuuuck). Roots in ROOTS
  // are caught anywhere in a word; WORDS only as a whole word, so innocent
  // words stay intact (class, assassin, cocktail, spicy, Dickens, shoe).
  const ROOTS = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'nigg', 'niga', 'bitch', 'biatch', 'whore', 'slut', 'fagg',
    'faggot', 'retard', 'motherf', 'pussy', 'bastard', 'asshole', 'dickhead', 'jackass', 'twat', 'wank', 'kike',
    'wetback', 'tranny', 'piss', 'bullshit', 'dumbass', 'jackoff', 'jerkoff', 'cocksuck'];
  const WORDS = ['ass', 'asses', 'dick', 'dicks', 'cock', 'cocks', 'spic', 'spics', 'coon', 'coons', 'dyke', 'dykes',
    'chink', 'chinks', 'hoe', 'hoes', 'tit', 'tits', 'fag', 'fags', 'nig', 'damn', 'goddamn', 'crap', 'arse', 'skank'];
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '+': 't' };
  function badWord(token) {
    const norm = token.toLowerCase().replace(/[013457 8@$!+]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
    if (!norm) return false;
    const squeezed = norm.replace(/(.)\1+/g, '$1'); // fuuuck → fuck
    for (const w of [norm, squeezed]) {
      if (WORDS.includes(w)) return true;
      if (ROOTS.some((r) => w.includes(r))) return true;
    }
    return false;
  }
  function filterChat(text) {
    return String(text).replace(/[\p{L}\p{N}@$!+*]+/gu, (tok) => (badWord(tok) ? tok[0] + '*'.repeat(Math.max(2, tok.length - 1)) : tok));
  }

  // Accept only known rule values (rules travel over the wire from the host).
  function cleanRules(r) {
    const d = DEFAULT_RULES, o = {};
    r = r || {};
    o.minBid = r.minBid === 4 ? 4 : 3;
    o.gameTarget = [5, 7, 9, 11, 21].includes(r.gameTarget) ? r.gameTarget : d.gameTarget;
    for (const k of ['noTrumpDoubles', 'kittyIsBook', 'forcedDealerBid', 'sportKitty', 'bostonDoubles', 'noJokers', 'ntMinFour', 'renege'])
      o[k] = typeof r[k] === 'boolean' ? r[k] : d[k];
    o.leadRule = r.leadRule === 'left' ? 'left' : 'bidder';
    o.aiLevel = ['easy', 'regular', 'sharp'].includes(r.aiLevel) ? r.aiLevel : 'regular';
    o.turnTimer = [0, 20, 30, 45, 60].includes(r.turnTimer) ? r.turnTimer : 0;
    return o;
  }

  // ---- deck -----------------------------------------------------------------

  function newDeck(rules) {
    const deck = [];
    for (const suit of SUITS)
      for (let rank = 2; rank <= 14; rank++)
        deck.push({ id: suit + rank, suit, rank, joker: null });
    if (rules && rules.noJokers) return deck;
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
    // 12 cards each; the rest is the kitty (6 with jokers, 4 without).
    for (let i = 0; i < 48; i++) hands[i % 4].push(deck[i]);
    return { hands, kitty: deck.slice(48) };
  }

  // ---- bidding --------------------------------------------------------------

  // Bids are just a number (3–7), or a number plus No-Trump ("four no"). The
  // high bidder takes the kitty and only THEN names trump and Uptown/Downtown
  // (or, for No-Trump, just Uptown/Downtown) — so a bid's type is 'suit' or
  // 'notrump'. A four is a four: to beat it, bid five, or four No-Trump.
  // (Old 'uptown'/'downtown' bid types still compare as 'suit'.)
  function bidKind(type) { return type === 'notrump' ? 'notrump' : 'suit'; }

  // Numeric rank of a bid for comparison. At the same number, No-Trump outranks
  // a plain bid; otherwise you must go up a number.
  function bidValue(bid) {
    if (!bid || bid.pass) return 0;
    return bid.amount * 2 + (bid.type === 'notrump' ? 1 : 0);
  }

  function isLegalBid(bid, currentHigh, rules) {
    rules = rules || DEFAULT_RULES;
    if (bid.pass) return true;
    if (bid.amount < rules.minBid || bid.amount > 7) return false;
    if (bid.type === 'notrump' && rules.ntMinFour && bid.amount < 4) return false;
    return bidValue(bid) > bidValue(currentHigh);
  }

  function describeBid(bid) {
    if (!bid || bid.pass) return 'Pass';
    return bid.type === 'notrump' ? bid.amount + ' No-Trump' : String(bid.amount);
  }

  // "4 Downtown in Hearts" / "4 No-Trump, Uptown" — a declared contract.
  function describeContract(c) {
    if (!c) return '';
    if (c.type === 'notrump') return `${c.amount} No-Trump, ${c.direction === 'uptown' ? 'Uptown' : 'Downtown'}`;
    return `${c.amount} ${c.type === 'uptown' ? 'Uptown' : 'Downtown'} in ${SUIT_NAMES[c.trump]}`;
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

  // Led suit of a trick-in-progress. In no-trump a joker is only led when it's
  // all a player has left; it sets no suit, and the first real card played
  // determines what must be followed.
  function trickLedSuit(trick, contract) {
    for (const play of trick) {
      const s = effectiveSuit(play.card, contract);
      if (s) return s;
    }
    return null;
  }

  function legalPlays(hand, trick, contract) {
    if (trick.length === 0) {
      // Any card may be led — except that in no-trump the jokers are strictly
      // throw-offs: you can't lead one while you hold a real card.
      if (contract.type !== 'notrump') return hand.slice();
      const real = hand.filter((c) => !c.joker);
      return real.length ? real : hand.slice();
    }
    const led = trickLedSuit(trick, contract);
    if (!led) return hand.slice(); // no-trump, only jokers down so far
    const follow = hand.filter((c) => effectiveSuit(c, contract) === led);
    return follow.length ? follow : hand.slice();
  }

  // Cards a player may actually put down. Normally that's legalPlays. Under
  // the renege house rule, follow-suit isn't enforced (a renege can be called
  // instead) — but No-Trump jokers still can't be led.
  function allowedPlays(hand, trick, contract, rules) {
    if (!(rules && rules.renege) || trick.length === 0) return legalPlays(hand, trick, contract);
    return hand.slice();
  }

  // Did playing `card` break follow-suit? (Only possible under the renege rule.)
  function isRenege(hand, trick, contract, card) {
    if (trick.length === 0) return false;
    return !legalPlays(hand, trick, contract).some((c) => c.id === card.id);
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
  // Once trump is named, the trump suit moves to the left end with the two
  // jokers (its top cards) right beside it: Big, Little, then trump high to
  // low. In No-Trump the jokers are dead, so they go to the far right. Suits
  // keep alternating black/red (the order is just rotated to start at trump).
  function sortHand(hand, direction, contract) {
    const BASE = ['S', 'H', 'C', 'D'];
    const trump = contract && contract.type !== 'notrump' ? contract.trump : null;
    const start = trump ? BASE.indexOf(trump) : 0;
    const suitOrder = {};
    BASE.forEach((s, i) => { suitOrder[s] = (i - start + 4) % 4; });
    const jokersLast = !!(contract && contract.type === 'notrump');
    return hand.slice().sort((a, b) => {
      if (!!a.joker !== !!b.joker) return (a.joker ? -1 : 1) * (jokersLast ? -1 : 1);
      if (a.joker && b.joker) return a.joker === 'big' ? -1 : 1;
      if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
      return rankPower(b.rank, direction) - rankPower(a.rank, direction);
    });
  }

  // ---- seeded deals ----------------------------------------------------------
  // A small seeded RNG (mulberry32): the same seed always deals the same cards.
  // Used by Learn to Play and the Daily Deal.
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // The Daily Deal: one date (UTC, YYYY-MM-DD) → one seed, for everyone.
  function dailyDate(d) { return (d || new Date()).toISOString().slice(0, 10); }
  function dailySeed(date) {
    let h = 2166136261; // FNV-1a
    for (const ch of 'gmdk-daily:' + date) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) || 1;
  }

  return {
    SUITS, SUIT_NAMES, SUIT_GLYPHS, DEFAULT_RULES, REACTIONS, cleanRules, filterChat,
    seededRng, dailyDate, dailySeed,
    newDeck, shuffle, deal,
    bidKind, bidValue, isLegalBid, describeBid, describeContract, booksToSet,
    effectiveSuit, rankPower, cardPower, trickLedSuit, legalPlays, allowedPlays, isRenege, trickWinner,
    scoreHand, gameOver,
    cardLabel, rankLabel, sortHand,
  };
});
