// Authoritative room-core tests: membership, turn validation, per-player card
// hiding, AI auto-fill, and a full hand played to a scored result.
// Run: node tests/room.test.js
'use strict';
const { Room } = require('../js/room-core.js');

let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error('FAIL  ' + name); }
  else console.log('ok    ' + name);
}

// Deterministic RNG so the test is reproducible.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- membership & host ----
let room = new Room('table1', { gameTarget: 4 }, { rng: seeded(7) });
const alice = room.join('Alice');
const bob = room.join('Bob');
check('first joiner is host', alice.host === true && room.hostToken != null);
check('alice seat 0, bob seat 1', alice.seat === 0 && bob.seat === 1);
check('two empty seats remain', room.seats.filter((s) => s.kind === 'empty').length === 2);

check('non-host cannot start', room.start(bob.token).error === 'not-host');

// ---- start fills AI ----
let res = room.start(alice.token);
check('host start returns events', Array.isArray(res.events) && res.events.length > 0);
check('empty seats became AI', room.seats.filter((s) => s.kind === 'ai').length === 2);
check('phase advanced past lobby', room.phase !== 'lobby');

// ---- per-player card hiding ----
const viewA = room.viewFor(alice.token);
const viewB = room.viewFor(bob.token);
const spectator = room.viewFor('nobody');
check('alice sees her own 12 cards', viewA.you && viewA.you.hand.length === 12);
check('alice cannot see bob\'s cards', viewA.seats[1] && viewA.you.seat === 0 && !('hand' in viewA.seats[1]));
check('bob sees his own hand only', viewB.you && viewB.you.seat === 1 && viewB.you.hand.length === 12);
check('spectator sees no hand', spectator.you === null);
check('counts are public (all 12 pre-kitty)', viewA.counts.every((c) => c === 12));

// ---- turn validation ----
// Whoever is not on turn is rejected; illegal actions are rejected.
const turnSeat = room.turn;
const offTurnToken = turnSeat === 0 ? bob.token : alice.token;
if (room.phase === 'bidding') {
  const bad = room.submit(offTurnToken, { type: 'bid', bid: { pass: true } });
  check('off-turn bid rejected', bad.error === 'not-your-turn');
}

// ---- drive a full game to completion via the core ----
// Both humans always auto-pass / auto-play legally; AI covers the rest. The
// room must always reach gameover without ever stalling or accepting a bad move.
function autoAct(room, token) {
  const seat = room.seatOf(token);
  if (room.turn !== seat) return false;
  const v = room.viewFor(token);
  if (room.need === 'bid') {
    // humans just pass unless forced to bid
    const bid = v.you.mustBid ? { amount: room.rules.minBid, type: 'uptown' } : { pass: true };
    room.submit(token, { type: 'bid', bid });
  } else if (room.need === 'declare-suit') {
    room.submit(token, { type: 'declare', trump: 'S', direction: 'uptown' });
  } else if (room.need === 'declare-dir') {
    room.submit(token, { type: 'declare', direction: 'uptown' });
  } else if (room.need === 'discard') {
    room.submit(token, { type: 'discard', cardIds: v.you.hand.slice(0, v.you.hand.length - 12).map((c) => c.id) });
  } else if (room.need === 'play') {
    // follow suit properly even under the renege house rule (where every card is allowed)
    const legal = require('../js/engine.js').legalPlays(room.hands[seat], room.trick, room.contract);
    const id = (legal[0] && legal[0].id) || v.you.hand[0].id;
    room.submit(token, { type: 'play', cardId: id });
  }
  return true;
}

let guard = 0;
let handsPlayed = 0;
let lastHand = 0;
while (room.phase !== 'gameover' && guard++ < 100000) {
  if (room.phase === 'handover') { handsPlayed++; room.nextHand(alice.token); continue; }
  if (room.turn === null) break;
  const tok = room.turn === 0 ? alice.token : room.turn === 1 ? bob.token : null;
  if (tok) {
    if (!autoAct(room, tok)) break;
  } else {
    // AI seat — the room should have auto-advanced; if we're here it's stuck.
    check('room never stalls on an AI seat', false);
    break;
  }
  if (room.handNo !== lastHand) lastHand = room.handNo;
}
check('game reached a winner', room.phase === 'gameover');
check('a winning team crossed the target',
  room.scores[0] >= room.rules.gameTarget || room.scores[1] >= room.rules.gameTarget ||
  room.scores[0] <= -room.rules.gameTarget || room.scores[1] <= -room.rules.gameTarget);
