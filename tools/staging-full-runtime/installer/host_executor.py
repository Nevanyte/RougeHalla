#!/usr/bin/env python3
"""Linux/root host installer executor for ONE run. Must be the bootstrap guard unit's main process.

It composes the reviewed modules instead of replacing them: the absolute expiry executor runs IN THIS PROCESS
(same MainPID, same startup-timeout guard), the device collector revalidates ancestry while the writer fence is
held, and the contract/transfer/host_material verifiers check the plan, artifact bytes and PostgreSQL role input.

Every OS, process, device, service and network effect goes through an injectable boundary. The real Linux
boundaries are constructed only by `main`. It never formats or mounts media, never renews or disarms expiry,
never downloads an unpinned substitute and never labels a host deployed or accepted. Upload acknowledgement is
not independent restore proof. Restore continuation refuses: remote-writer fencing has no interface here.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import grp
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tarfile
import time

import contract
import expiry_executor as expiry
import foundation
import host_device
import host_material
import transfer

FORMAT = 'rh-host-executor/1'
HERE = Path(__file__).resolve().parent
LAYOUT_PATH = HERE / 'host_executor' / 'layout.json'
DOMAIN = 'rougehalla.com'
DATA = host_device.MOUNT
RUN_ROOT = '/var/lib/rougehalla-installer'
ETC = '/etc/rougehalla'
UNIT_DIR = '/etc/systemd/system'
PG_ETC = '/etc/rougehalla-postgres'
PG_BIN = '/opt/rougehalla/postgres/bin'
PGDATA = DATA + '/pgdata'
SERVICE_SOCKET = '/run/rougehalla-postgres'
OWNER_RECORD = 'rougehalla-volume-owner.json'
MARKER = 'installation-verified.json'
LOCK = 'writers.lock'
SECRETS = 'runtime-secrets.json'
BUNDLE = 'public-bundle.tar'
CIPHERTEXT = 'cold-backup.age'
NFT_TABLE = 'rougehalla_guard'
POSTGRES_UNIT, SOURCE_UNIT, TRAINING_UNIT, CADDY_UNIT = (
    'rougehalla-postgres.service', 'rougehalla-source.service', 'rougehalla-training.service', 'rougehalla-caddy.service')
APP_UNITS = (POSTGRES_UNIT, SOURCE_UNIT, TRAINING_UNIT, CADDY_UNIT)
EGRESS_UNIT = 'rougehalla-egress-limit.service'
BACKUP_SERVICE, BACKUP_TIMER = 'rougehalla-backup.service', 'rougehalla-backup.timer'
DRAIN_SECONDS = 180
GUARD_SAFETY_US = 10_000_000
USERS = ('rougehalla', 'postgres')
NOLOGIN = ('/usr/sbin/nologin', '/sbin/nologin', '/usr/bin/false', '/bin/false')
RESTORE_SEAM = ('restore continuation refused: Root-owned remote-writer fencing proof has no interface; '
                'never restore over an unfenced older writer')
SECRET_CREATED = b'runtime secret file created; values withheld; PG role provisioning remains required\n'
BACKUP_DONE = b'encrypted local backup captured; OFFHOST UPLOAD + INDEPENDENT RESTORE STILL REQUIRED; runtimes remain stopped\n'
BASE_ENV = {'PATH': '/usr/bin:/usr/sbin', 'LC_ALL': 'C', 'TZ': 'UTC'}
SHOW_UNIT = 'Id,LoadState,ActiveState,SubState,FragmentPath,DropInPaths,NeedDaemonReload,UnitFileState,User'
DIRFLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
# Pinned tool paths are fixed here; the toolchain receipt supplies only their digests (python's minor varies).
TOOL_PATHS = {
    'aws': r'/opt/rougehalla/aws/bin/aws', 'age': r'/opt/rougehalla/age/bin/age',
    'initdb': PG_BIN + '/initdb', 'pg_ctl': PG_BIN + '/pg_ctl', 'psql': PG_BIN + '/psql',
    'postgres': PG_BIN + '/postgres', 'pg_dump': PG_BIN + '/pg_dump', 'pg_restore': PG_BIN + '/pg_restore',
    'nft': '/usr/sbin/nft', 'systemctl': '/usr/bin/systemctl', 'timedatectl': '/usr/bin/timedatectl',
    'python3': r'/usr/bin/python3\.[0-9]{1,2}', 'bash': '/usr/bin/bash', 'useradd': '/usr/sbin/useradd',
    'runuser': '/usr/sbin/runuser', 'flock': '/usr/bin/flock', 'mountpoint': '/usr/bin/mountpoint',
    'tar': '/usr/bin/tar', 'lsblk': '/usr/bin/lsblk', 'blkid': '/usr/sbin/blkid'}
TOOL_TREES = {'aws': '/opt/rougehalla/aws', 'postgres': '/opt/rougehalla/postgres', 'age': '/opt/rougehalla/age'}
PG_SETTINGS = ('fsync', 'full_page_writes', 'listen_addresses', 'log_min_error_statement', 'log_statement',
               'password_encryption', 'synchronous_commit')
Q_SETTINGS = ("SELECT name || '=' || setting FROM pg_settings WHERE name IN ('" + "','".join(PG_SETTINGS) +
              "') ORDER BY name")
Q_ROLE = ("SELECT concat_ws('|', rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin) "
          "FROM pg_roles WHERE rolname = 'rougehalla'")
Q_DATABASE = ("SELECT pg_get_userbyid(datdba) || '|' || coalesce(array_to_string(datacl, ','), '') "
              "FROM pg_database WHERE datname = 'rougehalla'")
Q_MEMBERS = ("SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member "
             "WHERE r.rolname = 'rougehalla'")
Q_LOGIN = "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolcanlogin"
Q_SCRAM = "SELECT left(rolpassword, 14) FROM pg_authid WHERE rolname = 'rougehalla'"
Q_MIGRATION = 'SELECT coalesce(max(version), 0) FROM _sqlx_migrations WHERE success'
Q_OWNERS = "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'rougehalla'"
Q_SEED = 'SELECT count(*) FROM profiles'
QUERIES = (Q_SETTINGS, Q_ROLE, Q_DATABASE, Q_MEMBERS, Q_LOGIN, Q_SCRAM, Q_MIGRATION, Q_OWNERS, Q_SEED)
EXPECTED_ROLE = {'role': 'f|f|f|f|f|t', 'database': 'rougehalla|rougehalla=CTc/rougehalla', 'members': '0',
                 'login': 'postgres,rougehalla', 'scram': 'SCRAM-SHA-256$'}


class Refused(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def mode(text):
    require(type(text) is str and re.fullmatch('0[0-7]{3}', text), 'octal mode required')
    return int(text, 8)


# ---------------------------------------------------------------- inputs

def load_layout(path=LAYOUT_PATH):
    layout = contract.strict_json(Path(path).read_text())
    require(set(layout) == {'format', 'directories', 'files', 'trees', 'volume'}
            and layout['format'] == 'rh-host-executor-layout/1', 'executor layout format')
    owners = {'root', 'rougehalla', 'postgres'}
    def owned(item, keys):
        require(type(item) is dict and set(item) == set(keys.split()) and item['owner'] in owners
                and item['group'] in owners, 'executor layout entry')
    for item in layout['directories']:
        owned(item, 'path owner group mode'); mode(item['mode'])
    seen = set()
    for item in layout['files']:
        owned(item, 'member path owner group mode'); mode(item['mode'])
        require(item['member'] not in seen and item['path'] not in seen, 'duplicate layout destination')
        seen |= {item['member'], item['path']}
    for item in layout['trees']:
        owned(item, 'prefix path owner group file_mode dir_mode'); mode(item['file_mode']); mode(item['dir_mode'])
        require(item['prefix'].endswith('/'), 'tree prefix')
    for item in layout['volume']:
        owned(item, 'name owner group mode'); mode(item['mode'])
    for path in [i['path'] for i in layout['directories'] + layout['files'] + layout['trees']]:
        require(path == str(PurePosixPath(path)) and path.startswith('/') and '..' not in path.split('/'),
                'canonical layout path')
    return layout


def expiry_request(plan_bytes):
    """Minimal parse so the immutable expiry is armed before full validation can fail."""
    plan = contract.strict_json(plan_bytes.decode('utf-8'))
    require(type(plan) is dict, 'plan object required')
    return {'run_id': plan.get('run_id'), 'prepared_at': plan.get('prepared_at'), 'expires_at': plan.get('host_expires_at')}


def parse_toolchain(value):
    require(type(value) is dict and set(value) == {'format', 'tools', 'trees'}
            and value['format'] == 'rh-host-toolchain/1', 'toolchain receipt format')
    tools, trees = value['tools'], value['trees']
    require(type(tools) is dict and set(tools) == set(TOOL_PATHS), 'exact pinned tool set required; no substitute')
    require(type(trees) is dict and set(trees) == set(TOOL_TREES), 'exact pinned tool trees required')
    result = {}
    for name, item in tools.items():
        require(type(item) is dict and set(item) == {'path', 'sha256'} and type(item['path']) is str
                and re.fullmatch(TOOL_PATHS[name], item['path']), 'pinned tool path')
        contract.digest(item['sha256'])
        result[name] = item
    for digest in trees.values():
        contract.digest(digest)
    return {'tools': result, 'trees': dict(trees)}


def parse_boundary(value):
    require(type(value) is dict and set(value) == {'format', 'imds_nonroot_blocked', 'egress_max_bytes',
            'egress_bytes_per_second', 'age_recipient'} and value['format'] == 'rh-host-boundary/1',
            'boundary receipt format')
    require(value['imds_nonroot_blocked'] is True, 'IMDS isolation is mandatory')
    for key in ('egress_max_bytes', 'egress_bytes_per_second'):
        require(type(value[key]) is int and 0 < value[key] <= 1 << 40, 'bounded egress limit required')
    require(type(value['age_recipient']) is str and re.fullmatch(r'age1[0-9a-z]{58}', value['age_recipient']),
            'public age recipient required')
    return value


def load_inputs(plan_bytes, toolchain_bytes, boundary_bytes, now):
    for raw in (plan_bytes, toolchain_bytes, boundary_bytes):
        require(type(raw) is bytes and 0 < len(raw) <= 65536, 'bounded nonsecret input required')
    plan = contract.validate(contract.strict_json(plan_bytes.decode('utf-8')), now)
    require(plan['mode'] == 'fresh', RESTORE_SEAM)
    require(sha256(toolchain_bytes) == plan['toolchain_receipt_sha256'], 'toolchain receipt is not the plan pin')
    require(sha256(boundary_bytes) == plan['boundary_receipt_sha256'], 'boundary receipt is not the plan pin')
    return {'plan': plan, 'toolchain': parse_toolchain(contract.strict_json(toolchain_bytes.decode('utf-8'))),
            'boundary': parse_boundary(contract.strict_json(boundary_bytes.decode('utf-8'))),
            'raw': {'plan.json': plan_bytes, 'toolchain.json': toolchain_bytes, 'boundary.json': boundary_bytes}}


# ---------------------------------------------------------------- rendered executor-owned material

def nft_ruleset(uids, boundary):
    rh, pg = uids['rougehalla'], uids['postgres']
    return ('table inet ' + NFT_TABLE + ' {\n'
            '\tchain output {\n'
            '\t\ttype filter hook output priority 0; policy accept;\n'
            '\t\tip daddr 169.254.169.254 meta skuid != 0 drop\n'
            '\t\tip6 daddr fd00:ec2::254 meta skuid != 0 drop\n'
            f'\t\tmeta skuid {pg} oifname != "lo" drop\n'
            f'\t\tmeta skuid {rh} oifname != "lo" quota over {boundary["egress_max_bytes"]} bytes drop\n'
            f'\t\tmeta skuid {rh} oifname != "lo" limit rate over {boundary["egress_bytes_per_second"]} bytes/second drop\n'
            '\t}\n}\n')


def nft_bytes(value, unit):
    units = {'bytes': 1, 'kbytes': 1024, 'mbytes': 1024 ** 2, 'gbytes': 1024 ** 3}
    require(type(value) is int and unit in units, 'nft byte unit')
    return value * units[unit]


def verify_nft(text, uids, boundary):
    """Strict semantic check of the kernel's own JSON listing; anything unexpected refuses (fail closed)."""
    listing = contract.strict_json(text)
    require(type(listing) is dict and set(listing) == {'nftables'} and type(listing['nftables']) is list,
            'nft listing shape')
    rows = [r for r in listing['nftables'] if not (type(r) is dict and set(r) == {'metainfo'})]
    require(len(rows) == 7 and all(type(r) is dict and len(r) == 1 for r in rows), 'unexpected nft objects')
    table, chain, rules = rows[0].get('table'), rows[1].get('chain'), [r.get('rule') for r in rows[2:]]
    require(type(table) is dict and table.get('family') == 'inet' and table.get('name') == NFT_TABLE, 'nft table')
    require(type(chain) is dict and {k: chain.get(k) for k in ('family', 'table', 'name', 'type', 'hook', 'prio', 'policy')} ==
            {'family': 'inet', 'table': NFT_TABLE, 'name': 'output', 'type': 'filter', 'hook': 'output',
             'prio': 0, 'policy': 'accept'}, 'nft output hook chain')
    skuid = {'meta': {'key': 'skuid'}}
    def match(op, left, right):
        return {'match': {'op': op, 'left': left, 'right': right}}
    outside = match('!=', {'meta': {'key': 'oifname'}}, 'lo')
    rh, pg = uids['rougehalla'], uids['postgres']
    expected = [
        [match('==', {'payload': {'protocol': 'ip', 'field': 'daddr'}}, '169.254.169.254'), match('!=', skuid, 0), {'drop': None}],
        [match('==', {'payload': {'protocol': 'ip6', 'field': 'daddr'}}, 'fd00:ec2::254'), match('!=', skuid, 0), {'drop': None}],
        [match('==', skuid, pg), outside, {'drop': None}]]
    for rule, exprs in zip(rules[:3], expected):
        require(type(rule) is dict and rule.get('chain') == 'output' and rule.get('expr') == exprs, 'nft isolation rule')
    for rule, kind in zip(rules[3:], ('quota', 'limit')):
        require(type(rule) is dict and rule.get('chain') == 'output' and type(rule.get('expr')) is list
                and len(rule['expr']) == 4 and rule['expr'][:2] == [match('==', skuid, rh), outside]
                and rule['expr'][3] == {'drop': None}, 'nft egress rule')
        body = rule['expr'][2].get(kind) if type(rule['expr'][2]) is dict and len(rule['expr'][2]) == 1 else None
        require(type(body) is dict and body.get('inv') is True, 'nft egress limiter')
        if kind == 'quota':
            require(set(body) <= {'val', 'val_unit', 'inv', 'used', 'used_unit'}
                    and nft_bytes(body.get('val'), body.get('val_unit')) == boundary['egress_max_bytes'], 'nft quota')
        else:
            require(set(body) <= {'rate', 'rate_unit', 'per', 'inv', 'burst', 'burst_unit'} and body.get('per') == 'second'
                    and body.get('burst', 0) == 0
                    and nft_bytes(body.get('rate'), body.get('rate_unit')) == boundary['egress_bytes_per_second'], 'nft rate')


