# P-TEMPORAL-PROTECTION-CUES-CONSUMER — actual 2112-Frame adapter handoff

Base literal **`299c878af8d0b339b407a94cd435a8d984c2d992`**, branch **`deepseek/temporal-protection-cues-consumer`**;
old head `565eaa259f42bf1e9f0c22b6bbc9abbc3976c45c` and all prior evidence preserved. Packet
`P-TEMPORAL-PROTECTION-CUES-CONSUMER` SHA-256 `aadf88bb911ee9854bdb5eb9f7bc6a83fbb06e87d4018624efbd18c6c06383a0`; lease SHA-256
`a136b5fca370027fb2624b9ef224248b18e9a347f9d687ab7861b733d7c3e8f8`. This is a test-only mechanical adapter/consumer:
no production/public/wire/algorithm/source/schema/content/hash/lock/shared-status/Cargo file change.

## Source fixture boundary

Canonical tracked fixture `parity/policy/bot-protection-cues/source.json`: **45,079,140 bytes**, SHA-256
`0a8af4c8dee518e5e6bc6b31c3445dc2e5ab61e889810a830642381d9cf92e6e`, format
`rh-p15-protection-cues-source/2`, codec `rh-tagged-value/1`, sourceBase
`bb564d3b53728cbd205af375b5342eca466f3656`, driverCode `4fe7aa8285ad65f2c9a1123297426cd48b03bdef`, profile map
`/repo/tools/ability-fixtures/born-input.json` 7,510 B SHA `5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16`.
Loaded with `std::fs::File` + the existing `serde_json` `float_roundtrip` feature; not embedded, no flate2/Node/source run.

## Adapter coverage (all actual frames)

- 11 captured cases, each 192 temporal entries in original interleaved viewer order; one independent fresh `Ring` per
  viewer per case; `Frame::read -> Ring::push -> Ring::compose` exactly once per entry.
- Complete captured 11-key Frame shape retained; `Frame::read` consumes the full self/hud/fighters/mobs/containers/
  projectiles/minimap/events/immediate/extras records. The only special tag present in the temporal/expected selection is
  the explicit own-property `$rh:"undefined"` leaf (88 input container weapons, 82 expected composed leaves), decoded to
  the private `MethodValue::Undefined` and never to Null/absence/ordinary object.
- Composition context is read per case and passed in, never from `composed.features`: all ten Features fields including the
  ordered 19 messageTypes, selfDelayMs=0, worldDelayMs=125, attentionCentral=0.65. All five map `Uint8Array` tags
  (tiles/terrain/regionGrid/territoryGrid/featureGrid) are strict-decoded to exactly 576 integer 0..255 values (55 tags
  total). Open `TileMap` is built from the actual tiles; the pre-construction tile vector is cloned and the actual
  coliseum gate coordinates (11,9),(14,11),(11,14),(9,11) are set to `TILE_WALL` for a new locked `TileMap`, in existing
  order, bounds-checked; no closed_gates()/MapLayers/synthetic floor map or constructed-tile mutation. The real supplied
  `hud.gatesLocked` open/closed transition is asserted in every case.
- Compare ONLY `temporal.composed` after native output: complete object keysets/payloads, arrays/order exact,
  explicit Undefined retained, no missing/unexpected fields; source current-record/order is preserved (no sorting of
  entity/event arrays). C-PARITY numeric policy: absolute 2e-6 only for coordinate/velocity/dist/tint leaves; clocks and
  discrete/pass-through values exact; **actual max raw numeric error = 0.00000000000000000e0**.
- No filtered/Memory/private diagnostics/schema runtime used to repair inputs or infer course; no expected output supplies
  an input/config field; no RNG exists in this component.

## Actual reached totals (asserted by the consumer)

Frames **2112**; nonnull prefilter Percepts **2046**; null compositions **66** (6 per case); input rows: fighters **1824**,
projectiles **12**, containers **88**, events **98**; input Undefined weapon leaves **88**; composed rows: fighters
**1711**, projectiles **42** (Arrow **12**, Ball **30**), containers **82**, events **98**, Undefined leaves **82**. The 42
delayed projectile outputs all occur with empty contemporaneous Frame projectiles (retained delayed-course evidence, not
dynamic FX9 coverage). Mobs and immediate inputs/outputs are zero; no positive general moving-player velocity is claimed.

## Strict negative controls

The private adapter refuses unknown/misplaced `$rh` tags, extra tag fields, typed-array tags in the temporal/expected
selections, typed arrays of the wrong type/length, out-of-range typed values, and map tags with extra fields; explicit
Undefined is asserted distinct from Null and from an omitted member.

## Actual gates

- Focused `cargo test -p rh-policy --lib protection_cues --locked --offline -- --nocapture`: **3 passed, 0 failed, exit 0**
  (actual consumer + two strict-control tests). Consumer prints the frame/nonnull/null/max-error summary.
- `cargo test -p rh-policy --lib temporal_percept --locked --offline -- --nocapture`: **17 passed, 0 failed, exit 0**
  (existing 14 temporal tests unchanged plus the new 3).
- `cargo fmt -p rh-policy -- --check`: exit 0; `cargo clippy -p rh-policy --lib --tests --all-features --locked --offline
  -- -D warnings`: exit 0.

## Limits / environment

Declared source-method data only; this is not BotVision/Memory/FIFO/live/full-Brain, public intake, socket publication,
accepted P15 privacy/course disclosure or native activation; IDs retain fixture-local method equality only; no RNG.
Leased target `ARCHIVE/bot-fight-native/target` used exclusively with jobs1/debug0/incremental0, `--locked --offline`;
no live owner/lock; final-target untouched; no new worktree/cache/dependency; disk 7+ GiB free (above 1.5 GiB floor), no
cleanup. Old 1549->1541/8 and all existing temporal expectations remain untouched. Root owns merges.

## Manifest

`manifest.txt` pins SHA-256 and byte length for every payload; all payloads are verified against the sealed commit's Git
blobs, with dedicated force-added raw receipt logs.
