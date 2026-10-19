const http=require('http'),fs=require('fs'),vm=require('vm'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,HTML=path.join(__dirname,'public','index.html'),SHIM=path.join(__dirname,'engine-shim.js');
const rooms=new Map(),rnd=n=>Math.random()*n|0,tok=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const COL=['#d63a3a','#3a6fd6','#f08a24','#eeeeee'],NM=['Host','Sir Bot','Lady Bot','Baron Bot'];
const send=(ws,o)=>ws.readyState==1&&ws.send(JSON.stringify(o));

/* One isolated copy of the game engine per room, running the same script the browser uses,
   with a stub DOM. Only this server ever sees every player's hidden cards. */
function mkCtx(r){const els=new Map(),el=id=>{let e=els.get(id);if(!e){e={innerHTML:'',textContent:'',hidden:false,value:'',checked:false,style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})};els.set(id,e)}return e};
const sb={console,setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){},__sync:()=>sync(r),document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('_'+tok())}};sb.window=sb;
const ctx=vm.createContext(sb),src=/<script id="game">([\s\S]*?)<\/script>/.exec(fs.readFileSync(HTML,'utf8'))[1];
vm.runInContext(src+'\n'+fs.readFileSync(SHIM,'utf8'),ctx);ctx.el=el;return ctx}

function sync(r){if(!r.live)return;r.gs.forEach((s,i)=>s.ws&&s.ws.readyState==1&&s.ws.send('{"t":"state","s":'+r.ctx.__snap(i)+'}'))}
function lobby(r){r.seats.forEach((s,i)=>s.ws&&send(s.ws,{t:'lobby',code:r.code,vp:r.vp,dc:r.dc,you:i,seats:r.seats.map(x=>({k:x.k,name:x.name,color:x.color,on:!!x.ws}))}))}
function attach(ws,r,seat){if(seat.ws&&seat.ws!==ws)seat.ws.close();seat.ws=ws;ws.r=r;ws.seat=seat;clearTimeout(r.gc);send(ws,{t:'joined',code:r.code,token:seat.token});
if(r.live){const i=r.gs.indexOf(seat);ws.send('{"t":"start","me":'+i+',"geo":'+r.ctx.__geo()+'}');ws.send('{"t":"state","s":'+r.ctx.__snap(i)+'}')}else lobby(r)}
function startGame(r){const gs=r.seats.filter(s=>s.k=='human'||s.k=='bot');if(gs.length<3)return send(r.seats[0].ws,{t:'err',m:'Need at least 3 players (add bots)'});
r.gs=gs;r.ctx=mkCtx(r);const e=r.ctx.el;e('np').value=gs.length;gs.forEach((s,i)=>{e('n'+i).value=s.name;e('c'+i).value=s.color;e('a'+i).value=s.k=='bot'?'1':'0'});e('vp').value=r.vp;e('dc').checked=r.dc;e('mu').checked=false;
r.ctx.start();r.live=1;gs.forEach((s,i)=>s.ws&&s.ws.send('{"t":"start","me":'+i+',"geo":'+r.ctx.__geo()+'}'));sync(r)}

function handle(ws,m){const r=ws.r;
if(m.t=='create'){const code=[...Array(4)].map(()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(24)]).join('');
const rm={code,vp:10,dc:true,live:0,gs:[],seats:['human','open','bot','bot'].map((k,i)=>({k,name:i?NM[i]:String(m.name||'Host').slice(0,14),color:COL[i],token:null,ws:null}))};
rm.seats[0].token=tok();rooms.set(code,rm);return attach(ws,rm,rm.seats[0])}
if(m.t=='join'){const rm=rooms.get(String(m.code||'').toUpperCase());if(!rm)return send(ws,{t:'err',m:'Room not found'});
const s=rm.seats.find(x=>x.k=='open');if(!s||rm.live)return send(ws,{t:'err',m:'Room is full or already started'});
s.k='human';s.name=String(m.name||'Guest').slice(0,14);s.token=tok();return attach(ws,rm,s)}
if(m.t=='resume'){const rm=rooms.get(m.code),s=rm&&rm.seats.find(x=>x.token&&x.token==m.token);if(!s)return send(ws,{t:'err',m:'gone'});return attach(ws,rm,s)}
if(!r)return;const s=ws.seat;
if(!r.live){
if(m.t=='me'){s.name=String(m.name||s.name).slice(0,14);if(/^#[0-9a-f]{6}$/i.test(m.color))s.color=m.color}
else if(m.t=='cfg'&&s==r.seats[0]){[1,2,3].forEach(i=>{const k=m.seats&&m.seats[i-1];if(['open','bot','closed'].includes(k)&&r.seats[i].k!='human')r.seats[i].k=k});r.vp=Math.max(5,Math.min(15,+m.vp||10));r.dc=!!m.dc}
else if(m.t=='start'&&s==r.seats[0])return startGame(r);
return lobby(r)}
if(m.t=='botify'&&s==r.seats[0]){const t=r.gs[+m.seat];if(t&&t.k=='human'&&t!==s){t.k='bot';r.ctx.__bot(+m.seat)}return}
const gi=r.gs.indexOf(s);if(gi>=0)r.ctx.__do(gi,m)}

const PUB=path.join(__dirname,'public'),MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg'};
try{if(!/<script id="game">/.test(fs.readFileSync(HTML,'utf8')))throw Error('public/index.html has no <script id="game"> (wrong or edited file?)')}catch(e){console.error('STARTUP CHECK FAILED:',e.message,'\nExpected layout: server.js, engine-shim.js, package.json and public/index.html side by side.');process.exit(1)}
const srv=http.createServer((q,res)=>{try{const u=decodeURIComponent(q.url.split('?')[0]);if(u=='/healthz'){res.writeHead(200);return res.end('ok')}
const f=path.join(PUB,u=='/'?'index.html':u);if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(fs.readFileSync(f))}catch(e){console.error(e);res.writeHead(500);res.end('Server error')}});
const wss=new WebSocketServer({server:srv,maxPayload:4096});
wss.on('connection',ws=>{
ws.on('message',d=>{try{handle(ws,JSON.parse(d))}catch(e){console.error(e)}});
ws.on('close',()=>{const r=ws.r;if(!r)return;if(ws.seat.ws===ws){ws.seat.ws=null;if(!r.live)lobby(r)}
if(!r.seats.some(s=>s.ws))r.gc=setTimeout(()=>{if(r.ctx)vm.runInContext('G&&clearTimeout(G.tm);G&&(G.over=1)',r.ctx);rooms.delete(r.code)},30*60*1000)})});
srv.listen(PORT,'0.0.0.0',()=>console.log('Hexlands server on http://localhost:'+PORT));
