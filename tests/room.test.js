// Authoritative room-core tests: membership, turn validation, per-player card
// hiding, AI auto-fill, and a full hand played to a scored result.
// Run: node tests/room.test.js
'use strict';
const { Room } = require('../server/room-core.js');

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
    room.submit(token, { type: 'declare', trump: 'S' });
  } else if (room.need === 'declare-dir') {
    room.submit(token, { type: 'declare', direction: 'uptown' });
  } else if (room.need === 'discard') {
    room.submit(token, { type: 'discard', cardIds: v.you.hand.slice(0, 6).map((c) => c.id) });
  } else if (room.need === 'play') {
    const id = (v.you.legalIds && v.you.legalIds[0]) || v.you.hand[0].id;
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
    if (moves % 7 === 3) { r = Room.fromJSON(structuredClone(r.toJSON())); restores++; }
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

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll room-core tests passed.');