def egress_unit(run_id, nft):
    return ('[Unit]\nDescription=Run-scoped IMDS and egress guard presence ' + run_id + '\n'
            '[Service]\nType=oneshot\nRemainAfterExit=yes\nUser=root\n'
            'ExecStart=' + nft + ' list table inet ' + NFT_TABLE + '\n').encode()


def backup_material(plan, python):
    end = contract.stamp(plan['host_expires_at'])
    trigger = end - dt.timedelta(seconds=plan['backup_seconds'] + DRAIN_SECONDS)
    service = ('[Unit]\nDescription=Quiesced encrypted backup and conditional upload ' + plan['run_id'] + '\n'
               '[Service]\nType=oneshot\nUser=root\nTimeoutStartSec=' + str(plan['backup_seconds']) + 's\n'
               'ExecStart=' + python + ' -I /opt/rougehalla/installer/host_executor.py backup --run-id ' + plan['run_id'] + '\n')
    timer = ('[Unit]\nDescription=Backup before fixed expiry ' + plan['run_id'] + '\n[Timer]\nOnCalendar=' +
             trigger.strftime('%Y-%m-%d %H:%M:%S UTC') + '\nPersistent=false\nAccuracySec=1s\nRandomizedDelaySec=0\n'
             'Unit=' + BACKUP_SERVICE + '\n')
    return {BACKUP_SERVICE: service.encode(), BACKUP_TIMER: timer.encode()}, expiry.epoch_us(trigger)


def unit_fields(text):
    """Strict reader for the small reviewed unit subset; repeated or indirect configuration refuses."""
    require(type(text) is str and len(text) <= 16384 and '@' not in text and 'AWS' not in text.upper(),
            'unrendered placeholder or credential reference in unit')
    fields, section = {}, None
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        if re.fullmatch(r'\[[A-Za-z]+\]', line):
            section = line[1:-1]
            continue
        key, separator, value = line.partition('=')
        require(section and separator and re.fullmatch('[A-Za-z]+', key), 'malformed unit line')
        require(key not in ('EnvironmentFile', 'PassEnvironment', 'ExecStartPre', 'ExecStartPost', 'ExecStop',
                            'ExecReload', 'LoadCredential', 'SetCredential', 'ImportCredential'), 'indirect unit configuration')
        require((section, key) not in fields, 'repeated unit key')
        fields[(section, key)] = value
    return fields


