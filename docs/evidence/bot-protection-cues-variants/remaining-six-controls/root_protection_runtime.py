import json,hashlib,subprocess,datetime,os,signal,sys
from pathlib import Path
R=Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings');C=Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports');CODE='02d77c341548846bd719608b665f7cbddd652f42'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n')
control=sys.argv[1];p=R/'docs/evidence/bot-protection-cues-variants/PROPOSED-ENVELOPES.json';assert sha(p.read_bytes())=='98b26323d8d3b09517683aa4bf1a42ac76236bb9f42d5a627eac9da2f2259082'
op=next(x for x in json.loads(p.read_text())['operations'] if x['controlId']==control);review=C/f'protection-cue-variant-{control}-phaseA/ROOT_GENERATED_REVIEW.json';v=json.loads(review.read_text());assert v['status']=='PASS' and v['code']==CODE and v['controlId']==control
prepared=Path(op['freshRunRoot'])/'prepared';assert sha((prepared/'build-manifest.json').read_bytes())==v['manifestSha256']
d=C/f'protection-cue-variant-{control}-phaseB';d.mkdir(mode=0o700);(d/'empty-docker-config').mkdir(mode=0o700)
pins={'<ROOT_FROZEN_VARIANT_DRIVER_SHA40>':CODE,'<INDEPENDENT_ROOT_VARIANT_MANIFEST_SHA256>':v['manifestSha256'],'<INDEPENDENT_ROOT_VARIANT_BUNDLE_SHA256>':v['bundleSha256'],'<INDEPENDENT_ROOT_VARIANT_RUNTIME_SHA256>':v['runtimeSha256']}
argv=[pins.get(x,x) for x in op['phaseB']['argv']];assert not any('<' in x or '>' in x for x in argv);assert argv[1]=='run';name=argv[argv.index('--name')+1]
prefix=['/Applications/Docker.app/Contents/Resources/bin/docker','--config',str(d/'empty-docker-config'),'--host','unix:///Users/nevinmckinnon/.docker/run/docker.sock'];argv=prefix+['run','--label',f'rh.protection-cue-variant.owner={name}','--cidfile',str(d/'container.cid'),*argv[2:]];env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
release={'format':'rh-root-protection-cue-variant-B/1','issuedUtc':now(),'authority':'ONE actual named control only, after complete Root generated review. No next operation, retries, output normalization or oracle/source edits. Envelope/compiler/provenance/timeout errors never count as semantic kills.','controlId':control,'code':CODE,'argv':argv,'env':env,'timeoutSeconds':180,'reviewSha256':sha(review.read_bytes()),'expected':op['acceptedOutcome']};write(d/'ROOT_RELEASE.json',release)
r={'startedUtc':now(),'kind':'ONE actual '+control,'status':'ERROR'};child=None
try:
 with (d/'stdout.log').open('xb') as o,(d/'stderr.log').open('xb') as e:
  child=subprocess.Popen(argv,env=env,stdout=o,stderr=e,start_new_session=True);r['exit']=child.wait(timeout=180);r['status']='PROCESS_COMPLETED'
except Exception as ex:r['error']=type(ex).__name__+': '+str(ex)
finally:
 q=subprocess.run(prefix+['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}'],env=env,capture_output=True,text=True,timeout=10)
 if q.returncode==0 and not q.stdout.strip():r['containerCleanup']='verified-not-present'
 elif q.returncode==0 and q.stdout.strip()==name:
  owner=subprocess.run(prefix+['inspect','--format','{{ index .Config.Labels "rh.protection-cue-variant.owner" }}',name],env=env,capture_output=True,text=True,timeout=10)
  if owner.returncode==0 and owner.stdout.strip()==name:
   subprocess.run(prefix+['stop','--time','5',name],env=env,capture_output=True,timeout=15);subprocess.run(prefix+['rm','--force',name],env=env,capture_output=True,timeout=15)
   check=subprocess.run(prefix+['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}'],env=env,capture_output=True,text=True,timeout=10);r['containerCleanup']='owned-container-removed' if check.returncode==0 and not check.stdout.strip() else 'UNVERIFIED'
  else:r['containerCleanup']='REFUSED unknown owner'
 else:r['containerCleanup']='UNVERIFIED'
 if child and child.poll() is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
 r['finishedUtc']=now();write(d/'RESULT.json',r)
print(r)
for n in ['stdout.log','stderr.log']:print(n,(d/n).read_text(errors='replace')[-1800:])
assert r.get('exit')==0 and r['containerCleanup'] in ['verified-not-present','owned-container-removed']
classification=json.loads((Path(op['freshRunRoot'])/'captured/classification.json').read_text());assert classification['status']==op['acceptedOutcome']['classification'];print('CLASSIFIED',classification['status'],control)
