# Puzzle Attack relay server

Lobby codes and input relay for online play. The server never runs the game. It seats two players in a room,
picks the shared seed, and forwards each player's inputs. Both clients run the same deterministic sim.

## Try it locally (no accounts, no installs)

    node dev/node_server.mjs 8787

Open the game page (`public/index.html`) in two browser windows. The Online panel defaults to `http://localhost:8787`.
Host a game in one window, type the code into the other, pick modes, press Ready in both.

## Deploy to Cloudflare (free plan)

1. Create a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. In this folder: `npm install`, then `npx wrangler login` (opens a browser to authorize).
3. `npx wrangler deploy`. It prints a URL like `https://puzzle-attack.YOURNAME.workers.dev`.
4. Open that URL. It is the game page itself (served from `public/index.html`), and its Online panel already points at the same address.
   To update the game later, replace `public/index.html` and run `npx wrangler deploy` again.

The free plan only allows SQLite-backed Durable Objects. `wrangler.toml` already declares the class that way.

Pages served over https must use an https server URL (workers.dev is https). `http://localhost` is allowed from https pages.

## Protocol (all JSON text frames)

Client to server: `pick`/`ready` {mode, ch}, `b` {f, m[]} input batch, `h` {f, a, b} state hashes, `p`/`q` ping and echo.
Server to client: `welcome` {slot}, `room` {players[]}, `start` {seed, n, modes[], chars[]}, `left`, `error` {reason}.
`b`, `h`, `p`, `q` are forwarded to the other player untouched. The text `ping` is answered with `pong` without waking the room.

## Limits and cleanup

Rooms hold two players. An unused room is deleted after an hour, an emptied one after ten minutes (Durable Object alarm).
Set `ALLOWED_ORIGIN` in `wrangler.toml` to restrict who may call `/create` from a browser.
There is no rate limiting yet. Add one before a public launch.

## Tests

`node tests/nettest.js` in the prototype project runs the room logic, the Durable Object class against a mock runtime,
and two real page instances playing through this server with injected lag. The mock cannot catch every difference from
the real Cloudflare runtime, so run one real match through the deployed Worker before trusting it.
