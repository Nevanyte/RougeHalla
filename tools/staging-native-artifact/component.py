"""Strict, deterministic native component archive. Structural integrity is not deployment authorization."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import tarfile

TARGET = 'x86_64-unknown-linux-gnu'
MAX_BINARY = 128 * 1024 * 1024
MAX_MANIFEST = 32768
MEMBERS = ('bin/rh-server', 'component.json')
TABLES = ('profiles', 'session_leases', 'matches', 'match_results', 'gv_ledger', 'gv_by_month', 'purchases')
INFO_KEYS = {'protocol', 'contentHash', 'rooms', 'lobbies', 'maxRooms', 'players', 'state',
             'resultsOk', 'resultsFailed', 'resultsRefused', 'closedRooms'}


class Refused(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys.split()), 'unexpected/missing manifest fields')


def hex_string(value, length):
    require(type(value) is str and re.fullmatch('[0-9a-f]{' + str(length) + '}', value), 'exact lowercase identity required')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False) + '\n').encode()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(Refused('nonfinite JSON')))


def read_regular(path, limit, executable=False):
    path = Path(path).absolute()
    handles = []
    try:
        current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        handles.append(current)
        for part in path.parts[1:-1]:
            require(part not in ('.', '..'), 'noncanonical input path')
            current = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            handles.append(current)
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current)
        handles.append(fd)
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= limit,
                'bounded single-link regular file required')
        require(not executable or info.st_mode & 0o111, 'executable mode required')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) == info.st_size, 'file changed while reading')
        return data
    finally:
        for fd in reversed(handles): os.close(fd)


def elf(data):
    require(type(data) is bytes and 120 <= len(data) <= MAX_BINARY, 'bounded ELF executable required')
    require(data[:7] == b'\x7fELF\x02\x01\x01' and data[7] in (0, 3) and data[8:16] == bytes(8),
            'Linux/SystemV little-endian ELF64 required')
    kind, machine, version, entry, phoff, _shoff, flags, ehsize, phsize, count = struct.unpack_from('<HHIQQQIHHH', data, 16)
    require(kind in (2, 3) and machine == 62 and version == 1 and flags == 0 and ehsize == 64
            and phsize == 56 and 0 < count <= 128 and phoff >= 64 and phoff + count * phsize <= len(data),
            'invalid x86_64 ELF program headers')
    executable_entry = False
    interpreter = None
    for index in range(count):
        ptype, pflags, offset, address, _physical, size, memory, alignment = struct.unpack_from('<IIQQQQQQ', data, phoff + index * phsize)
        require(offset + size <= len(data) and (alignment in (0, 1) or alignment & (alignment - 1) == 0),
                'ELF segment outside file')
        if ptype == 1:
            require(memory >= size, 'ELF load segment truncated')
            executable_entry |= bool(pflags & 1 and address <= entry < address + memory)
        if ptype == 3:
            require(interpreter is None and data[offset:offset + size] == b'/lib64/ld-linux-x86-64.so.2\0',
                    'unsupported ELF interpreter')
            interpreter = '/lib64/ld-linux-x86-64.so.2'
    require(executable_entry, 'ELF entry is not in an executable load segment')
    return {'class': 64, 'endianness': 'little', 'machine': 62, 'type': kind, 'interpreter': interpreter}


def validate_info(info, ready, rows):
    shape(info, ' '.join(INFO_KEYS))
    require(type(info['protocol']) is int and 0 < info['protocol'] <= 65535, 'invalid observed protocol')
    hex_string(info['contentHash'], 16)
    require(info['state'] == 'ready' and info['closedRooms'] == [] and type(info['maxRooms']) is int
            and info['maxRooms'] == 1, 'unexpected readiness runtime state')
    for key in ('rooms', 'lobbies', 'players', 'resultsOk', 'resultsFailed', 'resultsRefused'):
        require(type(info[key]) is int and info[key] == 0, 'readiness must have no rooms/players/results')
    require(ready == {'ok': True, 'state': 'ready', 'storage': 'ok'} and type(ready.get('ok')) is bool,
            'actual PostgreSQL readiness required')
    require(type(rows) is dict and set(rows) == set(TABLES)
            and all(type(n) is int and n == 0 for n in rows.values()), 'fresh database must have zero account/result rows')


def validate_manifest(manifest, binary):
    shape(manifest, 'format component deployable source build binary readiness')
    require(manifest['format'] == 'rh-native-component/1' and manifest['component'] == 'rh-server-postgres-release'
            and manifest['deployable'] is False, 'component only; not a deployable bundle')
    source = manifest['source']; shape(source, 'commit tree optimization_port_tip harness_commit cargo_lock_sha256 rust_toolchain_sha256')
    for key in ('commit', 'tree', 'optimization_port_tip', 'harness_commit'): hex_string(source[key], 40)
    for key in ('cargo_lock_sha256', 'rust_toolchain_sha256'): hex_string(source[key], 64)
    build = manifest['build']; shape(build, 'target profile features locked release_debug rust_toolchain rustc_vv cargo_vv libc')
    require(build['target'] == TARGET and build['profile'] == 'release' and build['features'] == ['postgres']
            and build['locked'] is True and build['release_debug'] == '0' and type(build['rust_toolchain']) is str
            and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', build['rust_toolchain']), 'exact locked release build required')
    for key, prefix in (('rustc_vv', 'rustc '), ('cargo_vv', 'cargo ')):
        value = build[key]
        require(type(value) is str and len(value) <= 8192 and value.isascii() and value.startswith(prefix)
                and '\x00' not in value and '://' not in value, 'bounded nonsecret toolchain identity required')
    require('\nrelease: ' + build['rust_toolchain'] + '\n' in build['rustc_vv']
            and '\nhost: ' + TARGET + '\n' in build['rustc_vv'], 'toolchain/host mismatch')
    require(type(build['libc']) is str and re.fullmatch(r'glibc [0-9]+\.[0-9]+', build['libc']), 'actual GNU libc identity required')
    item = manifest['binary']; shape(item, 'path bytes sha256 elf')
    require(item['path'] == MEMBERS[0] and type(item['bytes']) is int and item['bytes'] == len(binary)
            and item['sha256'] == sha(binary) and item['elf'] == elf(binary), 'binary identity mismatch')
    probe = manifest['readiness']; shape(probe, 'profile info readyz healthz db_rows postgres_version elapsed_ms exit_code')
    validate_info(probe['info'], probe['readyz'], probe['db_rows'])
    require(probe['profile'] == 'core-readiness-only' and probe['healthz'] == 'ok'
            and type(probe['elapsed_ms']) is int and 0 <= probe['elapsed_ms'] <= 60000
            and type(probe['exit_code']) is int and probe['exit_code'] == 0
            and type(probe['postgres_version']) is str and re.fullmatch(r'16\.[0-9]+(?: \([^\n]{1,120}\))?', probe['postgres_version']),
            'bounded real PostgreSQL16 readiness/clean stop required')
    require(len(canonical(manifest)) <= MAX_MANIFEST, 'manifest exceeds bound')


def archive_bytes(binary, manifest):
    validate_manifest(manifest, binary)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, data, mode in ((MEMBERS[0], binary, 0o755), (MEMBERS[1], canonical(manifest), 0o644)):
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(data), mode
            member.uid = member.gid = member.mtime = 0
            member.uname = member.gname = ''
            archive.addfile(member, io.BytesIO(data))
    return stream.getvalue()


def _inspect_archive(data):
    require(type(data) is bytes and len(data) <= MAX_BINARY + 1024 * 1024, 'archive exceeds bound')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        members = archive.getmembers()
        require(tuple(m.name for m in members) == MEMBERS and all(m.isreg() for m in members),
                'exact regular binary and manifest only; no links/extra/traversal')
        require(0 < members[0].size <= MAX_BINARY and 0 < members[1].size <= MAX_MANIFEST, 'archive member exceeds bound')
        binary = archive.extractfile(members[0]).read()
        raw = archive.extractfile(members[1]).read()
        manifest = strict_json(raw)
        require(raw == canonical(manifest), 'manifest must be canonical')
        validate_manifest(manifest, binary)
    require(data == archive_bytes(binary, manifest), 'noncanonical/truncated/trailing archive bytes')
    return manifest


def inspect_archive(data):
    try:
        return _inspect_archive(data)
    except (tarfile.TarError, UnicodeError, json.JSONDecodeError):
        raise Refused('malformed/truncated native component') from None


def write_component(binary_path, manifest, output):
    binary = read_regular(binary_path, MAX_BINARY, executable=True)
    data = archive_bytes(binary, manifest)
    inspect_archive(data)
    output = Path(output)
    require(output.parent == output.parent.resolve(strict=True), 'symlinked output parent refused')
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    return {'sha256': sha(data), 'bytes': len(data), 'deployable': False}
