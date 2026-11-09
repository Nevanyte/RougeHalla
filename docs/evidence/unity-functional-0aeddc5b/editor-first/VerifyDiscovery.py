import hashlib, json, pathlib, re, subprocess
r=pathlib.Path(__file__).resolve().parent
repo=pathlib.Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art')
source=json.loads((r/'EXPECTED_SOURCE_IDENTITY.json').read_text())
contract=json.loads((r/'EXPECTED_SELECTORS.frozen.json').read_text())
identity=json.loads((r/'evidence/imported-loaded-identity.json').read_text())['result']
discovery=json.loads((r/'discovered-cases.json').read_text())
assert json.loads((r/'evidence/discovery-only-run.json').read_text())['success']
assert discovery['executedTests'] is False
enum_file='client-unity/UnityProject/Assets/Scripts/Net/MatchLaunchConfig.cs'
enum_text=(repo/enum_file).read_text()
enum_namespace=re.search(r'namespace\s+([\w.]+)',enum_text).group(1)
assert re.search(r'enum\s+MatchLaunchMode\s*\{\s*Arena\s*,\s*Training\s*\}',enum_text)
enum_type=enum_namespace+'.MatchLaunchMode'
for f,actual in zip(source['fixtures'],identity['results']):
    for k in ('source','meta'):
        assert hashlib.sha256((repo/f[k]['path']).read_bytes()).hexdigest()==f[k]['sha256']
    assert actual['loadedType']==f['typeFullName'] and actual['guid']==f['meta']['guid']
    assert set(actual['methods'])=={m['method'] for m in f['methods']}
    if f['fixture']!='MatchLaunchEditModeTests':
        prior=subprocess.check_output(['git','show','fa0c0891f78e2fd4a65fb08d71d226d8a426e724:'+f['source']['path']],cwd=repo)
        assert hashlib.sha256(prior).hexdigest()==f['source']['sha256']
cases=discovery['cases']
assert len(cases)==42 and len({c['fullName'] for c in cases})==42
old=[c for c in cases if c['declaringType']!='MatchLaunchEditModeTests']
new=[c for c in cases if c['declaringType']=='MatchLaunchEditModeTests']
assert {c['fullName'] for c in old}==set(contract['unchanged25FullNames'])
assert len(new)==17 and len({c['methodName'] for c in new})==14
bindings=[]
for expected in contract['new17SourceCases']:
    raw=expected['argumentsSource']; want=[] if raw is None else [x.strip() for x in raw.split(',')]
    def matches(c):
        if c['methodName']!=expected['method'] or len(c['arguments'])!=len(want): return False
        for actual,value in zip(c['arguments'],want):
            if value in ('true','false'):
                if actual.get('typeFullName')!='System.Boolean' or actual.get('boolValue')!=(value=='true'): return False
            elif value.startswith('MatchLaunchMode.'):
                name=value.split('.')[-1]
                if actual.get('typeFullName')!=enum_type or actual.get('enumName')!=name or actual.get('numericValue')!={'Arena':0,'Training':1}[name]: return False
            else: raise AssertionError('Unsupported frozen source tuple: '+value)
        return True
    found=[c for c in new if matches(c)]
    assert len(found)==1,(expected,found)
    bindings.append({'sourceMethod':expected['method'],'sourceArguments':raw,'actualFullName':found[0]['fullName'],'actualArguments':found[0]['arguments'],'methodModuleMvid':found[0]['methodModuleMvid']})
assert len({b['actualFullName'] for b in bindings})==17
mvids={c['methodModuleMvid'] for c in cases}
assert len(mvids)==1 and mvids=={x['mvid'] for x in identity['results']}
assert next(iter(mvids)) not in {'5060c178-6253-4a15-a153-f5615131d3c5','cad30248-17a5-410a-8d1b-d6b883f2b74d'}
assert all(c['runState']=='Runnable' for c in cases)
groups=[]
for f in source['fixtures']:
    names=sorted(c['fullName'] for c in cases if c['declaringType']==f['typeFullName'])
    assert len(names)==f['expectedCases']
    assert set(discovery['classFilterMatches'][f['fixture']])==set(names)
    groups.append({'fixture':f['fixture'],'typeFullName':f['typeFullName'],'expectedCases':f['expectedCases'],'actualFullNames':names,'cliClassFilterClosureExact':True})
production=json.loads((r/'evidence/loaded-production-identity-and-il.json').read_text())['result']
assert production['singleClientAssembly'] and production['moduleMvid']=='17da474b-9a95-4b98-8af9-13124aff40e9'
result={'productionIdentity':production,'unchangedTestAssemblyMvidRetained':True,'coordinatorAllowsRetainedTestMvid':True,'status':'PASS_BEFORE_TEST_EXECUTION','source':source['gateSourceCommit'],'expectedCases':42,'old25SourceBodiesMatchFa0':True,'actualNUnitCases':42,'mvid':next(iter(mvids)),'enumTypeBoundFromFrozenSource':enum_type,'enumSourceSha256':hashlib.sha256((repo/enum_file).read_bytes()).hexdigest(),'new17Bindings':bindings,'groups':groups,'methodArgumentsAndFullNamesBound':True,'noMissingExtraSubstitute':True,'testExecutionStarted':False}
(r/'evidence/discovery-binding-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS: exact42 discovery names/arguments, imported source/GUIDs, MVID and four filter closures; no tests executed.')
