"""New offline safety controls only. Synthetic facts/bytes; never real host/AWS/PG/producer success."""
import copy
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

from contract import Refused, validate, role_template, render, expiry_units, UTC, strict_json
from foundation import run_foundation, check_deadline, check_volume
from host_material import material, pg_role_input
from transfer import get_command, inspect_bundle, verify_download, put_ciphertext_command, verify_put_response

NOW = dt.datetime(2000, 1, 1, tzinfo=UTC)
RUN = '20000101t000000z-abcdef'


def plan():
    return {'format': 'rh-staging-installer-candidate/1', 'account': '048226733033', 'region': 'ca-west-1',
        'domain': 'rougehalla.com', 'run_id': RUN, 'prepared_at': '2000-01-01T00:00:00Z',
        'host_expires_at': '2000-01-01T04:00:00Z', 'mode': 'fresh', 'previous_run_id': None,
        'volume': {'id': 'vol-00000000000000001', 'uuid': '00000000-0000-0000-0000-000000000001',
                   'filesystem': 'ext4', 'mountpoint': '/srv/rougehalla-data'},
        'artifact': {'bucket': 'rh-synthetic-artifacts', 'key': 'runs/'+RUN+'/public-bundle.tar',
                     'version_id': 'synthetic-version', 'bytes': 1, 'sha256': '0'*64},
        'backup': {'bucket': 'rh-synthetic-backup', 'key': 'runs/'+RUN+'/cold-backup.age', 'max_bytes': 1048576},
        'toolchain_receipt_sha256': '1'*64, 'boundary_receipt_sha256': '2'*64, 'backup_seconds': 300}


def facts(p):
    return {'ebs_serial': p['volume']['id'].replace('-', ''), 'uuid': p['volume']['uuid'], 'filesystem': 'ext4',
        'device': '/dev/nvme1n1', 'root_device': '/dev/nvme0n1', 'mounted_device': '/dev/nvme1n1',
        'mountpoint': '/srv/rougehalla-data', 'writable': True, 'owned_run_id': RUN}


def bundle(path, extra=None):
    # Public synthetic fixture, NOT an ELF/map/browser or actual native validation receipt.
    body = b'SYNTHETIC PUBLIC UNIT FIXTURE'
    manifest = {'format': 'rh-installer-public-bundle/1', 'run_id': RUN,
        'files': [{'path': 'unit/fixture.txt', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}]}
    with tarfile.open(path, 'w', format=tarfile.USTAR_FORMAT) as output:
        for name, data in [('unit/fixture.txt', body), ('manifest.json', json.dumps(manifest).encode())]:
            member = tarfile.TarInfo(name); member.size = len(data); output.addfile(member, io.BytesIO(data))
        if extra:
            member, data = extra
            output.addfile(member, io.BytesIO(data))
    p = plan(); p['artifact']['bytes'] = path.stat().st_size; p['artifact']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    return p


class SimulatedOperations:
    """Control-flow simulator; cannot install services, format/mount, create a completion marker, or contact AWS."""
    def __init__(self, p, path):
        self.p, self.path, self.calls = p, path, []
        self.volume = facts(p)
    def install_fixed_expiry(self, p):
        self.calls.append('expiry')
        return {'format': 'rh-fixed-host-deadline/1', 'run_id': p['run_id'], 'expires_at': p['host_expires_at']}
    def inspect_volume(self): self.calls.append('volume'); return self.volume
    def lock_stopped_writers(self, p): self.calls.append('writers')
    def download_exact_version(self, command):
        self.calls.append('download')
        return self.path, {'VersionId': self.p['artifact']['version_id'], 'ContentLength': self.path.stat().st_size,
            'ContentRange': 'bytes 0-'+str(self.path.stat().st_size-1)+'/'+str(self.path.stat().st_size)}


