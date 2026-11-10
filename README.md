# Give Me Da Kitty — Bid Whist

*Bid it. Win the kitty. Run a Boston.*

**Give Me Da Kitty** is a complete, playable **Bid Whist** game in the browser. Play the computer solo,
or deal your friends in online — each game is its own private table with a game
key to share. Plain HTML/CSS/JavaScript with no build step for the game itself;
online play is powered by a small Cloudflare Worker.

## Play it

- **Solo (vs computer):** open `index.html` in any modern browser, or visit the
  hosted site, and hit **Play the Computer**. No install, no server.
- **Online with friends:** hit **Play Online** → **Host a Table**, share the game
  key, and your friends **Join** with it. Any empty seats are filled by the
  computer. Works on the hosted site out of the box — nothing to configure.
- **Your player:** set a **name and avatar** (upload a photo, or spin a random
  cartoon) from the **Profile** chip on the splash or the Profile button. It
  shows on your seat in both solo and online play; online, everyone at the table
  sees each other's.
- **Live at [givemedakitty.com](https://givemedakitty.com)** (and `www.`), as well
  as the original `bidwhist.<subdomain>.workers.dev` address.
- **The table:** gold Big Joker and silver Little Joker (marked *throw-off*
  in No-Trump), maroon card backs with the kitty medallion, a kitty pile that
  slides to the high bidder ("Give me da kitty!"), a glow on whichever card is
  winning the book, book counts on every nameplate, and a Boston / game-win
  celebration. **Table Rules → Look & sound** picks the felt (green, burgundy,
  midnight blue, rent-party purple) and turns sound effects & vibration on or
  off (also in the menu). Sounds are synthesized in the browser — no files.
- **Learn to Play:** a guided hand for newcomers (splash screen, or How to
  Play → Play a Guided Hand). It deals a fixed hand chosen to show everything:
  you outbid a 3 with a 4, take the kitty, name Spades Uptown, bury six,
  follow suit, trump, meet the jokers, let your partner win, and make it.
  A lesson card explains each moment; on your turn only the move being taught
  is allowed, with the reason. After four books you can let it finish the hand
  for you. The lesson's moves come from the same coach as the Coach option.
- **Help at the table:** a badge on the felt always shows trump and which
  way it runs (trump cards get a gold edge in your hand); **Last book** shows
  the previous four cards; the bid panel explains each bid in plain English
  ("4 Uptown: your team needs 10 of 13 books…"); and an optional **Coach**
  (Table Rules → Help & readability) suggests bids, trump, what to bury and
  which card to play, with a reason. Coach uses the same brain as the
  computer players.
- **The call is announced:** once the high bidder (person or computer) has
  the kitty and names trump, the table shows who called it, the contract
  ("Pearl calls it: 4 Downtown in Hearts") and what it takes to make or set
  it — for about 2½ seconds before the first card (a tap skips it; your own
  call gets a short confirmation).
- **Talk at the table:** 💬 pops a quick call-out or emoji over your seat
  ("Run a Boston!", "Set 'em!", 😂 …) — or type your own (one line, up to 60
  characters, plain text; profanity and slurs are masked, e.g. "f***", with
  common dodges like sh1t or fuuuck caught). Messages show over your seat and in Table Talk;
  the bots talk a little trash too.
- **Table record:** wins, Bostons, sets, best bidder and (online) best duo
  across games at the table, on the game-over screen; solo also keeps an
  all-time record vs the computer.
- **Watch & sit in:** if a table is full, an invite link lets you watch (no
  cards shown); tap **Take a seat** when a seat opens or a bot is playing one.
- **Works offline:** install it to your home screen; solo play works with no
  signal (a service worker, `sw.js`, caches the app).
- **Readability:** bigger cards in your hand, a four-color deck (blue ♦,
  green ♣), keyboard play (Tab + Enter) and screen-reader labels.
- **Branding:** page title, link-preview card (`img/og-card.png`, shown when
  the link is texted or posted), and home-screen icons (`img/`,
  `manifest.webmanifest` — saved to a phone it's called **Da Kitty**).
- **Hosting:** one Cloudflare Worker (`wrangler.toml` at the repo root) serves
  both the game and the online server. Cloudflare's GitHub integration
  auto-deploys it on every push to `main`, so there's nothing to run by hand.
  It fits the Workers **Free** plan. See `_headers` for caching/security headers.

## Playing with others online

One player **hosts** and gets a 5-character game key (e.g. `HURLQ`). To invite
others, the lobby shows a **QR code** and a **Copy invite link** button — the
link (and QR) carry the key, so a friend just taps it (or scans) and lands on
the Join screen pre-filled, ready to go. They can also
**Join** and type the key by hand. Seats nobody takes are played by the adaptive
AI, so a table of one human + three bots and a table of four humans use the exact
same game. You can run **any number of tables at once** — each game key is a
completely separate room, so games never bleed into each other.

**Teams & partners.** In the lobby, each player picks **Team A or Team B** —
which is how you choose your partner. The first player on a team is its
**captain** and names it (only the captain can); team names then replace
"Us/Them" on the scoreboard and in results. Teams lock when the game starts,
and any open seat is filled by a bot.

**Host controls.** In the lobby the host can **tap a player, then tap a seat**
to move them (swap seats, set partners), **+ Bot** an open seat, or **Kick** a
bot to open the seat for a friend. After a game ends, **Back to Lobby** keeps
everyone seated (scores reset) so the host can kick a bot and let a late
arrival join with the same game key.

**When someone leaves.** A bot takes their seat immediately and plays on —
even if it was their turn — so the table never stalls. Tapping **Leave Table**
hands the seat to the bot for good; if a player just loses signal or closes
the tab, the bot covers for them and they get their seat back by reopening the
game. If the host leaves, the next player inherits starting / dealing.

The server is a Durable Object (one isolated object per game key) living in
the same Worker that serves the site, so the page's own address *is* the server
— players never see or type a server URL. Game state is saved after every move,
so a table survives Cloudflare putting an idle room to sleep. Details and the
protocol are in [`server/README.md`](server/README.md). Opened as a local file
(no server), the game still runs fully in solo mode.

## The computer learns as you play

The computer comes in three levels (Table Rules → Computer players): **Easy**
misjudges hands and plays loose (≈0.8 pt/hand worse than Regular), **Regular**
is the tuned default, and **Sharp** draws trump when it holds four or more
(≈+0.1 pt/hand over Regular). Both edges are measured by a paired simulation,
`tests/levels.js`, that replays the same deals with the teams swapped.

In solo play the table also adapts across a session (`js/ai.js`). It isn't a neural
net — under Bid Whist's scoring the honest truth is that a made contract already
scores *all* books over six, so a well-tuned static bidder is near the ceiling.
Instead the AI runs a self-correcting bid calibrator that **stays neutral while
play is healthy** (verified harmless by a paired simulation) and pulls its
aggression back when the table keeps getting set, plus a per-seat **read on your
bidding** that it voices at the table. It gets smarter about *you*, without ever
degrading its normal play.

## Phones, tablets and browsers

The layout adapts to the screen rather than just shrinking:

- **Phones (portrait):** opponents sit in a row across the top, the score lives
  in the header with a ☰ menu, the table is sized to fit the screen with the
  bid panel visible, and your hand fans to fit any width. When you pick up the
  kitty, the 18 cards fan into two rows so every card is easy to tap.
- **Phones sideways:** table on the left, controls in a column on the right.
- **Tablets / laptops:** the classic table; on shorter screens the cards scale
  down so the action bar never falls below the fold.
- **Touch-friendly:** instant taps (no double-tap zoom delay), no "sticky"
  hover on touch screens, 16px text fields so iPhone Safari doesn't zoom in,
  iPhone notch/home-bar safe areas, and dialogs that scroll on small screens.
- **Sharing on phones:** the lobby's **Share invite** button opens the native
  share sheet (Messages, WhatsApp, …).
- **Avatars on every device:** cartoon avatars are drawn live with each
  device's own color-emoji font (Apple, Samsung, Google, Windows), not baked
  into an image, so they always appear.

Layout-checked (in Chromium's device emulation) on iPhone SE, iPhone 14 Pro
Max, Galaxy S8, Galaxy S9+, Pixel 7, iPad Mini, Galaxy Tab S4, iPad Pro
(landscape), a phone in landscape, and a 1366×768 laptop: no sideways
scrolling, nothing off-screen, no overlapping seats, controls on screen. It
uses only widely supported web features (with fallbacks, e.g. `vh` behind
`dvh`), targeting current Safari (iOS/iPadOS/macOS), Chrome, Edge, Firefox and
Samsung Internet.

## The game

Bid Whist is the classic African-American partnership trick-taking game: four
players in fixed partnerships, a 54-card deck (52 cards plus both jokers),
12 cards each, and a 6-card **kitty**. Twelve tricks (*books*) plus the kitty
makes **13 books** per hand.

- **The auction.** Starting left of the dealer, each player gets one call:
  pass, or bid a number **3–7** — just the number — or that number
  **No-Trump** ("four no"). A bid promises *six plus the bid* books: bid 4
  means 10 books. A four is a four: to beat it, bid five, or four No-Trump.
  If the first three players pass, the dealer is stuck with a minimum bid.
- **The kitty.** Whoever bids highest takes all six kitty cards, *then* names
  trump and picks **Uptown** (high cards win) or **Downtown** (A, 2, 3 … K —
  after the ace, low wins); a No-Trump winner just picks the direction. Then
  they bury six — and the buried book counts as the bidding team's first book.
  You're bidding on your hand alone, guessing at the kitty and what the others
  hold.
- **The play.** The bidder leads. Follow suit if you can. The Big and Little
  Jokers are the top two trumps. In No-Trump the jokers are throw-offs: they
  can never win a book, can't be led (unless they're all you have left), and
  only fall when you're void of the led suit.
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
| Play without jokers (52 cards, 4-card kitty) | off |
| No-Trump bids start at 4 | off |
| First lead: the high bidder, or left of the dealer | bidder |
| Renege can be called (follow-suit not enforced; 3 books to the callers) | off |
| Computer players: Easy / Regular / Sharp | Regular |
| Turn timer online (a bot moves for an idle player) | off |

Online, the **host** sets the rules for the table (between hands); everyone
else sees them read-only. Under the renege rule any card may be played; any
player can tap **Call renege**, and bots call one as soon as it's proven (or
at the count). Each upheld renege moves 3 books to the other team.

Without the renege rule, the app enforces follow-suit, so illegal plays are
impossible rather than penalized.

## Code layout

```
index.html          app shell (table, lobby, modals) + link-preview meta
manifest.webmanifest home-screen app name/icons
img/                link-preview card and app icons
styles.css          the whole look — felt, mahogany, gold, cream card stock
js/engine.js        pure rules engine (deck, bids, ranking, tricks, scoring)
js/ai.js            heuristic AI (Easy / Regular / Sharp) + session learner
js/room-core.js     the game itself: authoritative state machine — runs on the
                    server for online play AND in the browser for solo
js/net.js           WebSocket transport for online play
js/qrcode.js        self-contained QR generator for invite links
js/app.js           game flow, DOM rendering, and the online controller
server/worker.js    Worker entry (/api/*) + GameRoom Durable Object (+ turn-timer alarm)
sw.js               service worker: offline solo + installable app
wrangler.toml       the one Worker: static site + server + Durable Object
.assetsignore       keeps server code, tests and docs out of public assets
tests/              engine tests, AI-vs-AI simulator, room-core tests
```

`engine.js`, `ai.js`, and `room-core.js` are dependency-free and load in both
the browser and Node. Solo and online run the *same* room code — solo just
talks to it in-page instead of over a socket — so the exact code every game
runs is what the tests exercise:

```sh
node tests/engine.test.js    # rules invariants
node tests/simulate.js 400   # paired AI sim: learner is harmless + responsive
node tests/levels.js 3000    # paired AI sim: Sharp > Regular > Easy
node tests/room.test.js      # authoritative room: turns, card hiding, isolation
node tests/qrcode.test.js    # QR encoder: RS syndromes + structure
```

Key engine formulas: a contract needs `6 + bid` books; defenders set it at
`13 − (6 + bid) + 1 = 8 − bid` books.
