from pathlib import Path
import json,hashlib,subprocess
r=Path(__file__).resolve().parent;repo=Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art')
d=json.loads((r/'discovered-cases.json').read_text());c=json.loads((r/'EXPECTED_SELECTORS.json').read_text());actual={x['fullName']:x for x in d['cases']};want=[x for f in c['fixtures'].values() for x in f['cases']]
assert d['executedTests'] is False and len(actual)==len(want)==64
assert set(actual)=={x['fullName'] for x in want}
for x in want:
 a=actual[x['fullName']];assert a['declaringType']==x['fixtureType'] and a['methodName']==x['method'] and a['runState']=='Runnable',x
 assert [p['declaredType'] for p in a['methodParameters']]==[p['declaredType'] for p in x['methodParameters']],x
 assert len(a['arguments'])==len(x['selectedArguments'])
 for v,w in zip(a['arguments'],x['selectedArguments']):
  assert v['typeFullName']==w['declaredType'],(v,w)
  expected=w['value']
  if v['typeFullName']=='System.Boolean':assert v['boolValue'] is expected
  elif 'enumName' in v:assert v['enumName']==expected['name'] and v['numericValue']==expected['numericValue']
  elif v['typeFullName'] in ['System.Int32','System.Int64']:assert v['numericValue']==int(expected) and v['text']==str(expected)
  else:raise AssertionError(('unsupported argument',v,w))
identity=json.loads((r/'evidence/loaded-identity.json').read_text())['result'];assert {x['methodModuleMvid'] for x in actual.values()}=={x['mvid'] for x in identity['results']}
files=json.loads((r/'SOURCE_IDENTITY.json').read_text())['files'];over=[]
for x in files:
 b=(repo/x['path']).read_bytes()
 if hashlib.sha256(b).hexdigest()!=x['sha256']:over.append(x['path'])
assert over==['client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset'],over
(r/'evidence'/'ShaderGraphSettings.observed.asset.txt').write_bytes((repo/over[0]).read_bytes());(r/'evidence'/'source-overlay.patch').write_bytes(subprocess.check_output(['git','diff','--',over[0]],cwd=repo))
(r/'evidence'/'discovery-binding-verification.json').write_text(json.dumps({'source':'5457b9c03149333ed3b2bcebdfb10b224364fc25','status':'PASS_BEFORE_EXECUTION','cases':64,'fullNamesExact':True,'actualTypedArgumentsExact':True,'actualInt64SuffixConfirmed':True,'fixtureCounts':{k:len(v['cases']) for k,v in c['fixtures'].items()},'loadedIdentity':identity,'sourcePins':1162,'onlySourceOverlay':over,'executedTests':False},indent=2))
print('PASS exact64 fullNames/signatures/typedargs, only retained ShaderGraph whitespace overlay')
