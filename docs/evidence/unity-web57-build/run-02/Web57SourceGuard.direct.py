from pathlib import Path
import collections, hashlib, json, re, subprocess

P = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated')
REPO = P / 'repo'
PROJECT = REPO / 'client-unity/UnityProject'
SOURCE = '57e166f46b35fb703e5f3c76914fcc4e8bf3191c'
FREEZE_SHA = 'ba2c65e9b206c368414941231e27db9ab33ca704c73dbbf6fc66dba57742620c'
RELEASE_SHA = '37bd893c6e2305c85912c1407c53e02c8d9ab8a1381523c7f51b74bf9d218170'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def need(ok, message):
    if not ok:
        raise ValueError(message)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)

def verify():
    fpath = P / 'WEB57_SOURCE_FREEZE.json'
    rpath = P / 'run-02/ROOT_WEB57_BUILD_RELEASE.json'
    need(sha(fpath) == FREEZE_SHA and sha(rpath) == RELEASE_SHA, 'Root freeze/release bytes differ')
    f = json.loads(fpath.read_bytes())
    release = json.loads(rpath.read_bytes())
    need(f['format'] == 'rh-unity-web-source-freeze/1' and f['commit'] == SOURCE, 'Freeze identity differs')
    need(f['project'] == str(PROJECT) and PROJECT.resolve() == PROJECT, 'Project differs')
    need(release['source'] == SOURCE and release['editorPid'] == 46583 and f['excluded_editor_pid'] == 9075, 'Release context differs')
    need(git('rev-parse', 'HEAD').decode().strip() == SOURCE, 'HEAD differs')
    need(git('rev-parse', 'HEAD^{tree}').decode().strip() == f['tree'], 'Git tree differs')
    entries = {}
    for item in git('ls-tree', '-r', '-z', SOURCE, '--', 'client-unity', 'protocol').split(b'\0'):
        if not item:
            continue
        metadata, path = item.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        need(kind == 'blob', 'Non-blob source input')
        entries[path.decode()] = oid
    pins = f['source_pins']
    need(f['source_pin_count'] == len(pins) == len(entries) == 1284, 'Pin count differs')
    need({x['path'] for x in pins} == set(entries), 'Pin path set differs')
    guids = []
    for row in pins:
        path = REPO / row['path']
        need(path.resolve().is_relative_to(REPO), 'Pin escapes repository')
        data = path.read_bytes()
        need(len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], 'Source pin differs: ' + row['path'])
        need(hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == entries[row['path']], 'Git blob differs: ' + row['path'])
        if row['path'].startswith('client-unity/UnityProject/Assets/') and row['path'].endswith('.meta'):
            found = re.findall(rb'(?mi)^guid:\s*([0-9a-f]{32})\s*$', data)
            need(len(found) == 1, 'Invalid asset GUID: ' + row['path'])
            guids.append(found[0].lower())
    need(len(guids) == len(set(guids)) == f['asset_meta_guids'] == 626, 'GUID count or uniqueness differs')
    lock = json.loads((PROJECT / 'Packages/packages-lock.json').read_bytes())['dependencies']
    packages = f['package_set']
    need(lock == packages and len(packages) == 39, 'Package lock differs')
    sources = dict(collections.Counter(x['source'] for x in packages.values()))
    need(sources == {'registry': 9, 'builtin': 30}, 'Package source counts differ')
    direct = {name: row['version'] for name, row in packages.items() if row['depth'] == 0}
    need(json.loads((PROJECT / 'Packages/manifest.json').read_bytes())['dependencies'] == direct, 'Direct dependencies differ')
    overlay = f['permittedStartupOverlay']
    need(overlay == {'path':'client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset','bytes':1044,'sha256':'a2cb53758656a32e072c1e33d985a3f73b8374b2acb3365750d31070d60a67b5'}, 'Overlay identity differs')
    path = REPO / overlay['path']
    need(path.stat().st_size == overlay['bytes'] and sha(path) == overlay['sha256'], 'Actual startup overlay differs')
    need(git('status', '--porcelain=v1', '--untracked-files=all').decode() == '?? ' + overlay['path'] + '\n', 'Unexpected modified/untracked files')
    need(git('diff', '--name-only', SOURCE, f['canonicalClientProtocolEquivalent'], '--', 'client-unity', 'protocol') == b'', 'Canonical client/protocol equivalence differs')
    need(Path(f['editor']).is_file() and Path(f['webgl_module']).is_dir(), 'Editor/module missing')
    need(f['allowanceForFutureSerializationDrift'].startswith('NONE'), 'Unexpected drift allowance')
    return {'status':'PASS_WEB57_EXACT_FROZEN_SOURCE', 'source':SOURCE, 'tree':f['tree'],
        'sourceFreezeSha256':FREEZE_SHA, 'releaseSha256':RELEASE_SHA, 'sourcePins':1284,
        'uniqueAssetGuids':626, 'packages':39, 'packageSources':sources,
        'soleStartupOverlay':overlay, 'canonicalClientProtocolEquivalent':f['canonicalClientProtocolEquivalent']}
