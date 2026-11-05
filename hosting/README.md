# hosting/: the GameLift bridge and the match image

One image, two binaries (ADR 0004, [docs/hosting/CONTROL_API.md](../docs/hosting/CONTROL_API.md)):

- `glbridge` (Go, `hosting/glbridge/`): the only code that links the Amazon GameLift Servers Server SDK
  (`github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5` **v5.6.0**, pure Go, no cgo). `ENTRYPOINT`. It
  launches and supervises `rh-server` and maps GameLift's callbacks onto its loopback control API.
- `rh-server` (Rust, built from the workspace, no cloud SDK).

Status: the bridge and the contract are done and tested against a fake SDK and a fake control server. **The Rust side of the
control API is not implemented**, so `glbridge` refuses today's `rh-server` (it reports no `control.requireAdmit`), by design.
Nothing here has run against AWS. Do not push images.

## Tests (no AWS, no Go on the host: use the pinned image)

```bash
cd hosting/glbridge
docker run --rm -v "$PWD":/src -w /src golang:1.25.14-bookworm sh -c 'gofmt -l . && go vet ./... && go test -race -count=1 ./...'
```

`gofmt -l` must print nothing. Go 1.25 is required by the SDK (v5.6.0 `go.mod`). To change the SDK pin:
`docker run --rm -v "$PWD":/src -w /src golang:1.25.14-bookworm go get github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5@<tag> && go mod tidy`.

## Build the image (from the repository root)

The context is trimmed by `hosting/Dockerfile.dockerignore` (sources, lockfile, the one map; no `target/`).

```bash
# linux/arm64 (native on Apple silicon / Graviton), for c9g/m9g-class instances:
docker buildx build --platform linux/arm64 -f hosting/Dockerfile -t rh-match:dev-arm64 --load .
# linux/amd64 (emulated on Apple silicon, native on x86):
docker buildx build --platform linux/amd64 -f hosting/Dockerfile -t rh-match:dev-amd64 --load .
# without the durable-results (PostgreSQL) feature:
docker buildx build --platform linux/arm64 -f hosting/Dockerfile --build-arg RH_FEATURES= -t rh-match:nodb-arm64 --load .
```

A GameLift container fleet needs the image architecture to match the fleet's instance type
(docs/hosting/GAMELIFT_VERIFIED.md section 10). Base images are pinned by tag in the Dockerfile
(`golang:1.25.14-bookworm`, `rust:1.97.0-bookworm`, `debian:bookworm-slim`, the Rust one equal to `rust-toolchain.toml`).
Cold-build measurements, sizes and cgo result: docs/hosting/GAMELIFT_VERIFIED.md and the report that accompanied this change.

## Runtime configuration (flags or `GLBRIDGE_*` environment; everything after `--` goes to rh-server)

| Flag / env | Default | Meaning |
|---|---|---|
| `--server-bin` / `GLBRIDGE_SERVER_BIN` | `/local/game/rh-server` | rh-server binary |
| `--game-port` / `GLBRIDGE_GAME_PORT` | 35000 | container port (must be in the container group's `ContainerPortRanges`) |
| `--control-addr` / `GLBRIDGE_CONTROL_ADDR` | `127.0.0.1:7778` | loopback control listener |
| `--map` / `GLBRIDGE_MAP` | `/local/game/maps/seed1.map.json` | map |
| `--tls-cert`, `--tls-key` / `GLBRIDGE_TLS_CERT`, `_KEY` | none | game listener certificate (wss) |
| `GLBRIDGE_CONTROL_TOKEN` | none | bearer token sent on control requests |
| `--poll-interval`, `--admit-interval`, `--drain-deadline`, `--start-timeout` | 500 ms, 1 s, 4m30s, 30 s | cadences and bounds |
| `--allow-no-admit` | off | development only: accept a server without `--require-admit` |

rh-server is always started with `--max-rooms 1 --require-admit` (one process, one game session; docs/hosting/GAMELIFT_VERIFIED.md
section 3). Example with durable results: `glbridge -- --database-url postgres://...` (the URL then shows in the process list of
the container; prefer a mechanism that does not, once the Rust side supports one).

## Local smoke (what works today)

```bash
docker run --rm rh-match:dev-arm64        # InitSDK fails outside GameLift: "Either AuthToken or AwsRegion ... are required", exit 1
docker run --rm --entrypoint /local/game/rh-server rh-match:dev-arm64 --bind 0.0.0.0:35000 --max-rooms 1 \
    --map /local/game/maps/seed1.map.json   # the Rust server alone
```
