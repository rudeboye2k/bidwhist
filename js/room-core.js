/*
 * Authoritative Bid Whist room — environment-agnostic game orchestration.
 * No WebSockets, no Cloudflare, no DOM: pure state machine so it can be unit
 * tested in Node and reused verbatim inside the Durable Object.
 *
 * The server is the single source of truth. Clients send intents (bid, declare,
 * discard, play); the room validates every one against the engine (anti-cheat),
 * advances through AI seats automatically, and produces:
 *   - per-player snapshots (you only ever see your own hand), and
 *   - an event stream the client animates (bid / play / trick / hand-over).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports)
    module.exports = factory(require('./engine.js'), require('./ai.js'));
  else root.RoomCore = factory(root.Engine, root.AI);
})(typeof self !== 'undefined' ? self : this, function (Engine, AI) {
  'use strict';

  const E = Engine, aiLib = AI;

  function randId(n) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  // Accept only small inline image data URLs; anything else falls back to a
  // client-generated cartoon avatar. Caps abuse and per-message bloat.
  function cleanAvatar(a) {
    if (typeof a !== 'string') return null;
    if (/^cartoon:\d{1,2}\.\d{1,2}$/.test(a)) return a;          // live emoji cartoon
    if (a.length > 40000 || !/^data:image\/(jpeg|png|webp);base64,/.test(a)) return null;
    return a;
  }
  // Names show up in other players' table talk, so no markup characters.
  function stripMarkup(n) { return String(n).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim(); }
  function cleanName(n, fallback) {
    if (typeof n !== 'string' || !stripMarkup(n)) return fallback;
    return stripMarkup(n).slice(0, 16);
  }

  const DEFAULT_AI_NAMES = ['Pearl', 'Marcus', 'Deacon', 'Ruby'];
  const RENEGE_PENALTY = 3; // books moved from the reneging team to the callers

  function newRecord() {
    return { hands: 0, games: 0, teamWins: [0, 0], bostons: [0, 0], made: [0, 0], sets: [0, 0], players: {}, pairs: {} };
  }

  class Room {
    constructor(code, rules, opts) {
      opts = opts || {};
      this.code = code;
      this.rules = Object.assign({}, E.DEFAULT_RULES, rules || {});
      this.rng = opts.rng || Math.random;
      this.now = opts.now || Date.now;     // injectable clock (turn timer tests)
      this.phase = 'lobby';                 // lobby|bidding|declare|discard|playing|handover|gameover
      this.seats = [0, 1, 2, 3].map((i) => ({
        seat: i, kind: 'empty', name: null, avatar: null, token: null, connected: false, ai: null,
      }));
      this.hostToken = null;
      this.scores = [0, 0];
      this.handNo = 0;
      this.dealer = Math.floor(this.rng() * 4);
      this.learner = aiLib.createLearner();
      this.teamNames = ['Team A', 'Team B'];
      this.captains = [null, null];   // token of each team's captain
      this.joinSeq = 0;
      this.record = newRecord();     // running table record across games
      this.moveNo = 0;               // bumps on every move (turn-timer key)
      this.deadline = null;          // turn timer: when a bot plays an idle turn
      this.timerKey = null;
      this.reactAt = {};             // per-seat reaction rate limit
      this._resetHand();
    }

    // ---- membership --------------------------------------------------------

    seatOf(token) {
      if (token == null) return null; // no token never matches an (empty) seat
      const s = this.seats.find((x) => x.token === token);
      return s ? s.seat : null;
    }

    join(name, avatar) {
      const spot = this.seats.find((s) => s.kind === 'empty');
      if (!spot) return { error: 'full' };
      const token = randId(16);
      spot.kind = 'human';
      spot.name = cleanName(name, 'Player');
      spot.avatar = cleanAvatar(avatar);
      spot.token = token;
      spot.connected = true;
      spot.ai = null;
      spot.left = false;
      spot.joinedTeamAt = ++this.joinSeq;
      if (!this.hostToken) this.hostToken = token; // first to join hosts
      this._updateCaptains();
      return { seat: spot.seat, token, host: this.hostToken === token };
    }

    // Update a seated player's name/avatar (e.g. they edited their profile).
    setProfile(token, name, avatar) {
      const s = this.seats.find((x) => x.token === token);
      if (!s || s.kind !== 'human') return { error: 'no-seat' };
      if (name !== undefined) s.name = cleanName(name, s.name);
      if (avatar !== undefined) s.avatar = cleanAvatar(avatar);
      return {};
    }

    reclaim(token) {
      const s = this.seats.find((x) => x.token === token);
      if (!s || s.kind !== 'human') return { error: 'unknown' };
      s.connected = true;
      return { seat: s.seat, host: this.hostToken === token };
    }

    setConnected(token, on) {
      const s = this.seats.find((x) => x.token === token);
      if (s) s.connected = on;
    }

    // Host powers (start / deal next hand) belong to the host while they're
    // connected; if they drop, the next connected human can carry on, so the
    // table never gets stuck waiting on someone who's gone.
    effectiveHost() {
      const host = this.seats.find((x) => x.token && x.token === this.hostToken);
      if (host && host.kind === 'human' && host.connected) return this.hostToken;
      const next = this.seats.find((x) => x.kind === 'human' && x.connected && x.token);
      return next ? next.token : this.hostToken;
    }

    // A player's connection dropped (closed the tab, lost signal). Mid-game, a
    // bot covers their seat right away — including the turn they were on — and
    // they take it back if they reconnect. Returns events for the bot's moves.
    drop(token) {
      this.setConnected(token, false);
      const events = [];
      if (this.phase !== 'lobby') this._advance(events);
      return { events };
    }

    // A player chose "Leave Table". In the lobby their seat simply opens up.
    // Mid-game a bot takes the seat for good (they can't reclaim it), and if
    // it was their turn the bot plays it immediately.
    leave(token) {
      const s = this.seats.find((x) => x.token === token);
      if (!s) return { events: [] };
      if (this.hostToken === token) {
        const next = this.seats.find((x) => x.kind === 'human' && x.token && x.token !== token);
        this.hostToken = next ? next.token : null;
      }
      const events = [];
      if (this.phase === 'lobby') {
        Object.assign(s, { kind: 'empty', name: null, avatar: null, token: null, connected: false, left: false });
      } else {
        Object.assign(s, { kind: 'ai', token: null, connected: false, left: true });
        events.push({ t: 'botTakeover', seat: s.seat, name: s.name });
        this._advance(events);
      }
      this._updateCaptains();
      return { events };
    }

    // ---- teams (lobby) ------------------------------------------------------
    // Seats 0 & 2 are Team A, 1 & 3 are Team B — picking a team picks your
    // partner. The first person on a team is its captain and names it.

    chooseTeam(token, team) {
      if (this.phase !== 'lobby') return { error: 'teams-locked' };
      if (team !== 0 && team !== 1) return { error: 'bad-team' };
      const from = this.seats.find((x) => x.token === token);
      if (!from) return { error: 'not-seated' };
      if (from.seat % 2 === team) return {};
      const to = this.seats.find((x) => x.seat % 2 === team && x.kind === 'empty');
      if (!to) return { error: 'team-full' };
      for (const k of ['kind', 'name', 'avatar', 'token', 'connected', 'ai', 'left']) to[k] = from[k];
      to.joinedTeamAt = ++this.joinSeq;
      Object.assign(from, { kind: 'empty', name: null, avatar: null, token: null, connected: false, ai: null, left: false });
      this._updateCaptains();
      return {};
    }

    setTeamName(token, team, name) {
      if (team !== 0 && team !== 1) return { error: 'bad-team' };
      if (this.captains[team] !== token) return { error: 'not-captain' };
      const clean = typeof name === 'string' ? stripMarkup(name).slice(0, 18) : '';
      this.teamNames[team] = clean || (team === 0 ? 'Team A' : 'Team B');
      return {};
    }

    // ---- host lobby controls -------------------------------------------------
    // Only the host (or whoever holds host powers while they're away) can
    // rearrange the table before the deal.

    _hostLobbyCheck(token) {
      if (token !== this.effectiveHost()) return { error: 'not-host' };
      if (this.phase !== 'lobby') return { error: 'lobby-only' };
      return null;
    }

    // Swap whatever sits in seats a and b (players, bots or open seats).
    // Moving someone across teams changes their partner; captains follow.
    hostSwap(token, a, b) {
      const bad = this._hostLobbyCheck(token); if (bad) return bad;
      if (![a, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 3)) return { error: 'bad-seat' };
      if (a === b) return {};
      const A = this.seats[a], B = this.seats[b];
      const keys = ['kind', 'name', 'avatar', 'token', 'connected', 'ai', 'left', 'joinedTeamAt'];
      const tmp = {}; for (const k of keys) tmp[k] = A[k];
      for (const k of keys) A[k] = B[k];
      for (const k of keys) B[k] = tmp[k];
      if (a % 2 !== b % 2) {                       // crossed teams: count as joining now
        if (A.kind === 'human') A.joinedTeamAt = ++this.joinSeq;
        if (B.kind === 'human') B.joinedTeamAt = ++this.joinSeq;
      }
      this._updateCaptains();
      return {};
    }

    _botName() {
      const used = new Set(this.seats.map((x) => x.name));
      return DEFAULT_AI_NAMES.find((n) => !used.has(n)) || ('Bot ' + (this.seats.filter((x) => x.kind === 'ai').length + 1));
    }

    addBot(token, seat) {
      const bad = this._hostLobbyCheck(token); if (bad) return bad;
      const s = this.seats[seat];
      if (!s) return { error: 'bad-seat' };
      if (s.kind !== 'empty') return { error: 'seat-taken' };
      Object.assign(s, { kind: 'ai', name: this._botName(), avatar: null, token: null, connected: false, left: false });
      return {};
    }

    // Remove a bot so the seat opens for a person to join.
    kickBot(token, seat) {
      const bad = this._hostLobbyCheck(token); if (bad) return bad;
      const s = this.seats[seat];
      if (!s) return { error: 'bad-seat' };
      if (s.kind !== 'ai') return { error: 'not-a-bot' };
      Object.assign(s, { kind: 'empty', name: null, avatar: null, token: null, connected: false, ai: null, left: false });
      return {};
    }

    // After a game ends, the host can reopen the lobby: seats, bots and team
    // names are kept, scores reset, and open seats can take new players.
    toLobby(token) {
      if (token !== this.effectiveHost()) return { error: 'not-host' };
      if (this.phase !== 'gameover' && this.phase !== 'handover') return { error: 'bad-phase' };
      this.phase = 'lobby';
      this.scores = [0, 0];
      this.handNo = 0;
      this._resetHand();
      for (const s of this.seats) if (s.kind === 'ai') s.left = false;
      return { events: [{ t: 'lobby' }] };
    }

    // Captain = the current captain if still a human on the team, else the
    // human who has been on that team the longest.
    _updateCaptains() {
      for (const team of [0, 1]) {
        const members = this.seats.filter((x) => x.seat % 2 === team && x.kind === 'human' && x.token);
        if (members.some((m) => m.token === this.captains[team])) continue;
        members.sort((a, b) => (a.joinedTeamAt || 0) - (b.joinedTeamAt || 0));
        this.captains[team] = members.length ? members[0].token : null;
      }
    }

    // ---- hand lifecycle ----------------------------------------------------

    _resetHand() {
      this.hands = [null, null, null, null];
      this.kitty = null;
      this.bids = [null, null, null, null];
      this.high = null; this.highSeat = null; this.plans = {};
      this.contract = null;
      this.books = [0, 0];
      this.seatBooks = [0, 0, 0, 0]; // books each player took this hand (nameplates)
      this.trick = [];
      this.leader = null;
      this.turn = null;
      this.need = null;
      this.memory = new Set();
      this.bidIndex = 0;
      this.bidOrder = [];
      this.lastResult = null;
      this.lastTrick = null;         // { cards, winner } of the previous book
      this.reneges = [];             // renege house rule: { seat, suit, revealed, called }
      this.handTricks = [];          // every book of this hand, for "Review the hand"
      this.trickNo = 0;
    }

    // Host starts: empty seats become AI, then deal and open the auction.
    start(token) {
      if (token !== this.effectiveHost()) return { error: 'not-host' };
      if (this.phase !== 'lobby' && this.phase !== 'handover' && this.phase !== 'gameover')
        return { error: 'in-progress' };
      for (const s of this.seats) {
        if (s.kind === 'empty') {
          s.kind = 'ai';
          s.name = this._botName();
          s.token = null;
          s.avatar = null;
        }
      }
      if (this.phase === 'gameover') { this.scores = [0, 0]; this.handNo = 0; }
      const events = [];
      this._startHand(events);
      return { events };
    }

    // Begin the next hand (used by start and by "next hand" after a hand ends).
    nextHand(token) {
      if (token !== this.effectiveHost()) return { error: 'not-host' };
      if (this.phase !== 'handover') return { error: 'bad-phase' };
      const events = [];
      this.dealer = (this.dealer + 1) % 4;
      this._startHand(events);
      return { events };
    }

    _startHand(events) {
      this._resetHand();
      this.handNo++;
      const deck = E.shuffle(E.newDeck(this.rules), this.rng);
      const dealt = E.deal(deck);
      this.hands = dealt.hands;
      this.kitty = dealt.kitty;
      this.phase = 'bidding';
      this.bidOrder = [1, 2, 3, 0].map((o) => (this.dealer + o) % 4);
      this.bidIndex = 0;
      this.turn = this.bidOrder[0];
      this.need = 'bid';
      events.push({ t: 'deal', dealer: this.dealer, handNo: this.handNo });
      this._advance(events);
    }

    // ---- intent application ------------------------------------------------

    // Public entry: a player (human) submits an intent. Returns {events} or {error}.
    submit(token, msg) {
      const seat = this.seatOf(token);
      if (seat === null) return { error: 'not-seated' };
      if (this.turn !== seat) return { error: 'not-your-turn' };
      const events = [];
      let r;
      switch (msg.type) {
        case 'bid': r = this._applyBid(seat, msg.bid, events); break;
        case 'declare': r = this._applyDeclare(seat, msg, events); break;
        case 'discard': r = this._applyDiscard(seat, msg.cardIds, events); break;
        case 'play': r = this._applyPlay(seat, msg.cardId, events); break;
        default: return { error: 'bad-intent' };
      }
      if (r && r.error) return r;
      this._advance(events);
      return { events };
    }

    _mustBid(seat) {
      return this.rules.forcedDealerBid && seat === this.dealer && this.high === null
        && this.bidIndex === 3;
    }

    _applyBid(seat, bid, events) {
      if (this.phase !== 'bidding' || this.need !== 'bid') return { error: 'bad-phase' };
      if (!bid || (bid.pass && this._mustBid(seat))) return { error: 'must-bid' };
      if (!bid.pass && !E.isLegalBid(bid, this.high, this.rules)) return { error: 'illegal-bid' };
      this.moveNo++;
      // A bid is just the number, or the number + No-Trump (see Engine.bidKind).
      this.bids[seat] = bid.pass ? { pass: true } : { amount: bid.amount, type: E.bidKind(bid.type) };
      if (!bid.pass) {
        this.bids[seat]._seat = seat;
        this.high = this.bids[seat]; this.highSeat = seat;
      }
      events.push({ t: 'bid', seat, bid: this.bids[seat] });
      this.bidIndex++;
      if (this.bidIndex >= 4) return this._closeAuction(events);
      this.turn = this.bidOrder[this.bidIndex];
      return {};
    }

    _closeAuction(events) {
      if (this.high === null) {
        events.push({ t: 'throwin' });
        this.phase = 'handover';           // treat as a dead hand; host deals next
        this.turn = null; this.need = null;
        // Auto-advance the dealer and redeal immediately for flow.
        this.dealer = (this.dealer + 1) % 4;
        this._startHand(events);
        return {};
      }
      events.push({ t: 'auction', highSeat: this.highSeat, bid: this.high });
      // The high bidder names trump and Uptown/Downtown (No-Trump: just the
      // direction) BEFORE seeing the kitty, then picks it up and buries.
      this.phase = 'declare';
      this.turn = this.highSeat;
      this.need = this.high.type === 'notrump' ? 'declare-dir' : 'declare-suit';
      return {};
    }

    // The high bidder picks up the kitty; its book is credited if the rule is on.
    _takeKitty(seat, events) {
      if (!this.kitty) return;
      if (this.rules.kittyIsBook) this.books[seat % 2]++;
      this.hands[seat] = this.hands[seat].concat(this.kitty);
      events.push({ t: 'kitty', seat, sport: !!this.rules.sportKitty,
        cards: this.rules.sportKitty ? this.kitty : null });
      this.kitty = null;
    }

    _applyDeclare(seat, msg, events) {
      if (this.phase !== 'declare' || seat !== this.highSeat) return { error: 'bad-phase' };
      // Plain bid: name the trump suit AND Uptown/Downtown. No-Trump: direction.
      let trump = null;
      const direction = msg.direction === 'uptown' || msg.direction === 'downtown' ? msg.direction : null;
      if (!direction) return { error: 'bad-dir' };
      if (this.high.type !== 'notrump') {
        if (!E.SUITS.includes(msg.trump)) return { error: 'bad-suit' };
        trump = msg.trump;
      }
      this.moveNo++;
      const type = this.high.type === 'notrump' ? 'notrump' : direction;
      this.contract = { amount: this.high.amount, type, trump, direction };
      events.push({ t: 'declare', seat, contract: this.contract });
      this._takeKitty(seat, events); // the call is made — now the kitty
      this.phase = 'discard';
      this.turn = this.highSeat;
      this.need = 'discard';
      return {};
    }

    _applyDiscard(seat, cardIds, events) {
      if (this.phase !== 'discard' || seat !== this.highSeat) return { error: 'bad-phase' };
      const need = this.hands[seat].length - 12; // 6 with jokers, 4 without
      if (!Array.isArray(cardIds) || cardIds.length !== need) return { error: 'need-' + need };
      const set = new Set(cardIds);
      const owned = this.hands[seat].filter((c) => set.has(c.id));
      if (owned.length !== need) return { error: 'not-your-cards' };
      this.moveNo++;
      this.hands[seat] = this.hands[seat].filter((c) => !set.has(c.id));
      events.push({ t: 'discard', seat });
      this._beginPlay(events);
      return {};
    }

    _beginPlay(events) {
      this.phase = 'playing';
      // House rule: the bidder leads (default), or the player left of the dealer.
      this.leader = this.rules.leadRule === 'left' ? (this.dealer + 1) % 4 : this.highSeat;
      this.turn = this.leader;
      this.need = 'play';
      this.trick = [];
      events.push({ t: 'leadturn', seat: this.leader });
    }

    _applyPlay(seat, cardId, events) {
      if (this.phase !== 'playing' || this.need !== 'play') return { error: 'bad-phase' };
      const card = this.hands[seat].find((c) => c.id === cardId);
      if (!card) return { error: 'no-card' };
      const allowed = E.allowedPlays(this.hands[seat], this.trick, this.contract, this.rules);
      if (!allowed.some((c) => c.id === cardId)) return { error: 'illegal-play' };
      const led = E.trickLedSuit(this.trick, this.contract);
      const reneged = this.rules.renege && E.isRenege(this.hands[seat], this.trick, this.contract, card);
      // A later card in a suit this player failed to follow proves the renege.
      if (this.rules.renege) {
        const suit = E.effectiveSuit(card, this.contract);
        for (const r of this.reneges)
          if (r.seat === seat && !r.revealed && suit && suit === r.suit) { r.revealed = true; this._botCall(r, events); }
      }
      if (reneged) this.reneges.push({ seat, suit: led, revealed: false, called: false, trickNo: this.trickNo });
      this.moveNo++;
      this.hands[seat] = this.hands[seat].filter((c) => c.id !== cardId);
      this.trick.push({ player: seat, card });
      this.memory.add(cardId);
      events.push({ t: 'play', seat, card });
      if (this.trick.length === 4) return this._finishTrick(events);
      this.turn = (seat + 1) % 4;
      return {};
    }

    _finishTrick(events) {
      const winner = E.trickWinner(this.trick, this.contract);
      this.books[winner % 2]++;
      if (!this.seatBooks) this.seatBooks = [0, 0, 0, 0];
      this.seatBooks[winner]++;
      events.push({ t: 'trick', winner, cards: this.trick.slice() });
      this.lastTrick = { cards: this.trick.map((p) => ({ seat: p.player, card: p.card })), winner };
      (this.handTricks || (this.handTricks = [])).push(this.lastTrick);
      this.trickNo++;
      this.trick = [];
      const handDone = this.hands.every((h) => h.length === 0);
      if (handDone) return this._endHand(events);
      this.leader = winner;
      this.turn = winner;
      this.need = 'play';
      return {};
    }

    _endHand(events) {
      const bidTeam = this.highSeat % 2;
      // Renege house rule: bots count the cards at the end and call anything
      // their team hasn't; each called renege moves 3 books to the callers.
      for (const r of this.reneges) if (!r.called) this._botCall(r, events, true);
      const penalties = [];
      for (const r of this.reneges) {
        if (!r.called) continue;
        const off = r.seat % 2, call = 1 - off;
        const take = Math.min(RENEGE_PENALTY, this.books[off]);
        this.books[off] -= take; this.books[call] += take;
        penalties.push({ seat: r.seat, books: take });
      }
      const res = E.scoreHand(this.contract.amount, this.contract, this.books[bidTeam], this.rules);
      this.scores[bidTeam] += res.delta;
      this.lastResult = {
        highSeat: this.highSeat, bid: this.high, contract: this.contract,
        bidTeam, books: this.books.slice(), needed: res.needed, delta: res.delta,
        made: res.made, boston: this.books[bidTeam] === 13, scores: this.scores.slice(),
        penalties,
        // The hand book by book (all cards are face up by now); a called
        // renege is marked on the book where it happened.
        tricks: (this.handTricks || []).map((t, i) => {
          const r = this.reneges.find((x) => x.called && x.trickNo === i);
          return r ? Object.assign({ renege: r.seat }, t) : t;
        }),
      };
      this._recordHand(bidTeam, res);
      aiLib.observeHand(this.learner, {
        declarerSeat: this.highSeat, amount: this.contract.amount, needed: res.needed,
        bidTeamBooks: this.books[bidTeam], made: res.made,
        calibrate: this.seats[this.highSeat].kind === 'ai',
      });
      events.push({ t: 'handend', result: this.lastResult });
      const winner = E.gameOver(this.scores, this.rules);
      if (winner !== null) {
        this.phase = 'gameover';
        this.turn = null; this.need = null;
        events.push({ t: 'gameover', winner, scores: this.scores.slice() });
        this._recordGame(winner);
      } else {
        this.phase = 'handover';
        this.turn = null; this.need = null;
      }
      this._banter(bidTeam, res, events);
      return {};
    }

    // ---- table record --------------------------------------------------------

    _player(seat) {
      const s = this.seats[seat];
      const key = (s.name || 'Player') + (s.kind === 'ai' ? ' (bot)' : '');
      const P = this.record.players;
      if (!P[key]) {
        if (Object.keys(P).length >= 24) return null; // keep the record small
        P[key] = { name: s.name || 'Player', bot: s.kind === 'ai', books: 0, bids: 0, made: 0, bostons: 0, games: 0, wins: 0 };
      }
      return P[key];
    }

    _recordHand(bidTeam, res) {
      const R = this.record;
      R.hands++;
      if (res.made) R.made[bidTeam]++; else R.sets[bidTeam]++;
      const boston = this.books[bidTeam] === 13;
      if (boston) R.bostons[bidTeam]++;
      for (let seat = 0; seat < 4; seat++) {
        const p = this._player(seat); if (!p) continue;
        p.books += (this.seatBooks && this.seatBooks[seat]) || 0;
        if (seat === this.highSeat) { p.bids++; if (res.made) p.made++; if (boston) p.bostons++; }
      }
    }

    _recordGame(winner) {
      const R = this.record;
      R.games++; R.teamWins[winner]++;
      for (const team of [0, 1]) {
        const names = [team, team + 2].map((n) => this.seats[n].name || 'Player').sort();
        const key = names.join(' & ');
        if (!R.pairs[key] && Object.keys(R.pairs).length >= 24) continue;
        const pr = R.pairs[key] || (R.pairs[key] = { names, games: 0, wins: 0 });
        pr.games++; if (team === winner) pr.wins++;
        for (const n of [team, team + 2]) { const p = this._player(n); if (p) { p.games++; if (team === winner) p.wins++; } }
      }
    }

    // ---- reactions -------------------------------------------------------------

    react(token, id) {
      const seat = this.seatOf(token);
      if (seat === null) return { error: 'not-seated' };
      if (!Number.isInteger(id) || id < 0 || id >= E.REACTIONS.length) return { error: 'bad-reaction' };
      const now = this.now();
      if (now - (this.reactAt[seat] || 0) < 1200) return { error: 'slow-down' };
      this.reactAt[seat] = now;
      return { events: [{ t: 'react', seat, id }] };
    }

    // A typed message from a seated player: plain text, one line, ≤ 60
    // characters, same pace limit as reactions.
    say(token, text) {
      const seat = this.seatOf(token);
      if (seat === null) return { error: 'not-seated' };
      const clean = typeof text === 'string' ? E.filterChat(stripMarkup(text).slice(0, 60).trim()) : '';
      if (!clean) return { error: 'empty-message' };
      const now = this.now();
      if (now - (this.reactAt[seat] || 0) < 1200) return { error: 'slow-down' };
      this.reactAt[seat] = now;
      return { events: [{ t: 'say', seat, text: clean }] };
    }

    // Bots talk a little trash at the end of a hand.
    _banter(bidTeam, res, events) {
      const bots = (team) => [team, team + 2].filter((n) => this.seats[n].kind === 'ai');
      const pick = (arr) => arr[Math.floor(this.rng() * arr.length)];
      const R = E.REACTIONS;
      const say = (seat, text) => { if (seat != null) events.push({ t: 'react', seat, id: R.indexOf(text) }); };
      const def = bots(1 - bidTeam), dec = bots(bidTeam);
      if (!res.made && def.length && this.rng() < 0.7) say(pick(def), pick(["Set 'em!", '😂', 'Too slow!']));
      else if (this.books[bidTeam] === 13 && dec.length) say(pick(dec), pick(['🔥', '🙌']));
      else if (res.made && dec.length && this.rng() < 0.25) say(pick(dec), pick(['Nice book!', '👏']));
    }

    // ---- renege (house rule) -----------------------------------------------------

    // Any seated player may call a renege during play. If someone on the other
    // team broke follow-suit this hand (and it hasn't been called), it's
    // upheld: 3 books move at the end of the hand. A wrong call costs nothing.
    callRenege(token) {
      const seat = this.seatOf(token);
      if (seat === null) return { error: 'not-seated' };
      if (!this.rules.renege) return { error: 'no-renege-rule' };
      if (this.phase !== 'playing') return { error: 'bad-phase' };
      const r = this.reneges.find((x) => !x.called && x.seat % 2 !== seat % 2);
      const events = [];
      if (r) { r.called = true; events.push({ t: 'renege', caller: seat, offender: r.seat, ok: true, books: RENEGE_PENALTY }); }
      else events.push({ t: 'renege', caller: seat, ok: false });
      return { events };
    }

    // Bots (or a bot covering an away player) call a renege once it's proven.
    _botCall(r, events, atCount) {
      if (r.called) return;
      const callers = [0, 1, 2, 3].filter((n) => n % 2 !== r.seat % 2 &&
        (this.seats[n].kind === 'ai' || !this.seats[n].connected));
      if (!callers.length) return;
      r.called = true;
      events.push({ t: 'renege', caller: callers[0], offender: r.seat, ok: true, books: RENEGE_PENALTY, atCount: !!atCount });
    }

    // ---- house rules (host) ------------------------------------------------------

    setRules(token, rules) {
      if (token !== this.effectiveHost()) return { error: 'not-host' };
      if (!['lobby', 'handover', 'gameover'].includes(this.phase)) return { error: 'between-hands' };
      this.rules = Object.assign({}, this.rules, E.cleanRules(rules));
      return { events: [{ t: 'rules' }] };
    }

    // ---- spectators ----------------------------------------------------------------

    // A watcher takes a seat: an open seat, or one a bot is playing.
    sitIn(name, avatar) {
      let spot = this.seats.find((s) => s.kind === 'empty')
        || this.seats.find((s) => s.kind === 'ai' && s.left)
        || this.seats.find((s) => s.kind === 'ai');
      if (!spot) return { error: 'full' };
      const token = randId(16);
      Object.assign(spot, {
        kind: 'human', name: cleanName(name, 'Player'), avatar: cleanAvatar(avatar),
        token, connected: true, ai: null, left: false, joinedTeamAt: ++this.joinSeq,
      });
      if (!this.hostToken) this.hostToken = token;
      this._updateCaptains();
      const events = [{ t: 'sitIn', seat: spot.seat, name: spot.name }];
      return { seat: spot.seat, token, host: this.hostToken === token, events };
    }

    // ---- turn timer ------------------------------------------------------------------

    _armTimer() {
      if (!this.rules.turnTimer || this.turn === null) { this.deadline = null; this.timerKey = null; return; }
      if (this.timerKey === this.moveNo && this.deadline) return; // same wait, keep the clock
      this.timerKey = this.moveNo;
      this.deadline = this.now() + this.rules.turnTimer * 1000;
    }

    // Called when the timer fires: if the same player is still on the clock,
    // a bot makes that one move for them.
    timeout() {
      if (!this.deadline || this.now() < this.deadline || this.turn === null) return { events: [] };
      const seat = this.turn;
      const events = [{ t: 'timeout', seat }];
      this.deadline = null; this.timerKey = null;
      this._aiAct(seat, events);
      this._advance(events);
      return { events };
    }

    // ---- AI auto-advance ---------------------------------------------------

    // Drive AI seats until it's a connected human's turn or the hand pauses.
    // A disconnected human's seat is also covered by AI so games never stall.
    _advance(events) {
      let guard = 0;
      while (guard++ < 400) {
        if (this.turn === null) { this._armTimer(); return; }
        const s = this.seats[this.turn];
        const humanPresent = s.kind === 'human' && s.connected;
        if (humanPresent) { this._armTimer(); return; } // wait for their intent
        // AI (or a dropped human) acts.
        if (!this._aiAct(this.turn, events)) return;
      }
    }

    // One computer move for `seat` (a bot, an away player, or a timed-out turn).
    _aiAct(seat, events) {
      const level = this.rules.aiLevel;
      if (this.need === 'bid') {
        const mustBid = this._mustBid(seat);
        const r = aiLib.chooseBid(this.hands[seat], this.high, this.rules, mustBid, this.rng, this.learner, seat);
        if (!r.bid.pass) this.plans[seat] = r.plan;
        this._applyBid(seat, r.bid, events);
      } else if (this.need === 'declare-suit' || this.need === 'declare-dir') {
        // From its own 12 cards (the kitty comes after): best trump + direction.
        const d = aiLib.chooseDeclare(this.hands[seat], this.high.type === 'notrump' ? 'notrump' : 'suit');
        this._applyDeclare(seat, d, events);
      } else if (this.need === 'discard') {
        const discards = aiLib.chooseDiscards(this.hands[seat], this.contract);
        this._applyDiscard(seat, discards.map((c) => c.id), events);
      } else if (this.need === 'play') {
        const card = aiLib.choosePlay(this.hands[seat], this.trick, this.contract, seat, this.memory, level, this.rng);
        this._applyPlay(seat, card.id, events);
      } else return false;
      return true;
    }

    // ---- views -------------------------------------------------------------

    // Public snapshot tailored to one token (its own hand only).
    viewFor(token) {
      const seat = this.seatOf(token);
      const view = {
        code: this.code,
        phase: this.phase,
        handNo: this.handNo,
        dealer: this.dealer,
        turn: this.turn,
        need: this.need,
        hostToken: token != null && this.effectiveHost() === token, // can *you* start / deal
        teams: [0, 1].map((t) => ({
          name: this.teamNames[t],
          captainSeat: this.seatOf(this.captains[t]),
          youAreCaptain: token != null && this.captains[t] === token,
        })),
        scores: this.scores.slice(),
        books: this.books.slice(),
        seatBooks: (this.seatBooks || [0, 0, 0, 0]).slice(),
        contract: this.contract,
        high: this.high ? { amount: this.high.amount, type: this.high.type, seat: this.highSeat } : null,
        bids: this.bids.map((b) => (b ? (b.pass ? { pass: true } : { amount: b.amount, type: b.type }) : null)),
        trick: this.trick.map((p) => ({ seat: p.player, card: p.card })),
        counts: this.hands.map((h) => (h ? h.length : 0)),
        seats: this.seats.map((s) => ({
          seat: s.seat, kind: s.kind, name: s.name, avatar: s.avatar || null,
          connected: s.connected, team: s.seat % 2, left: !!s.left,
          isHost: s.token != null && this.hostToken === s.token,
          you: s.token === token && token != null,
        })),
        result: this.phase === 'handover' || this.phase === 'gameover' ? this.lastResult : null,
        rules: E.cleanRules(this.rules),
        record: this.record,
        lastTrick: this.lastTrick,
        turnMsLeft: this.deadline ? Math.max(0, this.deadline - this.now()) : null,
        kittySize: this.rules.noJokers ? 4 : 6,
      };
      if (seat !== null && this.hands[seat]) {
        const dir = this.contract ? (this.contract.type === 'notrump' ? this.contract.direction : this.contract.type) : 'uptown';
        view.you = {
          seat,
          hand: E.sortHand(this.hands[seat], dir, this.contract),
          mustBid: this.need === 'bid' && this.turn === seat && this._mustBid(seat),
          legalIds: (this.turn === seat && this.need === 'play')
            ? E.allowedPlays(this.hands[seat], this.trick, this.contract, this.rules).map((c) => c.id)
            : null,
        };
      } else {
        view.you = null; // spectator
      }
      return view;
    }

    // Snapshot for the "read" line etc. (host/debug).
    publicSummary() {
      return { code: this.code, phase: this.phase, handNo: this.handNo,
        players: this.seats.map((s) => ({ seat: s.seat, kind: s.kind, name: s.name })) };
    }

    // ---- persistence ------------------------------------------------------
    // The Durable Object can be evicted from memory between moves (hibernation,
    // deploys), so the whole room is saved after every change and restored on
    // wake. Plain data only: the RNG is dropped and the played-card Set becomes
    // an array.
    toJSON() {
      const o = {};
      for (const k of Object.keys(this)) if (k !== 'rng' && k !== 'now') o[k] = this[k];
      o.memory = Array.from(this.memory || []);
      return o;
    }

    static fromJSON(data) {
      const r = new Room(data.code, data.rules);
      Object.assign(r, data);
      r.memory = new Set(data.memory || []);
      r.rng = Math.random;
      r.now = Date.now;
      return r;
    }
  }

  // ---- the Daily Deal ------------------------------------------------------------
  // Everyone plays the same hand each day: default rules, the day's seed, fresh
  // computer players. The server checks a posted score by replaying the moves.
  const DAILY_RULES = E.cleanRules(E.DEFAULT_RULES);
  function dailyRoom(date) {
    const room = new Room('DAILY', DAILY_RULES, { rng: E.seededRng(E.dailySeed(date)) });
    room.learner = aiLib.createLearner();
    return room;
  }
  // You're seat 0 (team 0). Score = your team's points minus theirs this hand.
  function dailyScore(result) {
    const net = result.bidTeam === 0 ? result.delta : -result.delta;
    return { net, books: result.books[0], made: !!result.made, bidder: result.highSeat, contract: result.contract };
  }
  function replayDaily(date, moves) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(moves) || moves.length > 60) return { error: 'bad-input' };
    const room = dailyRoom(date);
    const { token } = room.join('You');
    room.start(token);
    for (const m of moves) {
      if (room.phase !== 'bidding' && room.phase !== 'declare' && room.phase !== 'discard' && room.phase !== 'playing') break;
      const out = room.submit(token, m);
      if (out && out.error) return { error: 'bad-move' };
    }
    if ((room.phase !== 'handover' && room.phase !== 'gameover') || !room.lastResult) return { error: 'unfinished' };
    return dailyScore(room.lastResult);
  }

  return { Room, dailyRoom, dailyScore, replayDaily };
});
