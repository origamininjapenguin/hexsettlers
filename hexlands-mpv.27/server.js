const http=require('http'),fs=require('fs'),vm=require('vm'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,HTML=path.join(__dirname,'public','index.html'),SHIM=path.join(__dirname,'engine-shim.js');
const rooms=new Map(),rnd=n=>Math.random()*n|0,tok=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const PAL=['#d63a3a','#3a6fd6','#f08a24','#eeeeee','#3aa356','#8e5bd6','#f2d33a','#20b2aa','#ee82b8','#8b5a2b','#9ad63a','#4a4f5a'],COL=PAL.slice(0,6),NM=['Host','Sir Bot','Lady Bot','Baron Bot','Dame Bot','Duke Bot'],MAPN=['std','uk','usa','isl','rand'];
const send=(ws,o)=>ws.readyState==1&&ws.send(JSON.stringify(o));
const onlineSpectators=r=>r.spectators.filter(x=>x.ws&&x.ws.readyState==1).map(x=>x.name);const broadcast=(r,o)=>{r.seats.forEach(x=>x.ws&&send(x.ws,o));r.spectators.forEach(x=>x.ws&&send(x.ws,o))};

/* One isolated copy of the game engine per room, running the same script the browser uses,
   with a stub DOM. Only this server ever sees every player's hidden cards. */
function mkCtx(r){const els=new Map(),el=id=>{let e=els.get(id);if(!e){e={innerHTML:'',textContent:'',hidden:false,value:'',checked:false,style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})};els.set(id,e)}return e};
const sb={console,setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){},__sync:()=>sync(r),__botChat:(i,a)=>botChat(r,i,a),document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('_'+tok())}};sb.window=sb;
const ctx=vm.createContext(sb),src=/<script id="engine">([\s\S]*?)<\/script>/.exec(fs.readFileSync(HTML,'utf8'))[1];
vm.runInContext(src+'\n'+fs.readFileSync(SHIM,'utf8'),ctx);ctx.el=el;return ctx}

