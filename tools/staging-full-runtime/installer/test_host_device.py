"""Synthetic Linux facts only. No real host, block device, tool or cloud probe is executed."""
import contextlib
import copy
import io
import json
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import host_device as h

UUID = '12345678-1234-4234-8234-123456789abc'
WRONG_UUID = '00000000-1234-4234-8234-123456789abc'
SERIAL = 'vol0123456789abcdef0'
EXPECTED = {'id': 'vol-0123456789abcdef0', 'uuid': UUID,
            'filesystem': 'ext4', 'mountpoint': h.MOUNT}


def node(name, kind, parents=(), filesystem=None, uuid=None, serial=None):
    return {'kname': name, 'type': kind, 'parents': list(parents),
            'fstype': filesystem, 'uuid': uuid, 'serial': serial}


class SyntheticLinux:
    """In-memory fake kernel/sysfs/lsblk/blkid; never delegates to the machine."""
    def __init__(self):
        self.nodes = {
            '259:0': node('nvme0n1', 'disk', serial='vol00000000000000000'),
            '259:1': node('nvme0n1p1', 'part', ['259:0'], 'ext4', WRONG_UUID),
            '259:2': node('nvme1n1', 'disk', serial=SERIAL),
            '259:3': node('nvme1n1p1', 'part', ['259:2'], 'ext4', UUID)}
        self.kernel_parents = {mm: n['parents'][:] for mm, n in self.nodes.items()}
        self.kernel_serials = {mm: n['serial'] for mm, n in self.nodes.items()}
        self.root, self.data = '259:1', '259:3'
        self.root_source, self.data_source = '/dev/root', '/dev/disk/by-label/different-alias'
        self.platform, self.mounted = 'linux', True
        self.symlinks, self.calls = set(), []
        self.actual_uuid, self.actual_type = UUID, 'ext4'
        self.mount_override, self.lsblk_override = None, None
        self.stat_override, self.read_override = {}, {}
        self.mount_reads, self.change_second = 0, False
        self.fail_command = False

    def system(self):
        return self.platform

    def path(self, mm):
        n = self.nodes[mm]
        if n['type'] == 'part':
            return self.path(n['parents'][0]) + '/' + n['kname']
        return '/sys/devices/SYNTHETIC/' + n['kname']

    def mounts(self):
        result = f'24 1 {self.root} / / rw,relatime - ext4 {self.root_source} rw\n'
        if self.mounted:
            result += f'25 24 {self.data} / {h.MOUNT} rw,relatime - ext4 {self.data_source} rw\n'
        return result

    def lsblk(self):
        rows = []
        for mm, n in self.nodes.items():
            for parent in n['parents'] or [None]:
                rows.append({'name': '/dev/' + n['kname'], 'kname': '/dev/' + n['kname'],
                             'maj:min': mm, 'type': n['type'], 'fstype': n['fstype'],
                             'uuid': n['uuid'], 'serial': n['serial'],
                             'pkname': '/dev/' + self.nodes[parent]['kname'] if parent else None})
        return {'blockdevices': rows}

    def read(self, path):
        self.calls.append(('read', path))
        if path in self.read_override:
            return self.read_override[path]
        if path == '/proc/self/mountinfo':
            self.mount_reads += 1
            return (self.mount_override if self.mount_override is not None else self.mounts()) + (
                '26 24 0:42 / /unrelated rw - tmpfs tmpfs rw\n'
                if self.change_second and self.mount_reads > 1 else '')
        for mm, n in self.nodes.items():
            base = '/sys/dev/block/' + mm
            if path in (base + '/dev', self.path(mm) + '/dev'):
                return mm + '\n'
            if path == base + '/partition' and n['type'] == 'part':
                return '1\n'
            if path == base + '/device/serial':
                return self.kernel_serials[mm] + '\n'
        raise FileNotFoundError('synthetic absent kernel attribute')

    def entries(self, path):
        self.calls.append(('entries', path))
        mm = path.removeprefix('/sys/dev/block/').removesuffix('/slaves')
        return sorted(self.nodes[p]['kname'] for p in self.kernel_parents[mm])

    def realpath(self, path):
        self.calls.append(('realpath', path))
        mm, _, slave = path.removeprefix('/sys/dev/block/').partition('/slaves/')
        if slave:
            return next(self.path(p) for p in self.kernel_parents[mm] if self.nodes[p]['kname'] == slave)
        return self.path(mm)

    def lstat(self, path):
        self.calls.append(('lstat', path))
        if path in self.stat_override:
            return self.stat_override[path]
        if path in self.symlinks:
            return {'mode': stat.S_IFLNK | 0o777, 'inode': 1, 'dev': self.root, 'rdev': '0:0'}
        if path in ('/', '/srv', h.MOUNT):
            return {'mode': stat.S_IFDIR | 0o755, 'inode': len(path),
                    'dev': self.data if path == h.MOUNT and self.mounted else self.root, 'rdev': '0:0'}
        for mm, n in self.nodes.items():
            if path == '/dev/' + n['kname']:
                return {'mode': stat.S_IFBLK | 0o600, 'inode': 1, 'dev': '0:1', 'rdev': mm}
        raise FileNotFoundError('synthetic missing device')

    def mount_directories(self):
        return {path: self.lstat(path) for path in ('/', '/srv', h.MOUNT)}

    def run(self, argv):
        self.calls.append(('run', argv))
        if self.fail_command:
            raise subprocess.CalledProcessError(2, argv)
        if argv == h.LSBLK:
            return json.dumps(self.lsblk_override if self.lsblk_override is not None else self.lsblk())
        if argv == (*h.BLKID, '/dev/' + self.nodes[self.data]['kname']):
            return (f'DEVNAME={argv[-1]}\nUUID={self.actual_uuid}\nTYPE={self.actual_type}\n'
                    'USAGE=filesystem\n')
        raise AssertionError('collector attempted a non-allowlisted synthetic probe')

    def mapped(self, mm, name, parents):
        self.nodes[mm] = node(name, 'lvm', parents, 'ext4', UUID)
        self.kernel_parents[mm] = list(parents)


