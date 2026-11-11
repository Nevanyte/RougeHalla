# P-WIRE17-HUD-1: protocol 17 carries camp rewards, wards and the owner's build numbers

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: HUD presents the legacy
  information, "this includes camp timers, vision wards etc.")
- **Implementer tier:** implementer-opus (wire format, observation, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10); golden vectors required for a wire change · D2 n/a ·
  D5/D6/D9 none

## 1. ID and outcome
Legacy shows, and Unity cannot yet: the stat reward each camp gives (badges on the Tab map and over living camps), ward
beacons with ownership and seconds left, the top-left GAINED strip (nine values plus farmed mob bonuses) and the
bottom-left champion panel (per-hit damage split, attacks per second, passive numbers). Unity may not recompute combat
numbers, so the server must send them. When this lands, still as protocol 17: each camp row carries its reward (stat
and amount) and a ward verdict (none, yours, another player's) with its expiry; the weapon table carries each weapon's
scaling terms; and the owning player alone receives a build summary (the values from `rh_sim::build_summary`, the
held-weapon hit split and attacks per second, the faction passive numbers, the Fire roam charge).

## 2. Dependencies
- P-WIRE17-MAP-1 merged (same protocol version, same decoders: strictly serial)
- P-SIM-BUILDSUMMARY-1 merged (the GAINED values)

## 3. Relevant legacy paths
- `packages/client/src/ui/buildModel.ts`, `buildHud.ts`: GAINED strip and mob bonuses
- `packages/client/src/ui/championCombatModel.ts:91-216`: champion panel rows and their formulas
- `packages/client/src/render/CampWards.ts:13-56`, `packages/shared/src/schema.ts:226-227`: ward owner and expiry were
  synced room-wide; the UI drew "YOUR WARD Ns" or "WARD Ns"
- `packages/client/src/render/CampBuffs.ts`, `packages/client/src/ui/planning.ts:160-193`: per-camp reward badges

## 4. New paths
- none beyond tests; `protocol/fixtures/v17.json` is regenerated

## 5. Exclusive write scope
- `crates/rh-sim/src/observe.rs` (camp view: ward verdict and expiry per viewer, reward per camp; owner summary view;
  `OBSERVATION_VERSION`), `crates/rh-sim/src/build_summary.rs` (champion panel values added beside the GAINED values)
- `crates/rh-protocol/src/state.rs` (`WireCamp`, the owner-only state key), `weapon.rs`, `samples.rs`
- `crates/rh-policy/src/delivery/` (projection and collections for the new fields; policy contract version)
- `crates/rh-server/src/wire.rs`
- `client-unity/RoguehallaNet/Protocol/`, `client-unity/RoguehallaNet/Net/Collections.cs`, `Views.cs`, the synced copy
- `tools/protocol-js/`; `protocol/fixtures/v17.json`

## 6. Contracts and references
- C-OBS: the build summary reaches its owner only; a ward is sent as a three-state verdict, never the owner's id; a
  camp's reward is content, public as in legacy. Leak tests stay green.
- R-AUTH: every number the HUD shows about a build is computed by Rust.
- Existing ingredients: `Runtime::mirrors()` and `modifiers::packet` (`crates/rh-sim/src/modifiers/mod.rs:117,581-634`),
  `content::attack_interval` (`content.rs:309`), `frost_chill`, `execute_share`, `mark_pulse` (`modifiers/mod.rs`),
  `holy_lifesteal_fraction` (`content.rs`), `fire_roam::charge` (`systems/fire_roam.rs:28`), `Farm::reward_of`
  (`modifiers/farm.rs`), `CampLife` (`mob_runtime.rs`).
- Identities: observation 24 -> next, policy 18 -> next; checkpoint 31 and replay 25 unchanged (nothing serialized is
  added: the ward verdict is an observation-side view); content hash unchanged.

## 7. Behaviour to preserve
- No schedule row, RNG draw or sim state change; the state hash of every fixture is unchanged.
- Bots (`rh-policy`) keep acting on the same facts: the new fields are added to the projection, not used for decisions.
- Summary values that change every tick (hp-dependent leech) are quantized on the wire so deltas stay small.

## 8. Acceptance checks
- `scripts/gate.sh --quick --regen-fixtures` passes in the worktree; the coordinator runs the full gate on the merge.
- A seat never receives another seat's build summary (one test with two seats).
- One sanity test: a known build's summary on the wire equals `build_summary` within the quantization step.
- C# and JS decode the regenerated `v17.json` byte for byte and expose camp reward, ward verdict and expiry, weapon
  scaling and the owner summary.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-WIRE17-HUD-1`

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes`, `cargo test -p rh-protocol`, `cargo test -p rh-policy`
- `cargo run -p rh-protocol --bin protocol-fixtures`, `node tools/protocol-js/check-vectors.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: observation, wire and three decoders in one branch, with an owner-only block that must not leak.

## 11. Known traps
- `CampRoster` is checkpoint state with `deny_unknown_fields`: do not add the ward view to it.
- Camp rewards may differ per camp once zone-themed buffs are ported: carry the reward per camp row, not per mob type.
- `observe.rs` is a shared file: this packet merges alone.
- If the diff passes about 400 lines, split the champion panel values into P-WIRE17-HUD-2 and say so.

## Notes from previous attempts
