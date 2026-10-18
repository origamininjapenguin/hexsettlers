# Hexlands Online

Server-authoritative multiplayer version of Hexlands (Node.js + WebSockets).

## Run
    npm install
    npm start          # http://localhost:3000   (PORT env var to change)

Open the page, enter a name, **Create room**, and share the 4-letter code. Friends open the same
address and **Join**. The host sets seats to Open / Bot / Closed, the victory-point target and the
desert option, then presses **Start** (3 or 4 players, bots can fill seats). Refreshing the page
reconnects you to your seat.

## How it works
- `server.js` – HTTP + WebSocket server, rooms/lobbies, seat tokens for reconnecting.
- `public/index.html` – the browser client. It is the same game file as before (rendering, music,
  sound effects, animations) plus a multiplayer layer at the bottom that sends actions and redraws from snapshots.
- `engine-shim.js` – appended to the *same game script* and run headless in a `vm` context per room.
  So the rules live in exactly one place, and the server is the only thing that rolls dice, shuffles
  and sees every hand. Each client only receives its own cards (others show as counts).

## Deploying
Any Node host (Render, Railway, Fly.io, a VPS). Serve over HTTPS so the client uses `wss://`
automatically. Run a single instance (rooms live in memory).

## Known limits
- Rooms are in memory; a restart ends all games. Idle rooms are removed after 30 minutes.
- Human-to-human counter-offers are not in this version (accept/decline only; bots may counter to humans).
- A host can send `{t:'botify',seat:N}` to replace a disconnected player with a bot (no button yet).
- `vm` is not a security sandbox; the engine script is trusted code from `public/index.html`.
