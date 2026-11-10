import json,hashlib,subprocess,datetime,sys,os,signal
from pathlib import Path
R=Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings')
C=Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports')
CODE='02d77c341548846bd719608b665f7cbddd652f42'
P=R/'docs/evidence/bot-protection-cues/offline-root-reviewed-01/prepared'
def sha(b): return hashlib.sha256(b).hexdigest()
def write(p,v):
 with p.open('x') as f: json.dump(v,f,indent=2);f.write('\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
plan=R/'docs/evidence/bot-protection-cues-variants/PROPOSED-ENVELOPES.json'
assert sha(plan.read_bytes())=='98b26323d8d3b09517683aa4bf1a42ac76236bb9f42d5a627eac9da2f2259082'
action,control=sys.argv[1:];op=next(x for x in json.loads(plan.read_text())['operations'] if x['controlId']==control)
prepared=Path(op['freshRunRoot'])/'prepared'
if action=='build':
 d=C/f'protection-cue-variant-{control}-phaseA';d.mkdir(mode=0o700)
 a=op['phaseA'];argv=[x.replace('<ROOT_FROZEN_VARIANT_DRIVER_SHA40>',CODE) for x in a['argv']]
 release={'format':'rh-root-protection-cue-variant-A/1','issuedUtc':now(),'authority':'ONE compiler-only build of the named control. No Source/World/capture, automatic next operation, source or oracle change.','controlId':control,'code':CODE,'argv':argv,'env':a['env'],'cwd':str(R),'timeoutSeconds':120}
 write(d/'ROOT_RELEASE.json',release);v={'startedUtc':now(),'kind':'compiler-only-no-Source'}
 with (d/'stdout.log').open('xb') as o,(d/'stderr.log').open('xb') as e:
  try:v['exit']=subprocess.run(argv,cwd=R,env=a['env'],stdout=o,stderr=e,timeout=120).returncode
  except Exception as ex:v['error']=str(ex)
 v['finishedUtc']=now();write(d/'RESULT.json',v);print(v)
 if v.get('exit',1):print((d/'stderr.log').read_text()[-1800:]);sys.exit(1)
elif action=='review':
 d=C/f'protection-cue-variant-{control}-phaseA';m=json.loads((prepared/'build-manifest.json').read_text());b=json.loads((P/'build-manifest.json').read_text())
 assert sha((P/'build-manifest.json').read_bytes())=='53a54a282bd09da615088bf352ddbd0ef65514bdc72e806f69b1ba74c9c47e16'
 assert m['code']==CODE and m['sourceBase']=='bb564d3b53728cbd205af375b5342eca466f3656'
 assert len(m['loadedInputs'])==len(b['loadedInputs'])==133
 assert set(x.name for x in prepared.iterdir())==set(m['preparedInventory'])=={'build-manifest.json','metafile.json','scenario.mjs','variants-runtime.mjs','verify.mjs'}
 for k in ['configuration','selectedSource','related','resolutionMetadataChecked','limits','externals']:
  assert m[k]==b[k],k
 v=m['variant'];c=v['control'];assert c['id']==control and c['firstFailureCase']==op['firstFailureCase'] and c['expectedMatches']==1
 controls=(R/'tools/bot-protection-cues-fixtures/controls.mjs').read_bytes();assert sha(controls)==v['controlsSha256']=='a27967aef45638c64d2873063d66669f5724abf869d51e328c511a15b4ef837c'
 # Literal source anchors must also occur in the immutable declarative definition, not only the generated manifest.
 for k in ['id','kind','file','find','replace']:
  assert f'{k}: '+json.dumps(c[k],ensure_ascii=False) in controls.decode(),k
 original=(R/c['file']).read_bytes();assert original.decode().count(c['find'])==1
 executed=original.decode().replace(c['find'],c['replace']).encode()
 assert v['original']=={'path':c['file'],'bytes':len(original),'sha256':sha(original)}
 assert v['executed']=={'bytes':len(executed),'sha256':sha(executed)}
 changed=[]
 for got,old in zip(m['loadedInputs'],b['loadedInputs']):
  assert {k:got[k] for k in ['path','bytes','sha256']}=={k:old[k] for k in ['path','bytes','sha256']}
  expected=executed if got['path']==c['file'] else None
  assert got['executedBytes']==(len(expected) if expected is not None else old['bytes'])
  assert got['executedSha256']==(sha(expected) if expected is not None else old['sha256'])
  if got['instrumentation'] is not None:changed.append(got['path']);assert got['instrumentation']==v['instrumentation']
 assert changed==[c['file']]
 for row in m['outputs'].values():
  raw=(prepared/row['path']).read_bytes();assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
 assert (prepared/'verify.mjs').read_bytes()==(P/'verify.mjs').read_bytes()
 assert sha((prepared/'variants-runtime.mjs').read_bytes())=='e98352bfb7fa39b62e1ddbc3725179c5d890f634e55bab960f6811765a3bbde7'
 basebundle=(P/'scenario.mjs').read_text();actualbundle=(prepared/'scenario.mjs').read_text()
 if control=='comment-provenance': assert actualbundle==basebundle
 elif control=='different-target-cancel':
  compiled_find='if (w.action?.target !== t2.id) cancelLockedWindup(world, c);'
  compiled_replace='if (w.action?.target !== t2.id) {\n  }'
  assert basebundle.count(compiled_find)==1 and actualbundle==basebundle.replace(compiled_find,compiled_replace)
 else: assert basebundle.count(c['find'])==1 and actualbundle==basebundle.replace(c['find'],c['replace'])
 meta=json.loads((prepared/'metafile.json').read_text());oldmeta=json.loads((P/'metafile.json').read_text());assert set(meta['inputs'])==set(oldmeta['inputs'])
 for name,row in meta['inputs'].items():
  prior=oldmeta['inputs'][name];assert {k:x for k,x in row.items() if k!='bytes'}=={k:x for k,x in prior.items() if k!='bytes'}
  mapped=name.removeprefix('pinned-source:')
  assert row['bytes']==(len(executed) if mapped==c['file'] else prior['bytes'])
 report={'format':'rh-root-variant-generated-review/1','reviewedUtc':now(),'status':'PASS','controlId':control,'code':CODE,'manifestSha256':sha((prepared/'build-manifest.json').read_bytes()),'bundleSha256':m['outputs']['scenario']['sha256'],'runtimeSha256':m['outputs']['runtime']['sha256'],'verifySha256':m['outputs']['verify']['sha256'],'originalClosure':133,'changedExecutedSource':changed,'wholeBundle':'exact single declared literal replacement, or identical comment nonkill','sourceExecuted':False,'phaseB':'NOT_RELEASED'}
 write(d/'ROOT_GENERATED_REVIEW.json',report);print(report)
else:raise ValueError('Only one build or one readonly review; runtime needs a separate literal Root release')
