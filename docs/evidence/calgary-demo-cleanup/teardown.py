import subprocess,pathlib,json,datetime,sys,re,os
os.umask(0o077)
OUT=pathlib.Path(__file__).parent
M=json.loads(pathlib.Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/calgary-demo-cleanup-plan-01/cleanup-manifest.json').read_text())
BASE=['/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/aws-cli/aws','--profile','rougehalla-staging','--region','ca-west-1','--no-cli-pager']
R={'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'INCOMPLETE','actions':[]}
def call(args):
 r=subprocess.run(BASE+args+['--output','json'],capture_output=True,text=True,timeout=40)
 row={'args':args,'exit':r.returncode}
 if r.returncode:
  match=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  row['errorCode']=match.group(1) if match else 'CLI_READ_OR_ACTION_REFUSED'
 else:row['result']=json.loads(r.stdout or '{}')
 R['actions'].append(row)
 (OUT/'TEARDOWN.json').write_text(json.dumps(R,indent=2)+'\n')
 if r.returncode:raise RuntimeError(row['errorCode'])
 return row['result']
try:
 assert sys.argv[1:]==['--execute-approved'],'EXACT_ROOT_EXECUTION_REQUIRED'
 assert datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime(2026,11,10,3,50,21,tzinfo=datetime.timezone.utc),'NOT_BEFORE_ORIGINAL_EXPIRY'
 assert call(['sts','get-caller-identity','--query','Account'])==M['account'],'ACCOUNT_MISMATCH'
 state=call(['ec2','describe-instances','--instance-ids',M['instance'],'--query','Reservations[].Instances[].State.Name'])
 assert state==['terminated'],'TERMINATION_NOT_CONFIRMED'
 resources=call(['cloudformation','describe-stack-resources','--stack-name',M['stack']])['StackResources']
 assert {(x['LogicalResourceId'],x['PhysicalResourceId'],x['ResourceType']) for x in resources}=={(x['Logical'],x['Physical'],x['Type']) for x in M['resources']},'OWNED_RESOURCE_SET_CHANGED'
 assert not call(['s3api','get-bucket-versioning','--bucket',M['bucket']]).get('Status'),'VERSIONING_CHANGED'
 objects=call(['s3api','list-objects-v2','--bucket',M['bucket'],'--max-keys','1000'])
 assert objects.get('KeyCount')==1 and not objects.get('IsTruncated'),'OBJECT_SET_CHANGED'
 assert [(x['Key'],x['Size']) for x in objects['Contents']]==[(x['Key'],x['Bytes']) for x in M['object_delete_manifest']],'OBJECT_MANIFEST_CHANGED'
 assert not call(['s3api','list-multipart-uploads','--bucket',M['bucket']]).get('Uploads'),'UPLOAD_IN_PROGRESS'
 call(['s3api','delete-object','--bucket',M['bucket'],'--key','technical-demo/reviewed-demo.tar'])
 empty=call(['s3api','list-objects-v2','--bucket',M['bucket'],'--max-keys','1000'])
 assert empty.get('KeyCount')==0 and not empty.get('IsTruncated'),'BUCKET_NOT_EMPTY'
 call(['cloudformation','delete-stack','--stack-name',M['stack']])
 R['status']='EXACT_STACK_DELETE_REQUESTED_NOT_YET_COMPLETE'
except Exception as e:
 R['failure']=str(e) if isinstance(e,(AssertionError,RuntimeError)) else 'FIXED_TEARDOWN_FAILURE'
finally:
 R['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (OUT/'TEARDOWN.json').write_text(json.dumps(R,indent=2)+'\n')
 print(json.dumps({k:R[k] for k in ['status','finishedUtc','failure'] if k in R}))
if R['status']!='EXACT_STACK_DELETE_REQUESTED_NOT_YET_COMPLETE':sys.exit(1)
