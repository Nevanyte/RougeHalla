"""Host executor against real private temporary files plus independent fake OS/PID1/PG/S3/kernel models.

Nothing here operates the machine: no systemd, nft, PostgreSQL, AWS, IMDS, mount or device write is invoked.
Assertions read effects the boundaries actually recorded (inodes, bytes, owners, SQL received, unit state),
never echoes of the plan. Passing tests do not mean a host was installed, deployed or accepted.
"""
import base64
import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import contract
import expiry_executor as e
import host_device
import host_executor as x
from test_expiry_executor import FakeLinux
from test_host_device import SyntheticLinux, UUID

RUN = '20261109t120000z-abcdef'
VOLUME = 'vol-0123456789abcdef0'
STAGING = Path(__file__).resolve().parent.parent
RUNTIME_SECONDS = 10800
IDENTITY = {'format': 'rh-runtime-identity/1', 'protocol': 14, 'content_hash': '7c6a633f68c2cc72', 'migration_version': 2}
RECIPIENT = 'age1' + 'q' * 58


class SimulatedKill(BaseException):
    """Abrupt process death: nothing in the executor may run after it."""


class FakeIds:
    def __init__(self):
        self.users, self.groups, self.extra = {}, {'root': {'gid': 0, 'members': []}}, {}

    def user(self, name):
        return copy.deepcopy(self.users.get(name)) if name != 'root' else {'uid': 0, 'gid': 0, 'shell': '/bin/bash'}

    def group(self, name):
        return copy.deepcopy(self.groups.get(name))

    def supplementary(self, name):
        return sorted(self.extra.get(name, []))

    def add(self, name, uid):
        self.users[name] = {'uid': uid, 'gid': uid, 'shell': '/usr/sbin/nologin'}
        self.groups[name] = {'gid': uid, 'members': []}


class TmpFS(x.HostFS):
    """Real descriptor operations under a private directory; logical owners recorded per real inode."""
    def __init__(self, ids, base):
        super().__init__(ids, base)
        self.owners = {}

    def owner(self, info):
        key = (info.st_dev, info.st_ino)
        if key in self.owners:
            return self.owners[key]
        return ('root', 'root') if info.st_uid == os.geteuid() else ('#foreign', '#foreign')

    def chown(self, fd, user, group):
        assert self.ids.user(user) is not None and self.ids.group(group) is not None, 'chown to unknown identity'
        info = os.fstat(fd)
        self.owners[(info.st_dev, info.st_ino)] = (user, group)

    def unlink(self, dir_fd, name):
        info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        if info.st_nlink == 1:
            self.owners.pop((info.st_dev, info.st_ino), None)
        super().unlink(dir_fd, name)

    def set_owner(self, path, user, group):
        info = os.lstat(self.real(path))
        self.owners[(info.st_dev, info.st_ino)] = (user, group)

    def owner_of(self, path):
        return self.owner(os.lstat(self.real(path)))


class ExpiryModel(FakeLinux):
    """The reviewed fake PID1 from the expiry tests, with its state/unit directories inside the fake host."""
    def __init__(self, scratch, base):
        scratch.mkdir()
        super().__init__(scratch)
        self.state, self.units = base / 'etc/rougehalla', base / 'etc/systemd/system'


class DeviceModel(SyntheticLinux):
    """Reviewed synthetic kernel/lsblk/blkid, re-keyed so the data mount identity is the real tmpdir st_dev."""
    def __init__(self, data_identity):
        super().__init__()
        old = self.data
        for table in (self.nodes, self.kernel_parents, self.kernel_serials):
            table[data_identity] = table.pop(old)
        self.data = data_identity


def unit_text_fields(text):
    fields = {}
    for line in text.splitlines():
        if '=' in line and not line.startswith('#'):
            key, _, value = line.partition('=')
            fields.setdefault(key, value)
    return fields


class FakePostgres:
    DEFAULTS = {'fsync': 'on', 'full_page_writes': 'on', 'listen_addresses': 'localhost', 'log_min_error_statement': 'error',
                'log_statement': 'none', 'password_encryption': 'scram-sha-256', 'synchronous_commit': 'on'}

    def __init__(self):
        self.initialized, self.running, self.socket = False, None, None
        self.settings, self.role, self.database, self.tables = {}, None, None, {}
        self.migration, self.profiles, self.received_sql = 0, 0, []
        self.force = {}

    @staticmethod
    def config(text):
        result = dict(FakePostgres.DEFAULTS)
        for line in text.splitlines():
            line = line.split('#', 1)[0].strip()
            if '=' in line:
                key, _, value = line.partition('=')
                result[key.strip()] = value.strip().strip("'")
        return {k: result[k] for k in FakePostgres.DEFAULTS}

    def answer(self, query):
        if query == x.Q_SETTINGS:
            return '\n'.join(k + '=' + v for k, v in sorted(self.settings.items()))
        role = self.role
        if query == x.Q_ROLE:
            if role is None:
                return ''
            flags = [role[k] for k in ('super', 'createdb', 'createrole', 'replication', 'bypassrls', 'login')]
            if self.force.get('superuser'):
                flags[0] = True
            return '|'.join('t' if f else 'f' for f in flags)
        if query == x.Q_DATABASE:
            return '' if self.database is None else self.database['owner'] + '|' + self.database['acl']
        if query == x.Q_MEMBERS:
            return '0'
        if query == x.Q_LOGIN:
            return ','.join(['postgres'] + (['rougehalla'] if role and role['login'] else []))
        if query == x.Q_SCRAM:
            return 'SCRAM-SHA-256$' if role and self.settings.get('password_encryption') == 'scram-sha-256' else ''
        if query == x.Q_MIGRATION:
            return str(self.migration)
        if query == x.Q_OWNERS:
            return str(sum(owner != 'rougehalla' for owner in self.tables.values()))
        if query == x.Q_SEED:
            return str(self.profiles)
        raise AssertionError('unexpected query')

    def execute(self, sql):
        self.received_sql.append(sql)
        role = re.search(r"CREATE ROLE (\w+) ([A-Z ]+) PASSWORD '([0-9a-f]+)';", sql)
        attrs = role.group(2).split()
        self.role = {'name': role.group(1), 'password': role.group(3), 'login': 'LOGIN' in attrs,
                     **{k: k.upper() in attrs for k in ('super', 'createdb', 'createrole', 'replication', 'bypassrls')}}
        self.role['super'] = 'SUPERUSER' in attrs
        db = re.search(r'CREATE DATABASE (\w+) OWNER (\w+);', sql)
        revoked = 'REVOKE ALL ON DATABASE ' + db.group(1) + ' FROM PUBLIC;' in sql
        owner = db.group(2)
        self.database = {'owner': owner, 'acl': owner + '=CTc/' + owner if revoked else ''}


