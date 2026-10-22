# Hexlands Online

Server-authoritative multiplayer version of Hexlands (Node.js + WebSockets).

## Run
    npm install
    npm start          # http://localhost:3000   (PORT env var to change)

Open the page, enter a name, **Create room**, and share the 4-letter code. Friends open the same
address and **Join**. In room setup, each player can choose a 2D or 3D board view for their own
device. The host sets seats to Open / Bot / Closed, the map, victory-point target and other room
options. Every human player, including the host, must click **I’m ready** before the host can start;
there must also be at least three human or bot players. Changing room settings clears readiness.
During a game, open **Menu** to switch board view or open **Controls**. Refreshing the page reconnects
you to your seat.

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

## Maps and 5-6 players
- The host picks a map in the lobby: **Standard**, **British Isles**, **USA**, **Four Islands** or **Random archipelago**.
  Games with 5-6 players automatically get a larger version of the chosen map (Standard becomes the 30-hex frame; shaped maps grow
  to ~55-70 hexes), more resources in the bank (24 each) and a bigger development deck (34 cards).
- Seats go up to 6 (set seats 5 and 6 to Open or Bot in the lobby). Starting still needs at least 3 players.
- **Islands and ferries:** where a map has separate islands, dotted *sea routes* link nearby coasts. A sea route is built like a road
  (brick + wood), counts for settlement connection and for Longest Road, and cannot be used for the very first setup road.
- Port density follows the coastline; resource and number-token counts scale with the map size.

## "I'm back"
If a bot is playing for you (timeout or after reconnecting), a banner with an **I'm back** button appears; pressing it hands control back immediately.

## Colors and board zoom
- Pick your color from a 12-color palette in the lobby. Only colors held by other *human* players are grayed out. If you pick a color a bot is using, the bot is switched to a random free color,
  so every active seat always ends up with a unique color.
- Board zoom: **+** / **-** / reset buttons at the bottom right of the board, the mouse wheel (zooms toward the cursor), and drag to pan.

## Timers with a single human
Dice and turn timers (and AFK takeover) only run while **two or more humans** are in the game. If one human is playing against bots, no timer is shown or enforced.

## Host pause, board balance, discard fix
- **Host pause:** the host sees a *Pause game for all* button over the board. While paused, bots, timers and every action are frozen
  and everyone sees a pause screen; resuming restores each timer exactly where it stopped. If the host leaves (or is offline for a minute) the game resumes automatically.
- **Balanced boards:** resources and number tokens are placed by scoring many random deals and then improving the best one with swaps.
  It penalizes same-resource neighbors, adjacent 6/8s, equal neighboring numbers, resources holding several 6/8s, and uneven total dice odds per resource.
- **Discard bug (resources turning `null`):** the cause was a discard request with zero-count resources dropped, which the engine then subtracted as `undefined` (NaN).
  Discards are now zero-filled and validated, and a server-side check (`__heal`) repairs any non-numeric count; hands + bank always sum to the starting supply.
- **Changelog:** the button at the bottom right of the start screen replaces the build tag. Edit `CHANGES` in `public/index.html` to add entries.

## Update 1 (build i)
- **Chat** under the timer in the left panel (Enter to send; 200 characters; rate-limited to 5 messages per 8 s; last 60 kept server-side and replayed on reconnect).
- **AFK freeze fixed:** a player who opened Build > Settlement/City/Road and then went AFK left the turn in a mode the bot could not handle, so the bot spun forever.
  The takeover now cancels the half-finished action first, and a server watchdog skips any bot-controlled turn that makes no progress for 30 s.
- **Connection robustness:** server heartbeat (5 s) and protocol pings (20 s); the page detects silent drops (12 s without traffic), shows a reconnecting banner and rejoins.
  If the server restarted and the room is gone, the page says so and offers a button back to the lobby (Render's free tier sleeps after ~15 min of no HTTP traffic and loses in-memory rooms).
- **Dice:** verified fair (see changelog); no code change needed.
- Your personal **Pause** button is now **Menu**; the host's *Pause game for all* is unchanged.


## 3D board, music and bot options

Choose 2D or 3D board view on the starting screen; the selection is saved locally for each player. The 3D board uses Three.js for raised, textured hexes, terrain details, ports, roads, settlements, cities, the robber and detailed animated dice. Bright green rings mark settlement sites, gold segments mark road sites, and cyan rings mark city upgrades. Drag with the left mouse button to orbit and tilt; right-drag or Shift+left-drag pans; the wheel zooms. The reset control returns to a top-down view. Tone.js provides the locally loaded orchestral soundtrack, including plucked strings, recorder, sustained pipes, choir, low strings, brass and percussion.

In the room lobby, the host can enable occasional bot chat lines. Bot speakers rotate among the bots, with expanded medieval-flavored responses for building, robber moves, trades, rolls and other moments. When a robber hex contains multiple opponents with cards, the active player chooses the victim. Bot robber placement varies among similarly valuable hexes, and bots become slightly more cautious about trades as an offerer approaches the victory target.

Run npm install before npm start; Three.js and Tone.js are regular package dependencies and the server serves their browser modules locally.
