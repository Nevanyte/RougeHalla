from pathlib import Path
import json,hashlib,traceback
r=Path(__file__).resolve().parent;repo=Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art');out=r/'evidence/native-identity-verification.json';assert not out.exists()
report={'source':'cdb0bc4b8bd623939a464f6ce7780bde69198e85','status':'STOP','nativeTestsExecuted':0}
try:
 c=json.loads((r/'EXPECTED_SELECTORS.json').read_text());f=json.loads((r/'SOURCE_IDENTITY.json').read_text())
 assert hashlib.sha256((r/'EXPECTED_SELECTORS.json').read_bytes()).hexdigest()=='fc5166446afc75b6815b2246498691616884d5cfe23e8234fe01ef6f6899288e'
 assert len(f['files'])==1179
 for x in f['files']:
  b=(repo/x['path']).read_bytes();assert len(b)==x['bytes'] and hashlib.sha256(b).hexdigest()==x['sha256'],x['path']
 def result(name):return json.loads((r/'evidence'/name).read_text())['result']
 identity=result('loaded-identity.json');prod=result('loaded-production-il.json');tests=result('loaded-test-bodies.json');version=result('actual-editor-version.json');tf=result('actual-test-framework.json')
 assert version['unityVersion']=='6000.0.85f2' and not version['playing'] and not version['compiling'] and not version['compileFailed']
 assert tf['version']=='1.6.0' and tf['packageName']=='com.unity.test-framework'
 project=repo/'client-unity/UnityProject';manifest=json.loads((project/'Packages/manifest.json').read_text());lock=json.loads((project/'Packages/packages-lock.json').read_text());resolved=json.loads((project/'Library/PackageManager/projectResolution.json').read_text())['outputs']['com.unity.test-framework@1.6.0']
 assert manifest['dependencies']['com.unity.test-framework']=='1.6.0'
 assert lock['dependencies']['com.unity.test-framework']['version']=='1.6.0' and lock['dependencies']['com.unity.test-framework']['source']=='builtin'
 assert resolved['version']=='1.6.0' and resolved['source']=='builtin' and resolved['resolvedPath']==tf['resolvedPath']
 assert prod['singleClientAssembly'] and not prod['playing'] and not prod['compiling']
 assert prod['moduleMvid']==identity['loadedProduction']['mvid']
 assert hashlib.sha256(Path(prod['assemblyLocation']).read_bytes()).hexdigest()==prod['assemblyFileSha256']
 bytype={x['loadedType']:x for x in identity['results']};bodies={x['type']:x for x in tests};assert len(bytype)==len(bodies)==8
 for x in c['fixtureSources']:
  t=x['fixtureType'];a=bytype[t];b=bodies[t];assert a['loadedType']==t and a['mvid']==b['moduleMvid'];assert a['guid'].lower()==b['guid'].lower()==x['meta']['guid'].lower();assert a['importedPath']=='Assets/Tests/Editor/'+t.split('.')[-1]+'.cs';assert hashlib.sha256(Path(b['dll']).read_bytes()).hexdigest()==b['dllSha256'];assert b['methods']
 assert len({x['mvid'] for x in bytype.values()})==1 and len({x['dllSha256'] for x in tests})==1
 methods={(x['declaringType'],x['name']):x for x in prod['methods']};assert len(methods)==16
 checks=[('Roguehalla.Client.MatchClient','CloseCurrentSession','Roguehalla.Client.MatchHud.UnbindTrainingSession'),('Roguehalla.Client.MatchHud','ReadUiInput','Roguehalla.Client.MatchHud.ReadTrainingEscape'),('Roguehalla.Client.MatchHud','RefreshTrainingConsole','Roguehalla.Client.TrainingConsoleView.SetLaunchContext'),('Roguehalla.Client.TrainingConsoleView','QueueCurrent','Roguehalla.Net.InputSender.Train'),('Roguehalla.Client.TrainingConsoleView','QueueCurrent','Roguehalla.Net.Session.FlushInput')]
 for t,m,call in checks:assert call in methods[t,m]['calls'],(t,m,call)
 net=result('loaded-net-il.json');repair=result('loaded-training-repair-il.json')
 assert hashlib.sha256(Path(net['assemblyLocation']).read_bytes()).hexdigest()==net['assemblyFileSha256']
 assert repair['moduleMvid']==prod['moduleMvid'] and repair['assemblyFileSha256']==prod['assemblyFileSha256']
 nm={(t['type'],m['name']):m for t in net['types'] for m in t['methods']}
 for name in ['OnReceived','OnWelcome','Detach','OnOpened','.ctor']:assert ('Roguehalla.Net.Session',name) in nm
 for name in ['Matches','CopyCapability','get_PlayerId','.ctor']:assert ('Roguehalla.Net.SeatResume',name) in nm
 welcome=nm['Roguehalla.Net.Session','OnWelcome']['calls'];assert welcome.index('Roguehalla.Net.SeatResume.Matches')<welcome.index('Roguehalla.Net.Session.set_Welcome')
 detach=nm['Roguehalla.Net.Session','Detach']['calls']
 for name in ['Roguehalla.Net.InputSender.ClearPending','Roguehalla.Net.ITransport.remove_Opened','Roguehalla.Net.ITransport.remove_Received','Roguehalla.Net.ITransport.remove_Closed','Roguehalla.Net.ITransport.Close']:assert name in detach
 recv=nm['Roguehalla.Net.Session','OnReceived']['instructions'];now=next(i for i,x in enumerate(recv) if x['resolvedMember']=='Roguehalla.Net.Session.get_Now');assert any(x['resolvedMember']=='Roguehalla.Net.Session._detached' and x['opcode']=='ldfld' for x in recv[now+1:now+8])
 ctor=nm['Roguehalla.Net.SeatResume','.ctor'];assert [x['type'] for x in ctor['parameters']]==['System.Byte[]','System.Byte[]','System.UInt32'];assert ctor['calls'].count('System.Array.Clone')==2
 fields={t['type']:{x['name']:x['type'] for x in t['fields']} for t in net['types']};assert fields['Roguehalla.Net.SeatResume']['_matchId']=='System.Byte[]' and fields['Roguehalla.Net.SeatResume']['_capability']=='System.Byte[]'
 rm={m['name']:m for m in repair['methods']};assert len(rm)==8 and 'UnityEngine.Object.op_Inequality' in rm['OwnerAlive']['calls'] and 'Roguehalla.Client.TrainingConsoleView.DisposeOwned' in rm['OwnerAlive']['calls']
 ac=rm['get_ActionsAvailable']['calls'];assert ac.index('Roguehalla.Client.TrainingConsoleView.OwnerAlive')<ac.index('UnityEngine.Behaviour.get_isActiveAndEnabled')
 report.update(netMvid=net['moduleMvid'],netDllSha256=net['assemblyFileSha256'],ownNetIlMethods=len(nm),trainingRepairIlMethods=len(rm),noLiveSeatResumeValuesRead=True,priorFailedProofPreservedSeparate='ea39a0aa1007456360e319026b0e68cf56bf4a37')
 dropdown=result('loaded-dropdown-start-il.json')['records'];assert len(dropdown)==3
 init,move,start=dropdown
 assert init['moduleMvid']==move['moduleMvid']==tests[0]['moduleMvid']
 assert init['calls']==['TMPro.TMP_Dropdown.Start'] and start['type']=='TMPro.TMP_Dropdown' and start['name']=='Start'
 assert move['calls'].index('Roguehalla.Client.Tests.EditModeTrainingDropdown.InitializeForEditMode')<move['calls'].index('TMPro.TMP_Dropdown.Show')
 for x in dropdown:assert hashlib.sha256(Path(x['dll']).read_bytes()).hexdigest()==x['dllSha256']
 report.update(realTmpStartBound=True,dropdownInitializerIlSha256=init['ilSha256'],realTmpStartIlSha256=start['ilSha256'],priorFailedProofsPreservedSeparate=['ea39a0aa1007456360e319026b0e68cf56bf4a37','5a61c3c856aafddde0deaf62d7c102865bebcf2f'])
 report.update(status='PASS_IDENTITY_BEFORE_EXECUTION',pins=1179,allPinsExact=True,clientMvid=prod['moduleMvid'],clientDllSha256=prod['assemblyFileSha256'],testMvid=tests[0]['moduleMvid'],testDllSha256=tests[0]['dllSha256'],fixtureTypes=list(bytype),ownProductionIlMethods=len(methods),ownTestBodies=sum(len(x['methods']) for x in tests),unityVersion=version['unityVersion'],selectedAndLoadedTestFramework='1.6.0',knownSerializationException='FROZEN_README.md: preapproved exact two-space exception; observed bytes retained')
except BaseException:
 report['error']=traceback.format_exc();raise
finally:
 with out.open('x') as p:json.dump(report,p,indent=2);p.write('\n')
print(json.dumps(report,indent=2))