class FakeHost:
    """Fake process/service/kernel/network side. Commands outside the executor's own table are test failures."""
    def __init__(self, world):
        self.w, self.table, self.calls = world, None, []
        self.nft, self.units, self.state = None, {}, {}
        self.pg = FakePostgres()
        self.s3_body, self.s3_version, self.uploads = None, 'synthetic-version', []
        self.http_up, self.hooks, self.faults = set(), [], {}
        self.server_identity = {'protocol': IDENTITY['protocol'], 'contentHash': IDENTITY['content_hash']}

    def path(self, host_path):
        return Path(self.w.fs.real(host_path))

    def run(self, argv, stdin=None, timeout=30):
        assert self.table is not None and argv in self.table, 'executor ran a command outside its allowlist'
        assert type(timeout) is int and timeout >= 1
        self.calls.append((argv, stdin))
        for predicate, action in list(self.hooks):
            if predicate(argv):
                self.hooks.remove((predicate, action))
                action()
        user, env = self.table[argv]
        tool = Path(argv[0]).name
        if tool == 'useradd':
            self.w.ids.add(argv[-1], {'rougehalla': 998, 'postgres': 997}[argv[-1]])
            return 0, b''
        if tool == 'nft':
            return self.nft_command(argv, stdin)
        if tool == 'aws':
            assert user == 'root' and 'AWS_ACCESS_KEY_ID' not in env and env['AWS_SHARED_CREDENTIALS_FILE'] == '/dev/null'
            return self.aws(argv)
        if tool.startswith('python3'):
            return self.init_secrets()
        if tool in ('initdb', 'pg_ctl', 'psql'):
            assert user == 'postgres', 'database tool must drop to postgres'
            return self.postgres_tool(tool, argv, stdin)
        if tool == 'systemctl':
            return self.systemctl(argv)
        if tool == 'bash':
            return self.backup_producer(argv)
        raise AssertionError('no model for command')

    # ---- kernel firewall model: parses the loaded text into normalized JSON like the real listing
    def nft_command(self, argv, stdin):
        if argv[1] == '-f':
            text = stdin.decode()
            rules = []
            def match(op, left, right):
                return {'match': {'op': op, 'left': left, 'right': right}}
            skuid = {'meta': {'key': 'skuid'}}
            outside = match('!=', {'meta': {'key': 'oifname'}}, 'lo')
            def normal(value):
                unit = 0
                while value % 1024 == 0 and unit < 3:
                    value //= 1024; unit += 1
                return value, ['bytes', 'kbytes', 'mbytes', 'gbytes'][unit]
            for line in text.splitlines():
                line = line.strip()
                if m := re.fullmatch(r'(ip6?) daddr (\S+) meta skuid != (\d+) drop', line):
                    rules.append([match('==', {'payload': {'protocol': m[1], 'field': 'daddr'}}, m[2]), match('!=', skuid, int(m[3])), {'drop': None}])
                elif m := re.fullmatch(r'meta skuid (\d+) oifname != "lo" drop', line):
                    rules.append([match('==', skuid, int(m[1])), outside, {'drop': None}])
                elif m := re.fullmatch(r'meta skuid (\d+) oifname != "lo" quota over (\d+) bytes drop', line):
                    val, unit = normal(int(m[2]))
                    rules.append([match('==', skuid, int(m[1])), outside, {'quota': {'val': val, 'val_unit': unit, 'inv': True, 'used': 0, 'used_unit': 'bytes'}}, {'drop': None}])
                elif m := re.fullmatch(r'meta skuid (\d+) oifname != "lo" limit rate over (\d+) bytes/second drop', line):
                    val, unit = normal(int(m[2]))
                    rules.append([match('==', skuid, int(m[1])), outside, {'limit': {'rate': val, 'rate_unit': unit, 'per': 'second', 'inv': True}}, {'drop': None}])
            for drop in self.faults.get('nft_drop', []):
                rules.pop(drop)
            self.nft = rules
            return 0, b''
        if self.nft is None:
            return 1, b''
        rows = [{'metainfo': {'version': 'synthetic', 'json_schema_version': 1}},
                {'table': {'family': 'inet', 'name': x.NFT_TABLE, 'handle': 1}},
                {'chain': {'family': 'inet', 'table': x.NFT_TABLE, 'name': 'output', 'handle': 1, 'type': 'filter',
                           'hook': 'output', 'prio': 0, 'policy': 'accept'}}]
        rows += [{'rule': {'family': 'inet', 'table': x.NFT_TABLE, 'chain': 'output', 'handle': i + 2, 'expr': r}}
                 for i, r in enumerate(self.nft)]
        return 0, json.dumps({'nftables': rows}).encode()

    # ---- S3 model
    def aws(self, argv):
        if 'get-object' in argv:
            destination = argv[-1]
            end = int(argv[argv.index('--range') + 1].split('-')[1])
            body = self.s3_body if 'artifact' not in self.faults else self.faults['artifact']
            parent, name = destination.rsplit('/', 1)
            with self.w.fs.directory(parent) as fd:
                self.w.fs.create(fd, name, [body[:end + 1]], 'root', 'root', 0o600)
            count = min(len(body), end + 1)
            return 0, json.dumps({'AcceptRanges': 'bytes', 'ContentLength': count, 'VersionId': self.s3_version,
                                  'ContentRange': f'bytes 0-{count - 1}/{len(body)}', 'ETag': '"synthetic"'}).encode()
        body = Path(argv[argv.index('--body') + 1]).read_bytes()
        self.uploads.append({'key': argv[argv.index('--key') + 1], 'body': body,
                             'if_none_match': argv[argv.index('--if-none-match') + 1]})
        checksum = base64.b64encode(hashlib.sha256(body).digest()).decode()
        if 'put_checksum' in self.faults:
            checksum = self.faults['put_checksum']
        return 0, json.dumps({'VersionId': 'synthetic-backup-version', 'ChecksumSHA256': checksum, 'ETag': '"synthetic"'}).encode()

    # ---- the existing secret generator's observable contract
    def init_secrets(self):
        etc = self.path(x.ETC)
        info = etc.stat()
        assert self.w.fs.owner(info)[0] == 'root' and not info.st_mode & 0o027, 'generator parent check would refuse'
        assert self.w.ids.group('rougehalla') is not None
        body = json.dumps({'database_password': os.urandom(32).hex(), 'playtest_passcode': os.urandom(32).hex()}) + '\n'
        if 'secret_partial' in self.faults:
            body = '{"database_pass'
        with self.w.fs.directory(x.ETC) as fd:
            self.w.fs.create(fd, x.SECRETS, [body.encode()], 'root', 'rougehalla', 0o640)
        return 0, x.SECRET_CREATED

    def postgres_tool(self, tool, argv, stdin):
        pg = self.pg
        if tool == 'initdb':
            assert not pg.initialized and not os.listdir(self.path(x.PGDATA))
            with self.w.fs.directory(x.PGDATA, create={x.PGDATA: {'owner': 'postgres', 'group': 'postgres', 'mode': 0o700}}.get) as fd:
                self.w.fs.create(fd, 'PG_VERSION', [b'16\n'], 'postgres', 'postgres', 0o600)
            pg.initialized = True
            return 0, b''
        if tool == 'pg_ctl' and argv[1] == 'start':
            options = argv[argv.index('-o') + 1]
            config = re.search(r'config_file=(\S+)', options)[1]
            pg.settings = FakePostgres.config(self.path(config).read_text())
            assert "listen_addresses=''" in options
            pg.settings['listen_addresses'] = ''
            pg.socket = re.search(r'unix_socket_directories=(\S+)', options)[1]
            assert self.w.fs.owner_of(pg.socket) == ('postgres', 'postgres')
            pg.running = 'provision'
            return 0, b''
        if tool == 'pg_ctl':
            pg.running, pg.socket = None, None
            return 0, b''
        socket_dir = argv[argv.index('-h') + 1]
        if pg.running is None or socket_dir != pg.socket:
            return 2, b''
        if '-f' in argv:
            pg.execute(stdin.decode())
            return 0, b''
        return 0, (pg.answer(argv[-1]) + '\n').encode()

    # ---- PID1 model for the executor's own units
    def unit_file(self, unit):
        path = self.path(x.UNIT_DIR + '/' + unit)
        return path.read_text() if path.exists() else None

    def props(self, unit):
        text = self.units.get(unit)
        if text is None:
            return {'Id': unit, 'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead',
                    'FragmentPath': '', 'DropInPaths': '', 'NeedDaemonReload': 'no', 'UnitFileState': '', 'User': ''}
        fields = unit_text_fields(text)
        active, sub = self.state.get(unit, ('inactive', 'dead'))
        result = {'Id': unit, 'LoadState': 'loaded', 'ActiveState': active, 'SubState': sub,
                  'FragmentPath': x.UNIT_DIR + '/' + unit, 'DropInPaths': '', 'NeedDaemonReload': 'no',
                  'UnitFileState': 'disabled' if '[Install]' in text else 'static', 'User': fields.get('User', '')}
        if unit.endswith('.timer'):
            calendar = dt.datetime.strptime(fields['OnCalendar'], '%Y-%m-%d %H:%M:%S UTC')
            result.update(Transient='no', Persistent='yes' if fields['Persistent'] == 'true' else 'no', Unit=fields['Unit'],
                          NextElapseUSecRealtime=calendar.strftime('%a %Y-%m-%d %H:%M:%S UTC'), AccuracyUSec='1s',
                          RandomizedDelayUSec='0', OnClockChange='no', Result='success')
        result.update(self.faults.get('props', {}).get(unit, {}))
        return result

    def systemctl(self, argv):
        verb = argv[4]
        if verb == 'daemon-reload':
            for unit in x.APP_UNITS + (x.EGRESS_UNIT, x.BACKUP_SERVICE, x.BACKUP_TIMER):
                text = self.unit_file(unit)
                if text is not None:
                    self.units[unit] = text
            return 0, b''
        unit = argv[-1]
        if verb == 'show':
            return 0, ''.join(k + '=' + v + '\n' for k, v in self.props(unit).items()).encode()
        assert verb == 'start' and unit in self.units
        fields = unit_text_fields(self.units[unit])
        condition = fields.get('ConditionPathExists')
        if condition and not self.path(condition).exists():
            return 0, b''  # PID1 skips a unit whose condition fails; it does not become active.
        active = lambda u: self.state.get(u, ('inactive',))[0] == 'active'
        if unit == x.POSTGRES_UNIT:
            config = re.search(r'config_file=(\S+)', fields['ExecStart'])[1]
            self.pg.settings = FakePostgres.config(self.path(config).read_text())
            self.pg.running, self.pg.socket = 'service', x.SERVICE_SOCKET
            self.state[unit] = ('active', 'running')
        elif unit in (x.SOURCE_UNIT, x.TRAINING_UNIT):
            secrets = json.loads(self.path(x.ETC + '/' + x.SECRETS).read_text())
            role = self.pg.role
            if not (active(x.POSTGRES_UNIT) and role and role['login'] and role['password'] == secrets['database_password']):
                self.state[unit] = ('failed', 'failed')
                return 0, b''
            if unit == x.SOURCE_UNIT:
                self.pg.migration = 2
                self.pg.tables = {name: 'rougehalla' for name in ('profiles', 'schema_compat', 'matches')}
            self.state[unit] = ('active', 'running')
            self.http_up.add(7777 if unit == x.SOURCE_UNIT else 7779)
        elif unit == x.EGRESS_UNIT:
            self.state[unit] = ('active', 'exited') if self.nft else ('failed', 'failed')
        elif unit == x.CADDY_UNIT:
            ok = all(active(u) for u in (x.EGRESS_UNIT, x.SOURCE_UNIT, x.TRAINING_UNIT))
            self.state[unit] = ('active', 'running') if ok else ('inactive', 'dead')
        elif unit == x.BACKUP_TIMER:
            self.state[unit] = ('active', 'waiting')
        return 0, b''

    def backup_producer(self, argv):
        marker = self.path(x.DATA + '/' + x.MARKER)
        if 'backup_fail' in self.faults or not marker.exists():
            return 1, b''
        for unit in (x.SOURCE_UNIT, x.TRAINING_UNIT):
            self.state[unit] = ('inactive', 'dead')
        self.http_up.clear()
        parent, name = argv[3].rsplit('/', 1)
        with self.w.fs.directory(parent) as fd:
            self.w.fs.create(fd, name, [b'age-encryption.org/v1\n', os.urandom(64)], 'root', 'root', 0o600)
        return 0, b'some producer progress\n' + x.BACKUP_DONE

    # ---- loopback network model
    def http(self, port, path):
        if port not in self.http_up:
            raise ConnectionRefusedError('synthetic closed port')
        if path == '/healthz':
            return 200, b'ok'
        if path == '/readyz':
            return 200, json.dumps({'ok': True, 'state': 'ready', 'storage': 'ok'}).encode()
        return 200, json.dumps(dict(self.server_identity, maxRooms=16 if port == 7777 else 1)).encode()

    def https(self, path):
        if self.state.get(x.CADDY_UNIT, ('inactive',))[0] != 'active':
            raise ConnectionRefusedError('synthetic closed TLS port')
        if path in ('/control', '/training/api'):
            return 404, b''
        if path == '/training/healthz':
            return self.http(7779, '/healthz')
        return self.http(7777, path)


