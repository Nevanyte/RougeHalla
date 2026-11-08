# Bot fill-policy witness (P-BOTS-7)

These tools capture the actual TypeScript source's lobby fill behaviour for the Rust room: the real
`packages/server/src/bots/BotManager.ts` driven over a real headless world in the pinned Linux amd64 Node 22.23.4
container (arrival schedule, countdown squeeze, human joins, lobby-closing top-up, yield seat, and the exact
tier/persona/faction/name/seed draws and stream values), plus the exported constants of `brain/types.ts`, the
callsigns of `callsigns.ts` (including the digit-suffix fallback when the pool is taken) and the
`brain/random.ts` softmax draw.

Only the pinned official image is accepted (pinned by digest in `capture.sh`; the corpus records Node/platform/arch
and the hashed source closure). Inputs are declared seeds, configs, timings and rosters; expected values are the actual
source manager's results, never computed from Rust, and no entropy is read.

## Capture and check

```sh
tools/bot-fill-fixtures/capture.sh            # write parity/policy/bot-fill.json
tools/bot-fill-fixtures/capture.sh --check    # one canonical recapture/compare
```

`RH_FILL_OUTPUT` selects another output directory. The repository is mounted read-only and npm ci uses the lockfile in
a temporary node_modules mount.

Rust validation: `cargo test -p rh-server --lib --all-features bot_fill` (the report constants, callsigns, softmax and
the six lobby scenarios replayed tick by tick) plus the room and director native tests
(`room::tests::the_fill_policy*`, `room::tests::a_human_joining*`, `director::tests::the_configured_fill*`).

## Mutants

```sh
CARGO=... tools/bot-fill-fixtures/run-mutants.sh
```

Each committed mutant reverts one ported rule (the arrival end margin, the squeeze ratio, the exploration floor, and
which end of the yield order gives its seat up); each must make the parity tests fail semantically, and the unchanged
control must pass.
