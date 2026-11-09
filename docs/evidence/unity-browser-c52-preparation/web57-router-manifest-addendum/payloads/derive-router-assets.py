from pathlib import Path
import hashlib
import json

OUT = Path(__file__).resolve().parent
ART = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/web57-artifact-manifest.json')
EXPECTED = 'a224cc6cc378604e4f9407f1c540f3ceae364d9cf0c97004fcd21df816c83824'
ROOT = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/web-build-57e166-2026-11-09/Web')
MIME = {'.data':'application/octet-stream', '.js':'application/javascript; charset=utf-8',
        '.wasm':'application/wasm', '.txt':'text/plain; charset=utf-8',
        '.md':'text/plain; charset=utf-8', '.html':'text/html; charset=utf-8'}
sha = lambda raw: hashlib.sha256(raw).hexdigest()
raw = ART.read_bytes()
assert sha(raw) == EXPECTED
original = json.loads(raw)
assert original['format'] == 'rh-web57-artifact-manifest/1'
assert original['source'] == '57e166f46b35fb703e5f3c76914fcc4e8bf3191c'
assert original['canonicalClientProtocolEquivalent'] == '5e19ef1b801ef363a83217ddecd768c5aba71cac'
assert original['output'] == str(ROOT) and original['result'] == 'Succeeded'
assert original['fileCount'] == len(original['files']) == 14
assert sum(row['bytes'] for row in original['files']) == original['totalBytes'] == 106987680
seen = set()
files = []
for row in original['files']:
    assert set(row) == {'path','bytes','sha256'}
    name = row['path']
    assert isinstance(name,str) and name and not name.startswith('/')
    assert '\\' not in name and '%' not in name
    assert all(part and part not in ('.','..') for part in name.split('/'))
    assert name not in seen
    seen.add(name)
    files.append({'path':'/' + name, 'file':name, 'sha256':row['sha256'],
                  'bytes':row['bytes'], 'contentType':MIME[Path(name).suffix]})
assert ROOT.is_dir() and not ROOT.is_symlink()
actual = set()
for path in ROOT.rglob('*'):
    assert not path.is_symlink()
    if path.is_file(): actual.add(str(path.relative_to(ROOT)))
    else: assert path.is_dir()
assert actual == seen
index = next(row for row in files if row['file'] == 'index.html')
assert index['bytes'] == 7920
files.append(dict(index, path='/'))
assert len(files) == 15 and sum(row['bytes'] for row in files) == 106995600
derived = {'schema':'unity-router-assets/1', 'files':files}
data = (json.dumps(derived,indent=2) + '\n').encode()
with (OUT/'router-assets.json').open('xb') as f: f.write(data)
receipt = {'format':'rh-web57-router-manifest-provenance/1',
           'classification':'PREPARATION_ONLY_NO_LISTENERS_OR_BROWSER',
           'originalManifest':str(ART), 'originalManifestSha256':EXPECTED,
           'artifactRoot':str(ROOT), 'source':original['source'],
           'canonicalClientProtocolEquivalent':original['canonicalClientProtocolEquivalent'],
           'buildId':original['buildId'], 'physicalFileCount':14,
           'physicalBytes':106987680, 'urlEntryCount':15, 'aliasCountedBytes':106995600,
           'derivedManifest':str(OUT/'router-assets.json'), 'derivedManifestSha256':sha(data),
           'generatorSha256':sha(Path(__file__).read_bytes()),
           'uncompressed':True, 'artifactModified':False,
           'alias':{'path':'/', 'originalPath':'index.html','sha256':index['sha256'],'bytes':7920},
           'physicalRows':original['files']}
with (OUT/'provenance.json').open('x') as f: json.dump(receipt,f,indent=2); f.write('\n')
assert sha(ART.read_bytes()) == EXPECTED
print(json.dumps({'physicalFileCount':14, 'urlEntryCount':15,
                  'physicalBytes':106987680, 'derivedManifestSha256':sha(data),
                  'originalManifestSha256':EXPECTED, 'artifactModified':False}))
