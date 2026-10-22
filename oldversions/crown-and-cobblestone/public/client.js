import * as THREE from '/node_modules/three/build/three.module.js';
let Tone = null;

const TYPES = ['lumber','wool','grain','brick','ore'];
const TYPE_LABEL = { lumber:'Lumber', wool:'Wool', grain:'Grain', brick:'Brick', ore:'Ore' };
const TYPE_ICON = { lumber:'♧', wool:'❋', grain:'✳', brick:'▦', ore:'◆' };
const CARD_LABEL = { knight:'Knight', victory:'Victory point', roadBuilding:'Road Building', plenty:'Year of Plenty', monopoly:'Monopoly' };
const $ = id => document.getElementById(id);
const socket = io();
let myId = null, roomCode = '', hostId = null, snapshot = null, mode = null;
let noticeTimer = 0, discardOpen = false, audioOn = false, musicLoop = null, audioSynth = null, rollSeen = null;
let pendingJoin = null;

const lobby = $('lobby'), waiting = $('waiting'), gameScreen = $('game');
function show(el) { [lobby,waiting,gameScreen].forEach(x => x.classList.toggle('hidden', x !== el)); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el.classList.add('hidden'), 2800); }
function setServerStatus(message, offline=false) { const el=$('serverStatus'); if(el){el.textContent=message;el.classList.toggle('offline',offline);} }
function connectRoom(code) {
  const name = $('playerName').value.trim() || 'Traveler';
  const reconnectToken = code ? localStorage.getItem(`cc:${code}:token`) : null;
  pendingJoin = { name, code: code || undefined, reconnectToken: reconnectToken || undefined };
  $('createRoom').disabled = $('joinRoom').disabled = true;
  setServerStatus('Connecting to the game server…');
  if(socket.connected) sendPendingJoin(); else socket.connect();
}
function sendPendingJoin() { if(!pendingJoin||!socket.connected)return; socket.emit('joinRoom',pendingJoin); setServerStatus('Server connected. Opening your table…'); }
$('createRoom').onclick = () => connectRoom('');
$('joinRoom').onclick = () => { const code = $('roomCode').value.trim().toUpperCase(); if (!code) return toast('Enter a room code first.'); connectRoom(code); };
$('roomCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4); });
$('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') connectRoom(''); });
socket.on('connect', () => { setServerStatus('Game server connected. Found a new table or enter a room code.'); sendPendingJoin(); });
socket.on('connect_error', () => { setServerStatus('Can’t reach the game server. Run npm install, then npm start, and open http://localhost:3000.',true); $('createRoom').disabled = $('joinRoom').disabled = false; toast('Game server is offline. See the message below the room buttons.'); });
socket.on('disconnect', () => { if(roomCode)toast('Connection lost. Reopen the table to reconnect.'); else setServerStatus('Disconnected from the game server. Try again after it starts.',true); });
socket.on('joined', data => { pendingJoin=null; $('createRoom').disabled = $('joinRoom').disabled = false; roomCode = data.code; myId = data.playerId; hostId = data.hostId; if(data.reconnectToken)localStorage.setItem(`cc:${roomCode}:token`,data.reconnectToken); $('waitingCode').textContent = roomCode; $('roomBadge').textContent = `TABLE ${roomCode}`; show(waiting); });
socket.on('notice', data => { pendingJoin=null; $('createRoom').disabled = $('joinRoom').disabled = false; setServerStatus('Game server connected. Found a new table or enter a room code.'); toast(data.message); });
socket.on('gameState', data => {
  roomCode = data.code; hostId = data.hostId; const oldRoll = snapshot?.game?.roll ? `${snapshot.game.turn}-${snapshot.game.roll.join('-')}` : null; snapshot = data;
  if (!data.game) { show(waiting); renderLobby(data); return; }
  show(gameScreen); renderGame();
  const newRoll = data.game.roll ? `${data.game.turn}-${data.game.roll.join('-')}` : null;
  if (newRoll && newRoll !== oldRoll) rollAnimation(data.game.roll);
  if (data.game.phase === 'discard' && data.game.mustDiscard && !discardOpen) discardDialog();
  if (data.game.phase !== 'discard') discardOpen = false;
  if (data.game.phase === 'robber') { mode = 'robber'; $('hint').textContent = 'Choose a new land tile for the robber'; $('hint').classList.remove('hidden'); }
});
socket.on('chatMessage', m => addChat(m.name, m.text, m.color));
window.__ccClientReady = true;
function renderLobby(data) {
  $('waitingCode').textContent = data.code;
  const roster = $('lobbyRoster'); roster.replaceChildren();
  data.players.forEach(p => { const row=document.createElement('div');row.className='roster-person';row.innerHTML=`<i class="roster-dot" style="color:${p.color};background:${p.color}"></i><span></span><small class="roster-status"></small>`;row.children[1].textContent=p.name;row.children[2].textContent=p.id===data.hostId?'HOST':p.connected?'READY':'AWAY';roster.append(row); });
  $('startGame').classList.toggle('hidden', myId !== data.hostId);
  $('waitingHint').textContent = myId === data.hostId ? (data.players.length < 2 ? 'Invite at least one companion to begin.' : 'All is ready. Begin when your table is set.') : 'Waiting for the host to begin…';
}
$('copyCode').onclick = async () => { try { await navigator.clipboard.writeText(roomCode); toast('Room code copied.'); } catch { toast(`Room code: ${roomCode}`); } };
$('startGame').onclick = () => socket.emit('startGame');
$('leaveRoom').onclick = () => location.reload();
$('exitGame').onclick = () => { if (confirm('Leave this table?')) location.reload(); };
$('musicToggle').onclick = () => toggleMusic();
$('helpToggle').onclick = () => showHelp();
$('bankTrade').onclick = () => bankDialog();
$('buyDev').onclick = () => socket.emit('buyDevelopment');
$('rollDice').onclick = () => socket.emit('rollDice');
$('endTurn').onclick = () => socket.emit('endTurn');
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (!snapshot?.game) return;
  const next=b.dataset.mode; mode = mode===next ? null : next; updateMode();
}));
$('chatForm').addEventListener('submit', e => { e.preventDefault(); const input=$('chatInput'); if(input.value.trim()) socket.emit('chat',{text:input.value.trim()}); input.value=''; });
function addChat(name,text,color) { const feed=$('chatFeed'),line=document.createElement('div');line.className='chat-line';const n=document.createElement('strong');n.textContent=name;n.style.setProperty('--pcolor',color||'#cfb66f');line.append(n,document.createTextNode(text));feed.append(line);while(feed.children.length>24)feed.firstChild.remove();feed.scrollTop=feed.scrollHeight; }

