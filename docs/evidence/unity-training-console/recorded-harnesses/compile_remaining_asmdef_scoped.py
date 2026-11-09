import pathlib,subprocess,json,hashlib,re
root=pathlib.Path(__file__).resolve().parent
repo=root/'repo';project=repo/'client-unity/UnityProject'
cache=pathlib.Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject')
out=root/'evidence/compile-asmdef-scoped';out.mkdir(exist_ok=False)
mono='/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/NetCoreRuntime/dotnet'
csc='/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/DotNetSdkRoslyn/csc.dll'
plans=[('Editor','RoguehallaNet','Assets/RoguehallaNet','2000b0aE.dag'),('Editor','Roguehalla.Client','Assets/Scripts','2000b0aE.dag'),('Editor','Roguehalla.Editor','Assets/Editor','2000b0aE.dag'),('Editor','Roguehalla.Client.EditModeTests','Assets/Tests/Editor','2000b0aE.dag'),('Player','RoguehallaNet','Assets/RoguehallaNet','2000b0aP.dag'),('Player','Roguehalla.Client','Assets/Scripts','2000b0aP.dag')]
results=[]
prior=root/'evidence/compile-unity-csc/Editor'
import shutil
(out/'Editor').mkdir()
for name in ['RoguehallaNet','Roguehalla.Client']:
 shutil.copy2(prior/(name+'.dll'),out/'Editor'/(name+'.dll'))
plans=[p for p in plans if not (p[0]=='Editor' and p[1] in ['RoguehallaNet','Roguehalla.Client'])]
for mode,name,sourceFolder,dag in plans:
 folder=out/mode;folder.mkdir(exist_ok=True)
 template=cache/'Library/Bee/artifacts'/dag/(name+'.rsp');raw=template.read_text().splitlines()
 defines=[x for x in raw if x.startswith('-define:')]
 assert ('-define:UNITY_EDITOR' in defines)==(mode=='Editor')
 if mode=='Player':assert '-define:UNITY_WEBGL' in defines
 sources=sorted((project/sourceFolder).rglob('*.cs'))
 if name=='Roguehalla.Editor':
  sources=[p for p in sources if not any(list(parent.glob('*.asmdef')) for parent in p.parents if parent!=project/sourceFolder and (project/sourceFolder) in parent.parents)]
 references=[]
 for line in raw:
  if not line.startswith('-r:'):continue
  value=line[3:].strip('"');p=pathlib.Path(value)
  if not p.is_absolute():p=cache/p
  n=p.name.removesuffix('.ref.dll').removesuffix('.dll')
  if n in {'RoguehallaNet','Roguehalla.Client','Roguehalla.Editor','Roguehalla.Client.EditModeTests'}:
   p=folder/(n+'.dll')
  assert p.is_file(),str(p)
  references.append(p)
 # Explicitly keep freshly compiled project dependencies; no cached project assemblies enter the compile.
 for dependency in (['RoguehallaNet'] if name=='Roguehalla.Client' else ['RoguehallaNet','Roguehalla.Client'] if name in ['Roguehalla.Editor','Roguehalla.Client.EditModeTests'] else []):
  p=folder/(dependency+'.dll')
  if p not in references:references.append(p)
 args=['-target:library','-nostdlib','-langversion:9.0','-deterministic','-optimize+','-nologo',f'-out:"{folder}/{name}.dll"']+defines+[f'-r:"{p}"' for p in references]+[f'"{p}"' for p in sources]
 rsp=folder/(name+'.rsp');rsp.write_text('\n'.join(args)+'\n')
 command=[mono,csc,'@'+str(rsp)];q=subprocess.run(command,cwd=repo,capture_output=True,text=True)
 (folder/(name+'.stdout.txt')).write_text(q.stdout);(folder/(name+'.stderr.txt')).write_text(q.stderr)
 entry={'mode':mode,'assembly':name,'scope':'Standalone compiler, no Editor process/load/native execution','command':command,'template':str(template),'templateSha256':hashlib.sha256(template.read_bytes()).hexdigest(),'rspSha256':hashlib.sha256(rsp.read_bytes()).hexdigest(),'sourceFiles':[{'path':str(p.relative_to(repo)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sources],'references':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in references],'exitCode':q.returncode,'errors':len(re.findall(r'\berror CS\d+',q.stdout)),'warnings':len(re.findall(r'\bwarning CS\d+',q.stdout)),'outputSha256':hashlib.sha256((folder/(name+'.dll')).read_bytes()).hexdigest() if (folder/(name+'.dll')).exists() else None}
 results.append(entry);(out/'COMPILE_RECEIPT.json').write_text(json.dumps({'compilerSha256':hashlib.sha256(pathlib.Path(csc).read_bytes()).hexdigest(),'scope':'Editor and WebGL Player source compilation only. No Unity Editor/build/import or test execution.','assemblies':results},indent=2)+'\n')
 print(mode,name,'exit',q.returncode,'errors',entry['errors'],'warnings',entry['warnings'],flush=True)
 if q.returncode:
  print(q.stdout[-10000:]);raise SystemExit(q.returncode)