class World:
    """One fake host whose filesystem is a real private temporary directory."""
    def __init__(self, tmp, postgres_unit_patch=True):
        self.tmp = tmp
        self.base = tmp / 'host'
        for path, mode in [('', 0o755), ('etc', 0o755), ('etc/rougehalla', 0o700), ('etc/systemd', 0o755),
                           ('etc/systemd/system', 0o755), ('var', 0o755), ('var/lib', 0o755), ('opt', 0o755),
                           ('opt/rougehalla', 0o755), ('srv', 0o755), ('srv/rougehalla-data', 0o755),
                           ('srv/rougehalla-data/lost+found', 0o700), ('usr', 0o755), ('usr/bin', 0o755), ('usr/sbin', 0o755)]:
            p = self.base / path
            p.mkdir(exist_ok=True)
            p.chmod(mode)
        self.ids = FakeIds()
        self.fs = TmpFS(self.ids, str(self.base))
        self.runner = ExpiryModel(tmp / 'expiry-model', self.base)
        self.data = self.base / 'srv/rougehalla-data'
        info = self.data.stat()
        self.probe = DeviceModel(f'{os.major(info.st_dev)}:{os.minor(info.st_dev)}')
        self.host = FakeHost(self)
        self.sleeps = []
        self.write_owner(RUN)
        self.tool_bytes = self.install_tools()
        self.members = self.default_members(postgres_unit_patch)
        self.boundary = {'format': 'rh-host-boundary/1', 'imds_nonroot_blocked': True, 'egress_max_bytes': 8 * 1024 ** 3,
                         'egress_bytes_per_second': 3_000_000, 'age_recipient': RECIPIENT}
        self.mode = 'fresh'

    def write_owner(self, run_id, volume=VOLUME):
        path = self.data / x.OWNER_RECORD
        if path.exists():
            path.unlink()
        path.write_text(json.dumps({'format': 'rh-retained-volume-owner/1', 'volume_id': volume, 'uuid': UUID, 'run_id': run_id}))
        path.chmod(0o600)

    def install_tools(self):
        receipt = {}
        for name, pattern in x.TOOL_PATHS.items():
            path = pattern.replace('\\.[0-9]{1,2}', '.12')
            target = self.base / path.lstrip('/')
            target.parent.mkdir(parents=True, exist_ok=True)
            for parent in [target.parent, *target.parent.parents]:
                if parent == self.base:
                    break
                parent.chmod(0o755)
            target.write_bytes(b'#!synthetic pinned tool ' + name.encode() + b'\n')
            target.chmod(0o755)
            receipt[name] = {'path': path, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
        (self.base / 'opt/rougehalla/aws/dist').mkdir()
        (self.base / 'opt/rougehalla/aws/dist/libsynthetic.so').write_bytes(b'synthetic library')
        (self.base / 'opt/rougehalla/aws/current').symlink_to('dist')
        return receipt

    def toolchain(self):
        trees = {name: self.fs.tree_digest(path) for name, path in x.TOOL_TREES.items()}
        return json.dumps({'format': 'rh-host-toolchain/1', 'tools': self.tool_bytes, 'trees': trees}, sort_keys=True).encode()

    def default_members(self, patch_postgres):
        members = {}
        for name in ('run-runtime.py', 'init-runtime-secrets.py', 'backup.sh', 'backup_archive.py', 'restore.sh'):
            members['preparation/' + name] = (STAGING / name).read_bytes()
        for name in ('Caddyfile', 'postgresql.conf', 'pg_hba.conf'):
            members['config/' + name] = (STAGING / name).read_bytes()
        for unit in x.APP_UNITS:
            text = (STAGING / (unit + '.in')).read_text().replace('@RUNTIME_SECONDS@', str(RUNTIME_SECONDS))
            if unit == x.POSTGRES_UNIT and patch_postgres:  # The proposed activation patch, never applied to the repo.
                text = text.replace('/etc/rougehalla/postgresql.conf', x.PG_ETC + '/postgresql.conf')
                text = text.replace('/etc/rougehalla/pg_hba.conf', x.PG_ETC + '/pg_hba.conf')
            members['units/' + unit] = text.encode()
        members['bin/rh-server'] = b'SYNTHETIC SERVER FIXTURE, NOT AN ELF OR VALIDATED NATIVE BUILD\n'
        members['bin/caddy'] = b'SYNTHETIC CADDY FIXTURE\n'
        members['maps/source.map.json'] = b'{"format":"rh-map/2","synthetic":true}\n'
        members['runtime-identity.json'] = json.dumps(IDENTITY).encode()
        members['web/index.html'] = b'<!doctype html><title>synthetic</title>\n'
        members['web/Build/game.data'] = b'synthetic data'
        return members

    def bundle(self, extra=None):
        out = io.BytesIO()
        files = [{'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
                 for name, body in sorted(self.members.items())]
        manifest = json.dumps({'format': 'rh-installer-public-bundle/1', 'run_id': RUN, 'files': files}).encode()
        with tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, body in sorted(self.members.items()) + [('manifest.json', manifest)]:
                member = tarfile.TarInfo(name); member.size = len(body)
                archive.addfile(member, io.BytesIO(body))
            if extra:
                archive.addfile(*extra)
        return out.getvalue()

    def seal(self, extra=None):
        body = self.bundle(extra)
        self.host.s3_body = body
        toolchain = self.toolchain()
        boundary = json.dumps(self.boundary, sort_keys=True).encode()
        plan = {'format': 'rh-staging-installer-candidate/1', 'account': contract.ACCOUNT, 'region': contract.REGION,
                'domain': 'rougehalla.com', 'run_id': RUN, 'prepared_at': '2026-11-09T12:00:00Z',
                'host_expires_at': '2026-11-09T16:00:00Z', 'mode': self.mode,
                'previous_run_id': None if self.mode == 'fresh' else '20261108t120000z-abcdef',
                'volume': {'id': VOLUME, 'uuid': UUID, 'filesystem': 'ext4', 'mountpoint': host_device.MOUNT},
                'artifact': {'bucket': 'rh-synthetic-artifacts', 'key': 'runs/' + RUN + '/public-bundle.tar',
                             'version_id': 'synthetic-version', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()},
                'backup': {'bucket': 'rh-synthetic-backup', 'key': 'runs/' + RUN + '/cold-backup.age', 'max_bytes': 1 << 20},
                'toolchain_receipt_sha256': hashlib.sha256(toolchain).hexdigest(),
                'boundary_receipt_sha256': hashlib.sha256(boundary).hexdigest(), 'backup_seconds': 300}
        self.inputs = (json.dumps(plan, sort_keys=True).encode(), toolchain, boundary)
        return self.inputs

    def factory(self, table):
        self.host.table = table
        return self.host

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.runner.real += int(seconds * 1000000)
        self.runner.boot += int(seconds * 1000000)

    def executor(self):
        net = SimpleNamespace(http=self.host.http, https=self.host.https)
        return x.Executor(x.Boundaries(self.runner, self.fs, self.factory, net, self.probe, self.ids, self.sleep))

    def install(self):
        if not hasattr(self, 'inputs'):
            self.seal()
        return self.executor().install(*self.inputs)

    def reboot(self):
        """A new boot of the same host: PID1/service state resets, files persist."""
        self.runner.job = 0
        self.runner.events.clear()
        self.host.state.clear(); self.host.http_up.clear(); self.host.units.clear()
        self.host.pg.running, self.host.pg.socket = None, None

    def tools_run(self):
        return [Path(argv[0]).name + ':' + (argv[1] if len(argv) > 1 else '') for argv, _ in self.host.calls]

    def ran(self, word):
        return any(word in ' '.join(argv) for argv, _ in self.host.calls)

    def snapshot(self):
        rows = {}
        for path in sorted(self.base.rglob('*')):
            info = path.lstat()
            rows[str(path.relative_to(self.base))] = (info.st_ino, stat.S_IMODE(info.st_mode),
                                                      path.read_bytes() if path.is_file() and not path.is_symlink() else None)
        return rows


class HostExecutor(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.w = World(Path(self.temp.name))

    def refuse(self, kind=e.ShutdownRequested):
        with self.assertRaises(kind):
            self.w.install()

    # ---- complete path, observed effects
    def test_complete_install_observes_files_owners_pg_services_and_never_claims_acceptance(self):
        w = self.w
        result = w.install()
        self.assertEqual(result['stage'], 'host-install-observed-unaccepted')
        for flag in ('deployable', 'accepted', 'host_installed', 'offhost_restore_proved'):
            self.assertIs(result[flag], False)
        self.assertEqual(result['probe_mode'], 'injected')
        # Installed bytes and owners are read back from the real temporary inodes.
        for item in json.loads(x.LAYOUT_PATH.read_text())['files']:
            self.assertEqual((w.base / item['path'].lstrip('/')).read_bytes(), w.members[item['member']])
            self.assertEqual(w.fs.owner_of(item['path']), (item['owner'], item['group']))
            self.assertEqual(oct(stat.S_IMODE((w.base / item['path'].lstrip('/')).stat().st_mode)), oct(int(item['mode'], 8)))
        self.assertEqual((w.base / 'opt/rougehalla/web/Build/game.data').read_bytes(), b'synthetic data')
        self.assertEqual(w.fs.owner_of(x.ETC), ('root', 'rougehalla'))
        self.assertEqual(stat.S_IMODE((w.base / 'etc/rougehalla').stat().st_mode), 0o750)
        for name, owner, mode in (('pgdata', 'postgres', 0o700), ('spool-source', 'rougehalla', 0o700),
                                  ('spool-training', 'rougehalla', 0o700), ('caddy', 'rougehalla', 0o700)):
            self.assertEqual(w.fs.owner_of(x.DATA + '/' + name), (owner, owner))
            self.assertEqual(stat.S_IMODE((w.data / name).stat().st_mode), mode)
        self.assertEqual(w.fs.owner_of(x.DATA + '/' + x.LOCK), ('root', 'rougehalla'))
        marker = json.loads((w.data / x.MARKER).read_text())
        self.assertEqual((marker['run_id'], marker['deployable'], marker['accepted']), (RUN, False, False))
        self.assertEqual(marker['installed_tree_sha256'], result['installed_tree_sha256'])
        self.assertEqual(w.fs.owner_of(x.DATA + '/' + x.MARKER), ('root', 'rougehalla'))
        # Restricted role exactly as PostgreSQL received the SQL; password only ever travelled on stdin.
        secrets = json.loads((w.base / 'etc/rougehalla' / x.SECRETS).read_text())
        role = w.host.pg.role
        self.assertEqual((role['super'], role['createdb'], role['createrole'], role['replication'], role['bypassrls'], role['login']),
                         (False, False, False, False, False, True))
        self.assertEqual(role['password'], secrets['database_password'])
        self.assertEqual(w.host.pg.database, {'owner': 'rougehalla', 'acl': 'rougehalla=CTc/rougehalla'})
        self.assertEqual(w.fs.owner_of(x.ETC + '/' + x.SECRETS), ('root', 'rougehalla'))
        password = secrets['database_password'].encode()
        stdin_users = [argv for argv, stdin in w.host.calls if stdin and password in stdin]
        self.assertEqual([Path(a[0]).name for a in stdin_users], ['psql'])
        self.assertFalse(any(password in ' '.join(argv).encode() for argv, _ in w.host.calls))
        for path in w.base.rglob('*'):
            if path.is_file() and path.name != x.SECRETS:
                self.assertNotIn(password, path.read_bytes(), str(path))
        self.assertNotIn(password, json.dumps(result).encode())
        # Services, firewall and timer state as the models observed them.
        for unit in x.APP_UNITS + (x.EGRESS_UNIT,):
            self.assertEqual(w.host.state[unit][0], 'active', unit)
        self.assertEqual(w.host.state[x.BACKUP_TIMER], ('active', 'waiting'))
        self.assertEqual(len(w.host.nft), 5)
        self.assertTrue(w.runner.armed)
        self.assertFalse((w.base / 'var/lib/rougehalla-installer' / RUN / x.BUNDLE).exists())
        self.assertEqual(sorted(os.listdir(w.base / 'var/lib/rougehalla-installer' / RUN / 'journal')),
                         ['install', 'marker', 'pg-init', 'pg-role', 'secrets'])

    def test_order_expiry_isolation_fence_download_install_secret_db_marker_then_services(self):
        w = self.w
        w.install()
        armed = w.runner.events.index(('command', e.ENABLE))
        self.assertEqual(w.runner.events.count(('command', e.ENABLE)), 1)
        self.assertGreater(len(w.runner.events), armed)  # Every gate rechecks guard/timer after arming.
        calls = w.tools_run()
        order = [calls.index('nft:-f'), calls.index('aws:--no-cli-pager'), calls.index('python3.12:-I'),
                 calls.index('initdb:-D'), calls.index('pg_ctl:start')]
        self.assertEqual(order, sorted(order))
        starts = [argv[-1] for argv, _ in w.host.calls if Path(argv[0]).name == 'systemctl' and argv[4] == 'start']
        self.assertEqual(starts, [x.POSTGRES_UNIT, x.SOURCE_UNIT, x.TRAINING_UNIT, x.EGRESS_UNIT, x.CADDY_UNIT, x.BACKUP_TIMER])
        # The provisioning DB was stopped before any service start.
        stop = max(i for i, c in enumerate(calls) if c == 'pg_ctl:stop')
        first_start = next(i for i, (argv, _) in enumerate(w.host.calls) if Path(argv[0]).name == 'systemctl' and argv[4] == 'start')
        self.assertLess(stop, first_start)

    # ---- expiry, cancellation and startup guard
    def test_expired_first_boot_requests_shutdown_with_no_installer_effect(self):
        w = self.w
        w.runner.real = e.epoch_us(e.stamp('2026-11-09T16:00:00Z'))
        before = w.snapshot()
        self.refuse()
        self.assertEqual(w.host.calls, [])
        self.assertEqual(w.runner.job, 17)
        self.assertEqual(w.snapshot(), before)

    def test_missing_guard_refuses_before_any_state_or_command(self):
        w = self.w
        w.runner.guard['FailureAction'] = 'none'
        before = w.snapshot()
        self.refuse(e.Refused)
        self.assertEqual((w.host.calls, w.snapshot()), ([], before))

    def test_expiry_reached_during_download_never_installs_valid_bytes(self):
        w = self.w
        def expire():
            w.runner.real = e.epoch_us(e.stamp('2026-11-09T16:00:00Z'))
        w.host.hooks.append((lambda argv: 'get-object' in argv, expire))
        self.refuse()
        self.assertFalse((w.base / 'opt/rougehalla/bin').exists())
        self.assertFalse(w.ran('initdb'))
        self.assertFalse((w.data / x.MARKER).exists())
        self.assertTrue(w.runner.armed)
        self.assertEqual(w.runner.job, 17)

    def test_cancellation_during_install_requests_shutdown_and_keeps_timer_armed(self):
        w = self.w
        def cancel():
            raise KeyboardInterrupt()
        w.host.hooks.append((lambda argv: Path(argv[0]).name.startswith('python3'), cancel))
        self.refuse()
        self.assertTrue(w.runner.armed)
        self.assertFalse((w.data / x.MARKER).exists())
        self.assertFalse(any('stop' in a or 'disable' in a for kind, *rest in w.runner.events if kind == 'command' for a in rest[0]))

    def test_startup_guard_budget_too_short_refuses_before_download(self):
        w = self.w
        w.runner.guard['TimeoutStartUSec'] = '50s'
        self.refuse()
        self.assertFalse(w.ran('get-object'))
        self.assertTrue(w.ran('nft'))

    def test_guard_replaced_mid_install_stops_work(self):
        w = self.w
        def lose_guard():
            w.runner.guard['MainPID'] = '999'
        w.host.hooks.append((lambda argv: Path(argv[0]).name == 'initdb', lose_guard))
        self.refuse()
        self.assertFalse(w.ran('pg_ctl'))

    # ---- crash / restart / partial install
    def test_crash_mid_install_then_restart_completes_without_replacing_or_extending(self):
        w = self.w
        w.seal()
        real_publish = x.HostFS.publish
        def crash(fs, dir_fd, temporary, name):
            if name == 'rh-server':  # Second bundle member: one installed, one left as this run's partial.
                raise SimulatedKill()
            return real_publish(fs, dir_fd, temporary, name)
        with patch.object(x.HostFS, 'publish', crash):
            with self.assertRaises(SimulatedKill):
                w.install()
        installed = [p for p in (w.base / 'opt/rougehalla').rglob('*') if p.is_file() and '.partial' not in p.name]
        partial = list((w.base / 'opt/rougehalla/bin').glob('.rh-server.rh-' + RUN + '.partial'))
        self.assertEqual(len(partial), 1)
        self.assertFalse((w.base / 'opt/rougehalla/bin/rh-server').exists())
        before = {str(p): p.stat().st_ino for p in installed}
        deadline = (w.base / 'etc/rougehalla' / e.STATE).read_bytes()
        w.reboot()
        w.install()
        self.assertEqual({str(p): p.stat().st_ino for p in installed}, before)
        self.assertEqual(list((w.base / 'opt').rglob('*.partial')), [])
        self.assertEqual((w.base / 'etc/rougehalla' / e.STATE).read_bytes(), deadline)

    def test_crash_after_initdb_or_role_before_journal_refuses_restart_instead_of_reinitializing(self):
        for tool in ('initdb', 'psql-f'):
            with self.subTest(tool=tool):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                w.seal()
                original = x.Executor.journal
                def die(executor, step, target={'initdb': 'pg-init', 'psql-f': 'pg-role'}[tool]):
                    if step == target:
                        raise SimulatedKill()
                    return original(executor, step)
                with patch.object(x.Executor, 'journal', die), self.assertRaises(SimulatedKill):
                    w.install()
                version = (w.data / 'pgdata/PG_VERSION').read_bytes()
                w.reboot()
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertEqual((w.data / 'pgdata/PG_VERSION').read_bytes(), version)
                self.assertFalse((w.data / x.MARKER).exists())
                self.assertEqual(sum(Path(a[0]).name == 'initdb' for a, _ in w.host.calls), 1)

    def test_restart_after_marker_never_revives_writers(self):
        w = self.w
        w.install()
        w.reboot()
        calls = len(w.host.calls)
        self.refuse()
        starts = [a for a, _ in w.host.calls[calls:] if Path(a[0]).name == 'systemctl' and a[4] == 'start']
        self.assertEqual(starts, [])
        self.assertFalse(any('get-object' in a for a, _ in w.host.calls[calls:]))
        self.assertEqual(w.host.state, {})

    def test_wrong_shape_secret_refuses_before_database_initialization(self):
        w = self.w
        original = w.host.init_secrets
        def extra():
            code, out = original()
            path = w.base / 'etc/rougehalla' / x.SECRETS
            value = json.loads(path.read_text()); value['aws_secret_access_key'] = 'a' * 64
            path.write_text(json.dumps(value))
            return code, out
        w.host.init_secrets = extra
        self.refuse()
        self.assertFalse(w.ran('initdb'))
        self.assertIsNone(w.host.pg.role)

    def test_partial_secret_is_never_regenerated(self):
        w = self.w
        w.host.faults['secret_partial'] = True
        self.refuse()
        body = (w.base / 'etc/rougehalla' / x.SECRETS).read_bytes()
        w.reboot(); del w.host.faults['secret_partial']
        self.refuse()
        self.assertEqual((w.base / 'etc/rougehalla' / x.SECRETS).read_bytes(), body)
        self.assertFalse(w.ran('initdb'))

    def test_timer_disarmed_or_deadline_record_changed_mid_install_stops_next_step(self):
        def disarm(w):
            w.runner.override = {e.TIMER: {'ActiveState': 'inactive'}}
        def rewrite(w):
            path = w.base / 'etc/rougehalla' / e.STATE
            path.write_bytes(path.read_bytes().replace(b'16:00:00', b'16:30:00'))
        def pending(w):
            w.runner.job = 21
        for name, change in (('disarm', disarm), ('rewrite', rewrite), ('pending-shutdown', pending)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                w.host.hooks.append((lambda argv: 'get-object' in argv, lambda w=w, change=change: change(w)))
                with self.assertRaises((e.ShutdownRequested, e.Refused)):
                    w.install()
                self.assertFalse((w.base / 'opt/rougehalla/bin').exists())
                self.assertFalse(w.ran('initdb'))

    def test_foreign_executor_owned_files_are_never_adopted(self):
        def unit(w):
            path = w.base / 'etc/systemd/system' / x.EGRESS_UNIT
            path.write_bytes(b'[Service]\nType=oneshot\nRemainAfterExit=yes\nUser=root\nExecStart=/bin/true\n')
            return path
        def plan_copy(w):
            run = w.base / 'var/lib/rougehalla-installer' / RUN
            (w.base / 'var/lib/rougehalla-installer').mkdir(mode=0o711); (w.base / 'var/lib/rougehalla-installer').chmod(0o711)
            run.mkdir(mode=0o700); (run / 'journal').mkdir(mode=0o700)
            (run / 'plan.json').write_bytes(b'{"run_id":"a different plan"}'); (run / 'plan.json').chmod(0o600)
            return run / 'plan.json'
        for name, plant in (('egress-unit', unit), ('plan-copy', plan_copy)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                path = plant(w)
                body = path.read_bytes()
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertEqual(path.read_bytes(), body)
                self.assertFalse(w.ran('get-object'))

    def test_unrestricted_or_privileged_service_identity_refuses(self):
        def shell(w):
            w.ids.add('rougehalla', 998); w.ids.users['rougehalla']['shell'] = '/bin/bash'
        def sudo(w):
            w.ids.add('postgres', 997); w.ids.extra['postgres'] = ['sudo']
        def shared(w):
            w.ids.add('rougehalla', 998); w.ids.groups['rougehalla']['members'] = ['postgres']
        def root(w):
            w.ids.users['postgres'] = {'uid': 0, 'gid': 0, 'shell': '/usr/sbin/nologin'}; w.ids.groups['postgres'] = {'gid': 0, 'members': []}
        for name, change in (('shell', shell), ('sudo', sudo), ('shared-group', shared), ('uid0', root)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                change(w)
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertFalse(w.ran('nft'))
                self.assertFalse(w.ran('get-object'))

    # ---- install member safety on real files
    def test_foreign_destination_bytes_symlinks_and_symlinked_parent_are_never_replaced(self):
        w = self.w
        target = w.base / 'opt/rougehalla/bin'
        target.mkdir(); target.chmod(0o755)
        (target / 'rh-server').write_bytes(b'foreign binary')
        (target / 'rh-server').chmod(0o755)
        self.refuse()
        self.assertEqual((target / 'rh-server').read_bytes(), b'foreign binary')
        (target / 'rh-server').unlink()
        outside = w.tmp / 'outside'; outside.mkdir()
        (target / 'rh-server').symlink_to(outside / 'planted')
        w.reboot(); self.refuse()
        self.assertFalse((outside / 'planted').exists())
        (target / 'rh-server').unlink()
        (w.base / 'opt/rougehalla/web').symlink_to(outside)
        w.reboot(); self.refuse()
        self.assertEqual(list(outside.iterdir()), [])

    def test_wrong_owner_or_mode_on_existing_directory_refuses(self):
        w = self.w
        (w.base / 'opt/rougehalla/maps').mkdir(mode=0o777)
        (w.base / 'opt/rougehalla/maps').chmod(0o777)
        self.refuse()
        self.assertFalse((w.base / 'opt/rougehalla/maps/source.map.json').exists())

    def test_traversal_unknown_member_and_artifact_mismatch_refuse_before_any_install_write(self):
        cases = []
        member = tarfile.TarInfo('../escape'); member.size = 0
        cases.append(('traversal', lambda w: w.seal((member, io.BytesIO(b'')))))
        def unknown(w):
            w.members['extra/unknown.txt'] = b'undeclared'
            w.seal()
        cases.append(('unknown', unknown))
        def missing(w):
            del w.members['bin/caddy']
            w.seal()
        cases.append(('missing', missing))
        def mismatch(w):
            w.seal()
            w.host.faults['artifact'] = w.host.s3_body[:-1] + b'X'
        cases.append(('mismatch', mismatch))
        def version(w):
            w.seal()
            w.host.s3_version = 'other-version'
        cases.append(('version', version))
        def hidden(w):
            w.members['web/.hidden'] = b'x'
            w.seal()
        cases.append(('hidden', hidden))
        for name, prepare in cases:
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                prepare(w)
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertTrue(w.ran('get-object'))
                self.assertFalse((w.base / 'opt/rougehalla/bin').exists())
                self.assertFalse((w.base / 'etc/rougehalla' / x.SECRETS).exists())
                self.assertFalse(w.ran('initdb'))

    # ---- ownership, foreign state, writer fence, device identity
    def test_foreign_volume_owner_or_volume_identity_refuses_without_touching_volume(self):
        for run, volume in (('20261108t120000z-abcdef', VOLUME), (RUN, 'vol-0fffffffffffffff0')):
            with self.subTest(run=run, volume=volume):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                w.write_owner(run, volume)
                before = sorted(os.listdir(w.data))
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertEqual(sorted(os.listdir(w.data)), before)
                self.assertFalse(w.ran('get-object'))

    def test_foreign_entries_and_pending_bytes_are_preserved_and_refused(self):
        for name, setup in (('foreign-file', lambda d: (d / 'old-run.dump').write_bytes(b'foreign')),
                            ('pending-source', lambda d: ((d / 'spool-source').mkdir(), (d / 'spool-source/pending.result').write_bytes(b'r'))),
                            ('training-file', lambda d: ((d / 'spool-training').mkdir(), (d / 'spool-training/x').write_bytes(b't'))),
                            ('pgdata-unjournaled', lambda d: ((d / 'pgdata').mkdir(), (d / 'pgdata/PG_VERSION').write_bytes(b'15')))):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                setup(w.data)
                for sub in ('spool-source', 'spool-training', 'pgdata'):
                    if (w.data / sub).exists():
                        (w.data / sub).chmod(0o700)
                        owner = 'postgres' if sub == 'pgdata' else 'rougehalla'
                        w.ids.add('rougehalla', 998); w.ids.add('postgres', 997)
                        w.fs.set_owner(x.DATA + '/' + sub, owner, owner)
                before = w.snapshot()
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                after = w.snapshot()
                for key, value in before.items():
                    if key.startswith('srv/rougehalla-data/') and not key.endswith(x.LOCK):
                        self.assertEqual(after[key], value, key)
                self.assertFalse(w.ran('get-object'))

    def test_live_writer_holding_shared_lock_blocks_install(self):
        w = self.w
        lock = w.data / x.LOCK
        lock.write_bytes(b''); lock.chmod(0o640)
        w.ids.add('rougehalla', 998); w.ids.add('postgres', 997)
        w.fs.set_owner(x.DATA + '/' + x.LOCK, 'root', 'rougehalla')
        with open(lock, 'rb') as holder:
            fcntl.flock(holder, fcntl.LOCK_SH | fcntl.LOCK_NB)
            self.refuse()
        self.assertFalse(w.ran('get-object'))

    def test_active_owned_service_blocks_install(self):
        w = self.w
        w.host.units[x.SOURCE_UNIT] = '[Service]\nUser=rougehalla\n'  # A stale writer from an earlier boot.
        w.host.state[x.SOURCE_UNIT] = ('active', 'running')
        self.refuse()
        self.assertFalse((w.data / x.LOCK).exists())

    def test_device_identity_not_bound_to_held_directory_refuses(self):
        for change in ('uuid', 'serial', 'identity'):
            with self.subTest(change=change):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                if change == 'uuid':
                    w.probe.actual_uuid = '00000000-1234-4234-8234-123456789abc'
                elif change == 'serial':
                    w.probe.kernel_serials['259:2'] = 'vol0fffffffffffffff0'
                else:
                    w.probe = DeviceModel('259:3')
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertFalse(w.ran('get-object'))
                self.assertFalse((w.data / 'pgdata').exists())

    # ---- credential / IMDS isolation and pinned inputs
    def test_missing_imds_or_egress_rule_refuses_before_instance_role_use(self):
        for dropped in ([0], [1], [2], [3], [4]):
            with self.subTest(dropped=dropped):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                w.host.faults['nft_drop'] = dropped
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertTrue(w.ran('nft'))
                self.assertFalse(w.ran('get-object'))
                self.assertFalse((w.base / 'etc/rougehalla' / x.SECRETS).exists())

    def test_tool_substitution_tree_change_or_unpinned_receipt_refuses_before_download(self):
        def tool(w):
            w.seal(); (w.base / 'opt/rougehalla/postgres/bin/psql').write_bytes(b'substitute')
        def tree(w):
            w.seal(); (w.base / 'opt/rougehalla/aws/dist/libsynthetic.so').write_bytes(b'changed')
        def missing(w):
            w.seal(); (w.base / 'usr/sbin/nft').unlink()
        def writable(w):
            w.seal(); (w.base / 'usr/bin/bash').chmod(0o777)
        def receipt(w):
            plan, toolchain, boundary = w.seal()
            w.inputs = (plan, toolchain + b' ', boundary)
        for name, prepare in (('tool', tool), ('tree', tree), ('missing', missing), ('writable', writable), ('receipt', receipt)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                prepare(w)
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertFalse(w.ran('get-object'))

    def test_restore_mode_refuses_with_named_fencing_seam(self):
        w = self.w
        w.mode = 'restore'
        w.write_owner('20261108t120000z-abcdef')
        with self.assertRaises(e.ShutdownRequested):
            w.install()
        self.assertEqual(w.host.calls, [])
        with self.assertRaisesRegex(x.Refused, 'remote-writer fencing'):
            x.load_inputs(*w.inputs, now=dt.datetime(2026, 11, 9, 12, 1, tzinfo=contract.UTC))

    # ---- unit/config bindings and database restrictions
    def test_existing_postgres_unit_config_path_is_refused_as_named_seam(self):
        root = Path(self.temp.name) / 'unpatched'; root.mkdir()
        w = World(root, postgres_unit_patch=False)
        with self.assertRaises(e.ShutdownRequested):
            w.install()
        self.assertTrue((w.base / 'etc/systemd/system' / x.POSTGRES_UNIT).exists())
        self.assertFalse((w.base / 'etc/rougehalla' / x.SECRETS).exists())
        self.assertFalse(w.ran('initdb'))

    def test_unit_lifetime_placeholder_or_environment_injection_refuses(self):
        def lifetime(w):
            w.members['units/' + x.SOURCE_UNIT] = w.members['units/' + x.SOURCE_UNIT].replace(
                str(RUNTIME_SECONDS).encode(), b'14300')
        def placeholder(w):
            w.members['units/' + x.CADDY_UNIT] = w.members['units/' + x.CADDY_UNIT].replace(str(RUNTIME_SECONDS).encode(), b'@RUNTIME_SECONDS@')
        def env(w):
            w.members['units/' + x.TRAINING_UNIT] += b'[Service]\nEnvironment=AWS_PROFILE=x\n'
        def user(w):
            w.members['units/' + x.SOURCE_UNIT] = w.members['units/' + x.SOURCE_UNIT].replace(b'User=rougehalla', b'User=root')
        for name, mutate in (('lifetime', lifetime), ('placeholder', placeholder), ('env', env), ('user', user)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                mutate(w)
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertFalse(w.ran('initdb'))

    def test_training_result_spool_or_shared_instance_refuses(self):
        w = self.w
        text = w.members['preparation/run-runtime.py'].decode()
        w.members['preparation/run-runtime.py'] = text.replace(
            "'--max-rooms', '1', '--lobby-seconds', '0', '--fill-seconds', '0'] + common",
            "'--max-rooms', '1', '--lobby-seconds', '0', '--fill-seconds', '0', '--result-spool', '/x'] + common").encode()
        self.assertNotEqual(w.members['preparation/run-runtime.py'].decode(), text)
        self.refuse()
        self.assertFalse((w.base / 'etc/rougehalla' / x.SECRETS).exists())

    def test_nondurable_or_logging_postgres_config_refuses_before_password_is_sent(self):
        for key, value in (('fsync', 'off'), ('log_statement', "'all'"), ('synchronous_commit', 'off')):
            with self.subTest(key=key):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                conf = w.members['config/postgresql.conf'].decode()
                w.members['config/postgresql.conf'] = re.sub(key + r' = \S+', key + ' = ' + value, conf).encode()
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertTrue(w.ran('pg_ctl start'))
                self.assertFalse(any('-f' in argv for argv, _ in w.host.calls if Path(argv[0]).name == 'psql'))
                self.assertIsNone(w.host.pg.role)
                self.assertTrue(w.ran('pg_ctl stop'))

    def test_superuser_role_observation_refuses_and_never_writes_marker(self):
        w = self.w
        w.host.pg.force['superuser'] = True
        self.refuse()
        self.assertFalse((w.data / x.MARKER).exists())
        self.assertTrue(w.ran('pg_ctl stop'))

    def test_unready_service_or_identity_mismatch_or_missing_tls_refuses(self):
        def identity(w):
            w.host.server_identity['contentHash'] = 'ffffffffffffffff'
        def tls(w):
            w.host.https = lambda path: (_ for _ in ()).throw(ConnectionRefusedError('no certificate'))
        def secret(w):
            original = w.host.systemctl
            def corrupt(argv):
                if argv[4] == 'start' and argv[-1] == x.SOURCE_UNIT:
                    w.host.pg.role['password'] = 'f' * 64
                return original(argv)
            w.host.systemctl = corrupt
        for name, fault in (('identity', identity), ('tls', tls), ('secret', secret)):
            with self.subTest(case=name):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                fault(w)
                with self.assertRaises(e.ShutdownRequested):
                    w.install()
                self.assertTrue((w.data / x.MARKER).exists())
                self.assertNotIn(x.BACKUP_TIMER, w.host.state)

    # ---- backup producer and conditional upload; cleanup scope
    def test_backup_runs_existing_producer_uploads_exact_ciphertext_and_never_claims_restore(self):
        w = self.w
        w.install()
        receipt = w.executor().backup(RUN)
        ciphertext = w.base / 'var/lib/rougehalla-installer' / RUN / x.CIPHERTEXT
        self.assertTrue(ciphertext.exists())
        self.assertEqual(w.host.uploads[0]['body'], ciphertext.read_bytes())
        self.assertEqual(w.host.uploads[0]['if_none_match'], '*')
        self.assertEqual(receipt['ciphertext_sha256'], hashlib.sha256(ciphertext.read_bytes()).hexdigest())
        self.assertIs(receipt['offhost_restore_proved'], False)
        self.assertIs(receipt['independent_restore_required'], True)
        self.assertEqual(w.host.state[x.SOURCE_UNIT][0], 'inactive')
        stored = json.loads((ciphertext.parent / 'offhost-upload-receipt.json').read_text())
        self.assertEqual(stored['version_id'], 'synthetic-backup-version')

    def test_failed_producer_or_bad_upload_acknowledgement_produces_no_receipt(self):
        for fault in ('backup_fail', 'put_checksum'):
            with self.subTest(fault=fault):
                w = World(Path(tempfile.mkdtemp(dir=self.temp.name)))
                w.install()
                w.host.faults[fault] = 'AAAA' if fault == 'put_checksum' else True
                with self.assertRaises(ValueError):
                    w.executor().backup(RUN)
                self.assertFalse((w.base / 'var/lib/rougehalla-installer' / RUN / 'offhost-upload-receipt.json').exists())
                self.assertEqual(len(w.host.uploads), 1 if fault == 'put_checksum' else 0)
                if fault == 'put_checksum':
                    self.assertTrue((w.base / 'var/lib/rougehalla-installer' / RUN / x.CIPHERTEXT).exists())

    def test_producer_that_leaves_writers_running_is_not_uploaded(self):
        w = self.w
        w.install()
        original = w.host.backup_producer
        def leaves_running(argv):
            code, out = original(argv)
            w.host.state[x.SOURCE_UNIT] = ('active', 'running')
            return code, out
        w.host.backup_producer = leaves_running
        with self.assertRaises(ValueError):
            w.executor().backup(RUN)
        self.assertEqual(w.host.uploads, [])

    def test_backup_after_expiry_or_for_another_run_refuses(self):
        w = self.w
        w.install()
        w.runner.real = e.epoch_us(e.stamp('2026-11-09T15:57:30Z'))
        with self.assertRaises(ValueError):
            w.executor().backup(RUN)
        self.assertFalse(w.ran('backup.sh'))
        with self.assertRaises((ValueError, OSError)):
            w.executor().backup('20261108t120000z-abcdef')

    def test_cleanup_touches_only_owned_download_and_preserves_restore_material(self):
        w = self.w
        other = w.base / 'var/lib/rougehalla-installer/20261108t120000z-abcdef'
        (w.base / 'var/lib/rougehalla-installer').mkdir(); (w.base / 'var/lib/rougehalla-installer').chmod(0o711)
        other.mkdir(); (other / 'cold-backup.age').write_bytes(b'age-encryption.org/v1\nforeign')
        run = w.base / 'var/lib/rougehalla-installer' / RUN
        run.mkdir(mode=0o700); run.chmod(0o700)
        (run / 'retained-unverified-restore.age').write_bytes(b'age-encryption.org/v1\nretained')
        w.install()
        self.assertEqual((run / 'retained-unverified-restore.age').read_bytes(), b'age-encryption.org/v1\nretained')
        w.executor().backup(RUN)
        self.assertEqual((other / 'cold-backup.age').read_bytes(), b'age-encryption.org/v1\nforeign')
        self.assertEqual(sorted(os.listdir(run)), sorted(['boundary.json', 'cold-backup.age', 'executor.lock', 'journal',
                         'offhost-upload-receipt.json', 'plan.json', 'receipt.json', 'retained-unverified-restore.age',
                         'toolchain.json']))
        for kept in (w.data / x.MARKER, w.base / 'etc/rougehalla' / x.SECRETS, w.data / 'pgdata/PG_VERSION'):
            self.assertTrue(kept.exists())

    # ---- boundaries and CLI
    def test_linux_process_boundary_is_allowlisted_no_shell_exact_env_and_drops_identity(self):
        ids = SimpleNamespace(user=lambda name: {'uid': 997, 'gid': 997})
        table = {('/x/psql', '-c', 'q'): ('postgres', {'PATH': '/usr/bin'}), ('/x/aws', 'get'): ('root', {'A': 'b'})}
        process = x.LinuxProcess(table, ids)
        with patch.object(host_device.LinuxProbe, 'trusted_tool') as trusted, patch.object(x.subprocess, 'run',
                return_value=SimpleNamespace(returncode=0, stdout=b'out', stderr=b'secret-looking stderr')) as run:
            self.assertEqual(process.run(('/x/psql', '-c', 'q'), stdin=b'in'), (0, b'out'))
            kwargs = run.call_args.kwargs
            self.assertEqual((kwargs['shell'], kwargs['env'], kwargs['user'], kwargs['group'], kwargs['extra_groups'], kwargs['input']),
                             (False, {'PATH': '/usr/bin'}, 997, 997, [], b'in'))
            process.run(('/x/aws', 'get'))
            self.assertNotIn('user', run.call_args.kwargs)
            trusted.assert_called_with('/x/aws')
            for bad in (('/bin/sh', '-c', 'true'), ('/x/psql', '-c', 'other'), ('/x/aws',)):
                with self.assertRaises(x.Refused):
                    process.run(bad)
            self.assertEqual(run.call_count, 2)

    def test_command_table_has_no_shell_no_secret_and_isolated_cloud_environment(self):
        w = self.w
        inputs = x.load_inputs(*w.seal(), now=dt.datetime(2026, 11, 9, 12, 1, tzinfo=contract.UTC))
        table, _, aws_env = x.command_table(inputs, x.RUN_ROOT + '/' + RUN)
        for argv, (user, env) in table.items():
            self.assertTrue(argv[0].startswith('/') and Path(argv[0]).name not in ('sh', 'curl', 'wget'))
            self.assertFalse(any(k.startswith('AWS_ACCESS') or k == 'AWS_PROFILE' for k in env))
            if Path(argv[0]).name in ('initdb', 'pg_ctl', 'psql'):
                self.assertEqual(user, 'postgres')
        self.assertEqual(aws_env['AWS_CONFIG_FILE'], '/dev/null')
        self.assertIn(tuple(x.transfer.get_command(inputs['plan'])), table)

    def test_cli_refuses_off_linux_or_unprivileged_without_io_or_success_output(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(x.sys, 'platform', 'darwin'), patch.object(x.Boundaries, 'linux', side_effect=AssertionError('no boundary')), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = x.main(['install', '--plan', '/nonexistent/a', '--toolchain-receipt', '/nonexistent/b',
                           '--boundary-receipt', '/nonexistent/c'])
        self.assertEqual((code, out.getvalue()), (2, ''))
        self.assertIn('no work gate', err.getvalue())

    def test_layout_is_strict_and_rendered_material_is_bounded(self):
        layout = x.load_layout()
        self.assertEqual({i['member'] for i in layout['files']} | {'web/'},
                         {i['member'] for i in layout['files']} | {t['prefix'] for t in layout['trees']})
        bad = Path(self.temp.name) / 'layout.json'
        for mutate in (lambda l: l['files'].append(dict(l['files'][0])), lambda l: l['files'][0].update(owner='nobody'),
                       lambda l: l['directories'][0].update(path='/opt/../etc')):
            value = json.loads(x.LAYOUT_PATH.read_text()); mutate(value)
            bad.write_text(json.dumps(value))
            with self.assertRaises(x.Refused):
                x.load_layout(bad)
        plan = json.loads(self.w.seal()[0])
        bodies, trigger = x.backup_material(plan, '/usr/bin/python3.12')
        self.assertEqual(trigger, e.epoch_us(e.stamp('2026-11-09T15:52:00Z')))
        self.assertNotIn(b'[Install]', bodies[x.BACKUP_TIMER])
        self.assertIn(b'Persistent=false', bodies[x.BACKUP_TIMER])

    def test_rendered_backup_execstart_imports_the_installer_modules(self):
        plan = json.loads(self.w.seal()[0])
        service = x.backup_material(plan, '/usr/bin/python3.12')[0][x.BACKUP_SERVICE].decode()
        argv = unit_text_fields(service)['ExecStart'].split()
        self.assertEqual(argv[0], '/usr/bin/python3.12')
        argv[0] = sys.executable
        argv[argv.index('/opt/rougehalla/installer/host_executor.py')] = str(Path(x.__file__).resolve())
        # --help exits inside argparse before any boundary is built: proves the interpreter flags can import siblings.
        result = subprocess.run(argv + ['--help'], capture_output=True, text=True, cwd='/', timeout=60,
                                env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--run-id', result.stdout)


if __name__ == '__main__':
    unittest.main()
