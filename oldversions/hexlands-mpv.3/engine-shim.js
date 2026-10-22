/* Appended to the game script and run inside a per-room vm context (no real DOM).
   Wraps the UI-driven flows so humans answer through network messages instead of modals. */
const md=document.getElementById('md');
modal=function(h){md.hidden=0;__sync()};
tUI=function(m){G.tmsg={m:m,n:(G.tn=(G.tn||0)+1),i:G.t};__sync()};
{const f=render;render=function(){f();__sync()}}
{const f=ask;ask=function(i){G.aj=(G.t+i)%G.P.length;G.ai_=i;G.mu={k:'ask',i:G.aj};G.ctr=null;f(i)}}
{const f=discard;discard=function(i){G.mu={k:'dc',i:i};f(i)}}
{const f=pick;pick=function(t,n,cb){G.mu={k:'pk',i:G.t,t:t,n:n};f(t,n,cb)}}
{const f=roll;roll=function(){const ok=!G.rolling&&G.mode=='roll'&&!G.over;f();if(ok)__sync()}}
const __mu=()=>md.hidden||G.over?null:(G.ctr?{k:'ctr',i:G.t,c:G.ctr}:G.mu);
function __geo(){return JSON.stringify({H:G.H,V:G.V.map(v=>({id:v.id,x:v.x,y:v.y,hx:v.hx,nb:v.nb,ed:v.ed,port:v.port})),E:G.E.map(e=>({id:e.id,a:e.a,b:e.b,n:e.n})),ports:G.ports.map(o=>({e:{a:o.e.a,b:o.e.b},t:o.t,x:o.x,y:o.y}))})}
function __snap(s){const u=__mu();
return JSON.stringify({t:G.t,mode:G.mode,me:s,vp:G.vp,dice:G.dice,d:G.d,rolling:!!G.rolling,rob:G.rob,over:G.over,win:G.over?G.t:-1,last:G.last,free:G.free,bank:G.bank,deck:G.deck.length,lh:G.lh,la:G.la,devPlayed:G.devPlayed,log:G.log.slice(0,30),of:G.of,tmsg:G.tmsg,
dc:u&&u.k=='dc'&&G.dc?{k:G.dc.k}:null,mu:u&&{k:u.k,i:u.i,t:u.t,n:u.n,c:u.c},V:G.V.map(v=>v.b),E:G.E.map(e=>e.o),
P:G.P.map((p,i)=>({name:p.name,color:p.color,bot:p.ai,st:p.st,ci:p.ci,rd:p.rd,kn:p.kn,lr:p.lr,nc:cards(i),ndc:p.dev.length+p.nd.length,...(i==s?{res:p.res,dev:p.dev,nd:p.nd,vpc:p.vpc}:{})}))})}
const __b=o=>{const r={};R.forEach(x=>{const n=Math.floor(+(o&&o[x])||0);if(n>0)r[x]=Math.min(n,19)});return r};
function __do(s,m){const mine=G.t==s,free=md.hidden&&!G.over&&mine;
if(m.t=='roll'){if(free)roll()}
else if(m.t=='act'){if(free&&['v','e','h'].includes(m.k))act(m.k,+m.id)}
else if(m.t=='bld'){if(free&&['road','settle','city'].includes(m.k))bld(m.k)}
else if(m.t=='buyDev'){if(free)buyDev()}
else if(m.t=='end'){if(free)endTurn()}
else if(m.t=='play'){if(free)playDev(String(m.c))}
else if(m.t=='bank'||m.t=='offer'){if(free&&G.mode=='main'){G.tb={g:__b(m.g),r:__b(m.r)};m.t=='bank'?bank():offer()}}
else{const u=__mu();if(!u||u.i!=s)return;
if(m.t=='ans'&&u.k=='ask'){m.v?done(G.aj):ask(G.ai_+1)}
else if(m.t=='ans'&&u.k=='ctr'){if(m.v){G.of=G.ctr;done(G.aj)}else ask(G.ai_+1)}
else if(m.t=='discard'&&u.k=='dc'){const x=__b(m.s);if(sum(x)==G.dc.k&&has(G.P[s],x)){G.dc.s=x;dcDone()}}
else if(m.t=='pick'&&u.k=='pk'&&R.includes(m.r))_pk(m.r)}}
function __bot(s){G.P[s].ai=true;const u=__mu();
if(u&&u.i==s){if(u.k=='ask'||u.k=='ctr')ask(G.ai_+1);
else if(u.k=='dc'){const p=G.P[s],x={};for(let k=0;k<G.dc.k;k++){const rs=R.filter(r=>p.res[r]>(x[r]||0)),r=rs[rnd(rs.length)];x[r]=(x[r]||0)+1}G.dc.s=x;dcDone()}
else if(u.k=='pk')_pk(R[rnd(5)])}else render()}
