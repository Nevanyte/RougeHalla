#!/bin/bash
# REVIEW MATERIAL ONLY. Not connected to userdata, preparer, deployment or an active installer.
set +x
set -euo pipefail
umask 077
test "$(id -u)" = 0
/usr/bin/python3 - <<'PY'
import datetime as dt, json, os, stat
from pathlib import Path
files = {'rougehalla-absolute-expiry.timer': '[Unit]\nDescription=Fixed run expiry 20000101t000000z-abcdef\n[Timer]\nOnCalendar=2000-01-01 04:00:00 UTC\nPersistent=true\nAccuracySec=1s\nRandomizedDelaySec=0\nUnit=rougehalla-absolute-expiry.service\n[Install]\nWantedBy=timers.target\n', 'rougehalla-absolute-expiry.service': '[Unit]\nDescription=Terminate only this host at its immutable deadline\n[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl poweroff\n', 'deadline.json': '{"expires_at": "2000-01-01T04:00:00Z", "format": "rh-fixed-host-deadline/1", "run_id": "20000101t000000z-abcdef"}\n'}
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
