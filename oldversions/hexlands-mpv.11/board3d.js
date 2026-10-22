/* Hexlands 3D board + dice (three.js r128).
   Camera maths and click-picking are hand-written (no OrbitControls / Raycaster) so they are deterministic.
   If three.js is missing or anything fails, the classic SVG board stays in use. */
(function(){
'use strict';
if(window.B3D)return;
const T=window.B3D={ready:typeof THREE!=='undefined',active:false,err:null,wanted:true};
try{T.wanted=localStorage.hex3d!=='0'}catch(e){}
if(!T.ready)return;
const S=50,TOP=.3,FOV=38,TANH=Math.tan(FOV*Math.PI/360),PI2=Math.PI*2;
const $b=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rngf=seed=>()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296};
const easeIO=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const easeBack=t=>{const c=2.70158;return 1+c*Math.pow(t-1,3)+1.70158*Math.pow(t-1,2)};
let renderer,scene,camera,canvas,hostEl,sun,waterTex,gt=null,world=null,dyn=null,tgtGrp=null,rob=null,robTween=null,btn=null;
let bv=[],be=[],tgt=[],anims=[],W=2,Hh=2,drag=null,hov=null,camTween=null,pinch=0;
const ptrs=new Map(),cam={th:0,ph:0,d:16,x:0,z:0,auto:true},fit={d:16,x:0,z:0,hw:8,hh:8};
const GEO={},MAT={};

/* ---------- textures ---------- */
function ctex(w,h,draw,rep){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;if(rep){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep,rep)}return t}
const TC={w:'#2c6a33',b:'#b8573a',s:'#8dc659',h:'#dfb83f',o:'#7d8793',d:'#dcc48d'};
function terrainTex(k){return ctex(256,256,(g,w,h)=>{const r=rngf(k.charCodeAt(0)*131);g.fillStyle=TC[k];g.fillRect(0,0,w,h);
for(let i=0;i<1400;i++){g.fillStyle='rgba('+(r()<.5?'255,255,255':'0,0,0')+','+(.03+r()*.08).toFixed(3)+')';g.fillRect(r()*w,r()*h,1+r()*3,1+r()*3)}
g.lineWidth=2;
if(k=='b'){g.strokeStyle='rgba(70,25,12,.28)';for(let y=0;y<h;y+=32){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();for(let x=((y/32)%2)*32;x<w;x+=64){g.beginPath();g.moveTo(x,y);g.lineTo(x,y+32);g.stroke()}}}
if(k=='h'){g.strokeStyle='rgba(120,80,10,.3)';for(let x=0;x<w;x+=16){g.beginPath();g.moveTo(x,0);g.lineTo(x+8,h);g.stroke()}}
if(k=='s'){g.strokeStyle='rgba(40,90,20,.35)';for(let i=0;i<500;i++){const x=r()*w,y=r()*h;g.beginPath();g.moveTo(x,y);g.lineTo(x+r()*4-2,y-4-r()*5);g.stroke()}}
if(k=='w'){for(let i=0;i<60;i++){g.fillStyle='rgba(15,50,20,.18)';g.beginPath();g.arc(r()*w,r()*h,6+r()*14,0,7);g.fill()}}
if(k=='o'){g.strokeStyle='rgba(30,35,45,.35)';for(let i=0;i<40;i++){g.beginPath();let x=r()*w,y=r()*h;g.moveTo(x,y);for(let j=0;j<4;j++){x+=r()*30-15;y+=r()*30-15;g.lineTo(x,y)}g.stroke()}}
if(k=='d'){g.strokeStyle='rgba(150,115,60,.3)';for(let y=10;y<h;y+=18){g.beginPath();for(let x=0;x<=w;x+=8)g.lineTo(x,y+Math.sin(x*.05+y)*4);g.stroke()}}
},.55)}
const tokTex={};
function tokenTex(n){return tokTex[n]||(tokTex[n]=ctex(256,256,g=>{g.fillStyle='#f4e9c9';g.beginPath();g.arc(128,128,124,0,7);g.fill();g.strokeStyle='#8a6a3a';g.lineWidth=6;g.beginPath();g.arc(128,128,112,0,7);g.stroke();
const hot=n==6||n==8;g.fillStyle=hot?'#b3201b':'#2a1d10';g.font='bold '+(n>9?96:110)+'px Georgia,serif';g.textAlign='center';g.textBaseline='middle';g.fillText(String(n),128,116);
const p=6-Math.abs(7-n);for(let i=0;i<p;i++){g.beginPath();g.arc(128+(i-(p-1)/2)*18,196,6,0,7);g.fill()}}))}
const PORTC={w:'#2c6a33',b:'#b8573a',s:'#8dc659',h:'#dfb83f',o:'#7d8793','3':'#d9c9a0'},portTexC={};
function portTex(t){return portTexC[t]||(portTexC[t]=ctex(256,256,g=>{g.fillStyle='#f4e9c9';g.beginPath();g.arc(128,128,124,0,7);g.fill();g.fillStyle=PORTC[t];g.beginPath();g.arc(128,128,100,0,7);g.fill();
g.fillStyle=t=='3'?'#2a1d10':'#fff';g.textAlign='center';g.textBaseline='middle';g.font='bold 78px Georgia,serif';g.fillText(t=='3'?'3:1':'2:1',128,142);
if(t!='3'){g.font='bold 38px Georgia,serif';g.fillText({w:'Wood',b:'Brick',s:'Sheep',h:'Wheat',o:'Ore'}[t],128,66)}}))}

