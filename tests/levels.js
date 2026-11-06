// AI level check: does 'sharp' beat 'regular', and does 'easy' lose to it?
// Paired: every seeded deal is played twice with the two levels swapping
// teams, so deal luck cancels and only the level difference remains.
// Run: node tests/levels.js [hands]
'use strict';
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

const HANDS = parseInt(process.argv[2] || '3000', 10);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Play one hand; levels[team] is that team's AI level. Returns net points per team.
function playHand(seed, levels) {
  const rng = mulberry32(seed);
  const noise = mulberry32(seed ^ 0x5bd1e995);
  const rules = E.DEFAULT_RULES;
  const dealer = seed % 4;
  const { hands: d, kitty } = E.deal(E.shuffle(E.newDeck(), rng));
  let high = null, hs = null, hp = null;
  for (let i = 1; i <= 4; i++) {
    const seat = (dealer + i) % 4;
    const r = Object.assign({}, rules, { aiLevel: levels[seat % 2] });
    const mustBid = seat === dealer && high === null;
    const { bid, plan } = AI.chooseBid(d[seat], high, r, mustBid, noise, null, seat);
    if (!bid.pass) { bid._seat = seat; high = bid; hs = seat; hp = plan; }
  }
  void hp;
  const bh = d[hs].concat(kitty); // kitty first, then trump + direction
  const decl = AI.chooseDeclare(bh, high.type);
  const contract = { amount: high.amount, type: high.type === 'notrump' ? 'notrump' : decl.direction, trump: decl.trump, direction: decl.direction };
  const ds = new Set(AI.chooseDiscards(bh, contract).map((c) => c.id));
  d[hs] = bh.filter((c) => !ds.has(c.id));
  const memory = new Set();
  const books = [0, 0];
  books[hs % 2]++;
  let leader = hs;
  const playRng = mulberry32(seed ^ 0x1234567);
  for (let t = 0; t < 12; t++) {
    const trick = [];
    for (let k = 0; k < 4; k++) {
      const s = (leader + k) % 4;
      const c = AI.choosePlay(d[s], trick, contract, s, memory, levels[s % 2], playRng);
      if (!E.legalPlays(d[s], trick, contract).some((x) => x.id === c.id)) throw new Error('illegal');
      d[s] = d[s].filter((x) => x.id !== c.id); trick.push({ player: s, card: c }); memory.add(c.id);
    }
    leader = E.trickWinner(trick, contract); books[leader % 2]++;
  }
  const res = E.scoreHand(contract.amount, contract, books[hs % 2], rules);
  const net = [0, 0]; net[hs % 2] = res.delta;
  return net;
}

function compare(a, b) {
  let diff = 0, sq = 0;
  for (let h = 0; h < HANDS; h++) {
    const seed = 1000 + h * 7919;
    const x = playHand(seed, [a, b]);  // a on team 0
    const y = playHand(seed, [b, a]);  // swapped
    const d = (x[0] - x[1]) - (y[0] - y[1]); // a's edge over b on this deal, both seatings
    diff += d; sq += d * d;
  }
  const mean = diff / HANDS / 2;
  const sd = Math.sqrt(sq / HANDS - (diff / HANDS) ** 2) / 2;
  const se = sd / Math.sqrt(HANDS);
  return { mean, se };
}

const s = compare('sharp', 'regular');
const e = compare('easy', 'regular');
const f = (r) => `${r.mean >= 0 ? '+' : ''}${r.mean.toFixed(3)} pts/hand (±${(2 * r.se).toFixed(3)})`;
console.log(`sharp vs regular: ${f(s)}`);
console.log(`easy  vs regular: ${f(e)}`);
let ok = true;
if (!(s.mean - 2 * s.se > 0)) { console.log('FAIL: sharp is not reliably better than regular'); ok = false; }
else console.log('PASS: sharp beats regular');
if (!(e.mean + 2 * e.se < 0)) { console.log('FAIL: easy is not reliably weaker than regular'); ok = false; }
else console.log('PASS: easy loses to regular');
process.exit(ok ? 0 : 1);
