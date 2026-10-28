// Network tests: room logic, then two real page instances playing through the relay (with latency), disconnects, desync, rematch.
const fs=require('fs'),vm=require('vm');
const HTML='/mnt/user-data/outputs/versus-prototype.html',SRV='/mnt/user-data/outputs/versus-server/';
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL: '+m)}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

function makeClient(base,seed){
 const page=fs.readFileSync(HTML,'utf8');let s=page.slice(page.indexOf('<script>')+8,page.lastIndexOf('</script>'));
 const el={};const ctx2=new Proxy({},{get:(o,k)=>typeof k==='string'&&/Style|Width|Alpha/.test(k)?0:function(){},set:()=>true});
 const defaults={nurl:base,ncode:'',nmode:'blocks',nchar:'0'};
 const E=i=>el[i]||(el[i]={value:i in defaults?defaults[i]:i.startsWith('ctl')?'human':'blocks',width:0,height:0,textContent:'',innerHTML:'',hidden:false,style:{},getContext:()=>ctx2,blur(){}});
 let cb=null;const L={};const sb={document:{getElementById:E,activeElement:null},getComputedStyle:()=>({getPropertyValue:()=>'#000'}),performance:{now:()=>0},__l:L,addEventListener(ty,f){(L[ty]=L[ty]||[]).push(f)},
  requestAnimationFrame:f=>{cb=f},WebSocket:globalThis.WebSocket,fetch:globalThis.fetch,setInterval,clearInterval,setTimeout,Date,console};
 vm.createContext(sb);
 vm.runInContext(s+';globalThis.api={get A(){return A},get B(){return B},get rec(){return rec},get done(){return done},get online(){return online},get ML(){return ML},get MR(){return MR},get seed(){return seed},get held1(){return held1},get menuOpen(){return menuOpen},get attract(){return attract},get seed2(){return seed},get NET(){return NET},get FX(){return FX},hash(){return [ML.m.hash(A),MR.m.hash(B)]}}',sb);
 const api=sb.api,r=rng(seed);let t=0;const keys=['a','d','s','w',' '];
 return {api,E,msg:()=>E('msg').textContent,stat:()=>E('nstat').textContent,
  frame(){t+=1000/60+0.01;if(api.online&&!api.done&&r()<0.08){const k=keys[Math.floor(r()*5)];api.held1[k]=!api.held1[k]}cb(t)},
  key(ty,ev){(L[ty]||[]).forEach(f=>f(ev))},click(id){E(id).onclick()},set(id,v){E(id).value=v;if(E(id).onchange)E(id).onchange()}}}

async function pump(cs,cond,max){for(let i=0;i<max;i++){for(const c of cs)c.frame();await sleep(0);if(cond&&cond())return true}return !cond}
async function lobby(base,modes,chars){
 const h=makeClient(base,11),g=makeClient(base,22);
 h.click('nhost');for(let i=0;i<200&&!h.api.NET.code;i++)await sleep(5);
 const code=h.api.NET.code;
 g.E('ncode').value=code.toLowerCase();g.click('njoin');for(let i=0;i<600&&(g.api.NET.slot<0||h.api.NET.slot<0);i++)await sleep(5);
 h.set('nmode',modes[0]);g.set('nmode',modes[1]);h.set('nchar',String(chars[0]));g.set('nchar',String(chars[1]));await sleep(30);
 return {h,g,code}}

