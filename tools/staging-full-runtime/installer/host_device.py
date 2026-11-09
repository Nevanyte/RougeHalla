#!/usr/bin/env python3
"""Read-only Linux retained-device collector; never formats, mounts or installs anything.

Only already-mounted ext4 on one dedicated EBS NVMe ancestor is supported.
This is a current mount-namespace observation, not cloud/physical attestation,
ownership verification, a held device lock, or an installer completion marker.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid

MOUNT = '/srv/rougehalla-data'
LSBLK = ('/usr/bin/lsblk', '--json', '--tree', '--paths', '--output',
         'NAME,KNAME,MAJ:MIN,TYPE,PKNAME,FSTYPE,UUID,SERIAL')
BLKID = ('/usr/sbin/blkid', '-p', '-o', 'export')  # Low-level read-only probe; no cache update.
LIMIT = 4 * 1024 * 1024
MAX_DEVICES = 256


class Refused(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def identity(value):
    require(type(value) is str and re.fullmatch(r'(0|[1-9][0-9]*):(0|[1-9][0-9]*)', value),
            'invalid canonical block identity')
    require(all(int(x) < 2 ** 32 for x in value.split(':')), 'block identity out of bounds')
    return value


def kernel_name(value):
    require(type(value) is str, 'missing kernel device name')
    value = value.removeprefix('/dev/')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', value), 'unsafe kernel device name')
    return value


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON field')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


class LinuxProbe:
    """The CLI's only adapter: bounded file reads/stat and two fixed read-only tools."""
    def system(self):
        return sys.platform

    def read(self, path):
        with open(path, encoding='utf-8') as stream:
            value = stream.read(LIMIT + 1)
        require(len(value) <= LIMIT, 'kernel read exceeds bound')
        return value

    def entries(self, path):
        result = sorted(os.listdir(path))
        require(len(result) <= MAX_DEVICES, 'device directory exceeds bound')
        return result

    def realpath(self, path):
        return os.path.realpath(path, strict=True)

    def lstat(self, path):
        info = os.lstat(path)
        return self.stat_fields(info)

    @staticmethod
    def stat_fields(info):
        return {'mode': info.st_mode, 'inode': info.st_ino,
                'dev': f'{os.major(info.st_dev)}:{os.minor(info.st_dev)}',
                'rdev': f'{os.major(info.st_rdev)}:{os.minor(info.st_rdev)}'}

    def mount_directories(self):
        # Walk held directory descriptors: no intermediate symlink can be followed.
        handles, result = [], {}
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            for path in ('/', '/srv', MOUNT):
                handle = os.open('/' if path == '/' else Path(path).name, flags,
                                 dir_fd=handles[-1] if handles else None)
                handles.append(handle)
                result[path] = self.stat_fields(os.fstat(handle))
            return result
        finally:
            for handle in reversed(handles):
                os.close(handle)

    def trusted_tool(self, executable):
        # No PATH lookup or writable/symlinked executable/ancestor fallback.
        path = Path(executable)
        for component in [*reversed(path.parents), path]:
            info = component.lstat()
            require(info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted tool ownership/mode')
            require(stat.S_ISREG(info.st_mode) and bool(info.st_mode & 0o111) if component == path
                    else stat.S_ISDIR(info.st_mode), 'tool path must be canonical and symlink-free')

    def run(self, argv):
        allowed = argv == LSBLK or (len(argv) == len(BLKID) + 1 and argv[:-1] == BLKID
                    and argv[-1] == '/dev/' + kernel_name(argv[-1]))
        require(allowed, 'non-allowlisted probe command')
        self.trusted_tool(argv[0])
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True, timeout=5, shell=False,
                                cwd='/', env={'LC_ALL': 'C', 'PATH': '/usr/bin:/usr/sbin'},
                                encoding='utf-8')
        require(len(result.stdout) <= LIMIT and not result.stderr, 'probe output refused')
        return result.stdout


def parse_mounts(text):
    mounts = {}
    for line in text.splitlines():
        fields = line.split()
        require(len(fields) >= 10 and fields.count('-') == 1, 'malformed kernel mount table')
        split = fields.index('-')
        require(split >= 6 and len(fields) == split + 4, 'malformed kernel mount fields')
        # Exact known paths contain no mountinfo escapes; other mounts are not interpreted.
        if fields[4] not in ('/', MOUNT):
            continue
        target = fields[4]
        require(target not in mounts, 'ambiguous stacked mount')
        require(fields[3] == '/', 'bind/subdirectory mount refused')
        mounts[target] = {'identity': identity(fields[2]), 'filesystem': fields[split + 1],
                          'source': fields[split + 2], 'options': fields[5].split(','),
                          'super_options': fields[split + 3].split(',')}
    require(set(mounts) == {'/', MOUNT}, 'exact retained mount and block root required')
    require(mounts['/']['filesystem'] in ('ext4', 'xfs'), 'unsupported root filesystem')
    require(mounts[MOUNT]['filesystem'] == 'ext4' and 'rw' in mounts[MOUNT]['options']
            and 'ro' not in mounts[MOUNT]['options'] and 'rw' in mounts[MOUNT]['super_options']
            and 'ro' not in mounts[MOUNT]['super_options'], 'retained mount must be writable ext4')
    return mounts


