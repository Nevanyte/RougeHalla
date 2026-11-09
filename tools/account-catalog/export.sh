#!/usr/bin/env bash
set -euo pipefail
MODE=${1:---check}
case "$MODE" in --check|--write) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
# Docker needs the mount point to exist beneath the read-only source bind; dependencies live only in tmpfs.
mkdir -p "$REPO/node_modules"
OUTPUT="$REPO/client-unity/UnityProject/Assets/Resources/Account"
MOUNT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = --check ]; then MOUNT="$MOUNT,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" -e RH_ACCOUNT_CATALOG_OUTPUT=/out \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "$MOUNT" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 node --import tsx tools/account-catalog/export.mts "$MODE"
 '
