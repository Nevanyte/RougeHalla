# P-MOBS-CATALOG-1: pure typed catalog and rosters

## ID and outcome
P-MOBS-CATALOG-1. Port the pure typed catalog/roster leaf as a reusable prerequisite for the **full** P-MOBS-1 runtime. Deliver source-derived tables, lookup/fallback behavior and draw-injected roster functions, with strict differential fixtures. This is not mob spawning, actor integration or runtime acceptance. Design baseline: optimization_port `2e4aeaec`; rebase source provenance to the actual reviewed implementation revision.

## Dependencies
Existing shared source, capture conventions in `parity/README.md`, and core layout in `crates/rh-sim/README.md`. No pending gameplay producer is needed. Use existing dependencies only. Coordinator must serialize the minimal module exposure and later content registration; no runtime or status seam is a prerequisite for this leaf.

## Relevant legacy paths (verified with rg)
- `packages/shared/src/mobs.ts`: `MOB_TYPES`, `MOB_ROLE_DEFS`, `MOB_ROLES`, `mobTypesOf`, `normalTypesOf`, `elitesOf`, `mobTypeById`, `mobTypeIn`, `mobName`, `mobWeapon`, `mobReachDamage`, `mobTypeWeapon`.
- `packages/shared/src/rosters.ts`: `BAG_COPIES`, `rollZoneTypes`, `rollCampTypes`, `rollCampElites`, `campMobs`; `packages/shared/src/rng.ts`: `shuffle` and supplied `Rng` contract.
- Read-only supporting definitions: `packages/shared/src/{map,weapons,constants,factions}.ts`; tests `packages/shared/test/{mobs,rosters}.test.ts`.
- `packages/server/src/sim/world.ts`: `rewardStream` is four-word sfc32 with 16 warmup draws; `packages/server/src/sim/camps.ts`: `rollRosters` invokes the private reward stream before joins, excluding training. These establish provenance, not production RNG implementation scope.

## New paths
`crates/rh-sim/src/mob_catalog/**` (including module root and roster submodule), `crates/rh-sim/tests/mob_catalog.rs`, `tools/mob-fixtures/catalog-rosters.ts`, `parity/mobs/catalog-rosters.json`, and concise `docs/evidence/stage2-mob-catalog/README.md`. Keep catalog numeric/string definitions and a typed definition/metadata visitor together so the coordinator can register the actual values without a duplicate checksum table.

## Exclusive write scope
Only the new paths above. Propose at most the minimal `pub mod mob_catalog;` declaration in the private checkout for compilation in `crates/rh-sim/src/lib.rs`; coordinator applies the export/access seam needed for the integration test and content registration. No unrelated public API expansion. No edits to `content.rs`, state/store/checkpoint/scratch/schedule, existing gameplay, capture.ts, shared status, manifests/dependencies, Cargo.lock, CI, protocol, server or Unity. No spawn, combat, AI, reward, leash or private World reward-stream implementation. Existing source is read-only.

## Contracts and references
C-PARITY, C-RNG, C-NUM and ADR 0007/0009; `docs/REQUIREMENTS.md`, `docs/CONTRACTS.md`, `docs/backlog/README.md`, `docs/sweep/PACKAGES.md`, `parity/README.md`. Core stays pure: no I/O, clock or entropy. Draw injection proves roster consumption/output equivalence, **not native RNG equivalence**. Production private stream integration remains P-MOBS-1. Source salts/tapes are synthetic test inputs, never live secrets.

## Behaviour to preserve
- Exactly 30 ordered types (20 normal/10 elite; six per faction), five ordered roles, complete names/labels/blurbs/tags, copied role multipliers and weapons. Preserve source ordering and lookup absence semantics. Cover region defaults, missing/unknown ID and valid cross-zone ID behavior separately; do not conflate `mobTypeById` with `mobTypeIn`.
- Include faithful pure `mobReachDamage` and `mobTypeWeapon` behavior, using real weapon shape/default definitions. Exclude `mobFaction` and `mobTypeFaction`: today's eight-field Rust faction sheet cannot represent source signature parameters. A reduced physical sheet is not full faction parity.
- Three separately shuffled four-type rounds; nine draws per represented zone even for one camp, none for zero camps. Zones consume in first-seen order, camps retain input order, bag wraps after 12. Elites draw nothing, count only elite camps per zone and wrap after two. `campMobs` preserves spots order and source optional-elite default semantics.
- Capture unmodified actual source functions with explicitly declared input tapes or source `rewardStream` salts/streams; record draws consumed and an independent continuation suffix. Do not feed recorded expected rosters to the source or use expected outputs to select inputs. Rust receives the same declared random tape; it does not synthesize source RNG from the public map seed or Mulberry32.

