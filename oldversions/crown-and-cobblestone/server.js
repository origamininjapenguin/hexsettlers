'use strict';

const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Crown & Cobblestone' }));

const rooms = new Map();
const TYPES = ['lumber', 'wool', 'grain', 'brick', 'ore'];
const COSTS = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  development: { wool: 1, grain: 1, ore: 1 }
};
const TERRAIN = {
  forest: 'lumber', pasture: 'wool', fields: 'grain', hills: 'brick', mountains: 'ore', desert: null
};
const RESOURCE_COUNTS = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 };
const TOKEN_NUMBERS = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
const PLAYER_COLORS = ['#c85e3d', '#3c89a8', '#d0a23d', '#719353'];

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function makeBoard() {
  const HEX = 1.08;
  const coords = [];
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) coords.push([q, r]);
  const terrainDeck = shuffle(Object.entries(RESOURCE_COUNTS).flatMap(([terrain, count]) => Array(count).fill(terrain)));
  const numberDeck = shuffle(TOKEN_NUMBERS);
  const nodes = [], nodeMap = new Map(), edges = [], edgeMap = new Map();
  const hexes = coords.map(([q, r], i) => {
    const x = Math.sqrt(3) * HEX * (q + r / 2), z = 1.5 * HEX * r;
    const terrain = terrainDeck[i];
    const corners = Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (30 + 60 * k);
      return [+(x + HEX * Math.cos(a)).toFixed(4), +(z + HEX * Math.sin(a)).toFixed(4)];
    });
    const vertexIds = corners.map(([nx, nz]) => {
      const key = `${nx.toFixed(3)},${nz.toFixed(3)}`;
      if (!nodeMap.has(key)) { const id = nodes.length; nodeMap.set(key, id); nodes.push({ id, x: nx, z: nz, hexes: [], edges: [] }); }
      const n = nodeMap.get(key); nodes[n].hexes.push(i); return n;
    });
    for (let k = 0; k < 6; k++) {
      const a = vertexIds[k], b = vertexIds[(k + 1) % 6], key = [a,b].sort((x,y) => x-y).join('-');
      let edgeId = edgeMap.get(key);
      if (edgeId === undefined) { edgeId = edges.length; edgeMap.set(key, edgeId); edges.push({ id: edgeId, a, b, hexes: [] }); nodes[a].edges.push(edgeId); nodes[b].edges.push(edgeId); }
      edges[edgeId].hexes.push(i);
    }
    return { id: i, q, r, x, z, terrain, resource: TERRAIN[terrain], number: terrain === 'desert' ? null : numberDeck.pop(), nodes: vertexIds };
  });
  const coast = shuffle(edges.filter(e => e.hexes.length === 1).map(e => e.id)).slice(0, 9);
  const harborDeck = shuffle([
    { resource: null, rate: 3 }, { resource: null, rate: 3 }, { resource: null, rate: 3 }, { resource: null, rate: 3 },
    ...TYPES.map(resource => ({ resource, rate: 2 }))
  ]);
  const harbors = coast.map((edgeId, i) => ({ edge: edgeId, ...harborDeck[i] }));
  return { hexes, nodes, edges, harbors, robber: hexes.find(h => h.terrain === 'desert').id };
}
function newPlayer(id, socketId, name, index) {
  return { id, socketId, name, color: PLAYER_COLORS[index], connected: true, resources: Object.fromEntries(TYPES.map(t => [t, 0])), roads: [], buildings: {}, devCards: [], boughtThisTurn: [], knights: 0, revealedVP: 0, longestRoad: 0 };
}
function makeDeck() { return shuffle([...Array(14).fill('knight'), ...Array(5).fill('victory'), ...Array(2).fill('roadBuilding'), ...Array(2).fill('plenty'), ...Array(2).fill('monopoly')]); }
function sanitizeName(name) { return String(name || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18) || 'Traveler'; }
function playerBySocket(room, socketId) { return room.players.find(p => p.socketId === socketId); }
function activePlayer(room) { return room.players[room.turnIndex]; }
function adjacentNodes(room, edgeId) { const e = room.board.edges[edgeId]; return e ? [e.a, e.b] : []; }
function connectedToPlayer(room, player, nodeId) {
  return room.board.nodes[nodeId].edges.some(eid => player.roads.includes(eid));
}
function hasSettlementNear(room, nodeId) {
  return room.board.nodes[nodeId].edges.some(eid => {
    const e = room.board.edges[eid], other = e.a === nodeId ? e.b : e.a;
    return Boolean(room.players.find(p => p.buildings[other]));
  });
}
function canBuildRoad(room, player, edgeId, free = false) {
  const e = room.board.edges[edgeId];
  if (!e || player.roads.length >= 15 || player.roads.includes(edgeId)) return false;
  const touches = [e.a, e.b].some(n => {
    if (player.buildings[n]) return true;
    const owner = room.players.find(p => p.buildings[n]);
    return !owner && connectedToPlayer(room, player, n);
  });
  return touches && (free || canAfford(player, COSTS.road));
}
function canAfford(player, cost) { return Object.entries(cost).every(([t, n]) => player.resources[t] >= n); }
function spend(player, cost) { for (const [t, n] of Object.entries(cost)) player.resources[t] -= n; }
function add(player, resource, count = 1) { if (TYPES.includes(resource)) player.resources[resource] += count; }
function roadLength(room, player) {
  let best = 0;
  const used = new Set();
  const walk = (node, length) => {
    best = Math.max(best, length);
    if (length >= player.roads.length) return;
    if (room.players.some(p => p !== player && p.buildings[node])) return;
    for (const eid of room.board.nodes[node].edges) if (player.roads.includes(eid) && !used.has(eid)) {
      used.add(eid); const e = room.board.edges[eid]; walk(e.a === node ? e.b : e.a, length + 1); used.delete(eid);
    }
  };
  for (const eid of player.roads) { const e = room.board.edges[eid]; walk(e.a, 0); walk(e.b, 0); }
  return best;
}
function updateAwards(room) {
  for (const p of room.players) p.longestRoad = roadLength(room, p);
  const maxRoad = Math.max(...room.players.map(p => p.longestRoad));
  const roadLeaders = room.players.filter(p => p.longestRoad === maxRoad && maxRoad >= 5);
  if (room.awards.longestRoad && roadLeaders.some(p => p.id === room.awards.longestRoad)) { /* retain tied holder */ }
  else room.awards.longestRoad = roadLeaders.length === 1 ? roadLeaders[0].id : null;
  const maxArmy = Math.max(...room.players.map(p => p.knights));
  const armyLeaders = room.players.filter(p => p.knights === maxArmy && maxArmy >= 3);
  if (room.awards.largestArmy && armyLeaders.some(p => p.id === room.awards.largestArmy)) { /* retain tied holder */ }
  else room.awards.largestArmy = armyLeaders.length === 1 ? armyLeaders[0].id : null;
}
function score(room, p, reveal = false) {
  let points = p.revealedVP + Object.values(p.buildings).reduce((n, b) => n + (b === 'city' ? 2 : 1), 0);
  if (room.awards.longestRoad === p.id) points += 2;
  if (room.awards.largestArmy === p.id) points += 2;
  if (reveal) points += p.devCards.filter(c => c.type === 'victory').length;
  return points;
}
function checkWinner(room) {
  updateAwards(room);
  const winner = room.players.find(p => score(room, p, true) >= 10 && activePlayer(room)?.id === p.id);
  if (winner) { room.phase = 'finished'; room.winnerId = winner.id; room.log.unshift(`${winner.name} has claimed the crown!`); }
}
function publicGame(room, viewerId) {
  const game = room.game;
  if (!game) return null;
  return {
    board: room.board, phase: room.phase, activeId: activePlayer(room)?.id, setupIndex: room.setupIndex,
    setupRound: room.setupRound, setupAction: room.setupAction, turn: room.turn, roll: room.roll,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected,
      resources: p.id === viewerId || room.phase === 'finished' ? p.resources : null,
      resourceCount: Object.values(p.resources).reduce((a,b) => a+b, 0),
      devCards: p.id === viewerId || room.phase === 'finished' ? p.devCards : null,
      devCount: p.devCards.length, roads: p.roads, buildings: p.buildings, knights: p.knights,
      score: score(room, p, room.phase === 'finished'), longestRoad: p.longestRoad })),
    awards: room.awards, winnerId: room.winnerId, deckCount: room.deck.length,
    log: room.log.slice(0, 8), robber: room.board.robber, pendingDiscards: room.pendingDiscards,
    tradeOffer: room.tradeOffer, freeRoadsLeft: room.freeRoadsLeft || 0, freeRoadsPlaced: room.freeRoadsPlaced || 0,
    mustDiscard: room.pendingDiscards.includes(viewerId), canMoveRobber: room.phase === 'robber' && activePlayer(room)?.id === viewerId
  };
}
function emitRoom(room) {
  for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('gameState', { code: room.code, hostId: room.hostId, players: lobbyPlayers(room), game: publicGame(room, p.id) });
}
function lobbyPlayers(room) { return room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })); }
function log(room, message) { room.log.unshift(message); room.log = room.log.slice(0, 16); }
function fail(socket, message) { socket.emit('notice', { kind: 'error', message }); }
function locate(socket) { const code = socket.data.roomCode; const room = rooms.get(code); const player = room && playerBySocket(room, socket.id); return room && player ? { room, player } : null; }
function checkTurn(room, player) { return room.game && activePlayer(room)?.id === player.id; }
function advanceSetup(room) {
  room.setupAction = room.setupAction === 'settlement' ? 'road' : 'settlement';
  if (room.setupAction === 'settlement') {
    room.setupIndex++;
    if (room.setupIndex >= room.setupOrder.length) {
      room.setupRound++;
      if (room.setupRound === 2) { room.phase = 'main'; room.turnIndex = 0; room.turn = 1; room.roll = null; log(room, 'The settlement is founded. Roll the dice to begin.'); return; }
      room.setupOrder.reverse(); room.setupIndex = 0;
    }
  }
}
function produce(room, result) {
  const paid = [];
  for (const h of room.board.hexes) if (h.number === result && h.id !== room.board.robber) {
    for (const n of h.nodes) for (const p of room.players) {
      const b = p.buildings[n]; if (b) { const count = b === 'city' ? 2 : 1; add(p, h.resource, count); paid.push(`${p.name} +${count} ${h.resource}`); }
    }
  }
  log(room, paid.length ? `A ${result} harvests ${paid.join(' · ')}.` : `The dice show ${result}; no harvest this round.`);
}
function continueAfterDiscards(room) {
  if (!room.pendingDiscards.length) { room.phase = 'robber'; log(room, 'The robber must move to a new land.'); }
}
function endTurn(room) {
  room.tradeOffer = null;
  if (room.phase === 'finished') return;
  for (const p of room.players) p.boughtThisTurn = [];
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turn++;
  room.phase = 'main'; room.roll = null; room.devPlayed = false;
  log(room, `${activePlayer(room).name} takes the watch.`);
}