/* ---------- shared geometry / materials ---------- */
function hexShape(r){const s=new THREE.Shape();for(let k=0;k<6;k++){const a=(60*k-30)*Math.PI/180,x=r*Math.cos(a),y=-r*Math.sin(a);if(k)s.lineTo(x,y);else s.moveTo(x,y)}s.closePath();return s}
function hexGeo(r,depth,bev){const g=new THREE.ExtrudeGeometry(hexShape(r),{depth:depth,bevelEnabled:true,bevelThickness:bev,bevelSize:bev,bevelSegments:2,steps:1});g.rotateX(-Math.PI/2);g.translate(0,bev,0);return g}
const std=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.85},o||{}));
function shared(){if(GEO.base)return;
GEO.base=hexGeo(.9,.22,.03);GEO.cap=hexGeo(.83,.02,.012);GEO.shore=new THREE.CylinderGeometry(1.13,1.13,.05,6);GEO.foam=new THREE.CylinderGeometry(1.3,1.3,.02,6);
GEO.tok=new THREE.CylinderGeometry(.29,.3,.06,32);GEO.tokf=new THREE.CircleGeometry(.265,32);
GEO.road=new THREE.BoxGeometry(.15,.07,1);GEO.vt=new THREE.CylinderGeometry(.19,.19,.05,20);GEO.hx=new THREE.CylinderGeometry(.92,.92,.04,6);
GEO.beam=new THREE.CylinderGeometry(1,1,1,6);GEO.beam.rotateX(Math.PI/2);GEO.sph=new THREE.SphereGeometry(1,10,8);
MAT.base=std(0x5d4b3a,{roughness:.92});MAT.sand=std(0xe6d9ab,{roughness:1});MAT.foam=std(0xc4eaf2,{transparent:true,opacity:.35,depthWrite:false});
MAT.tok=std(0xf1e4c0,{roughness:.55});MAT.wood=std(0x7a5a38,{roughness:.8});MAT.dark=std(0x25201c,{roughness:.6});MAT.sail=std(0xf3ecd8,{roughness:.9,side:THREE.DoubleSide});
MAT.flag=std(0xc0392b,{side:THREE.DoubleSide});MAT.rob=std(0x1c1c22,{roughness:.35,metalness:.25});MAT.outl=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide});
MAT.hl=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.5,depthWrite:false});MAT.hlh=new THREE.MeshBasicMaterial({color:0xffe08a,transparent:true,opacity:.85,depthWrite:false});
MAT.rope=std(0xcdb88a,{roughness:1});MAT.cap={};['w','b','s','h','o','d'].forEach(k=>MAT.cap[k]=std(0xffffff,{map:terrainTex(k),roughness:.88}))}
function pm(c){return MAT['p'+c]||(MAT['p'+c]={wall:std(new THREE.Color(c),{roughness:.6}),roof:std(new THREE.Color(c).multiplyScalar(.6),{roughness:.7}),road:std(new THREE.Color(c),{roughness:.5,metalness:.1})})}

