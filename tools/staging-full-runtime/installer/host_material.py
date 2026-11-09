"""Concrete review material only. Executes no shell, host, DB or AWS operation."""
import json
import re
from contract import require, expiry_units


def pg_role_input(private_password):
    """Future root-only stdin to local peer-auth psql; never argv/log/file output. Not client-token creation."""
    require(type(private_password) is str and re.fullmatch('[0-9a-f]{64}', private_password), 'private runtime DB secret shape')
    return ("SET password_encryption = 'scram-sha-256';\n"
            "CREATE ROLE rougehalla LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+
            private_password+"';\nCREATE DATABASE rougehalla OWNER rougehalla;\nREVOKE ALL ON DATABASE rougehalla FROM PUBLIC;\n")


def material(plan):
    units = expiry_units(plan)
    script = '''#!/bin/bash
# REVIEW MATERIAL ONLY. Not connected to userdata, preparer, deployment or an active installer.
set +x
set -euo pipefail
umask 077
test "$(id -u)" = 0
/usr/bin/python3 - <<'PY'
import datetime as dt, json, os, stat
from pathlib import Path
files = __FILES__
deadline = json.loads(files['deadline.json'])
end = dt.datetime.strptime(deadline['expires_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
if dt.datetime.now(dt.timezone.utc) >= end: raise SystemExit('fixed expiry already elapsed')
for parent in [Path('/etc/rougehalla'), Path('/etc/systemd/system')]:
    if not parent.exists(): parent.mkdir(mode=0o700)
    info=parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode)&0o022:
        raise SystemExit('unsafe expiry parent')
for name, body in files.items():
    path=Path('/etc/rougehalla/run-deadline.json') if name=='deadline.json' else Path('/etc/systemd/system')/name
    if path.exists() or path.is_symlink():
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode)!=0o600 or path.read_text()!=body:
            raise SystemExit('existing expiry differs; never renew or replace')
    else:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as f: f.write(body); f.flush(); os.fsync(f.fileno())
        directory=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
PY
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable --now rougehalla-absolute-expiry.timer
/usr/bin/systemctl is-active --quiet rougehalla-absolute-expiry.timer
# End of expiry-only material. No downloads, database, public listener or installed marker is created.
'''.replace('__FILES__', repr(units))
    return {'expiry-first.review.sh': script,
        'remaining-host-contract.json': json.dumps({
            'deployable': False, 'actual_host_run': False, 'run_id': plan['run_id'],
            'mount': {'volume': plan['volume'], 'format_unknown_media': False, 'root_device_forbidden': True},
            'ownership': {'private_config': 'root:rougehalla 0750', 'runtime_secrets': 'root:rougehalla 0640 create-new nofollow',
                'writers_lock': '/srv/rougehalla-data/writers.lock root:rougehalla 0640; exclusive installer/backup; shared live writers; never replace a locked inode',
                'pgdata': 'postgres:postgres 0700', 'spool_source': 'rougehalla:rougehalla 0700',
                'spool_training': 'no result files, links or special entries; existing empty-tree refusal guard'},
            'postgres': {'binary': '/opt/rougehalla/postgres/bin/postgres', 'address': '127.0.0.1', 'port': 5432,
                'durability': {'fsync': 'on', 'synchronous_commit': 'on', 'full_page_writes': 'on'},
                'password_encryption': 'scram-sha-256',
                'app_owner': 'rougehalla; NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
                'shared_account_lease_database': 'rougehalla; shared Source+Training, never copied/seeded credentials',
                'provision': 'fresh empty role/database only; private password stdin to peer-admin psql; actual host path not implemented',
                'restore': 'empty target + role then existing restore.sh; no init/migration/token seeding over restored rows'},
            'activation': {'implemented': False, 'installation_marker_created': False,
                'must_verify': ['old writers stopped/fenced, exclusive local lock, correct volume UUID+ID',
                    'real private PG settings and non-superuser role, native redaction/account/lease probes',
                    'actual egress-byte/rate enforcement armed before Caddy; no broad fallback',
                    'expiry before each start, fixed remainder lifetime, no renew on reboot',
                    'exact Source/Training binary/map/Web, Caddy/TLS/accounts/no Training banking',
                    'real encrypted producer completion and independent offhost restore/idempotence proof']},
            'restore_continuation': {'mode': plan['mode'], 'old_run': plan['previous_run_id'],
                'cross_host_fencing': 'Root-owned real proof required; local locks/receipts cannot fence remote writers',
                'start_services': False, 'preserve_pending_source': True}}, indent=2)+'\n'}
