#!/usr/bin/env bash
# End to end, no AWS: the REAL Go bridge (its scripted fake-SDK build, tag `fakesdk`) drives a REAL rh-server binary and a real
# WebSocket client through a whole game session. See crates/rh-server/tests/bridge_e2e.rs and hosting/README.md.
#
# Go is not required on the host: the bridge is cross-compiled for this host (pure Go, CGO_ENABLED=0) in the pinned image.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/target/e2e"
mkdir -p "$out"
case "$(uname -s)" in Darwin) goos=darwin ;; Linux) goos=linux ;; *) echo "unsupported OS" >&2; exit 2 ;; esac
case "$(uname -m)" in arm64|aarch64) goarch=arm64 ;; x86_64) goarch=amd64 ;; *) echo "unsupported CPU" >&2; exit 2 ;; esac
docker run --rm -v "$root/hosting/glbridge":/src -v "$out":/out -w /src \
  -e CGO_ENABLED=0 -e GOOS="$goos" -e GOARCH="$goarch" \
  golang:1.25.14-bookworm go build -tags fakesdk -trimpath -o /out/glbridge-fake .
cd "$root"
RH_GLBRIDGE_FAKE="$out/glbridge-fake" cargo test -p rh-server --test bridge_e2e --locked -- --ignored --nocapture
