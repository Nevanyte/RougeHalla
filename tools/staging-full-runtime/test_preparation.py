"""Cheap local contracts only. Synthetic headers/receipts are NOT actual binary or AWS proof."""
import copy
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


p = load('preparation', 'prepare.py')
launcher = load('launcher', 'run-runtime.py')
archive = load('archive', 'backup_archive.py')
NOW = dt.datetime(2026, 11, 9, 12, tzinfo=dt.timezone.utc)


class Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        def artifact(name, data):
            data = data if isinstance(data, bytes) else json.dumps(data).encode()
            (self.root / name).write_bytes(data)
            return {'path': name, 'sha256': hashlib.sha256(data).hexdigest()}
        # Header-shaped test bytes only; root must supply a real immutable runtime validation receipt.
        elf = b'\x7fELF\x02\x01' + bytes(12) + b'\xb7\x00'
        server = artifact('server', elf)
        caddy = artifact('caddy', elf)
        source = artifact('source.map.json', {'format': 'rh-map/2', 'map': {'coliseum': {}}})
        index = artifact('index.html', b'PUBLIC TEST HTML')
        web = artifact('web.json', {'source_commit': p.BASE, 'default_ws_path': '/ws',
            'training_ws_path': '/training/ws', 'account_origin': 'https://rougehalla.com', 'files': [index]})
        native = artifact('native.json', {'source_commit': p.BASE, 'postgres_feature': True,
            'server_sha256': server['sha256'], 'source_map_sha256': source['sha256'],
            'source_map_validated_by_actual_binary': True, 'training_one_human_no_fill_no_results': True})
        self.plan = {'format': 'rh-calgary-preparation/1', 'account': p.ACCOUNT, 'region': p.REGION,
            'domain': 'rougehalla.com', 'source_commit': p.BASE, 'run_id': '20261109t120000z-abcdef',
            'prepared_at': NOW.isoformat(), 'host_expires_at': (NOW + dt.timedelta(hours=4)).isoformat(),
            'data_delete_by': (NOW + dt.timedelta(days=3)).isoformat(), 'runtime_seconds': 3600,
            'identity': {'account': p.ACCOUNT, 'region': p.REGION, 'checked_at': NOW.isoformat()},
            'resource_plan': {'account': p.ACCOUNT, 'region': p.REGION, 'checked_at': NOW.isoformat(),
                'reviewed_empty_or_owned': True, 'receipt_sha256': '1' * 64, 'cleanup_owner': 'TEST', 'cleanup_plan_sha256': '7' * 64},
            'budget': {'checked_at': NOW.isoformat(), 'account': p.ACCOUNT, 'currency': 'CAD',
                'authorized_total_cad': '20', 'credits_expand_cap': False, 'cost_receipt_sha256': '2' * 64,
                'fx_source': 'SYNTHETIC TEST ONLY', 'fx_checked_at': NOW.isoformat(), 'cad_per_usd': '2',
                'existing_gross_usd': '1', 'new_all_in_usd_reserve': '2', 'other_staging_gross_cad': '1',
                'tax_and_lag_margin_cad': '1', 'priced_components': ['compute', 'ipv4', 'root_ebs',
                    'data_ebs_retention', 'egress', 'artifact_requests_storage', 'backup_requests_versions_storage', 'cleanup_margin']},
            'compute': {'ami_id': 'ami-1234567890abcdef0', 'ami_owner': '099720109477', 'architecture': 'arm64', 'availability_zone': 'ca-west-1a',
                'instance_type': 't4g.small', 'cpu_credits': 'standard', 'root_gib': 8, 'data_gib': 8,
                'sizing_receipt_sha256': '3' * 64, 'price_receipt_sha256': '4' * 64,
                'price_checked_at': NOW.isoformat(), 'sizing_checked_at': NOW.isoformat()},
            'backup': {'encryption': 'age', 'public_recipient': 'age1' + 'a' * 58,
                'restore_receipt_sha256': '5' * 64, 'transfer_plan_sha256': '6' * 64, 'owner': 'TEST',
                'delete_by': (NOW + dt.timedelta(days=3)).isoformat(), 'lifecycle_days': 1},
            'artifacts': {'server': server, 'caddy': caddy, 'source_map': source, 'web_manifest': web, 'native_validation': native}}

    def test_complete_local_input_math_is_not_deployment_authorization(self):
        self.assertEqual(p.validate(self.plan, self.root, NOW)['reviewed_total_reserve_cad'], '8')
        dest = self.root / 'review'
        p.render(dest, 3600)
        self.assertFalse(json.loads((dest / 'ACTIVATION-HOLD.json').read_text())['deployable'])
        self.assertIn('poweroff', p.template()['Resources']['Host']['Properties']['UserData']['Fn::Base64'])
        self.assertIn('RuntimeMaxSec=3600', (dest / 'rougehalla-source.service').read_text())
        with self.assertRaises(FileExistsError):
            p.render(dest)

    def test_actual_frozen_native_configuration_is_pinned(self):
        root = HERE.parents[1]
        pins = json.loads((HERE / 'native-pins.json').read_text())
        self.assertEqual(pins['source_commit'], p.BASE)
        for path, digest in pins['files'].items():
            self.assertEqual(hashlib.sha256((root / path).read_bytes()).hexdigest(), digest, path)

    def test_missing_wrong_stale_cost_credit_and_over_total_refuse(self):
        cases = [lambda x: x.update(account='961470857356'), lambda x: x.update(region='ca-central-1'),
            lambda x: x.update(domain='play.roguehalla.com'), lambda x: x.update(identity={}),
            lambda x: x.update(resource_plan={}), lambda x: x['budget'].update(existing_gross_usd=None),
            lambda x: x['budget'].update(credits_expand_cap=True), lambda x: x['budget'].update(currency='USD'),
            lambda x: x['budget'].update(existing_gross_usd='10'), lambda x: x['budget'].update(cad_per_usd='NaN'),
            lambda x: x['budget'].update(priced_components=[]), lambda x: x['budget'].update(fx_checked_at='2026-11-01T00:00:00Z'),
            lambda x: x['compute'].update(price_checked_at='2026-11-01T00:00:00Z')]
        for mutate in cases:
            with self.subTest(mutate=mutate):
                plan = copy.deepcopy(self.plan); mutate(plan)
                with self.assertRaises(p.Refused): p.validate(plan, self.root, NOW)

    def test_deadlines_data_backup_sizes_and_old_binary_refuse(self):
        cases = [lambda x: x.update(data_delete_by=x['host_expires_at']), lambda x: x.update(runtime_seconds=14400),
            lambda x: x.update(host_expires_at=(NOW + dt.timedelta(hours=5)).isoformat()),
            lambda x: x['backup'].update(restore_receipt_sha256=None), lambda x: x['backup'].update(lifecycle_days=7),
            lambda x: x['backup'].update(public_recipient=''), lambda x: x['compute'].update(data_gib=0),
            lambda x: x['compute'].update(ami_id=''), lambda x: x['compute'].update(cpu_credits='unlimited'),
            lambda x: x.update(source_commit='a' * 40)]
        for mutate in cases:
            plan = copy.deepcopy(self.plan); mutate(plan)
            with self.assertRaises(p.Refused): p.validate(plan, self.root, NOW)

    def test_artifact_replacement_path_and_incomplete_map_refuse(self):
        (self.root / 'server').write_bytes(b'changed')
        with self.assertRaises(p.Refused): p.validate(self.plan, self.root, NOW)
        for path in ['/tmp/foreign', '../foreign']:
            with self.assertRaises(p.Refused): p.verified_artifact({'path': path, 'sha256': 'a' * 64}, self.root)
        (self.root / 'link').symlink_to(self.root / 'index.html')
        with self.assertRaises(p.Refused): p.verified_artifact({'path': 'link', 'sha256': self.plan['artifacts']['server']['sha256']}, self.root)

    def test_hash_bound_collision_map_and_wrong_web_origin_are_not_accepted(self):
        def rehash(key):
            item = self.plan['artifacts'][key]
            item['sha256'] = hashlib.sha256((self.root / item['path']).read_bytes()).hexdigest()
        native_path = self.root / self.plan['artifacts']['native_validation']['path']
        source = self.root / 'source.map.json'
        source.write_text(json.dumps({'format': 'collision-only', 'map': {}}))
        rehash('source_map')
        native = json.loads(native_path.read_text())
        native['source_map_sha256'] = self.plan['artifacts']['source_map']['sha256']
        native_path.write_text(json.dumps(native)); rehash('native_validation')
        with self.assertRaises(p.Refused): p.validate(self.plan, self.root, NOW)
        source.write_text(json.dumps({'format': 'rh-map/2', 'map': {'coliseum': {}}})); rehash('source_map')
        native['source_map_sha256'] = self.plan['artifacts']['source_map']['sha256']
        native_path.write_text(json.dumps(native)); rehash('native_validation')
        web_path = self.root / self.plan['artifacts']['web_manifest']['path']
        web = json.loads(web_path.read_text()); web['account_origin'] = 'https://play.roguehalla.com'
        web_path.write_text(json.dumps(web)); rehash('web_manifest')
        with self.assertRaises(p.Refused): p.validate(self.plan, self.root, NOW)

    def test_runtime_commands_use_actual_profiles_and_shared_postgres_only(self):
        source = launcher.command('source', 'PUBLIC_TEST_URL', '20261109t120000z-abcdef')
        training = launcher.command('training', 'PUBLIC_TEST_URL', '20261109t120000z-abcdef')
        for args in (source, training):
            self.assertNotIn('--first-playable', args); self.assertNotIn('--auth', args)
            self.assertEqual(args[args.index('--database-url') + 1], 'PUBLIC_TEST_URL')
            self.assertEqual(args[args.index('--bot-learning') + 1], 'off')
            self.assertEqual(args[args.index('--fill-bots') + 1], '0')
        self.assertEqual(source[source.index('--runtime') + 1], 'source-arena')
        self.assertIn('--map', source); self.assertIn('--result-spool', source)
        self.assertNotIn('--map', training); self.assertNotIn('--result-spool', training)
        self.assertEqual(training[training.index('--max-rooms') + 1], '1')
        self.assertNotEqual(source[source.index('--instance-id') + 1], training[training.index('--instance-id') + 1])

    def test_cfn_scope_and_retention_are_explicit(self):
        t = p.template(); resources = t['Resources']
        self.assertEqual(sum(x['Type'] == 'AWS::EC2::Instance' for x in resources.values()), 1)
        self.assertFalse(any(x['Type'].startswith('AWS::IAM::') for x in resources.values()))
        self.assertNotIn('IamInstanceProfile', resources['Host']['Properties'])
        ingress = resources['WebSecurityGroup']['Properties']['SecurityGroupIngress']
        self.assertEqual([x['FromPort'] for x in ingress], [80, 443])
        for key in ('DataVolume', 'BackupBucket'):
            self.assertEqual(resources[key]['DeletionPolicy'], 'Retain')
            self.assertEqual(resources[key]['UpdateReplacePolicy'], 'Retain')
        self.assertTrue(resources['DataVolume']['Properties']['Encrypted'])
        self.assertNotIn('DeletionPolicy', resources['Host'])


