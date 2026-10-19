# Crown & Cobblestone

A browser-based, 2–4 player medieval settlement-building game. It uses Node.js, Express, Socket.IO, Three.js and Tone.js. All board art, terrain details, pieces, dice, resource models and music are generated in the browser; no paid asset pack or external image download is required.

## Run it

1. Install Node.js 18 or newer.
2. Extract this folder from the ZIP.
3. Open a terminal in the extracted `crown-and-cobblestone` folder.
4. Run `npm install` and then `npm start`.
5. Open [http://localhost:3000](http://localhost:3000), create a table, and share its four-character code.

The server listens on port 3000 by default. Set the `PORT` environment variable to use another port. For internet play, host the Node server behind HTTPS and allow WebSocket upgrades through your reverse proxy. For play on a local network, other players can open the host computer's LAN address on port 3000.

Rooms and games live in server memory. Restarting the server closes active tables. A browser-session token allows a player to reconnect to the same room while the server remains running. There is no account system or database.

## Play

- Create a table and share the room code. The host can start once a second player joins; tables support up to four players.
- Founding takes place in two passes. Place a settlement and its connecting road each time. The second settlement grants resources from adjacent lands.
- On each turn, roll two dice, collect production, then build, trade, play a development card or end the turn.
- Select Road, Settlement or City in the action panel, then click one of the highlighted 3D crossroads or road edges.
- Trade resources with the bank, use a discovered 3:1 or matching 2:1 harbor, or click another player's row to offer a private trade.
- If a seven is rolled, players holding more than seven cards choose half to discard; then the active player moves the robber and may steal from an adjacent rival.
- Reach 10 victory points on your turn to claim the crown.
- Turn on the music with the music button. Browsers require a click before they allow audio playback.

The game includes the classic five-resource economy, settlements and city upgrades, roads and distance rules, randomized hexes and number tokens, maritime and player trades, the robber and discards, development cards (Knights, Victory Points, Road Building, Year of Plenty and Monopoly), Largest Army, Longest Road, turn order, private hands and a 10-point victory condition. The implementation focuses on the core 2–4 player base-game loop; it does not include separate expansion rule sets or scenarios.

## Project files

- `server.js` — authoritative room state, rules, turn validation and Socket.IO events.
- `public/index.html` — lobby and game interface.
- `public/style.css` — responsive medieval parchment and dark-wood styling.
- `public/client.js` — Three.js board, generated models, interaction, and Tone.js music.
- `package.json` — Node.js dependencies and start command.

This is an original, unofficial project. It uses no official board-game art, logos, card text or sound recordings and is not affiliated with or endorsed by the makers of CATAN.