io.on('connection', socket => {
  socket.on('joinRoom', ({ name, code, reconnectToken } = {}) => {
    const cleanName = sanitizeName(name);
    let room;
    if (code) room = rooms.get(String(code).trim().toUpperCase());
    if (room && reconnectToken) {
      const returning = room.players.find(p => p.reconnectToken === reconnectToken);
      if (returning) {
        returning.socketId = socket.id; returning.connected = true; socket.data.roomCode = room.code; socket.join(room.code);
        socket.emit('joined', { code: room.code, playerId: returning.id, hostId: room.hostId, reconnectToken: returning.reconnectToken });
        log(room, `${returning.name} returns to the table.`); emitRoom(room); return;
      }
    }
    else {
      const roomCode = Math.random().toString(36).slice(2, 6).toUpperCase();
      room = { code: roomCode, hostId: null, players: [], game: null, log: [], phase: 'lobby', awards: { longestRoad: null, largestArmy: null }, tradeOffer: null };
      rooms.set(roomCode, room);
    }
    if (!room) return fail(socket, 'That room code was not found. Create a new table or check the code.');
    if (room.game) return fail(socket, 'This table has already started. A player can return using their saved browser session.');
    if (room.players.length >= 4) return fail(socket, 'This table is full (4 players maximum).');
    if (room.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase() && p.connected)) return fail(socket, 'That name is already at this table.');
    const player = newPlayer(`p-${Math.random().toString(36).slice(2, 10)}`, socket.id, cleanName, room.players.length);
    player.reconnectToken = crypto.randomBytes(24).toString('hex');
    room.players.push(player); if (!room.hostId) room.hostId = player.id;
    socket.data.roomCode = room.code; socket.join(room.code);
    socket.emit('joined', { code: room.code, playerId: player.id, hostId: room.hostId, reconnectToken: player.reconnectToken });
    emitRoom(room);
  });
  socket.on('startGame', () => {
    const entry = locate(socket); if (!entry) return;
    const { room, player } = entry;
    if (room.hostId !== player.id) return fail(socket, 'Only the host can begin the game.');
    if (room.players.length < 2) return fail(socket, 'Invite at least one more player before starting.');
    room.game = true; room.board = makeBoard(); room.deck = makeDeck(); room.awards = { longestRoad: null, largestArmy: null };
    room.players.forEach(p => { p.roads = []; p.buildings = {}; p.knights = 0; p.revealedVP = 0; p.devCards = []; p.boughtThisTurn = []; p.longestRoad = 0; p.resources = Object.fromEntries(TYPES.map(t => [t, 0])); });
    room.setupOrder = room.players.map(p => p.id); room.setupIndex = 0; room.setupRound = 0; room.setupAction = 'settlement';
    room.turnIndex = 0; room.turn = 0; room.roll = null; room.devPlayed = false; room.pendingDiscards = []; room.tradeOffer = null; room.winnerId = null; room.phase = 'setup'; room.log = [];
    log(room, 'Found your first settlement, then connect it with a road.'); emitRoom(room);
  });
  socket.on('placeSettlement', ({ nodeId } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!room.game) return;
    nodeId = Number(nodeId); const node = room.board.nodes[nodeId];
    if (!node || room.players.some(p => p.buildings[nodeId])) return fail(socket, 'That crossroads is occupied.');
    if (hasSettlementNear(room, nodeId)) return fail(socket, 'Settlements must have at least one crossroads between them.');
    if (room.phase === 'setup') {
      if (room.setupOrder[room.setupIndex] !== player.id || room.setupAction !== 'settlement') return fail(socket, 'Wait for your settlement placement.');
    } else {
      if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Roll the dice and wait for your turn before building.');
      if (!connectedToPlayer(room, player, nodeId)) return fail(socket, 'Build beside one of your roads.');
      if (Object.values(player.buildings).filter(x => x === 'settlement').length >= 5) return fail(socket, 'You have used all five settlements.');
      if (!canAfford(player, COSTS.settlement)) return fail(socket, 'A settlement costs one lumber, brick, wool and grain.');
      spend(player, COSTS.settlement);
    }
    player.buildings[nodeId] = 'settlement';
    if (room.phase === 'setup' && room.setupRound === 1) for (const hid of node.hexes) add(player, room.board.hexes[hid].resource);
    log(room, `${player.name} raises a settlement.`); updateAwards(room);
    if (room.phase === 'setup') advanceSetup(room); else checkWinner(room);
    emitRoom(room);
  });
  socket.on('placeRoad', ({ edgeId, free = false } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!room.game) return; edgeId = Number(edgeId);
    const setup = room.phase === 'setup' && room.setupOrder[room.setupIndex] === player.id && room.setupAction === 'road';
    const roadBuild = room.phase === 'roadBuilding' && checkTurn(room, player);
    if (!(setup || (checkTurn(room, player) && room.phase === 'main' && room.roll !== null) || roadBuild)) return fail(socket, 'Roads can only be placed during your turn.');
    const isFree = setup || roadBuild;
    if (!canBuildRoad(room, player, edgeId, isFree)) return fail(socket, 'That road must connect to your network and cost one lumber and brick.');
    if (!isFree) spend(player, COSTS.road);
    player.roads.push(edgeId); log(room, `${player.name} lays a road.`); updateAwards(room);
    if (setup) advanceSetup(room);
    if (roadBuild) { room.freeRoadsLeft--; room.freeRoadsPlaced++; if (room.freeRoadsLeft <= 0) room.phase = 'main'; }
    checkWinner(room); emitRoom(room);
  });
  socket.on('buildCity', ({ nodeId } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry; nodeId = Number(nodeId);
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'You can upgrade after rolling, during your turn.');
    if (player.buildings[nodeId] !== 'settlement') return fail(socket, 'Choose one of your settlements to upgrade.');
    if (Object.values(player.buildings).filter(x => x === 'city').length >= 4) return fail(socket, 'You have used all four city pieces.');
    if (!canAfford(player, COSTS.city)) return fail(socket, 'A city costs two grain and three ore.');
    spend(player, COSTS.city); player.buildings[nodeId] = 'city'; log(room, `${player.name} upgrades a settlement to a city.`); updateAwards(room); checkWinner(room); emitRoom(room);
  });
  socket.on('rollDice', () => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll !== null) return fail(socket, 'The dice have already been rolled this turn.');
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]; room.roll = dice;
    if (dice[0] + dice[1] === 7) {
      room.pendingDiscards = room.players.filter(p => Object.values(p.resources).reduce((a,b) => a+b, 0) > 7).map(p => p.id);
      if (!room.pendingDiscards.length) { room.phase = 'robber'; log(room, `${player.name} rolls a 7. Move the robber.`); }
      else { room.phase = 'discard'; log(room, 'A 7! Players with more than seven cards must discard half.'); }
    } else { produce(room, dice[0] + dice[1]); }
    emitRoom(room);
  });
  socket.on('discard', ({ cards } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (room.phase !== 'discard' || !room.pendingDiscards.includes(player.id)) return fail(socket, 'You do not need to discard now.');
    if (!cards || typeof cards !== 'object') return fail(socket, 'Choose cards to discard.');
    const total = Object.values(player.resources).reduce((a,b) => a+b, 0), wanted = Math.floor(total / 2);
    const chosen = Object.fromEntries(TYPES.map(t => [t, Math.floor(Number(cards[t]) || 0)]));
    if (Object.values(chosen).reduce((a,b) => a+b, 0) !== wanted || TYPES.some(t => chosen[t] > player.resources[t])) return fail(socket, `Choose exactly ${wanted} cards to discard.`);
    for (const t of TYPES) player.resources[t] -= chosen[t];
    room.pendingDiscards = room.pendingDiscards.filter(id => id !== player.id); log(room, `${player.name} discards ${wanted} cards.`); continueAfterDiscards(room); emitRoom(room);
  });
  socket.on('moveRobber', ({ hexId, targetId } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry; hexId = Number(hexId);
    if (!checkTurn(room, player) || room.phase !== 'robber') return fail(socket, 'Move the robber after a seven or a knight.');
    const hex = room.board.hexes[hexId]; if (!hex || hexId === room.board.robber) return fail(socket, 'Choose a different land tile.');
    room.board.robber = hexId;
    const victims = room.players.filter(p => p.id !== player.id && hex.nodes.some(n => p.buildings[n]) && Object.values(p.resources).some(v => v > 0));
    const victim = victims.find(p => p.id === targetId) || victims[0];
    if (victim) {
      const pool = TYPES.flatMap(t => Array(victim.resources[t]).fill(t)); const stolen = pool[Math.floor(Math.random() * pool.length)];
      victim.resources[stolen]--; add(player, stolen); log(room, `${player.name} steals a ${stolen} card from ${victim.name}.`);
    } else log(room, `${player.name} moves the robber. No one was within reach.`);
    room.phase = 'main'; checkWinner(room); emitRoom(room);
  });
  socket.on('bankTrade', ({ give, get } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Trade after rolling during your turn.');
    if (!TYPES.includes(give) || !TYPES.includes(get) || give === get) return fail(socket, 'Choose two different resources.');
    let rate = 4;
    for (const harbor of room.board.harbors) if (!harbor.resource || harbor.resource === give) {
      if (room.board.edges[harbor.edge] && adjacentNodes(room, harbor.edge).some(n => player.buildings[n])) rate = Math.min(rate, harbor.rate);
    }
    if (player.resources[give] < rate) return fail(socket, `You need ${rate} ${give} for this trade.`);
    spend(player, { [give]: rate }); add(player, get); log(room, `${player.name} trades ${rate} ${give} for ${get} at the bank.`); emitRoom(room);
  });
  socket.on('offerTrade', ({ toId, give, receive } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Player trades can be offered after you roll.');
    const clean = values => Object.fromEntries(TYPES.map(t => [t, Math.max(0, Math.min(20, Math.floor(Number(values?.[t]) || 0)))]));
    const g = clean(give), r = clean(receive);
    if (!Object.values(g).some(Boolean) || !Object.values(r).some(Boolean) || TYPES.some(t => player.resources[t] < g[t])) return fail(socket, 'Choose a valid offer you can afford.');
    if (!room.players.some(p => p.id === toId && p.id !== player.id)) return fail(socket, 'Choose another player for the offer.');
    room.tradeOffer = { id: Math.random().toString(36).slice(2), fromId: player.id, toId, give: g, receive: r };
    log(room, `${player.name} proposes a trade.`); emitRoom(room);
  });
  socket.on('respondTrade', ({ accept } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry; const offer = room.tradeOffer;
    if (!offer || offer.toId !== player.id) return fail(socket, 'That trade offer is no longer active.');
    const seller = room.players.find(p => p.id === offer.fromId);
    if (!seller || !checkTurn(room, seller)) return fail(socket, 'That trade offer is no longer active.');
    if (accept) {
      if (!canAfford(player, offer.receive) || !canAfford(seller, offer.give)) return fail(socket, 'One player no longer has the offered cards.');
      spend(seller, offer.give); spend(player, offer.receive);
      for (const t of TYPES) { seller.resources[t] += offer.receive[t]; player.resources[t] += offer.give[t]; }
      log(room, `${seller.name} and ${player.name} complete a trade.`);
    } else log(room, `${player.name} declines the trade.`);
    room.tradeOffer = null; emitRoom(room);
  });
  socket.on('buyDevelopment', () => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Buy a card after rolling during your turn.');
    if (!canAfford(player, COSTS.development)) return fail(socket, 'A card costs one wool, grain and ore.');
    if (!room.deck.length) return fail(socket, 'The development deck is empty.');
    spend(player, COSTS.development); const type = room.deck.pop(); player.devCards.push({ type, boughtTurn: room.turn }); player.boughtThisTurn.push(type);
    log(room, `${player.name} draws a development card.`); checkWinner(room); emitRoom(room);
  });
  socket.on('playDevelopment', ({ index, resource, resources } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry; index = Number(index);
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Play a card after rolling during your turn.');
    if (room.devPlayed) return fail(socket, 'Only one development card may be played each turn.');
    const card = player.devCards[index]; if (!card || card.type === 'victory' || card.boughtTurn === room.turn) return fail(socket, 'That card cannot be played this turn.');
    const plentyChoices = Array.isArray(resources) ? resources : [resource, resource];
    if (card.type === 'plenty' && (plentyChoices.length !== 2 || plentyChoices.some(t => !TYPES.includes(t)))) return fail(socket, 'Choose two resources for the Year of Plenty card.');
    if (card.type === 'knight') { player.knights++; room.phase = 'robber'; }
    if (card.type === 'roadBuilding') { room.phase = 'roadBuilding'; room.freeRoadsLeft = 2; room.freeRoadsPlaced = 0; }
    if (card.type === 'plenty') { for (const type of plentyChoices) add(player, type); }
    if (card.type === 'monopoly') { if (!TYPES.includes(resource)) return fail(socket, 'Choose a resource for the Monopoly card.'); let taken = 0; for (const other of room.players) if (other !== player) { taken += other.resources[resource]; player.resources[resource] += other.resources[resource]; other.resources[resource] = 0; } log(room, `${player.name} claims ${taken} ${resource} through Monopoly.`); }
    player.devCards.splice(index, 1); room.devPlayed = true; if (card.type === 'knight') log(room, `${player.name} plays a Knight. Move the robber.`); else if (card.type === 'roadBuilding') log(room, `${player.name} plays Road Building.`); else if (card.type === 'plenty') log(room, `${player.name} plays Year of Plenty.`);
    checkWinner(room); emitRoom(room);
  });
  socket.on('endTurn', () => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'main' || room.roll === null) return fail(socket, 'Finish the robber action before ending your turn.');
    endTurn(room); emitRoom(room);
  });
  socket.on('finishRoadBuilding', () => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    if (!checkTurn(room, player) || room.phase !== 'roadBuilding') return fail(socket, 'You cannot finish Road Building right now.');
    room.phase = 'main'; room.freeRoadsLeft = 0; checkWinner(room); emitRoom(room);
  });
  socket.on('chat', ({ text } = {}) => {
    const entry = locate(socket); if (!entry) return; const { room, player } = entry;
    const message = String(text || '').trim().slice(0, 180); if (!message) return;
    io.to(room.code).emit('chatMessage', { name: player.name, color: player.color, text: message, time: Date.now() });
  });
  socket.on('disconnect', () => {
    const code = socket.data.roomCode, room = rooms.get(code); if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id); if (player && !room.game) {
      room.players = room.players.filter(p => p.id !== player.id);
      if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
      if (!room.players.length) { rooms.delete(code); return; }
      emitRoom(room); return;
    }
    if (player) {
      player.connected = false; player.socketId = null; log(room, `${player.name} lost connection.`);
      if (room.game && activePlayer(room)?.id === player.id && room.phase === 'main') { log(room, `${player.name}'s watch passes after disconnect.`); endTurn(room); }
      emitRoom(room);
    }
    if (!room.game && room.players.every(p => !p.connected)) rooms.delete(code);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Crown & Cobblestone listening on http://localhost:${PORT}`));