class DeviceCollector(unittest.TestCase):
    def test_dedicated_partition_collects_observed_identity_and_all_ancestors(self):
        probe = SyntheticLinux()
        result = h.collect_and_validate(EXPECTED, probe)
        self.assertEqual(result['root_device'], '259:1')  # /dev/root source alias resolved by kernel identity.
        self.assertEqual(result['mounted_device'], '259:3')
        self.assertEqual(result['root_physical_ancestors'], ['259:0'])
        self.assertEqual(result['data_physical_ancestors'], ['259:2'])
        self.assertEqual(result['uuid'], UUID)
        self.assertEqual(result['ebs_serial'], SERIAL)
        self.assertEqual(result['devices']['259:3']['parents'], ['259:2'])
        self.assertEqual(result['probe_mode'], 'injected')
        for flag in ('installed', 'deployable', 'physical_attestation'):
            self.assertIs(result[flag], False)
        self.assertEqual([value for kind, value in probe.calls if kind == 'run'],
                         [h.LSBLK, (*h.BLKID, '/dev/nvme1n1p1')] * 2)
        for path in ('/proc/self/mountinfo', '/sys/dev/block/259:2/device/serial'):
            self.assertIn(('read', path), probe.calls)

    def test_dedicated_whole_device_and_mapped_targets(self):
        for mapped in (False, True):
            with self.subTest(mapped=mapped):
                probe = SyntheticLinux()
                if mapped:
                    probe.mapped('253:0', 'dm-0', ['259:3'])
                    probe.data = '253:0'
                else:
                    probe.data = '259:2'
                    probe.nodes[probe.data].update(fstype='ext4', uuid=UUID)
                result = h.collect_and_validate(EXPECTED, probe)
                self.assertEqual(result['data_physical_ancestors'], ['259:2'])

    def test_nested_lsblk_tree_and_kernel_parent_edges_agree(self):
        probe = SyntheticLinux()
        rows = probe.lsblk()['blockdevices']
        rows[0]['children'] = [rows[1]]
        rows[2]['children'] = [rows[3]]
        probe.lsblk_override = {'blockdevices': [rows[0], rows[2]]}
        self.assertEqual(h.collect_and_validate(EXPECTED, probe)['mounted_device'], probe.data)

    def test_root_alias_same_partition_different_partition_and_whole_disk_refuse(self):
        for case in ('same-partition', 'different-label-and-partition', 'root-whole-device'):
            with self.subTest(case=case):
                probe = SyntheticLinux()
                if case == 'same-partition':
                    probe.root = probe.data
                elif case == 'different-label-and-partition':
                    probe.nodes[probe.data]['parents'] = ['259:0']
                    probe.kernel_parents[probe.data] = ['259:0']
                else:
                    probe.root = '259:2'
                with self.assertRaisesRegex(h.Refused, 'physical root overlap'):
                    h.collect_and_validate(EXPECTED, probe)

    def test_lvm_root_checks_every_slave_not_just_first_parent(self):
        probe = SyntheticLinux()
        probe.mapped('253:0', 'dm-0', ['259:1', '259:3'])
        probe.root = '253:0'
        with self.assertRaisesRegex(h.Refused, 'physical root overlap'):
            h.collect_and_validate(EXPECTED, probe)
        self.assertIn(('realpath', '/sys/dev/block/253:0/slaves/nvme1n1p1'), probe.calls)

    def test_dedicated_data_with_mapped_root_is_supported(self):
        probe = SyntheticLinux()
        probe.mapped('253:0', 'dm-0', ['259:1'])
        probe.root = '253:0'
        result = h.collect_and_validate(EXPECTED, probe)
        self.assertEqual(result['root_physical_ancestors'], ['259:0'])
        self.assertEqual(result['devices']['253:0']['parents'], ['259:1'])

    def test_multi_disk_root_reports_all_ancestors_and_multi_disk_data_refuses(self):
        for target in ('root', 'data'):
            with self.subTest(target=target):
                probe = SyntheticLinux()
                probe.nodes['259:4'] = node('nvme2n1', 'disk', serial='vol11111111111111111')
                probe.kernel_parents['259:4'] = []
                probe.kernel_serials['259:4'] = 'vol11111111111111111'
                probe.mapped('253:0', 'dm-0', ['259:1' if target == 'root' else '259:3', '259:4'])
                if target == 'root':
                    probe.root = '253:0'
                    self.assertEqual(h.collect_and_validate(EXPECTED, probe)['root_physical_ancestors'],
                                     ['259:0', '259:4'])
                else:
                    probe.data = '253:0'
                    with self.assertRaisesRegex(h.Refused, 'one dedicated EBS ancestor'):
                        h.collect_and_validate(EXPECTED, probe)

    def test_collected_uuid_must_match_both_probes_and_expected_uuid(self):
        for case in ('lsblk-only', 'blkid-only', 'both-wrong'):
            with self.subTest(case=case):
                probe = SyntheticLinux()
                if case != 'blkid-only': probe.nodes[probe.data]['uuid'] = WRONG_UUID
                if case != 'lsblk-only': probe.actual_uuid = WRONG_UUID
                reason = 'UUID mismatch' if case == 'both-wrong' else 'filesystem identity disagree'
                with self.assertRaisesRegex(h.Refused, reason): h.collect_and_validate(EXPECTED, probe)
                self.assertTrue(any(kind == 'run' and value[0] == h.BLKID[0] for kind, value in probe.calls))

    def test_collected_kernel_and_lsblk_serials_are_independent_checks(self):
        for case in ('kernel-only', 'lsblk-only', 'both-wrong'):
            with self.subTest(case=case):
                probe = SyntheticLinux()
                if case != 'lsblk-only': probe.kernel_serials['259:2'] = 'volfffffffffffffffff'
                if case != 'kernel-only': probe.nodes['259:2']['serial'] = 'volfffffffffffffffff'
                with self.assertRaisesRegex(h.Refused, 'NVMe EBS serial mismatch'):
                    h.collect_and_validate(EXPECTED, probe)

    def test_unmounted_readonly_wrong_fstype_and_bind_mount_refuse(self):
        for case in ('unmounted', 'readonly', 'wrong-fstype', 'bind-subdir', 'stacked'):
            with self.subTest(case=case):
                probe = SyntheticLinux()
                if case == 'unmounted': probe.mounted = False
                elif case == 'readonly': probe.mount_override = probe.mounts().replace('rw,relatime', 'ro,relatime')
                elif case == 'wrong-fstype': probe.mount_override = probe.mounts().replace('- ext4', '- btrfs')
                elif case == 'bind-subdir': probe.mount_override = probe.mounts().replace(' / ' + h.MOUNT, ' /subdir ' + h.MOUNT)
                else: probe.mount_override = probe.mounts() + probe.mounts().splitlines()[1] + '\n'
                with self.assertRaises(h.Refused): h.collect_and_validate(EXPECTED, probe)

    def test_each_mount_ancestor_symlink_and_stat_device_mismatch_refuse(self):
        for path in ('/', '/srv', h.MOUNT):
            with self.subTest(path=path):
                probe = SyntheticLinux(); probe.symlinks.add(path)
                with self.assertRaisesRegex(h.Refused, 'symlink-free directory'):
                    h.collect_and_validate(EXPECTED, probe)
        probe = SyntheticLinux()
        probe.stat_override[h.MOUNT] = {'mode': stat.S_IFDIR | 0o755, 'inode': 1, 'dev': '259:0', 'rdev': '0:0'}
        with self.assertRaisesRegex(h.Refused, 'mount stat identity mismatch'): h.collect_and_validate(EXPECTED, probe)

    def test_ambiguous_missing_unsupported_and_disagreeing_device_graphs_refuse(self):
        for case in ('duplicate', 'missing-mounted', 'unsupported', 'kernel-disagrees', 'partition-missing', 'block-node-alias'):
            with self.subTest(case=case):
                probe = SyntheticLinux()
                if case == 'duplicate':
                    graph = probe.lsblk(); other = copy.deepcopy(graph['blockdevices'][-1]); other['uuid'] = WRONG_UUID
                    graph['blockdevices'].append(other); probe.lsblk_override = graph
                elif case == 'missing-mounted':
                    graph = probe.lsblk(); graph['blockdevices'].pop(); probe.lsblk_override = graph
                elif case == 'unsupported': probe.nodes['259:2']['type'] = 'raid1'
                elif case == 'kernel-disagrees': probe.kernel_parents['259:2'] = ['259:0']
                elif case == 'partition-missing': probe.nodes[probe.data]['type'] = 'lvm'
                else:
                    probe.stat_override['/dev/nvme1n1p1'] = {'mode': stat.S_IFBLK | 0o600, 'rdev': '259:1'}
                with self.assertRaises(h.Refused): h.collect_and_validate(EXPECTED, probe)

    def test_cycle_and_missing_mapped_slave_refuse(self):
        probe = SyntheticLinux()
        probe.mapped('253:0', 'dm-0', ['253:1']); probe.mapped('253:1', 'dm-1', ['253:0'])
        probe.root = '253:0'
        with self.assertRaisesRegex(h.Refused, 'cyclic/deep'): h.collect_and_validate(EXPECTED, probe)
        probe = SyntheticLinux(); probe.mapped('253:0', 'dm-0', []); probe.root = '253:0'
        with self.assertRaisesRegex(h.Refused, 'mapped device ancestry missing'): h.collect_and_validate(EXPECTED, probe)

    def test_mount_change_between_snapshots_and_probe_failure_refuse(self):
        probe = SyntheticLinux(); probe.change_second = True
        with self.assertRaisesRegex(h.Refused, 'snapshot changed'): h.collect_and_validate(EXPECTED, probe)
        probe = SyntheticLinux(); probe.fail_command = True
        with self.assertRaisesRegex(h.Refused, 'incomplete or unsupported'): h.collect_and_validate(EXPECTED, probe)

    def test_invalid_expected_contract_cannot_override_observed_facts(self):
        for key, value in (('id', 'vol-fffffffffffffffff'), ('uuid', WRONG_UUID), ('filesystem', 'xfs'),
                           ('mountpoint', '/srv/elsewhere'), ('uuid', 'not-a-uuid')):
            with self.subTest(key=key, value=value):
                expected = dict(EXPECTED); expected[key] = value
                with self.assertRaises(h.Refused): h.collect_and_validate(expected, SyntheticLinux())

    def test_mac_and_unknown_platform_refuse_before_any_probe(self):
        for platform in ('darwin', 'unknown'):
            probe = SyntheticLinux(); probe.platform = platform
            with self.assertRaisesRegex(h.Refused, 'Linux-only'): h.collect_and_validate(EXPECTED, probe)
            self.assertEqual(probe.calls, [])
        with patch.object(h.sys, 'platform', 'darwin'), patch.object(h.LinuxProbe, 'run') as run:
            with self.assertRaises(h.Refused): h.collect_and_validate(EXPECTED)
            run.assert_not_called()

    def test_cli_collects_then_refuses_actual_uuid_mismatch_without_success_output(self):
        probe = SyntheticLinux(); probe.nodes[probe.data]['uuid'] = probe.actual_uuid = WRONG_UUID
        out, err = io.StringIO(), io.StringIO()
        with patch.object(h, 'LinuxProbe', return_value=probe), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(h.main(['--volume-id', EXPECTED['id'], '--uuid', UUID]), 2)
        self.assertEqual(out.getvalue(), '')
        self.assertIn('UUID mismatch', err.getvalue())
        self.assertIn(('run', h.LSBLK), probe.calls)

    def test_native_adapter_uses_only_fixed_argv_no_shell_and_readonly_lowlevel_blkid(self):
        probe = h.LinuxProbe()
        with patch.object(probe, 'trusted_tool') as trusted, patch.object(h.subprocess, 'run',
                return_value=SimpleNamespace(stdout='SYNTHETIC', stderr='')) as run:
            for argv in (h.LSBLK, (*h.BLKID, '/dev/nvme1n1p1')):
                self.assertEqual(probe.run(argv), 'SYNTHETIC')
                self.assertEqual(run.call_args.args, (argv,))
                self.assertIs(run.call_args.kwargs['shell'], False)
                self.assertEqual(run.call_args.kwargs['timeout'], 5)
                self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
                self.assertEqual(run.call_args.kwargs['env']['LC_ALL'], 'C')
                trusted.assert_called_with(argv[0])
            for argv in (('/bin/sh', '-c', 'true'), ('lsblk',), (*h.BLKID, '/dev/../unsafe'),
                         ('/usr/sbin/blkid', '-w', '/tmp/cache')):
                with self.assertRaises(h.Refused): probe.run(argv)
            self.assertEqual(run.call_count, 2)

    def test_native_mount_walk_uses_readonly_nofollow_directory_descriptors_and_closes(self):
        info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_ino=1, st_dev=0, st_rdev=0)
        probe = h.LinuxProbe()
        with patch.object(h.os, 'open', side_effect=[10, 11, 12]) as opened, \
                patch.object(h.os, 'fstat', return_value=info), patch.object(h.os, 'close') as closed:
            self.assertEqual(set(probe.mount_directories()), {'/', '/srv', h.MOUNT})
            self.assertEqual([call.args[0] for call in opened.call_args_list], ['/', 'srv', 'rougehalla-data'])
            self.assertEqual([call.kwargs['dir_fd'] for call in opened.call_args_list], [None, 10, 11])
            for call in opened.call_args_list:
                flags = call.args[1]
                self.assertTrue(flags & h.os.O_NOFOLLOW)
                self.assertTrue(flags & h.os.O_DIRECTORY)
                self.assertFalse(flags & (h.os.O_WRONLY | h.os.O_RDWR | h.os.O_CREAT | h.os.O_TRUNC))
            self.assertEqual([call.args[0] for call in closed.call_args_list], [12, 11, 10])
        with patch.object(h.os, 'open', side_effect=[10, OSError('synthetic symlink refusal')]), \
                patch.object(h.os, 'fstat', return_value=info), patch.object(h.os, 'close') as closed:
            with self.assertRaises(OSError): probe.mount_directories()
            closed.assert_called_once_with(10)

    def test_tool_paths_require_root_owned_unwritable_symlink_free_components(self):
        def clean():
            return [SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o755) for _ in range(3)] + [
                SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o755)]
        probe = h.LinuxProbe()
        with patch.object(h.Path, 'lstat', side_effect=clean()) as checked:
            probe.trusted_tool('/usr/bin/lsblk')
            self.assertEqual(checked.call_count, 4)
        for kind in ('foreign-owner', 'writable-ancestor', 'leaf-symlink', 'ancestor-symlink'):
            rows = clean()
            if kind == 'foreign-owner': rows[-1].st_uid = 1000
            elif kind == 'writable-ancestor': rows[1].st_mode |= 0o020
            else: rows[-1 if kind == 'leaf-symlink' else 1].st_mode = stat.S_IFLNK | 0o777
            with self.subTest(kind=kind), patch.object(h.Path, 'lstat', side_effect=rows):
                with self.assertRaises(h.Refused): probe.trusted_tool('/usr/bin/lsblk')


if __name__ == '__main__':
    unittest.main()
