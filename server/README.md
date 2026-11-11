# Bid Whist online backend (Cloudflare Workers + Durable Objects)

Authoritative multiplayer server. Each game room is one **Durable Object**
instance keyed by its join code, so rooms are fully isolated — Game 1 (A/B/C/D)
and Game 2 (AA/BB/CC/DD) never share state or sockets. Empty seats are filled by
the same AI the solo game uses.

## How it fits together

```
worker.js         Worker entry: HTTP routes + WebSocket upgrade → Durable Object
  └ GameRoom      one Durable Object per join code (idFromName(code))
../js/room-core.js authoritative game state machine (unit-tested in Node;
                  the browser runs it too, for solo play)
../js/engine.js   shared rules engine (same code the browser runs)
../js/ai.js       shared AI + session learner
```

`js/room-core.js` is where the game actually lives — turn validation, AI auto-fill,
per-player card hiding, scoring. It has no Cloudflare or socket dependencies and
is covered by `../tests/room.test.js`. The Worker is just transport.

## Deploy

There's one Worker for the whole game — `wrangler.toml` lives at the **repo
root**, and it serves the static site *and* routes `/api/*` here. Cloudflare's
GitHub integration (Workers Builds) deploys it automatically on every push to
`main`; nothing to run by hand. It fits the **Workers Free plan**: the Durable
Object uses the SQLite storage backend (`new_sqlite_classes`), which is
free-tier eligible.

Manual deploy, if you ever need it (from the repo root):

```sh
npx wrangler login
npx wrangler deploy
```

Because the site and the server share an origin, the client simply uses the
page's own address — there's no server URL to configure. (Only if you host the
page elsewhere, e.g. GitHub Pages, set `window.BIDWHIST_SERVER` in `index.html`
to the Worker's URL.)

Routes: `POST /api/new` (mint a game key), `GET /api/health` (liveness),
`WS /api/room/:code/ws` (join that room), `GET|POST /api/daily/:date` (the
Daily Deal leaderboard). Everything else is a static file;
`.assetsignore` keeps `server/`, `tests/` and docs out of the public assets.

The page (`/`, `/index.html`) and `sw.js` go through the Worker first
(`run_worker_first`): it swaps their `__V__` tokens for the deploy's version id
(`version_metadata` binding), so script URLs and the offline cache change on
every deploy by themselves.

## Daily Deal

`DailyBoard` is one Durable Object per date (UTC; only yesterday/today/tomorrow
are accepted). A client posts its device id, name, avatar and the list of moves
it made; the board replays them on that day's deal (`RoomCore.replayDaily`:
the date's seed, default rules, fresh bots — fully deterministic) and stores the
real score, once per device. Boards delete themselves a week later (alarm).

## Idle tables

Every save records when the table last changed. The same alarm used by the
turn timer is also set a week past that; if it fires and nobody is connected,
the room's storage is deleted (the game key then starts a fresh table).

## Turn timer

With the host's turn timer on, the room records a deadline whenever a person
is up; the Durable Object keeps one **alarm** set to it. If the alarm fires
and the same player is still on the clock, a bot makes that one move for them
(`Room.timeout()`), and the clock re-arms for whoever is next. Views carry
`turnMsLeft` so clients can show the countdown.

## Durability

Cloudflare can evict an idle room from memory between moves (WebSocket
hibernation, deploys) while players' sockets stay open. So `GameRoom` saves the
whole room to Durable Object storage after every change and restores it on wake
(`Room.toJSON` / `Room.fromJSON`), and each socket's player token is stored on
the socket itself (`serializeAttachment`). Verified by killing the server
mid-trick and reconnecting: both players reclaim their seats and play resumes
exactly where it left off.

## Protocol (WebSocket, JSON)

Client → server:

| message | meaning |
|---|---|
| `{type:'hello', name, avatar?, token?}` | join a seat (with a name + optional avatar), or reclaim one with a saved token |
| `{type:'start'}` | host only — fill empty seats with AI and deal |
| `{type:'nextHand'}` | host only — deal the next hand after one ends |
| `{type:'intent', intent}` | a move: `{type:'bid'\|'declare'\|'discard'\|'play', ...}` — a bid is `{amount, type:'suit'\|'notrump'}`; after the auction the high bidder already holds the kitty and declares `{trump, direction}` (No-Trump: `{direction}`) |
| `{type:'profile', name?, avatar?}` | update your display name / avatar mid-session |
| `{type:'team', team}` | lobby only — move to Team A (`0`) or B (`1`); this picks your partner |
| `{type:'teamName', team, name}` | team captain only (first player on the team) — rename it (≤ 18 chars) |
| `{type:'seatSwap', a, b}` | host, lobby only — swap seats `a` and `b` (players, bots or open seats) |
| `{type:'addBot', seat}` / `{type:'kickBot', seat}` | host, lobby only — put a bot in an open seat / remove one |
| `{type:'toLobby'}` | host, after a game — reopen the lobby (seats kept, scores reset) |
| `{type:'leave'}` | give up your seat — mid-game a bot takes it for good and plays at once |
| `{type:'say', text}` | a typed message (plain text, ≤ 60 chars, markup stripped; shares the reaction pace limit) |
| `{type:'react', id}` | pop a quick reaction over your seat (`Engine.REACTIONS[id]`; ~1 per 1.2 s) |
| `{type:'rules', rules}` | host only, between hands — set the house rules (cleaned by `Engine.cleanRules`) |
| `{type:'renege'}` | renege rule only, during play — call a renege on the other team |
| `{type:'hello', watch:true}` / `{type:'sit'}` | come in as a watcher (also automatic when the table is full) / take an open or bot seat |

A dropped connection (no `leave`) also hands the seat to a bot immediately,
including a turn in progress, but the player can reclaim it with their token.
If the host is away, host powers (start / deal next hand) pass to the next
connected player. Names and team names have `<` `>` stripped server-side.

`avatar` is either a cartoon code `cartoon:E.P` (animal index, color index —
each client draws it with its own emoji font, so it works on every device) or a
small JPEG/PNG/WebP photo data URL (≤ 40 KB). Anything else is ignored and that
player falls back to a name-derived cartoon on each client.

Server → client:

| message | meaning |
|---|---|
| `{type:'welcome', token, seat, host, watcher?}` | your identity (persist `token` to reconnect); `watcher:true` with no token means you're watching |
| `{type:'state', view, events}` | your tailored snapshot + events to animate |
| `{type:'error', error}` | rejected action (illegal move, not your turn, …) |

`view` only ever contains **your** hand; everyone else is a card count. Every
intent is re-validated against the engine server-side, so a tampered client
can't make an illegal bid or play.

## Local dev

```sh
npx wrangler dev            # from the repo root: site + Worker + DO, locally
```

Open the printed `http://localhost:8787` — that's the game, already wired to
the local server.
