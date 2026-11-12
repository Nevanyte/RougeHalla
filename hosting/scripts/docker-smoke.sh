#!/usr/bin/env bash
# Smoke test of the fakesdk image (hosting/README.md): starts it, plays GameLift from inside the container with bash /dev/tcp
# (the script and control ports are loopback-only), and checks ready -> start -> activate -> reserve -> admitted -> terminate ->
# ProcessEnding -> exit 0. No game client joins here (the native end-to-end test does that with the same binaries).
set -euo pipefail
image="${1:?usage: docker-smoke.sh <fakesdk image>}"
name="rh-fake-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --platform linux/arm64 --entrypoint /bin/bash "$image" -c 'exec /local/game/glbridge --poll-interval 200ms --admit-interval 200ms -- --insecure-dev-auth' >/dev/null
http() { # port method path body
  docker exec "$name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/$1; printf "%s %s HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s" "$2" "$3" "${#4}" "$4" >&3; cat <&3' _ "$1" "$2" "$3" "$4" 2>/dev/null || true
}
for _ in $(seq 1 100); do http 7790 GET /calls '' | grep -q 'ProcessReady' && break; sleep 0.2; done
echo "--- calls after start:"; http 7790 GET /calls '' | tail -1
echo "--- control health (loopback inside the container):"; http 7778 GET /control/health '' | tail -1 | cut -c1-80
http 7790 POST /start '{"id":"gs-smoke","maxPlayers":4}' >/dev/null
sleep 1
http 7790 POST /reserve '{"id":"psess-1","playerId":"alice"}' >/dev/null
sleep 1
echo "--- rooms:"; http 7778 GET /control/rooms '' | tail -1
http 7790 POST /terminate '' >/dev/null
for _ in $(seq 1 50); do [ "$(docker inspect -f '{{.State.Running}}' "$name")" = false ] && break; sleep 0.3; done
echo "--- exit code: $(docker inspect -f '{{.State.ExitCode}}' "$name")"
docker logs "$name" 2>&1 | grep -E '"msg":"(process ready|game session active|admit sent|terminate requested|exit)"|server\] terminated' | cut -c1-200
