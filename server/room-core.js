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
    module.exports = factory(require('../js/engine.js'), require('../js/ai.js'));
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

  const DEFAULT_AI_NAMES = ['Pearl', 'Marcus', 'Deacon', 'Ruby'];

  class Room {
    constructor(code, rules, opts) {
      opts = opts || {};
      this.code = code;
      this.rules = Object.assign({}, E.DEFAULT_RULES, rules || {});
      this.rng = opts.rng || Math.random;
      this.phase = 'lobby';                 // lobby|bidding|declare|discard|playing|handover|gameover
      this.seats = [0, 1, 2, 3].map((i) => ({
        seat: i, kind: 'empty', name: null, token: null, connected: false, ai: null,
      }));
      this.hostToken = null;
      this.scores = [0, 0];
      this.handNo = 0;
      this.dealer = Math.floor(this.rng() * 4);
      this.learner = aiLib.createLearner();
      this._resetHand();
    }

    // ---- membership --------------------------------------------------------

    seatOf(token) {
      const s = this.seats.find((x) => x.token === token);
      return s ? s.seat : null;
    }

    join(name) {
      const spot = this.seats.find((s) => s.kind === 'empty');
      if (!spot) return { error: 'full' };
      const token = randId(16);
      spot.kind = 'human';
      spot.name = (name || 'Player').slice(0, 16);
      spot.token = token;
      spot.connected = true;
      spot.ai = null;
      if (!this.hostToken) this.hostToken = token; // first to join hosts
      return { seat: spot.seat, token, host: this.hostToken === token };
    }

    reclaim(token) {
      const s = this.seats.find((x) => x.token === token);
      if (!s) return { error: 'unknown' };
      s.connected = true;
      return { seat: s.seat, host: this.hostToken === token };
    }

    setConnected(token, on) {
      const s = this.seats.find((x) => x.token === token);
      if (s) s.connected = on;
    }

    // Host leaves in lobby → hand off host to another human, or reset seat.
    leave(token) {
      const s = this.seats.find((x) => x.token === token);
      if (!s) return;
      if (this.phase === 'lobby') {
        s.kind = 'empty'; s.name = null; s.token = null; s.connected = false;
      } else {
        s.connected = false; // mid-game: keep the seat, AI covers turns
      }
      if (this.hostToken === token) {
        const next = this.seats.find((x) => x.kind === 'human' && x.token && x.token !== token);
        this.hostToken = next ? next.token : null;
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
      this.trick = [];
      this.leader = null;
      this.turn = null;
      this.need = null;
      this.memory = new Set();
      this.bidIndex = 0;
      this.bidOrder = [];
      this.lastResult = null;
    }

    // Host starts: empty seats become AI, then deal and open the auction.
    start(token) {
      if (token !== this.hostToken) return { error: 'not-host' };
      if (this.phase !== 'lobby' && this.phase !== 'handover' && this.phase !== 'gameover')
        return { error: 'in-progress' };
      let aiN = 0;
      for (const s of this.seats) {
        if (s.kind === 'empty') {
          s.kind = 'ai';
          s.name = DEFAULT_AI_NAMES[aiN++ % DEFAULT_AI_NAMES.length];
          s.token = null;
        }
      }
      if (this.phase === 'gameover') { this.scores = [0, 0]; this.handNo = 0; }
      const events = [];
      this._startHand(events);
      return { events };
    }

    // Begin the next hand (used by start and by "next hand" after a hand ends).
    nextHand(token) {
      if (token !== this.hostToken) return { error: 'not-host' };
      if (this.phase !== 'handover') return { error: 'bad-phase' };
      const events = [];
      this.dealer = (this.dealer + 1) % 4;
      this._startHand(events);
      return { events };
    }

    _startHand(events) {
      this._resetHand();
      this.handNo++;
      const deck = E.shuffle(E.newDeck(), this.rng);
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
      this.bids[seat] = bid.pass ? { pass: true } : { amount: bid.amount, type: bid.type };
      if (!bid.pass) {
        this.bids[seat]._seat = seat;
        this.high = this.bids[seat]; this.highSeat = seat;
        if (this.seats[seat].kind === 'human') this.plans[seat] = { type: bid.type };
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
      this.phase = 'declare';
      this.turn = this.highSeat;
      this.need = this.high.type === 'notrump' ? 'declare-dir' : 'declare-suit';
      return {};
    }

    _applyDeclare(seat, msg, events) {
      if (this.phase !== 'declare' || seat !== this.highSeat) return { error: 'bad-phase' };
      let trump = null, direction;
      if (this.high.type === 'notrump') {
        if (msg.direction !== 'uptown' && msg.direction !== 'downtown') return { error: 'bad-dir' };
        direction = msg.direction;
      } else {
        if (!E.SUITS.includes(msg.trump)) return { error: 'bad-suit' };
        trump = msg.trump; direction = this.high.type;
      }
      this.contract = { amount: this.high.amount, type: this.high.type, trump, direction };
      events.push({ t: 'declare', seat, contract: this.contract });
      // Bidder picks up the kitty; kitty book credited if the rule is on.
      if (this.rules.kittyIsBook) this.books[seat % 2]++;
      this.hands[seat] = this.hands[seat].concat(this.kitty);
      events.push({ t: 'kitty', seat, sport: !!this.rules.sportKitty,
        cards: this.rules.sportKitty ? this.kitty : null });
      this.kitty = null;
      this.phase = 'discard';
      this.turn = this.highSeat;
      this.need = 'discard';
      return {};
    }

    _applyDiscard(seat, cardIds, events) {
      if (this.phase !== 'discard' || seat !== this.highSeat) return { error: 'bad-phase' };
      if (!Array.isArray(cardIds) || cardIds.length !== 6) return { error: 'need-6' };
      const set = new Set(cardIds);
      const owned = this.hands[seat].filter((c) => set.has(c.id));
      if (owned.length !== 6) return { error: 'not-your-cards' };
      this.hands[seat] = this.hands[seat].filter((c) => !set.has(c.id));
      events.push({ t: 'discard', seat });
      this._beginPlay(events);
      return {};
    }

    _beginPlay(events) {
      this.phase = 'playing';
      this.leader = this.highSeat;
      this.turn = this.highSeat;
      this.need = 'play';
      this.trick = [];
      events.push({ t: 'leadturn', seat: this.leader });
    }

    _applyPlay(seat, cardId, events) {
      if (this.phase !== 'playing' || this.need !== 'play') return { error: 'bad-phase' };
      const card = this.hands[seat].find((c) => c.id === cardId);
      if (!card) return { error: 'no-card' };
      const legal = E.legalPlays(this.hands[seat], this.trick, this.contract);
      if (!legal.some((c) => c.id === cardId)) return { error: 'illegal-play' };
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
      events.push({ t: 'trick', winner, cards: this.trick.slice() });
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
      const res = E.scoreHand(this.contract.amount, this.contract, this.books[bidTeam], this.rules);
      this.scores[bidTeam] += res.delta;
      this.lastResult = {
        highSeat: this.highSeat, bid: this.high, contract: this.contract,
        bidTeam, books: this.books.slice(), needed: res.needed, delta: res.delta,
        made: res.made, boston: this.books[bidTeam] === 13, scores: this.scores.slice(),
      };
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
      } else {
        this.phase = 'handover';
        this.turn = null; this.need = null;
      }
      return {};
    }

    // ---- AI auto-advance ---------------------------------------------------

    // Drive AI seats until it's a connected human's turn or the hand pauses.
    // A disconnected human's seat is also covered by AI so games never stall.
    _advance(events) {
      let guard = 0;
      while (guard++ < 400) {
        if (this.turn === null) return;
        const s = this.seats[this.turn];
        const humanPresent = s.kind === 'human' && s.connected;
        if (humanPresent) return; // wait for their intent
        // AI (or a dropped human) acts.
        if (this.need === 'bid') {
          const mustBid = this._mustBid(this.turn);
          const r = aiLib.chooseBid(this.hands[this.turn], this.high, this.rules, mustBid,
            this.rng, this.learner, this.turn);
          if (!r.bid.pass) this.plans[this.turn] = r.plan;
          this._applyBid(this.turn, r.bid, events);
        } else if (this.need === 'declare-suit' || this.need === 'declare-dir') {
          const plan = this.plans[this.turn] || aiLib.bestPlan(this.hands[this.turn], this.learner.bidBias);
          if (this.high.type === 'notrump') this._applyDeclare(this.turn, { direction: plan.direction }, events);
          else this._applyDeclare(this.turn, { trump: plan.trump }, events);
        } else if (this.need === 'discard') {
          const discards = aiLib.chooseDiscards(this.hands[this.turn], this.contract);
          this._applyDiscard(this.turn, discards.map((c) => c.id), events);
        } else if (this.need === 'play') {
          const card = aiLib.choosePlay(this.hands[this.turn], this.trick, this.contract, this.turn, this.memory);
          this._applyPlay(this.turn, card.id, events);
        } else return;
      }
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
        hostToken: this.hostToken === token, // is *you* the host
        scores: this.scores.slice(),
        books: this.books.slice(),
        contract: this.contract,
        high: this.high ? { amount: this.high.amount, type: this.high.type, seat: this.highSeat } : null,
        bids: this.bids.map((b) => (b ? (b.pass ? { pass: true } : { amount: b.amount, type: b.type }) : null)),
        trick: this.trick.map((p) => ({ seat: p.player, card: p.card })),
        counts: this.hands.map((h) => (h ? h.length : 0)),
        seats: this.seats.map((s) => ({
          seat: s.seat, kind: s.kind, name: s.name,
          connected: s.connected, team: s.seat % 2, isHost: this.hostToken === s.token,
          you: s.token === token && token != null,
        })),
        result: this.phase === 'handover' || this.phase === 'gameover' ? this.lastResult : null,
        rules: {
          minBid: this.rules.minBid, gameTarget: this.rules.gameTarget,
          kittyIsBook: this.rules.kittyIsBook, sportKitty: this.rules.sportKitty,
        },
      };
      if (seat !== null && this.hands[seat]) {
        const dir = this.contract ? (this.contract.type === 'notrump' ? this.contract.direction : this.contract.type) : 'uptown';
        view.you = {
          seat,
          hand: E.sortHand(this.hands[seat], dir),
          mustBid: this.need === 'bid' && this.turn === seat && this._mustBid(seat),
          legalIds: (this.turn === seat && this.need === 'play')
            ? E.legalPlays(this.hands[seat], this.trick, this.contract).map((c) => c.id)
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
  }

  return { Room };
});
