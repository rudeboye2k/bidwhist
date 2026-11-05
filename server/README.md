# Bid Whist online backend (Cloudflare Workers + Durable Objects)

Authoritative multiplayer server. Each game room is one **Durable Object**
instance keyed by its join code, so rooms are fully isolated — Game 1 (A/B/C/D)
and Game 2 (AA/BB/CC/DD) never share state or sockets. Empty seats are filled by
the same AI the solo game uses.

## How it fits together

```
worker.js         Worker entry: HTTP routes + WebSocket upgrade → Durable Object
  └ GameRoom      one Durable Object per join code (idFromName(code))
room-core.js      authoritative game state machine (unit-tested in Node)
../js/engine.js   shared rules engine (same code the browser runs)
../js/ai.js       shared AI + session learner
```

`room-core.js` is where the game actually lives — turn validation, AI auto-fill,
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
`WS /api/room/:code/ws` (join that room). Everything else is a static file;
`.assetsignore` keeps `server/`, `tests/` and docs out of the public assets.

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
| `{type:'intent', intent}` | a move: `{type:'bid'\|'declare'\|'discard'\|'play', ...}` |
| `{type:'profile', name?, avatar?}` | update your display name / avatar mid-session |
| `{type:'team', team}` | lobby only — move to Team A (`0`) or B (`1`); this picks your partner |
| `{type:'teamName', team, name}` | team captain only (first player on the team) — rename it (≤ 18 chars) |
| `{type:'leave'}` | give up your seat — mid-game a bot takes it for good and plays at once |

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
| `{type:'welcome', token, seat, host}` | your identity (persist `token` to reconnect) |
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
