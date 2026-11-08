
import fs from 'node:fs'; import crypto from 'node:crypto';
const [kind, oldPath, newPath, outPath] = process.argv.slice(2);
const a=JSON.parse(fs.readFileSync(oldPath,'utf8')), b=JSON.parse(fs.readFileSync(newPath,'utf8'));
const diffs=[]; function walk(x,y,p){ if(x===y)return; const tx=typeof x,ty=typeof y; if(x===null||y===null||tx!==ty||tx!=='object'){diffs.push({path:p,old:x,new:y});return;} if(Array.isArray(x)||Array.isArray(y)){ if(!Array.isArray(x)||!Array.isArray(y)){diffs.push({path:p,old:x,new:y});return;} if(x.length!==y.length)diffs.push({path:p+'/#len',old:x.length,new:y.length}); const n=Math.min(x.length,y.length); for(let i=0;i<n;i++)walk(x[i],y[i],p+'/'+i); for(let i=n;i<x.length;i++)diffs.push({path:p+'/'+i,old:x[i],new:'<missing>'}); for(let i=n;i<y.length;i++)diffs.push({path:p+'/'+i,old:'<missing>',new:y[i]}); return;} for(const k of new Set([...Object.keys(x),...Object.keys(y)])){ if(!(k in x)||!(k in y)){diffs.push({path:p+'/'+k,old:x[k],new:y[k]});} else walk(x[k],y[k],p+'/'+k);} } walk(a,b,'');
const input = kind.includes('input');
const allowed = (d) => {
  const p=d.path;
  const overlay = input ? /^\/acceptedProvenanceOverlay(\/|$)/.test(p) : /^\/provenance\/acceptedProvenanceOverlay(\/|$)/.test(p);
  const harness = input ? /^\/harnessInputs\/(\d+)\/sha256$/.exec(p) : /^\/provenance\/harnessInputs\/(\d+)\/sha256$/.exec(p);
  const pin = /^(\/provenance)?\/actualPinnedInputs\/(\d+)\/(sha256|bytes|acceptedProvenanceOverlayApplied|acceptedProvenanceOverlay(\/.*)?)$/.exec(p);
  const pinIdx = pin ? Number(pin[2]) : -1;
  return overlay || (harness && [1].includes(Number(harness[1]))) || (pin && [1,3,6].includes(pinIdx));
};
const allowedD=diffs.filter(allowed), forbidden=diffs.filter(d=>!allowed(d));
const semFields=kind.includes('input')?[]:['format','roles','controlCorrection','cleanControls','witnessDefinition','cases','comparison','privateOracleRecords'];
const sha=(o)=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const semOld=sha(Object.fromEntries(semFields.map(k=>[k,a[k]]))), semNew=sha(Object.fromEntries(semFields.map(k=>[k,b[k]])));
fs.writeFileSync(outPath, JSON.stringify({kind,diffs,allowedPaths:allowedD.map(d=>d.path),forbiddenPaths:forbidden.map(d=>d.path),semanticDigestOld:semOld,semanticDigestNew:semNew,semanticEqual:semOld===semNew},null,2)+'\n');
console.log(JSON.stringify({kind,diffCount:diffs.length,allowed:allowedD.length,forbidden:forbidden.length,semanticEqual:semOld===semNew,counts:{cases:a.cases?.length,privateRecords:a.privateOracleRecords?Object.keys(a.privateOracleRecords).length:undefined}}));
if(forbidden.length){console.log(JSON.stringify(forbidden.slice(0,10),null,2));process.exit(2);}
console.log(allowedD.map(d=>d.path).join('\n'));

