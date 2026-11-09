#!/usr/bin/env python3
"""Prepared, NOT executed. Exactly-once native98 runner; explicit Root release is required."""
from pathlib import Path
import argparse, collections, datetime, hashlib, json, re, subprocess

APPROVED_PROJECT = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject')
UNITY_VERSION = '6000.0.85f2'
CONTRACT_SCHEMA = 'roguehalla-owned-seat-resume-typed-fixture-contract/1'
KNOWN = {'Passed', 'Failed', 'Skipped', 'Inconclusive'}


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as handle:
        handle.write(data if isinstance(data, bytes) else data.encode('utf-8'))


def write_json(path, value, new=True):
    data = (json.dumps(value, indent=2) + '\n').encode()
    if new:
        write_new(path, data)
    else:
        # Only the live accounting ledger is mutable; every raw command artifact is create-only.
        path.write_bytes(data)


def read_json(path):
    return json.loads(path.read_text())


def run_raw(evidence, stem, argv):
    out, err, receipt = (evidence / (stem + suffix) for suffix in ('.stdout.txt', '.stderr.txt', '.invocation.json'))
    for p in (out, err, receipt):
        require(not p.exists(), 'Refusing to overwrite command evidence: ' + str(p))
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    stdout = stderr = b''
    exit_code = None
    launch_error = None
    try:
        result = subprocess.run(argv, capture_output=True)
        stdout, stderr, exit_code = result.stdout, result.stderr, result.returncode
    except Exception as error:
        launch_error = repr(error)
        stderr = launch_error.encode()
    # Preserve original bytes before any decode, coverage accounting or verdict.
    write_new(out, stdout)
    write_new(err, stderr)
    write_json(receipt, {'argv': argv, 'startedUtc': started,
        'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'exitCode': exit_code, 'launchError': launch_error,
        'stdoutSha256': digest(stdout), 'stdoutBytes': len(stdout),
        'stderrSha256': digest(stderr), 'stderrBytes': len(stderr)})
    return {'stdout': stdout, 'stderr': stderr, 'exitCode': exit_code,
        'launchError': launch_error, 'stdoutPath': str(out), 'stderrPath': str(err),
        'invocationPath': str(receipt)}


def parse_success(result):
    require(result['launchError'] is None and result['exitCode'] == 0,
            'CLI launch/exit error: ' + str(result['launchError'] or result['exitCode']))
    data = json.loads(result['stdout'])
    require(isinstance(data, dict) and data.get('success') is True, 'CLI response success is not true')
    return data


def context_matches(row, args):
    require(row.get('source') == args.source, 'Receipt execution source differs')
    context = row.get('context')
    require(isinstance(context, dict) and context.get('projectPath') == str(args.project)
            and context.get('editorPid') == args.editor_pid and context.get('unityVersion') == UNITY_VERSION,
            'Receipt in-process context differs')
    require(row.get('project') == str(args.project), 'Receipt project differs')
    require(type(row.get('editorPid')) is int and row['editorPid'] == args.editor_pid,
            'Receipt Editor PID differs')
    require(row.get('contractSha256') == args.contract_sha256, 'Receipt contract hash differs')
    require(row.get('fixtureSourcesSha256') == args.fixture_sources_sha256,
            'Receipt fixture-source hash differs')


