# Bid Whist

A complete, playable **Bid Whist** game in the browser. Play the computer solo,
or deal your friends in online — each game is its own private table with a game
key to share. Plain HTML/CSS/JavaScript with no build step for the game itself;
online play is powered by a small Cloudflare Worker.

## Play it

- **Solo (vs computer):** open `index.html` in any modern browser, or visit the
  hosted site, and hit **Play the Computer**. No install, no server.
- **Online with friends:** hit **Play Online** → **Host a Table**, share the game
  key, and your friends **Join** with it. Any empty seats are filled by the
  computer. This needs the backend deployed once — see [`server/`](server/).
- **Hosting the static site:** it's just files, so any static host works —
  GitHub Pages (Settings → Pages → deploy from `main`) or Cloudflare Pages
  (build command: none, output dir `/`). See `_headers` for the Cloudflare
  caching/security headers.

## Playing with others online

One player **hosts** and gets a 5-character game key (e.g. `HURLQ`). Everyone
else picks **Join** and enters that key. Seats nobody takes are played by the
adaptive AI, so a table of one human + three bots and a table of four humans use
the exact same game. You can run **any number of tables at once** — each game
key is a completely separate room, so games never bleed into each other. If you
drop, your browser remembers your seat and can reconnect to the same table.

The backend is a Cloudflare Worker + Durable Objects (one isolated object per
game key). Deploy instructions and the full protocol are in
[`server/README.md`](server/README.md). With no backend configured the game
still runs fully in solo mode.

## The computer learns as you play

In solo play the table adapts across a session (`js/ai.js`). It isn't a neural
net — under Bid Whist's scoring the honest truth is that a made contract already
scores *all* books over six, so a well-tuned static bidder is near the ceiling.
Instead the AI runs a self-correcting bid calibrator that **stays neutral while
play is healthy** (verified harmless by a paired simulation) and pulls its
aggression back when the table keeps getting set, plus a per-seat **read on your
bidding** that it voices at the table. It gets smarter about *you*, without ever
degrading its normal play.

## The game

Bid Whist is the classic African-American partnership trick-taking game: four
players in fixed partnerships, a 54-card deck (52 cards plus both jokers),
12 cards each, and a 6-card **kitty**. Twelve tricks (*books*) plus the kitty
makes **13 books** per hand.

- **The auction.** Starting left of the dealer, each player gets one call:
  pass, or bid **3–7** as **Uptown** (high cards win), **Downtown** (A, 2, 3 …
  K — after the ace, low wins), or **No-Trump**. A bid promises *six plus the
  bid* books: bid 4 means 10 books. At the same number No-Trump outranks the
  others; Uptown and Downtown tie, so you must raise the number to beat one
  with the other. If the first three players pass, the dealer is stuck with a
  minimum bid.
- **The kitty.** The high bidder names trump (or the direction, for No-Trump),
  takes all six kitty cards, and buries six — and the buried book counts as the
  bidding team's first book.
- **The play.** The bidder leads. Follow suit if you can. The Big and Little
  Jokers are the top two trumps. In No-Trump the jokers are dead cards: they
  can never win a book and only fall when you're void of the led suit.
- **The score.** Make the bid and the bidding team scores *every* book past
  six; get set and lose the bid amount instead. No-Trump doubles it either
  way. Defenders set a bid by winning **8 − bid** books (four books stops a
  4-bid, three stops a 5-bid). Taking all 13 is a **Boston**. First team to
  the target wins the game; hitting minus-target loses it.

## Table rules (variants)

Every table plays it a little different, so the rules engine is a profile, not
a constant. In-game **Table Rules** lets you change (persisted in the browser):

| Option | Default |
|---|---|
| Minimum bid | 3 (or 4) |
| Game target | 7 (5 / 9 / 11 / 21) |
| No-Trump scores double | on |
| Kitty counts as the bidders' first book | on |
| Dealer must bid if all three pass | on (off = throw the hand in) |
| Sport the kitty (shown to the whole table) | off |
| A made 7-bid (Boston) scores double | off |

Reneging isn't modeled: the app enforces follow-suit, so illegal plays are
impossible rather than penalized.

## Code layout

```
index.html          app shell (table, lobby, modals)
styles.css          the whole look — felt, mahogany, gold, cream card stock
js/engine.js        pure rules engine (deck, bids, ranking, tricks, scoring)
js/ai.js            heuristic AI + session learner
js/net.js           WebSocket transport for online play
js/app.js           game flow, DOM rendering, and the online controller
server/room-core.js authoritative game state machine (shared by the backend)
server/worker.js    Cloudflare Worker + Durable Object (WebSocket transport)
server/wrangler.toml deploy config
tests/              engine tests, AI-vs-AI simulator, room-core tests
```

`engine.js`, `ai.js`, and `server/room-core.js` are dependency-free and load in
both the browser and Node, so the exact code the game (and the server) runs is
what the tests exercise:

```sh
node tests/engine.test.js    # rules invariants
node tests/simulate.js 400   # paired AI sim: learner is harmless + responsive
node tests/room.test.js      # authoritative room: turns, card hiding, isolation
```

Key engine formulas: a contract needs `6 + bid` books; defenders set it at
`13 − (6 + bid) + 1 = 8 − bid` books.
