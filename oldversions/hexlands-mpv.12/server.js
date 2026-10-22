const http=require('http'),fs=require('fs'),vm=require('vm'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,HTML=path.join(__dirname,'public','index.html'),SHIM=path.join(__dirname,'engine-shim.js');
const rooms=new Map(),rnd=n=>Math.random()*n|0,tok=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const PAL=['#d63a3a','#3a6fd6','#f08a24','#eeeeee','#3aa356','#8e5bd6','#f2d33a','#20b2aa','#ee82b8','#8b5a2b','#9ad63a','#4a4f5a'],COL=PAL.slice(0,6),NM=['Host','Sir Bot','Lady Bot','Baron Bot','Dame Bot','Duke Bot'],MAPN=['std','uk','usa','isl','rand'];
const send=(ws,o)=>ws.readyState==1&&ws.send(JSON.stringify(o));

/* One isolated copy of the game engine per room, running the same script the browser uses,
   with a stub DOM. Only this server ever sees every player's hidden cards. */
function mkCtx(r){const els=new Map(),el=id=>{let e=els.get(id);if(!e){e={innerHTML:'',textContent:'',hidden:false,value:'',checked:false,style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})};els.set(id,e)}return e};
const sb={console,setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){},__sync:()=>sync(r),__botChat:(i,a)=>botChat(r,i,a),document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('_'+tok())}};sb.window=sb;
const ctx=vm.createContext(sb),src=/<script id="engine">([\s\S]*?)<\/script>/.exec(fs.readFileSync(HTML,'utf8'))[1];
vm.runInContext(src+'\n'+fs.readFileSync(SHIM,'utf8'),ctx);ctx.el=el;return ctx}

function sync(r){if(!r.live)return;r.gs.forEach((s,i)=>s.ws&&s.ws.readyState==1&&s.ws.send('{"t":"state","host":'+(s===r.seats[0])+',"s":'+r.ctx.__snap(i)+'}'))}
function botChat(r,i,action){if(!r.bc||Math.random()>.34)return;const now=Date.now();if(now-(r.botChatAt||0)<12000)return;r.botChatAt=now;const p=r.gs[i],name=p&&p.name||("Bot "+(i+1)),color=p&&p.color||"#e9c46a",a=String(action||"").toLowerCase(),groups=a.includes("built")?["A fine addition to the realm.","Stone by stone, our fortunes rise.","The island is taking shape."]:a.includes("stole")||a.includes("robber")?["The roads are perilous tonight.","A shadow falls across the island.","Keep your stores close, friends."]:["A promising turn for the kingdom.","Well played, fellow settlers.","May fortune favor our next roll.","The market is lively today.","A steady hand wins the day."];const msg={t:"chat",n:name,c:color,x:groups[rnd(groups.length)]};r.chat.push(msg);if(r.chat.length>60)r.chat.shift();r.seats.forEach(q=>q.ws&&send(q.ws,msg))}function lobby(r){r.seats.forEach((s,i)=>s.ws&&send(s.ws,{t:'lobby',code:r.code,vp:r.vp,dc:r.dc,pub:r.pub,bc:r.bc,map:r.map,rt:r.rt,tt:r.tt,you:i,seats:r.seats.map(x=>({k:x.k,name:x.name,color:x.color,on:!!x.ws}))}))}
function attach(ws,r,seat){if(seat.ws&&seat.ws!==ws)seat.ws.close();seat.ws=ws;seat.gone=0;ws.r=r;ws.seat=seat;clearTimeout(r.gc);send(ws,{t:'joined',code:r.code,token:seat.token});send(ws,{t:'chatlog',m:r.chat||[]});
if(r.live){const i=r.gs.indexOf(seat);ws.send('{"t":"start","me":'+i+',"geo":'+r.ctx.__geo()+'}');ws.send('{"t":"state","host":'+(seat===r.seats[0])+',"s":'+r.ctx.__snap(i)+'}')}else lobby(r)}
function startGame(r){fixColors(r);const gs=r.seats.filter(s=>s.k=='human'||s.k=='bot');if(gs.length<3)return send(r.seats[0].ws,{t:'err',m:'Need at least 3 players (add bots)'});
r.gs=gs;r.afkN=[];r.tks={};r.ctx=mkCtx(r);const e=r.ctx.el;e('np').value=gs.length;gs.forEach((s,i)=>{e('n'+i).value=s.name;e('c'+i).value=s.color;e('a'+i).value=s.k=='bot'?'1':'0'});e('map').value=r.map;e('vp').value=r.vp;e('dc').checked=r.dc;e('mu').checked=false;
r.ctx.start();r.live=1;gs.forEach((s,i)=>s.ws&&s.ws.send('{"t":"start","me":'+i+',"geo":'+r.ctx.__geo()+'}'));sync(r)}

