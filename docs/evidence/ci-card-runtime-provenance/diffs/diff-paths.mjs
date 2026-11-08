
import fs from 'node:fs'; import crypto from 'node:crypto';
const [oldPath, freshPath, kind, outPrefix] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(oldPath,'utf8')); const b = JSON.parse(fs.readFileSync(freshPath,'utf8'));
const diffs=[]; function walk(x,y,path){ if(x===y)return; const tx=typeof x,ty=typeof y; if(x===null||y===null||tx!==ty||tx!=='object'){diffs.push({path,old:x,new:y});return;} if(Array.isArray(x)||Array.isArray(y)){ if(!Array.isArray(x)||!Array.isArray(y)){diffs.push({path,old:x,new:y});return;} if(x.length!==y.length)diffs.push({path:path+'/#len',old:x.length,new:y.length}); const n=Math.min(x.length,y.length); for(let i=0;i<n;i++)walk(x[i],y[i],path+'/'+i); for(let i=n;i<x.length;i++)diffs.push({path:path+'/'+i,old:x[i],new:'<missing>'}); for(let i=n;i<y.length;i++)diffs.push({path:path+'/'+i,old:'<missing>',new:y[i]}); return;} const kx=Object.keys(x),ky=Object.keys(y); for(const k of kx)if(!(k in y))diffs.push({path:path+'/'+k,old:x[k],new:'<missing>'}); for(const k of ky)if(!(k in x))diffs.push({path:path+'/'+k,old:'<missing>',new:y[k]}); for(const k of kx)if(k in y)walk(x[k],y[k],path+'/'+k);} walk(a,b,'');
const sha=(o)=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const semFields = kind==='witness' ? ['format','roles','controlCorrection','cleanControls','witnessDefinition','cases','comparison','privateOracleRecords'] : ['format','roles','profiles','noninterference','cases','privateOracleRecords'];
const semOld = sha(Object.fromEntries(semFields.map(k=>[k,a[k]]))), semNew = sha(Object.fromEntries(semFields.map(k=>[k,b[k]])));
const out = {kind, diffCount:diffs.length, diffs, semanticFields:semFields, semanticDigestOld:semOld, semanticDigestNew:semNew, semanticEqual:semOld===semNew, counts:{cases:a.cases?.length, privateRecords:a.privateOracleRecords?Object.keys(a.privateOracleRecords).length:undefined}};
fs.writeFileSync(outPrefix+'.json', JSON.stringify(out,null,2));
console.log(JSON.stringify({kind,diffCount:diffs.length,semanticEqual:semOld===semNew,counts:out.counts,semanticDigestOld:semOld,semanticDigestNew:semNew}));
for (const d of diffs) console.log(d.path, '|', JSON.stringify(d.old)?.slice(0,90), '=>', JSON.stringify(d.new)?.slice(0,90));

