import pathlib,subprocess,json,hashlib
r=pathlib.Path(__file__).resolve().parent;repo=pathlib.Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art');p=str(repo/'client-unity/UnityProject');e=r/'return-evidence';e.mkdir(exist_ok=True)
def call(name,parts):
 i=parts.index('--') if '--' in parts else len(parts);args=['unity','command']+parts[:i]+['--project-path',p,'--caller','plugin','--skill','unity-cli','--format','json']+parts[i:]
 q=subprocess.run(args,capture_output=True,text=True);(e/name).write_text(q.stdout)
 if q.stderr:(e/(name+'.stderr.txt')).write_text(q.stderr)
 d=json.loads(q.stdout);assert q.returncode==0 and (not isinstance(d,dict) or d.get('success',True)),d;return d
proof=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();assert subprocess.check_output(['git','merge-base','--is-ancestor','0aeddc5b4ce0feb5fc0060f2cf2d56c05dff8944',proof],cwd=repo)==b'';assert not subprocess.check_output(['git','status','--porcelain'],cwd=repo)
call('hold-for-frozen4-return.json',['script','eval','--','--file','/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/functional-fa0c0891-2026-11-09/hold-and-baseline.cs'])
subprocess.run(['git','switch','codex/unity-frozen4-editor-idle'],cwd=repo,check=True);assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()=='5b7877f99805d6ef980577eda86a779ee4614d9f'
call('refresh-frozen4-return.json',['script','eval','--','--file','/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/static-preview-2026-11-09/RefreshFrozen4.cs'])
print('Returned source5b; must await actual editor ready then finish overlays/state.',proof)
