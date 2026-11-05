// Local adversarial AWS responses only. No credentials or cloud access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.env.RH_REVIEW_SCRIPT_ROOT || resolve(import.meta.dirname);
const stub = `#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.STUB_LOG,JSON.stringify(a)+'\\n');
const has=x=>a.includes(x);let out={};
if(has('get-caller-identity')){console.log('961470857356');process.exit(0);}
if(has('list-stacks'))out={StackSummaries:[{StackName:'rougehalla-infra-stg10-fleet'},{StackName:'rougehalla-infra-stg1-unrelated'}]};
if(has('list-container-fleets'))out={ContainerFleetList:fs.readFileSync(process.env.STUB_LOG,'utf8').includes('delete-container-fleet')?[]:[{FleetId:'containerfleet-foreign',Description:'unrelated experiment stg10 mentions stg1'}]};
if(has('describe-container-fleet'))out={ContainerFleet:{FleetArn:'arn:aws:gamelift:us-west-2:961470857356:containerfleet/containerfleet-foreign'}};
if(has('list-tags-for-resource'))out={Tags:[{Key:'Project',Value:'rougehalla-infra'},{Key:'Experiment',Value:'stg10'}]};
if(has('list-container-group-definitions'))out={ContainerGroupDefinitions:[{Name:'rougehalla-stg1-extra'},{Name:'rougehalla-stg10-match'}]};
if(has('list-roles'))out={Roles:[{RoleName:'rougehalla-infra-budget-action'},{RoleName:'rougehalla-infra-stg10-fleet-us-west-2'}]};
if(has('list-stacks') && process.env.STUB_FAIL_LIST==='1')process.exit(91);
console.log(JSON.stringify(out));
`;
function run(args, extra={}) {
 const dir=mkdtempSync(join(tmpdir(),'rh-ownership-'));const log=join(dir,'calls');writeFileSync(log,'');writeFileSync(join(dir,'aws'),stub,{mode:0o755});
 try { const result=spawnSync('bash',[join(root,'teardown.sh'),...args],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:`${dir}:${process.env.PATH}`,AWS_PROFILE:'rh-stub',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',AWS_SESSION_TOKEN:'',STUB_LOG:log,...extra}});return {result,calls:readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}; }
 finally {rmSync(dir,{recursive:true,force:true});}
}
test('teardown stg1 never mutates prefix neighbors, foreign fleet tags or shared budget role',()=>{
 const {result,calls}=run(['--experiment','stg1','--regions','us-west-2','--yes']);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(calls.filter(a=>a.some(v=>/^(delete|update|stop|detach)-/.test(v))),[]);
});
test('failed inventory aborts instead of pretending teardown succeeded',()=>{
 const {result,calls}=run(['--experiment','stg1','--regions','us-west-2','--yes'],{STUB_FAIL_LIST:'1'});assert.notEqual(result.status,0);assert.equal(calls.length,2);
});