def verify_inputs(args):
    require(re.fullmatch('[0-9a-f]{40}', args.source), 'Need exact final Root SHA; no abbreviated/default source')
    require(args.project.is_absolute() and args.project.resolve() == APPROVED_PROJECT.resolve(),
            'Only the sole Root-created isolated project is permitted')
    require(args.project == args.project.resolve(), 'Project argument must be canonical')
    require(args.editor_pid > 0 and args.editor_pid != 9075, 'New explicit PID required; old9075 excluded')
    require(args.evidence.is_absolute() and not args.evidence.is_relative_to(args.project),
            'Evidence must be absolute and outside the Unity project')
    repo = args.project.parent.parent
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    require(head == args.source, 'Isolated worktree HEAD differs from final execution source')
    require(digest(args.contract.read_bytes()) == args.contract_sha256, 'Contract hash differs')
    require(digest(args.fixture_sources.read_bytes()) == args.fixture_sources_sha256,
            'Fixture-source packet hash differs')
    contract = read_json(args.contract)
    require(contract.get('schema') == CONTRACT_SCHEMA, 'Unexpected Candidate04 contract schema')
    require(contract.get('counts') == {'old90': 90, 'newResume': 8, 'total': 98}, 'Exact98 contract counts differ')
    cases = contract['cases']
    require(len(cases) == 98 and len({x['fullName'] for x in cases}) == 98, 'Need98 unique literal cases')
    source_packet = read_json(args.fixture_sources)
    fixture_rows = source_packet['fixtureSources']
    fixtures = [x['fixtureType'] for x in fixture_rows]
    require(len(fixtures) == len(set(fixtures)) == 9, 'Need9 unique fixture source rows')
    require({x['fixtureType'] for x in cases} == set(fixtures), 'Fixture types differ from98 cases')
    # Source order is explicit in the source packet, not inferred from old90 or filter arithmetic.
    for row in fixture_rows:
        for key in ('source', 'meta'):
            item = row[key]
            path = repo / item['path']
            require(path.is_relative_to(repo) and digest(path.read_bytes()) == item['sha256'],
                    'Actual fixture source/meta differs: ' + item['path'])
    binding = read_json(args.binding)
    native = read_json(args.native_identity)
    for row in (binding, native):
        context_matches(row, args)
        require(row.get('executedTests') is False, 'Pre-execution receipt must explicitly say tests not executed')
    require(binding.get('status') == 'PASS_BEFORE_EXECUTION' and binding.get('cases') == 98,
            'Fresh typed native discovery binding is not PASS98')
    require(native.get('status') == 'PASS_IDENTITY_BEFORE_EXECUTION', 'Fresh native/source identity is not PASS')
    require(binding.get('loadedTestAssemblyMvid') == native.get('testMvid') and native.get('testMvid'),
            'Discovery and native test MVID differ')
    require(binding.get('nativeIdentitySha256') == digest(args.native_identity.read_bytes()),
            'Binding does not pin the actual native identity receipt')
    baseline = read_json(args.console_baseline)
    require(isinstance(baseline.get('session'), str) and type(baseline.get('cursor')) is int,
            'Need exact new-Editor console session/cursor baseline')
    require(baseline.get('entries') == [], 'New console baseline contains errors; no implicit exception')
    require(baseline.get('groundTruth', {}).get('compilationFailed') is False,
            'Baseline does not establish absence of compilation failure')
    return contract, fixtures, cases, baseline


def target_status(args, stem):
    raw = run_raw(args.evidence, stem, ['unity', 'status', '--project-path', str(args.project), '--format', 'json'])
    data = parse_success(raw)
    rows = data.get('data', {}).get('instances')
    require(isinstance(rows, list) and len(rows) == 1, 'Status must identify exactly one scoped instance')
    row = rows[0]
    project = row.get('projectPath', row.get('project'))
    require(isinstance(project, str) and Path(project).resolve() == args.project,
            'Scoped status returned another project; no fallback allowed')
    require(row.get('pid') == args.editor_pid and row['pid'] != 9075, 'Scoped Editor PID changed')
    require(row.get('version', row.get('editorVersion')) == UNITY_VERSION and row.get('state') == 'ready',
            'Wrong engine version or non-ready isolated Editor')