/* ---------- instanced decorations ---------- */
function Pools(){const P={},d=new THREE.Object3D();return{def(k,geo,mat,cast){P[k]={geo,mat,m:[],cast:cast!==false}},
put(k,x,y,z,sx,sy,sz,ry){d.position.set(x,y,z);d.rotation.set(0,ry||0,0);d.scale.set(sx,sy==null?sx:sy,sz==null?sx:sz);d.updateMatrix();P[k].m.push(d.matrix.clone())},
build(group){for(const k in P){const p=P[k];if(!p.m.length)continue;const im=new THREE.InstancedMesh(p.geo,p.mat,p.m.length);p.m.forEach((m,i)=>im.setMatrixAt(i,m));im.instanceMatrix.needsUpdate=true;im.castShadow=p.cast;im.receiveShadow=true;group.add(im)}}}}
function defs(pl){const m=(c,o)=>std(c,Object.assign({flatShading:true},o||{}));
const cyl=(a,b,h,s)=>{const g=new THREE.CylinderGeometry(a,b,h,s);g.translate(0,h/2,0);return g},cone=(r,h,s)=>{const g=new THREE.ConeGeometry(r,h,s);g.translate(0,h/2,0);return g};
pl.def('trunk',cyl(.035,.05,.2,6),m(0x5a3a22));pl.def('pine',cone(1,1,8),m(0x2f7a3a));pl.def('pine2',cone(1,1,8),m(0x3c8b45));pl.def('bush',new THREE.SphereGeometry(.07,7,5),m(0x3f8f4a));
pl.def('mound',new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2),m(0xc4673f));pl.def('brick',new THREE.BoxGeometry(.2,.07,.1),m(0xa8402a,{flatShading:false}));pl.def('pit',cyl(.2,.24,.03,10),m(0x6b3a22));
pl.def('wool',new THREE.SphereGeometry(.1,10,8),m(0xf6f3ea,{flatShading:false,roughness:.95}));pl.def('shead',new THREE.SphereGeometry(.05,8,6),m(0x2e2a2a,{flatShading:false}));pl.def('leg',cyl(.012,.012,.07,5),m(0x2e2a2a));
pl.def('tuft',cone(.04,.1,4),m(0x5da23b));pl.def('post',cyl(.012,.014,.1,5),m(0x7a5a38));
pl.def('stalk',cyl(.006,.006,.22,4),m(0xc9a030));pl.def('ear',new THREE.SphereGeometry(.018,6,4),m(0xe8c24a));pl.def('hay',cone(.13,.2,8),m(0xd7b448));
pl.def('peak',cone(1,1,5),m(0x7b8490));pl.def('snow',cone(1,1,5),m(0xf2f6fa,{roughness:.6}));pl.def('rock',new THREE.DodecahedronGeometry(.06),m(0x69717d));
pl.def('ore',new THREE.OctahedronGeometry(.035),m(0x8fd3ff,{emissive:0x1a4a70,metalness:.4,roughness:.3}));
pl.def('dune',new THREE.SphereGeometry(1,14,6,0,Math.PI*2,0,Math.PI/2),m(0xe7d29a,{flatShading:false}));pl.def('cact',cyl(.04,.045,.3,8),m(0x3a8a4a,{flatShading:false}));pl.def('arm',cyl(.028,.03,.14,6),m(0x3a8a4a,{flatShading:false}))}
function decorate(h,i,pl){const x=h.x/S,z=h.y/S,r=rngf(i*7919+17),y=TOP,k=h.t,L=[];
const spot=(a0,a1,gap)=>{for(let t=0;t<30;t++){const a=r()*PI2,d=a0+r()*(a1-a0),px=Math.cos(a)*d,pz=Math.sin(a)*d;if(L.every(q=>Math.hypot(q[0]-px,q[1]-pz)>gap)){L.push([px,pz]);return[px,pz]}}return null};
if(k=='w'){for(let n=0;n<9;n++){const p=spot(.38,.74,.2);if(!p)continue;const s=.8+r()*.6,px=x+p[0],pz=z+p[1];pl.put('trunk',px,y,pz,s);pl.put('pine',px,y+.1*s,pz,.19*s,.24*s,.19*s,r()*6);pl.put('pine2',px,y+.2*s,pz,.15*s,.22*s,.15*s);pl.put('pine',px,y+.3*s,pz,.1*s,.2*s,.1*s)}
for(let n=0;n<3;n++){const p=spot(.4,.76,.12);if(p)pl.put('bush',x+p[0],y+.04,z+p[1],1+r()*.5)}}
else if(k=='b'){for(let n=0;n<3;n++){const p=spot(.4,.66,.34);if(p)pl.put('mound',x+p[0],y,z+p[1],.2+r()*.1,.12+r()*.08,.2+r()*.1)}
for(let n=0;n<4;n++){const p=spot(.4,.72,.24);if(!p)continue;const a=r()*3,px=x+p[0],pz=z+p[1];pl.put('brick',px,y+.035,pz,1,1,1,a);pl.put('brick',px+.01,y+.105,pz,1,1,1,a+.3);if(r()<.6)pl.put('brick',px,y+.175,pz,1,1,1,a)}
const q=spot(.4,.6,.3);if(q)pl.put('pit',x+q[0],y,z+q[1],1)}
else if(k=='s'){const sheep=(px,pz,ry)=>{const fx=Math.cos(ry),fz=-Math.sin(ry),sx=Math.sin(ry),sz=Math.cos(ry);pl.put('wool',px,y+.12,pz,1.25,.95,1,ry);pl.put('shead',px+fx*.13,y+.14,pz+fz*.13,1);
[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(l=>pl.put('leg',px+fx*.05*l[0]+sx*.04*l[1],y+.02,pz+fz*.05*l[0]+sz*.04*l[1],1))};
for(let n=0;n<4;n++){const p=spot(.4,.7,.3);if(p)sheep(x+p[0],z+p[1],r()*6)}for(let n=0;n<16;n++){const p=spot(.38,.78,.08);if(p)pl.put('tuft',x+p[0],y,z+p[1],.8+r()*.6)}
for(let n=0;n<6;n++){const a=-1.2+n*.5,px=x+Math.cos(a)*.76,pz=z+Math.sin(a)*.76;pl.put('post',px,y,pz,1)}}
else if(k=='h'){const ang=r()*3.14,ca=Math.cos(ang),sa=Math.sin(ang);for(let row=-5;row<=5;row++)for(let u=-.8;u<=.8;u+=.09){const px=ca*u-sa*row*.12,pz=sa*u+ca*row*.12,d=Math.hypot(px,pz);if(d>.76||d<.36)continue;const s=.9+r()*.25;pl.put('stalk',x+px,y,z+pz,1,s,1);pl.put('ear',x+px,y+.22*s,z+pz,1,2.6,1)}
const p=spot(.45,.62,.3);if(p)pl.put('hay',x+p[0],y,z+p[1],1)}
else if(k=='o'){for(let n=0;n<4;n++){const p=spot(.4,.66,.3);if(!p)continue;const rr=.16+r()*.12,hh=.35+r()*.35,px=x+p[0],pz=z+p[1];pl.put('peak',px,y,pz,rr,hh,rr,r()*6);if(hh>.45)pl.put('snow',px,y+hh*.62,pz,rr*.42,hh*.38,rr*.42,0)}
for(let n=0;n<5;n++){const p=spot(.4,.76,.1);if(p)pl.put('rock',x+p[0],y+.03,z+p[1],.8+r()*.8)}for(let n=0;n<3;n++){const p=spot(.4,.7,.1);if(p)pl.put('ore',x+p[0],y+.04,z+p[1],1)}}
else if(k=='d'){for(let n=0;n<3;n++){const p=spot(.3,.6,.4);if(p)pl.put('dune',x+p[0],y-.01,z+p[1],.34,.08,.26,r()*3)}
const c=spot(.35,.6,.3);if(c){const px=x+c[0],pz=z+c[1];pl.put('cact',px,y,pz,1);pl.put('arm',px+.06,y+.1,pz,1,.8,1);pl.put('arm',px-.06,y+.14,pz,1,.7,1)}for(let n=0;n<2;n++){const p=spot(.4,.7,.1);if(p)pl.put('rock',x+p[0],y+.03,z+p[1],1)}}}

/* ---------- pieces ---------- */
function beam(a,b,rad,mat){const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz),m=new THREE.Mesh(GEO.beam,mat);m.scale.set(rad,rad,len);m.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);m.lookAt(b[0],b[1],b[2]);return m}
function houseMesh(o){const m=pm(gt.P[o].color),g=new THREE.Group();
const b=new THREE.Mesh(new THREE.BoxGeometry(.22,.15,.2),m.wall);b.position.y=.075;g.add(b);
const r=new THREE.Mesh(new THREE.ConeGeometry(.19,.13,4),m.roof);r.position.y=.215;r.rotation.y=Math.PI/4;g.add(r);
const c=new THREE.Mesh(new THREE.BoxGeometry(.04,.08,.04),MAT.dark);c.position.set(.06,.24,.04);g.add(c);
g.traverse(x=>{if(x.isMesh)x.castShadow=true});return g}
function cityMesh(o){const m=pm(gt.P[o].color),g=new THREE.Group();
const hall=new THREE.Mesh(new THREE.BoxGeometry(.3,.17,.22),m.wall);hall.position.set(-.07,.085,0);g.add(hall);
const hr=new THREE.Mesh(new THREE.ConeGeometry(.2,.12,4),m.roof);hr.position.set(-.07,.23,0);hr.rotation.y=Math.PI/4;hr.scale.set(1.35,1,1);g.add(hr);
const tw=new THREE.Mesh(new THREE.BoxGeometry(.14,.34,.14),m.wall);tw.position.set(.11,.17,0);g.add(tw);
const tr=new THREE.Mesh(new THREE.ConeGeometry(.12,.17,4),m.roof);tr.position.set(.11,.425,0);tr.rotation.y=Math.PI/4;g.add(tr);
const fl=new THREE.Mesh(new THREE.SphereGeometry(.018,8,6),MAT.dark);fl.position.set(.11,.53,0);g.add(fl);
g.traverse(x=>{if(x.isMesh)x.castShadow=true});return g}
function roadMesh(e,o){const a=gt.V[e.a],b=gt.V[e.b],ax=a.x/S,az=a.y/S,bx=b.x/S,bz=b.y/S,dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),m=pm(gt.P[o].color),ferry=!!e.f,g=new THREE.Group();
const bar=new THREE.Mesh(GEO.road,m.road);bar.scale.set(1,1,len*(ferry?.96:.74));bar.position.y=.045;bar.castShadow=true;g.add(bar);
const base=new THREE.Mesh(GEO.road,MAT.dark);base.scale.set(1.3,.7,len*(ferry?.98:.78));base.position.y=.03;g.add(base);
g.position.set((ax+bx)/2,ferry?.07:TOP+.01,(az+bz)/2);g.rotation.y=Math.atan2(dx,dz);return g}
function mkRobber(){const g=new THREE.Group(),pts=[[0,0],[.15,0],[.15,.025],[.1,.07],[.075,.2],[.11,.25],[.06,.28],[0,.29]].map(p=>new THREE.Vector2(p[0],p[1]));
const lg=new THREE.LatheGeometry(pts,18),hg=new THREE.SphereGeometry(.075,16,12);
const body=new THREE.Mesh(lg,MAT.rob),head=new THREE.Mesh(hg,MAT.rob);head.position.y=.36;
const ob=new THREE.Mesh(lg,MAT.outl),oh=new THREE.Mesh(hg,MAT.outl);ob.scale.set(1.18,1.06,1.18);oh.scale.setScalar(1.25);oh.position.y=.36;
[body,head].forEach(x=>x.castShadow=true);g.add(body,head,ob,oh);g.scale.setScalar(1.5);return g}
function popIn(m){m.scale.setScalar(.01);anims.push({t0:performance.now(),dur:420,f:k=>m.scale.setScalar(Math.max(.01,easeBack(k)))})}