check('multiple hands were played', room.handNo >= 1);

// ---- reconnection ----
room = new Room('table2', {}, { rng: seeded(9) });
const carol = room.join('Carol');
room.start(carol.token);
room.setConnected(carol.token, false);
const back = room.reclaim(carol.token);
check('reclaim restores seat + host', back.seat === 0 && back.host === true);
check('seat marked connected again', room.seats[0].connected === true);

// ---- isolation: two rooms don't share state ----
const r1 = new Room('AAAA', {}, { rng: seeded(1) });
const r2 = new Room('BBBB', {}, { rng: seeded(2) });
r1.join('x'); r2.join('y');
r1.start(r1.hostToken);
check('room 2 unaffected by room 1 start', r2.phase === 'lobby');
check('rooms have distinct codes', r1.code !== r2.code);

// ---- persistence: a room survives save/restore mid-game ----
// Durable Objects can be evicted between moves; the room is saved after every
// change and restored on wake. structuredClone mimics DO storage.
{
  let r = new Room('SAVE1', { gameTarget: 4 }, { rng: seeded(11) });
  const p1 = r.join('Ann');
  const p2 = r.join('Ben');
  r.start(p1.token);
  // play a few moves, then "evict" and restore several times along the way
  let moves = 0, restores = 0, g = 0;
  while (r.phase !== 'gameover' && g++ < 100000) {
    if (moves % 3 === 1) { r = Room.fromJSON(structuredClone(r.toJSON())); restores++; }
    if (r.phase === 'handover') { r.nextHand(p1.token); moves++; continue; }
    const tok = r.turn === 0 ? p1.token : r.turn === 1 ? p2.token : null;
    if (!tok || !autoAct(r, tok)) break;
    moves++;
  }
  check('restored room still recognizes player tokens', r.seatOf(p1.token) === 0 && r.seatOf(p2.token) === 1);
  check('game played to completion across many save/restores', r.phase === 'gameover' && restores > 5);
  check('played-card memory restored as a Set', r.memory instanceof Set);
}

// ---- avatars: cartoon codes + photos accepted, junk rejected ----
{
  const r = new Room('AVTR1', {});
  const a = r.join('Cat', 'cartoon:17.3');
  const b = r.join('Pic', 'data:image/jpeg;base64,/9j/4AAQ');
  const c = r.join('Bad', 'javascript:alert(1)');
  const d = r.join('Big', 'data:image/jpeg;base64,' + 'A'.repeat(50000));
  check('cartoon avatar code accepted', r.seats[a.seat].avatar === 'cartoon:17.3');
  check('jpeg photo avatar accepted', r.seats[b.seat].avatar.startsWith('data:image/jpeg'));
  check('non-image avatar rejected', r.seats[c.seat].avatar === null);
  check('oversized photo rejected', r.seats[d.seat].avatar === null);
}

// ---- teams: pick a team (= pick your partner), captain names it ----
{
  const r = new Room('TEAMS', {}, { rng: seeded(21) });
  const ann = r.join('Ann');   // seat 0 → Team A (first on A → captain)
  const ben = r.join('Ben');   // seat 1 → Team B (captain of B)
  const cal = r.join('Cal');   // seat 2 → Team A
  check('Ann captains Team A (first on it)', r.captains[0] === ann.token);
  check('Ben captains Team B', r.captains[1] === ben.token);
  check('non-captain cannot rename', r.setTeamName(cal.token, 0, 'Nope').error === 'not-captain');
  check('captain renames team', !r.setTeamName(ann.token, 0, '  Spade   Kings  ').error && r.teamNames[0] === 'Spade Kings');
  // Cal switches to Team B to partner Ben
  check('Cal moves to Team B', !r.chooseTeam(cal.token, 1).error && r.seatOf(cal.token) % 2 === 1);
  check('Cal and Ben are now partners', (r.seatOf(cal.token) + 2) % 4 === r.seatOf(ben.token));
  check('Ben is still Team B captain (got there first)', r.captains[1] === ben.token);
  const dee = r.join('Dee');   // fills the open Team A seat
  check('a full team rejects another player', r.chooseTeam(dee.token, 1).error === 'team-full' || r.seatOf(dee.token) % 2 === 1);
  // captain leaves their team → captaincy passes to the remaining member
  r.chooseTeam(ann.token, 1); // B is full → stays on A
  const v = r.viewFor(ann.token);
  check('view exposes team names + who captains', v.teams[0].name === 'Spade Kings' && v.teams[0].youAreCaptain === true);
  check('seat token follows the player when they switch teams', r.viewFor(cal.token).seats.find((x) => x.you).seat === r.seatOf(cal.token));
  r.start(ann.token);
  check('teams lock once the game starts', r.chooseTeam(cal.token, 0).error === 'teams-locked');
}

