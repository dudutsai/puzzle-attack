// Online play: lobby codes + lockstep input relay. The server only forwards messages.
// Each client runs both sims; only inputs cross the network. Tick f needs both sides' masks for f.
const NET=(function(){
 const BATCH=4,DMIN=4,DMAX=16,HASH_EVERY=60;
 const cb={status:function(){},room:function(){},start:function(){},left:function(){},error:function(){},desync:function(){}};
 let errored=false,ws=null,slot=-1,code="",room=null,open=false,D=6,rtt=0,pingT=null,lastP=0;
 let lm=[],rm=[],sent=0,lHash={},rHash={},active=false,lastMask=0,stalled=0;
 function normCode(c){return String(c||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}
 function wsUrl(b,c){return String(b).replace(/\/+$/,"").replace(/^http/i,"ws")+"/ws/"+c}
 function httpUrl(b){return String(b).replace(/\/+$/,"").replace(/^ws/i,"http")}
 function send(o){if(ws&&open){try{ws.send(JSON.stringify(o));return true}catch(e){}}return false}
 function connect(base,c){
  code=c;slot=-1;room=null;open=false;errored=false;
  cb.status("Connecting to room "+c+"...");
  let w;try{w=new WebSocket(wsUrl(base,c))}catch(e){cb.error("Could not open a connection: "+e);return}
  ws=w;
  w.onopen=function(){if(ws!==w)return;open=true;lastP=Date.now();clearInterval(pingT);pingT=setInterval(function(){if(open&&!active)try{w.send("ping")}catch(e){}},20000)};
  w.onmessage=function(ev){if(ws!==w)return;const d=typeof ev.data==="string"?ev.data:"";if(d==="pong")return;let m;try{m=JSON.parse(d)}catch(e){return}onMsg(m)};
  w.onclose=function(){if(ws!==w)return;open=false;clearInterval(pingT);ws=null;if(active){active=false;cb.left("connection")}else if(!errored)cb.status("Disconnected.");};
  w.onerror=function(){if(ws!==w)return;cb.error("Connection failed. Check the server address and the code.")}}
 function onMsg(m){
  switch(m.t){
   case "welcome":slot=m.slot;cb.status("In room "+code+" as the "+(slot===0?"left":"right")+" player.");break;
   case "room":room=m.players;cb.room(room,slot);break;
   case "start":cb.start(m);break;
   case "left":if(active){active=false;cb.left("opponent")}else cb.status("Opponent left the room.");break;
   case "error":errored=true;cb.error(m.reason==="full"?"That room is full.":m.reason==="no-room"?"No room with that code.":"Server error: "+m.reason);break;
   case "b":if(active)onBatch(m);break;
   case "h":if(active){rHash[m.f]=[m.a,m.b];checkHash(m.f)}break;
   case "p":send({t:"q",ts:m.ts});break;
   case "q":if(typeof m.ts==="number"){const r=Date.now()-m.ts;if(r>=0&&r<5000){rtt=rtt?rtt*.8+r*.2:r}}break;
  }}
 function onBatch(m){
  if(!Array.isArray(m.m)||typeof m.f!=="number"||m.f>rm.length)return;
  for(let i=0;i<m.m.length;i++){const f=m.f+i;if(f>=rm.length)rm.push(m.m[i]&31)}}
 function checkHash(f){const a=lHash[f],b=rHash[f];if(!a||!b)return;delete lHash[f];delete rHash[f];
  if(a[0]!==b[0]||a[1]!==b[1]){active=false;cb.desync({f:f,local:a,remote:b})}}
 function flush(){while(lm.length-sent>=BATCH&&send({t:"b",f:sent,m:lm.slice(sent)}))sent=lm.length}
 function setDelayFromRtt(f){
  if(!rtt||f%120!==0)return;
  const want=Math.max(DMIN,Math.min(DMAX,Math.ceil((rtt/2+55)/(1000/60))+1));
  if(want>D||want<D-1)D=want}
 return {
  on:function(n,f){cb[n]=f},
  get slot(){return slot},get code(){return code},get active(){return active},get delay(){return D},get rtt(){return rtt},get stalledMs(){return stalled},
  get connected(){return open},
  normCode:normCode,
  host:function(base){
   cb.status("Creating a room...");
   return fetch(httpUrl(base)+"/create",{method:"POST"}).then(function(r){if(!r.ok)throw new Error("server said "+r.status);return r.json()})
    .then(function(j){connect(base,j.code)}).catch(function(e){cb.error("Could not create a room: "+e.message)})},
  join:function(base,c){c=normCode(c);if(c.length!==5){cb.error("Codes are 5 characters.");return}connect(base,c)},
  pick:function(mode,ch){send({t:"pick",mode:mode,ch:ch})},
  ready:function(mode,ch,r){send({t:"ready",mode:mode,ch:ch,ready:r!==false})},
  leave:function(){active=false;clearInterval(pingT);const w=ws;ws=null;open=false;slot=-1;room=null;if(w)try{w.close()}catch(e){}},
  // match
  begin:function(){lm=[];rm=[];sent=0;lHash={};rHash={};lastMask=0;stalled=0;active=true;
   for(let i=0;i<D;i++)lm.push(0);flush()},
  sample:function(f,mask){ // record this tick's local input for tick f+D
   const target=f+D+1;mask&=31;
   while(lm.length<target-1)lm.push(lastMask);
   if(lm.length<target){lm.push(mask);lastMask=mask}
   flush();setDelayFromRtt(f);
   if(f%120===60&&open)send({t:"p",ts:Date.now()})},
  local:function(f){return f<lm.length?lm[f]:0},
  remote:function(f){return f<rm.length?rm[f]:-1},
  stall:function(ms){stalled=ms>0?stalled+ms:0},
  hash:function(f,ha,hb){if(f%HASH_EVERY!==HASH_EVERY-1)return;lHash[f]=[ha,hb];send({t:"h",f:f,a:ha,b:hb});checkHash(f)},
  stop:function(){active=false}
 }})();