/* ---------- world ---------- */
function buildPort(p){const g=new THREE.Group(),a=gt.V[p.e.a],b=gt.V[p.e.b],mx=(a.x+b.x)/2/S,mz=(a.y+b.y)/2/S,x=p.x/S,z=p.y/S,ox=x-mx,oz=z-mz,ol=Math.hypot(ox,oz)||1,tx=-oz/ol,tz=ox/ol;
const boat=new THREE.Group(),hull=new THREE.Mesh(new THREE.SphereGeometry(.2,14,8),MAT.wood);hull.scale.set(1.9,.45,.8);hull.position.y=.0;boat.add(hull);
const mast=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.5,6),MAT.wood);mast.position.y=.27;boat.add(mast);
const sh=new THREE.Shape();sh.moveTo(0,0);sh.lineTo(0,.42);sh.lineTo(.26,.04);sh.closePath();const sail=new THREE.Mesh(new THREE.ShapeGeometry(sh),MAT.sail);sail.position.set(.0,.1,0);boat.add(sail);
const fs=new THREE.Shape();fs.moveTo(0,0);fs.lineTo(.12,.03);fs.lineTo(0,.07);fs.closePath();const flag=new THREE.Mesh(new THREE.ShapeGeometry(fs),MAT.flag);flag.position.set(0,.5,0);boat.add(flag);
boat.traverse(q=>{if(q.isMesh)q.castShadow=true});boat.position.set(x,.03,z);boat.rotation.y=Math.atan2(-tz,tx);g.add(boat);
const disc=new THREE.Mesh(new THREE.CircleGeometry(.27,28),new THREE.MeshStandardMaterial({map:portTex(p.t),roughness:.6}));disc.rotation.x=-Math.PI/2;disc.position.set(x+ox/ol*.34,.06,z+oz/ol*.34);g.add(disc);
[a,b].forEach(v=>g.add(beam([x,.1,z],[v.x/S,TOP-.04,v.y/S],.014,MAT.rope)));return g}
function buildWorld(G){if(world)scene.remove(world);world=new THREE.Group();scene.add(world);dyn=new THREE.Group();tgtGrp=new THREE.Group();scene.add(dyn);scene.add(tgtGrp);
bv=[];be=[];tgt=[];anims=[];rob=null;robTween=null;const pl=Pools();defs(pl);
let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
G.H.forEach((h,i)=>{const x=h.x/S,z=h.y/S;x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);
const sh=new THREE.Mesh(GEO.shore,MAT.sand);sh.position.set(x,-.01,z);sh.receiveShadow=true;world.add(sh);const fo=new THREE.Mesh(GEO.foam,MAT.foam);fo.position.set(x,-.025,z);world.add(fo);
const base=new THREE.Mesh(GEO.base,MAT.base);base.position.set(x,0,z);base.castShadow=true;base.receiveShadow=true;world.add(base);
const cap=new THREE.Mesh(GEO.cap,MAT.cap[h.t]);cap.position.set(x,.26,z);cap.receiveShadow=true;world.add(cap);
if(h.t!='d'){const tk=new THREE.Mesh(GEO.tok,MAT.tok);tk.position.set(x,TOP+.03,z);tk.castShadow=true;world.add(tk);
const f=new THREE.Mesh(GEO.tokf,new THREE.MeshStandardMaterial({map:tokenTex(h.n),roughness:.5}));f.rotation.x=-Math.PI/2;f.position.set(x,TOP+.063,z);world.add(f)}
decorate(h,i,pl)});
pl.build(world);G.ports.forEach(p=>{world.add(buildPort(p));x0=Math.min(x0,p.x/S);x1=Math.max(x1,p.x/S);z0=Math.min(z0,p.y/S);z1=Math.max(z1,p.y/S)});
G.E.forEach(e=>{if(!e.f)return;const a=G.V[e.a],b=G.V[e.b],ax=a.x/S,az=a.y/S,bx=b.x/S,bz=b.y/S,len=Math.hypot(bx-ax,bz-az),n=Math.max(2,Math.floor(len/.3));
for(let k=1;k<n;k++){const s=new THREE.Mesh(GEO.sph,MAT.foam);s.scale.setScalar(.035);s.position.set(ax+(bx-ax)*k/n,.08,az+(bz-az)*k/n);world.add(s)}});
fit.x=(x0+x1)/2;fit.z=(z0+z1)/2;fit.hw=(x1-x0)/2+1.5;fit.hh=(z1-z0)/2+1.5;fitCalc();cam.x=fit.x;cam.z=fit.z;cam.th=0;cam.ph=0;cam.d=fit.d;cam.auto=true;camTween=null;
const R=Math.max(fit.hw,fit.hh)+2;sun.position.set(fit.x+R*.6,R*1.4,fit.z+R*.8);sun.target.position.set(fit.x,0,fit.z);sun.target.updateMatrixWorld();
const sc=sun.shadow.camera;sc.left=-R;sc.right=R;sc.top=R;sc.bottom=-R;sc.near=1;sc.far=R*4;sc.updateProjectionMatrix();
rob=mkRobber();dyn.add(rob);const rh=G.H[G.rob];rob.position.set(rh.x/S,TOP+.07,rh.y/S);rob.userData.at=G.rob}
function fitCalc(){fit.d=Math.max(fit.hh/TANH,fit.hw/(TANH*(W/Hh)))*1.04}