function showModal(html) { $('modal').innerHTML=html; $('modalBackdrop').classList.remove('hidden'); $('modal').querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal); }
function closeModal() { $('modalBackdrop').classList.add('hidden'); }
$('modalBackdrop').addEventListener('click', e => { if(e.target===$('modalBackdrop')) closeModal(); });
function showHelp() {
  showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">A SHORT FIELD GUIDE</p><h2>How to found a realm</h2><div class="rules-copy"><p><b>Founding.</b> In turn order, place a settlement and a connected road. Then the table places a second settlement and road in reverse order. Your second settlement gathers one resource from each neighboring land.</p><p><b>Harvest.</b> Roll two dice once each turn. Numbered lands produce lumber, wool, grain, brick, or ore for adjacent settlements (cities produce two). On a seven, discard half if you hold more than seven cards, then move the robber and steal from a neighboring rival.</p><p><b>Build.</b> Roads cost lumber and brick. Settlements cost one lumber, brick, wool and grain. Cities cost two grain and three ore. Development cards cost one wool, grain and ore.</p><p><b>Trade.</b> Exchange with the bank at 4:1, or use a harbor for 3:1 or a matching resource harbor for 2:1. Offer resources to the other lords at the table.</p><p><b>Victory.</b> First to 10 points on their turn wins. Settlements score 1, cities 2, the Longest Road and Largest Army score 2 each, and Victory Point cards score 1.</p><p>Development cards include Knights, Road Building, Year of Plenty, Monopoly and Victory Points. Cards bought this turn cannot be played this turn. Only one action card per turn.</p></div><button class="button button-gold" data-close>Return to the table</button>`);
}
function bankDialog() {
  if(!snapshot?.game) return;
  const hand=me()?.resources||{};
  showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">MARITIME EXCHANGE</p><h2>Trade with the bank</h2><p>Your harbors improve the standard 4:1 exchange.</p><div class="modal-resources"><label class="modal-resource">Give<select id="tradeGive" class="trade-select">${TYPES.map(t=>`<option value="${t}">${TYPE_LABEL[t]} · ${hand[t]||0} held</option>`).join('')}</select></label><label class="modal-resource">Receive<select id="tradeGet" class="trade-select">${TYPES.map(t=>`<option value="${t}">${TYPE_LABEL[t]}</option>`).join('')}</select></label></div><div class="modal-actions"><button class="button button-outline" data-close>Cancel</button><button id="confirmBank" class="button button-gold">Make exchange</button></div>`);
  $('confirmBank').onclick=()=>{socket.emit('bankTrade',{give:$('tradeGive').value,get:$('tradeGet').value});closeModal();};
}
function discardDialog() {
  discardOpen=true; const mePlayer=me(); if(!mePlayer) return;
  const total=Object.values(mePlayer.resources||{}).reduce((a,b)=>a+b,0), wanted=Math.floor(total/2);
  showModal(`<p class="eyebrow">THE ROBBER'S TOLL</p><h2>Discard ${wanted} cards</h2><p>Choose half your hand (${wanted} cards). Keep your best prospects close.</p><div class="modal-resources">${TYPES.map(t=>`<label class="modal-resource"><span>${TYPE_ICON[t]} &nbsp;${TYPE_LABEL[t]}</span><span>${mePlayer.resources[t]||0} held</span><input type="number" id="discard-${t}" min="0" max="${mePlayer.resources[t]||0}" value="0"></label>`).join('')}</div><div class="modal-actions"><button id="confirmDiscard" class="button button-gold">Discard cards</button></div>`);
  $('confirmDiscard').onclick=()=>{const cards=Object.fromEntries(TYPES.map(t=>[t,Number($(`discard-${t}`).value)||0]));if(Object.values(cards).reduce((a,b)=>a+b,0)!==wanted)return toast(`Choose exactly ${wanted} cards.`);socket.emit('discard',{cards});closeModal();};
}
function offerDialog(targetId) {
  showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">A BARGAIN BETWEEN LORDS</p><h2>Propose a trade</h2><p>Choose the resources you offer and request.</p>${['give','receive'].map(k=>`<div class="modal-resources"><strong>${k==='give'?'You offer':'You request'}</strong>${TYPES.map(t=>`<label class="modal-resource"><span>${TYPE_LABEL[t]}</span><span></span><input type="number" id="offer-${k}-${t}" min="0" max="20" value="0"></label>`).join('')}</div>`).join('')}<div class="modal-actions"><button class="button button-outline" data-close>Cancel</button><button id="sendOffer" class="button button-gold">Send offer</button></div>`);
  $('sendOffer').onclick=()=>{const read=k=>Object.fromEntries(TYPES.map(t=>[t,Number($(`offer-${k}-${t}`).value)||0]));socket.emit('offerTrade',{toId:targetId,give:read('give'),receive:read('receive')});closeModal();};
}
function resourceChoice(cardIndex, kind) {
  const select=id=>`<select id="${id}" class="trade-select">${TYPES.map(t=>`<option value="${t}">${TYPE_LABEL[t]}</option>`).join('')}</select>`;
  const prompt=kind==='plenty'?`<p>Choose two resources for the crown's stores. They may match.</p>${select('choiceResourceA')}<br><br>${select('choiceResourceB')}`:`<p>Choose one resource for the crown's decree.</p>${select('choiceResource')}`;
  showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">A DEVELOPMENT CARD</p><h2>${CARD_LABEL[kind]}</h2>${prompt}<div class="modal-actions"><button class="button button-outline" data-close>Cancel</button><button id="playChoice" class="button button-gold">Play card</button></div>`);
  $('playChoice').onclick=()=>{const payload=kind==='plenty'?{index:cardIndex,resources:[$('choiceResourceA').value,$('choiceResourceB').value]}:{index:cardIndex,resource:$('choiceResource').value};socket.emit('playDevelopment',payload);closeModal();};
}
function tradeOfferDialog(offer) {
  const from=snapshot.game.players.find(p=>p.id===offer.fromId);
  showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">A BARGAIN BETWEEN LORDS</p><h2>${escapeText(from?.name||'A lord')} offers a trade</h2><p>They offer <b>${summarize(offer.give)}</b><br>for <b>${summarize(offer.receive)}</b>.</p><div class="modal-actions"><button id="declineOffer" class="button button-outline">Decline</button><button id="acceptOffer" class="button button-gold">Accept trade</button></div>`);
  $('acceptOffer').onclick=()=>{socket.emit('respondTrade',{accept:true});closeModal();};$('declineOffer').onclick=()=>{socket.emit('respondTrade',{accept:false});closeModal();};
}
function summarize(values) { return TYPES.filter(t=>values[t]).map(t=>`${values[t]} ${TYPE_LABEL[t]}`).join(', ')||'nothing'; }
function escapeText(s) { const d=document.createElement('div');d.textContent=s;return d.innerHTML; }