def parse_lsblk(text):
    value = strict_json(text)
    require(type(value) is dict and set(value) == {'blockdevices'} and type(value['blockdevices']) is list,
            'lsblk graph shape')
    nodes, parents, pknames = {}, {}, {}
    keys = {'name', 'kname', 'maj:min', 'type', 'pkname', 'fstype', 'uuid', 'serial'}

    def visit(row, parent=None, depth=0):
        require(depth <= 32 and type(row) is dict and set(row) in (keys, keys | {'children'}),
                'unsupported lsblk node shape/depth')
        mm = identity(row['maj:min'])
        normalized = {key: row[key] for key in keys - {'pkname'}}
        normalized['kname'] = kernel_name(row['kname'])
        require(type(row['name']) is str and row['name'].startswith('/dev/')
                and '..' not in row['name'].split('/'), 'invalid lsblk alias')
        require(all(row[key] is None or type(row[key]) is str for key in ('fstype', 'uuid', 'serial')),
                'invalid lsblk metadata')
        require(row['type'] in ('disk', 'part', 'lvm', 'crypt'), 'unsupported block device type')
        require(mm not in nodes or nodes[mm] == normalized, 'ambiguous duplicate block identity')
        nodes[mm] = normalized
        require(len(nodes) <= MAX_DEVICES, 'device graph exceeds bound')
        parents.setdefault(mm, set())
        pknames.setdefault(mm, set())
        if parent is not None:
            parents[mm].add(parent)
        if row['pkname'] is not None:
            pknames[mm].add(kernel_name(row['pkname']))
        children = row.get('children', [])
        require(type(children) is list, 'invalid lsblk children')
        for child in children:
            visit(child, mm, depth + 1)

    for row in value['blockdevices']:
        visit(row)
    names = {node['kname']: mm for mm, node in nodes.items()}
    require(len(names) == len(nodes), 'ambiguous kernel device names')
    for mm, names_for_node in pknames.items():
        for name in names_for_node:
            require(name in names, 'lsblk parent missing')
            parents[mm].add(names[name])
    return nodes, parents


def collect_graph(probe, nodes, parents, starts):
    observed, visiting = {}, set()

    def visit(mm, depth=0):
        require(depth <= 32 and mm not in visiting, 'cyclic/deep device graph')
        if mm in observed:
            return
        require(mm in nodes, 'mounted device missing from lsblk graph')
        visiting.add(mm)
        node = nodes[mm]
        base = '/sys/dev/block/' + mm
        resolved = probe.realpath(base)
        require(resolved.startswith('/sys/devices/') and Path(resolved).name == node['kname']
                and '..' not in Path(resolved).parts, 'kernel device path mismatch')
        require(identity(probe.read(base + '/dev').strip()) == mm, 'sysfs canonical identity mismatch')
        device = '/dev/' + node['kname']
        info = probe.lstat(device)
        require(stat.S_ISBLK(info['mode']) and identity(info['rdev']) == mm,
                'canonical device node mismatch')
        try:
            partition = probe.read(base + '/partition').strip()
        except FileNotFoundError:
            partition = None
        serial = None
        if partition is not None:
            require(node['type'] == 'part' and re.fullmatch('[1-9][0-9]*', partition),
                    'partition metadata mismatch')
            edges = {identity(probe.read(str(Path(resolved).parent / 'dev')).strip())}
        else:
            require(node['type'] != 'part', 'kernel partition metadata missing')
            edges = set()
            for slave in probe.entries(base + '/slaves'):
                kernel_name(slave)
                child = probe.realpath(base + '/slaves/' + slave)
                require(child.startswith('/sys/devices/') and Path(child).name == slave,
                        'invalid kernel slave path')
                edges.add(identity(probe.read(child + '/dev').strip()))
            if node['type'] == 'disk':
                require(not edges, 'physical disk has unexpected slave devices')
                if re.fullmatch(r'nvme[0-9]+n[0-9]+', node['kname']):
                    serial = probe.read(base + '/device/serial').strip()
            else:
                require(node['kname'].startswith('dm-') and edges, 'mapped device ancestry missing')
        require(edges == parents[mm], 'kernel and lsblk ancestry disagree')
        observed[mm] = {'kname': node['kname'], 'type': node['type'], 'parents': sorted(edges),
                        'kernel_path': resolved, 'kernel_serial': serial, 'lsblk_serial': node['serial']}
        for parent in sorted(edges):
            require(node['type'] != 'part' or nodes.get(parent, {}).get('type') == 'disk',
                    'unsupported partition parent')
            visit(parent, depth + 1)
        visiting.remove(mm)

    for mm in starts:
        visit(mm)
    return observed


