// PREPARATION ONLY: Root must grant this exact single public meter run.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const STAGE = '/Users/nevinmckinnon/.codex/tools/rougehalla-stage2';
const REPO = `${STAGE}/coordination/root-backend-integration-01/repo`;
const ACTUAL = 'https://play.rougehalla.com', WSS = 'wss://play.rougehalla.com/ws', VIRTUAL = 'https://localhost:19443';
const CONTENT = '7c6a633f68c2cc72', EXPIRY = Date.parse('2026-11-10T03:50:21Z');
const INPUTS = [
  [`${REPO}/tools/unity-browser-reload-proof/normal-companion.mjs`, 'a7daa256907d23e6c392e368e5a9797af928405ab373bd48deecc5abd773bef9'],
  [`${REPO}/crates/rh-server/web/probe.html`, 'b6ef4b4b12aa2e1844c823a11ee18ef1cdd7f062942cd207e5207cd356d38dd7'],
  [`${REPO}/protocol/fixtures/v14.json`, '9012167a320419d04d62aa340276d7fbc5181a60ea818554f278a62d26b1b336']];
const NODE_SHA = '2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0';
const pause = ms => new Promise(r => setTimeout(r, ms)), sha = b => crypto.createHash('sha256').update(b).digest('hex');
function fail(code) { const e = new Error(code); e.fixed = code; throw e; }
function bytes(v) { if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength); fail('NON_BINARY_PAYLOAD'); }
function buffer(v) { const b = bytes(v); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function owner(p) { const v = p.view(), s = v.snapshot, m = s?.me; return { connected: v.connected,
  errors: v.errors, rejectCodes: v.rejects.map(r => r.code), player: m?.id, phase: s?.phase, training: s?.training,
  faction: m?.faction, hp: m?.hp, status: m?.status, tick: s?.tick, serverMs: s?.serverMs }; }
function active(p) { const v = owner(p); return v.connected && !v.errors.length && !v.rejectCodes.length &&
  v.phase === 1 && v.training === false && v.faction === 4 && v.status === 1 && v.hp > 0; }
function plan(p) { return new Map(p.view().collections).get(8); }
async function info() { const r = await fetch(`${ACTUAL}/info`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!r.ok) fail('SOURCE_INFO_HTTP'); const v = await r.json(); return Object.fromEntries(
    ['protocol','contentHash','state','rooms','lobbies','players','resultsOk','resultsFailed','resultsRefused']
      .filter(k => typeof v[k] === 'number' || typeof v[k] === 'string').map(k => [k,v[k]])); }
function counts() { return { bytes: 0, frames: 0, tags: {} }; }
function count(c, b) { c.bytes += b.byteLength; c.frames++; c.tags[b[0]] = (c.tags[b[0]] || 0) + 1;
  if (c.bytes > 32 * 1024 * 1024 || b.byteLength > 1024 * 1024) fail('APPLICATION_PAYLOAD_BOUND'); }
function summary(rows) { const a = rows.map(r => r.rttMs).sort((x,y)=>x-y); return a.length ? {
  count:a.length, minMs:a[0], medianMs:a[Math.floor((a.length-1)*.5)], p95Ms:a[Math.floor((a.length-1)*.95)], maxMs:a.at(-1)
} : { count:0 }; }
async function main() {
  if (process.argv.slice(2).join() !== '--run' || process.env.RH_CALGARY_WSS_REVIEW !== 'approved' ||
      process.env.RH_CALGARY_WSS_ENDPOINT !== ACTUAL) fail('ROOT_EXACT_ENDPOINT_LEASE_REQUIRED');
  if (process.version !== 'v22.23.4' || sha(await fs.readFile(process.execPath)) !== NODE_SHA) fail('PINNED_NODE_REQUIRED');
  if (Date.now() + 180000 >= EXPIRY) fail('EXPIRY_TOO_CLOSE');
  for (const [p,h] of INPUTS) if (sha(await fs.readFile(p)) !== h) fail('INPUT_PIN');
  const out = path.resolve(process.env.RH_CALGARY_WSS_OUT || '');
  if (!process.env.RH_CALGARY_WSS_OUT || !out.startsWith(`${STAGE}/coordination/reports/`)) fail('FRESH_OUTPUT_REQUIRED');
  await fs.mkdir(out, { mode:0o700 });
  const html = await fs.readFile(INPUTS[1][0], 'utf8'), start = html.indexOf('// ---- protocol v14 '), end = html.indexOf('// ---- probe state', start);
  if (start < 0 || end <= start) fail('CODEC_BLOCK');
  const codec = new Function(`${html.slice(start,end)}\nreturn {PROTOCOL,decode,decodeClient};`)();
  const vectors = JSON.parse(await fs.readFile(INPUTS[2][0], 'utf8'));
  const pingVector = vectors.client.find(v=>v.name==='ping'), pongVector = vectors.server.find(v=>v.name==='pong');
  const pv = codec.decodeClient(buffer(Buffer.from(pingVector.hex,'hex'))), qv = codec.decode(buffer(Buffer.from(pongVector.hex,'hex')));
  if (codec.PROTOCOL !== 14 || vectors.protocol !== 14 || pv.t!=='ping' || qv.t!=='pong' ||
      pv.nonce!==qv.nonce || !Object.is(pv.clientMs,qv.clientMs) || pv.clientMs!==1.5 || qv.serverMs!==5051.25) fail('PING_PONG_VECTOR');
  const PING_TAG = Buffer.from(pingVector.hex,'hex')[0], PONG_TAG = Buffer.from(pongVector.hex,'hex')[0];
  const NativeSocket = globalThis.WebSocket, sockets = new Set(), meters = [], peers = [];
  const report = { status:'INCOMPLETE', startedUtc:new Date().toISOString(), ownedNodePid:process.pid, actualOrigin:ACTUAL,
    actualSocket:WSS, adapter:'Fixed virtual-origin dependency injection only; no loopback listener/proxy. All redirects refused.',
    protocol:14, contentHash:CONTENT, inputs:INPUTS, meters, cleanup:{}, limits:[
      'Only application binary message payload bytes during actual window; excludes Hello/Welcome/map/setup/Leave and all TCP/TLS/WebSocket framing/control overhead.',
      'Outgoing bytes count successful native WebSocket.send acceptance, not proven kernel write/delivery.',
      'RTT is matched unchanged helper1Hz application Ping/Pong; includes WSS/server queue and endpoint event loops; not HTTP ping, clock offset or input-to-visible latency.',
      'No extra Ping, gameplay stimulus or hidden/private world query. Stationary public Source scene; one run, ambient load/death may refuse.',
      'Per-window mixed-frame byte rates include ordinary Ping/Pong. Node/client runtime is not Unity/browser transport performance.' ] };
  let windowOpen=false, windowStart=0, aborted=false, meterError=null;
  const abort=()=>{aborted=true;}; process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const watchdog=setTimeout(abort,180000), deadline=performance.now()+180000;
  function check(requireActive=false) { if(aborted || performance.now()>=deadline || Date.now()>=EXPIRY) fail('TIME_BOUND');
    if(meterError) fail(meterError); for(const p of peers) {const v=owner(p);
      if(!v.connected || v.errors.length || v.rejectCodes.length || (requireActive && !active(p))) fail('PUBLIC_PEER_GATE');} }
  async function wait(pred, ms) {const until=Math.min(deadline,performance.now()+ms);
    while(performance.now()<until){check();if(pred())return;await pause(100);}fail('PUBLIC_GATE_TIMEOUT');}
  try {
    report.initialInfo=await info(); const initial=report.initialInfo;
    if(initial.protocol!==14 || initial.contentHash!==CONTENT || initial.state!=='ready')fail('SOURCE_IDENTITY');
    if(initial.rooms!==0 || initial.players!==0 || initial.lobbies!==0)fail('SOURCE_OCCUPIED_NO_RETAKE');
    const {connectNormalCompanion}=await import(pathToFileURL(INPUTS[0][0]));
    const suffix=crypto.randomBytes(4).toString('hex');
    for(let seat=0;seat<3;seat++) {
      const profile=`wm${seat}_${suffix}`, allowed=new Set(['/info',`/api/profile/${profile}`]);
      const meter={seat:seat+1,incoming:counts(),outgoing:counts(),sentWindowPings:0,rtts:[], pendingWindowAtEnd:0}; meters.push(meter);
      const pending=new Map();
      class MeterSocket extends NativeSocket {
        constructor(url) {
          if(String(url)!=='wss://localhost:19443/ws' || sockets.size>=3)fail('SOCKET_ALLOWLIST');
          super(WSS); sockets.add(this); this.binaryType='arraybuffer';
          this.addEventListener('message',ev=>{const at=performance.now();try {
            const b=bytes(ev.data);if(windowOpen)count(meter.incoming,b);
            if(b[0]!==PONG_TAG)return;
            if(b.byteLength!==21)fail('PONG_EXACT_LENGTH');
            const m=codec.decode(buffer(b)), sent=pending.get(m.nonce);
            if(!sent || m.t!=='pong' || !Object.is(m.clientMs,sent.clientMs) || !Number.isFinite(m.serverMs))fail('PONG_MATCH');
            pending.delete(m.nonce);
            if(windowOpen && sent.inWindow) {
              const rtt=at-m.clientMs;if(!Number.isFinite(rtt)||rtt<0||meter.rtts.length>=64)fail('RTT_BOUND');
              meter.rtts.push({nonce:m.nonce,clientMs:m.clientMs,sentAtMs:sent.at,receivedAtMs:at, rttMs:rtt, sendToReceiveMs:at-sent.at,serverMs:m.serverMs});
            }
          }catch(e){meterError=e.fixed||'METER_DECODE';}});
        }
        send(data) {
          const b=bytes(data), at=performance.now(); let ping=null;
          if(b[0]===PING_TAG) {if(b.byteLength!==13)fail('PING_EXACT_LENGTH');ping=codec.decodeClient(buffer(b));if(ping.t!=='ping'||pending.has(ping.nonce)||pending.size>=32)fail('PING_MATCH_BOUND');}
          super.send(data);
          if(windowOpen)count(meter.outgoing,b);
          if(ping){pending.set(ping.nonce,{clientMs:ping.clientMs,at,inWindow:windowOpen});if(windowOpen)meter.sentWindowPings++;}
        }
      }
      const fetchImpl=(url,init)=>{const u=new URL(url);
        if(u.origin!==VIRTUAL || !allowed.has(u.pathname)||u.search||u.hash||u.username||u.password||init?.method!=='GET')fail('HTTP_ALLOWLIST');
        return fetch(new URL(u.pathname,ACTUAL),{...init,redirect:'error'});};
      const p=await connectNormalCompanion({endpoint:VIRTUAL,profile,faction:4,fetchImpl,WebSocketImpl:MeterSocket,timeoutMs:10000});
      peers.push(p); meter.pendingAtEnd=()=>[...pending.values()].filter(v=>v.inWindow).length;
    }
    const welcomes=peers.map(p=>p.view().welcome), first=welcomes[0];
    const match=Buffer.from(first.match).toString('hex'), map=JSON.stringify(first.map);
    if(first.match.length!==16 || !welcomes.every(w=>w.protocol===14&&w.contentHash===CONTENT&&Buffer.from(w.match).toString('hex')===match&&JSON.stringify(w.map)===map))fail('SAME_PUBLIC_MATCH_MAP');
    report.publicMatchId=match;report.publicMap={w:first.map.w,h:first.map.h,collisionHash:first.map.hash,semanticHash:first.map.semanticHash,contextHash:first.map.contextHash};
    await wait(()=>peers.every(p=>p.view().snapshot?.phase===3&&plan(p)),45000);
    for(const p of peers) {
      const v=plan(p),choices=v.options.map((o,slot)=>o&&!v.taken[slot]?{slot,index:o.index,x:o.x,y:o.y}:null).filter(Boolean).sort((a,b)=>a.x-b.x||a.y-b.y||a.index-b.index);
      if(!choices.length)fail('NO_DELIVERED_PLAN_PICK');const pick=choices[0].slot;
      p.send([{k:'plan',spawn:pick,ready:false}]);await wait(()=>plan(p)?.pick===pick,5000);
      p.send([{k:'plan',ready:true}]);await wait(()=>plan(p)?.ready===true||p.view().snapshot?.phase===1,5000);
    }
    await wait(()=>peers.every(active),60000);check(true);report.beforeWindowInfo=await info();
    if(report.beforeWindowInfo.rooms!==1 || report.beforeWindowInfo.players!==3)fail('EXACT_THREE_PUBLIC_SEATS');
    report.windowStartOwners=peers.map(owner);windowStart=performance.now();report.windowStartedUtc=new Date().toISOString();windowOpen=true;
    while(performance.now()-windowStart<30000){check(true);await pause(Math.min(100,30000-(performance.now()-windowStart)));}
    windowOpen=false;report.windowActualMs=performance.now()-windowStart;check(true);report.windowEndOwners=peers.map(owner);
    for(const m of meters){m.pendingWindowAtEnd=m.pendingAtEnd();delete m.pendingAtEnd;
      if(m.rtts.length<20)fail('INSUFFICIENT_MATCHED_ORDINARY_PONGS');m.rttSummary=summary(m.rtts);
      m.incoming.bytesPerSecond=m.incoming.bytes/(report.windowActualMs/1000);m.outgoing.bytesPerSecond=m.outgoing.bytes/(report.windowActualMs/1000);}
    report.aggregate={incomingBytes:meters.reduce((a,m)=>a+m.incoming.bytes,0),outgoingBytes:meters.reduce((a,m)=>a+m.outgoing.bytes,0),rttSummary:summary(meters.flatMap(m=>m.rtts))};
    report.aggregate.incomingBytesPerSecond=report.aggregate.incomingBytes/(report.windowActualMs/1000);
    report.aggregate.outgoingBytesPerSecond=report.aggregate.outgoingBytes/(report.windowActualMs/1000);
    report.afterWindowInfo=await info();
    if(report.afterWindowInfo.rooms!==1 || report.afterWindowInfo.players!==3)fail('EXACT_THREE_PUBLIC_SEATS');
    report.status='CAPTURED_ONE_30S_PUBLIC_WSS_WINDOW';
  }catch(e){windowOpen=false;report.fixedFailure=e.fixed||'FIXED_PUBLIC_METER_FAILURE';}
  finally {
    windowOpen=false;report.cleanup.beforeLeave=peers.map(owner);
    report.cleanup.normalLeave=(await Promise.allSettled(peers.map(p=>p.leaveAndClose()))).map(o=>({status:o.status,report:o.status==='fulfilled'?o.value:null}));
    for(const s of sockets)if(s.readyState<2)s.close(1000,'owned meter complete');
    const until=performance.now()+2000;while([...sockets].some(s=>s.readyState!==3)&&performance.now()<until)await pause(50);
    report.cleanup.socketStates=[...sockets].map(s=>s.readyState);report.cleanup.allOwnedSocketsClosed=[...sockets].every(s=>s.readyState===3);
    const bad=report.cleanup.beforeLeave.some(v=>!v.connected||v.errors.length||v.rejectCodes.length)||report.cleanup.normalLeave.some(o=>o.status!=='fulfilled'||o.report.errorCodes.length||o.report.rejectCodes.some(c=>c!==11));
    if(bad||!report.cleanup.allOwnedSocketsClosed){report.status='INCOMPLETE';report.fixedFailure||='OWNED_CLEANUP_INCOMPLETE';}
    try{report.cleanup.finalPublicInfo=await info();}catch{report.cleanup.finalPublicInfoUnavailable=true;}
    for(const m of meters)delete m.pendingAtEnd;
    clearTimeout(watchdog);process.off('SIGINT',abort);process.off('SIGTERM',abort);
    report.finishedUtc=new Date().toISOString();report.ownedNodeExitExpected=report.status==='CAPTURED_ONE_30S_PUBLIC_WSS_WINDOW'?0:1;
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }
  console.log(JSON.stringify({status:report.status,failure:report.fixedFailure||null,report:path.join(out,'report.json')}));
  process.exitCode=report.ownedNodeExitExpected;
}
main().catch(()=>{console.error(JSON.stringify({status:'NOT_RUN_OR_INCOMPLETE',code:'PREPARATION_OR_OUTPUT_REFUSAL'}));process.exitCode=1;});