function me() { return snapshot?.game?.players.find(p=>p.id===myId); }
function renderGame() {
  const g=snapshot.game,p=me(),active=g.activeId===myId;
  $('roomBadge').textContent=`TABLE ${snapshot.code}`;
  const ownPhase=g.phase==='setup'&&g.activeId===myId;
  let status='';
  if(g.phase==='finished') status=`${g.players.find(x=>x.id===g.winnerId)?.name||'A lord'} claims the crown`;
  else if(g.phase==='setup') status=ownPhase?`Your founding · place a ${g.setupAction}`:`${g.players.find(x=>x.id===g.activeId)?.name||'A lord'} places a ${g.setupAction}`;
  else if(g.phase==='discard') status=g.mustDiscard?'Choose cards to discard':'A seven has sent the robber among us';
  else if(g.phase==='robber') status=active?'Move the robber to a new land':`${g.players.find(x=>x.id===g.activeId)?.name||'A lord'} moves the robber`;
  else status=active?(g.roll?`Your turn · rolled ${g.roll[0]+g.roll[1]}`:'Your turn · roll the dice'):`${g.players.find(x=>x.id===g.activeId)?.name||'A lord'} is taking the watch`;
  $('turnText').textContent=status;
  $('playerList').replaceChildren();
  g.players.forEach(pl=>{
    const row=document.createElement('div');row.className='player-row'+(pl.id===g.activeId?' active':'');row.style.setProperty('--pcolor',pl.color);
    const mark=document.createElement('i');mark.className='player-mark';
    const name=document.createElement('span');name.className='player-name';name.textContent=pl.name+(pl.id===myId?' · You':'');
    const meta=document.createElement('span');meta.className='player-meta';meta.textContent=`${pl.resourceCount} cards`;
    const score=document.createElement('b');score.className='player-score';score.textContent=`${pl.score} ✦`;
    row.append(mark,name,meta,score);
    if(pl.id!==myId&&active&&g.phase==='main'&&g.roll!==null){row.title='Click to propose a trade';row.style.cursor='pointer';row.onclick=()=>offerDialog(pl.id);}
    $('playerList').append(row);
  });
  const army=g.players.find(x=>x.id===g.awards.largestArmy),road=g.players.find(x=>x.id===g.awards.longestRoad);
  $('armyHolder').textContent=army?`${army.name} · ${army.knights} knights`:'Unclaimed · 3 knights';$('roadHolder').textContent=road?`${road.name} · ${road.longestRoad} roads`:'Unclaimed · 5 roads';
  const resources=p?.resources||Object.fromEntries(TYPES.map(t=>[t,0])),total=Object.values(resources).reduce((a,b)=>a+b,0);
  $('handTotal').textContent=`${total} card${total===1?'':'s'}`;
  $('resourceList').innerHTML=TYPES.map(t=>`<div class="resource-item"><span class="resource-icon" style="color:${resourceColor(t)}">${TYPE_ICON[t]}</span><b>${resources[t]||0}</b><small>${TYPE_LABEL[t].toUpperCase()}</small></div>`).join('');
  $('eventLog').replaceChildren();g.log.forEach((line,i)=>{const d=document.createElement('div');d.className='event-line';d.textContent=line;$('eventLog').append(d);});
  renderDevCards(g,p);
  const canRoll=active&&g.phase==='main'&&g.roll===null;
  $('rollDice').disabled=!canRoll;$('rollDice').classList.toggle('disabled',!canRoll);
  $('endTurn').disabled=!(active&&g.phase==='main'&&g.roll!==null);$('endTurn').classList.toggle('disabled',$('endTurn').disabled);
  $('bankTrade').disabled=!(active&&g.phase==='main'&&g.roll!==null);$('buyDev').disabled=!(active&&g.phase==='main'&&g.roll!==null);
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',mode===b.dataset.mode);b.disabled=!(active&&((g.phase==='setup'&&g.setupAction===b.dataset.mode)||(g.phase==='main'&&g.roll!==null)));});
  if(g.phase==='setup'&&active) mode=g.setupAction;
  if(g.phase!=='robber'&&mode==='robber')mode=null;
  $('hint').classList.toggle('hidden',!mode&&!ownPhase);
  if(mode==='road')$('hint').textContent='Choose a highlighted crossroads edge for your road';
  else if(mode==='settlement')$('hint').textContent='Choose a highlighted crossroads for your settlement';
  else if(mode==='city')$('hint').textContent='Choose one of your settlements to raise into a city';
  else if(g.phase==='setup'&&active) $('hint').textContent=`Founding · place your ${g.setupAction}`;
  $('hint').classList.toggle('hidden',!mode&&!ownPhase);
  if(g.phase==='roadBuilding'){
    const skip=document.createElement('button');skip.className='dev-card';skip.textContent=`Finish Road Building · ${g.freeRoadsLeft} left`;skip.onclick=()=>{socket.emit('finishRoadBuilding');mode=null;};$('devHand').append(skip);
  }
  if(g.tradeOffer && g.tradeOffer.toId===myId && !document.querySelector('#modalBackdrop:not(.hidden)')) tradeOfferDialog(g.tradeOffer);
  updateMode(); updateBoard(g);
  updateResourceCounts(resources);
  if(g.phase==='finished'&&g.winnerId===myId) showWinner(g); else if(g.phase==='finished'&&g.winnerId!==myId&&!document.querySelector('.winner-banner')) showWinner(g);
}
function renderDevCards(g,p) {
  const holder=$('devHand');holder.replaceChildren();
  (p?.devCards||[]).forEach((c,i)=>{if(c.type==='victory')return;const b=document.createElement('button');b.className='dev-card';b.innerHTML=`${CARD_LABEL[c.type]}<small>Play</small>`;b.onclick=()=>{if(c.type==='plenty'||c.type==='monopoly')resourceChoice(i,c.type);else if(c.type==='roadBuilding'){socket.emit('playDevelopment',{index:i});mode='road';updateMode();}else socket.emit('playDevelopment',{index:i});};holder.append(b);});
}
function showWinner(g) {
  const winner=g.players.find(p=>p.id===g.winnerId);
  showModal(`<div class="winner-banner"><div class="crest">✦</div><p class="eyebrow">THE REALM HAS A SOVEREIGN</p><h2>${escapeText(winner?.name||'A lord')}</h2><p>has raised the most prosperous realm<br>and claimed the crown.</p><div class="score-final">${winner?.score||10} Victory Points</div><div class="modal-actions"><button class="button button-gold" data-close>Celebrate at the table</button></div></div>`);
}
function updateMode(){
  const g=snapshot?.game; if(!g)return;
  if(mode==='road')$('hint').textContent='Choose a highlighted crossroads edge for your road';
  $('hint').classList.toggle('hidden',!mode&&!(g.phase==='setup'&&g.activeId===myId));
  if(boardReady)refreshMarkers(g);
}
function resourceColor(t){return {lumber:'#7f9b62',wool:'#b0bd8b',grain:'#d3b15b',brick:'#bd6c50',ore:'#8997a1'}[t];}