function sync(r){if(!r.live)return;r.gs.forEach((x,i)=>x.ws&&send(x.ws,{t:"state",host:x===r.seats[0],s:JSON.parse(r.ctx.__snap(i))}));r.spectators.forEach(x=>x.ws&&send(x.ws,{t:"state",host:false,s:JSON.parse(r.ctx.__snap(-1))}))}
function botChat(r,i,action){
if(!r.bc||Math.random()>.45)return;
const now=Date.now();if(now-(r.botChatAt||0)<7000)return;
const bots=r.gs.map((p,index)=>({p,index})).filter(x=>x.p&&x.p.ai);if(!bots.length)return;
let speakers=bots.filter(x=>x.index!==r.botChatLastSpeaker);if(!speakers.length)speakers=bots;
const speaker=speakers[rnd(speakers.length)],p=speaker.p,a=String(action||'').toLowerCase();
const lines={
build:['Another stone in our foundation.','A sturdy road, well laid.','Our settlement grows stronger.','The island yields to patience.','Good work; that will serve us well.','One step closer to a fair kingdom.','These lands are taking shape.','May this hold fast through winter.','Fine craftsmanship, friend.','Prosperity begins with good roads.','Well placed; we shall prosper.','The realm grows, one timber at a time.'],
robber:['The robber rides again!','A shadow falls upon the island.','Keep your stores close, good folk.','The roads grow dangerous.','May the watch find the culprit.','An ill wind crosses these fields.','Let us hope the robber moves on.','That hex is no longer safe.','The bandit has found a new haunt.','Guard the granaries tonight.'],
trade:['A fair bargain for honest folk.','Gold may glitter, but wheat feeds us.','Every good market needs patience.','Let both our stores prosper.','The caravan brought useful tidings.','An exchange worthy of the guild.','That seems a fair trade.','Trade makes neighbors of rivals.','May the merchant’s scales be true.','Prosperity follows a balanced ledger.'],
roll:['The dice have spoken.','Fortune turns with every throw.','A bold roll, by the saints.','May the next throw favor us.','Those bones tumble like autumn leaves.','The gods of chance are fickle.','A number worth remembering.','I’ll take that as an omen.','Luck favors the watchful.','Another throw, another chance.'],
card:['An intriguing card from the guild.','Knowledge is a weapon of its own.','The council has plans in motion.','Such a card may change our fortunes.','The scholars keep busy.'],
general:['A promising turn for the kingdom.','Well played, fellow settlers.','May fortune favor our next roll.','The market is lively today.','A steady hand wins the day.','The hearth is warm, and the island is ours to shape.','By the old stones, we shall prosper.','A quiet moment before the next contest.','May your roads be safe and your stores be full.','The council will remember this day.','A fine evening for a little commerce.','Our fortunes rise and fall like the tide.','The island rewards a patient heart.','I hear the harbor bells; a good omen.','Let us build a realm worth singing of.','The old songs say fortune favors the bold.']
};
let group=lines.general;if(a.includes('built')||a.includes('settlement')||a.includes('city')||a.includes('road'))group=lines.build;else if(a.includes('robber')||a.includes('stole')||a.includes('steal'))group=lines.robber;else if(a.includes('trade')||a.includes('traded')||a.includes('bank'))group=lines.trade;else if(a.includes('roll'))group=lines.roll;else if(a.includes('development')||a.includes('card'))group=lines.card;
const choices=group.filter(x=>x!==r.botChatLastLine),line=choices[rnd(choices.length)]||group[0];r.botChatAt=now;r.botChatLastSpeaker=speaker.index;r.botChatLastLine=line;
const msg={t:'chat',n:p.name||'Bot '+(speaker.index+1),c:p.color||'#e9c46a',x:line};r.chat.push(msg);if(r.chat.length>60)r.chat.shift();broadcast(r,msg)
}
function lobby(r){r.seats.forEach((s,i)=>s.ws&&send(s.ws,{t:"lobby",code:r.code,vp:r.vp,dc:r.dc,pub:r.pub,bc:r.bc,map:r.map,rt:r.rt,tt:r.tt,allowSpectators:r.allowSpectators,spectatorChat:r.spectatorChat,announceSpectators:r.announceSpectators,spectators:r.announceSpectators?onlineSpectators(r):[],you:i,seats:r.seats.map(x=>({k:x.k,name:x.name,color:x.color,on:!!x.ws,ready:x.k=="human"&&!!x.ready}))}));r.spectators.forEach(x=>x.ws&&send(x.ws,{t:"lobby",code:r.code,pub:r.pub,live:r.live,allowSpectators:r.allowSpectators,spectatorChat:r.spectatorChat,announceSpectators:r.announceSpectators,spectators:r.announceSpectators?onlineSpectators(r):[],seats:r.seats.map(x=>({k:x.k,name:x.name,color:x.color,on:!!x.ws,ready:x.k=="human"&&!!x.ready}))}))}
function attach(ws,r,seat){if(seat.ws&&seat.ws!==ws)seat.ws.close();seat.ws=ws;seat.gone=0;if(!r.live)seat.ready=false;ws.r=r;ws.seat=seat;ws.spectator=null;clearTimeout(r.gc);send(ws,{t:"joined",code:r.code,token:seat.token,role:"player"});send(ws,{t:"chatlog",m:r.chat||[]});if(r.live){send(ws,{t:"spectators",list:onlineSpectators(r)});const i=r.gs.indexOf(seat);send(ws,{t:"start",me:i,geo:r.ctx.__geo(),role:"player"});send(ws,{t:"state",host:seat===r.seats[0],s:JSON.parse(r.ctx.__snap(i))})}else lobby(r)}
function announceSpectator(r,spec){const msg={t:"chat",n:"Spectators",c:"#e9c46a",x:spec.name+" joined as a spectator."};r.chat.push(msg);if(r.chat.length>60)r.chat.shift();broadcast(r,msg)}
function attachSpectator(ws,r,spec){if(spec.ws&&spec.ws!==ws)spec.ws.close();clearTimeout(spec.gc);spec.ws=ws;spec.gone=0;ws.r=r;ws.seat=null;ws.spectator=spec;clearTimeout(r.gc);send(ws,{t:"joined",code:r.code,token:spec.token,role:"spectator",chat:r.spectatorChat});send(ws,{t:"chatlog",m:r.chat||[]});if(r.live){send(ws,{t:"start",me:-1,geo:r.ctx.__geo(),role:"spectator",chat:r.spectatorChat});send(ws,{t:"state",host:false,s:JSON.parse(r.ctx.__snap(-1))});if(r.announceSpectators&&!spec.announced){announceSpectator(r,spec);spec.announced=true}}broadcast(r,{t:"spectators",list:onlineSpectators(r)});if(!r.live)lobby(r)}
function startGame(r){const humans=r.seats.filter(s=>s.k=='human'),waiting=humans.filter(s=>!s.ws||(humans.length>1&&!s.ready));if(waiting.length)return send(r.seats[0].ws,{t:'err',m:'Every human player must be connected and ready before the host can start.'});fixColors(r);const gs=r.seats.filter(s=>s.k=='human'||s.k=='bot');if(gs.length<3)return send(r.seats[0].ws,{t:'err',m:'Need at least 3 players (add bots)'});
r.gs=gs;r.afkN=[];r.tks={};r.ctx=mkCtx(r);const e=r.ctx.el;e('np').value=gs.length;gs.forEach((s,i)=>{e('n'+i).value=s.name;e('c'+i).value=s.color;e('a'+i).value=s.k=='bot'?'1':'0'});e('map').value=r.map;e('vp').value=r.vp;e('dc').checked=r.dc;e('mu').checked=false;
r.ctx.start();r.live=1;gs.forEach((s,i)=>s.ws&&send(s.ws,{t:"start",me:i,geo:r.ctx.__geo(),role:"player"}));r.spectators.forEach(x=>{if(x.ws){send(x.ws,{t:"start",me:-1,geo:r.ctx.__geo(),role:"spectator",chat:r.spectatorChat});if(r.announceSpectators&&!x.announced){announceSpectator(r,x);x.announced=true}}});broadcast(r,{t:"spectators",list:onlineSpectators(r)});sync(r)}