class Backup(unittest.TestCase):
    def make_archive(self, root, mutate=None):
        files = {'database.dump': b'DECLARED TEST DUMP', 'spool-source/pending.json': b'DECLARED TEST PENDING'}
        manifest = {'format': 'rh-staging-cold-backup/1', 'quiesced': True,
            'files': [{'path': k, 'sha256': hashlib.sha256(v).hexdigest()} for k, v in files.items()]}
        files['manifest.json'] = json.dumps(manifest).encode()
        with tarfile.open(root / 'plaintext.tar', 'w') as t:
            directory = tarfile.TarInfo('spool-source'); directory.type = tarfile.DIRTYPE; t.addfile(directory)
            for name, data in files.items():
                info = tarfile.TarInfo(name); info.size = len(data); t.addfile(info, io.BytesIO(data))
            if mutate: mutate(t)

    def test_real_extractor_preserves_required_pending_and_dump(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_archive(root); archive.extract(root)
            self.assertEqual((root / 'spool-source/pending.json').read_bytes(), b'DECLARED TEST PENDING')
            self.assertEqual((root / 'database.dump').read_bytes(), b'DECLARED TEST DUMP')

    def test_traversal_link_duplicate_unmanifested_are_refused_before_extract(self):
        def evil(t):
            i = tarfile.TarInfo('../outside'); i.size = 1; t.addfile(i, io.BytesIO(b'x'))
        def link(t):
            i = tarfile.TarInfo('spool-source/link'); i.type = tarfile.SYMTYPE; i.linkname = '/etc'; t.addfile(i)
        def duplicate(t):
            i = tarfile.TarInfo('database.dump'); i.size = 1; t.addfile(i, io.BytesIO(b'x'))
        def extra(t):
            i = tarfile.TarInfo('spool-source/unlisted'); i.size = 1; t.addfile(i, io.BytesIO(b'x'))
        for mutate in (evil, link, duplicate, extra):
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp); self.make_archive(root, mutate)
                with self.assertRaises(ValueError): archive.extract(root)
                self.assertFalse((root / 'database.dump').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