def check_units(texts, plan, now_us):
    """Bind bundle units to the exact users/paths/lifetimes this executor installs."""
    end = expiry.epoch_us(contract.stamp(plan['host_expires_at']))
    marker = DATA + '/' + MARKER
    expected = {
        POSTGRES_UNIT: ('postgres', PG_BIN + '/postgres -D ' + PGDATA + ' -c config_file=' + PG_ETC +
                        '/postgresql.conf -c hba_file=' + PG_ETC + '/pg_hba.conf', PGDATA + ' ' + SERVICE_SOCKET, False),
        SOURCE_UNIT: ('rougehalla', '/usr/bin/python3 /opt/rougehalla/preparation/run-runtime.py source',
                      DATA + '/spool-source', True),
        TRAINING_UNIT: ('rougehalla', '/usr/bin/python3 /opt/rougehalla/preparation/run-runtime.py training',
                        DATA + '/spool-training', True),
        CADDY_UNIT: ('rougehalla', '/opt/rougehalla/bin/caddy run --config ' + ETC + '/Caddyfile --adapter caddyfile',
                     DATA + '/caddy', True)}
    lifetimes = {}
    for unit, (user, command, writable, bounded) in expected.items():
        f = unit_fields(texts[unit])
        require(f.get(('Service', 'User')) == user and f.get(('Service', 'Group')) == user
                and f.get(('Service', 'ExecStart')) == command and f.get(('Service', 'Restart')) == 'no'
                and f.get(('Service', 'ReadWritePaths')) == writable and f.get(('Service', 'NoNewPrivileges')) == 'true'
                and f.get(('Unit', 'ConditionPathExists')) == marker, 'unit identity/path/marker binding: ' + unit)
        env = [v for (s, k), v in f.items() if k == 'Environment']
        require(env == (['HOME=' + DATA + '/caddy'] if unit == CADDY_UNIT else []), 'unexpected service environment')
        if bounded:
            runtime = f.get(('Service', 'RuntimeMaxSec'), '')
            require(re.fullmatch('[1-9][0-9]{0,5}', runtime), 'finite service lifetime required')
            require(now_us + (int(runtime) + DRAIN_SECONDS) * 1000000 <= end, 'service lifetime+drain exceeds fixed expiry')
            lifetimes[unit] = int(runtime)
    requires = unit_fields(texts[CADDY_UNIT]).get(('Unit', 'Requires'), '').split()
    require(EGRESS_UNIT in requires and SOURCE_UNIT in requires, 'Caddy must require the egress guard')
    return lifetimes


# ---------------------------------------------------------------- real boundaries

class SystemIds:
    def user(self, name):
        try:
            p = pwd.getpwnam(name)
        except KeyError:
            return None
        return {'uid': p.pw_uid, 'gid': p.pw_gid, 'shell': p.pw_shell}

    def group(self, name):
        try:
            g = grp.getgrnam(name)
        except KeyError:
            return None
        return {'gid': g.gr_gid, 'members': sorted(g.gr_mem)}

    def supplementary(self, name):
        return sorted(g.gr_name for g in grp.getgrall() if name in g.gr_mem)

    def names(self, uid, gid):
        try:
            user = pwd.getpwuid(uid).pw_name
        except KeyError:
            user = '#' + str(uid)
        try:
            group = grp.getgrgid(gid).gr_name
        except KeyError:
            group = '#' + str(gid)
        return user, group


class HostFS:
    """Real descriptor-anchored filesystem boundary. `base` is '/' on a host; tests pass a private directory."""
    def __init__(self, ids, base='/'):
        self.ids, self.base = ids, base

    def real(self, path):
        return path if self.base == '/' else self.base.rstrip('/') + path

    def owner(self, info):
        return self.ids.names(info.st_uid, info.st_gid)

    def chown(self, fd, user, group):
        os.fchown(fd, self.ids.user(user)['uid'], self.ids.group(group)['gid'])

    def describe(self, info):
        kind = 'dir' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'other'
        user, group = self.owner(info)
        return {'kind': kind, 'user': user, 'group': group, 'mode': stat.S_IMODE(info.st_mode),
                'nlink': info.st_nlink, 'size': info.st_size, 'inode': info.st_ino}

    def entry(self, dir_fd, name):
        try:
            return self.describe(os.stat(name, dir_fd=dir_fd, follow_symlinks=False))
        except FileNotFoundError:
            return None

    def device(self, fd):
        info = os.fstat(fd)
        return f'{os.major(info.st_dev)}:{os.minor(info.st_dev)}'

    def open_dir(self, path, create=None):
        require(type(path) is str and path.startswith('/') and str(PurePosixPath(path)) == path
                and '..' not in path.split('/'), 'canonical absolute path')
        fd = os.open(self.base, DIRFLAGS)
        current = ''
        try:
            for part in PurePosixPath(path).parts[1:]:
                current += '/' + part
                spec = create(current) if create else None
                try:
                    child = os.open(part, DIRFLAGS, dir_fd=fd)
                except FileNotFoundError:
                    require(spec is not None, 'required directory absent')
                    os.mkdir(part, 0o700, dir_fd=fd)
                    child = os.open(part, DIRFLAGS, dir_fd=fd)
                    self.chown(child, spec['owner'], spec['group'])
                    os.fchmod(child, spec['mode'])
                    os.fsync(child); os.fsync(fd)
                os.close(fd)
                fd = child
                d = self.describe(os.fstat(fd))
                if spec is None:
                    require(d['kind'] == 'dir' and d['user'] == 'root' and not d['mode'] & 0o022, 'untrusted ancestor directory')
                else:
                    require((d['kind'], d['user'], d['group'], d['mode']) == ('dir', spec['owner'], spec['group'], spec['mode']),
                            'directory ownership/mode differs; never adopt foreign state')
            return fd
        except BaseException:
            os.close(fd)
            raise

    @contextlib.contextmanager
    def directory(self, path, create=None):
        fd = self.open_dir(path, create)
        try:
            yield fd
        finally:
            os.close(fd)

    def read(self, dir_fd, name, limit):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dir_fd)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit, 'bounded private regular file')
            chunks, total = [], 0
            while True:
                data = os.read(fd, 1 << 20)
                if not data:
                    break
                total += len(data)
                require(total <= limit, 'file exceeds bound')
                chunks.append(data)
            return b''.join(chunks), self.describe(info)
        finally:
            os.close(fd)

    def create(self, dir_fd, name, chunks, user, group, file_mode):
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=dir_fd)
        digest, size = hashlib.sha256(), 0
        try:
            for chunk in chunks:
                view = memoryview(chunk)
                while view:
                    count = os.write(fd, view)
                    require(count > 0, 'incomplete write')
                    digest.update(view[:count]); size += count; view = view[count:]
            os.fsync(fd)
            self.chown(fd, user, group)
            os.fchmod(fd, file_mode)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(dir_fd)
        return size, digest.hexdigest()

    def publish(self, dir_fd, temporary, name):
        # Create-only: link fails if any entry already holds the final name.
        os.link(temporary, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd, follow_symlinks=False)
        os.unlink(temporary, dir_fd=dir_fd)
        os.fsync(dir_fd)

    def unlink(self, dir_fd, name):
        os.unlink(name, dir_fd=dir_fd)
        os.fsync(dir_fd)

    def mkdir(self, dir_fd, name, user, group, dir_mode):
        os.mkdir(name, 0o700, dir_fd=dir_fd)
        fd = os.open(name, DIRFLAGS, dir_fd=dir_fd)
        try:
            self.chown(fd, user, group); os.fchmod(fd, dir_mode); os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(dir_fd)

    def set_owner_mode(self, fd, user, group, dir_mode):
        self.chown(fd, user, group); os.fchmod(fd, dir_mode); os.fsync(fd)

    def listdir(self, fd):
        names = sorted(os.listdir(fd))
        require(len(names) <= 4096, 'directory exceeds bound')
        return names

    def open_lock(self, dir_fd, name):
        return os.open(name, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dir_fd)

    def lock_exclusive(self, fd):
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('a live writer holds the retained-volume lock; never revive or override it') from None

    def file_digest(self, path, executable=False):
        parent, name = path.rsplit('/', 1)
        with self.directory(parent) as dir_fd:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dir_fd)
            try:
                d = self.describe(os.fstat(fd))
                require(d['kind'] == 'file' and d['user'] == 'root' and not d['mode'] & 0o022
                        and (not executable or d['mode'] & 0o111), 'untrusted pinned file')
                h = hashlib.sha256()
                for data in iter(lambda: os.read(fd, 1 << 20), b''):
                    h.update(data)
                return h.hexdigest()
            finally:
                os.close(fd)

    def tree_digest(self, path):
        """Deterministic digest of a root-owned, non-writable tool tree; symlinks are recorded, never followed."""
        rows, count = [], [0]
        def walk(fd, relative):
            for name in self.listdir(fd):
                count[0] += 1
                require(count[0] <= 200000, 'tool tree exceeds bound')
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                d = self.describe(info)
                rel = relative + '/' + name
                if stat.S_ISLNK(info.st_mode):
                    rows.append(['l', rel, os.readlink(name, dir_fd=fd)])
                    continue
                require(d['user'] == 'root' and not d['mode'] & 0o022 and d['kind'] in ('dir', 'file'), 'untrusted tool tree entry')
                if d['kind'] == 'dir':
                    rows.append(['d', rel, d['mode']])
                    child = os.open(name, DIRFLAGS, dir_fd=fd)
                    try:
                        walk(child, rel)
                    finally:
                        os.close(child)
                else:
                    h = hashlib.sha256()
                    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                    try:
                        for data in iter(lambda: os.read(handle, 1 << 20), b''):
                            h.update(data)
                    finally:
                        os.close(handle)
                    rows.append(['f', rel, d['mode'], h.hexdigest()])
        with self.directory(path) as fd:
            walk(fd, '')
        return sha256(canonical(rows))


