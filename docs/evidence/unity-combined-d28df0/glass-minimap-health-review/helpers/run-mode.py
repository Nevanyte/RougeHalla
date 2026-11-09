from pathlib import Path
import subprocess,json,time,sys
base=Path(__file__).resolve().parent;e=base/'evidence';project='/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject'
height=int(sys.argv[1]);mode=sys.argv[2];endpoint=sys.argv[3] if len(sys.argv)>3 else ''
assert height in (720,1440) and mode in ('hud','planning','map') and endpoint in ('','085','125')
key=f'{height}-{mode}'+('-mini'+endpoint if endpoint else '')
script=base/('capture-'+key+'.cs')
expected=[e/'layouts'/f'{height}-{mode}-text{t}{"-mini"+endpoint if endpoint else ""}.json' for t in ([150] if endpoint else [100,150])]
assert not any(f.exists() for f in expected),'Refuse overwriting a captured case'
def command(args,filename,timeout=30):
 r=subprocess.run(['unity','command']+args+['--project-path',project,'--caller','plugin','--skill','unity-cli','--format','json'] if '--' not in args else ['unity','command']+args[:args.index('--')]+['--project-path',project,'--caller','plugin','--skill','unity-cli','--format','json']+args[args.index('--'):],capture_output=True,text=True,timeout=timeout)
 (e/filename).write_text(r.stdout+'\n'+r.stderr if r.stderr else r.stdout)
 assert r.returncode==0,(args[:3],r.returncode,r.stdout[-1500:])
 try:x=json.loads(r.stdout)
 except ValueError: x={}
 assert not isinstance(x,dict) or x.get('success') is not False,(filename,x)
 return x
command(['editor.playmode','stop'],'play-stop-before-'+key+'.json')
mini='UnityEngine.PlayerPrefs.DeleteKey("rh.ui.minimapScale");' if not endpoint else 'UnityEngine.PlayerPrefs.SetInt("rh.ui.minimapScale",'+('0' if endpoint=='085' else '2')+');'
setup='UnityEditor.PlayerSettings.runInBackground=true; '+mini+' UnityEngine.PlayerPrefs.Save(); UnityEditor.SessionState.SetString("Roguehalla.ArtPreviewQuery","?uiReview='+mode+'");return new{ready=true,miniIndex=UnityEngine.PlayerPrefs.GetInt("rh.ui.minimapScale",1)};'
command(['script','eval','--',setup],'setup-'+key+'.json')
command(['editor.playmode','start'],'play-start-'+key+'.json')
time.sleep(2.1)
r=subprocess.run(['unity','status','--until-ready','--project-path',project,'--format','json'],capture_output=True,text=True,timeout=30);(e/('ready-'+key+'.json')).write_text(r.stdout);assert r.returncode==0,r.stdout
command(['script','eval','--','--file',str(script)],'launch-'+key+'.json')
deadline=time.monotonic()+15
while not all(f.exists() for f in expected) and time.monotonic()<deadline:time.sleep(.2)
console=command(['console','get','--','--level','error','--tail','10'],'console-'+key+'.json')
assert all(f.exists() for f in expected),('Capture did not finish',key,console)
rows=[]
for f in expected:
 x=json.loads(f.read_text());assert x['nativeDimensionsMatch'] and x['isReady'] and x['advanced'] and x['ticksAdvanced'] and x['stagedWatermark'],f
 rows.append({'case':f.stem,'width':x['imageWidth'],'height':x['imageHeight'],'loadedMiniScale':x['mapState']['loadedScale'],'overflowFlags':sum(v['overflow']or v['truncated'] for v in x['texts'])})
assert not console.get('entries'),('Console error',console)
print(json.dumps({'cases':rows,'consoleErrors':console.get('groundTruth',{}).get('consoleErrors')}))
