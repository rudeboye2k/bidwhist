// Engine invariants. Run: node tests/engine.test.js
'use strict';
const E = require('../js/engine.js');

let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error('FAIL  ' + name); }
  else console.log('ok    ' + name);
}

// ---- deck & deal ----
const deck = E.newDeck();
check('deck has 54 cards', deck.length === 54);
check('deck has 2 jokers', deck.filter((c) => c.joker).length === 2);
check('deck ids unique', new Set(deck.map((c) => c.id)).size === 54);

const { hands, kitty } = E.deal(E.shuffle(deck));
check('four hands of 12', hands.every((h) => h.length === 12));
check('kitty of 6', kitty.length === 6);
check('deal uses every card once',
  new Set([...hands.flat(), ...kitty].map((c) => c.id)).size === 54);

// ---- bidding ----
const up4 = { amount: 4, type: 'uptown' };
const down4 = { amount: 4, type: 'downtown' };
const nt4 = { amount: 4, type: 'notrump' };
const up5 = { amount: 5, type: 'uptown' };
check('downtown 4 does not beat uptown 4', !E.isLegalBid(down4, up4));
check('no-trump 4 beats uptown 4', E.isLegalBid(nt4, up4));
check('uptown 5 beats no-trump 4', E.isLegalBid(up5, nt4));
check('no-trump 4 does not beat uptown 5', !E.isLegalBid(nt4, up5));
check('bid below minimum rejected',
  !E.isLegalBid({ amount: 2, type: 'uptown' }, null, E.DEFAULT_RULES));
check('pass always legal', E.isLegalBid({ pass: true }, up5));
check('books to set: bid 4 needs 4', E.booksToSet(4) === 4);
check('books to set: bid 7 needs 1', E.booksToSet(7) === 1);

// ---- card power: uptown trump ----
const upS = { amount: 4, type: 'uptown', trump: 'S', direction: 'uptown' };
const c = (suit, rank) => ({ id: suit + rank, suit, rank, joker: null });
const BJ = { id: 'JB', suit: 'J', rank: 0, joker: 'big' };
const LJ = { id: 'JL', suit: 'J', rank: 0, joker: 'little' };

check('big joker beats little joker',
  E.cardPower(BJ, upS, 'S') > E.cardPower(LJ, upS, 'S'));
check('little joker beats ace of trump',
  E.cardPower(LJ, upS, 'S') > E.cardPower(c('S', 14), upS, 'S'));
check('trump 2 beats off-suit ace (uptown)',
  E.cardPower(c('S', 2), upS, 'H') > E.cardPower(c('H', 14), upS, 'H'));

// ---- downtown ordering ----
const downS = { amount: 4, type: 'downtown', trump: 'S', direction: 'downtown' };
check('downtown: ace still highest',
  E.cardPower(c('H', 14), downS, 'H') > E.cardPower(c('H', 2), downS, 'H'));
check('downtown: 2 beats 3', E.cardPower(c('H', 2), downS, 'H') > E.cardPower(c('H', 3), downS, 'H'));
check('downtown: 3 beats king', E.cardPower(c('H', 3), downS, 'H') > E.cardPower(c('H', 13), downS, 'H'));

// ---- trick resolution ----
let trick = [
  { player: 0, card: c('H', 10) },
  { player: 1, card: c('H', 14) },
  { player: 2, card: c('S', 2) },   // trump
  { player: 3, card: c('H', 13) },
];
check('lowest trump beats ace of led suit', E.trickWinner(trick, upS) === 2);

trick = [
  { player: 0, card: c('H', 10) },
  { player: 1, card: c('H', 14) },
  { player: 2, card: c('S', 2) },
  { player: 3, card: LJ },
];
check('joker beats natural trump', E.trickWinner(trick, upS) === 3);

// ---- follow suit ----
const hand1 = [c('H', 5), c('S', 9), BJ];
let legal = E.legalPlays(hand1, [{ player: 3, card: c('H', 2) }], upS);
check('must follow hearts when holding hearts',
  legal.length === 1 && legal[0].suit === 'H');
legal = E.legalPlays(hand1, [{ player: 3, card: c('S', 4) }], upS);
check('jokers follow trump suit',
  legal.length === 2 && legal.every((x) => x.id === 'S9' || x.id === 'JB'));

// ---- no-trump jokers ----
const ntUp = { amount: 5, type: 'notrump', trump: null, direction: 'uptown' };
trick = [
  { player: 0, card: BJ },
  { player: 1, card: c('D', 7) },
  { player: 2, card: c('D', 9) },
  { player: 3, card: c('C', 14) },
];
check('NT: led joker sets no suit; first real card leads', E.trickLedSuit(trick, ntUp) === 'D');
check('NT: joker cannot win, off-suit ace cannot win', E.trickWinner(trick, ntUp) === 2);
legal = E.legalPlays([BJ, c('D', 3)], [{ player: 0, card: c('D', 8) }], ntUp);
check('NT: joker cannot be used to follow suit',
  legal.length === 1 && legal[0].id === 'D3');
legal = E.legalPlays([BJ, c('S', 3)], [{ player: 0, card: c('D', 8) }], ntUp);
check('NT: void of led suit may throw joker', legal.length === 2);

// ---- scoring ----
const rules = E.DEFAULT_RULES;
let s = E.scoreHand(4, upS, 11, rules);
check('bid 4, take 11 books: +5', s.made && s.delta === 5);
s = E.scoreHand(4, upS, 9, rules);
check('bid 4, take 9 books: set, -4', !s.made && s.delta === -4);
s = E.scoreHand(5, ntUp, 11, rules);
check('no-trump bid 5 made exactly: +10 (doubled)', s.made && s.delta === 10);
s = E.scoreHand(5, ntUp, 8, rules);
check('no-trump bid 5 set: -10 (doubled)', !s.made && s.delta === -10);
s = E.scoreHand(7, upS, 13, { ...rules, bostonDoubles: true });
check('Boston made with doubling on: +14', s.made && s.delta === 14);
s = E.scoreHand(3, upS, 13, rules);
check('bid 3, run a Boston: score all 7', s.made && s.delta === 7);

check('game over at +7', E.gameOver([7, 2], rules) === 0);
check('game over at -7', E.gameOver([3, -7], rules) === 0);
check('game continues at 6-6', E.gameOver([6, 6], rules) === null);

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll engine tests passed.');