class InstallerTests(unittest.TestCase):
    def test_wrong_scope_unbound_keys_and_unknown_inputs_refuse_before_any_operation(self):
        mutations = [('account', '000000000000'), ('region', 'us-east-1'), ('domain', 'roguehalla.com'),
                     ('prepared_at', '2000-01-01T00:00:00'), ('host_expires_at', '2000-01-01T05:00:00Z')]
        for key, value in mutations:
            p = plan(); p[key] = value
            with self.subTest(key=key), self.assertRaises(Refused): validate(p, NOW)
        for key in ['artifact', 'backup']:
            p = plan(); p[key]['key'] = 'runs/foreign/*'
            with self.subTest(key=key), self.assertRaises(Refused): validate(p, NOW)
        p = plan(); p['secret'] = 'not-a-plan-field'
        with self.assertRaises(Refused): validate(p, NOW)
        with self.assertRaises(Refused): strict_json('{"account":"a","account":"b"}')

    def test_expired_or_renewed_deadline_never_restarts_the_clock(self):
        p = plan(); recorded = json.loads(expiry_units(p)['deadline.json'])
        with self.assertRaises(Refused): check_deadline(p, recorded, NOW+dt.timedelta(hours=4))
        later = copy.deepcopy(p); later['host_expires_at'] = '2000-01-01T04:01:00Z'
        with self.assertRaises(Refused): check_deadline(later, recorded, NOW)
        self.assertEqual(expiry_units(p), expiry_units(copy.deepcopy(p)))

    def test_blank_unknown_root_or_foreign_volume_is_never_formatted_or_downloaded(self):
        p = plan()
        for key, bad in [('ebs_serial', 'volforeign'), ('uuid', ''), ('filesystem', ''), ('device', '/dev/nvme0n1'),
                         ('mounted_device', '/dev/other'), ('mountpoint', '/'), ('owned_run_id', 'foreign')]:
            observed = facts(p); observed[key] = bad
            with self.subTest(key=key), self.assertRaises(Refused): check_volume(p, observed)
        p['volume']['uuid'] = None
        with self.assertRaises(Refused): validate(p, NOW)

    def test_foundation_order_stops_short_of_host_installation_and_never_emits_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'fixture.tar'; p = bundle(path); ops = SimulatedOperations(p, path)
            result = run_foundation(p, ops, lambda: NOW)
            self.assertEqual(ops.calls, ['expiry', 'volume', 'writers', 'download'])
            self.assertEqual(result['stage'], 'artifact-verified-not-installed')
            self.assertFalse(result['installed']); self.assertFalse(result['deployable'])
            self.assertFalse(list(Path(tmp).rglob('installation-verified.json')))
            ops = SimulatedOperations(p, path); ops.volume['uuid'] = ''
            with self.assertRaises(Refused): run_foundation(p, ops, lambda: NOW)
            self.assertEqual(ops.calls, ['expiry', 'volume'])

    def test_deadline_expiring_during_download_refuses_even_valid_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'fixture.tar'; p = bundle(path); ops = SimulatedOperations(p, path)
            times = iter([NOW]*4+[NOW+dt.timedelta(hours=4)])
            with self.assertRaises(Refused): run_foundation(p, ops, lambda: next(times))
            self.assertEqual(ops.calls[-1], 'download')

    def test_policy_has_only_exact_version_get_and_exact_create_ciphertext_put(self):
        p = plan(); t = role_template(p)
        self.assertEqual(set(t['Resources']), {'RunTransferRole', 'RunTransferProfile'})
        role = t['Resources']['RunTransferRole']['Properties']
        statements = role['Policies'][0]['PolicyDocument']['Statement']
        self.assertEqual([s['Action'] for s in statements], ['s3:GetObjectVersion', 's3:PutObject'])
        for statement in statements:
            self.assertNotIn('*', statement['Resource'])
            self.assertIn('/runs/'+RUN+'/', statement['Resource'])
            self.assertEqual(statement['Condition']['DateLessThan']['aws:CurrentTime'], p['host_expires_at'])
        self.assertEqual(statements[0]['Condition']['StringEquals']['s3:VersionId'], p['artifact']['version_id'])
        self.assertEqual(statements[1]['Condition']['StringEquals']['s3:if-none-match'], '*')
        self.assertNotIn('ManagedPolicyArns', role)
        self.assertFalse(t['Metadata']['Deployable'])

    def test_download_command_and_real_local_bytes_refuse_substitution_partial_or_foreign_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'fixture.tar'; p = bundle(path); cmd = get_command(p)
            self.assertIn('--range', cmd); self.assertIn(p['artifact']['version_id'], cmd)
            _, meta = SimulatedOperations(p, path).download_exact_version(cmd)
            verify_download(p, path, meta)
            for key in ['VersionId', 'ContentLength', 'ContentRange']:
                bad = dict(meta); bad[key] = 'wrong'
                with self.subTest(key=key), self.assertRaises(Refused): verify_download(p, path, bad)
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaises(Refused): verify_download(p, path, meta)

    def test_archive_link_traversal_duplicate_special_and_unmanifested_members_refuse_without_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'fixture.tar'
            for name, kind in [('../escape', tarfile.REGTYPE), ('unit/fixture.txt', tarfile.REGTYPE),
                               ('unknown', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('fifo', tarfile.FIFOTYPE)]:
                member = tarfile.TarInfo(name); member.type = kind; member.size = 0; member.linkname = 'unit/fixture.txt'
                bundle(path, (member, b''))
                with self.subTest(name=name), self.assertRaises(Refused): inspect_bundle(path, RUN)
            bundle(path)
            with self.assertRaises(Refused): inspect_bundle(path, 'foreign')
            self.assertFalse((Path(tmp)/'unit').exists())

    def test_only_bounded_ciphertext_envelope_produces_conditional_checksum_put_not_restore_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'unit.age'
            path.write_bytes(b'age-encryption.org/v1\nSYNTHETIC UNIT ENVELOPE, NOT ENCRYPTED PRODUCER PROOF')
            checksum = hashlib.sha256(path.read_bytes()).hexdigest()
            cmd = put_ciphertext_command(plan(), path, checksum)
            self.assertIn('--if-none-match', cmd); self.assertIn('--checksum-sha256', cmd)
            with self.assertRaises(Refused): put_ciphertext_command(plan(), path, '0'*64)
            with self.assertRaises(Refused): verify_put_response(plan(), {'VersionId': 'v'}, checksum)
            receipt = verify_put_response(plan(), {'VersionId': 'v', 'ChecksumSHA256': cmd[cmd.index('--checksum-sha256')+1]}, checksum)
            self.assertFalse(receipt['offhost_restore_proved'])
            path.write_bytes(b'plaintext')
            with self.assertRaises(Refused): put_ciphertext_command(plan(), path, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_render_is_new_directory_only_and_expiry_script_is_syntax_checked_never_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'review'; render(plan(), output)
            hold = json.loads((output/'ACTIVATION-HOLD.json').read_text())
            self.assertFalse(hold['deployable']); self.assertFalse(hold['host_installed'])
            with self.assertRaises(FileExistsError): render(plan(), output)
            result = subprocess.run(['bash', '-n', str(output/'expiry-first.review.sh')], capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn('get-object', (output/'expiry-first.review.sh').read_text())

    def test_pg_role_material_is_private_stdin_not_a_superuser_or_restored_account_seed(self):
        sql = pg_role_input('a'*64)
        self.assertIn('scram-sha-256', sql); self.assertIn('NOSUPERUSER', sql); self.assertIn('OWNER rougehalla', sql)
        self.assertNotIn('profiles', sql); self.assertNotIn('ALTER ROLE', sql)
        with self.assertRaises(Refused): pg_role_input("not-a-private-runtime-hex-secret")
        p = plan(); p['mode'] = 'restore'; p['previous_run_id'] = '19991231t230000z-abcdef'
        validate(p, NOW)
        body = json.loads(material(p)['remaining-host-contract.json'])
        self.assertFalse(body['restore_continuation']['start_services'])
        self.assertIn('shared', body['postgres']['shared_account_lease_database'])

    def test_actual_cli_refuses_blank_plan_without_rendering_or_any_host_operation(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'should-not-exist'
            result = subprocess.run(['python3', str(Path(__file__).with_name('contract.py')), 'render-review',
                '--plan', str(Path(__file__).with_name('plan.unverified.json')), '--out', str(out)], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(out.exists())
            self.assertIn(b'no deployment or host action', result.stderr)


if __name__ == '__main__':
    unittest.main()
