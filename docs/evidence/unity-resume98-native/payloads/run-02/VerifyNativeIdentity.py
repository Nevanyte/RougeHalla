from pathlib import Path
import collections, datetime, hashlib, json, re, subprocess

R = Path(__file__).resolve().parent
P = R.parent
REPO = P / 'repo'
PROJECT = REPO / 'client-unity/UnityProject'
SOURCE = '6d5d9340a6b9f425a17d7ea4488b49291fff3dc1'
FREEZE_HASH = '2845414b71e5afe0c5ad6597e38c50187e0975680a8712823b9e039f1068a343'
OVERLAY_HASH = 'aff1b08079e75b22b8a0f8c1132bf24ccbec8d36a8d14967c41526f9d89cbe3e'
CONTRACT_HASH = '6bfa787e4f63be11fc8a1d51879f30cfc7617f4d7d51883afc60a28a7ef8870e'
PINS_HASH = '72ab2814479574ed1c159a1a6af077f86b8c6870eaccb86c20ab97ea49312a1c'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def read(path):
    return json.loads(path.read_text())

def result(name):
    x = read(R / 'evidence' / name)
    require(x.get('success') is True, name + ': observer failed')
    return x['result']

def main():
    require(sha(P / 'SOURCE_FREEZE.json') == FREEZE_HASH, 'Root source freeze changed')
    require(sha(P / 'BOOTSTRAP_OVERLAY_01.json') == OVERLAY_HASH, 'Root exact overlay decision changed')
    freeze = read(P / 'SOURCE_FREEZE.json')
    overlay = read(P / 'BOOTSTRAP_OVERLAY_01.json')
    require(freeze['commit'] == SOURCE and freeze['project'] == str(PROJECT), 'Freeze context differs')
    require(overlay['source'] == SOURCE and overlay['editor_pid'] == 46583
        and overlay['source_freeze_sha256'] == FREEZE_HASH, 'Overlay context differs')
    require(overlay['path'] == 'client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset'
        and overlay['bytes'] == 1044
        and overlay['sha256'] == 'a2cb53758656a32e072c1e33d985a3f73b8374b2acb3365750d31070d60a67b5', 'Overlay is not the single reviewed file')
    overlay_file = REPO / overlay['path']
    require(overlay_file.stat().st_size == overlay['bytes'] and sha(overlay_file) == overlay['sha256'], 'Actual overlay changed')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip() == SOURCE, 'HEAD differs')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=REPO, text=True).strip() == freeze['tree'], 'Tree differs')
    require(len(freeze['source_pins']) == 1284, 'Freeze pin count differs')
    for pin in freeze['source_pins']:
        path = REPO / pin['path']
        require(path.is_file() and path.stat().st_size == pin['bytes'] and sha(path) == pin['sha256'], 'Frozen file differs: ' + pin['path'])
    status = subprocess.run(['git', 'status', '--porcelain=v1', '--untracked-files=all', '--', 'client-unity', 'protocol/fixtures'], cwd=REPO, capture_output=True)
    status_path = R / 'evidence/native-identity-source-status.txt'
    with status_path.open('xb') as h:
        h.write(status.stdout)
    require(status.returncode == 0 and status.stdout.decode() == '?? ' + overlay['path'] + '\n', 'Unexpected modified/untracked source beyond exact startup overlay')
    guids = []
    for path in (PROJECT / 'Assets').rglob('*.meta'):
        matches = re.findall(r'^guid:\s*([0-9a-fA-F]{32})\s*$', path.read_text(), re.M)
        require(len(matches) == 1, 'Invalid GUID count: ' + str(path))
        guids.append(matches[0].lower())
    require(len(guids) == 626 and len(set(guids)) == 626, 'Asset GUID uniqueness/count differs')
    native = result('packages-and-baseline-raw.json')
    loaded = result('loaded-identity-raw.json')
    context = native['context']
    require(context == loaded['context'], 'Loaded/baseline native contexts differ')
    require(context['projectPath'] == str(PROJECT) and context['editorPid'] == 46583
        and context['unityVersion'] == '6000.0.85f2' and context['sourceSha'] == SOURCE
        and context['editorBinaryPath'] == freeze['editor'] and context['activeBuildTarget'] == 'WebGL'
        and not context['isCompiling'] and not context['isUpdating'] and not context['isPlaying'], 'Actual native context differs')
    require(Path(freeze['editor']).is_file() and Path(freeze['webgl_module']).is_dir(), 'Frozen Editor/module missing')
    packages = native['packages']
    require(len(packages) == 39 and len({x['name'] for x in packages}) == 39, 'Actual package count differs')
    actual = {x['name']: x for x in packages}
    require(set(actual) == set(freeze['package_set']), 'Actual package names differ')
    for name, expected in freeze['package_set'].items():
        got = actual[name]
        require(got['version'] == expected['version'] and got['source'].lower() == expected['source'], 'Package selected version/source differs: ' + name)
        package_json = Path(got['packageJsonPath'])
        require(package_json == Path(got['resolvedPath']) / 'package.json'
            and sha(package_json) == got['packageJsonSha256'], 'Actual package JSON hash/path differs: ' + name)
        package_body = read(package_json)
        require(package_body['name'] == name and package_body['version'] == got['version'], 'Package JSON identity differs: ' + name)
        if expected['source'] == 'registry':
            require(got['officialDefaultRegistry'] is True and expected['url'] == 'https://packages.unity.com', 'Registry is not official default: ' + name)
    assemblies = native['frameworkAssemblies']
    for key, name in [('client', 'Roguehalla.Client'), ('net', 'RoguehallaNet'), ('tests', 'Roguehalla.Client.EditModeTests')]:
        row = assemblies[key]
        path = PROJECT / 'Library/ScriptAssemblies' / (name + '.dll')
        require(row['present'] and row['location'] == str(path) and row['fullName'].split(',')[0] == name
            and row['fileSha256'] == sha(path) and row['moduleMvid'], 'Loaded assembly identity differs: ' + key)
    require(assemblies['client']['moduleMvid'] == loaded['loadedProduction']['mvid'], 'Client MVID differs between observers')
    require({x['mvid'] for x in loaded['results']} == {assemblies['tests']['moduleMvid']}, 'Fixture/test assembly MVID differs')
    for key, expected in [('testRunnerApiPackage', 'com.unity.test-framework'), ('nunitPackage', 'com.unity.ext.nunit')]:
        got = assemblies[key]
        require(got['present'] and got['name'] == expected and got['version'] == actual[expected]['version']
            and got['resolvedPath'] == actual[expected]['resolvedPath'] and got['packageJsonSha256'] == actual[expected]['packageJsonSha256'], 'Loaded framework package differs: ' + key)
    require(assemblies['testRunnerApiPackage']['version'] == '1.6.0', 'Actual Test Framework is not frozen1.6.0')
    for key in ['testRunnerApiAssembly', 'nunitAssembly']:
        row = assemblies[key]
        require(row['present'] and row['fileSha256'] == sha(Path(row['location'])) and row['moduleMvid'], 'Framework DLL identity differs: ' + key)
    baseline = native['baseline']
    require(baseline['sceneCount'] == 1 and baseline['sceneRootCount'] == 2
        and baseline['eventSystems'] == [] and baseline['light2DInstances'] == [], 'Unexpected initial new-process scene baseline')
    require(not baseline['activeScene']['isDirty'] and not any(s['isDirty'] for s in baseline['scenes']), 'Dirty scene in fresh baseline')
    overlay_binding = {'manifestSha256': OVERLAY_HASH, 'path': overlay['path'], 'bytes': overlay['bytes'], 'sha256': overlay['sha256']}
    receipt = {'status': 'PASS_IDENTITY_BEFORE_EXECUTION', 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': SOURCE, 'sourceSha': SOURCE, 'project': str(PROJECT), 'editorPid': 46583, 'context': context,
        'contractSha256': CONTRACT_HASH, 'fixtureSourcesSha256': PINS_HASH, 'sourceFreezeSha256': FREEZE_HASH,
        'bootstrapOverlay': overlay_binding, 'sourcePinsVerified': 1284, 'uniqueAssetGuids': 626,
        'actualPackages': len(packages), 'packageSources': dict(collections.Counter(p['source'] for p in packages)),
        'actualTestFramework': assemblies['testRunnerApiPackage']['version'], 'loadedAssemblies': assemblies,
        'testMvid': assemblies['tests']['moduleMvid'], 'executedTests': False,
        'baselineRawSha256': sha(R / 'evidence/packages-and-baseline-raw.json'),
        'loadedIdentityRawSha256': sha(R / 'evidence/loaded-identity-raw.json'),
        'baselineDirtyObjects': baseline['dirtyCounts'],
        'limits': 'Package API reports selected source/default registry; individual startup cache-versus-network provenance was not observed. No dirty-object counters cleared or assets saved.'}
    with (R / 'evidence/native-identity-verification.json').open('x') as h:
        json.dump(receipt, h, indent=2)
        h.write('\n')
    print('PASS_IDENTITY_BEFORE_EXECUTION:1284pins+one exact Root overlay;39packages;actual loaded Client/Net/Test/TF/NUnit identities;tests unrun')

if __name__ == '__main__':
    main()