/* Humans always get the color they pick; a bot holding it is re-rolled to a random free palette color. */
function fixColors(r){const act=r.seats.filter(s=>s.k=='human'||s.k=='bot'),used=new Set();
[...act.filter(s=>s.k=='human'),...act.filter(s=>s.k=='bot')].forEach(s=>{if(used.has(s.color)){const free=PAL.filter(c=>!used.has(c)&&!act.some(x=>x!==s&&x.color==c));if(free.length)s.color=free[rnd(free.length)]}used.add(s.color)})}
function handle(ws,m){const r=ws.r;
if(m.t=='create'){const code=[...Array(4)].map(()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(24)]).join('');
const rm={code,vp:10,dc:true,pub:false,bc:false,allowSpectators:false,spectatorChat:false,announceSpectators:false,rt:30,tt:90,live:0,gs:[],spectators:[],afkN:[],tks:{},map:'std',chat:[],seats:['human','open','bot','bot','closed','closed'].map((k,i)=>({k,name:i?NM[i]:String(m.name||'Host').slice(0,14),color:COL[i],token:null,ws:null,ready:false}))};
rm.seats[0].token=tok();rooms.set(code,rm);return attach(ws,rm,rm.seats[0])}
if(m.t=='join'||m.t=='spectate'){const rm=rooms.get(String(m.code||'').toUpperCase());if(!rm)return send(ws,{t:'err',m:'Room not found'});const wantsSpectator=m.t=='spectate'||m.role=='spectator';if(wantsSpectator){if(!rm.allowSpectators)return send(ws,{t:'err',m:'This room does not allow spectators'});if(rm.spectators.length>=24)return send(ws,{t:'err',m:'This room has reached its spectator limit'});const spec={name:String(m.name||'Guest').slice(0,14),token:tok(),ws:null,announced:false};rm.spectators.push(spec);return attachSpectator(ws,rm,spec)}const seat=!rm.live&&rm.seats.find(x=>x.k=='open');if(seat){seat.k='human';seat.ready=false;seat.name=String(m.name||'Guest').slice(0,14);seat.token=tok();fixColors(rm);return attach(ws,rm,seat)}if(rm.allowSpectators)return send(ws,{t:'spectator-offer',code:rm.code,name:String(m.name||'Guest').slice(0,14),reason:rm.live?'The game has already started.':'The player seats are full.'});return send(ws,{t:'err',m:'Room is full or already started'})}
if(m.t=='resume'){const rm=rooms.get(m.code);if(!rm)return send(ws,{t:'err',m:'gone'});const seat=rm.seats.find(x=>x.token&&x.token==m.token);if(seat)return attach(ws,rm,seat);const spec=rm.spectators.find(x=>x.token&&x.token==m.token);if(spec)return attachSpectator(ws,rm,spec);return send(ws,{t:'err',m:'gone'})}
if(m.t=='list'){const q=String(m.q||'').toLowerCase();return send(ws,{t:'rooms',rooms:[...rooms.values()].filter(x=>x.pub&&((!x.live&&x.seats.some(s=>s.k=='open'))||x.allowSpectators)&&(x.code.toLowerCase().includes(q)||x.seats[0].name.toLowerCase().includes(q))).slice(0,30).map(x=>({code:x.code,host:x.seats[0].name,humans:x.seats.filter(s=>s.k=='human').length,open:x.live?0:x.seats.filter(s=>s.k=='open').length,live:!!x.live,allowSpectators:x.allowSpectators,spectators:onlineSpectators(x).length,vp:x.vp}))})}
if(!r)return;if(m.t=="spectate-leave"&&ws.spectator){const spec=ws.spectator;clearTimeout(spec.gc);r.spectators=r.spectators.filter(x=>x!==spec);ws.r=null;ws.spectator=null;send(ws,{t:"left"});broadcast(r,{t:"spectators",list:onlineSpectators(r)});if(!r.live)lobby(r);return}const s=ws.seat;
if(m.t=='chat'){if(!r.live||(ws.spectator&&!r.spectatorChat))return;const now=Date.now();ws.cl=(ws.cl||[]).filter(t=>now-t<8000);if(ws.cl.length>=5)return;ws.cl.push(now);
const x=String(m.x||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,200);if(!x)return;
const msg={t:'chat',n:ws.spectator?ws.spectator.name:s.name,c:ws.spectator?'#e9c46a':s.color,x};r.chat.push(msg);if(r.chat.length>60)r.chat.shift();broadcast(r,msg);return}if(ws.spectator)return;
if(!r.live){
if(m.t=='me'){s.name=String(m.name||s.name).slice(0,14);if(PAL.includes(m.color)&&!r.seats.some(x=>x!==s&&x.k=='human'&&x.color==m.color)){s.color=m.color;fixColors(r)}}
else if(m.t=='cfg'&&s==r.seats[0]){r.seats.forEach(x=>{if(x.k=='human')x.ready=false});r.map=MAPN.includes(m.map)?m.map:'std';[1,2,3,4,5].forEach(i=>{const k=m.seats&&m.seats[i-1];if(['open','bot','closed'].includes(k)&&r.seats[i].k!='human'){r.seats[i].k=k;r.seats[i].ready=false}});fixColors(r);r.vp=Math.max(5,Math.min(15,+m.vp||10));r.dc=!!m.dc;r.pub=!!m.pub;r.bc=!!m.bc;r.allowSpectators=!!m.allowSpectators;r.spectatorChat=!!m.spectatorChat;r.announceSpectators=!!m.announceSpectators;r.rt=Math.max(0,Math.min(600,+m.rt||0));r.tt=Math.max(0,Math.min(900,+m.tt||0))}
else if(m.t=='ready'&&s.k=='human')s.ready=!!m.ready;
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
ws.on('close',()=>{const r=ws.r;if(!r)return;if(ws.seat&&ws.seat.ws===ws){ws.seat.ws=null;ws.seat.gone=Date.now();if(!r.live){ws.seat.ready=false;lobby(r)}}if(ws.spectator&&ws.spectator.ws===ws){const spec=ws.spectator;spec.ws=null;spec.gone=Date.now();spec.gc=setTimeout(()=>{if(!spec.ws){r.spectators=r.spectators.filter(x=>x!==spec);broadcast(r,{t:'spectators',list:onlineSpectators(r)});if(!r.live)lobby(r)}},120000);broadcast(r,{t:'spectators',list:onlineSpectators(r)});if(!r.live)lobby(r)}if(!r.seats.some(x=>x.ws)&&!r.spectators.some(x=>x.ws))r.gc=setTimeout(()=>{if(r.ctx)vm.runInContext('G&&clearTimeout(G.tm);G&&(G.over=1)',r.ctx);rooms.delete(r.code)},30*60*1000)});});
/* AFK protection: dice/quick-action timer (rt) and turn timer (tt). On expiry a prompt is auto-resolved or a bot finishes the turn;
   three timeouts in a row replace the player with a bot. */