class LinuxProcess:
    """Exact argv allowlist fixed per run; trusted absolute tools; no shell; no inherited environment."""
    def __init__(self, table, ids):
        self.table, self.ids = table, ids

    def run(self, argv, stdin=None, timeout=30):
        argv = tuple(argv)
        spec = self.table.get(argv)
        require(spec is not None, 'command not allowlisted for this run')
        user, env = spec
        host_device.LinuxProbe().trusted_tool(argv[0])
        identity = {}
        if user != 'root':
            entry = self.ids.user(user)
            identity = {'user': entry['uid'], 'group': entry['gid'], 'extra_groups': []}
        result = subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False,
                                check=False, timeout=max(1, timeout), cwd='/', env=dict(env), **identity)
        require(len(result.stdout) <= 4 << 20, 'command output exceeds bound')
        # Stderr is never returned or logged: private diagnosis only.
        return result.returncode, result.stdout


class LoopbackNet:
    """Loopback-only local health/identity probes; HTTPS verifies the public chain and practice hostname."""
    def http(self, port, path):
        require(port in (7777, 7779) and path in ('/healthz', '/readyz', '/info'), 'probe not allowlisted')
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        try:
            connection.request('GET', path, headers={'Connection': 'close'})
            response = connection.getresponse()
            return response.status, response.read(65537)
        finally:
            connection.close()

    def https(self, path):
        require(path in ('/healthz', '/training/healthz', '/info', '/control', '/training/api'), 'probe not allowlisted')
        context = ssl.create_default_context()
        with socket.create_connection(('127.0.0.1', 443), timeout=5) as raw:
            with context.wrap_socket(raw, server_hostname=DOMAIN) as tls:
                tls.sendall(('GET ' + path + ' HTTP/1.1\r\nHost: ' + DOMAIN + '\r\nConnection: close\r\n\r\n').encode())
                response = http.client.HTTPResponse(tls)
                response.begin()
                return response.status, response.read(65537)


class Boundaries:
    """All effects. `injected` is True unless every boundary is the real Linux one built by `linux()`."""
    def __init__(self, runner, fs, process_factory, net, probe, ids, sleep, injected=True):
        self.runner, self.fs, self.process_factory, self.net = runner, fs, process_factory, net
        self.probe, self.ids, self.sleep, self.injected = probe, ids, sleep, injected

    @classmethod
    def linux(cls):
        ids = SystemIds()
        return cls(expiry.LinuxRunner(), HostFS(ids), lambda table: LinuxProcess(table, ids), LoopbackNet(),
                   host_device.LinuxProbe(), ids, time.sleep, injected=False)


# ---------------------------------------------------------------- commands

def command_table(inputs, run_dir_path):
    """Every argv this run may execute, with its identity and complete environment."""
    plan, tools = inputs['plan'], inputs['toolchain']['tools']
    sc = (tools['systemctl']['path'], '--system', '--no-pager', '--no-ask-password')
    run = plan['run_id']
    sock = RUN_ROOT + '/' + run + '.pg'
    pg_env = dict(BASE_ENV, HOME='/nonexistent', PGTZ='UTC')
    aws_env = dict(BASE_ENV, HOME=run_dir_path, AWS_CONFIG_FILE='/dev/null', AWS_SHARED_CREDENTIALS_FILE='/dev/null',
                   AWS_DEFAULT_OUTPUT='json', AWS_PAGER='', AWS_EC2_METADATA_V1_DISABLED='true',
                   AWS_RETRY_MODE='standard', AWS_MAX_ATTEMPTS='3')
    table = {}
    for name in USERS:
        table[(tools['useradd']['path'], '--system', '--user-group', '--no-create-home', '--home-dir', '/nonexistent',
               '--shell', '/usr/sbin/nologin', name)] = ('root', BASE_ENV)
    nft = tools['nft']['path']
    table[(nft, '-f', '-')] = ('root', BASE_ENV)
    table[(nft, '--json', 'list', 'table', 'inet', NFT_TABLE)] = ('root', BASE_ENV)
    table[tuple(transfer.get_command(plan))] = ('root', aws_env)
    table[(tools['python3']['path'], '-I', '/opt/rougehalla/preparation/init-runtime-secrets.py')] = ('root', BASE_ENV)
    table[(tools['initdb']['path'], '-D', PGDATA, '--auth-local=peer', '--auth-host=scram-sha-256', '--encoding=UTF8',
           '--locale=C', '--data-checksums', '--username=postgres', '--no-instructions')] = ('postgres', pg_env)
    options = ('-c config_file=' + PG_ETC + '/postgresql.conf -c hba_file=' + PG_ETC + "/pg_hba.conf -c listen_addresses='' "
               '-c unix_socket_directories=' + sock)
    table[(tools['pg_ctl']['path'], 'start', '-D', PGDATA, '-w', '-t', '30', '-s', '-l', sock + '/provision.log',
           '-o', options)] = ('postgres', pg_env)
    table[(tools['pg_ctl']['path'], 'stop', '-D', PGDATA, '-m', 'fast', '-w', '-t', '30', '-s')] = ('postgres', pg_env)
    for socket_dir in (sock, SERVICE_SOCKET):
        for database in ('postgres', 'rougehalla'):
            base = (tools['psql']['path'], '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', socket_dir, '-d', database)
            for query in QUERIES:
                table[base + ('-c', query)] = ('postgres', pg_env)
    table[(tools['psql']['path'], '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-d', 'postgres', '-f', '-')] = ('postgres', pg_env)
    table[sc + ('daemon-reload',)] = ('root', BASE_ENV)
    for unit in APP_UNITS + (EGRESS_UNIT, BACKUP_SERVICE):
        table[sc + ('show', '--all', '--property=' + SHOW_UNIT, unit)] = ('root', BASE_ENV)
    for unit in APP_UNITS + (EGRESS_UNIT, BACKUP_TIMER):
        table[sc + ('start', unit)] = ('root', BASE_ENV)
    table[sc + ('show', '--all', '--property=' + expiry.TIMER_PROPS, BACKUP_TIMER)] = ('root', BASE_ENV)
    backup_env = dict(BASE_ENV, PATH=PG_BIN + ':/opt/rougehalla/age/bin:/usr/bin:/usr/sbin')
    table[(tools['bash']['path'], '/opt/rougehalla/preparation/backup.sh', inputs['boundary']['age_recipient'],
           run_dir_path + '/' + CIPHERTEXT)] = ('root', backup_env)
    return table, sc, aws_env


# ---------------------------------------------------------------- executor

