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

Durable Objects need the **Workers Paid** plan (~$5/mo).

```sh
cd server
npx wrangler login          # once
npx wrangler deploy         # bundles worker.js (esbuild) + creates the DO
```

Deploy prints your Worker URL, e.g. `https://bidwhist-server.<subdomain>.workers.dev`.

## Point the game at it

In the deployed game, open **Play Online** and paste that Worker URL (it's saved
in your browser). Or hard-wire it by setting `window.BIDWHIST_SERVER` before
`js/net.js` loads. With no server configured, the game still runs fully in local
(vs-computer) mode.

## Protocol (WebSocket, JSON)

Client → server:

| message | meaning |
|---|---|
| `{type:'hello', name, token?}` | join a seat, or reclaim one with a saved token |
| `{type:'start'}` | host only — fill empty seats with AI and deal |
| `{type:'nextHand'}` | host only — deal the next hand after one ends |
| `{type:'intent', intent}` | a move: `{type:'bid'\|'declare'\|'discard'\|'play', ...}` |
| `{type:'leave'}` | give up your seat |

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
cd server
npx wrangler dev            # runs the Worker + DO locally with Miniflare
```

Then point the game at the printed `http://localhost:8787`.
