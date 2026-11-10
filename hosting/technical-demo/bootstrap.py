#!/usr/bin/python3
"""Unexecuted ephemeral Ubuntu 24.04 preparation. Root supplies reviewed config."""
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import time

ROOT = Path('/opt/rougehalla-demo')
CONFIG = Path('/etc/rougehalla-demo.json')
UNITS = Path('/etc/systemd/system')
MAX_BUNDLE = 160 * 1024 * 1024
MAX_EXTRACT = 400 * 1024 * 1024
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def config(raw, now=None):
    c = json.loads(raw)
    require(type(c) is dict and set(c) == {'bucket', 'key', 'sha256', 'region', 'expires_at', 'domain', 'run_id'}, 'config keys')
    require(all(type(v) is str and v for v in c.values()), 'config strings')
    require(re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', c['bucket']), 'bucket')
    require(re.fullmatch(r'[A-Za-z0-9_./-]{1,1024}', c['key']) and '..' not in c['key'].split('/'), 'key')
    require(re.fullmatch(r'[a-f0-9]{64}', c['sha256']), 'sha256')
    require(c['region'] == 'ca-west-1' and c['domain'] == 'play.rougehalla.com', 'fixed demo boundary')
    require(re.fullmatch(r'[a-z0-9-]{1,40}', c['run_id']), 'run id')
    require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', c['expires_at']), 'UTC expiry')
    end = dt.datetime.strptime(c['expires_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    now = now or dt.datetime.now(dt.timezone.utc)
    require(dt.timedelta(0) < end - now <= dt.timedelta(hours=3), 'expired or greater than three hours')
    return c, end


def member_name(name):
    p = PurePosixPath(name)
    require(name == str(p) and not p.is_absolute() and all(x not in ('.', '..') for x in p.parts), 'tar path')
    require(re.fullmatch(r'[A-Za-z0-9_./-]+', name), 'tar name')
    require(name in ('rh-server', 'source-map.json', 'bundle-manifest.json') or name.startswith('web/'), 'tar allowlist')
    return name


def unpack(archive, dest):
    """Validate entire regular-file inventory before writing anything; no links or devices."""
    with tarfile.open(archive, 'r:') as tar:
        rows = tar.getmembers()
        require(0 < len(rows) <= 10000, 'member count')
        seen = set()
        for m in rows:
            member_name(m.name)
            require(m.isfile() and m.name not in seen and 0 <= m.size <= MAX_EXTRACT, 'regular unique members only')
            seen.add(m.name)
        require(sum(m.size for m in rows) <= MAX_EXTRACT, 'extraction bound')
        require({'rh-server', 'source-map.json', 'bundle-manifest.json', 'web/index.html'} <= seen, 'required files')
        manifest_row = next(m for m in rows if m.name == 'bundle-manifest.json')
        require(manifest_row.size <= 2 * 1024 * 1024, 'manifest bound')
        manifest = json.load(tar.extractfile(manifest_row))
        require(type(manifest) is dict and set(manifest) == seen - {'bundle-manifest.json'}, 'exact inventory')
        require(all(type(v) is str and re.fullmatch(r'[a-f0-9]{64}', v) for v in manifest.values()), 'file hashes')
        dest.mkdir(mode=0o755)  # Existing or restarted installation refuses; never replace.
        for m in rows:
            p = dest / m.name
            p.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with tar.extractfile(m) as src, p.open('xb') as out:
                while block := src.read(1024 * 1024):
                    h.update(block)
                    out.write(block)
            require(m.name == 'bundle-manifest.json' or h.hexdigest() == manifest[m.name], 'member hash')
            p.chmod(0o755 if m.name == 'rh-server' else 0o644)
        with (dest / 'rh-server').open('rb') as f:
            header = f.read(20)
        require(header[:6] == b'\x7fELF\x02\x01' and header[18:20] == b'\x3e\x00', 'x86-64 ELF required')


def run(*args, stdin=None):
    # Do not retain SQL, credentials, account requests, request bodies or raw application logs.
    subprocess.run(args, input=stdin, check=True, env=ENV, timeout=120,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)



def shaper_command(ipv4, ipv6):
    """One default ENI for both families; refuse ambiguity rather than shape the wrong NIC."""
    require(type(ipv4) is list and bool(ipv4) and type(ipv6) is list, 'default route lists')
    devices = set()
    for route in ipv4 + ipv6:
        require(type(route) is dict and route.get('dst') == 'default', 'default route record')
        dev = route.get('dev')
        require(type(dev) is str and re.fullmatch(r'[A-Za-z0-9_.:-]{1,15}', dev) and dev != 'lo', 'default NIC')
        require(route.get('type', 'unicast') == 'unicast', 'default route type')
        devices.add(dev)
    require(len(devices) == 1, 'multiple default NICs refused')
    return ('/usr/sbin/tc', 'qdisc', 'replace', 'dev', devices.pop(), 'root', 'handle', '1:',
            'tbf', 'rate', '8mbit', 'burst', '512kb', 'latency', '500ms')


ISOLATION_STAGES = frozenset(('nft-load', 'guard', 'route-v4', 'route-v6', 'tbf', 'fq_codel'))


def isolation_step(stage, action):
    """Fixed operational metadata only; never log argv, config, stdout or exception text."""
    require(stage in ISOLATION_STAGES, 'diagnostic stage')
    def emit(event, status, stderr=b''):
        row = {'stage': stage, 'event': event, 'status': status}
        if stderr:
            # These commands read only fixed public NFT/routing/qdisc inputs. One ASCII
            # line, at most 2048 retained stderr bytes; control characters cannot forge rows.
            row['stderr'] = ''.join(chr(b) if 32 <= b <= 126 else ' ' for b in stderr[:2048])
        print('RH_DEMO_ISOLATION ' + json.dumps(row, ensure_ascii=True), file=sys.stderr, flush=True)
    emit('start', 0)
    try:
        result = action()
    except subprocess.CalledProcessError as error:
        emit('fail', error.returncode, error.stderr or b'')
        raise
    except subprocess.TimeoutExpired as error:
        emit('fail', 124, error.stderr or b'')
        raise
    except OSError as error:
        emit('fail', error.errno if type(error.errno) is int else 1)
        raise
    except Exception:
        emit('fail', 1)
        raise
    emit('ok', 0)
    return result


def isolation_command(stage, args, capture=False, timeout=120):
    # Never reuse this diagnostic path for SDK, packages, app, SQL or credential commands.
    executables = {'nft-load': '/usr/sbin/nft', 'route-v4': '/usr/sbin/ip',
                   'route-v6': '/usr/sbin/ip', 'tbf': '/usr/sbin/tc', 'fq_codel': '/usr/sbin/tc'}
    require(args and executables.get(stage) == args[0], 'diagnostic command')
    result = subprocess.run(args, check=False, env=ENV, timeout=timeout,
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                            stderr=subprocess.PIPE)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, stderr=result.stderr[:2048])
    return result.stdout


def shape():
    isolation_step('guard', guard)
    routes = []
    for family, stage in (('-4', 'route-v4'), ('-6', 'route-v6')):
        def read_route():
            raw = isolation_command(stage, ('/usr/sbin/ip', '-json', family, 'route', 'show', 'default'),
                                    capture=True, timeout=5)
            require(len(raw) <= 65536, 'route output bound')
            return json.loads(raw)
        routes.append(isolation_step(stage, read_route))
    parent = isolation_step('guard', lambda: shaper_command(*routes))
    isolation_step('tbf', lambda: isolation_command('tbf', parent))
    # Per-flow scheduling keeps bulk page transfers from monopolizing the parent FIFO.
    # TBF's latency option is not a hard queue-delay bound once this child is installed.
    isolation_step('fq_codel', lambda: isolation_command('fq_codel',
        ('/usr/sbin/tc', 'qdisc', 'replace', 'dev', parent[4], 'parent', '1:1', 'handle', '10:',
         'fq_codel', 'limit', '512', 'target', '5ms', 'interval', '100ms')))


def isolate():
    isolation_step('nft-load', lambda: isolation_command('nft-load',
        ('/usr/sbin/nft', '-f', '/etc/rh-demo.nft')))
    shape()


def isolation_rules(uids):
    """Exact service-UID IMDS rejection rules, with real block separators for nft."""
    require(type(uids) is tuple and len(uids) == 3
            and all(type(uid) is int and uid >= 0 for uid in uids), 'service UIDs')
    owners = ', '.join(str(uid) for uid in uids)
    return f'''table inet rh_demo {{
    chain output {{
        type filter hook output priority 0; policy accept;
        meta skuid {{ {owners} }} ip daddr 169.254.169.254 reject;
        meta skuid {{ {owners} }} ip6 daddr fd00:ec2::254 reject;
    }}
}}
'''


def isolation_unit():
    return '[Unit]\nWants=network-online.target\nAfter=network-online.target rh-demo-expiry.timer\nRequires=rh-demo-expiry.timer\nBefore=rh-demo-source.service rh-demo-training.service caddy.service\nOnFailure=rh-demo-poweroff.service\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py isolate\nStandardOutput=journal+console\nStandardError=journal+console\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n'


def write(path, body, mode=0o644):
    with path.open('x') as f:
        f.write(body)
    path.chmod(mode)


def unit(name, body):
    write(UNITS / name, body)


def guard():
    config(CONFIG.read_bytes())  # Immutable absolute deadline, including every reboot/restart.


def app_unit(c, training):
    mode = 'training' if training else 'source-arena'
    port = 7779 if training else 7777
    options = '--min-players 1 --fill-bots 0 --max-rooms 1 --lobby-seconds 0 --fill-seconds 0' if training else f'--map {ROOT}/source-map.json --result-spool /var/lib/rougehalla-demo/spool --min-players 2 --fill-bots 0 --max-rooms 16 --lobby-seconds 30 --fill-seconds 5'
    return f'''[Unit]
Requires=rh-demo-pg.service rh-demo-expiry.timer
After=rh-demo-pg.service rh-demo-expiry.timer
OnFailure=rh-demo-poweroff.service
[Service]
User=rougehalla
Group=rougehalla
ExecStartPre=+/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py guard
ExecStart={ROOT}/rh-server --runtime {mode} --bind 127.0.0.1:{port} --instance-id {c['run_id']}-{mode} {options} --database-url postgresql://rougehalla@localhost/roguehalla?host=/run/rh-demo-pg --bot-learning off --api-cors-origins https://play.rougehalla.com --client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1
Restart=no
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/rougehalla-demo /run/rh-demo-pg
UMask=0077
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
'''


def caddy_config():
    return '''play.rougehalla.com {
    encode zstd gzip {
        match {
            header Content-Type text/*
            header Content-Type application/javascript*
            header Content-Type application/json*
            header Content-Type application/wasm*
            header Content-Type application/octet-stream*
            header Content-Type image/svg+xml*
        }
    }
    root * /opt/rougehalla-demo/web
    redir / /index.html?trainingServer=wss%3A%2F%2Fplay.rougehalla.com%2Ftraining%2Fws 302
    @blocked path /control* /probe* /training/api* /training/control* /training/probe* /training/readyz*
    handle @blocked {
        respond 404
    }
    handle /training/ws {
        rewrite * /ws
        reverse_proxy 127.0.0.1:7779 {
            header_up X-Forwarded-For {remote_host}
        }
    }
    @training path /training/info /training/ping /training/healthz
    handle @training {
        uri strip_prefix /training
        reverse_proxy 127.0.0.1:7779 {
            header_up X-Forwarded-For {remote_host}
        }
    }
    handle /training/* {
        respond 404
    }
    @native path /ws /api /api/* /info /ping /healthz
    handle @native {
        reverse_proxy 127.0.0.1:7777 {
            header_up X-Forwarded-For {remote_host}
        }
    }
    @read method GET HEAD
    handle @read {
        @br path *.br
        header @br Content-Encoding br
        @gz path *.gz
        header @gz Content-Encoding gzip
        @wasm path *.wasm *.wasm.br *.wasm.gz
        header @wasm Content-Type application/wasm
        @js path *.js *.js.br *.js.gz
        header @js Content-Type application/javascript
        @data path *.data *.data.br *.data.gz
        header @data Content-Type application/octet-stream
        file_server
    }
    handle {
        respond 405
    }
}
'''


def ready(port):
    for route in ('/readyz', '/info'):
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            conn.request('GET', route)
            r = conn.getresponse()
            require(r.status == 200, 'not ready')
            data = json.loads(r.read(65537))
            if route == '/readyz':
                require(data.get('ok') is True and data.get('state') == 'ready' and data.get('storage') == 'ok', 'storage not ready')
            else:
                require(data.get('protocol') == 14 and data.get('contentHash') == '7c6a633f68c2cc72', 'native identity')
        finally:
            conn.close()


def install():
    require(sys.platform == 'linux' and os.geteuid() == 0, 'Linux root only')
    require(Path('/etc/os-release').read_text().find('VERSION_ID="24.04"') >= 0, 'Ubuntu 24.04 only')
    require(os.uname().machine == 'x86_64', 'x86 only')
    c, _ = config(CONFIG.read_bytes())
    require(not ROOT.exists() and not Path('/var/lib/rougehalla-demo').exists(), 'fresh host only')
    # The outer systemd setup deadline/expiry are already armed BEFORE apt and IMDS.
    run('/usr/bin/systemctl', 'is-active', '--quiet', 'rh-demo-expiry.timer')
    require(not Path('/usr/sbin/policy-rc.d').exists(), 'unexpected package service policy')
    write(Path('/usr/sbin/policy-rc.d'), '#!/bin/sh\nexit 101\n', 0o755)
    try:
        run('/usr/bin/apt-get', 'update', '-q')
        run('/usr/bin/env', 'DEBIAN_FRONTEND=noninteractive', '/usr/bin/apt-get', 'install', '-y', '--no-install-recommends', 'python3-boto3', 'postgresql-16', 'caddy', 'nftables', 'iproute2')
    finally:
        Path('/usr/sbin/policy-rc.d').unlink()
    run('/usr/bin/systemctl', 'disable', '--now', 'postgresql.service', 'caddy.service')
    run('/usr/bin/systemctl', 'mask', 'postgresql.service', 'postgresql@16-main.service')
    # Stock package cluster is never used. Dedicated PG service/data/socket only.
    run('/usr/sbin/useradd', '--system', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', 'rougehalla')
    # Block instance-role credentials from every service UID, before running app code.
    import pwd
    uids = tuple(pwd.getpwnam(n).pw_uid for n in ('rougehalla', 'postgres', 'caddy'))
    write(Path('/etc/rh-demo.nft'), isolation_rules(uids), 0o600)
    unit('rh-demo-isolation.service', isolation_unit())
    run('/usr/bin/systemctl', 'daemon-reload')
    run('/usr/bin/systemctl', 'enable', '--now', 'rh-demo-isolation.service')
    import boto3
    from botocore.config import Config
    # No profiles/static credential files. EC2 IMDSv2 temporary role credentials only.
    for key in tuple(os.environ):
        if key.startswith('AWS_'):
            del os.environ[key]
    os.environ['AWS_SHARED_CREDENTIALS_FILE'] = '/dev/null'
    os.environ['AWS_CONFIG_FILE'] = '/dev/null'
    os.environ['AWS_EC2_METADATA_V1_DISABLED'] = 'true'
    client = boto3.client('s3', region_name=c['region'], config=Config(connect_timeout=5, read_timeout=20, retries={'max_attempts': 1}))
    response = client.get_object(Bucket=c['bucket'], Key=c['key'])
    require(type(response.get('ContentLength')) is int and 0 < response['ContentLength'] <= MAX_BUNDLE, 'bundle length')
    archive = Path('/var/lib/rh-demo-bundle.tar')
    h, count = hashlib.sha256(), 0
    with response['Body'] as stream, archive.open('xb') as out:
        while block := stream.read(1024 * 1024):
            count += len(block)
            require(count <= MAX_BUNDLE, 'bundle bound')
            h.update(block)
            out.write(block)
    archive.chmod(0o600)
    require(count == response['ContentLength'] and h.hexdigest() == c['sha256'], 'bundle integrity')
    unpack(archive, ROOT)
    archive.unlink()
    run('/usr/bin/install', '-d', '-o', 'rougehalla', '-g', 'rougehalla', '-m', '0700', '/var/lib/rougehalla-demo', '/var/lib/rougehalla-demo/spool')
    run('/usr/bin/install', '-d', '-o', 'postgres', '-g', 'postgres', '-m', '0700', '/var/lib/rh-demo-pg')
    run('/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/16/bin/initdb', '-D', '/var/lib/rh-demo-pg', '--auth-local=peer', '--auth-host=reject')
    with Path('/var/lib/rh-demo-pg/postgresql.conf').open('a') as f:
        f.write("\nlisten_addresses = ''\nunix_socket_directories = '/run/rh-demo-pg'\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\nlogging_collector = off\n")
    unit('rh-demo-pg.service', '[Unit]\nRequires=rh-demo-isolation.service rh-demo-expiry.timer\nAfter=rh-demo-isolation.service rh-demo-expiry.timer\nOnFailure=rh-demo-poweroff.service\n[Service]\nUser=postgres\nRuntimeDirectory=rh-demo-pg\nRuntimeDirectoryMode=0755\nExecStartPre=+/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py guard\nExecStart=/usr/lib/postgresql/16/bin/postgres -D /var/lib/rh-demo-pg\nRestart=no\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n')
    for name, training in (('source', False), ('training', True)):
        unit(f'rh-demo-{name}.service', app_unit(c, training).replace('Requires=rh-demo-pg.service', 'Requires=rh-demo-isolation.service rh-demo-pg.service').replace('After=rh-demo-pg.service', 'After=rh-demo-isolation.service rh-demo-pg.service'))
    run('/usr/bin/systemctl', 'daemon-reload')
    run('/usr/bin/systemctl', 'start', 'rh-demo-pg.service')
    run('/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql', '-h', '/run/rh-demo-pg', '-v', 'ON_ERROR_STOP=1', '-q', stdin=b'CREATE ROLE rougehalla LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\nCREATE DATABASE roguehalla OWNER rougehalla;\nREVOKE ALL ON DATABASE roguehalla FROM PUBLIC;\n')
    run('/usr/bin/systemctl', 'start', 'rh-demo-source.service')
    for _ in range(30):
        guard()
        try:
            ready(7777)
            break
        except (OSError, ValueError, http.client.HTTPException):
            time.sleep(1)
    else:
        raise ValueError('Source readiness refused before Training')
    run('/usr/bin/systemctl', 'start', 'rh-demo-training.service')
    for _ in range(30):
        guard()
        try:
            ready(7777)
            ready(7779)
            break
        except (OSError, ValueError, http.client.HTTPException):
            time.sleep(1)
    else:
        raise ValueError('native readiness refused')
    # Last public-listener gate. No package-default server was started.
    write(Path('/etc/caddy/demo.Caddyfile'), caddy_config())
    run('/usr/bin/caddy', 'validate', '--config', '/etc/caddy/demo.Caddyfile', '--adapter', 'caddyfile')
    Path('/etc/systemd/system/caddy.service.d').mkdir()
    write(Path('/etc/systemd/system/caddy.service.d/demo.conf'), '[Unit]\nRequires=rh-demo-expiry.timer rh-demo-source.service rh-demo-training.service rh-demo-isolation.service\nAfter=rh-demo-source.service rh-demo-training.service rh-demo-isolation.service\nOnFailure=rh-demo-poweroff.service\n[Service]\nExecStartPre=+/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py ready\nExecStart=\nExecStart=/usr/bin/caddy run --config /etc/caddy/demo.Caddyfile --adapter caddyfile\nExecReload=\n')
    guard()
    run('/usr/bin/systemctl', 'daemon-reload')
    run('/usr/bin/systemctl', 'enable', 'rh-demo-pg.service', 'rh-demo-source.service', 'rh-demo-training.service', 'caddy.service')
    run('/usr/bin/systemctl', 'start', 'caddy.service')
    print('demo setup complete; ephemeral; fixed expiry unchanged', flush=True)


if __name__ == '__main__':
    # The root systemd setup unit owns timeout, exit failure, and poweroff handling.
    try:
        if sys.argv[1:] == ['guard']:
            guard()
        elif sys.argv[1:] == ['shape']:
            shape()
        elif sys.argv[1:] == ['isolate']:
            isolate()
        elif sys.argv[1:] == ['ready']:
            guard()
            ready(7777)
            ready(7779)
        elif sys.argv[1:] == ['install']:
            install()
        else:
            raise ValueError('command refused')
    except Exception:
        print('demo preparation refused; details intentionally not logged', file=sys.stderr)
        sys.exit(1)
