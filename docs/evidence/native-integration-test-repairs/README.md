# Test-only integration setup repairs

Base `3c76515e8059a630677276c044796b99e018c981`; test repair commit
`9934225ea18370e3169693e69cadb372ec5865c3`. Exactly three test files change; production code, capability/restore
validators, constants, source expectations, content, identities, headers, tapes, status and lockfile remain unchanged.

- PvE: Full faction mode now positively constructs fire/frost/sentenced camp-map variants and accepts ordinary Frost and
  Sentenced joins. Lower-mode Frost content/join rejection remains, with both serialized-state and state-hash equality.
- Trial row helper: a proper Sentenced/Full profile carries the caster's matching singleton Fighter Mark group and coherent
  tier/hit/progress facts (tier3/6 hits, tier2/3 hits). The helper must pass canonical restore before running the row. The
  original convicted200 versus unconvicted300 assertions remain. This is labelled trusted setup, not ordinary acquisition
  or cast reachability; existing actual-source weapon-hit cases remain separate and were not rerun.
- Allocation helper: the already labelled trusted `sentenced_denial_refills` checkpoint gains only the missing
  `Fighter(2)` group and explicit singleton size. Its tier4/9 hits, HP/barrier, commands, 32 refills, measured windows and
  zero-allocation assertion remain unchanged. The former restore failure was after live crowded combat, not a failed
  crowded producer.

The source Trial selector (`packages/server/src/sim/abilities.ts`) reads `markTierOn`; source
`packages/server/src/sim/factions.ts` requires matching `markGroup`. Native validation correctly rejects a nonzero tier
with no group; no validator was weakened.

## Exact bounded checks

Commands source `final-env.sh`, then set this packet's private `CARGO_TARGET_DIR=../target`. Logs and final source hashes
are pinned in `manifest.json`.

- Focused existing PvE admission test: 1 passed.
- Focused existing Trial row test: 1 passed, including both restore-valid helper setups.
- Existing isolated `no_alloc::a_steady_state_step_allocates_nothing`: 1 passed. Its mixed Sentenced fight measures 660
  zero-allocation steps, 175 Mark pulses and 1892 top-tier frames; all 32 restored helper-denial passes also succeed.
- `cargo clippy -p rh-sim --lib --tests -- -D warnings`: passed; formatting and whitespace checks passed.

No workspace/all-63/source capture/map generation or other broad campaign was run. The old derived Full hash tape remains
byte-identical and intentionally held: checkpoint25/OBS19 versus current private checkpoint27/OBS20 and the coordinator's
pending final checkpoint28/replay22 identity union. This packet does not refresh or admit that tape.