## Acceptance checks
1. Closed schema and exact inventory: all 30 types, five roles and every listed helper; exhaustive known-ID/region pairs plus missing/unknown IDs. At least 200 distinct source streams with unique declared stream identities, plus empty/interleaved/repeated zones, counts 1/4/10/12/13, zero count, elite wrap and empty/mixed spot layouts. Validate actual domain and source semantics rather than inventing behavior for invalid faction IDs.
2. Canonical recapture on Linux x64 Node 22.23.4 reproduces bytes. Record source revision, hashes of every imported behavior-defining source input, runtime/tool versions, capture command, input inventory, expected/observed case counts and draw/continuation lengths. Refuse stale provenance, unknown fields/cases, duplicates, missing cases, malformed typed keys/values, nonfinite/out-of-range tapes, exhausted tapes and truncated continuations. Unknown lookup strings remain valid only in their explicitly declared lookup/fallback cases. Exact discrete/order/draw equality; continuous tolerance only per parity policy and never hides draw selection differences.
3. CLI refuses unknown/malformed flags, incompatible modes, missing inputs and any requested filter selecting zero cases. Empty roster cases remain deliberate valid cases; an empty overall suite is failure. Verification compares the entire fixture and inventory, not a successful subset. No silent skip, regenerate-on-failure or source fallback to hand-authored expected values.
4. Bounded negative tests demonstrate detection of catalog/role/weapon/fallback drift, cross-zone acceptance, reordered zones/camps, merged shuffle rounds, off-by-one draw consumption, elite draw/wrap drift, duplicate/missing cases, corrupt provenance and zero-work invocation. Mutations are temporary isolated test inputs/implementations, never edits left in source. Report mutant count and failure evidence.
5. Existing sim/content checks remain green; coordinator content integration uses the actual visitor. Evidence explicitly excludes native RNG, faction sheets/signatures and all runtime behavior. Handoff includes changed-file inventory and commands/results.
6. Final handoff prints exactly one applicable line: `SUCCESS P-MOBS-CATALOG-1: pure catalog/roster source parity verified; runtime and native RNG pending` or `FAILURE P-MOBS-CATALOG-1: <specific missing check or mismatch>`. No success on partial inventory or unknown result.

## Validation commands
Existing: `cargo test -p rh-sim`, `cargo test -p rh-sim --test content`, `cargo test -p rh-sim --test no_alloc`. New test target, **to be created by this packet**: `cargo test -p rh-sim --test mob_catalog`. Helper command interface, **to be created by this packet**: `npx tsx tools/mob-fixtures/catalog-rosters.ts --capture` and `npx tsx tools/mob-fixtures/catalog-rosters.ts --check`; document their exact output/input locations and negative-test entry in evidence. Run capture/check canonically on Linux x64 Node 22.23.4. Coordinator runs `cargo test --workspace` and shared content integration gates. These commands are proposed acceptance work, not results already obtained.

## Risk and suggested model tier
Moderate, bounded pure port: Sol/medium implementation; independent Astra review of source coverage, provenance, draw accounting and scope. Do not widen scope to justify runtime claims. No new dependency.

## Known traps
Private world sfc32 is unrelated to map RNG. Frequency agreement is not ordered roster parity. Catalog IDs, names, tags and source fallback behavior matter as much as multipliers. Expected outputs must never become source inputs. Full faction scaling includes execute and Mark; leave it visibly pending. A module declaration or leaf test must not become permission to edit shared runtime/status files. This leaf does not make P-MOBS-1 complete.
