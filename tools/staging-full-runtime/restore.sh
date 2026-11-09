#!/bin/bash
# HOST ONLY, separate clean target. No bootstrap, migration or credential regeneration over restored data.
set +x
set -euo pipefail
umask 077
test "$(id -u)" = 0
test "$#" = 3 # encrypted artifact, PRIVATE runtime age identity file, NEW pending-spool destination
archive=$1
identity=$2
pending=$3
socket=/run/rougehalla-postgres
test ! -e "$pending"
test -f "$archive"
test -f "$identity"
test "$(stat -c '%a' "$identity")" = 600
test "$(stat -c '%u' "$identity")" = 0
! systemctl is-active --quiet rougehalla-source.service
! systemctl is-active --quiet rougehalla-training.service
test "$(runuser -u postgres -- psql -X -h "$socket" -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname='rougehalla'")" = 0
# Operator must create an EMPTY target database + non-superuser application role using the reviewed private provisioning path.
test "$(runuser -u postgres -- psql -X -h "$socket" -d rougehalla -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")" = 0
for setting in fsync synchronous_commit full_page_writes; do
    test "$(runuser -u postgres -- psql -X -h "$socket" -d postgres -Atqc "SHOW $setting")" = on
done
work=$(mktemp -d /var/tmp/rougehalla-restore.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
age --decrypt -i "$identity" "$archive" > "$work/plaintext.tar"
# Reject traversal, links, devices, duplicates and unmanifested bytes before extraction or DB mutation.
python3 /opt/rougehalla/preparation/backup_archive.py "$work"
# Keep application ownership (not postgres ownership) on restored tables; original grants/roles are separately initialized.
chmod 0710 "$work"
chgrp postgres "$work"
chmod 0640 "$work/database.dump"
chgrp postgres "$work/database.dump"
runuser -u postgres -- pg_restore -h "$socket" -d rougehalla --exit-on-error --single-transaction --no-owner --no-acl --role=rougehalla "$work/database.dump"
mv "$work/spool-source" "$pending"
chown -R rougehalla:rougehalla "$pending"
echo 'database+pending bytes restored; SAME-CLIENT/FENCING/IDEMPOTENCE AND SOURCE REPLAY PROOF STILL REQUIRED; no server started'
