import pathlib,subprocess,json,sys,datetime
r=pathlib.Path(__file__).resolve().parent;p='/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject'
name=sys.argv[1];parts=sys.argv[2:];i=parts.index('--') if '--' in parts else len(parts)
args=['unity','command']+parts[:i]+['--project-path',p,'--caller','plugin','--skill','unity-cli','--format','json']+parts[i:]
q=subprocess.run(args,capture_output=True,text=True);(r/'evidence'/name).write_text(q.stdout)
(r/'evidence'/(name+'.invocation.json')).write_text(json.dumps(dict(argv=args,exitCode=q.returncode,stderr=q.stderr,utc=datetime.datetime.now(datetime.timezone.utc).isoformat()),indent=2))
d=json.loads(q.stdout);print(json.dumps(d)[:1600]);assert q.returncode==0 and (not isinstance(d,dict) or d.get('success',True)),d