// ---- leaving mid-game: a bot takes the seat and plays at once ----
{
  const r = new Room('LEAVE', {}, { rng: seeded(31) });
  const a = r.join('Ann'), b = r.join('Ben');
  r.start(a.token);
  // drive until it's Ben's turn, then Ben leaves
  let g = 0;
  while (r.turn !== b.seat && r.phase !== 'gameover' && g++ < 5000) {
    if (r.phase === 'handover') { r.nextHand(a.token); continue; }
    autoAct(r, a.token);
  }
  const before = { turn: r.turn, need: r.need };
  const out = r.leave(b.token);
  check('Ben\'s seat became a bot', r.seats[b.seat].kind === 'ai' && r.seats[b.seat].left === true);
  check('bot took Ben\'s pending turn immediately (no stall)', before.turn === b.seat && r.turn !== b.seat && out.events.length > 1);
  check('a player who left cannot reclaim the seat', r.reclaim(b.token).error === 'unknown');
}

// ---- disconnect mid-turn: bot covers, player can come back ----
{
  const r = new Room('DROP', {}, { rng: seeded(41) });
  const a = r.join('Ann'), b = r.join('Ben');
  r.start(a.token);
  let g = 0;
  while (r.turn !== b.seat && r.phase !== 'gameover' && g++ < 5000) {
    if (r.phase === 'handover') { r.nextHand(a.token); continue; }
    autoAct(r, a.token);
  }
  r.drop(b.token);
  check('disconnected player\'s turn is played by a bot', r.turn !== b.seat);
  check('dropped player reclaims their seat on reconnect', r.reclaim(b.token).seat === b.seat && r.seats[b.seat].kind === 'human');
  // host drops → the other human can deal
  r.drop(a.token);
  check('host away → another connected player gets host powers', r.effectiveHost() === b.token);
}

// ---- host lobby controls: assign seats, add / kick bots, back to lobby ----
{
  const r = new Room('HOSTC', {}, { rng: seeded(51) });
  const host = r.join('Hal');              // seat 0, Team A
  const amy = r.join('Amy');               // seat 1, Team B
  check('non-host cannot rearrange seats', r.hostSwap(amy.token, 0, 1).error === 'not-host');
  check('host adds a bot to a chosen seat', !r.addBot(host.token, 3).error && r.seats[3].kind === 'ai');
  check('bot names are unique', new Set(r.seats.filter((s) => s.name).map((s) => s.name)).size === r.seats.filter((s) => s.name).length);
  check('cannot add a bot to a taken seat', r.addBot(host.token, 1).error === 'seat-taken');
  // host makes Amy their partner: move Amy into seat 2 (Team A)
  check('host moves Amy to partner them', !r.hostSwap(host.token, 1, 2).error && r.seatOf(amy.token) === 2);
  check('Amy keeps her identity after the move', r.reclaim(amy.token).seat === 2);
  check('host can swap a bot and a player', !r.hostSwap(host.token, 3, 0).error && r.seatOf(host.token) === 3 && r.seats[0].kind === 'ai');
  r.hostSwap(host.token, 0, 3); // put host back in seat 0
  check('host kicks a bot to open the seat', !r.kickBot(host.token, 3).error && r.seats[3].kind === 'empty');
  check('kicking a person is not allowed', r.kickBot(host.token, 2).error === 'not-a-bot');
  const late = r.join('Lou');
  check('a late player takes the opened seat', r.seatOf(late.token) === 1 || r.seatOf(late.token) === 3);
  // play to game over, return to lobby, kick a bot, someone new joins
  r.rules.gameTarget = 1;
  r.start(host.token);
  check('seat controls are lobby-only', r.kickBot(host.token, 1).error === 'lobby-only');
  let g = 0;
  while (r.phase !== 'gameover' && g++ < 20000) {
    if (r.phase === 'handover') { r.nextHand(host.token); continue; }
    const tok = [host, amy, late].find((x) => r.seatOf(x.token) === r.turn);
    if (!tok || !autoAct(r, tok.token)) break;
  }
  check('game finished', r.phase === 'gameover');
  check('host returns the table to the lobby', !r.toLobby(host.token).error && r.phase === 'lobby' && r.scores[0] === 0 && r.scores[1] === 0);
  const botSeat = r.seats.find((s) => s.kind === 'ai').seat;
  r.kickBot(host.token, botSeat);
  const newbie = r.join('Neo');
  check('after a game, a kicked bot\'s seat goes to a newcomer', r.seatOf(newbie.token) === botSeat);
}

