
import fs from 'node:fs';
const [file, prefix, label] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file,'utf8'));
let hit=null;
const walk=(x,p)=>{ if(hit)return; if(x===null||typeof x!=='object'){ if(p.startsWith(prefix)&&(typeof x==='string'||typeof x==='number')) hit={p,v:x}; return;} if(Array.isArray(x)){x.forEach((v,i)=>walk(v,p+'/'+i));return;} for(const k of Object.keys(x))walk(x[k],p+'/'+k); };
walk(d,'');
if(!hit) throw new Error('no scalar under '+prefix);
const next=typeof hit.v==='string'?hit.v+' [negative-control]':hit.v+1;
const parts=hit.p.split('/').filter(Boolean); let at=d; for(const k of parts.slice(0,-1)) at=at[k]; at[parts[parts.length-1]]=next;
fs.writeFileSync(file, JSON.stringify(d)+'\n');
console.log(JSON.stringify({label,path:hit.p,from:hit.v,to:next}));