def console_since(args, stem, cursor):
    target_status(args, stem + '-target')
    argv = ['unity', 'command', 'console', 'get', '--project-path', str(args.project),
        '--caller', 'plugin', '--skill', 'unity-cli', '--format', 'json', '--',
        '--level', 'error', '--tail', '100', '--since', str(cursor['cursor']),
        '--since-session', cursor['session']]
    raw = run_raw(args.evidence, stem, argv)
    require(raw['launchError'] is None and raw['exitCode'] == 0, 'Console command failed')
    data = json.loads(raw['stdout'])
    require(data.get('session') == cursor['session'] and data.get('reset') is False,
            'Console session changed; no cursor reset accepted')
    require(data.get('dropped') is False, 'Console evidence was dropped')
    require(data.get('entries') == [], 'New isolated Editor console error(s); see preserved raw output')
    require(data.get('groundTruth', {}).get('compilationFailed') is False,
            'Isolated Editor reports compilation failure')
    require(type(data.get('cursor')) is int, 'Console cursor malformed')
    return data


def record_coverage(ledger, group, stdout, cases, fixtures):
    data = json.loads(stdout)
    rows = data.get('Results')
    require(isinstance(rows, list), 'No raw Results list')
    require(all(isinstance(x, dict) and isinstance(x.get('FullName'), str) for x in rows),
            'Malformed raw result row')
    group['rawResultCoverage'] = [{'fullName': x['FullName'], 'status': x.get('Status')} for x in rows]
    expected = set(group['expectedFullNames'])
    names = [x['FullName'] for x in rows]
    complete = len(names) == len(set(names)) and set(names) == expected and all(x.get('Status') in KNOWN for x in rows)
    group['executionStatus'] = 'COMPLETE_RAW_RESULTS' if complete else 'PARTIAL_OR_UNEXPECTED_RAW_RESULTS'
    if complete:
        ledger['completedFixtureTypes'].append(group['fixtureType'])
    all_rows = [x for g in ledger['groups'] for x in g.get('rawResultCoverage', [])]
    ledger['executedFullNames'] = sorted({x['fullName'] for x in all_rows if x['status'] in {'Passed', 'Failed', 'Inconclusive'}})
    ledger['skippedFullNames'] = sorted({x['fullName'] for x in all_rows if x['status'] == 'Skipped'})
    invoked = {g['fixtureType'] for g in ledger['groups']}
    ledger['notYetInvokedFullNames'] = [x['fullName'] for x in cases if x['fixtureType'] not in invoked]
    ledger['unrunFullNames'] = sorted(set(ledger['notYetInvokedFullNames']) | set(ledger['skippedFullNames']))
    known_returned = {x['FullName'] for x in rows if x.get('Status') in KNOWN}
    ledger['unresolvedCurrentFixtureFullNames'] = sorted(expected - known_returned)
    return data


def validate_verdict(data, group, raw):
    require(raw['launchError'] is None and raw['exitCode'] == 0, 'Native test CLI launch/exit error')
    require(data.get('success') is True, 'Native test response success is not true')
    require(group['executionStatus'] == 'COMPLETE_RAW_RESULTS', 'Raw case coverage is incomplete/unexpected')
    rows = data['Results']
    require(all(x.get('Status') == 'Passed' and x.get('Message') is None and x.get('StackTrace') is None for x in rows),
            'One or more cases failed/skipped/inconclusive/returned diagnostics')
    summary = {'Total': len(rows), 'Passed': len(rows), 'Failed': 0, 'Skipped': 0, 'Inconclusive': 0}
    require(data.get('Summary') == summary, 'Native summary does not match exact passed rows')
    return summary


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'evidence', 'contract', 'fixture-sources', 'binding', 'native-identity', 'console-baseline'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--contract-sha256', required=True)
    parser.add_argument('--fixture-sources-sha256', required=True)
    parser.add_argument('--editor-pid', type=int, required=True)
    parser.add_argument('--execute-native98', action='store_true', help='Only use after Root final execution release')
    return parser.parse_args()