(async()=>{
 // ---- main menu and keyboard ----
 {const c=makeClient('http://x',7),E=c.E;
  ok(E('menu').hidden===false&&c.api.menuOpen,'menu: shown at start');
  c.click('mcpu');ok(E('m-setup').hidden===false&&E('m-main').hidden===true,'menu: Play vs CPU opens the setup screen');
  c.set('mmL','panel');c.set('mmR','random');c.click('mstart');
  ok(E('menu').hidden===true&&!c.api.menuOpen,'menu: Start closes the menu');
  ok(E('ctlL').value==='human'&&E('ctlR').value==='bot'&&E('selL').value==='panel','menu: CPU match is human (left) vs bot (right), left mode honoured');
  for(let i=0;i<400;i++)c.frame();ok(c.api.rec.length>100&&!c.api.online,'menu: CPU match runs');ok(c.api.FX.errors.length===0,'menu: no FX errors in a CPU match');
  // bug: letters A D S W (used by the game) could not be typed into the room-code or server boxes
  let prevented=false;c.key('keydown',{key:'a',target:{tagName:'INPUT'},preventDefault(){prevented=true}});
  ok(!prevented&&!c.api.held1.a,'typing in a text box is not swallowed by game keys');
  c.key('keydown',{key:'a',target:{tagName:'BODY'},preventDefault(){prevented=true}});ok(prevented&&c.api.held1.a,'game keys still work outside text boxes');
  c.key('keyup',{key:'a',target:{tagName:'BODY'}});
  c.click('mb');ok(E('menu').hidden===false,'menu: the Menu button reopens it');
  prevented=false;c.key('keydown',{key:'d',target:{tagName:'BODY'},preventDefault(){prevented=true}});ok(!prevented&&!c.api.held1.d,'game keys are ignored while the menu is open');
  c.click('mlocal');c.set('mmR','bubble');c.click('mstart');ok(E('ctlL').value==='human'&&E('ctlR').value==='human'&&E('selR').value==='bubble','menu: local 2-player is human vs human');
  for(let i=0;i<300;i++)c.frame();ok(c.api.FX.errors.length===0,'menu: no FX errors in a local match');
  c.click('mb');  ok(/id="spop" hidden/.test(fs.readFileSync(HTML,'utf8')),'sound: settings start closed');E('spop').hidden=true; // the test DOM does not reflect the hidden attributec.click('sbtn');ok(E('spop').hidden===false,'sound: the speaker button in the game opens the sound settings, even over the menu');
  ok(c.api.FX.wanted(),'sound: on by default');c.click('snd');ok(!c.api.FX.wanted(),'sound: the mute button mutes');c.click('snd');ok(c.api.FX.wanted(),'sound: and unmutes');
  E('vsfx').value='0.3';E('vsfx').oninput();E('vmus').value='0.1';E('vmus').oninput();ok(Math.abs(c.api.FX.getSfx()-0.3)<1e-9&&Math.abs(c.api.FX.getMusicVol()-0.1)<1e-9,'sound: effects and music have separate sliders');
  c.key('keydown',{key:'m',target:{tagName:'BODY'},preventDefault(){}});ok(!c.api.FX.wanted(),'sound: M mutes even while a menu is open');c.key('keydown',{key:'m',target:{tagName:'BODY'},preventDefault(){}});
  c.key('keydown',{key:'Escape',target:{tagName:'BODY'},preventDefault(){}});ok(E('spop').hidden===true,'sound: Escape closes the sound settings');
  c.click('sbtn');c.key('pointerdown',{target:{closest:()=>null}});ok(E('spop').hidden===true,'sound: clicking elsewhere closes the sound settings');
  c.click('sbtn');c.key('pointerdown',{target:{closest:s=>s==='#sndwrap'?{}:null}});ok(E('spop').hidden===false,'sound: clicking inside the settings keeps them open');c.click('sbtn');
  ok(E('m-main').hidden===false,'sound: opening the settings does not change the menu screen');
  c.click('mb');c.click('monline');ok(E('m-online').hidden===false,'menu: Play online opens the lobby screen');c.click('mobk');ok(E('m-main').hidden===false&&E('m-online').hidden===true,'menu: Back returns to the main menu');
  c.click('mdemo');ok(E('menu').hidden===true&&c.api.attract,'demo: Watch demo closes the menu and starts the bot demo');
  ok(E('ctlL').value==='bot'&&E('ctlR').value==='bot','demo: both sides are bots');
  const seen=new Set([c.api.seed]),modes=new Set([E('selL').value+'/'+E('selR').value]);let ended=0,fr=0;
  for(;fr<40000&&seen.size<4;fr++){if(c.api.done)ended++;c.frame();seen.add(c.api.seed);modes.add(E('selL').value+'/'+E('selR').value)}
  ok(seen.size>=4,'demo: keeps rematching with new seeds on its own ('+seen.size+' matches in '+fr+' frames)');ok(modes.size>=2,'demo: matchups are random ('+[...modes].join(', ')+')');
  ok(c.api.attract&&c.api.FX.errors.length===0,'demo: still in demo mode, no FX errors');
  c.key('keydown',{key:'x',target:{tagName:'BODY'},preventDefault(){}});ok(E('menu').hidden===false&&c.api.menuOpen,'demo: any key press returns to the menu');
  c.click('mdemo');c.key('pointerdown',{});ok(E('menu').hidden===false,'demo: a click or tap also returns to the menu');
  for(let i=0;i<200;i++)c.frame();ok(c.api.attract,'demo: keeps running behind the menu')}
 const core=await import(SRV+'src/room_core.mjs');
 // ---- room logic ----
 {const st=core.newRoom();let j=core.join(st);ok(j.slot===0,'first player gets slot 0');j=core.join(st);ok(j.slot===1,'second gets slot 1');
  j=core.join(st);ok(j.slot===-1&&JSON.parse(j.out[0].raw).reason==='full','third player is refused with "full"');
  let r=core.handle(st,0,JSON.stringify({t:'b',f:0,m:[1,2,3,4]}),Math.random);ok(r.out.length===1&&r.out[0].to===1&&!r.changed,'inputs relay only to the other player and do not touch state');
  r=core.handle(st,0,'not json',Math.random);ok(r.out.length===0,'bad JSON ignored');r=core.handle(st,0,'x'.repeat(5000),Math.random);ok(r.out.length===0,'oversize message ignored');
  r=core.handle(st,0,JSON.stringify({t:'weird'}),Math.random);ok(r.out.length===0,'unknown type ignored');
  r=core.handle(st,0,JSON.stringify({t:'ready',mode:'panel',ch:1}),Math.random);ok(!r.out.some(o=>JSON.parse(o.raw).t==='start'),'one ready player does not start');
  r=core.handle(st,1,JSON.stringify({t:'ready',mode:'bogus',ch:7}),()=>0.5);const sm=r.out.map(o=>JSON.parse(o.raw)).find(m=>m.t==='start');
  ok(sm&&sm.modes[0]==='panel'&&sm.modes[1]==='blocks'&&sm.chars[0]===1&&sm.chars[1]===1,'start carries sanitized modes and characters: '+JSON.stringify(sm));
  ok(sm&&sm.seed===1073741823&&st.n===1&&!st.players[0].ready&&!st.players[1].ready,'start picks the seed and clears ready flags');
  let o=core.leave(st,0);ok(o.some(x=>x.to===1&&JSON.parse(x.raw).t==='left'),'leaving notifies the other player');
  j=core.join(st);ok(j.slot===0,'a freed seat can be taken again');
  const c=core.genCode(Math.random);ok(core.CODE_RE.test(c),'generated codes match the alphabet');
  let bad=0;for(let i=0;i<500;i++)if(/[ILO01]/.test(core.genCode(Math.random)))bad++;ok(bad===0,'codes never contain confusable characters')}

 // ---- Durable Object class against a mock runtime ----
 {global.WebSocketRequestResponsePair=function(a,b){this.a=a;this.b=b};
  global.WebSocketPair=function(){const mk=()=>({sent:[],closed:null,att:null,send(x){this.sent.push(x)},close(c,r){this.closed=[c,r]},serializeAttachment(a){this.att=a},deserializeAttachment(){return this.att}});this[0]=mk();this[1]=mk()};
  const store=new Map(),socks=[];let alarm=null;
  const ctx={storage:{get:async k=>store.get(k),put:async(k,v)=>store.set(k,JSON.parse(JSON.stringify(v))),setAlarm:async t=>{alarm=t},deleteAll:async()=>store.clear()},
   blockConcurrencyWhile:async f=>{await f()},setWebSocketAutoResponse(){},acceptWebSocket(w){socks.push(w)},getWebSockets:()=>socks};
  const {Room}=await import(SRV+'src/worker.mjs');
  const ro=new Room(ctx,{});await sleep(1);
  const up=()=>new Request('https://x/ws/ABCDE',{headers:{Upgrade:'websocket'}});
  // Response with status 101 is not constructible in node; wrap
  const OrigResponse=Response;global.Response=class extends OrigResponse{constructor(b,i){if(i&&i.status===101){super(null,{status:200});this.webSocket=i.webSocket;this._s=101}else super(b,i)}};
  let r=await ro.fetch(up());ok(socks[0]&&JSON.parse(socks[0].sent[0]).t==='error','DO: socket to a room that was never created gets an error');
  socks.length=0;
  ok((await ro.fetch(new Request('https://room/init'))).status===200,'DO: init creates a room');ok((await ro.fetch(new Request('https://room/init'))).status===409,'DO: init twice is refused');ok(alarm>Date.now(),'DO: cleanup alarm is set');
  await ro.fetch(up());await ro.fetch(up());ok(socks.length===2&&socks[0].att.slot===0&&socks[1].att.slot===1,'DO: two sockets get slots 0 and 1');
  await ro.fetch(up());ok(JSON.parse(socks[2].sent[0]).reason==='full'&&socks[2].closed,'DO: third socket is told the room is full and closed');
  await ro.webSocketMessage(socks[0],JSON.stringify({t:'b',f:0,m:[1,2,3,4]}));ok(socks[1].sent.some(x=>JSON.parse(x).t==='b'),'DO: inputs are relayed to the other socket');ok(!socks[0].sent.some(x=>JSON.parse(x).t==='b'),'DO: inputs are not echoed back');
  await ro.webSocketMessage(socks[0],JSON.stringify({t:'ready',mode:'chain',ch:0}));await ro.webSocketMessage(socks[1],JSON.stringify({t:'ready',mode:'bubble',ch:1}));
  ok(socks[0].sent.some(x=>JSON.parse(x).t==='start')&&socks[1].sent.some(x=>JSON.parse(x).t==='start'),'DO: both ready -> both get start');
  const before=socks[1].sent.length;await ro.webSocketClose(socks[0],1001);ok(socks.slice(0,2)[1].sent.slice(before).some(x=>JSON.parse(x).t==='left'),'DO: close notifies the remaining player');
  socks.splice(0,1);await ro.webSocketClose(socks[0],1001);ok(store.get('st').players.every(p=>p===null),'DO: state shows both seats empty');
  const ro2=new Room(ctx,{});await sleep(1);ok(ro2.st&&ro2.st.n===1,'DO: state survives a restart (hibernation) via storage');
  socks.length=0;await ro.alarm();ok(store.size===0&&ro.st===null,'DO: alarm deletes an abandoned room');
  global.Response=OrigResponse}

 // ---- two real pages through the relay ----
 const {startServer}=await import(SRV+'dev/node_server.mjs');
 async function match(name,opts,modes,ticks,extra){
  const srv=await startServer(opts);const base='http://localhost:'+srv.port;
  const {h,g,code}=await lobby(base,modes,[0,1]);
  ok(/^[A-Z2-9]{5}$/.test(code),name+': host got a room code '+code);
  ok(g.api.NET.slot>=0&&h.api.NET.slot>=0&&g.api.NET.slot!==h.api.NET.slot,name+': both players seated in different slots (lowercase code accepted)');
  h.click('nready');g.click('nready');
  for(let i=0;i<200&&!(h.api.online&&g.api.online);i++)await sleep(5);
  ok(h.api.online&&g.api.online,name+': both clients started the online match');
  ok(h.api.seed===g.api.seed&&h.api.ML===h.api.ML,name+': same seed on both clients');
  if(extra&&extra.during)await extra.during(h,g,srv);
  else{await pump([h,g],()=>h.api.rec.length>=ticks&&g.api.rec.length>=ticks||h.api.done&&g.api.done,ticks*40);}
  return {h,g,srv,base}}
 const same=(h,g,name,upto,min)=>{const n=Math.min(h.api.rec.length,g.api.rec.length,upto||1e9);let diff=-1;for(let i=0;i<n;i++)if(h.api.rec[i][0]!==g.api.rec[i][0]||h.api.rec[i][1]!==g.api.rec[i][1]){diff=i;break}
  ok(n>(min||30),name+': played '+n+' ticks');ok(diff<0,name+': both clients recorded identical inputs (first difference at '+diff+')');
  if(h.api.rec.length===g.api.rec.length)ok(JSON.stringify(h.api.hash())===JSON.stringify(g.api.hash()),name+': final state hashes match');
  ok(h.api.FX.errors.length===0&&g.api.FX.errors.length===0,name+': no FX errors');ok(!globalThis.__desync,name+': no desync reported')};

 for(const [name,opts,modes] of [['lan',{},['blocks','chain']],['40ms',{delay:40,jitter:30},['blocks','bubble']],['120ms',{delay:120,jitter:60},['chain','blocks']]]){
  const {h,g,srv}=await match(name,opts,modes,1500);
  // equalise: let the slower client finish the same tick count
  await pump([h,g],()=>h.api.rec.length===g.api.rec.length||h.api.done&&g.api.done,4000);
  same(h,g,name,0,name==='lan'?150:30);if(name==='120ms')ok(h.api.NET.delay>=6,'120ms: input delay adapted ('+h.api.NET.delay+' ticks, rtt '+Math.round(h.api.NET.rtt)+'ms)');
  h.api.NET.leave();g.api.NET.leave();await srv.close()}

 // disconnect mid-match
 {const {h,g,srv}=await match('disconnect',{},['blocks','panel'],300);
  g.api.NET.leave();await pump([h],()=>h.api.done,300);
  ok(h.api.done&&/forfeit/.test(h.msg()),'disconnect: remaining player wins by forfeit ('+h.msg()+')');h.api.NET.leave();await srv.close()}

 // desync detection
 {const {h,g,srv}=await match('desync',{},['blocks','blocks'],200);
  g.api.A.b[199]=3;g.api.A.b[198]=4; // corrupt the guest's copy of the left board
  await pump([h,g],()=>h.api.done&&g.api.done,400);
  ok(h.api.done&&g.api.done&&/Desync/.test(h.msg())&&/Desync/.test(g.msg()),'desync: both sides detect the divergence and stop ('+h.msg()+' | '+g.msg()+')');h.api.NET.leave();g.api.NET.leave();await srv.close()}

 // rematch (ready again while playing = new match with a new seed)
 {const {h,g,srv}=await match('rematch',{},['chain','panel'],200);
  const s1=h.api.seed;h.api.NET.ready('chain',0,true);g.api.NET.ready('panel',1,true);
  await pump([h,g],()=>h.api.seed!==s1&&g.api.seed!==s1,300);ok(h.api.seed!==s1&&h.api.seed===g.api.seed,'rematch: both clients restarted with a new shared seed');
  await pump([h,g],()=>h.api.rec.length>=600&&g.api.rec.length>=600,3000);await pump([h,g],()=>h.api.rec.length===g.api.rec.length,2000);
  same(h,g,'rematch');h.api.NET.leave();g.api.NET.leave();await srv.close()}

 // errors: full room, wrong code
 {const srv=await startServer({});const base='http://localhost:'+srv.port;const {h,g,code}=await lobby(base,['blocks','blocks'],[0,1]);
  const x=makeClient(base,33);x.E('ncode').value=code;x.click('njoin');await sleep(150);ok(/full/i.test(x.stat()),'full room: third player sees "'+x.stat()+'"');
  const y=makeClient(base,44);y.E('ncode').value='ZZZZZ';y.click('njoin');await sleep(150);ok(/No room/i.test(y.stat()),'wrong code: "'+y.stat()+'"');
  const z=makeClient(base,55);z.E('ncode').value='AB';z.click('njoin');ok(/5 characters/.test(z.stat()),'short code is rejected locally');
  [h,g,x,y].forEach(c=>c.api.NET.leave());await srv.close()}

 console.log(`net checks: ${pass} passed, ${fail} failed`);process.exit(fail?1:0)})().catch(e=>{console.log('FAIL: net test crashed: '+(e.stack||e));console.log(`net checks: ${pass} passed, ${fail+1} failed`);process.exit(1)});
