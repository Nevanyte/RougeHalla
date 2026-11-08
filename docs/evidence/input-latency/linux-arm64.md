# Linux ARM64 `rh-server` staging artifact

Prepared locally on 2026-11-08 from source commit `23b2e4cfe9eb7530d350b176fd08d108eb739dda` (the checkout HEAD immediately before the build). No Rust gameplay or `Cargo.lock` edits were made for this preparation.

## Build

The first invocation omitted `-f hosting/Dockerfile` and failed because the repository-root default Dockerfile has no `rust-build` target. The successful rerun selected the intended file explicitly:

```sh
docker buildx build --platform linux/arm64 -f hosting/Dockerfile \
  --target rust-build \
  --build-arg RH_FEATURES= \
  --build-arg CARGO_BUILD_JOBS=1 \
  --build-arg RH_BUILD=23b2e4cf \
  -t rh-input-latency-rust:23b2e4cf --load .
```

The release Cargo build finished successfully in 2m46s, and Buildx loaded `rh-input-latency-rust:23b2e4cf` locally. Docker reports `OS=linux ARCH=arm64`; the base builder was `rust:1.97.0-bookworm` (`sha256:8fa55b2f3ddf97471ab6a767bfa3f37e6bad0986ba823e75fea57e2a2a5c3073`). Full build output, including the initial path-selection failure and successful rerun, is in [linux-arm64-build.log](linux-arm64-build.log).

## Extracted executable

The artifact was copied from a stopped container created from the newly built image, then that owned container was removed. The executable is at:

`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/bundle/bin/rh-server`

`file` identifies it as a stripped, dynamically linked ELF 64-bit LSB PIE executable for ARM aarch64. Size: 6.6 MiB. SHA-256: `5f12724513b9ab50478f2fbf2bb266a84fd9167e7baea57102602e68b9c4cb4c`.

## Loopback smoke check

The built image was run without published ports, with the server explicitly bound to container loopback:

```sh
docker run -d --name rh-input-latency-smoke-23b2e4cf \
  --entrypoint /rh-server rh-input-latency-rust:23b2e4cf \
  --bind 127.0.0.1:17777 --first-playable --min-players 1 \
  --lobby-seconds 0 --fill-seconds 0
```

The container reached `running`, had no published ports (`Ports={}`), and logged:

```text
[server] ws/http (dev only) on 127.0.0.1:17777 | protocol 11 content 801a76cde4cfd305
```

`curl --fail --silent --show-error http://127.0.0.1:17777/info`, executed inside that same container, returned HTTP 200 JSON with `"protocol":11`, `"contentHash":"801a76cde4cfd305"`, and `"state":"ready"`. The smoke container was stopped and removed after the check. No unrelated container was removed.

No AWS CLI was used, and no AWS command, cloud call, push, or deployment was made. Docker client/server were 29.2.1; Buildx was 0.32.1-desktop.1.
