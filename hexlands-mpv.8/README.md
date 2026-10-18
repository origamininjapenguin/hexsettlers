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
- A host can send `{t:'botify',seat:N}` to replace a disconnected player with a bot (no button yet).
- `vm` is not a security sandbox; the engine script is trusted code from `public/index.html`.

## Deploying on Render (checklist)
1. The repo root must contain `package.json`, `server.js`, `engine-shim.js` and `public/index.html`.
   If you pushed the unzipped `hexlands-mp/` folder *inside* a repo, set **Root Directory** to `hexlands-mp` in Render (or move the files up).
2. Service type **Web Service**, runtime **Node**, Build Command `npm install`, Start Command `npm start`.
3. Do not use `npm ci` unless you committed a `package-lock.json` (run `npm install` locally once and commit the lockfile).
4. Health check path: `/healthz`. Render supplies `PORT`; the server listens on it automatically.
5. If the deploy log shows `STARTUP CHECK FAILED`, a file is missing or `public/index.html` is not the one from this project.

## Lobby options, timers and rooms
- **Public / private:** the host can list a room as public. Public rooms that still have an open seat show up in the
  "Public rooms" panel on the start screen, with a search box (host name or code). Private rooms are join-by-code only.
- **Timers (host sets them in the lobby, 0 = off):**
  - *Dice / quick-action timer* – rolling, discarding, moving the robber, answering trade offers (default 30 s).
  - *Turn timer* – the rest of a turn and each setup placement (default 90 s).
  - When a timer runs out, a prompt is auto-resolved (offers declined, random discard) or a bot finishes the turn.
    Three timeouts in a row replace that player with a bot. The countdown shows at the top of the screen.
- **Counter offers:** when someone offers you a trade you can Accept, Decline or Counter with your own bundle.

## Leaving and bots
- Close the tab or press **Leave game** in the menu: after ~5 seconds offline (or immediately on Leave) that seat is played by a bot
  whenever it is their turn, and any trade/discard prompt aimed at them is answered automatically. Bots only ever act on
  their own seat's turn. Refreshing within a few seconds reconnects you normally.