/* Humans always get the color they pick; a bot holding it is re-rolled to a random free palette color. */
function fixColors(r){const act=r.seats.filter(s=>s.k=='human'||s.k=='bot'),used=new Set();
[...act.filter(s=>s.k=='human'),...act.filter(s=>s.k=='bot')].forEach(s=>{if(used.has(s.color)){const free=PAL.filter(c=>!used.has(c)&&!act.some(x=>x!==s&&x.color==c));if(free.length)s.color=free[rnd(free.length)]}used.add(s.color)})}
function handle(ws,m){const r=ws.r;
if(m.t=='create'){const code=[...Array(4)].map(()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(24)]).join('');
const rm={code,vp:10,dc:true,pub:false,bc:false,rt:30,tt:90,live:0,gs:[],afkN:[],tks:{},map:'std',chat:[],seats:['human','open','bot','bot','closed','closed'].map((k,i)=>({k,name:i?NM[i]:String(m.name||'Host').slice(0,14),color:COL[i],token:null,ws:null}))};
rm.seats[0].token=tok();rooms.set(code,rm);return attach(ws,rm,rm.seats[0])}
if(m.t=='join'){const rm=rooms.get(String(m.code||'').toUpperCase());if(!rm)return send(ws,{t:'err',m:'Room not found'});
const s=rm.seats.find(x=>x.k=='open');if(!s||rm.live)return send(ws,{t:'err',m:'Room is full or already started'});
s.k='human';s.name=String(m.name||'Guest').slice(0,14);s.token=tok();fixColors(rm);return attach(ws,rm,s)}
if(m.t=='resume'){const rm=rooms.get(m.code),s=rm&&rm.seats.find(x=>x.token&&x.token==m.token);if(!s)return send(ws,{t:'err',m:'gone'});return attach(ws,rm,s)}
if(m.t=='list'){const q=String(m.q||'').toLowerCase();return send(ws,{t:'rooms',rooms:[...rooms.values()].filter(x=>x.pub&&!x.live&&x.seats.some(s=>s.k=='open')&&(x.code.toLowerCase().includes(q)||x.seats[0].name.toLowerCase().includes(q))).slice(0,30).map(x=>({code:x.code,host:x.seats[0].name,humans:x.seats.filter(s=>s.k=='human').length,open:x.seats.filter(s=>s.k=='open').length,vp:x.vp}))})}
if(!r)return;const s=ws.seat;
if(m.t=='chat'){if(!r.live)return;const now=Date.now();ws.cl=(ws.cl||[]).filter(t=>now-t<8000);if(ws.cl.length>=5)return;ws.cl.push(now);
const x=String(m.x||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,200);if(!x)return;
const msg={t:'chat',n:s.name,c:s.color,x};r.chat.push(msg);if(r.chat.length>60)r.chat.shift();r.seats.forEach(q=>q.ws&&send(q.ws,msg));return}
if(!r.live){
if(m.t=='me'){s.name=String(m.name||s.name).slice(0,14);if(PAL.includes(m.color)&&!r.seats.some(x=>x!==s&&x.k=='human'&&x.color==m.color)){s.color=m.color;fixColors(r)}}
else if(m.t=='cfg'&&s==r.seats[0]){r.map=MAPN.includes(m.map)?m.map:'std';[1,2,3,4,5].forEach(i=>{const k=m.seats&&m.seats[i-1];if(['open','bot','closed'].includes(k)&&r.seats[i].k!='human')r.seats[i].k=k});fixColors(r);r.vp=Math.max(5,Math.min(15,+m.vp||10));r.dc=!!m.dc;r.pub=!!m.pub;r.bc=!!m.bc;r.rt=Math.max(0,Math.min(600,+m.rt||0));r.tt=Math.max(0,Math.min(900,+m.tt||0))}
else if(m.t=='start'&&s==r.seats[0])return startGame(r);
return lobby(r)}
if(m.t=='botify'&&s==r.seats[0]){const t=r.gs[+m.seat];if(t&&t.k=='human'&&t!==s){t.k='bot';t.orig='human';r.ctx.__bot(+m.seat)}return}
const gi=r.gs.indexOf(s);if(m.t=='leave'){if(r.paused&&s==r.seats[0])unpause(r);if(gi>=0&&s.k=='human'){s.k='bot';s.orig='human';r.ctx.__bot(gi);r.ctx.__note(s.name+' left the game; a bot took over')}return}
if(m.t=='hpause'&&s==r.seats[0]&&!r.paused){r.paused=1;r.pausedAt=Date.now();r.ctx.__hp(1);return}
if(m.t=='hresume'&&s==r.seats[0]&&r.paused){unpause(r);return}
if(m.t=='back'){if(gi>=0){if(s.k=='bot'&&s.orig=='human')s.k='human';r.afkN[gi]=0;r.ctx.__back(gi)}return}
if(gi>=0){r.afkN[gi]=0;r.ctx.__do(gi,m)}}

