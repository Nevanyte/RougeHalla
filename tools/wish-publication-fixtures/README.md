# Wish owner stock display source witness

This additive witness imports the legacy `chargesAt`, `nextChargeAt`, and `abilityCooldownMs` helpers and bundles the actual
client `abilitySlotModel`. It records zero-recharge helper behavior, the `fullAt ?? 0` fallback, the run opening lock, Blaze
partial/empty/full stocks, and training cooldown behavior. The fixture does not seed or claim a server world state.

Captured fixture: `parity/abilities/wish-display.json`

- Fixture SHA-256: `a8da4bd8c3b26216e30aacf4c2569378fa789ebcca879164a64294709d86908b`
- Runtime image: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
- Node.js: `22.23.4`; tsx: `4.23.15`; esbuild: `0.28.2`
- Package lock SHA-256: `991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`

Capture and verify with:

```sh
RH_WISH_DISPLAY_DIRECTORY="$PWD/parity/abilities" tools/wish-publication-fixtures/capture.sh capture
RH_WISH_DISPLAY_DIRECTORY="$PWD/parity/abilities" tools/wish-publication-fixtures/capture.sh --check
```

The Rust comparison is focused and uses an isolated target directory:

```sh
PATH=/Users/nevinmckinnon/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin:$PATH \
  CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/targets/rougehalla-wish-display CARGO_BUILD_JOBS=1 \
  cargo test -p rh-sim owner_view_tests --lib
```

Zero recharge is represented exactly as the imported helpers return it: `chargesAt` uses a one-millisecond denominator
floor, while `nextChargeAt` uses the raw recharge interval in its deadline calculation. The captured future-clock case
therefore returns zero charges and `next == fullAt`; this is helper parity evidence, not a new game rule. The legacy
display itself gets `fullAt` from `i.fullAt ?? 0` and keeps its opening-lock timer based on `readyAt`.
