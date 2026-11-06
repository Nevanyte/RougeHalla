/** Closed CLI admission checks; no mechanics assertions or output construction. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires canonical Linux amd64 Node22.23.4');
const temp=mkdtempSync(join(tmpdir(),'rh-status-argv-'));const file=join(temp,'untouched.json');writeFileSync(file,'sentinel\n');
try{
 const cases:[string,string[]][]=[['unknown',['--wat']],['unknown-slice',['--slice=banana']],['duplicate-check',['--check','--check']],['duplicate-slice',['--slice=runtime','--slice=runtime']],['duplicate-output',[`--output=${file}`,`--output=${file}`]],['empty-output',['--output=']],['missing-output',['--output']],['missing-slice',['--slice']],['positional',['helpers']],['empty-argument',['']]];
 const result=cases.map(([name,args])=>{const r=spawnSync(process.execPath,['--import','tsx','tools/status-fixtures/capture.ts',...args],{encoding:'utf8'});assert.equal(r.status,1,name);assert.match(r.stderr,/invalid capture arguments:/,name+' preflight failure only');assert.equal(readFileSync(file,'utf8'),'sentinel\n',name+' no write');return{name,exit:r.status,preflightRejected:true,outputUntouched:true};});
 console.log(JSON.stringify({format:'rh-status-argv-controls/1',cases:result}));
}finally{rmSync(temp,{recursive:true,force:true});}
