// Narrow evaluator for these Allow-only policies. This is not an AWS policy simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root=process.env.RH_REVIEW_REPO || resolve(import.meta.dirname,'../../../..');
const policy=JSON.parse(readFileSync(join(root,'hosting/infra/fleet/iam/deployer-policy.json')));
const array=x=>Array.isArray(x)?x:[x];
const wildcard=(p,x)=>new RegExp('^'+p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replaceAll('?','.')+'$').test(x);
function allows(action,resource,context={}) {
 return policy.Statement.some(s=>s.Effect==='Allow' && array(s.Action).some(a=>wildcard(a,action)) && array(s.Resource).some(r=>wildcard(r,resource)) && Object.entries(s.Condition||{}).every(([op,kv])=>{
  assert.ok(['ArnEquals','StringEquals'].includes(op),`unsupported condition: ${op}`);
  return Object.entries(kv).every(([key,vs])=>array(vs).includes(context[key]));
 }));
}
const role='arn:aws:iam::961470857356:role/rougehalla-infra-stg1-fleet-us-west-2';
test('role creation needs no nonexistent PolicyARN; attach and pass remain restricted',()=>{
 assert.equal(allows('iam:CreateRole',role),true);
 assert.equal(allows('iam:CreateRole',role.replace('961470857356','111111111111')),false);
 assert.equal(allows('iam:AttachRolePolicy',role,{'iam:PolicyARN':'arn:aws:iam::aws:policy/GameLiftContainerFleetPolicy'}),true);
 assert.equal(allows('iam:AttachRolePolicy',role,{'iam:PolicyARN':'arn:aws:iam::aws:policy/AdministratorAccess'}),false);
 assert.equal(allows('iam:PassRole',role,{'iam:PassedToService':'gamelift.amazonaws.com'}),true);
 assert.equal(allows('iam:PassRole',role,{'iam:PassedToService':'ec2.amazonaws.com'}),false);
});
test('GameLift writes require the project tag and staging region; inventory supports wildcard',()=>{
 const fleet='arn:aws:gamelift:us-west-2:961470857356:containerfleet/containerfleet-abc';
 assert.equal(allows('gamelift:DeleteContainerFleet',fleet,{'aws:RequestedRegion':'us-west-2'}),false);
 assert.equal(allows('gamelift:DeleteContainerFleet',fleet,{'aws:RequestedRegion':'us-west-2','aws:ResourceTag/Project':'rougehalla-infra'}),true);
 assert.equal(allows('gamelift:DeleteContainerFleet',fleet,{'aws:RequestedRegion':'eu-west-1','aws:ResourceTag/Project':'rougehalla-infra'}),false);
 assert.equal(allows('cloudformation:ListStacks','*'),true);
});
test('log group is inside the AWS GameLiftContainerFleetPolicy gamelift-* grant',()=>{
 const yaml=readFileSync(join(root,'hosting/infra/fleet/fleet.cfn.yaml'),'utf8');
 const name=yaml.match(/LogGroupName: !Sub '([^']+)'/)[1].replace('${Experiment}','stg1');
 // https://docs.aws.amazon.com/aws-managed-policy/latest/reference/GameLiftContainerFleetPolicy.html
 assert.equal(wildcard('gamelift-*',name),true);
 assert.equal(allows('logs:CreateLogGroup',`arn:aws:logs:us-west-2:961470857356:log-group:${name}`,{'aws:RequestedRegion':'us-west-2'}),true);
});
test('manual workflow enforces sandbox identity before either CloudFormation path',()=>{
 const yaml=readFileSync(join(root,'.github/workflows/hosting-fleet-deploy.yml'),'utf8');
 assert.match(yaml,/aws-actions\/configure-aws-credentials@v4/);
 assert.doesNotMatch(yaml,/allowed-account-ids:/); // v4 does not support this input; the explicit STS guard is mandatory.
 const block=yaml.match(/- name: Verify sandbox account[^\n]*\n\s+run: \|\n([\s\S]*?)(?=      - name:)/)?.[1];assert.ok(block,'missing runtime account guard');
 assert.ok(yaml.indexOf('Verify sandbox account')<yaml.indexOf('aws cloudformation deploy'));
 const dir=mkdtempSync(join(tmpdir(),'rh-workflow-'));
 try {
  writeFileSync(join(dir,'aws'),'#!/bin/sh\nprintf "%s\\n" "$STUB_ACCOUNT"\n',{mode:0o755});
  for(const [account,expected] of [['961470857356',0],['111111111111',1]]){
   const r=spawnSync('bash',['-e','-c',block],{env:{...process.env,PATH:`${dir}:${process.env.PATH}`,STUB_ACCOUNT:account},encoding:'utf8'});assert.equal(r.status,expected,r.stderr);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