// Three.js tabletop. Every landform, harbor, piece, die and resource keeps a real 3D mesh.
const canvas=$('boardCanvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-7,7,6,-6,.1,80);camera.position.set(0,15,17);camera.lookAt(0,0,0);
scene.add(new THREE.HemisphereLight(0xe6d9b8,0x302b21,2.0));
const keyLight=new THREE.DirectionalLight(0xffe2ab,3);keyLight.position.set(-6,12,7);keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.camera.left=-8;keyLight.shadow.camera.right=8;keyLight.shadow.camera.top=8;keyLight.shadow.camera.bottom=-8;scene.add(keyLight);
const rimLight=new THREE.DirectionalLight(0x7895a4,1.25);rimLight.position.set(5,6,-7);scene.add(rimLight);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(18,18),new THREE.MeshStandardMaterial({color:0x343026,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.42;ground.receiveShadow=true;scene.add(ground);
const table=new THREE.Mesh(new THREE.CylinderGeometry(6.25,6.35,.38,64),new THREE.MeshStandardMaterial({color:0x392f22,roughness:.87,metalness:.05}));table.position.y=-.21;table.receiveShadow=true;table.castShadow=true;scene.add(table);
const rim=new THREE.Mesh(new THREE.TorusGeometry(6.22,.09,8,80),new THREE.MeshStandardMaterial({color:0x967542,roughness:.6,metalness:.32}));rim.rotation.x=Math.PI/2;rim.position.y=-.01;scene.add(rim);
let boardReady=false,boardData=null,nodeMarkers=[],edgeMarkers=[],tileMeshes=[],pieceGroup=null,harborGroup=null,resourceGroups=[],diceGroup=null,dieMeshes=[],resourceLabels=[],lastRobber=null,trackedRobber=null;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const mats={wood:new THREE.MeshStandardMaterial({color:0x68462b,roughness:.86}),woodLight:new THREE.MeshStandardMaterial({color:0x95653a,roughness:.8}),stone:new THREE.MeshStandardMaterial({color:0x8c8576,roughness:.94}),roof:new THREE.MeshStandardMaterial({color:0x743e2c,roughness:.84}),gold:new THREE.MeshStandardMaterial({color:0xc8a553,roughness:.42,metalness:.5}),dark:new THREE.MeshStandardMaterial({color:0x25241f,roughness:.95}),wool:new THREE.MeshStandardMaterial({color:0xe1d4b2,roughness:.97}),leaves:new THREE.MeshStandardMaterial({color:0x355640,roughness:.9}),leaves2:new THREE.MeshStandardMaterial({color:0x4c7048,roughness:.9}),grain:new THREE.MeshStandardMaterial({color:0xc49d43,roughness:.85}),ore:new THREE.MeshStandardMaterial({color:0x687b82,roughness:.42,metalness:.28})};
function seedTexture(type){
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  const palette={forest:['#355a3b','#70905a'],pasture:['#728452','#b4b17b'],fields:['#bd9146','#e1c774'],hills:['#965b3d','#ce8960'],mountains:['#727772','#a1a193'],desert:['#b59661','#ddc58b']}[type];
  const grad=x.createLinearGradient(0,0,210,256);grad.addColorStop(0,palette[0]);grad.addColorStop(1,palette[1]);x.fillStyle=grad;x.fillRect(0,0,256,256);
  for(let i=0;i<900;i++){const a=Math.random()*.24;x.fillStyle=i%2?`rgba(255,240,190,${a})`:`rgba(24,28,15,${a})`;const s=Math.random()*3+1;x.fillRect(Math.random()*256,Math.random()*256,s,s);}
  if(type==='fields'){x.strokeStyle='#f4d881';x.lineWidth=6;for(let y=24;y<250;y+=28){x.beginPath();x.moveTo(0,y);x.quadraticCurveTo(125,y-14,256,y+5);x.stroke();}}
  if(type==='forest'){for(let i=0;i<22;i++){x.fillStyle=i%2?'#294933':'#477249';x.beginPath();x.arc(Math.random()*256,Math.random()*256,5+Math.random()*14,0,Math.PI*2);x.fill();}}
  if(type==='mountains'||type==='hills'){for(let i=0;i<17;i++){const px=Math.random()*256,py=Math.random()*256;x.fillStyle=i%2?'#b0a58c88':'#4b514b66';x.beginPath();x.moveTo(px-16,py+12);x.lineTo(px,py-18-Math.random()*15);x.lineTo(px+20,py+12);x.fill();}}
  if(type==='desert'){for(let i=0;i<8;i++){const py=20+i*35;x.strokeStyle='#f1d9a36b';x.lineWidth=7;x.beginPath();x.moveTo(0,py+10);x.quadraticCurveTo(100,py-18,256,py+3);x.stroke();}}
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=renderer.capabilities.getMaxAnisotropy();return tex;
}
function labelTexture(text,warning=false){const c=document.createElement('canvas');c.width=128;c.height=128;const x=c.getContext('2d');x.fillStyle='#d9c89f';x.beginPath();x.arc(64,64,57,0,Math.PI*2);x.fill();x.strokeStyle=warning?'#b9472e':'#6c512d';x.lineWidth=7;x.stroke();x.fillStyle='#211c13';x.font='bold 47px Georgia';x.textAlign='center';x.textBaseline='middle';x.fillText(String(text),64,65);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function modelTree(group,x,z,scale=1){const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.045*scale,.07*scale,.31*scale,7),mats.wood);trunk.position.set(x,.3*scale,z);trunk.castShadow=true;group.add(trunk);for(let i=0;i<3;i++){const cone=new THREE.Mesh(new THREE.ConeGeometry((.3-i*.045)*scale,.48*scale,7),i===1?mats.leaves2:mats.leaves);cone.position.set(x,(.48+i*.23)*scale,z);cone.castShadow=true;group.add(cone);}}
function terrainDetails(group,h){
  const seed=h.id+4;const rand=(()=>{let s=seed*12345;return()=>{s=(s*16807)%2147483647;return(s%1000)/1000;};})();
  if(h.terrain==='forest'){for(let i=0;i<5;i++)modelTree(group,(rand()-.5)*1.05,(rand()-.5)*1.05,.72+rand()*.36);}
  if(h.terrain==='pasture'){for(let i=0;i<4;i++){const sheep=new THREE.Mesh(new THREE.IcosahedronGeometry(.15+rand()*.035,1),mats.wool);sheep.scale.set(1.2,.72,.86);sheep.position.set((rand()-.5)*1.1,.34,(rand()-.5)*1.0);sheep.castShadow=true;group.add(sheep);const head=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8),mats.dark);head.position.set(sheep.position.x+.15,.35,sheep.position.z);group.add(head);}}
  if(h.terrain==='fields'){for(let i=0;i<5;i++){const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.56+rand()*.2,6),mats.grain);stalk.position.set((rand()-.5)*1.1,.45,(rand()-.5)*1.05);stalk.rotation.z=(rand()-.5)*.45;stalk.castShadow=true;group.add(stalk);const head=new THREE.Mesh(new THREE.ConeGeometry(.055,.16,5),mats.grain);head.position.set(stalk.position.x,.74,stalk.position.z);head.rotation.z=-.2;group.add(head);}}
  if(h.terrain==='hills'){for(let i=0;i<4;i++){const mound=new THREE.Mesh(new THREE.DodecahedronGeometry(.33+rand()*.1,0),new THREE.MeshStandardMaterial({color:i%2?0x9a6549:0x79513e,roughness:1}));mound.scale.y=.55;mound.position.set((rand()-.5)*1.0,.28,(rand()-.5)*1.0);mound.castShadow=true;group.add(mound);}}
  if(h.terrain==='mountains'){for(let i=0;i<3;i++){const peak=new THREE.Mesh(new THREE.ConeGeometry(.42-i*.05,.95+rand()*.28,6),new THREE.MeshStandardMaterial({color:[0x767974,0x99958a,0x5e6767][i],roughness:.95}));peak.position.set((i-1)*.34,.62,(rand()-.5)*.34);peak.castShadow=true;group.add(peak);const cap=new THREE.Mesh(new THREE.ConeGeometry(.16,.25,6),new THREE.MeshStandardMaterial({color:0xd7d0bb,roughness:1}));cap.position.set(peak.position.x,1.02,peak.position.z);group.add(cap);}}
  if(h.terrain==='desert'){for(let i=0;i<4;i++){const dune=new THREE.Mesh(new THREE.SphereGeometry(.36,12,8),new THREE.MeshStandardMaterial({color:i%2?0xc7aa6b:0xd9be82,roughness:1}));dune.scale.set(1.5,.22,.85);dune.position.set((rand()-.5)*.8,.24,(rand()-.5)*.8);dune.castShadow=true;group.add(dune);}const cactus=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,.48,7),new THREE.MeshStandardMaterial({color:0x58734d,roughness:1}));cactus.position.set(.52,.42,-.28);group.add(cactus);}
}
function addHex(h){
  const group=new THREE.Group();group.position.set(h.x,0,h.z);scene.add(group);
  const material=new THREE.MeshStandardMaterial({map:seedTexture(h.terrain),roughness:.96,flatShading:true});
  const tile=new THREE.Mesh(new THREE.CylinderGeometry(1.07,1.07,.3,6,1),material);tile.rotation.y=Math.PI/6;tile.position.y=0;tile.castShadow=true;tile.receiveShadow=true;tile.userData={kind:'tile',id:h.id};group.add(tile);tileMeshes.push(tile);
  const side=new THREE.Mesh(new THREE.CylinderGeometry(1.073,1.073,.3,6,1, true),new THREE.MeshStandardMaterial({color:0x715c36,roughness:1,side:THREE.DoubleSide}));side.rotation.y=Math.PI/6;group.add(side);
  terrainDetails(group,h);
  if(h.number){const chip=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,.045,32),new THREE.MeshStandardMaterial({color:0xd5c193,roughness:.76}));chip.position.set(.34,.47,-.34);chip.castShadow=true;group.add(chip);const label=new THREE.Mesh(new THREE.CircleGeometry(.25,32),new THREE.MeshBasicMaterial({map:labelTexture(h.number,h.number===6||h.number===8),transparent:true}));label.rotation.x=-Math.PI/2;label.position.set(.34,.5,-.34);group.add(label);}
}
function addNodeMarkers(){nodeMarkers=[];for(const n of boardData.nodes){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),new THREE.MeshBasicMaterial({color:0xffe0a0,transparent:true,opacity:.01,depthWrite:false}));mesh.position.set(n.x,.31,n.z);mesh.userData={kind:'node',id:n.id};scene.add(mesh);nodeMarkers.push(mesh);}}
function addEdgeMarkers(){edgeMarkers=[];for(const e of boardData.edges){const a=boardData.nodes[e.a],b=boardData.nodes[e.b];const mid=new THREE.Vector3((a.x+b.x)/2,.3,(a.z+b.z)/2);const d=new THREE.Vector3(b.x-a.x,0,b.z-a.z);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,d.length+.1,8),new THREE.MeshBasicMaterial({color:0xffdc86,transparent:true,opacity:.015,depthWrite:false}));mesh.position.copy(mid);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());mesh.userData={kind:'edge',id:e.id};scene.add(mesh);edgeMarkers.push(mesh);}}
function makeHouse(color,city=false){
  const g=new THREE.Group();const bodymat=new THREE.MeshStandardMaterial({color,roughness:.72});
  const body=new THREE.Mesh(new THREE.BoxGeometry(city?.38:.31,city?.45:.31,city?.36:.31),mats.woodLight);body.position.y=.28;body.castShadow=true;g.add(body);
  if(!city){const roof=new THREE.Mesh(new THREE.ConeGeometry(.28,.29,4),new THREE.MeshStandardMaterial({color,roughness:.82}));roof.position.y=.59;roof.rotation.y=Math.PI/4;roof.castShadow=true;g.add(roof);const door=new THREE.Mesh(new THREE.BoxGeometry(.07,.15,.015),mats.dark);door.position.set(0,.16,.16);g.add(door);}
  else {const tower=new THREE.Mesh(new THREE.BoxGeometry(.13,.38,.16),bodymat);tower.position.set(.18,.34,-.05);tower.castShadow=true;g.add(tower);const roof=new THREE.Mesh(new THREE.ConeGeometry(.14,.2,4),new THREE.MeshStandardMaterial({color,roughness:.8}));roof.position.set(.18,.64,-.05);roof.rotation.y=Math.PI/4;g.add(roof);const block=new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.4),mats.gold);block.position.set(0,.55,0);g.add(block);}
  return g;
}
function addRoad(p1,p2,color){const d=new THREE.Vector3(p2.x-p1.x,0,p2.z-p1.z);const road=new THREE.Mesh(new THREE.CylinderGeometry(.063,.063,d.length,10),new THREE.MeshStandardMaterial({color,roughness:.68,metalness:.05}));road.position.set((p1.x+p2.x)/2,.25,(p1.z+p2.z)/2);road.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());road.castShadow=true;return road;}
function addHarbors(){
  harborGroup=new THREE.Group();scene.add(harborGroup);
  boardData.harbors.forEach(h=>{const e=boardData.edges[h.edge],a=boardData.nodes[e.a],b=boardData.nodes[e.b],cx=(a.x+b.x)/2,cz=(a.z+b.z)/2;
    const dock=new THREE.Mesh(new THREE.BoxGeometry(.58,.1,.3),new THREE.MeshStandardMaterial({color:0x765333,roughness:.9}));dock.position.set(cx,.18,cz);dock.rotation.y=Math.atan2(b.z-a.z,b.x-a.x);dock.castShadow=true;harborGroup.add(dock);
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.48,7),mats.wood);mast.position.set(cx,.48,cz);harborGroup.add(mast);
    const sail=new THREE.Mesh(new THREE.ConeGeometry(.19,.32,3),new THREE.MeshStandardMaterial({color:0xe3d6b7,side:THREE.DoubleSide,roughness:1}));sail.position.set(cx+.06,.56,cz);sail.rotation.z=Math.PI/2;sail.rotation.y=Math.atan2(b.z-a.z,b.x-a.x);harborGroup.add(sail);
    const tag=sprite(h.resource?`2:1 ${h.resource.toUpperCase()}`:'3:1');tag.position.set(cx,.8,cz);tag.scale.set(.95,.25,1);harborGroup.add(tag);
  });
}
function sprite(text){const c=document.createElement('canvas');c.width=256;c.height=64;const x=c.getContext('2d');x.fillStyle='#211b11de';x.strokeStyle='#cfaf68';x.lineWidth=4;x.beginPath();x.roundRect(3,3,250,58,15);x.fill();x.stroke();x.fillStyle='#ead6a5';x.font='bold 23px Georgia';x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,34);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));return m;}
function addRobber(hexId){if(lastRobber)scene.remove(lastRobber);const h=boardData.hexes[hexId];const g=new THREE.Group();g.position.set(h.x,.52,h.z);const cloak=new THREE.Mesh(new THREE.ConeGeometry(.2,.63,7),new THREE.MeshStandardMaterial({color:0x26231e,roughness:.9}));cloak.position.y=.27;cloak.castShadow=true;g.add(cloak);const head=new THREE.Mesh(new THREE.SphereGeometry(.105,12,10),new THREE.MeshStandardMaterial({color:0x40372b}));head.position.y=.66;g.add(head);const staff=new THREE.Mesh(new THREE.CylinderGeometry(.025,.03,.86,7),mats.wood);staff.position.set(.2,.43,.05);staff.rotation.z=-.1;g.add(staff);const hood=new THREE.Mesh(new THREE.ConeGeometry(.13,.21,8),mats.dark);hood.position.y=.77;g.add(hood);scene.add(g);lastRobber=g;}
function createResourceModel(type){const group=new THREE.Group();
  if(type==='lumber'){for(let i=0;i<3;i++){const log=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.52,10),mats.woodLight);log.rotation.z=Math.PI/2;log.rotation.y=i*.45;log.position.set((i-1)*.05,.17+(i%2)*.08,0);log.castShadow=true;group.add(log);const end=new THREE.Mesh(new THREE.CircleGeometry(.065,12),new THREE.MeshStandardMaterial({color:0xc19a60}));end.rotation.y=Math.PI/2;end.position.set(.27+(i-1)*.05,.17+(i%2)*.08,0);group.add(end);}}
  if(type==='wool'){const sheep=new THREE.Group();for(let i=0;i<5;i++){const s=new THREE.Mesh(new THREE.IcosahedronGeometry(.11,1),mats.wool);s.position.set((i%3-.8)*.1,.18+(i>2?.05:0),i<3?-.05:.06);sheep.add(s);}const head=new THREE.Mesh(new THREE.SphereGeometry(.08,10,8),mats.dark);head.position.set(.2,.18,0);sheep.add(head);group.add(sheep);}
  if(type==='grain'){for(let i=0;i<5;i++){const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.48,6),mats.grain);stalk.position.set((i-2)*.07,.21,(i%2)*.04);stalk.rotation.z=(i-2)*.08;stalk.castShadow=true;group.add(stalk);const seed=new THREE.Mesh(new THREE.ConeGeometry(.05,.17,5),mats.grain);seed.position.set(stalk.position.x,.46,stalk.position.z);group.add(seed);}}
  if(type==='brick'){for(let i=0;i<5;i++){const brick=new THREE.Mesh(new THREE.BoxGeometry(.28,.13,.16),new THREE.MeshStandardMaterial({color:i%2?0xad6449:0x9a543d,roughness:.96}));brick.position.set((i%2)*.1-.05,.1+Math.floor(i/2)*.13,(Math.floor(i/2)%2)*.08);brick.castShadow=true;group.add(brick);}}
  if(type==='ore'){for(let i=0;i<3;i++){const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.21,0),new THREE.MeshStandardMaterial({color:[0x829399,0x6a747d,0xb19b65][i],roughness:.35,metalness:.38}));crystal.position.set((i-1)*.16,.24+(i%2)*.05,0);crystal.rotation.y=i*.6;crystal.castShadow=true;group.add(crystal);}}
  return group;
}
function buildResourceDock(){
  const slab=new THREE.Mesh(new THREE.BoxGeometry(5.4,.16,.56),new THREE.MeshStandardMaterial({color:0x403324,roughness:.9}));slab.position.set(0,.06,4.22);slab.castShadow=true;scene.add(slab);
  resourceGroups=[];resourceLabels=[];
  const dock=$('resourceDock');dock.replaceChildren();
  TYPES.forEach((t,i)=>{const x=(i-2)*1.04;const group=createResourceModel(t);group.position.set(x,.2,4.16);group.scale.set(.75,.75,.75);scene.add(group);resourceGroups.push(group);const chip=document.createElement('div');chip.className='resource-chip';chip.style.borderColor=resourceColor(t)+'72';chip.innerHTML=`<strong style="color:${resourceColor(t)}">${t.slice(0,3).toUpperCase()}</strong><span class="resource-count">0</span>`;dock.append(chip);resourceLabels.push(chip);});
}
const dieMatCache=new Map();
function dieMaterial(n){if(dieMatCache.has(n))return dieMatCache.get(n);const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#f0e3c6';x.fillRect(0,0,128,128);x.strokeStyle='#88724c';x.lineWidth=5;x.strokeRect(3,3,122,122);const positions={1:[[64,64]],2:[[34,34],[94,94]],3:[[32,32],[64,64],[96,96]],4:[[34,34],[94,34],[34,94],[94,94]],5:[[34,34],[94,34],[64,64],[34,94],[94,94]],6:[[34,30],[94,30],[34,64],[94,64],[34,98],[94,98]]};x.fillStyle='#34291b';for(const [px,py] of positions[n]){x.beginPath();x.arc(px,py,9,0,Math.PI*2);x.fill();}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=new THREE.MeshStandardMaterial({map:t,roughness:.47});dieMatCache.set(n,m);return m;}
function makeDie(value,x,z){const materials=[dieMaterial(4),dieMaterial(3),dieMaterial(1),dieMaterial(6),dieMaterial(2),dieMaterial(5)];const mesh=new THREE.Mesh(new THREE.BoxGeometry(.45,.45,.45),materials);mesh.position.set(x,.82,z);mesh.castShadow=true;scene.add(mesh);return mesh;}
function buildDice(){diceGroup=new THREE.Group();scene.add(diceGroup);dieMeshes=[makeDie(1,-.32,3.18),makeDie(1,.32,3.18)];}
function initBoard(data){if(boardReady)return;boardData=data;data.hexes.forEach(addHex);addNodeMarkers();addEdgeMarkers();addHarbors();addRobber(data.robber);buildResourceDock();buildDice();pieceGroup=new THREE.Group();scene.add(pieceGroup);boardReady=true;resizeRenderer();}
function updateBoard(g){if(!g?.board)return;if(!boardReady)initBoard(g.board);if(g.board.robber!==trackedRobber){addRobber(g.board.robber);trackedRobber=g.board.robber;}
  if(!pieceGroup)return;pieceGroup.clear();
  for(const p of g.players){for(const edgeId of p.roads){const e=boardData.edges[edgeId];pieceGroup.add(addRoad(boardData.nodes[e.a],boardData.nodes[e.b],p.color));}
    for(const [nodeId,type] of Object.entries(p.buildings)){const n=boardData.nodes[Number(nodeId)],house=makeHouse(p.color,type==='city');house.position.set(n.x,.22,n.z);pieceGroup.add(house);}
  }
  refreshMarkers(g);
}
function legalNode(g,n,type){const p=me();if(!p)return false;
  if(type==='settlement'){
    const setup=g.phase==='setup'&&g.activeId===myId&&g.setupAction==='settlement';
    const main=g.phase==='main'&&g.activeId===myId&&g.roll!==null&&Object.values(p.buildings).filter(b=>b==='settlement').length<5&&p.resources.lumber>=1&&p.resources.brick>=1&&p.resources.wool>=1&&p.resources.grain>=1;
    if(!setup&&!main)return false;if(g.players.some(pl=>pl.buildings[n.id]))return false;
    if(n.edges.some(eid=>{const e=boardData.edges[eid],other=e.a===n.id?e.b:e.a;return g.players.some(pl=>pl.buildings[other]);}))return false;
    return setup||n.edges.some(eid=>p.roads.includes(eid));
  }
  if(type==='city')return g.phase==='main'&&g.activeId===myId&&g.roll!==null&&p.buildings[n.id]==='settlement'&&Object.values(p.buildings).filter(b=>b==='city').length<4&&p.resources.grain>=2&&p.resources.ore>=3;
  return false;
}
function legalEdge(g,e,type){const p=me();if(!p)return false;const setup=g.phase==='setup'&&g.activeId===myId&&g.setupAction==='road';const free=g.phase==='roadBuilding'&&g.activeId===myId;const main=g.phase==='main'&&g.activeId===myId&&g.roll!==null&&p.resources.lumber>=1&&p.resources.brick>=1;if(!setup&&!free&&!main)return false;const eData=boardData.edges[e.id];if(p.roads.includes(e.id)||p.roads.length>=15)return false;return [eData.a,eData.b].some(n=>p.buildings[n]||(!g.players.some(pl=>pl!==p&&pl.buildings[n])&&boardData.nodes[n].edges.some(eid=>p.roads.includes(eid))));}
function refreshMarkers(g){
  if(!boardReady||!g)return;
  for(const m of nodeMarkers){const n=boardData.nodes[m.userData.id],showIt=(mode==='settlement'&&legalNode(g,n,'settlement'))||(mode==='city'&&legalNode(g,n,'city'));m.visible=showIt;m.material.opacity=showIt ? .34 : .005;m.material.color.set(mode==='city'?0xf2cb6c:0xffe3a8);}
  for(const m of edgeMarkers){const e=boardData.edges[m.userData.id],showIt=mode==='road'&&legalEdge(g,e,'road');m.visible=showIt;m.material.opacity=showIt ? .4 : .005;}
}
function resizeRenderer(){const stage=document.querySelector('.board-stage');if(!stage)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);const aspect=w/h,frustum=Math.max(10.2,10/aspect);camera.left=-frustum*aspect/2;camera.right=frustum*aspect/2;camera.top=frustum/2;camera.bottom=-frustum/2;camera.updateProjectionMatrix();}
window.addEventListener('resize',resizeRenderer);
function animate(){requestAnimationFrame(animate);const t=performance.now()*.001;resourceGroups.forEach((g,i)=>{g.position.y=.2+Math.sin(t*1.1+i)*.025;g.rotation.y=Math.sin(t*.35+i)*.08;});if(lastRobber){lastRobber.position.y=.52+Math.sin(t*1.7)*.025;lastRobber.rotation.y=Math.sin(t*.5)*.09;}renderer.render(scene,camera);}
animate();
function updateResourceCounts(resources){resourceLabels.forEach((chip,i)=>{const span=chip.querySelector('.resource-count');if(span)span.textContent=resources[TYPES[i]]||0;});}
function rollAnimation(dice){
  $('diceResult').classList.remove('hidden');$('diceTotal').textContent=String(dice[0]+dice[1]);$('diceCaption').textContent=dice[0]+dice[1]===7?'THE ROBBER STIRS':'THE HARVEST';
  const start=performance.now(),duration=850;function spin(now){const p=Math.min(1,(now-start)/duration);const ease=1-Math.pow(1-p,3);dieMeshes.forEach((d,i)=>{d.rotation.x=(1-ease)*Math.PI*(4+i);d.rotation.y=(1-ease)*Math.PI*(3+i*2);d.rotation.z=(1-ease)*Math.PI*(2+i);});if(p<1)requestAnimationFrame(spin);else{const normals={1:new THREE.Vector3(0,1,0),2:new THREE.Vector3(0,0,1),3:new THREE.Vector3(-1,0,0),4:new THREE.Vector3(1,0,0),5:new THREE.Vector3(0,0,-1),6:new THREE.Vector3(0,-1,0)};dieMeshes.forEach((d,i)=>{const orient=new THREE.Quaternion().setFromUnitVectors(normals[dice[i]],new THREE.Vector3(0,1,0));const yaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.4+i*1.1);d.quaternion.copy(yaw.multiply(orient));});if(audioSynth)audioSynth.triggerAttackRelease(['C4','G4','D5'],.2);}}
  spin(start);setTimeout(()=>{if(snapshot?.game?.roll) $('diceResult').classList.add('hidden');},2600);
}
canvas.addEventListener('pointerdown',e=>{
  if(!snapshot?.game||!boardReady)return;const rect=canvas.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);
  const g=snapshot.game;let targets=[];
  if(mode==='road')targets=edgeMarkers.filter(m=>m.visible);else if(mode==='settlement'||mode==='city')targets=nodeMarkers.filter(m=>m.visible);else if(g.phase==='robber'&&g.activeId===myId)targets=tileMeshes.filter(m=>m.userData.id!==g.robber);
  const hit=raycaster.intersectObjects(targets,false)[0];if(!hit)return;const obj=hit.object;
  if(obj.userData.kind==='node'){if(mode==='city'){socket.emit('buildCity',{nodeId:obj.userData.id});mode=null;}else if(mode==='settlement'){socket.emit('placeSettlement',{nodeId:obj.userData.id});mode=null;}}
  else if(obj.userData.kind==='edge'){socket.emit('placeRoad',{edgeId:obj.userData.id,free:g.phase==='roadBuilding'});if(g.phase!=='roadBuilding')mode=null;}
  else if(obj.userData.kind==='tile'){chooseRobberVictim(obj.userData.id);}
  updateMode();
});
function chooseRobberVictim(hexId){const g=snapshot.game,h=g.board.hexes[hexId];const victims=g.players.filter(p=>p.id!==myId&&h.nodes.some(n=>p.buildings[n])&&p.resourceCount>0);if(victims.length<2){socket.emit('moveRobber',{hexId,targetId:victims[0]?.id});mode=null;return;}showModal(`<button class="modal-close" data-close>×</button><p class="eyebrow">A NEIGHBOURING HOLD</p><h2>Choose whom to rob</h2><p>Whose stores shall the robber raid?</p><div class="modal-actions">${victims.map(p=>`<button class="button button-outline" data-victim="${p.id}">${escapeText(p.name)}</button>`).join('')}</div>`);$('modal').querySelectorAll('[data-victim]').forEach(b=>b.onclick=()=>{socket.emit('moveRobber',{hexId,targetId:b.dataset.victim});mode=null;closeModal();});}