class Executor:
    def __init__(self, boundaries, layout=None):
        self.b, self.fs, self.runner = boundaries, boundaries.fs, boundaries.runner
        self.layout = layout if layout is not None else load_layout()
        self.trace, self.held = [], []

    # ---- clock, deadline and startup-guard gate
    def clock(self):
        real, boot = self.runner.clock()
        require(type(real) is int and type(boot) is int and boot >= 0, 'invalid OS clock observation')
        return real, boot

    def now_dt(self, real_us):
        return dt.datetime(1970, 1, 1, tzinfo=contract.UTC) + dt.timedelta(microseconds=real_us)

    def gate(self, step, reserve_seconds):
        """Before every step: original deadline, observed armed timer, guard still owning this PID, startup budget."""
        real, boot = self.clock()
        require(real < self.end_us, 'fixed absolute expiry elapsed')
        foundation.check_deadline(self.plan, self.record, self.now_dt(real))
        require(boot - self.boot0 + reserve_seconds * 1000000 <= self.timeout_us - GUARD_SAFETY_US,
                'bootstrap startup budget cannot cover this step; fail-safe instead of starting it')
        expiry.verify_guard(self.runner)
        expiry.verify_units(self.runner, self.end_us)
        expiry.no_shutdown_pending(self.runner)
        with self.fs.directory(ETC) as etc:
            body, info = self.fs.read(etc, expiry.STATE, 8192)
        require(body == expiry.material(self.record)[expiry.STATE] and info['user'] == 'root' and info['mode'] == 0o600,
                'original deadline record changed')
        self.trace.append(step)
        return real

    def remaining(self):
        real, boot = self.clock()
        return max(1, min((self.end_us - real) // 1000000, (self.timeout_us - GUARD_SAFETY_US - (boot - self.boot0)) // 1000000))

    def run(self, argv, stdin=None, expect=0):
        code, out = self.proc.run(tuple(argv), stdin=stdin, timeout=self.remaining())
        require(code == expect, 'command failed: ' + PurePosixPath(argv[0]).name)
        return out

    def systemctl(self, *args):
        return self.run(self.sc + args)

    def show(self, unit, props=SHOW_UNIT):
        return expiry.properties(self.systemctl('show', '--all', '--property=' + props, unit).decode('utf-8'))

    def wait(self, check, seconds, reason):
        deadline = self.clock()[1] + seconds * 1000000
        while True:
            try:
                if check():
                    return
            except (OSError, ValueError, http.client.HTTPException):
                pass
            require(self.clock()[1] < deadline, reason)
            self.b.sleep(0.5)

    # ---- journal for steps whose completed state cannot be proved from the object itself
    def journal_has(self, step):
        with self.fs.directory(self.run_path + '/journal') as fd:
            return self.fs.entry(fd, step) is not None

    def journal(self, step):
        body = canonical({'run_id': self.plan['run_id'], 'step': step})
        with self.fs.directory(self.run_path + '/journal') as fd:
            existing = self.fs.entry(fd, step)
            if existing is None:
                self.fs.create(fd, step, [body], 'root', 'root', 0o600)
            else:
                require(self.fs.read(fd, step, 4096)[0] == body, 'journal entry differs')

    def create_exact(self, dir_fd, name, body, user, group, file_mode):
        """Create-only with temp+link; identical existing bytes/owner/mode are accepted, anything else refuses."""
        existing = self.fs.entry(dir_fd, name)
        if existing is not None:
            data, info = self.fs.read(dir_fd, name, max(len(body), 1))
            require(data == body and (info['user'], info['group'], info['mode']) == (user, group, file_mode),
                    'existing file differs; unknown replacement refused')
            return
        temporary = '.' + name + '.rh-' + self.plan['run_id'] + '.partial'
        self.drop_partial(dir_fd, temporary)
        self.fs.create(dir_fd, temporary, [body], user, group, file_mode)
        self.fs.publish(dir_fd, temporary, name)

    def drop_partial(self, dir_fd, temporary):
        # Only this run's own temp name, root-owned single-link regular file: crash leftovers, never foreign files.
        stale = self.fs.entry(dir_fd, temporary)
        if stale is not None:
            require(stale['kind'] == 'file' and stale['user'] == 'root' and stale['nlink'] == 1, 'foreign partial refused')
            self.fs.unlink(dir_fd, temporary)

    # ---- install entry point
    def install(self, plan_bytes, toolchain_bytes, boundary_bytes):
        require(self.b.injected or (sys.platform == 'linux' and os.geteuid() == 0), 'Linux/root only')
        self.boot0 = self.clock()[1]
        request = expiry_request(plan_bytes)
        # Same process, same MainPID: the reviewed executor verifies the independent guard and arms the timer.
        gate = expiry.execute(request, self.runner if self.b.injected else None)
        require(gate.get('expiry_gate') is True and gate.get('installed') is False, 'no expiry gate')
        try:
            self.record = gate['deadline']
            self.end_us = expiry.epoch_us(contract.stamp(self.record['expires_at']))
            guard = expiry.properties(self.runner.run(expiry.SHOW_GUARD))
            self.timeout_us = expiry.duration_us(guard.get('TimeoutStartUSec'))
            real = self.clock()[0]
            self.inputs = load_inputs(plan_bytes, toolchain_bytes, boundary_bytes, self.now_dt(real))
            self.plan = self.inputs['plan']
            require(self.record == {'format': 'rh-fixed-host-deadline/1', 'run_id': self.plan['run_id'],
                                    'expires_at': self.plan['host_expires_at']}, 'plan is not the armed deadline')
            result = self.install_steps()
            self.release()
            return result
        except (Exception, KeyboardInterrupt):
            self.release()
            # No cleanup, timer stop or service revival: verified PID1 shutdown or no gate at all.
            try:
                expiry.shutdown(self.runner)
            except expiry.ShutdownRequested:
                raise
            except (Exception, KeyboardInterrupt):
                raise Refused('installation refused; independent shutdown acceptance unverified') from None
        except BaseException:
            self.release()  # Abrupt exit: descriptors (and their flocks) go exactly as process death would drop them.
            raise

    def release(self):
        while self.held:
            with contextlib.suppress(OSError):
                os.close(self.held.pop())

    def install_steps(self):
        self.gate('run-directory', 5)
        self.run_directory()
        self.gate('identities', 5)
        self.identities()
        self.gate('toolchain', 20)
        self.toolchain()
        self.gate('credential-isolation', 5)
        self.isolation()
        self.gate('volume-fence', 10)
        device = self.volume()
        self.gate('download', 45)
        self.download()
        self.gate('install', 20)
        installed = self.install_members()
        self.gate('secrets', 5)
        password = self.secrets()
        self.gate('postgres', 30)
        self.postgres(password)
        self.gate('marker', 10)
        marker = self.marker(device, installed)
        self.gate('services', 40)
        health = self.services()
        self.gate('backup-timer', 5)
        trigger = self.backup_timer()
        self.gate('cleanup', 5)
        self.cleanup()
        result = {'format': FORMAT, 'run_id': self.plan['run_id'], 'stage': 'host-install-observed-unaccepted',
                  'probe_mode': 'injected' if self.b.injected else 'local-linux-root',
                  'host_installed': not self.b.injected, 'deployable': False, 'accepted': False,
                  'offhost_restore_proved': False, 'marker_sha256': marker, 'installed_tree_sha256': installed['tree_sha256'],
                  'device_snapshot_sha256': device['snapshot_sha256'], 'backup_trigger_us': trigger,
                  'health': health, 'steps': list(self.trace)}
        with self.fs.directory(self.run_path) as fd:
            self.create_exact(fd, 'receipt.json', canonical(result), 'root', 'root', 0o600)
        return result

    # ---- steps
    def run_directory(self):
        run = self.plan['run_id']
        self.run_path = RUN_ROOT + '/' + run
        specs = {RUN_ROOT: {'owner': 'root', 'group': 'root', 'mode': 0o711},
                 self.run_path: {'owner': 'root', 'group': 'root', 'mode': 0o700},
                 self.run_path + '/journal': {'owner': 'root', 'group': 'root', 'mode': 0o700}}
        with self.fs.directory(self.run_path + '/journal', create=specs.get):
            pass
        fd = self.run_fd = self.fs.open_dir(self.run_path)
        self.held.append(fd)
        if self.fs.entry(fd, 'executor.lock') is None:
            self.fs.create(fd, 'executor.lock', [b''], 'root', 'root', 0o600)
        lock = self.fs.open_lock(fd, 'executor.lock')
        self.held.append(lock)
        self.fs.lock_exclusive(lock)
        for name, body in self.inputs['raw'].items():
            self.create_exact(fd, name, body, 'root', 'root', 0o600)
        table, self.sc, self.aws_env = command_table(self.inputs, self.run_path)
        self.proc = self.b.process_factory(table)

    def identities(self):
        tools = self.inputs['toolchain']['tools']
        for name in USERS:
            if self.b.ids.user(name) is None:
                self.run((tools['useradd']['path'], '--system', '--user-group', '--no-create-home', '--home-dir',
                          '/nonexistent', '--shell', '/usr/sbin/nologin', name))
        self.uids = {}
        for name in USERS:
            user, group = self.b.ids.user(name), self.b.ids.group(name)
            require(user is not None and group is not None and 0 < user['uid'] < 1000 and user['gid'] == group['gid']
                    and user['shell'] in NOLOGIN and group['members'] == [], 'restricted service identity required')
            require(self.b.ids.supplementary(name) == [], 'service identity has supplementary/privileged groups')
            self.uids[name] = user['uid']
        require(self.uids['rougehalla'] != self.uids['postgres'], 'distinct service identities required')

    def toolchain(self):
        pins = self.inputs['toolchain']
        for name, item in pins['tools'].items():
            require(self.fs.file_digest(item['path'], executable=True) == item['sha256'],
                    'pinned tool missing or differs; no substitute is downloaded: ' + name)
        for name, path in TOOL_TREES.items():
            require(self.fs.tree_digest(path) == pins['trees'][name], 'pinned tool tree differs: ' + name)

    def isolation(self):
        """IMDS/instance-role credentials reachable by root only; egress quota+rate before any secret/role use."""
        nft = self.inputs['toolchain']['tools']['nft']['path']
        listing = (nft, '--json', 'list', 'table', 'inet', NFT_TABLE)
        code, out = self.proc.run(listing, timeout=self.remaining())
        if code != 0:
            self.run((nft, '-f', '-'), stdin=nft_ruleset(self.uids, self.inputs['boundary']).encode())
            out = self.run(listing)
        verify_nft(out.decode('utf-8'), self.uids, self.inputs['boundary'])
        with self.fs.directory(UNIT_DIR) as fd:
            self.create_exact(fd, EGRESS_UNIT, egress_unit(self.plan['run_id'], nft), 'root', 'root', 0o644)

    def volume(self):
        """Hold the data directory and the exclusive writer fence, then revalidate ancestry and identity."""
        self.data_fd = self.fs.open_dir(DATA)
        self.held.append(self.data_fd)
        info = self.fs.describe(os.fstat(self.data_fd))
        require(info['user'] == 'root' and not info['mode'] & 0o022 and info['mode'] & 0o001, 'retained mount root ownership')
        owner, owner_info = self.fs.read(self.data_fd, OWNER_RECORD, 4096)
        volume = self.plan['volume']
        require((owner_info['user'], owner_info['group'], owner_info['mode']) == ('root', 'root', 0o600)
                and contract.strict_json(owner.decode('utf-8')) == {'format': 'rh-retained-volume-owner/1',
                    'volume_id': volume['id'], 'uuid': volume['uuid'], 'run_id': self.plan['run_id']},
                'retained volume is not owned by this run; never adopt or format foreign media')
        entries = set(self.fs.listdir(self.data_fd))
        require(MARKER not in entries, 'installation marker already exists; restart never revives writers')
        for unit in APP_UNITS:
            state = self.show(unit)
            require(state.get('ActiveState') == 'inactive', 'an owned writer/service is already active')
        if LOCK not in entries:
            self.create_exact(self.data_fd, LOCK, b'', 'root', 'rougehalla', 0o640)
        lock = self.fs.open_lock(self.data_fd, LOCK)
        self.held.append(lock)
        self.lock_fd = lock
        d = self.fs.describe(os.fstat(lock))
        require((d['kind'], d['user'], d['group'], d['mode'], d['nlink']) == ('file', 'root', 'rougehalla', 0o640, 1),
                'writer lock ownership differs')
        self.fs.lock_exclusive(lock)
        device = host_device.collect_and_validate(volume, self.b.probe)
        require(self.fs.device(self.data_fd) == device['mounted_device'], 'held data directory is not the validated device')
        allowed = {'lost+found', OWNER_RECORD, LOCK, *[v['name'] for v in self.layout['volume']]}
        foreign = sorted(set(self.fs.listdir(self.data_fd)) - allowed)
        require(not foreign, 'foreign state on retained volume; refused without modification')
        lost = self.fs.entry(self.data_fd, 'lost+found')
        require(lost is None or (lost['kind'], lost['user'], lost['mode']) == ('dir', 'root', 0o700), 'lost+found shape')
        for item in self.layout['volume']:
            spec = (item['owner'], item['group'], mode(item['mode']))
            existing = self.fs.entry(self.data_fd, item['name'])
            if existing is None:
                self.fs.mkdir(self.data_fd, item['name'], *spec)
            else:
                require((existing['kind'], existing['user'], existing['group'], existing['mode']) == ('dir',) + spec,
                        'retained volume directory ownership differs')
            fd = os.open(item['name'], DIRFLAGS, dir_fd=self.data_fd)
            try:
                require(self.fs.device(fd) == device['mounted_device'], 'volume directory left the retained device')
                contents = self.fs.listdir(fd)
            finally:
                os.close(fd)
            if item['name'] == 'pgdata':
                require(not contents or self.journal_has('pg-init'), 'unjournaled PostgreSQL data refused; never reinitialize')
            else:
                require(not contents, 'pending/foreign bytes in ' + item['name'] + ' refused; never overwrite or discard')
        self.device = device
        return device

    def download(self):
        fd = self.run_fd
        stale = self.fs.entry(fd, BUNDLE)
        if stale is not None:  # This run's own earlier attempt in its private 0700 directory.
            require(stale['kind'] == 'file' and stale['user'] == 'root' and stale['nlink'] == 1, 'foreign bundle refused')
            self.fs.unlink(fd, BUNDLE)
        out = self.run(transfer.get_command(self.plan))
        require(len(out) <= 65536, 'bounded transfer metadata')
        metadata = contract.strict_json(out.decode('utf-8'))
        require(type(metadata) is dict, 'transfer metadata object')
        self.bundle_path = Path(self.fs.real(self.run_path + '/' + BUNDLE))
        transfer.verify_download(self.plan, self.bundle_path, metadata)
        self.bundle_members = transfer.inspect_bundle(self.bundle_path, self.plan['run_id'])

    def destinations(self, manifest):
        files = {i['member']: i for i in self.layout['files']}
        planned = {}
        for item in manifest['files']:
            name = item['path']
            if name in files:
                planned[name] = dict(files[name], bytes=item['bytes'], sha256=item['sha256'], file_mode=mode(files[name]['mode']))
                continue
            tree = next((t for t in self.layout['trees'] if name.startswith(t['prefix'])), None)
            require(tree is not None, 'undeclared bundle member refused')
            rest = name[len(tree['prefix']):]
            require(rest and all(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}', p) for p in rest.split('/')),
                    'unsafe tree member name')
            planned[name] = {'member': name, 'path': tree['path'] + '/' + rest, 'owner': tree['owner'],
                             'group': tree['group'], 'file_mode': mode(tree['file_mode']), 'dir_mode': mode(tree['dir_mode']),
                             'tree': tree['path'], 'bytes': item['bytes'], 'sha256': item['sha256']}
        require(set(files) <= set(planned), 'required bundle member missing')
        for tree in self.layout['trees']:
            require(any(p.get('tree') == tree['path'] for p in planned.values()), 'empty declared tree')
        return planned

    def ensure_etc(self):
        """/etc/rougehalla: created root 0700 by expiry; the private config contract is root:rougehalla 0750."""
        fd = self.fs.open_dir(ETC)
        try:
            d = self.fs.describe(os.fstat(fd))
            state = (d['user'], d['group'], d['mode'])
            require(state in (('root', 'root', 0o700), ('root', 'rougehalla', 0o750)), 'private config directory differs')
            if state != ('root', 'rougehalla', 0o750):
                self.fs.set_owner_mode(fd, 'root', 'rougehalla', 0o750)
            listing = set(self.fs.listdir(fd))
            known = {expiry.STATE, 'expiry-executor.lock', SECRETS, 'Caddyfile'}
            require(listing <= known | {n for n in listing if n.startswith('.') and n.endswith('.rh-' + self.plan['run_id'] + '.partial')},
                    'foreign private configuration refused')
        finally:
            os.close(fd)

    def install_members(self):
        with tarfile.open(self.bundle_path, 'r:') as archive:
            manifest = contract.strict_json(archive.extractfile('manifest.json').read(1 << 20).decode('utf-8'))
            planned = self.destinations(manifest)
            require(len(planned) == self.bundle_members, 'manifest/inspection disagreement')
            self.ensure_etc()
            dirs = {d['path']: {'owner': d['owner'], 'group': d['group'], 'mode': mode(d['mode'])} for d in self.layout['directories']}
            for item in planned.values():
                if 'tree' in item:
                    parent = PurePosixPath(item['path']).parent
                    while str(parent) != item['tree']:
                        dirs.setdefault(str(parent), {'owner': item['owner'], 'group': item['group'], 'mode': item['dir_mode']})
                        parent = parent.parent
            members = {m.name: m for m in archive.getmembers()}
            for name in sorted(planned):
                item = planned[name]
                parent, base = item['path'].rsplit('/', 1)
                with self.fs.directory(parent, create=dirs.get) as fd:
                    self.install_one(fd, base, archive.extractfile(members[name]), item)
        tree_rows = []
        for name in sorted(planned):
            item = planned[name]
            parent, base = item['path'].rsplit('/', 1)
            with self.fs.directory(parent) as fd:
                data, info = self.fs.read(fd, base, item['bytes'])
            require(sha256(data) == item['sha256'] and (info['user'], info['group'], info['mode']) ==
                    (item['owner'], item['group'], item['file_mode']), 'installed member readback differs')
            tree_rows.append([item['path'], item['sha256'], info['user'], info['group'], info['mode']])
        self.unit_texts = {}
        with self.fs.directory(UNIT_DIR) as fd:
            for unit in APP_UNITS:
                self.unit_texts[unit] = self.fs.read(fd, unit, 16384)[0].decode('utf-8')
        # Worst case: a service starts at the very end of the guard window.
        self.lifetimes = check_units(self.unit_texts, self.plan, self.clock()[0] + self.timeout_us)
        self.check_runtime_separation()
        with self.fs.directory('/opt/rougehalla') as fd:
            identity = contract.strict_json(self.fs.read(fd, 'runtime-identity.json', 4096)[0].decode('utf-8'))
        require(type(identity) is dict and set(identity) == {'format', 'protocol', 'content_hash', 'migration_version'}
                and identity['format'] == 'rh-runtime-identity/1' and type(identity['protocol']) is int
                and type(identity['migration_version']) is int and identity['migration_version'] > 0
                and type(identity['content_hash']) is str and re.fullmatch('[0-9a-f]{16}', identity['content_hash']),
                'runtime identity member')
        self.identity = identity
        self.journal('install')
        return {'tree_sha256': sha256(canonical(tree_rows)), 'count': len(tree_rows)}

    def install_one(self, dir_fd, name, stream, item):
        existing = self.fs.entry(dir_fd, name)
        if existing is not None:  # Crash/restart of THIS run: only byte/owner/mode-identical is accepted.
            data, info = self.fs.read(dir_fd, name, item['bytes'])
            require(sha256(data) == item['sha256'] and (info['user'], info['group'], info['mode']) ==
                    (item['owner'], item['group'], item['file_mode']), 'existing destination differs; unknown replacement refused')
            return
        temporary = '.' + name + '.rh-' + self.plan['run_id'] + '.partial'
        self.drop_partial(dir_fd, temporary)
        size, digest = self.fs.create(dir_fd, temporary, iter(lambda: stream.read(1 << 20), b''),
                                      item['owner'], item['group'], item['file_mode'])
        if (size, digest) != (item['bytes'], item['sha256']):
            self.fs.unlink(dir_fd, temporary)
            raise Refused('member bytes changed during install')
        self.fs.publish(dir_fd, temporary, name)

    def load_installed(self, path, name):
        spec = importlib.util.spec_from_file_location(name, self.fs.real(path))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def check_runtime_separation(self):
        """Source keeps its durable spool on the retained device; Training has no banking/result spool at all."""
        runtime = self.load_installed('/opt/rougehalla/preparation/run-runtime.py', 'rh_installed_run_runtime')
        source = runtime.command('source', 'postgresql://unused', self.plan['run_id'])
        training = runtime.command('training', 'postgresql://unused', self.plan['run_id'])
        require(source[source.index('--result-spool') + 1] == DATA + '/spool-source' and source.count('--result-spool') == 1,
                'Source durable spool binding')
        require('--result-spool' not in training and source[source.index('--max-rooms') + 1] == '16'
                and training[training.index('--max-rooms') + 1] == '1', 'Training must have no result spool')
        require(source[source.index('--instance-id') + 1] != training[training.index('--instance-id') + 1], 'distinct instances')
        archive = self.load_installed('/opt/rougehalla/preparation/backup_archive.py', 'rh_installed_backup_archive')
        archive.check_training_spool(Path(self.fs.real(DATA + '/spool-training')))

    def secrets(self):
        with self.fs.directory(ETC) as fd:
            if self.fs.entry(fd, SECRETS) is None:
                require(not self.journal_has('pg-role'), 'database role exists without its private secret')
                out = self.run((self.inputs['toolchain']['tools']['python3']['path'], '-I',
                                '/opt/rougehalla/preparation/init-runtime-secrets.py'))
                require(out == SECRET_CREATED, 'secret generator output differs')
            data, info = self.fs.read(fd, SECRETS, 4096)
        require((info['user'], info['group'], info['mode']) == ('root', 'rougehalla', 0o640), 'runtime secret ownership')
        try:
            value = contract.strict_json(data.decode('utf-8'))
        except ValueError:
            raise Refused('partial private secret requires operator review; never regenerated') from None
        require(type(value) is dict and set(value) == {'database_password', 'playtest_passcode'}
                and all(type(v) is str and re.fullmatch('[0-9a-f]{64}', v) for v in value.values()),
                'partial private secret requires operator review; never regenerated')
        self.journal('secrets')
        return value['database_password']

    def psql(self, socket_dir, database, query):
        tools = self.inputs['toolchain']['tools']
        out = self.run((tools['psql']['path'], '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', socket_dir,
                        '-d', database, '-c', query))
        return out.decode('utf-8').strip()

    def pg_settings(self, socket_dir, listen):
        rows = dict(line.split('=', 1) for line in self.psql(socket_dir, 'postgres', Q_SETTINGS).splitlines())
        require(rows == {'fsync': 'on', 'full_page_writes': 'on', 'listen_addresses': listen,
                         'log_min_error_statement': 'panic', 'log_statement': 'none',
                         'password_encryption': 'scram-sha-256', 'synchronous_commit': 'on'},
                'PostgreSQL durability/redaction/listener settings differ')

    def postgres(self, password):
        tools = self.inputs['toolchain']['tools']
        sock = RUN_ROOT + '/' + self.plan['run_id'] + '.pg'
        owned = {PGDATA: {'owner': 'postgres', 'group': 'postgres', 'mode': 0o700}}
        with self.fs.directory(PGDATA, create=owned.get) as fd:
            contents = self.fs.listdir(fd)
        if not contents:
            self.run((tools['initdb']['path'], '-D', PGDATA, '--auth-local=peer', '--auth-host=scram-sha-256',
                      '--encoding=UTF8', '--locale=C', '--data-checksums', '--username=postgres', '--no-instructions'))
            with self.fs.directory(PGDATA, create=owned.get) as fd:
                require(self.fs.entry(fd, 'PG_VERSION') is not None, 'initdb produced no cluster')
            self.journal('pg-init')
        spec = {RUN_ROOT: {'owner': 'root', 'group': 'root', 'mode': 0o711},
                sock: {'owner': 'postgres', 'group': 'postgres', 'mode': 0o700}}
        with self.fs.directory(sock, create=spec.get):
            pass
        self.gate('postgres-start', 20)  # Recheck guard/expiry between initdb and starting a database server.
        options = ('-c config_file=' + PG_ETC + '/postgresql.conf -c hba_file=' + PG_ETC + "/pg_hba.conf -c listen_addresses='' "
                   '-c unix_socket_directories=' + sock)
        self.run((tools['pg_ctl']['path'], 'start', '-D', PGDATA, '-w', '-t', '30', '-s', '-l', sock + '/provision.log', '-o', options))
        try:
            # Redaction and durability are observed BEFORE the private password is sent (stdin only).
            self.pg_settings(sock, '')
            if self.psql(sock, 'postgres', Q_ROLE) == '':
                require(not self.journal_has('pg-role') and self.psql(sock, 'postgres', Q_DATABASE) == '',
                        'partial database provisioning requires operator review')
                self.run((tools['psql']['path'], '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-d', 'postgres', '-f', '-'),
                         stdin=host_material.pg_role_input(password).encode())
                self.journal('pg-role')
            else:
                require(self.journal_has('pg-role'), 'unjournaled application role refused; password binding unknown')
            observed = {'role': self.psql(sock, 'postgres', Q_ROLE), 'database': self.psql(sock, 'postgres', Q_DATABASE),
                        'members': self.psql(sock, 'postgres', Q_MEMBERS), 'login': self.psql(sock, 'postgres', Q_LOGIN),
                        'scram': self.psql(sock, 'postgres', Q_SCRAM)}
            require(observed == EXPECTED_ROLE, 'application role is not the restricted non-superuser owner')
        finally:
            self.run((tools['pg_ctl']['path'], 'stop', '-D', PGDATA, '-m', 'fast', '-w', '-t', '30', '-s'))

    def marker(self, device, installed):
        again = host_device.collect_and_validate(self.plan['volume'], self.b.probe)
        keys = ('root_device', 'mounted_device', 'root_physical_ancestors', 'data_physical_ancestors', 'uuid', 'ebs_serial', 'volume_id')
        require({k: again[k] for k in keys} == {k: device[k] for k in keys}, 'device identity changed while fenced')
        require(self.fs.device(self.data_fd) == again['mounted_device'], 'held data directory left the device')
        lock = self.fs.entry(self.data_fd, LOCK)
        require(lock is not None and lock['inode'] == os.fstat(self.lock_fd).st_ino, 'writer fence inode replaced')
        plan = self.plan
        body = canonical({'format': 'rh-installation-verified/1', 'run_id': plan['run_id'],
                          'host_expires_at': plan['host_expires_at'], 'plan_sha256': sha256(self.inputs['raw']['plan.json']),
                          'artifact': {k: plan['artifact'][k] for k in ('bucket', 'key', 'version_id', 'bytes', 'sha256')},
                          'volume': {'id': plan['volume']['id'], 'uuid': plan['volume']['uuid']},
                          'device_snapshot_sha256': again['snapshot_sha256'], 'installed_tree_sha256': installed['tree_sha256'],
                          'runtime_identity': self.identity,
                          'toolchain_receipt_sha256': plan['toolchain_receipt_sha256'],
                          'boundary_receipt_sha256': plan['boundary_receipt_sha256'], 'deployable': False, 'accepted': False})
        self.create_exact(self.data_fd, MARKER, body, 'root', 'rougehalla', 0o640)
        self.journal('marker')
        return sha256(body)

    def check_loaded(self, unit, user):
        p = self.show(unit)
        require(p.get('Id') == unit and p.get('LoadState') == 'loaded' and p.get('FragmentPath') == UNIT_DIR + '/' + unit
                and p.get('DropInPaths') == '' and p.get('NeedDaemonReload') == 'no' and p.get('User') == user
                and p.get('UnitFileState') in ('disabled', 'static'), 'loaded unit differs, has overrides or is enabled: ' + unit)
        return p

    def started(self, unit):
        p = self.show(unit)
        return p.get('ActiveState') == 'active' and p.get('SubState') in ('running', 'exited')

    def http_json(self, port, path):
        status, body = self.b.net.http(port, path)
        require(status == 200 and len(body) <= 65536, 'local probe status')
        return contract.strict_json(body.decode('utf-8'))

    def services(self):
        # Release the exclusive fence only after the marker; launchers take the shared side through exec.
        os.close(self.lock_fd)
        self.held.remove(self.lock_fd)
        self.systemctl('daemon-reload')
        users = {POSTGRES_UNIT: 'postgres', SOURCE_UNIT: 'rougehalla', TRAINING_UNIT: 'rougehalla',
                 CADDY_UNIT: 'rougehalla', EGRESS_UNIT: 'root'}
        for unit, user in users.items():
            require(self.check_loaded(unit, user).get('ActiveState') == 'inactive', 'unit active before ordered start')
        health = {}
        identity = self.identity
        def start(unit, reserve):
            self.gate('start:' + unit, reserve)
            self.systemctl('start', unit)
            self.wait(lambda: self.started(unit), 10, 'unit did not become active: ' + unit)
        start(POSTGRES_UNIT, 15)
        self.wait(lambda: self.pg_settings(SERVICE_SOCKET, '127.0.0.1') is None, 10, 'service PostgreSQL settings')
        start(SOURCE_UNIT, 20)
        self.wait(lambda: self.http_json(7777, '/readyz') == {'ok': True, 'state': 'ready', 'storage': 'ok'}, 15, 'Source not ready')
        schema = {'migration': self.psql(SERVICE_SOCKET, 'rougehalla', Q_MIGRATION),
                  'foreign_owned_tables': self.psql(SERVICE_SOCKET, 'rougehalla', Q_OWNERS),
                  'seeded_profiles': self.psql(SERVICE_SOCKET, 'rougehalla', Q_SEED)}
        require(schema == {'migration': str(identity['migration_version']), 'foreign_owned_tables': '0', 'seeded_profiles': '0'},
                'schema/migration/seed state differs')
        start(TRAINING_UNIT, 15)
        self.wait(lambda: self.b.net.http(7779, '/healthz') == (200, b'ok'), 10, 'Training not healthy')
        for port, rooms in ((7777, 16), (7779, 1)):
            info = self.http_json(port, '/info')
            require(type(info) is dict and info.get('protocol') == identity['protocol']
                    and info.get('contentHash') == identity['content_hash'] and info.get('maxRooms') == rooms,
                    'runtime identity differs on port ' + str(port))
        start(EGRESS_UNIT, 5)
        start(CADDY_UNIT, 35)
        self.wait(lambda: self.b.net.https('/healthz') == (200, b'ok'), 30, 'public TLS route not verified')
        require(self.b.net.https('/training/healthz') == (200, b'ok'), 'Training public route')
        for path in ('/control', '/training/api'):
            require(self.b.net.https(path)[0] == 404, 'private path must not be proxied')
        status, body = self.b.net.https('/info')
        public = contract.strict_json(body.decode('utf-8')) if status == 200 else None
        require(type(public) is dict and public.get('contentHash') == identity['content_hash'], 'public identity route')
        health.update(schema=schema, routes='verified-local', lifetimes=self.lifetimes)
        return health

    def backup_timer(self):
        bodies, trigger = backup_material(self.plan, self.inputs['toolchain']['tools']['python3']['path'])
        with self.fs.directory(UNIT_DIR) as fd:
            for name, body in bodies.items():
                self.create_exact(fd, name, body, 'root', 'root', 0o644)
        self.systemctl('daemon-reload')
        self.check_loaded(BACKUP_SERVICE, 'root')
        self.systemctl('start', BACKUP_TIMER)
        p = self.show(BACKUP_TIMER, expiry.TIMER_PROPS)
        require(p.get('ActiveState') == 'active' and p.get('SubState') == 'waiting' and p.get('Unit') == BACKUP_SERVICE
                and p.get('UnitFileState') == 'static' and p.get('DropInPaths') == ''
                and expiry.timestamp_us(p.get('NextElapseUSecRealtime')) == trigger, 'backup timer is not armed at its trigger')
        return trigger

    def cleanup(self):
        """Owned scope only: this run's verified download. Ciphertext, marker, secrets, data and journal are kept."""
        fd = self.run_fd
        entry = self.fs.entry(fd, BUNDLE)
        require(entry is not None and entry['kind'] == 'file' and entry['user'] == 'root' and entry['nlink'] == 1,
                'owned download missing')
        self.fs.unlink(fd, BUNDLE)

    # ---- backup entry point (separate unit, after serving)
    def backup(self, run_id):
        require(self.b.injected or (sys.platform == 'linux' and os.geteuid() == 0), 'Linux/root only')
        require(type(run_id) is str and re.fullmatch(r'[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', run_id), 'run identifier')
        self.run_path = RUN_ROOT + '/' + run_id
        with self.fs.directory(self.run_path) as fd:
            raw = {name: self.fs.read(fd, name, 65536)[0] for name in ('plan.json', 'toolchain.json', 'boundary.json')}
            lock = self.fs.open_lock(fd, 'executor.lock')
        try:
            self.fs.lock_exclusive(lock)
            plan = contract.strict_json(raw['plan.json'].decode('utf-8'))
            require(type(plan) is dict and plan.get('run_id') == run_id and sha256(raw['toolchain.json']) ==
                    plan.get('toolchain_receipt_sha256') and sha256(raw['boundary.json']) == plan.get('boundary_receipt_sha256'),
                    'stored run inputs differ')
            self.plan = plan
            self.inputs = {'plan': plan, 'raw': raw,
                           'toolchain': parse_toolchain(contract.strict_json(raw['toolchain.json'].decode('utf-8'))),
                           'boundary': parse_boundary(contract.strict_json(raw['boundary.json'].decode('utf-8')))}
            self.record = {'format': 'rh-fixed-host-deadline/1', 'run_id': run_id, 'expires_at': plan['host_expires_at']}
            self.end_us = expiry.epoch_us(contract.stamp(plan['host_expires_at']))
            with self.fs.directory(ETC) as etc:
                require(self.fs.read(etc, expiry.STATE, 8192)[0] == expiry.material(self.record)[expiry.STATE],
                        'original deadline record changed')
            expiry.verify_units(self.runner, self.end_us)
            expiry.no_shutdown_pending(self.runner)
            with self.fs.directory(DATA) as data:
                marker = contract.strict_json(self.fs.read(data, MARKER, 65536)[0].decode('utf-8'))
            require(marker.get('run_id') == run_id and marker.get('plan_sha256') == sha256(raw['plan.json']),
                    'backup is not bound to this installation')
            table, self.sc, _ = command_table(self.inputs, self.run_path)
            self.proc = self.b.process_factory(table)
            self.boot0, self.timeout_us = self.clock()[1], (plan['backup_seconds'] + DRAIN_SECONDS) * 1000000 + GUARD_SAFETY_US
            real = self.clock()[0]
            require(real + DRAIN_SECONDS * 1000000 < self.end_us, 'no drain time before fixed expiry')
            output = self.run_path + '/' + CIPHERTEXT
            out = self.run((self.inputs['toolchain']['tools']['bash']['path'], '/opt/rougehalla/preparation/backup.sh',
                            self.inputs['boundary']['age_recipient'], output))
            require(out.endswith(BACKUP_DONE), 'existing backup producer did not report completion')
            for unit in (SOURCE_UNIT, TRAINING_UNIT):
                require(self.show(unit).get('ActiveState') == 'inactive', 'writers not quiesced after producer')
            with self.fs.directory(self.run_path) as fd:
                info = self.fs.entry(fd, CIPHERTEXT)
            require(info is not None and (info['kind'], info['user'], info['mode'], info['nlink']) == ('file', 'root', 0o600, 1),
                    'ciphertext is not a private owned file')
            path = Path(self.fs.real(output))
            size, digest = transfer.file_digest(path, plan['backup']['max_bytes'])
            command = tuple(transfer.put_ciphertext_command(plan, path, digest))
            table[command] = ('root', self.aws_env_for(table))
            self.proc = self.b.process_factory(table)
            require(self.clock()[0] + DRAIN_SECONDS * 1000000 < self.end_us, 'no upload time before fixed expiry')
            response = contract.strict_json(self.run(command).decode('utf-8'))
            receipt = transfer.verify_put_response(plan, response, digest)
            receipt.update(format='rh-offhost-upload-receipt/1', ciphertext_bytes=size, local_ciphertext_retained=True,
                           independent_restore_required=True, offhost_restore_proved=False, accepted=False)
            with self.fs.directory(self.run_path) as fd:
                self.create_exact(fd, 'offhost-upload-receipt.json', canonical(receipt), 'root', 'root', 0o600)
            return receipt
        finally:
            os.close(lock)

    @staticmethod
    def aws_env_for(table):
        return next(env for argv, (user, env) in table.items() if 'get-object' in argv)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('install')
    for name in ('--plan', '--toolchain-receipt', '--boundary-receipt'):
        p.add_argument(name, required=True, type=Path)
    p = sub.add_parser('backup')
    p.add_argument('--run-id', required=True)
    args = parser.parse_args(argv)
    try:
        require(sys.platform == 'linux' and os.geteuid() == 0, 'Linux/root only; no host action performed')
        executor = Executor(Boundaries.linux())
        if args.command == 'install':
            raw = [path.read_bytes() for path in (args.plan, args.toolchain_receipt, args.boundary_receipt)]
            result = executor.install(*raw)
        else:
            result = executor.backup(args.run_id)
        print(json.dumps(result, sort_keys=True))
        return 0
    except expiry.ShutdownRequested:
        print('host executor refused; PID1 accepted independent shutdown; no work gate', file=sys.stderr)
        return 3
    except (ValueError, OSError, KeyError, TypeError, tarfile.TarError, subprocess.SubprocessError):
        print('host executor refused; no work gate', file=sys.stderr)
        return 2


if __name__ == '__main__':
    def cancelled(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, cancelled)
    raise SystemExit(main())
