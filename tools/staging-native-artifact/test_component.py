"""Explicitly synthetic ELF/HTTP/toolchain facts. No Rust, database or native process is run."""
import copy
import io
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

import component as c


def synthetic_elf():
    ident = b'\x7fELF\x02\x01\x01' + bytes(9)
    header = struct.pack('<HHIQQQIHHHHHH', 2, 62, 1, 0x400078, 64, 0, 0, 64, 56, 1, 64, 0, 0)
    segment = struct.pack('<IIQQQQQQ', 1, 5, 0, 0x400000, 0, 128, 128, 4096)
    return ident + header + segment + b'TESTONLY'


def fixture(binary):
    return {'format': 'rh-native-component/1', 'component': 'rh-server-postgres-release', 'deployable': False,
            'source': {'commit': '1' * 40, 'tree': '2' * 40, 'optimization_port_tip': '3' * 40,
                       'harness_commit': '4' * 40, 'cargo_lock_sha256': '5' * 64, 'rust_toolchain_sha256': '6' * 64},
            'build': {'target': c.TARGET, 'profile': 'release', 'features': ['postgres'], 'locked': True, 'release_debug': '0',
                      'rust_toolchain': '1.97.0', 'rustc_vv': 'rustc 1.97.0 (SYNTHETIC)\nrelease: 1.97.0\nhost: ' + c.TARGET + '\n',
                      'cargo_vv': 'cargo 1.97.0 (SYNTHETIC)\n', 'libc': 'glibc 2.39'},
            'binary': {'path': 'bin/rh-server', 'bytes': len(binary), 'sha256': c.sha(binary), 'elf': c.elf(binary)},
            'readiness': {'profile': 'core-readiness-only', 'info': {'protocol': 14, 'contentHash': 'a' * 16,
                           'rooms': 0, 'lobbies': 0, 'maxRooms': 1, 'players': 0, 'state': 'ready', 'resultsOk': 0,
                           'resultsFailed': 0, 'resultsRefused': 0, 'closedRooms': []},
                          'readyz': {'ok': True, 'state': 'ready', 'storage': 'ok'}, 'healthz': 'ok',
                          'db_rows': {name: 0 for name in c.TABLES}, 'postgres_version': '16.9 (SYNTHETIC)',
                          'elapsed_ms': 100, 'exit_code': 0}}


