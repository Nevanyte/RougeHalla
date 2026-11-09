#!/usr/bin/env python3
"""Host-only generation. Does not fetch existing secrets, initialize PG roles, or print values."""
import grp
import json
import os
from pathlib import Path
import secrets


def main():
    if os.geteuid() != 0:
        raise SystemExit('root-only runtime provisioning')
    destination = Path('/etc/rougehalla/runtime-secrets.json')
    parent = destination.parent
    if parent.is_symlink() or not parent.is_dir() or parent.stat().st_uid != 0 or parent.stat().st_mode & 0o027:
        raise SystemExit('private root-owned configuration directory required')
    gid = grp.getgrnam('rougehalla').gr_gid
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    try:
        os.fchmod(fd, 0o640); os.fchown(fd, 0, gid)
        with os.fdopen(fd, 'w') as stream:
            json.dump({'database_password': secrets.token_hex(32), 'playtest_passcode': secrets.token_hex(32)}, stream)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    print('runtime secret file created; values withheld; PG role provisioning remains required')


if __name__ == '__main__':
    main()
