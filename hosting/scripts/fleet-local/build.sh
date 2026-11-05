#!/usr/bin/env bash
# Builds what the local fleet proof runs (no AWS): two real builds of rh-server that differ only in RH_BUILD (the compile-time
# build id, rh_sim::replay::BUILD_ID), the fakesdk glbridge, and the one-seat game client. Output: target/fleet-local/bin.
# Go is not required on the host: the bridge is cross-compiled in the pinned golang image (same as hosting/scripts/e2e-bridge.sh).
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
bin="$root/target/fleet-local/bin"
mkdir -p "$bin"
cd "$root"
for b in A B; do
  # Changing RH_BUILD rebuilds rh-sim and everything above it: that is what makes the two binaries different builds.
  RH_BUILD="fleet-build-$b" cargo build --release --locked -p rh-server --bin rh-server
  cp target/release/rh-server "$bin/rh-server-$b"
done
cargo build --release --locked -p rh-server --example fleet_client
cp target/release/examples/fleet_client "$bin/fleet_client"
case "$(uname -s)" in Darwin) goos=darwin ;; Linux) goos=linux ;; *) echo "unsupported OS" >&2; exit 2 ;; esac
case "$(uname -m)" in arm64|aarch64) goarch=arm64 ;; x86_64) goarch=amd64 ;; *) echo "unsupported CPU" >&2; exit 2 ;; esac
docker run --rm -v "$root/hosting/glbridge":/src -v "$bin":/out -w /src \
  -e CGO_ENABLED=0 -e GOOS="$goos" -e GOARCH="$goarch" \
  golang:1.25.14-bookworm go build -tags fakesdk -trimpath -o /out/glbridge-fake .
for b in A B; do
  printf '%s sha256=%s id=%s\n' "rh-server-$b" "$(shasum -a 256 "$bin/rh-server-$b" | cut -d' ' -f1)" \
    "$(strings -a "$bin/rh-server-$b" | grep -o 'fleet-build-[AB]' | sort -u | tr '\n' ',')"
done
ls -l "$bin"
