# Bid Whist

A complete, playable **Bid Whist** game in the browser — you and your AI partner
Marcus against Pearl and Deacon. Plain HTML/CSS/JavaScript with no build step:
open `index.html` and play, or host it on GitHub Pages.

## Play it

- **Locally:** open `index.html` in any modern browser. No install, no server.
- **GitHub Pages:** repo Settings → Pages → deploy from the `main` branch root,
  and the game will be live at `https://<user>.github.io/bidwhist/`.

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
index.html      app shell
styles.css      the whole look — felt, mahogany, gold, cream card stock
js/engine.js    pure rules engine (deck, bids, ranking, tricks, scoring)
js/ai.js        heuristic AI: hand evaluation, bidding, discards, play
js/app.js       game flow state machine + DOM rendering
tests/          engine test suite and AI-vs-AI simulator
```

`engine.js` and `ai.js` are dependency-free and load in both the browser and
Node, so the exact code the game runs is what the tests exercise:

```sh
node tests/engine.test.js    # 37 rules invariants
node tests/simulate.js 500   # full AI-vs-AI hands; asserts no illegal plays
```

Key engine formulas: a contract needs `6 + bid` books; defenders set it at
`13 − (6 + bid) + 1 = 8 − bid` books.
