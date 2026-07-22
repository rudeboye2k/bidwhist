// Full-hand AI-vs-AI simulation. Two jobs:
//  1. Fuzz the engine + AI over many hands — assert no illegal plays / crashes.
//  2. Validate the session learner's design claims (honestly — under this
//     scoring the bid amount has little headroom, so we test behavior, not a
//     net-points miracle):
//       (a) harmless — under default rules, learning must not degrade the
//           already-strong static tuning. Checked with a PAIRED comparison:
//           ON and OFF play the *same* seeded deals, so deal luck cancels.
//       (b) responsive — when the bidding side is structurally short a book and
//           keeps getting set, the calibrator must pull aggression down.
// Run: node tests/simulate.js [hands]
'use strict';
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

const HANDS = parseInt(process.argv[2] || '400', 10);

// Small seedable PRNG so ON and OFF can replay identical deals + bid noise.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One session on a fixed seed. dealRng and noiseRng are reseeded from `seed`,
// so two sessions with the same seed see identical deals and identical bid
// noise — the only difference is whether `learner` is present.
function runSession(hands, rules, learner, seed) {
  const dealRng = mulberry32(seed);
  const noiseRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let bidN = 0, made = 0, net = 0, bidSum = 0;

  for (let h = 0; h < hands; h++) {
    const dealer = h % 4;
    const { hands: d, kitty } = E.deal(E.shuffle(E.newDeck(), dealRng));

    let high = null, hs = null, hp = null;
    for (let i = 1; i <= 4; i++) {
      const seat = (dealer + i) % 4;
      const mustBid = rules.forcedDealerBid && seat === dealer && high === null;
      const { bid, plan } = AI.chooseBid(d[seat], high, rules, mustBid, noiseRng, learner, seat);
      if (!bid.pass) {
        if (!E.isLegalBid(bid, high, rules)) throw new Error('AI made illegal bid');
        bid._seat = seat; high = bid; hs = seat; hp = plan;
      }
    }
    if (high === null) continue;

    const contract = { amount: high.amount, type: high.type, trump: hp.trump, direction: hp.direction };
    const bh = d[hs].concat(kitty);
    const dset = new Set(AI.chooseDiscards(bh, contract).map((c) => c.id));
    d[hs] = bh.filter((c) => !dset.has(c.id));
    if (d[hs].length !== 12) throw new Error('bad hand after discard');

    const memory = new Set();
    const books = [0, 0];
    if (rules.kittyIsBook) books[hs % 2]++;
    let leader = hs;
    for (let t = 0; t < 12; t++) {
      const trick = [];
      for (let i = 0; i < 4; i++) {
        const seat = (leader + i) % 4;
        const card = AI.choosePlay(d[seat], trick, contract, seat, memory);
        if (!E.legalPlays(d[seat], trick, contract).some((c) => c.id === card.id))
          throw new Error('AI reneged');
        d[seat] = d[seat].filter((c) => c.id !== card.id);
        trick.push({ player: seat, card });
        memory.add(card.id);
      }
      leader = E.trickWinner(trick, contract);
      books[leader % 2]++;
    }

    const btb = books[hs % 2];
    const res = E.scoreHand(contract.amount, contract, btb, rules);
    bidN++; made += res.made ? 1 : 0; net += res.delta; bidSum += contract.amount;
    if (learner) AI.observeHand(learner, {
      declarerSeat: hs, amount: contract.amount, needed: res.needed,
      bidTeamBooks: btb, made: res.made, calibrate: true,
    });
  }
  return { net: net / bidN, made: (made / bidN) * 100, avgBid: bidSum / bidN, bias: learner ? learner.bidBias : 0 };
}

const SESSIONS = Math.max(12, Math.round(8000 / HANDS));
const f = (x, p = 2) => x.toFixed(p);
const std = { ...E.DEFAULT_RULES };
const variant = { ...E.DEFAULT_RULES, kittyIsBook: false }; // bidding side a book short

// Paired sweep on default rules: same seed → same deals for ON and OFF.
let pairedDiff = 0, onNet = 0, offNet = 0, onBias = 0;
for (let s = 1; s <= SESSIONS; s++) {
  const off = runSession(HANDS, std, null, s);
  const on = runSession(HANDS, std, AI.createLearner(), s);
  pairedDiff += on.net - off.net; onNet += on.net; offNet += off.net; onBias += Math.abs(on.bias);
}
pairedDiff /= SESSIONS; onNet /= SESSIONS; offNet /= SESSIONS; onBias /= SESSIONS;

// Variant sweep: does the calibrator pull back when the table keeps getting set?
let varBias = 0, varMade = 0;
for (let s = 1; s <= SESSIONS; s++) {
  const on = runSession(HANDS, variant, AI.createLearner(), 1000 + s);
  varBias += on.bias; varMade += on.made;
}
varBias /= SESSIONS; varMade /= SESSIONS;

console.log(`Sessions: ${SESSIONS} × ${HANDS} hands (paired on default rules)\n`);
console.log(`default   OFF net/hand      ${f(offNet)}`);
console.log(`default   ON  net/hand      ${f(onNet)}   (paired Δ ${f(pairedDiff, 3)}, |bias| ${f(onBias)})`);
console.log(`no-kitty  ON  made%         ${f(varMade, 1)}   → calibrator bias ${f(varBias)}`);

const harmless = pairedDiff >= -0.03 && onBias < 0.3;
const responsive = varBias <= -0.25;
console.log('\nSimulation completed with no illegal plays.');
console.log(`${harmless ? 'PASS' : 'FAIL'}: harmless & neutral in healthy play (paired Δ ${f(pairedDiff, 3)}).`);
console.log(`${responsive ? 'PASS' : 'FAIL'}: pulls back when the table keeps getting set (bias ${f(varBias)}).`);
process.exit(harmless && responsive ? 0 : 1);