def main():
    args = arguments()
    require(args.execute_native98, 'Preparation only. No native action without explicit --execute-native98 after Root release')
    ledger_path = args.evidence / 'test-execution-ledger.json'
    require(not ledger_path.exists(), 'No retry/resume: execution ledger already exists')
    contract, fixtures, cases, cursor = verify_inputs(args)
    for index, fixture in enumerate(fixtures, 1):
        stem = f'run-{index:02d}-' + re.sub('[^A-Za-z0-9_-]', '_', fixture)
        for suffix in ('.stdout.txt', '.stderr.txt', '.invocation.json'):
            require(not (args.evidence / (stem + suffix)).exists(), 'Previous invocation evidence exists')
    ledger = {'policy': 'Exactly once per canonical fixture; raw coverage before verdict; stop first error; no retry/resume',
        'source': args.source, 'candidateSourceRole': contract.get('sourceSha'), 'project': str(args.project),
        'editorPid': args.editor_pid, 'contractSha256': args.contract_sha256,
        'fixtureSourcesSha256': args.fixture_sources_sha256, 'expectedCaseCount': 98,
        'status': 'NOT_STARTED', 'completedFixtureTypes': [], 'passedFixtureTypes': [],
        'executedFullNames': [], 'skippedFullNames': [], 'notYetInvokedFullNames': [x['fullName'] for x in cases],
        'unrunFullNames': [x['fullName'] for x in cases], 'unresolvedCurrentFixtureFullNames': [], 'groups': []}
    write_json(ledger_path, ledger)
    for index, fixture in enumerate(fixtures, 1):
        group = None
        try:
            cursor = console_since(args, f'pre-{index:02d}-console', cursor)
            target_status(args, f'run-{index:02d}-target')
            expected = sorted(x['fullName'] for x in cases if x['fixtureType'] == fixture)
            argv = ['unity', 'command', 'test', 'run', '--project-path', str(args.project),
                '--caller', 'plugin', '--skill', 'unity-cli', '--format', 'json', '--timeout', '60',
                '--', '--mode', 'editor', '--filter', fixture, '--timeout', '60']
            group = {'fixtureType': fixture, 'expectedFullNames': expected, 'state': 'IN_FLIGHT', 'argv': argv}
            ledger['groups'].append(group)
            ledger['status'] = 'RUNNING'
            ledger['unresolvedCurrentFixtureFullNames'] = expected
            write_json(ledger_path, ledger, new=False)
            stem = f'run-{index:02d}-' + re.sub('[^A-Za-z0-9_-]', '_', fixture)
            raw = run_raw(args.evidence, stem, argv)
            group.update({k: v for k, v in raw.items() if k not in ('stdout', 'stderr')})
            group['state'] = 'RETURNED'
            data = None
            try:
                data = record_coverage(ledger, group, raw['stdout'], cases, fixtures)
            except Exception as error:
                group['accountingError'] = str(error)
                group['executionStatus'] = 'UNKNOWN_RAW_COVERAGE'
            # Coverage remains recorded even when verdict or later console checks fail.
            write_json(ledger_path, ledger, new=False)
            require(data is not None and 'accountingError' not in group, 'Raw accounting failed')
            summary = validate_verdict(data, group, raw)
            cursor = console_since(args, f'post-{index:02d}-console', cursor)
            group.update(state='PASS', verdict='PASS', summary=summary)
            ledger['passedFixtureTypes'].append(fixture)
            ledger['status'] = 'PASS' if index == len(fixtures) else 'RUNNING'
            write_json(ledger_path, ledger, new=False)
            print(f'{fixture}: PASS {len(expected)}/{len(expected)}', flush=True)
        except Exception as error:
            if group is not None:
                group.update(state='STOPPED', verdict='FAIL', validationError=str(error))
            ledger['status'] = 'STOPPED_ON_FIRST_ERROR'
            ledger['stopReason'] = str(error)
            write_json(ledger_path, ledger, new=False)
            print('STOPPED_ON_FIRST_ERROR: ' + str(error), flush=True)
            return 1
    print('PASS:98 exact cases passed once; no retries', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