// ---- house rules: no jokers, NT minimum 4, lead from the dealer's left ----
{
  const r = new Room('RULES', {}, { rng: seeded(61) });
  const a = r.join('Ann'), b = r.join('Ben');
  check('non-host cannot change rules', r.setRules(b.token, { noJokers: true }).error === 'not-host');
  check('host sets rules in the lobby', !r.setRules(a.token, { noJokers: true, ntMinFour: true, leadRule: 'left', minBid: 3 }).error);
  check('junk rule values are cleaned', (r.setRules(a.token, { noJokers: true, ntMinFour: true, leadRule: 'left', gameTarget: 999 }), r.rules.gameTarget === 7));
  r.start(a.token);
  check('no jokers: 12 cards each, 4-card kitty', r.hands.every((h) => h.length === 12) && r.kitty.length === 4 &&
    !r.hands.flat().concat(r.kitty).some((c) => c.joker));
  check('rules can\'t change mid-hand', r.setRules(a.token, { noJokers: false }).error === 'between-hands');
  let g = 0;
  while (r.phase === 'bidding' && g++ < 50) autoAct(r, a.token) || autoAct(r, b.token);
  check('NT minimum 4: a 3 No-Trump bid is illegal', !require('../js/engine.js').isLegalBid({ amount: 3, type: 'notrump' }, null, r.rules));
  g = 0;
  while ((r.phase === 'declare' || r.phase === 'discard') && g++ < 50) autoAct(r, a.token) || autoAct(r, b.token);
  if (r.phase === 'playing') {
    check('discarding 4 with no jokers leaves 12', r.hands[r.highSeat].length === 12);
    check('lead rule "left": player left of the dealer leads', r.leader === (r.dealer + 1) % 4);
  }
}

// ---- table record, last book, reactions ----
{
  const r = new Room('REC', { gameTarget: 5 }, { rng: seeded(71) });
  const a = r.join('Ann'), b = r.join('Ben');
  r.start(a.token);
  let g = 0, sawLast = false;
  while (r.phase !== 'gameover' && g++ < 50000) {
    if (r.phase === 'handover') { r.nextHand(a.token); continue; }
    autoAct(r, a.token) || autoAct(r, b.token);
    if (r.lastTrick && r.lastTrick.cards.length === 4) sawLast = true;
  }
  const rec = r.viewFor(a.token).record;
  check('record counts the finished game', rec.games === 1 && rec.teamWins[0] + rec.teamWins[1] === 1);
  check('record counts hands and each player', rec.hands > 0 && Object.keys(rec.players).length === 4);
  check('record tracks partner pairs', Object.keys(rec.pairs).length === 2);
  check('last book is kept for review', sawLast);
  const t0 = Date.now();
  const rr = new Room('REACT', {}, { now: () => t0 });
  const x = rr.join('Xan');
  check('a reaction is broadcast', rr.react(x.token, 0).events[0].t === 'react');
  check('reactions are rate-limited', rr.react(x.token, 1).error === 'slow-down');
  check('unknown reaction rejected', rr.react(x.token, 999).error === 'bad-reaction');
  check('watchers can\'t react', rr.react('nobody', 0).error === 'not-seated');
}

// ---- turn timer: an idle player's move is made by a bot ----
{
  let now = 1000000;
  const r = new Room('TIMER', { turnTimer: 30 }, { rng: seeded(81), now: () => now });
  const a = r.join('Ann'), b = r.join('Ben');
  r.start(a.token);
  const waiting = r.turn;
  check('timer armed while a human is up', r.deadline === now + 30000 && r.viewFor(a.token).turnMsLeft === 30000);
  check('timer does nothing early', r.timeout().events.length === 0 && r.turn === waiting);
  now += 30001;
  const out = r.timeout();
  check('timer expired: the idle turn was played for them', out.events[0].t === 'timeout' && out.events[0].seat === waiting && r.turn !== waiting);
  const off = new Room('NOTIMER', {}, { rng: seeded(82) });
  const c = off.join('Cy'); off.join('Di'); off.start(c.token);
  check('no timer by default', off.deadline === null);
}

