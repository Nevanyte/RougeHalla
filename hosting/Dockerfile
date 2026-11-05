# syntax=docker/dockerfile:1.7
#
# One image, two binaries (docs/hosting/CONTROL_API.md, ADR 0004): `glbridge` (Go, the only code that links the GameLift
# Server SDK) is the ENTRYPOINT and launches/supervises `rh-server` (Rust, no cloud SDK) on a loopback control port.
#
# Build from the repository root (the context is trimmed by hosting/Dockerfile.dockerignore):
#   docker buildx build --platform linux/arm64 -f hosting/Dockerfile -t rh-match:dev-arm64 --load .
#
# A GameLift container fleet needs an image whose architecture matches the fleet instance type (arm64 for Graviton).
# Build one image per architecture; this file never selects an architecture itself.
ARG GO_IMAGE=golang:1.25.14-bookworm
ARG RUST_IMAGE=rust:1.97.0-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

FROM ${RUST_IMAGE} AS rust-build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
# The image pins the toolchain (1.97.0, same as rust-toolchain.toml); skipping the file avoids a rustup component fetch.
# `postgres` links rh-persist (durable results). Pass --build-arg RH_FEATURES= for a database-free build.
ARG RH_FEATURES=postgres
RUN cargo build --release --locked -p rh-server --features "${RH_FEATURES}" \
    && strip target/release/rh-server \
    && cp target/release/rh-server /rh-server

FROM ${GO_IMAGE} AS go-build
WORKDIR /src
COPY hosting/glbridge/go.mod hosting/glbridge/go.sum ./
RUN go mod download
COPY hosting/glbridge ./
# CGO_ENABLED=0 is asserted, not assumed: the build fails if the SDK ever starts to need cgo.
# GLBRIDGE_TAGS is empty for every real image. `--build-arg GLBRIDGE_TAGS=fakesdk` builds the local end-to-end image with a
# scripted fake instead of the GameLift SDK (hosting/README.md); never push or deploy that one.
ARG GLBRIDGE_TAGS=
RUN CGO_ENABLED=0 go build -tags "${GLBRIDGE_TAGS}" -trimpath -ldflags="-s -w" -o /glbridge . \
    && go version -m /glbridge | grep -q 'CGO_ENABLED=0'

FROM ${RUNTIME_IMAGE}
ENV HOME_DIR=/local/game
RUN useradd -m gamelift && mkdir -p ${HOME_DIR}/maps && chown -R gamelift:gamelift ${HOME_DIR}
COPY --from=rust-build /rh-server ${HOME_DIR}/rh-server
COPY --from=go-build /glbridge ${HOME_DIR}/glbridge
COPY parity/maps/seed1.map.json ${HOME_DIR}/maps/seed1.map.json
WORKDIR ${HOME_DIR}
USER gamelift
# glbridge flags/env are documented in hosting/README.md. The container port (GLBRIDGE_GAME_PORT) must be one of the
# PortConfiguration.ContainerPortRanges of the container group definition. Logs go to stdout/stderr (container fleets capture them).
ENV GLBRIDGE_SERVER_BIN=${HOME_DIR}/rh-server \
    GLBRIDGE_GAME_PORT=35000 \
    GLBRIDGE_CONTROL_ADDR=127.0.0.1:7778
ENTRYPOINT ["/local/game/glbridge"]