const PUB=path.join(__dirname,'public'),NODE_MODULES=path.join(__dirname,'node_modules'),MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg'};
try{if(!/<script id="engine">/.test(fs.readFileSync(HTML,'utf8')))throw Error('public/index.html has no <script id="engine"> (wrong or edited file?)')}catch(e){console.error('STARTUP CHECK FAILED:',e.message,'\nExpected layout: server.js, engine-shim.js, package.json and public/index.html side by side.');process.exit(1)}
const srv=http.createServer((q,res)=>{try{const u=decodeURIComponent(q.url.split('?')[0]);if(u=='/healthz'){res.writeHead(200);return res.end('ok')}
const base=u.startsWith('/node_modules/')?NODE_MODULES:PUB,rel=u.startsWith('/node_modules/')?u.slice('/node_modules/'.length):(u=='/'?'index.html':u.replace(/^\/+/,'')),f=path.resolve(base,rel);if(!(f===base||f.startsWith(base+path.sep))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(f))}catch(e){console.error(e);res.writeHead(500);res.end('Server error')}});
const wss=new WebSocketServer({server:srv,maxPayload:4096});
wss.on('connection',ws=>{ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true});
ws.on('message',d=>{try{handle(ws,JSON.parse(d))}catch(e){console.error(e)}});
ws.on('close',()=>{const r=ws.r;if(!r)return;if(ws.seat.ws===ws){ws.seat.ws=null;ws.seat.gone=Date.now();if(!r.live)lobby(r)}
if(!r.seats.some(s=>s.ws))r.gc=setTimeout(()=>{if(r.ctx)vm.runInContext('G&&clearTimeout(G.tm);G&&(G.over=1)',r.ctx);rooms.delete(r.code)},30*60*1000)})});
/* AFK protection: dice/quick-action timer (rt) and turn timer (tt). On expiry a prompt is auto-resolved or a bot finishes the turn;
   three timeouts in a row replace the player with a bot. */
function unpause(r){const d=Date.now()-r.pausedAt;Object.keys(r.tks).forEach(k=>r.tks[k]+=d);r.paused=0;r.ctx.__hp(0)}
function afk(r,i){const s=r.gs[i];r.afkN[i]=(r.afkN[i]||0)+1;if(s.k=='human'&&r.afkN[i]>=3){s.k='bot';s.orig='human';r.ctx.__bot(i);r.ctx.__note(s.name+' kept timing out and was replaced by a bot')}else r.ctx.__afk(i)}
setInterval(()=>rooms.forEach(r=>{if(!r.live)return;try{if(r.paused){if(!r.seats[0].ws&&Date.now()-(r.seats[0].gone||0)>60000)unpause(r);const j0=JSON.stringify({t:'tm',i:-1});r.gs.forEach(s=>s.ws&&s.ws.readyState==1&&s.ws.send(j0));return}const x=r.ctx.__tk(),now=Date.now();let m={t:'tm',i:-1};
const sg=r.ctx.__sig();if(sg!==r.sg){r.sg=sg;r.sgt=now}else if(now-(r.sgt||now)>30000&&r.ctx.__aiTurn()){r.sgt=now;r.ctx.__unstick()}
if(x&&x.i>=0&&r.gs.filter(s=>s.k=='human').length>1){const sx=r.gs[x.i];if(sx.k=='human'&&!sx.ws&&Date.now()-(sx.gone||0)>5000)r.ctx.__afk(x.i,' left the game');else{if(!(x.k in r.tks)){if(Object.keys(r.tks).length>60)r.tks={};r.tks[x.k]=now}
const lim=(x.q?r.rt:r.tt)*1000;if(lim){const left=lim-(now-r.tks[x.k]);m={t:'tm',i:x.i,left:Math.max(0,Math.ceil(left/1000)),lim:lim/1000};if(left<=0){r.tks[x.k]=now;afk(r,x.i)}}}}
const j=JSON.stringify(m);r.gs.forEach(s=>s.ws&&s.ws.readyState==1&&s.ws.send(j))}catch(e){console.error(e)}}),1000);
/* keep-alives: app-level heartbeat every 5 s, protocol ping every 20 s (drops dead sockets) */
setInterval(()=>rooms.forEach(r=>r.seats.forEach(s=>s.ws&&send(s.ws,{t:'hb'}))),5000);
setInterval(()=>{if(wss.clients)wss.clients.forEach(c=>{if(c.isAlive===false)return c.terminate();c.isAlive=false;try{c.ping()}catch(e){}})},20000);
srv.listen(PORT,'0.0.0.0',()=>console.log('Hexlands server on http://localhost:'+PORT));
