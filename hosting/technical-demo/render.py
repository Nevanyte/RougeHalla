#!/usr/bin/env python3
"""Offline only: render user data from nonsecret JSON and this exact bootstrap."""
import base64
from pathlib import Path
import sys
from bootstrap import config


def render(raw, bootstrap):
    _, end = config(raw)
    encoded = base64.b64encode(raw).decode()
    source = base64.b64encode(bootstrap).decode()
    calendar = end.strftime('%Y-%m-%d %H:%M:%S UTC')
    return f'''#!/bin/bash
set -euo pipefail
set +x
umask 077
trap '/usr/bin/systemctl --no-block poweroff || /sbin/poweroff -f' ERR
[ "$(id -u)" = 0 ]
[ ! -e /etc/rougehalla-demo.json ]
install -d -m 0755 /usr/local/lib/rh-demo
printf '%s' '{encoded}' | base64 --decode > /etc/rougehalla-demo.json
chmod 0600 /etc/rougehalla-demo.json
printf '%s' '{source}' | base64 --decode > /usr/local/lib/rh-demo/bootstrap.py
chmod 0644 /usr/local/lib/rh-demo/bootstrap.py
/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py guard
cat > /etc/systemd/system/rh-demo-poweroff.service <<'EOF'
[Unit]
Description=Fixed demo expiry or failure poweroff
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --no-block poweroff
EOF
cat > /etc/systemd/system/rh-demo-expiry.timer <<'EOF'
[Unit]
Description=Original absolute demo deadline; never renewed
[Timer]
OnCalendar={calendar}
AccuracySec=1s
RandomizedDelaySec=0
Persistent=true
Unit=rh-demo-poweroff.service
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/rh-demo-setup.service <<'EOF'
[Unit]
Requires=rh-demo-expiry.timer
After=rh-demo-expiry.timer network-online.target
Wants=network-online.target
OnFailure=rh-demo-poweroff.service
FailureAction=poweroff
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py install
TimeoutStartSec=600
TimeoutStopSec=10
KillMode=control-group
Restart=no
EOF
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable --now rh-demo-expiry.timer
/usr/bin/systemctl is-active --quiet rh-demo-expiry.timer
/usr/bin/systemctl start --no-block rh-demo-setup.service
'''


if __name__ == '__main__':
    raw = Path(sys.argv[1]).read_bytes()
    sys.stdout.write(render(raw, Path(__file__).with_name('bootstrap.py').read_bytes()))