def collect_snapshot(probe):
    mount_text = probe.read('/proc/self/mountinfo')
    mounts = parse_mounts(mount_text)
    directories = probe.mount_directories()
    for path in ('/', '/srv', MOUNT):
        info = directories[path]
        require(stat.S_ISDIR(info['mode']), 'mount path/ancestor must be a symlink-free directory')
    for path in ('/', MOUNT):
        require(identity(directories[path]['dev']) == mounts[path]['identity'], 'mount stat identity mismatch')
    lsblk_text = probe.run(LSBLK)
    nodes, parents = parse_lsblk(lsblk_text)
    graph = collect_graph(probe, nodes, parents, [mounts['/']['identity'], mounts[MOUNT]['identity']])
    data = mounts[MOUNT]['identity']
    blkid_text = probe.run((*BLKID, '/dev/' + nodes[data]['kname']))
    metadata = {}
    for line in blkid_text.splitlines():
        key, separator, value = line.partition('=')
        require(separator and key not in metadata, 'ambiguous low-level filesystem metadata')
        metadata[key] = value
    require(metadata.get('DEVNAME') == '/dev/' + nodes[data]['kname']
            and metadata.get('UUID') == nodes[data]['uuid']
            and metadata.get('TYPE') == nodes[data]['fstype'] == 'ext4'
            and metadata.get('USAGE') == 'filesystem', 'blkid and lsblk filesystem identity disagree')
    return {'mount_text': mount_text, 'lsblk_text': lsblk_text, 'blkid_text': blkid_text,
            'mounts': mounts, 'directories': directories, 'graph': graph,
            'uuid': metadata['UUID'], 'filesystem': metadata['TYPE']}


def validate_snapshot(expected, snapshot):
    require(type(expected) is dict and set(expected) == {'id', 'uuid', 'filesystem', 'mountpoint'},
            'exact expected volume contract required')
    require(type(expected['id']) is str and re.fullmatch('vol-[0-9a-f]{17}', expected['id']), 'known EBS ID required')
    require(type(expected['uuid']) is str and str(uuid.UUID(expected['uuid'])) == expected['uuid'],
            'canonical known filesystem UUID required')
    require(expected['filesystem'] == 'ext4' and expected['mountpoint'] == MOUNT, 'fixed ext4 mount required')
    graph = snapshot['graph']
    memo = {}

    def physical(mm):
        if mm in memo:
            return memo[mm]
        node = graph[mm]
        memo[mm] = ({mm} if node['type'] == 'disk'
                    else set().union(*(physical(parent) for parent in node['parents'])))
        return memo[mm]

    root = snapshot['mounts']['/']['identity']
    data = snapshot['mounts'][MOUNT]['identity']
    root_disks, data_disks = physical(root), physical(data)
    require(root_disks and data_disks and root_disks.isdisjoint(data_disks), 'physical root overlap')
    require(len(data_disks) == 1, 'retained mount must have one dedicated EBS ancestor')
    disk = graph[next(iter(data_disks))]
    serial = expected['id'].replace('-', '')
    require(re.fullmatch(r'nvme[0-9]+n[0-9]+', disk['kname'])
            and disk['kernel_serial'] == disk['lsblk_serial'] == serial, 'NVMe EBS serial mismatch')
    require(snapshot['uuid'] == expected['uuid'], 'retained filesystem UUID mismatch')
    return {'root_device': root, 'mounted_device': data, 'root_physical_ancestors': sorted(root_disks),
            'data_physical_ancestors': sorted(data_disks), 'uuid': snapshot['uuid'],
            'ebs_serial': disk['kernel_serial'], 'volume_id': expected['id'],
            'mountpoint': MOUNT, 'filesystem': snapshot['filesystem'], 'devices': graph}


def collect_and_validate(expected, probe=None):
    injected = probe is not None
    probe = probe if injected else LinuxProbe()
    require(probe.system() == 'linux', 'Linux-only collector; no probes performed')
    try:
        first = collect_snapshot(probe)
        verified = validate_snapshot(expected, first)
        second = collect_snapshot(probe)
        require(first == second, 'device/mount snapshot changed during collection')
    except Refused:
        raise
    except (OSError, ValueError, TypeError, KeyError, RecursionError, subprocess.SubprocessError):
        raise Refused('device collection incomplete or unsupported') from None
    return {'format': 'rh-linux-host-device-observation/1', 'installed': False, 'deployable': False,
            'physical_attestation': False, 'probe_mode': 'injected' if injected else 'local-linux-read-only',
            'snapshot_sha256': hashlib.sha256(json.dumps(first, sort_keys=True).encode()).hexdigest(),
            **verified}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--volume-id', required=True)
    parser.add_argument('--uuid', required=True)
    args = parser.parse_args(argv)
    try:
        result = collect_and_validate({'id': args.volume_id, 'uuid': args.uuid,
                                       'filesystem': 'ext4', 'mountpoint': MOUNT})
        print(json.dumps(result, sort_keys=True))
        return 0
    except Refused as error:
        print('host device refused: ' + str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
