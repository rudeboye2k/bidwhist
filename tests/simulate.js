// Full-hand AI-vs-AI simulation: catches crashes, illegal plays, and lets us
// sanity-check bidding frequency and contract success rates.
// Run: node tests/simulate.js [hands]
'use strict';
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

const HANDS = parseInt(process.argv[2] || '500', 10);
const rules = { ...E.DEFAULT_RULES };

let allPass = 0, madeCount = 0, setCount = 0, bidSum = 0, bidN = 0;
const byType = { uptown: 0, downtown: 0, notrump: 0 };

for (let h = 0; h < HANDS; h++) {
  const dealer = h % 4;
  const { hands, kitty } = E.deal(E.shuffle(E.newDeck()));

  // Bidding: one round starting left of dealer.
  let high = null, highSeat = null, highPlan = null;
  for (let i = 1; i <= 4; i++) {
    const seat = (dealer + i) % 4;
    const mustBid = rules.forcedDealerBid && seat === dealer && high === null;
    const { bid, plan } = AI.chooseBid(hands[seat], high, rules, mustBid);
    if (!bid.pass) {
      if (!E.isLegalBid(bid, high, rules)) throw new Error('AI made illegal bid');
      high = bid; highSeat = seat; highPlan = plan;
    }
  }
  if (high === null) { allPass++; continue; } // only when forcedDealerBid off

  bidSum += high.amount; bidN++; byType[high.type]++;
  const contract = {
    amount: high.amount, type: high.type,
    trump: highPlan.trump, direction: highPlan.direction,
  };

  // Kitty exchange.
  let bidderHand = hands[highSeat].concat(kitty);
  const discards = AI.chooseDiscards(bidderHand, contract);
  if (discards.length !== 6) throw new Error('bad discard count');
  const dset = new Set(discards.map((c) => c.id));
  hands[highSeat] = bidderHand.filter((c) => !dset.has(c.id));
  if (hands[highSeat].length !== 12) throw new Error('bad hand after discard');

  // Play 12 tricks.
  const memory = new Set();
  const books = [0, 0]; // team 0 = seats 0,2
  if (rules.kittyIsBook) books[highSeat % 2]++;
  let leader = highSeat;
  for (let t = 0; t < 12; t++) {
    const trick = [];
    for (let i = 0; i < 4; i++) {
      const seat = (leader + i) % 4;
      const card = AI.choosePlay(hands[seat], trick, contract, seat, memory);
      const legal = E.legalPlays(hands[seat], trick, contract);
      if (!legal.some((c) => c.id === card.id)) throw new Error('AI reneged');
      hands[seat] = hands[seat].filter((c) => c.id !== card.id);
      trick.push({ player: seat, card });
      memory.add(card.id);
    }
    leader = E.trickWinner(trick, contract);
    books[leader % 2]++;
  }
  if (books[0] + books[1] !== 12 + (rules.kittyIsBook ? 1 : 0))
    throw new Error('book count mismatch');

  const res = E.scoreHand(contract.amount, contract, books[highSeat % 2], rules);
  if (res.made) madeCount++; else setCount++;
}

console.log(`hands=${HANDS} bid=${bidN} allPass=${allPass}`);
console.log(`avg bid=${(bidSum / bidN).toFixed(2)}  types=`, byType);
console.log(`made=${madeCount} (${((madeCount / bidN) * 100).toFixed(0)}%)  set=${setCount}`);
console.log('Simulation completed with no illegal plays.');
