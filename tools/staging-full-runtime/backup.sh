#!/bin/bash
# HOST ONLY, root. Not called by preparation. Local encrypted capture is NOT offhost delivery proof.
set +x
set -euo pipefail
umask 077
data=/srv/rougehalla-data
socket=/run/rougehalla-postgres
test "$(id -u)" = 0
test "$#" = 2 # public age recipient, NEW encrypted output path outside the retained source volume
recipient=$1
output=$2
[[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]]
test -f "$data/installation-verified.json"
mountpoint -q "$data"
test ! -e "$output"
command -v age >/dev/null
command -v pg_dump >/dev/null
python3 - "$output" "$data" <<'PY'
from pathlib import Path
import sys
target=Path(sys.argv[1]).resolve(); data=Path(sys.argv[2]).resolve()
if not Path(sys.argv[1]).is_absolute() or data==target or data in target.parents:
    raise SystemExit('encrypted staging output must be absolute and outside the source data mount')
PY
# Drain both real processes before taking the bank of DB + pending spool bytes. Never restart automatically.
systemctl stop rougehalla-source.service rougehalla-training.service
! systemctl is-active --quiet rougehalla-source.service
! systemctl is-active --quiet rougehalla-training.service
test -f "$data/writers.lock"
exec 9>"$data/writers.lock"
flock -n -x 9
sessions=$(runuser -u postgres -- psql -X -h "$socket" -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname='rougehalla'")
test "$sessions" = 0
for setting in fsync synchronous_commit full_page_writes; do
    test "$(runuser -u postgres -- psql -X -h "$socket" -d postgres -Atqc "SHOW $setting")" = on
done
work=$(mktemp -d /var/tmp/rougehalla-backup.XXXXXX)
outputtmp=
cleanup() { rm -rf -- "$work"; if test -n "$outputtmp"; then rm -f -- "$outputtmp"; fi; }
trap cleanup EXIT
outputtmp=$(mktemp "$(dirname "$output")/.rougehalla-encrypted.XXXXXX")
chmod 0700 "$work"
# Redirect through the root shell so postgres never owns the private directory.
runuser -u postgres -- pg_dump -h "$socket" -d rougehalla --format=custom --no-owner --no-acl > "$work/database.dump"
mkdir "$work/spool-source"
cp -a "$data/spool-source/." "$work/spool-source/"
# Training produces no results; any accidental pending training output is a refusal, not discarded data.
if test -d "$data/spool-training"; then
    test -z "$(find "$data/spool-training" -type f -print -quit)"
fi
python3 - "$work" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
root = Path(sys.argv[1]); rows = []
for p in sorted(root.rglob('*')):
    if p.is_symlink(): raise SystemExit('backup symlink refused')
    if not (p.is_file() or p.is_dir()): raise SystemExit('backup special file refused')
    if p.is_file():
        with p.open('rb') as f: os.fsync(f.fileno())
        h=hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
        rows.append({'path': p.relative_to(root).as_posix(), 'sha256': h.hexdigest()})
(root/'manifest.json').write_text(json.dumps({'format':'rh-staging-cold-backup/1','quiesced':True,'files':rows},sort_keys=True)+'\n')
with (root/'manifest.json').open('rb') as f: os.fsync(f.fileno())
PY
# Encryption uses only the public recipient. Keep the decrypting identity off this host and out of logs/templates.
# Publish only complete ciphertext, with a create-new hardlink on the output filesystem. No plaintext archive is written.
tar -C "$work" -cf - database.dump spool-source manifest.json | age -r "$recipient" > "$outputtmp"
python3 - "$outputtmp" "$output" <<'PY'
import os,sys
with open(sys.argv[1],'rb') as f: os.fsync(f.fileno())
os.link(sys.argv[1],sys.argv[2])
directory=os.open(os.path.dirname(sys.argv[2]),os.O_RDONLY)
try: os.fsync(directory)
finally: os.close(directory)
PY
echo 'encrypted local backup captured; OFFHOST UPLOAD + INDEPENDENT RESTORE STILL REQUIRED; runtimes remain stopped'
