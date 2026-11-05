// Replays public protocol payloads at their original 20 Hz; never a gameplay server.
// RH_TRACE_PATH=<jsonl> RH_TRACE_PORT=7790 [RH_TRACE_FREEZE_TICK=N]
const fs=require('node:fs');const {WebSocketServer}=require(process.env.RH_WS_MODULE||'ws');
const records=fs.readFileSync(process.env.RH_TRACE_PATH,'utf8').trim().split('\n').map(JSON.parse);
const header=records.shift();if(header.format!=='rougehalla-wire-trace')throw Error('Unknown trace format');
const groups=new Map();for(const f of records){if(f.record!=='frame')continue;if(!groups.has(f.tick))groups.set(f.tick,[]);groups.get(f.tick).push(Buffer.from(f.bytesHex,'hex'))}
const ticks=[...groups.keys()].sort((a,b)=>a-b);const freeze=Number(process.env.RH_TRACE_FREEZE_TICK??Infinity);
const server=new WebSocketServer({host:'127.0.0.1',port:Number(process.env.RH_TRACE_PORT||7790)});
server.on('connection',ws=>{let timer=null,started=false;ws.on('message',()=>{if(started)return;started=true;ws.send(Buffer.from(header.welcomeHex,'hex'));let at=0;timer=setInterval(()=>{if(at>=ticks.length){clearInterval(timer);return}const tick=ticks[at++];for(const bytes of groups.get(tick))ws.send(bytes);if(tick>=freeze)clearInterval(timer)},1000/header.tickRate)});ws.on('close',()=>clearInterval(timer))});
console.log(JSON.stringify({ready:true,format:header.format,ticks:ticks.length,tickRate:header.tickRate,syntheticFighters:header.syntheticFighters??null,interactive:false}));