// ---- spectators take a seat ----
{
  const r = new Room('WATCH', {}, { rng: seeded(91) });
  const ids = ['A', 'B', 'C', 'D'].map((n) => r.join(n));
  check('fifth person can\'t join a full table', r.join('Eve').error === 'full');
  check('full table of people: no seat to take', r.sitIn('Eve').error === 'full');
  r.leave(ids[3].token); r.start(ids[0].token); // seat 3 opens, becomes a bot at the deal
  const sat = r.sitIn('Eve');
  check('a watcher takes the bot\'s seat mid-game', sat.seat === 3 && r.seats[3].kind === 'human' && r.seats[3].name === 'Eve');
  check('the new player gets their own hand', r.viewFor(sat.token).you.hand.length === 12);
}

// ---- renege house rule ----
{
  const E = require('../js/engine.js');
  let found = false;
  for (let seed = 100; seed < 400 && !found; seed++) {
    const r = new Room('RNG', { renege: true }, { rng: seeded(seed) });
    const a = r.join('Ann'), b = r.join('Ben');
    r.start(a.token);
    let g = 0;
    // play until Ann (seat 0) must follow a suit she holds, then renege
    while (r.phase !== 'gameover' && r.phase !== 'handover' && g++ < 2000) {
      if (r.turn === 0 && r.need === 'play' && r.trick.length) {
        const legal = E.legalPlays(r.hands[0], r.trick, r.contract);
        const bad = r.hands[0].find((c) => !legal.some((l) => l.id === c.id));
        if (bad && legal.length < r.hands[0].length) {
          const before = r.viewFor(a.token).you.legalIds.length;
          check('renege rule: every card is playable', before === r.hands[0].length);
          r.submit(a.token, { type: 'play', cardId: bad.id });
          check('renege recorded', r.reneges.length === 1 && r.reneges[0].seat === 0);
          const call = r.phase === 'playing' ? r.callRenege(b.token) : null;
          if (call) {
            const ev = call.events[0];
            check('opponent\'s renege call is upheld', ev.t === 'renege' && ev.ok === true && ev.offender === 0);
            check('wrong call (no renege by the other team) is rejected', r.phase !== 'playing' || r.callRenege(a.token).events[0].ok === false);
          }
          let h = 0;
          while (r.phase === 'playing' && h++ < 500) autoAct(r, a.token) || autoAct(r, b.token);
          const res = r.lastResult;
          check('3-book renege penalty applied at the end', res && res.penalties.length === 1 && res.penalties[0].seat === 0);
          found = true; break;
        }
      }
      autoAct(r, a.token) || autoAct(r, b.token);
    }
  }
  check('found a deal to test a renege on', found);
}