async function toggleMusic(){
  try{
    Tone ||= await import('/node_modules/tone/build/esm/index.js');
    await Tone.start();if(!audioSynth){audioSynth=new Tone.PolySynth(Tone.Synth,{oscillator:{type:'triangle'},envelope:{attack:.08,decay:.24,sustain:.2,release:1.1}});const reverb=new Tone.Reverb({decay:3.4,wet:.42}).toDestination();audioSynth.connect(reverb);audioSynth.volume.value=-19;}
    if(audioOn){Tone.Transport.stop();if(musicLoop)musicLoop.dispose();musicLoop=null;audioOn=false;$('musicToggle').classList.remove('music-on');toast('The minstrels fall quiet.');return;}
    const notes=['G4','D5','B4','D5','A4','E5','C5','D5','G4','B4','D5','B4','A4','D5','F#5','E5'];
    musicLoop=new Tone.Sequence((time,note)=>audioSynth.triggerAttackRelease(note,'8n',time,.2),notes,'2n');musicLoop.loop=true;musicLoop.start(0);Tone.Transport.bpm.value=78;Tone.Transport.start();audioOn=true;$('musicToggle').classList.add('music-on');toast('The minstrels begin a quiet medieval refrain.');
  }catch(err){console.error(err);toast('Audio could not start in this browser.');}
}