/* ---------- camera maths (hand written) ---------- */
function basis(){const sp=Math.sin(cam.ph),cp=Math.cos(cam.ph),st=Math.sin(cam.th),ct=Math.cos(cam.th),P=[cam.x+cam.d*sp*st,cam.d*cp,cam.z+cam.d*sp*ct];
let f=[cam.x-P[0],-P[1],cam.z-P[2]];const fl=Math.hypot(f[0],f[1],f[2]);f=f.map(v=>v/fl);const up=[-st*cp,sp,-ct*cp];
let r=[f[1]*up[2]-f[2]*up[1],f[2]*up[0]-f[0]*up[2],f[0]*up[1]-f[1]*up[0]];const rl=Math.hypot(r[0],r[1],r[2]);r=r.map(v=>v/rl);
const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]];return{P,f,r,u,up}}
function proj(x,y,z,b){b=b||basis();const dx=x-b.P[0],dy=y-b.P[1],dz=z-b.P[2],zc=dx*b.f[0]+dy*b.f[1]+dz*b.f[2];if(zc<.05)return null;
const xc=dx*b.r[0]+dy*b.r[1]+dz*b.r[2],yc=dx*b.u[0]+dy*b.u[1]+dz*b.u[2];return{x:(xc/(zc*TANH*(W/Hh))+1)/2*W,y:(1-yc/(zc*TANH))/2*Hh,z:zc}}
function ground(px,py,yy,b){b=b||basis();const nx=(px/W*2-1)*TANH*(W/Hh),ny=(1-py/Hh*2)*TANH,d=[b.r[0]*nx+b.u[0]*ny+b.f[0],b.r[1]*nx+b.u[1]*ny+b.f[1],b.r[2]*nx+b.u[2]*ny+b.f[2]];
if(d[1]>=-1e-4)return null;const t=(yy-b.P[1])/d[1];return{x:b.P[0]+d[0]*t,z:b.P[2]+d[2]*t}}
function camApply(){const b=basis();camera.position.set(b.P[0],b.P[1],b.P[2]);camera.up.set(b.up[0],b.up[1],b.up[2]);camera.lookAt(cam.x,0,cam.z)}
const segDist=(px,py,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l?clamp(((px-ax)*dx+(py-ay)*dy)/l,0,1):0;return Math.hypot(px-(ax+dx*t),py-(ay+dy*t))};
function pick(px,py){const b=basis();let best=null,bs=1e9;
for(const t of tgt){const p=proj(t.x,TOP,t.z,b);if(!p)continue;const q=proj(t.x+1,TOP,t.z,b),pu=q?Math.hypot(q.x-p.x,q.y-p.y):30;let d,rad;
if(t.k=='e'){const q2=proj(t.x2,TOP,t.z2,b);if(!q2)continue;d=segDist(px,py,p.x,p.y,q2.x,q2.y);rad=Math.max(12,pu*.14)}
else{d=Math.hypot(px-p.x,py-p.y);rad=t.k=='v'?Math.max(14,pu*.24):pu*.8}
if(d<=rad&&d/rad<bs){bs=d/rad;best=t}}return best}
function setHover(t){if(hov===t)return;if(hov)hov.m.material=MAT.hl;hov=t;if(t)t.m.material=MAT.hlh;canvas.style.cursor=t?'pointer':'grab'}
T._cam=cam;T._pick=pick;T._proj=proj;T._ground=ground;T._basis=basis;T._dims=(w,h)=>{W=w;Hh=h};T._tgt=()=>tgt;

/* ---------- targets & state sync ---------- */
function addT(k,id,x,z,x2,z2){let m;if(k=='v'){m=new THREE.Mesh(GEO.vt,MAT.hl);m.position.set(x,TOP+.06,z)}
else if(k=='e'){const dx=x2-x,dz=z2-z,len=Math.hypot(dx,dz);m=new THREE.Mesh(GEO.road,MAT.hl);m.scale.set(1.4,1,len*.7);m.position.set((x+x2)/2,TOP+.07,(z+z2)/2);m.rotation.y=Math.atan2(dx,dz)}
else{m=new THREE.Mesh(GEO.hx,MAT.hl);m.position.set(x,TOP+.05,z)}m.userData={k:k,id:id};tgtGrp.add(m);tgt.push({k,id,x,z,x2,z2,m})}
T.sync=function(G){if(!T.active||!dyn)return;try{gt=G;
G.V.forEach((v,i)=>{const b=v.b,cur=bv[i];if(!b){if(cur){dyn.remove(cur.m);bv[i]=null}return}const key=b.o+':'+b.c;if(cur&&cur.key==key)return;if(cur)dyn.remove(cur.m);
const m=b.c?cityMesh(b.o):houseMesh(b.o);m.position.set(v.x/S,TOP,v.y/S);dyn.add(m);bv[i]={key,m};popIn(m)});
G.E.forEach((e,i)=>{const cur=be[i];if(e.o==null){if(cur){dyn.remove(cur.m);be[i]=null}return}if(cur&&cur.key==e.o)return;if(cur)dyn.remove(cur.m);const m=roadMesh(e,e.o);dyn.add(m);be[i]={key:e.o,m};popIn(m)});
const rh=G.H[G.rob];if(rob&&rob.userData.at!==G.rob){robTween={t0:performance.now(),dur:850,fx:rob.position.x,fz:rob.position.z,tx:rh.x/S,tz:rh.y/S};rob.userData.at=G.rob}
while(tgtGrp.children.length)tgtGrp.remove(tgtGrp.children[0]);tgt=[];hov=null;
const mine=G.P[G.t]&&!G.P[G.t].ai&&!G.over,m=G.mode;
if(mine){if(m=='robber')G.H.forEach((h,i)=>{if(i!=G.rob)addT('h',i,h.x/S,h.y/S)});
if(m=='setupR'||m=='road')G.E.forEach(e=>{if(e.o==null&&eOK(G.t,e.id)){const a=G.V[e.a],b=G.V[e.b];addT('e',e.id,a.x/S,a.y/S,b.x/S,b.y/S)}});
G.V.forEach(v=>{if(((m=='setupS'||m=='settle')&&vOK(G.t,v.id,m=='setupS'))||(m=='city'&&v.b&&v.b.o==G.t&&!v.b.c))addT('v',v.id,v.x/S,v.y/S)})}
}catch(e){fail(e)}};

