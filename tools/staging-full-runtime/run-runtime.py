#!/usr/bin/env python3
"""Host-only launcher; never run by preparation. No secret is printed or embedded in a template."""
import json
import fcntl
import os
import re
import stat
import sys
import urllib.parse
from pathlib import Path

SECRET = Path('/etc/rougehalla/runtime-secrets.json')
ROOT = Path('/srv/rougehalla-data')


def command(profile, database_url, run_id):
    if profile not in ('source', 'training'):
        raise ValueError('unknown profile')
    if not re.fullmatch(r'[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', run_id):
        raise ValueError('missing run ownership')
    common = ['--database-url', database_url, '--bot-learning', 'off',
              '--api-cors-origins', 'https://rougehalla.com',
              '--client-ip-header', 'x-forwarded-for', '--trusted-proxies', '127.0.0.1',
              '--instance-id', 'calgary-' + run_id + '-' + profile]
    if profile == 'source':
        # Exact a0 source-arena defaults, explicit so a new binary cannot silently change them.
        return ['/opt/rougehalla/bin/rh-server', '--runtime', 'source-arena',
                '--bind', '127.0.0.1:7777', '--map', '/opt/rougehalla/maps/source.map.json',
                '--min-players', '2', '--fill-bots', '0', '--max-rooms', '16',
                '--lobby-seconds', '30', '--fill-seconds', '5',
                '--result-spool', str(ROOT / 'spool-source')] + common
    # One training human/room and one room on this bounded endpoint; no filler/lifecycle/results.
    return ['/opt/rougehalla/bin/rh-server', '--runtime', 'training',
            '--bind', '127.0.0.1:7779', '--min-players', '1', '--fill-bots', '0',
            '--max-rooms', '1', '--lobby-seconds', '0', '--fill-seconds', '0'] + common


def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ('source', 'training'):
            raise ValueError()
        # Installer must provision this exact retained encrypted mount; never spill onto the root disk.
        if not os.path.ismount(ROOT) or not (ROOT / 'installation-verified.json').is_file():
            raise ValueError()
        installation = json.loads((ROOT / 'installation-verified.json').read_text())
        run_id = installation['run_id']
        # Shared lock survives exec: a quiesced backup holds the exclusive side of this same file.
        lock = os.open(ROOT / 'writers.lock', os.O_RDONLY)
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        os.set_inheritable(lock, True)
        info = SECRET.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != os.getgid() or stat.S_IMODE(info.st_mode) != 0o640:
            raise ValueError()
        secret = json.loads(SECRET.read_text())
        if set(secret) != {'database_password', 'playtest_passcode'}:
            raise ValueError()
        if any(not isinstance(v, str) or len(v) < 32 or '\x00' in v for v in secret.values()):
            raise ValueError()
        password = urllib.parse.quote(secret['database_password'], safe='')
        url = 'postgresql://rougehalla:' + password + '@127.0.0.1:5432/rougehalla'
        env = {'PATH': '/usr/bin:/bin', 'PLAYTEST_PASSCODE': secret['playtest_passcode']}
        os.execve('/opt/rougehalla/bin/rh-server', command(sys.argv[1], url, run_id), env)
    except Exception:
        # Do not echo exceptions, config, arguments or URL. Native connection errors must be reviewed before activation.
        print('runtime prerequisites refused; private operator diagnosis required', file=sys.stderr)
        raise SystemExit(78) from None


if __name__ == '__main__':
    main()
