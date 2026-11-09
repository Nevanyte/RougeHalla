// Isolated Full-only experiment. No live protocol import/fallback, World, or policy authority.
const MAGIC = new TextEncoder().encode('RHC14EXP'), UMAX = (1n << 64n) - 1n;
const fail = field => { throw new Error(`scene experiment: ${field}`); };
export function checkedLimits(l) {
  for (const k of ['bodyBytes','partBytes','parts','frames','frameBytes','retainedBodyBytes']) if (!Number.isSafeInteger(l[k]) || l[k] <= 0) fail('limits');
  if (l.bodyBytes > 2147483647 || l.partBytes > l.bodyBytes || l.parts > 65535 || l.frames < 2 || l.frames > 65535 || l.frameBytes > 262144 || l.retainedBodyBytes < l.bodyBytes || l.retainedBodyBytes > 2147483647 || l.frameBytes < 69 || l.partBytes+32 > l.frameBytes) fail('limits');
  return Object.freeze({bodyBytes:l.bodyBytes,partBytes:l.partBytes,parts:l.parts,frames:l.frames,frameBytes:l.frameBytes,retainedBodyBytes:l.retainedBodyBytes});
}
function checkedMeta(m) {
  for (const k of ['epoch','scene','cueFrom','cueThrough']) if (typeof m[k] !== 'bigint' || m[k] < 0n || m[k] >= UMAX) fail('tuple');
  if (!m.epoch || !m.scene || m.cueThrough < m.cueFrom || !Number.isInteger(m.tick) || m.tick < 0 || m.tick > 4294967295 || !Number.isFinite(m.sourceTime) || m.sourceTime < 0) fail('tuple');
  return Object.freeze({epoch:m.epoch,scene:m.scene,tick:m.tick,sourceTime:m.sourceTime,cueFrom:m.cueFrom,cueThrough:m.cueThrough});
}
class R {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); this.p=0; }
  take(n) { if (!Number.isSafeInteger(n) || n < 0 || n > this.b.length-this.p) fail('truncated'); const b=this.b.subarray(this.p,this.p+n);this.p+=n;return b; }
  u8(){return this.take(1)[0];} u16(){const p=this.p;this.take(2);return this.v.getUint16(p,true);} u32(){const p=this.p;this.take(4);return this.v.getUint32(p,true);} u64(){const p=this.p;this.take(8);return this.v.getBigUint64(p,true);} f64(){const p=this.p;this.take(8);return this.v.getFloat64(p,true);}
  header(){const b=this.take(8);if(!b.every((v,i)=>v===MAGIC[i])||this.u8()!==1)fail('experiment');return{kind:this.u8(),epoch:this.u64(),scene:this.u64()};} end(){if(this.p!==this.b.length)fail('trailing');}
}
class W {
  constructor(n){this.b=new Uint8Array(n);this.v=new DataView(this.b.buffer);this.p=0;}
  bytes(b){this.b.set(b,this.p);this.p+=b.length;} u8(n){this.v.setUint8(this.p,n);this.p++;}u16(n){this.v.setUint16(this.p,n,true);this.p+=2;}u32(n){this.v.setUint32(this.p,n,true);this.p+=4;}u64(n){this.v.setBigUint64(this.p,n,true);this.p+=8;}f64(n){this.v.setFloat64(this.p,n,true);this.p+=8;}
  header(k,m){this.bytes(MAGIC);this.u8(1);this.u8(k);this.u64(m.epoch);this.u64(m.scene);}
}
export function createSceneCodec(decode14, protocol) {
  if(protocol!==14)fail("current14 only");
  const decode = bytes => decode14(bytes.slice().buffer); // detach from stage/pool before using the real v14 decoder.
  function validate(m,body,l) {
    const r=new R(body), n=r.u16(); if(n<2||n>l.frames)fail('frames');let count=0n;
    for(let i=0;i<n;i++){
      const len=r.u32();if(!len||len>l.frameBytes)fail('frame size');const d=decode(r.take(len));
      if(i===0&&d.t==='snapshot'&&d.tick===m.tick&&Object.is(d.serverMs,m.sourceTime)){
        const raw=new R(body); // Read the Full mask from the original record, not a re-encode.
        raw.u16();const first=raw.take(raw.u32());let at=1;for(let skip=0;skip<2;skip++){while(first[at++]&128){}}let mask=0,shift=0,byte;do{byte=first[at++];mask+=(byte&127)*2**shift;shift+=7;}while(byte&128);
        if((mask&0x80000)&&Object.is(d.serverMs,d.tick*50))fail('redundant time');
      }
      else if(i===1&&d.t==='state'&&d.tick===m.tick&&d.items.length===11&&d.items.every((x,k)=>x.key===k+1)){
        // The existing JS reader checks finite Arena clocks but its legacy decoder does
        // not check their sign. Match the current14 Rust/C# validation locally, without
        // changing production JS or treating decoder success as composite acceptance.
        const arena=d.items[8].value;
        if(arena)for(const key of ['lobbyEndsAt','planEndsAt','raidStartedAt','patienceEndsAt','suddenDeathAt'])if(arena[key]!==null&&arena[key]!==undefined&&(!Number.isFinite(arena[key])||arena[key]<0))fail('arena clock');
      }
      else if(i>=2&&d.t==='events'&&d.tick<=m.tick)count+=BigInt(d.events.length);
      else if(i>=2&&d.t==='fx'&&d.tick<=m.tick)count+=BigInt(d.fx.length);
      else fail('body role');
    }
    r.end();if(m.cueFrom+count!==m.cueThrough)fail('cue count');
  }
  function prepare(metadata,frames,limits) {
    const m=checkedMeta(metadata), l=checkedLimits(limits);if(frames.length<2||frames.length>l.frames)fail('frames');let n=2;
    for(const f of frames){if(!(f instanceof Uint8Array)||!f.length||f.length>l.frameBytes)fail('frame size');n+=4+f.length;if(n>l.bodyBytes)fail('body size');}
    const body=new W(n);body.u16(frames.length);for(const f of frames){body.u32(f.length);body.bytes(f);}validate(m,body.b,l);
    const parts=Math.ceil(n/l.partBytes);if(parts>l.parts)fail('parts');
    const record=index=>{if(!Number.isInteger(index)||index<0||index>=parts+2)fail('index');const kind=index===0?1:index===parts+1?3:2;const from=(index-1)*l.partBytes,len=kind===2?Math.min(l.partBytes,n-from):0;
      const w=new W(kind===1?69:kind===3?40:32+len);w.header(kind,m);
      if(kind===1){w.u32(m.tick);w.f64(m.sourceTime);w.u8(0);w.u64(0n);w.u64(m.cueFrom);w.u64(m.cueThrough);w.u16(parts);w.u32(n);}
      else if(kind===3){w.u16(parts);w.u32(n);w.u64(m.cueThrough);}else{w.u16(index-1);w.u32(len);w.bytes(body.b.subarray(from,from+len));}return w.b;};
    return Object.freeze({metadata:m,recordCount:parts+2,framedBytes:n+parts*32+109,record,bodyCopy:()=>body.b.slice()});
  }
  function view(m,body) {
    // Only closures retain bytes; callers receive fresh arrays/DTOs, never a mutable held Map.
    return Object.freeze({metadata:m,bodyCopy:()=>body.slice(),messages:()=>{const r=new R(body),n=r.u16(),out=[];for(let i=0;i<n;i++)out.push(decode(r.take(r.u32())));r.end();return out;}});
  }
  class Receiver {
    #epoch; #limits; #current=null; #stage=null; #closed=false; #owned=0;
    constructor(epoch,limits){if(typeof epoch!=='bigint'||epoch<=0n||epoch>=UMAX)fail('epoch');this.#epoch=epoch;this.#limits=checkedLimits(limits);}
    get current(){return this.#current;}get ownedBodyBytes(){return this.#owned;}get closed(){return this.#closed;}close(){this.#closed=true;if(this.#stage)this.#owned-=this.#stage.total;this.#stage=null;}
    push(bytes){if(this.#closed)fail('closed');try{if(!(bytes instanceof Uint8Array)||bytes.length>this.#limits.frameBytes)fail("outer size");return this.#push(bytes);}catch(e){this.close();throw e;}}
    #push(bytes){const r=new R(bytes),h=r.header(),l=this.#limits;if(h.epoch!==this.#epoch)fail('epoch');
      if(h.kind===1){if(this.#stage)fail('duplicate begin');const tick=r.u32(),sourceTime=r.f64();if(r.u8()!==0||r.u64()!==0n)fail('Full only');const cueFrom=r.u64(),cueThrough=r.u64(),parts=r.u16(),total=r.u32();r.end();const m=checkedMeta({...h,tick,sourceTime,cueFrom,cueThrough});
        const prior=this.#current?.metadata;if(h.scene!==(prior?.scene??0n)+1n||cueFrom!==(prior?.cueThrough??0n)||prior&&(tick<prior.tick||sourceTime<prior.sourceTime))fail('base');
        if(!total||total>l.bodyBytes||!parts||parts>l.parts||Math.ceil(total/l.partBytes)!==parts)fail('assembly size');if(this.#owned+total>l.retainedBodyBytes)fail("retained bodies");this.#owned+=total;this.#stage={m,parts,total,next:0,pos:0,body:new Uint8Array(total)};return false;}
      const a=this.#stage;if(!a)fail('no begin');
      if(h.kind===2){const index=r.u16(),len=r.u32();if(h.scene!==a.m.scene||index!==a.next||index>=a.parts||len!==Math.min(a.total-a.pos,l.partBytes))fail('part');const p=r.take(len);r.end();a.body.set(p,a.pos);a.pos+=len;a.next++;return false;}
      if(h.kind===3){const parts=r.u16(),total=r.u32(),cue=r.u64();r.end();if(h.scene!==a.m.scene||parts!==a.parts||total!==a.total||cue!==a.m.cueThrough||a.next!==a.parts||a.pos!==a.total)fail('commit');validate(a.m,a.body,l);this.#current=view(a.m,a.body);this.#stage=null;return true;}
      fail('unsupported kind');
    }
  }
  return Object.freeze({prepare,Receiver});
}