/* ---------- renderer, controls, loop ---------- */
function resize(){if(!hostEl||!renderer)return;const r=hostEl.getBoundingClientRect();W=Math.max(2,r.width);Hh=Math.max(2,r.height);renderer.setSize(W,Hh,false);camera.aspect=W/Hh;camera.updateProjectionMatrix();fitCalc();if(cam.auto&&!camTween)cam.d=fit.d}
function zoomBy(f){cam.auto=false;cam.d=clamp(cam.d/f,3,fit.d*2.4)}
T.zoom=zoomBy;
T.reset=function(){cam.auto=true;camTween={t0:performance.now(),dur:550,th0:cam.th,ph0:cam.ph,d0:cam.d,x0:cam.x,z0:cam.z,th1:Math.round(cam.th/PI2)*PI2,ph1:0,d1:fit.d,x1:fit.x,z1:fit.z}};
function bindEvents(){
canvas.addEventListener('pointerdown',e=>{if(canvas.setPointerCapture)try{canvas.setPointerCapture(e.pointerId)}catch(x){}ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});cam.auto=false;camTween=null;
if(ptrs.size==2){const v=[...ptrs.values()];pinch=Math.hypot(v[0].x-v[1].x,v[0].y-v[1].y);drag=null;return}
drag={mode:(e.button==2||e.shiftKey||e.ctrlKey||e.metaKey)?'tilt':'pan',x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,moved:false};e.preventDefault()});
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top;if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
if(ptrs.size==2&&pinch){const v=[...ptrs.values()],d=Math.hypot(v[0].x-v[1].x,v[0].y-v[1].y);zoomBy(d/pinch);pinch=d;return}
if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)>4)drag.moved=true;
if(drag.mode=='pan'){if(drag.moved){const b=basis(),p0=ground(drag.x-r.left,drag.y-r.top,0,b),p1=ground(px,py,0,b);if(p0&&p1){cam.x+=p0.x-p1.x;cam.z+=p0.z-p1.z}}}
else{cam.th-=dx*.006;cam.ph=clamp(cam.ph+dy*.005,0,1.35)}drag.x=e.clientX;drag.y=e.clientY;return}
setHover(pick(px,py))});
const up=e=>{ptrs.delete(e.pointerId);pinch=0;const r=canvas.getBoundingClientRect();if(e.type=='pointerup'&&drag&&!drag.moved&&drag.mode=='pan'){const t=pick(e.clientX-r.left,e.clientY-r.top);if(t&&window.clk)window.clk(t.k,t.id)}drag=null};
canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();cam.auto=false;camTween=null;const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,p0=ground(px,py,0);
cam.d=clamp(cam.d*Math.exp(clamp(e.deltaY,-300,300)*.0012),3,fit.d*2.4);const p1=ground(px,py,0);if(p0&&p1){cam.x+=p0.x-p1.x;cam.z+=p0.z-p1.z}},{passive:false});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail(new Error('WebGL context lost'))})}
function ensure(){if(renderer)return;hostEl=$b('bd');canvas=document.createElement('canvas');canvas.id='b3d';canvas.title='Drag: pan \u00b7 Right-drag (or Shift-drag): tilt & rotate \u00b7 Wheel: zoom \u00b7 \u27f2: top view';
canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;display:block;touch-action:none;cursor:grab';hostEl.insertBefore(canvas,hostEl.firstChild);
renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
if(THREE.sRGBEncoding)renderer.outputEncoding=THREE.sRGBEncoding;if(THREE.ACESFilmicToneMapping){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05}
scene=new THREE.Scene();scene.background=new THREE.Color(0x14405a);scene.fog=new THREE.Fog(0x14405a,45,120);camera=new THREE.PerspectiveCamera(FOV,1,.1,300);
scene.add(new THREE.HemisphereLight(0xcfe6ff,0x5a4a35,.8));sun=new THREE.DirectionalLight(0xfff0d2,1.15);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;scene.add(sun);scene.add(sun.target);
waterTex=ctex(256,256,(g,w,h)=>{g.fillStyle='#808080';g.fillRect(0,0,w,h);const r=rngf(5);for(let i=0;i<220;i++){const x=r()*w,y=r()*h,rad=8+r()*30,gr=g.createRadialGradient(x,y,0,x,y,rad);gr.addColorStop(0,'rgba(255,255,255,.22)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(x-rad,y-rad,rad*2,rad*2)}},30);
const water=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshStandardMaterial({color:0x2a82b4,roughness:.3,metalness:.1,bumpMap:waterTex,bumpScale:1.2}));water.rotation.x=-Math.PI/2;water.position.y=-.06;water.receiveShadow=true;scene.add(water);
bindEvents();if(window.ResizeObserver)new ResizeObserver(resize).observe(hostEl);window.addEventListener('resize',resize);resize();requestAnimationFrame(frame)}
let last=0;
function frame(now){requestAnimationFrame(frame);if(!renderer)return;const dt=Math.min(.05,(now-(last||now))/1000);last=now;
if(T.active){if(camTween){const k=clamp((now-camTween.t0)/camTween.dur,0,1),e=easeIO(k),c=camTween;cam.th=c.th0+(c.th1-c.th0)*e;cam.ph=c.ph0+(c.ph1-c.ph0)*e;cam.d=c.d0+(c.d1-c.d0)*e;cam.x=c.x0+(c.x1-c.x0)*e;cam.z=c.z0+(c.z1-c.z0)*e;if(k>=1)camTween=null}
anims=anims.filter(a=>{const k=clamp((now-a.t0)/a.dur,0,1);a.f(k);return k<1});
if(robTween&&rob){const k=clamp((now-robTween.t0)/robTween.dur,0,1),e=easeIO(k);rob.position.set(robTween.fx+(robTween.tx-robTween.fx)*e,TOP+.07+Math.sin(Math.PI*k)*.7,robTween.fz+(robTween.tz-robTween.fz)*e);if(k>=1)robTween=null}
MAT.hl.opacity=.32+.24*Math.sin(now*.006);waterTex.offset.set((now*.00002)%1,(now*.000013)%1);camApply();renderer.render(scene,camera)}
diceFrame(now,dt)}
function fail(e){T.err=e;console.error('[3D board]',e);T.active=false;hide()}
function show(){if(canvas)canvas.style.display='block';document.body.classList.add('d3')}
function hide(){if(canvas)canvas.style.display='none';document.body.classList.remove('d3','d3dice');if(DI.c)DI.c.style.display='none'}
T.start=function(G){gt=G;if(!T.wanted){hide();T.active=false;return}try{ensure();shared();buildWorld(G);T.active=true;show();T.sync(G);btnState()}catch(e){fail(e)}};
T.enable=function(on){T.wanted=on;try{localStorage.hex3d=on?'1':'0'}catch(e){}
if(on){try{ensure();shared();if(gt&&gt.H&&!world)buildWorld(gt);T.active=!!gt&&!!world;if(T.active){show();T.sync(gt);T.diceShow(gt.d,false)}}catch(e){fail(e)}}else{T.active=false;hide()}btnState()};
function btnState(){if(btn){btn.textContent=T.active?'2D':'3D';btn.title=T.active?'Switch to the classic 2D board':'Switch to the 3D board'}}

/* ---------- 3D dice (own small canvas laid over the sidebar dice) ---------- */
const DI={r:null,s:null,c:null,dice:[],rolling:false,target:null,dirty:true,t0:0,settleAt:0,w:0,h:0,ok:null};
const FACE={1:[[0,1,0],[1,0,0],[0,0,1]],6:[[0,-1,0],[1,0,0],[0,0,-1]],2:[[1,0,0],[0,0,1],[0,1,0]],5:[[-1,0,0],[0,0,1],[0,-1,0]],3:[[0,0,1],[1,0,0],[0,1,0]],4:[[0,0,-1],[-1,0,0],[0,1,0]]};
const PIPS={1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]]};
const REST={1:[0,0,0],6:[Math.PI,0,0],2:[0,0,Math.PI/2],5:[0,0,-Math.PI/2],3:[-Math.PI/2,0,0],4:[Math.PI/2,0,0]};
function roundedCube(size,r,seg){const g=new THREE.BoxGeometry(size,size,size,seg,seg,seg),p=g.attributes.position,h=size/2-r,v=new THREE.Vector3(),c=new THREE.Vector3();
for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);c.set(clamp(v.x,-h,h),clamp(v.y,-h,h),clamp(v.z,-h,h));const d=v.clone().sub(c);if(d.lengthSq()>0)d.normalize().multiplyScalar(r);p.setXYZ(i,c.x+d.x,c.y+d.y,c.z+d.z)}p.needsUpdate=true;g.computeVertexNormals();return g}
function mkDie(cube,mats,gcs){const body=new THREE.Mesh(cube,mats.die);body.castShadow=true;
for(let v=1;v<=6;v++){const f=FACE[v],n=f[0],a=f[1],b=f[2],rad=v==1?.13:.085;gcs[rad]=gcs[rad]||new THREE.CircleGeometry(rad,18);
PIPS[v].forEach(q=>{const p=new THREE.Mesh(gcs[rad],v==1?mats.red:mats.pip);p.position.set(n[0]*.505+a[0]*q[0]*.25+b[0]*q[1]*.25,n[1]*.505+a[1]*q[0]*.25+b[1]*q[1]*.25,n[2]*.505+a[2]*q[0]*.25+b[2]*q[1]*.25);
p.lookAt(p.position.x+n[0],p.position.y+n[1],p.position.z+n[2]);body.add(p)})}return body}
function diceInit(){if(DI.ok!==null)return DI.ok;try{const A=$b('app');DI.c=document.createElement('canvas');DI.c.style.cssText='position:absolute;pointer-events:none;z-index:3;display:none';A.appendChild(DI.c);
DI.r=new THREE.WebGLRenderer({canvas:DI.c,antialias:true,alpha:true});DI.r.setPixelRatio(Math.min(window.devicePixelRatio||1,2));DI.r.setClearColor(0x000000,0);DI.r.shadowMap.enabled=true;DI.r.shadowMap.type=THREE.PCFSoftShadowMap;
if(THREE.sRGBEncoding)DI.r.outputEncoding=THREE.sRGBEncoding;if(THREE.ACESFilmicToneMapping)DI.r.toneMapping=THREE.ACESFilmicToneMapping;
DI.s=new THREE.Scene();DI.cam=new THREE.PerspectiveCamera(30,2,.1,50);DI.cam.position.set(0,6.4,3.4);DI.cam.lookAt(0,0,0);
DI.s.add(new THREE.HemisphereLight(0xffffff,0x887766,.85));const dl=new THREE.DirectionalLight(0xfff2dc,1.2);dl.position.set(2.5,6,3);dl.castShadow=true;dl.shadow.mapSize.set(1024,1024);const sc=dl.shadow.camera;sc.left=-4;sc.right=4;sc.top=4;sc.bottom=-4;sc.near=1;sc.far=15;DI.s.add(dl);
const gp=new THREE.Mesh(new THREE.PlaneGeometry(14,8),new THREE.ShadowMaterial({opacity:.32}));gp.rotation.x=-Math.PI/2;gp.receiveShadow=true;DI.s.add(gp);
const mats={die:new THREE.MeshStandardMaterial({color:0xf3ead2,roughness:.32,metalness:.05}),pip:new THREE.MeshStandardMaterial({color:0x161210,roughness:.5}),red:new THREE.MeshStandardMaterial({color:0xb3201b,roughness:.5})},cube=roundedCube(1,.15,6),gcs={};
for(let i=0;i<2;i++){const piv=new THREE.Group(),m=mkDie(cube,mats,gcs);piv.add(m);DI.s.add(piv);DI.dice.push({piv,m,w:[0,0,0],ph:0,x0:i?.85:-.85,s0:[0,0,0]})}
diceSet([1,1]);DI.ok=true;document.body.classList.add('d3dice')}catch(e){console.error('[3D dice]',e);DI.ok=false;document.body.classList.remove('d3dice')}return DI.ok}
function diceSet(d){DI.dice.forEach((x,i)=>{const v=d&&d[i]?d[i]:1,r=REST[v];x.m.rotation.set(r[0],r[1],r[2]);x.piv.rotation.y=(i?.7:-.5)+v*.37;x.piv.position.set(x.x0,.5,0)});DI.rolling=false;DI.dirty=true}
T.dicePlace=function(){if(!DI.ok||!DI.c)return;const ds=[].slice.call(document.querySelectorAll('.die'));if(!ds.length||!T.active){DI.c.style.display='none';return}
const A=$b('app').getBoundingClientRect();let l=1e9,t=1e9,r=-1e9,b=-1e9;ds.forEach(d=>{const q=d.getBoundingClientRect();l=Math.min(l,q.left);t=Math.min(t,q.top);r=Math.max(r,q.right);b=Math.max(b,q.bottom)});
const pad=10,w=r-l+pad*2,h=b-t+pad*2;DI.c.style.display='block';DI.c.style.left=(l-A.left-pad)+'px';DI.c.style.top=(t-A.top-pad)+'px';DI.c.style.width=w+'px';DI.c.style.height=h+'px';
if(Math.abs(w-DI.w)>1||Math.abs(h-DI.h)>1){DI.w=w;DI.h=h;DI.r.setSize(w,h,false);DI.cam.aspect=w/h;DI.cam.fov=w/h<1.7?36:30;DI.cam.updateProjectionMatrix()}DI.dirty=true};
T.diceRoll=function(){if(!T.active||!diceInit())return;DI.rolling=true;DI.target=null;DI.settleAt=0;DI.t0=performance.now();
DI.dice.forEach(d=>{const sg=()=>Math.random()<.5?-1:1;d.w=[(1+Math.random())*9*sg(),(1+Math.random())*8*sg(),(1+Math.random())*7*sg()];d.ph=Math.random()*2});T.dicePlace()};
T.diceShow=function(d,animated){if(!T.active||!diceInit())return;if(!d||!d[0]){if(!DI.rolling)diceSet(null);T.dicePlace();return}
if(animated){DI.target=[d[0],d[1]];if(!DI.rolling){DI.rolling=true;DI.t0=performance.now()-300;DI.dice.forEach(x=>{x.w=[11,-9,8];x.ph=Math.random()*2})}DI.settleAt=0}else if(!DI.rolling)diceSet(d);T.dicePlace()};
function diceFrame(now,dt){if(!DI.ok||!DI.r||!T.active)return;
if(DI.rolling){const t=(now-DI.t0)/1000;let done=true;DI.dice.forEach((x,i)=>{const sg=i?1:-1;let k=0;
if(DI.target&&t>.75){if(!DI.settleAt){DI.settleAt=now;x.s0=[x.m.rotation.x,x.m.rotation.y,x.m.rotation.z]}if(!x.s0set){x.s0=[x.m.rotation.x,x.m.rotation.y,x.m.rotation.z];x.s0set=true}k=clamp((now-DI.settleAt)/380,0,1)}
const fall=1-clamp(t/1.15,0,1);
if(k<1){done=false;const dec=DI.target?1:Math.max(.35,fall+.35);if(!x.s0set){x.m.rotation.x+=x.w[0]*dt*dec;x.m.rotation.y+=x.w[1]*dt*dec;x.m.rotation.z+=x.w[2]*dt*dec}
else{const v=DI.target[i],e=easeIO(k);for(let a=0;a<3;a++){const tg=REST[v][a],g=tg+Math.round((x.s0[a]-tg)/PI2)*PI2;x.m.rotation[a]=x.s0[a]+(g-x.s0[a])*e}}}
else{const v=DI.target[i],r=REST[v];x.m.rotation.set(r[0],r[1],r[2])}
const bounce=Math.abs(Math.sin(t*8+x.ph))*1.1*fall*(k>0?1-k:1);x.piv.position.set(x.x0+sg*1.3*Math.max(0,1-t/.9),.5+bounce,Math.sin(t*5+x.ph)*.25*fall)});
if(done&&DI.target){DI.rolling=false;DI.dice.forEach((x,i)=>{x.s0set=false;x.piv.position.set(x.x0,.5,0);x.piv.rotation.y=(i?.7:-.5)+DI.target[i]*.37})}DI.dirty=true}
if(DI.dirty||DI.rolling){DI.r.render(DI.s,DI.cam);DI.dirty=false}}

/* ---------- hook into the existing zoom buttons + add a 2D/3D toggle ---------- */
const oz=window.zoomBtn,orst=window.zoomReset;
window.zoomBtn=f=>T.active?T.zoom(f):(oz&&oz(f));window.zoomReset=()=>T.active?T.reset():(orst&&orst());
const zb=$b('zb');if(zb){btn=document.createElement('button');btn.id='b3t';btn.onclick=()=>T.enable(!T.active);zb.appendChild(btn);btnState()}
const hint=document.createElement('div');hint.style.cssText='position:absolute;left:.7em;bottom:.6em;z-index:2;font-size:.75em;opacity:.8;pointer-events:none;text-shadow:0 0 4px #000;transition:opacity 1.5s';
hint.textContent='Drag: pan \u00b7 Right-drag: tilt/rotate \u00b7 Wheel: zoom \u00b7 \u27f2 top view';const bd=$b('bd');if(bd){bd.appendChild(hint);setTimeout(()=>{hint.style.opacity=0},9000)}
})();