function unpause(r){const d=Date.now()-r.pausedAt;Object.keys(r.tks).forEach(k=>r.tks[k]+=d);r.paused=0;r.ctx.__hp(0)}
function afk(r,i){const s=r.gs[i];r.afkN[i]=(r.afkN[i]||0)+1;if(s.k=='human'&&r.afkN[i]>=3){s.k='bot';s.orig='human';r.ctx.__bot(i);r.ctx.__note(s.name+' kept timing out and was replaced by a bot')}else r.ctx.__afk(i)}
setInterval(()=>rooms.forEach(r=>{if(!r.live)return;try{if(r.paused){if(!r.seats[0].ws&&Date.now()-(r.seats[0].gone||0)>60000)unpause(r);broadcast(r,{t:'tm',i:-1});return}const x=r.ctx.__tk(),now=Date.now();let m={t:'tm',i:-1};
const sg=r.ctx.__sig();if(sg!==r.sg){r.sg=sg;r.sgt=now}else if(now-(r.sgt||now)>30000&&r.ctx.__aiTurn()){r.sgt=now;r.ctx.__unstick()}
if(x&&x.i>=0&&r.gs.filter(s=>s.k=='human').length>1){const sx=r.gs[x.i];if(sx.k=='human'&&!sx.ws&&Date.now()-(sx.gone||0)>5000)r.ctx.__afk(x.i,' left the game');else{if(!(x.k in r.tks)){if(Object.keys(r.tks).length>60)r.tks={};r.tks[x.k]=now}
const lim=(x.q?r.rt:r.tt)*1000;if(lim){const left=lim-(now-r.tks[x.k]);m={t:'tm',i:x.i,left:Math.max(0,Math.ceil(left/1000)),lim:lim/1000};if(left<=0){r.tks[x.k]=now;afk(r,x.i)}}}}
broadcast(r,m)}catch(e){console.error(e)}}),1000);
/* keep-alives: app-level heartbeat every 5 s, protocol ping every 20 s (drops dead sockets) */
setInterval(()=>rooms.forEach(r=>{r.seats.forEach(s=>s.ws&&send(s.ws,{t:'hb'}));r.spectators.forEach(s=>s.ws&&send(s.ws,{t:'hb'}))}),5000);
setInterval(()=>{if(wss.clients)wss.clients.forEach(c=>{if(c.isAlive===false)return c.terminate();c.isAlive=false;try{c.ping()}catch(e){}})},20000);
srv.listen(PORT,'0.0.0.0',()=>console.log('Hexlands server on http://localhost:'+PORT));