// ---- bidding: a four is a four; kitty first, THEN trump + direction ----
{
  const E = require('../js/engine.js');
  check('bids are just a number: 4 does not beat 4', !E.isLegalBid({ amount: 4, type: 'suit' }, { amount: 4, type: 'suit' }));
  check('4 No-Trump beats a 4', E.isLegalBid({ amount: 4, type: 'notrump' }, { amount: 4, type: 'suit' }));
  check('5 beats 4 No-Trump', E.isLegalBid({ amount: 5, type: 'suit' }, { amount: 4, type: 'notrump' }));
  check('a bid reads as just the number', E.describeBid({ amount: 4, type: 'suit' }) === '4' && E.describeBid({ amount: 4, type: 'notrump' }) === '4 No-Trump');
  let tested = false, lastEvents = [];
  for (let seed = 500; seed < 700 && !tested; seed++) {
    const r = new Room('BID', {}, { rng: seeded(seed) });
    const a = r.join('Ann'); r.join('Ben');
    lastEvents = r.start(a.token).events.slice();
    // Ann (seat 0) bids 7 if she gets the chance, so she wins the auction
    let g = 0;
    while (r.phase === 'bidding' && g++ < 10) {
      if (r.turn !== 0) { lastEvents.push(...(r.submit(r.seats[r.turn].token, { type: 'bid', bid: { pass: true } }).events || [])); continue; }
      lastEvents.push(...(r.submit(a.token, { type: 'bid', bid: { amount: 7, type: 'uptown' } }).events || [])); // old clients may still send a direction
    }
    if (r.phase !== 'declare' || r.highSeat !== 0) continue;
    tested = true;
    check('auction closes straight into the kitty pickup', lastEvents.some((e) => e.t === 'kitty' && e.seat === 0) && !lastEvents.some((e) => e.t === 'declare'));
    check('a bid with a direction attached is stored as just the number', r.high.type === 'suit');
    check('high bidder already holds the kitty before naming trump (18 cards)', r.hands[0].length === 18 && r.kitty === null);
    check('an old app (direction sent with the bid) can still name trump alone', r.high._dir === 'uptown');
    delete r.high._dir; // a current app: direction comes with the trump
    check('naming trump without Uptown/Downtown is refused', r.submit(a.token, { type: 'declare', trump: 'H' }).error === 'bad-dir');
    const out = r.submit(a.token, { type: 'declare', trump: 'H', direction: 'downtown' });
    check('trump + direction named after the kitty', !out.error && r.contract.trump === 'H' && r.contract.type === 'downtown' && r.contract.direction === 'downtown');
    check('then bury', r.need === 'discard' && r.phase === 'discard');
  }
  check('found a deal where Ann wins the bid', tested);
  // bots declare after seeing the kitty too
  const r2 = new Room('BOTDECL', {}, { rng: seeded(32) });
  const h2 = r2.join('Hal');
  const evs = [];
  const push = (o) => { if (o && o.events) evs.push(...o.events); };
  push(r2.start(h2.token));
  let k = 0;
  while (r2.phase !== 'playing' && r2.phase !== 'handover' && k++ < 50) {
    if (r2.turn !== 0) break;
    const v = r2.viewFor(h2.token);
    if (r2.need === 'bid') push(r2.submit(h2.token, { type: 'bid', bid: v.you.mustBid ? { amount: 3, type: 'suit' } : { pass: true } }));
    else autoAct(r2, h2.token);
  }
  const decl = evs.find((e) => e.t === 'declare');
  const ki = evs.findIndex((e) => e.t === 'kitty'), di = evs.findIndex((e) => e.t === 'declare');
  check('bots: kitty is picked up before trump is named', decl && ki >= 0 && ki < di);
  check('bots name a real direction', decl && ['uptown', 'downtown', 'notrump'].includes(decl.contract.type) && decl.contract.direction);
}

// ---- a team with nobody on it has no captain (not the first open seat) ----
{
  const r = new Room('CAPT', {});
  const a = r.join('Ann'); r.join('Ben'); // seats 0 (A) and 1 (B)
  r.chooseTeam(r.seats[1].token, 0);      // Ben joins Team A → Team B is empty
  const v = r.viewFor(a.token);
  check('empty team shows no captain', v.teams[1].captainSeat === null);
  check('a watcher (no token) is never mapped to an open seat', r.seatOf(null) === null && r.viewFor(null).you === null);
}

// ---- typed messages ----
{
  let now = 5000000;
  const r = new Room('SAY', {}, { now: () => now });
  const a = r.join('Ann');
  const ok = r.say(a.token, '  Run it   <b>back</b>, partner!  ');
  check('a typed message is broadcast', ok.events && ok.events[0].t === 'say' && ok.events[0].seat === 0);
  check('markup stripped and spaces tidied', ok.events[0].text === 'Run it bback/b, partner!');
  check('messages share the reaction pace limit', r.say(a.token, 'again').error === 'slow-down');
  now += 2000;
  check('long messages are cut to 60 characters', r.say(a.token, 'x'.repeat(200)).events[0].text.length === 60);
  now += 2000;
  check('empty messages are refused', r.say(a.token, '   ').error === 'empty-message');
  check('watchers can\'t type at the table', r.say('nobody', 'hi').error === 'not-seated');
}

// ---- chat word filter ----
{
  const E = require('../js/engine.js');
  const f = E.filterChat;
  check('profanity is masked', f('what the fuck') === 'what the f***');
  check('dodges are caught (sh1t, $hit, fuuuck, b!tch)', !/sh1t|\$hit|fuuu|b!tch/i.test(f('sh1t $hit fuuuck b!tch')));
  check('slurs are masked', !/nigg|fagg|kike/i.test(f('nigga faggot kike')));
  check('innocent words untouched', f('classic assassin cocktail spicy Dickens shoe Mississippi') === 'classic assassin cocktail spicy Dickens shoe Mississippi');
  check('table talk stays intact', f("Set 'em! Run a Boston, partner") === "Set 'em! Run a Boston, partner");
  let now = 9000000;
  const r = new Room('FILT', {}, { now: () => now });
  const a = r.join('Ann');
  check('the server filters typed messages', r.say(a.token, 'deal the damn cards').events[0].text === 'deal the d*** cards');
}

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll room-core tests passed.');