class Component(unittest.TestCase):
    def setUp(self):
        self.binary = synthetic_elf()
        self.manifest = fixture(self.binary)
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def repack(self, mutate=None, manifest=None):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, data, mode in ((c.MEMBERS[0], self.binary, 0o755),
                                     (c.MEMBERS[1], manifest if manifest is not None else c.canonical(self.manifest), 0o644)):
                item = tarfile.TarInfo(name); item.size = len(data); item.mode = mode
                if mutate: mutate(item)
                archive.addfile(item, io.BytesIO(data))
        return stream.getvalue()

    def test_deterministic_archive_contains_only_canonical_component_and_binary(self):
        path = self.root / 'rh-server'; path.write_bytes(self.binary); path.chmod(0o755)
        (self.root / 'private-unrelated.txt').write_text('SYNTHETIC_PRIVATE_DO_NOT_PACKAGE')
        first, second = self.root / 'one.tar', self.root / 'two.tar'
        c.write_component(path, self.manifest, first)
        os.utime(path, (12345, 12345)); path.chmod(0o700)
        c.write_component(path, self.manifest, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(c.inspect_archive(first.read_bytes()), self.manifest)
        self.assertNotIn(b'SYNTHETIC_PRIVATE_DO_NOT_PACKAGE', first.read_bytes())
        with self.assertRaises(FileExistsError): c.write_component(path, self.manifest, first)
        with tarfile.open(first) as archive:
            for item, mode in zip(archive.getmembers(), (0o755, 0o644)):
                self.assertEqual((item.uid, item.gid, item.mtime, item.mode, item.uname, item.gname), (0, 0, 0, mode, '', ''))

    def test_wrong_machine_script_headers_entry_segment_and_truncation_refuse(self):
        cases = [b'#!/bin/sh\ntrue\n', self.binary[:20]]
        for offset, layout, value in ((18, '<H', 183), (16, '<H', 1), (24, '<Q', 0), (32, '<Q', 99999),
                                      (54, '<H', 1), (72, '<Q', 999999), (96, '<Q', 999999)):
            data = bytearray(self.binary); struct.pack_into(layout, data, offset, value); cases.append(bytes(data))
        for index, data in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(c.Refused): c.elf(data)

    def test_regular_input_symlink_ancestor_hardlink_nonexecutable_and_size_refuse(self):
        path = self.root / 'server'; path.write_bytes(self.binary); path.chmod(0o755)
        link = self.root / 'alias'; link.symlink_to(path)
        with self.assertRaises(OSError): c.read_regular(link, c.MAX_BINARY, True)
        directory = self.root / 'dir'; directory.mkdir(); (directory / 'server').write_bytes(self.binary)
        alias = self.root / 'alias-dir'; alias.symlink_to(directory, target_is_directory=True)
        with self.assertRaises(OSError): c.read_regular(alias / 'server', c.MAX_BINARY)
        hard = self.root / 'hard'; os.link(path, hard)
        with self.assertRaises(c.Refused): c.read_regular(path, c.MAX_BINARY)
        hard.unlink(); path.chmod(0o600)
        with self.assertRaises(c.Refused): c.read_regular(path, c.MAX_BINARY, True)
        with self.assertRaises(c.Refused): c.read_regular(path, 20)

    def test_manifest_unknown_secret_like_fields_forged_source_and_build_refuse(self):
        cases = [lambda x: x.update(credentials='SYNTHETIC'), lambda x: x.update(deployable=True),
                 lambda x: x['source'].update(commit='HEAD'), lambda x: x['source'].update(tree='A' * 40),
                 lambda x: x['source'].update(cargo_lock_sha256=''), lambda x: x['build'].update(profile='debug'),
                 lambda x: x['build'].update(features=['postgres', 'bench']), lambda x: x['build'].update(locked=False),
                 lambda x: x['build'].update(target='aarch64-unknown-linux-gnu'), lambda x: x['build'].update(release_debug='1'),
                 lambda x: x['build'].update(rustc_vv='rustc SYNTHETIC'), lambda x: x['build'].update(cargo_vv='cargo https://secret'),
                 lambda x: x['binary'].update(sha256='0' * 64), lambda x: x['binary'].update(bytes=True),
                 lambda x: x['binary'].update(path='../server')]
        for index, mutate in enumerate(cases):
            with self.subTest(index=index):
                manifest = copy.deepcopy(self.manifest); mutate(manifest)
                with self.assertRaises(c.Refused): c.archive_bytes(self.binary, manifest)

    def test_observed_non_postgres_nonready_accounts_rooms_results_or_failed_stop_refuse(self):
        cases = [lambda x: x['readiness']['readyz'].update(storage='memory'), lambda x: x['readiness']['readyz'].update(ok=1),
                 lambda x: x['readiness']['info'].update(state='draining'), lambda x: x['readiness']['info'].update(protocol=True),
                 lambda x: x['readiness']['info'].update(contentHash='PLACEHOLDER'), lambda x: x['readiness']['info'].update(players=1),
                 lambda x: x['readiness']['info'].update(rooms=1), lambda x: x['readiness']['info'].update(resultsOk=1),
                 lambda x: x['readiness']['db_rows'].update(profiles=1), lambda x: x['readiness']['db_rows'].update(matches=False),
                 lambda x: x['readiness'].update(exit_code=-9), lambda x: x['readiness'].update(elapsed_ms=60001),
                 lambda x: x['readiness'].update(postgres_version='unknown'), lambda x: x['readiness'].update(extra='unreviewed')]
        for index, mutate in enumerate(cases):
            with self.subTest(index=index):
                manifest = copy.deepcopy(self.manifest); mutate(manifest)
                with self.assertRaises(c.Refused): c.archive_bytes(self.binary, manifest)

    def test_links_traversal_duplicate_extra_and_noncanonical_archive_metadata_refuse(self):
        cases = [lambda m: setattr(m, 'name', '../' + m.name), lambda m: setattr(m, 'name', '/absolute'),
                 lambda m: setattr(m, 'type', tarfile.SYMTYPE), lambda m: setattr(m, 'type', tarfile.LNKTYPE),
                 lambda m: setattr(m, 'name', 'duplicate'), lambda m: setattr(m, 'uid', 1000),
                 lambda m: setattr(m, 'mtime', 1), lambda m: setattr(m, 'mode', 0o777)]
        for index, mutate in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(c.Refused): c.inspect_archive(self.repack(mutate))
        stream = io.BytesIO(self.repack())
        with tarfile.open(fileobj=stream, mode='a') as archive:
            item = tarfile.TarInfo('private-extra'); item.size = 1; archive.addfile(item, io.BytesIO(b'x'))
        with self.assertRaises(c.Refused): c.inspect_archive(stream.getvalue())

    def test_corruption_truncated_padding_trailing_bytes_duplicate_json_and_pretty_json_refuse(self):
        data = self.repack()
        changed = bytearray(data); changed[512 + 125] ^= 1
        cases = [data[:-512], data[:800], data + b'EXTRA', bytes(changed), b'not-tar']
        for index, archive in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(c.Refused): c.inspect_archive(archive)
        for raw in (b'{"format":"x","format":"x"}\n', json.dumps(self.manifest, indent=2).encode()):
            with self.assertRaises(c.Refused): c.inspect_archive(self.repack(manifest=raw))


if __name__ == '__main__': unittest.main()
