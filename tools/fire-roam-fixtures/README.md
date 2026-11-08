# Fire roam slice fixtures (P-FACTION-2)

`helpers.ts` probes the actual exported source helpers (`packages/shared/src/fireRoam.ts`) over their boundary grid;
`capture.sh` captures the two ordinary-input traces through the real legacy simulation in the pinned container and
runs the helper probe. Nothing patches `packages/`; the only trusted inputs are the real scenario commands.

Pinned environment: Linux x64 Node 22.23.4 (the `v22.23.4-linux-x64` prefix mounted at `/node`), image
`c86ecead9e55`, read-only `/repo` (the worktree), an executable writable tmpfs `/repo/node_modules`, a persistent
npm cache and an external writable `/out`:

```sh
bash tools/fire-roam-fixtures/capture.sh
cp "${RH_FIRE_ROAM_OUT:-$HOME/.codex/tools/rougehalla-stage2/fire-roam-capture}/helpers.json" parity/fire-roam/helpers.json
cp "${RH_FIRE_ROAM_OUT:-$HOME/.codex/tools/rougehalla-stage2/fire-roam-capture}"/fire_roam_*.json parity/fixtures/
```

The committed bytes are the pinned container's bytes (`cmp` after a re-capture). Rust checks:
`cargo test -p rh-parity --test fire_roam`, `cargo test -p rh-sim --lib systems::fire_roam` and
`cargo test -p rh-parity --test schedule`.
