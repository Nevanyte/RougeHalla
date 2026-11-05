# hosting/placement: regional probes and placement tooling

The placement logic itself is the Rust crate `crates/rh-placement` (pure planner, GameLift/DNS interfaces, fakes). This directory
holds the browser-side probe and the shared test vectors. Design: `docs/hosting/PLACEMENT.md`, `docs/hosting/TLS_DNS.md`,
`docs/hosting/LATENCY_PROBES.md`.

| Path | What |
|---|---|
| `probe/probe.mjs` | Browser-compatible probe module: warm-up + median of N `GET /ping` per region origin, 2+ failures drop a region, calibration helper |
| `probe/probe.test.mjs` | Unit tests (fake fetch and clock), `node --test` |
| `probe/probe-cli.mjs` | Same probe from a terminal against real regional probe hosts (NOT RUN here) |
| `probe/local-proof.mjs` | Local proof: rh-server with a real PEM wildcard certificate and with `--self-signed`, verified Node TLS, Chromium WSS and CORS probe, calibration mechanism |
| `vectors/hostnames.json` | Placement id -> hostname vectors shared by the Rust crate and the Node DNS tool (both test against it) |

```bash
node --test hosting/placement/probe/probe.test.mjs
cargo build -p rh-server
NODE_PATH=<dir with node_modules/playwright> node hosting/placement/probe/local-proof.mjs
```
