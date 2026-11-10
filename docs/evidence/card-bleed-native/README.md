# Card bleed native — implementation candidate evidence (P-CARD-BLEED-FEEDBACK-1)

Status: **implementation + scoped verification candidate; not native/public admitted; no source edit; the narrow authorized derived hash-tape/content-pin regeneration is done below.**
This directory is the sanitized evidence for the isolated DeepSeek worker tree
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`, branch
`codex/deepseek-card-bleed-feedback`, from clean HEAD `03ec330be74d695ee6034def69c1cb5df72e7b34` (integration
`31a5df0b` + documentation transfer) with the NPC restore repair `0be00f95` applied as an uncommitted scoped
worktree candidate (git metadata is read-only here; see "NPC candidate" below).

Toolchain: pinned Rust **1.97.0** (`rustc 1.97.0 (2d8144b78 2026-07-07)`, `cargo 1.97.0 (c980f4866 2026-06-30)`)
from `/Users/nevinmckinnon/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin`, every command run
`--offline --locked -j 1` with the worktree-local `target/` (`CARGO_TARGET_DIR=target`), cwd = the worktree root.

Frozen source is untouched: `parity/card-bleed-feedback/source.json` `rh-card-bleed-source/2`, 7 cases / 390
ordinary steps / 410,111 bytes, SHA-256
`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`; `controls.json` 3,191 bytes
`248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9` (the harness asserts the exact byte count,
case count and ordinary-step count on every run). No source, capture tool, expected source output, protocol,
Unity/client, Cargo.lock or shared status file was edited.

## Implemented contract

**Trusted World report.** `crates/rh-sim/src/systems/card_bleed_feedback.rs` adds
`CardBleedReport { since: Option<f64>, rows: [CardBleedBucket { victim, by, amount: CardBleedAmount }] }` as a
defaulted, serialized and hashed `World` leaf whose derived pair index and capacity are `#[serde(skip)]`
(never serialized/hashed; rebuilt by cold preparation). `CardBleedAmount` is the closed B3 domain
`Finite(nonnegative finite f64, bits preserved including -0) | PositiveInfinity | NotANumber`; the special tags
are payload-free and **no IEEE nonfinite float or null alias is ever stored**.
`CardBleedAmount::fold` reproduces the source `acc.amount += h.amount` exactly: one ordinary binary64 addition
per landed repeat in landed order, finite overflow to `PositiveInfinity`, NaN absorbing; no reordering, exact
sum, clamp or producer change. First eligible landed hit sets `since = world.server_time` and first-occurrence
row order is preserved (`PairIndex` arena AVL maps the full `(victim, Option<by>)` key to the stable row
ordinal; `None` is a separate key byte, never a `PlayerId` alias).

**Scheduled producers.** `cards/after_damage` calls `contribute` first (source `afterDamage`'s first pass:
only `dot && ability == None && sig == None`, no invented passive/weapon filter) and `periodic` after
`stillness` (flush iff an existing report aged `>= 500 ms` including empty rows, marker at the exact current
event index, rows cleared retaining capacity, `since = now`). `schedule.rs` replaces only the pending
`cardHooks.flushBleeds` RUN_ENDED position with the ported `run_ended` link. `cards/runtime.rs::reset_all` adds
the GateAlways `cardHooks.resetAll` Card reset (report to `None` + one `CardReset` marker) and teleport is not
touched. Every ordinary step has at most one Card segment, at most two `CardFlush` markers and one `CardReset`;
empty markers are preserved (asserted by `finish_fx_report` bounds and the source tests).

**Server-only raw diagnostic.** New `Event::CardBleedHit { victim, by: Option<PlayerId>, amount: CardBleedAmount }`
is emitted once per trusted row in insertion order at a flush. It is `ServerOnly` in the exhaustive
visibility/class declarations, omitted by `observe::to_seen`, and therefore absent from every stateless/raw/public
observation path; the only extra raw-Event arms are the two Root-leased ones
(`rh-parity/src/canon.rs::canon` bounded-scenario omission with the dedicated-Card-witness comment;
`rh-headless/src/digest.rs::OutcomeDigest::event` folds discriminator/victim/source/B3 tag+finite bits, never a
float decode, never a policy/client observation).

**Separate settled public projection.** `cards::after_damage` also fills a per-tick exact raw-pair sidecar
(`CardSegment`: `ExactSum` limbs per actual raw pair + local `invalid`/`overflow` classifications), sealed into
`FxTickReport::card_rows` with `Op::CardSegment/CardFlush/CardReset`. `fx_projector/card.rs` resolves settled
entitlement (`sees(viewer, victim) || by == viewer` on the completed tick's frozen sight), redacts the source
**before** grouping, merges exact integer limbs (`ExactSum::merge`, checked carries, no intermediate f64
rounding), then at the Card marker rounds once, checks the **actual existing `amount as f32` conversion** for
finiteness, and stages `SeenEvent::Hit { victim, by: redacted, amount: original-f64, passive: false }` in stable
public-key order. Eligible nonfinite source amount → `InvalidAmount`; eligible checked exact
accumulation/merge/rounding/`f32` overflow → `Overflow`; both use the existing fail-closed policy (clear staged
output, disable that viewer) with no partial prefix, no clamp, no omitted bucket and no raw-total fallback.
Unentitled hidden invalid/overflowing pairs are skipped before their classification is inspected. Card buckets
are a separate `Vec`/index: legacy `Reset`/`Flush`/sort operations cannot stale them, and `CardReset` clears only
Card state. Signature/ability EXACTSUM path is unchanged.

## Strict canonical intake (both stored paths)

`CardBleedAmount` deserializes through a strict self-describing-codec visitor: canonical `{ "Finite": <nonnegative
finite number> }`, `"PositiveInfinity"` or `"NotANumber"` only. Negative/nonfinite/null `Finite` payloads, unknown
or lower/mixed-case tags, a payload on a special tag, the externally-tagged map aliases `{"PositiveInfinity":
null}` / `{"NotANumber": null}`, unknown fields and duplicate/extra discriminants are refused. Root-requested
review suspicion **confirmed and repaired** (RED then GREEN below): the previous `deserialize_enum` +
`unit_variant` path accepted the map-null special aliases. `check_world` now also audits both paths: retained
actor provenance for victim/source, unique complete raw pairs, `since` finite and prior to `server_time` (a
fractional accepted lifecycle-off baseline clock is valid; see fractional-clock receipt), rows nonempty ⇒ clock
present, and serialized `World.pending_events` card rows' provenance. The derived index is excluded from the
hash and rebuilt on restore.

## Actual verification receipts (as executed)

Git metadata writes were refused by the workspace sandbox (`index.lock: Operation not permitted`); no permission
expansion was attempted. All commands below ran as-is; logs are kept outside Git and summarized here.

| # | Command (cwd = worktree root; all with `--offline --locked -j 1`, `CARGO_TARGET_DIR=target`) | Exit | Result |
|---|---|---|---|
| 1 | `cargo test -p rh-sim --lib frozen_full_source_all_63_cases -- --nocapture` | 0 | **1 passed, 0 failed**: all 63 admitted ability SOURCE comparisons pass on this tree (unchanged source consumer; no source expectation edited). Post-capacity producer semantics: 16.24 s before the derived recording (`receipts/ability-63-source-prefinal.log`). The retained `ability-63-source-final.log` is a HISTORICAL 15.85 s pre-capacity receipt, not evidence of a standalone post-record run. |
| 2 | `cargo test -p rh-sim --lib card_bleed_feedback` | 0 | 25 passed, 0 failed, 1 ignored (allocation profiler run below). |
| 3 | `cargo test -p rh-sim --lib fx_projector::` | 0 | 28 passed (Card and legacy projection domains). |
| 4 | `RH_CARD_ALLOC_DIRECTORY=/tmp/cardlogs cargo test -p rh-sim --lib card_bleed_alloc -- --ignored --test-threads=1 --nocapture` | 0 | measured allocation witness, numbers below. |
| 5 | `cargo clippy -p rh-sim --offline --locked -j 1 --all-targets -- -D warnings` | 0 | strict default-feature lint clean (no output). |
| 6 | `cargo clippy -p rh-sim --offline --locked -j 1 --all-targets --all-features -- -D warnings` | 0 | strict all-feature lint clean. |
| 7 | `rustfmt --edition 2021 --check` on every changed/new `.rs` in the worktree | 0 | formatting clean. |
| 8 | `cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored --test-threads=1` | 0 | authorized derived recorder; new tape SHA-256 `17fc8309…57393`. Receipt: `receipts/ability-hash-tape-record.log`, before/after `receipts/tape-*.sha`. |
| 9 | `cargo test -p rh-sim --lib ability_hash_tape_matches_the_base` | 0 | 1 passed; checker green against the re-recorded derived tape. |
| 10 | `cargo test -p rh-sim --test content` | 0 | 21 passed (including the updated derived `GOLDEN_CONTENT_HASH` and the Card-specific const/serde-skip registrations). |
| 11 | `cargo test -p rh-sim --offline --locked -j 1 --no-fail-fast` (production binding) | **0** | full `rh-sim` suite green, `FAILED` lines 0: library **881 passed, 0 failed, 15 ignored (765.79 s)**; slowest integration target `tests/hash_coverage.rs` **10 passed, 0 failed (775.14 s)**; every integration target ok. Receipt `receipts/full-suite-final-summary.txt`. |
| 12 | focused test-only delta after that binding (actual-capacity ledger + strengthened pending/public-output witnesses) | 0 | card module **29 passed, 0 failed, 2 ignored** (both ignored tests are the isolated allocation profilers; CI will execute them serially, receipt `card-focused-delta.log`); projector domain **28 passed, 0 failed**; the six named pending/report/capacity/public-output/measured/cold witnesses green; actual capacity ledger receipt `capacity-ledger.txt`. |
| 13 | `RH_CARD_ALLOC_DIRECTORY=/tmp/cardlogs cargo test -p rh-sim --lib card_bleed_alloc_public_output -- --ignored --test-threads=1 --nocapture` | 0 | allocator delta around one actual 2,104-row public Card flush (legacy output constant 1,504, prepared output capacity 9,442): **feed_alloc_blocks=0**; receipt `receipts/card-public-output-alloc.log`. |
| 14 | `cargo clippy -p rh-sim --all-targets -- -D warnings` and `--all-features -- -D warnings` on the final code | 0 | both strict lints clean, binding the final test/evidence code; receipts `clippy-rh-sim-*-final.log`; `rustfmt --check` clean. |

The seven immutable source histories are replayed through the real constructors, declared setup/inputs and
ordinary 50 ms steps by `systems/card_bleed_feedback/source_tests.rs`
(`the_seven_immutable_source_histories_reproduce_trusted_rows_and_cadence`): exact processed-vs-retained `/2`
contributions, trusted raw row order/f64 bits/tags, cadence, natural run-end, raid-start reset, teleport
retention, Fire burn/backlash exclusion and the no-card control all pass. The public comparator is
output-independent: it derives the complete expected per-seat stream from the frozen source contribution rows
plus the completed tick's frozen sight masks, and compares **every** actual row emitted through the real
`FxProjector::feed` path (a transparent `cfg(test)` observer records exactly the Card marker's rows). A mutation
control appends a wrong-valued extra Card row while retaining all expected rows and must fail
(`a_wrong_valued_extra_card_row_is_rejected_by_the_actual_public_comparator`); a missing row is caught too. No
actual row is classified or filtered by expected answers. Dedicated synthetic projector privacy tests remain
separate from the source histories.

Observed separation of trusted and public arithmetic (evidence that the two paths are intentionally distinct):
the first-use case's first source-ordered fold is `2.4596098761487166`, while the correctly rounded exact
public window total is `2.4596098761487157`; both are asserted independently.

Strict-intake RED→GREEN receipts (distinct logs, first failure preserved):

* **B3 map-null alias (Root review suspicion, CONFIRMED then repaired):** RED
  `/tmp/cardlogs/card-strict-b3-alias-RED.log` — `report: accepted map-null positive infinity alias
  "amount":{"PositiveInfinity":null}`; the same alias and raw duplicate-key forms now refuse through both the
  World report and serialized pending-event decode paths (GREEN
  `/tmp/cardlogs/card-strict-b3-alias-GREEN.log`).
* **Unproven fixed-grid report clock (Root correction 1, removed):** RED
  `/tmp/cardlogs/card-fractional-clock-RED.log` — a real producer-earned fractional `since` (accepted
  lifecycle-off baseline `1284.5`) was wrongly refused with the grid constraint, and the combined NPC fractional
  clock regression failed with it. GREEN `/tmp/cardlogs/card-fractional-clock-GREEN.log`: both the Card
  producer/restore continuation and `mob_checkpoint` fractional-clock regression pass; only finiteness, prior
  time and state invariants remain.
* **Cold index preallocation (Root correction 2):** RED `/tmp/cardlogs/card-alloc-RED.log` — with the derived
  index reserved only to the current row count, the first unseen raw pair allocated 1 block. GREEN
  `/tmp/cardlogs/card-alloc-GREEN.log`: rows **and** index reserve the full derived `Q`; the first and a later
  unseen pair, repeated live steps and growth to the prepared bounds allocate **0** blocks.

## Measured layout and capacities (actual numbers, not planning allowances)

From `measured_card_type_sizes_and_index_height_are_reported` (printed values):

| Type | Measured bytes |
|---|---:|
| `CardBleedAmount` | 16 |
| `CardBleedBucket` | 32 |
| `CardBleedReport` | 72 |
| `CardExactRow` | 288 |
| `CardSegment` | 56 |
| `PairIndex` | 32 |
| `PairIndex` arena node | **28** (planning estimate 24) |
| `fx_report::Op` | 48 |
| `Event` | 104 |
| `SeenEvent` | 80 |
| `FxTickReport` | 192 |
| `ExactSum` | 272 |
| `PlayerId` | 4 |

Prepared capacity evaluation from the real constructors:

* Proven **pristine player-only specialization** (mobs/faction/quests/training/dummies all off, no camp spots,
  no restored actors beyond the eight seats): `V = P = 8`, `K = 64`, `Q = 64`, `B = 72` at `U0 = Q0 = 0` — exactly
  the design's provisional pristine table row; this is the only pristine specialization implemented.
* A real regional-PvE Full8 constructor (`R = 204` camp spots, all 204 regional mobs spawned by the raid-start
  step so `A0 = 212`): the **general accepted-restore bound** is used, `V = A0 + 14P + 2R + 150 = 882`,
  `K = Q = 7,056`, `B = 7,938`. The design planning formula evaluates to `N_new = 46,991,264 B ≈ 44 MiB`
  (656K 4,628,736 + 546Q 3,852,576 + 4608B 36,578,304 + I(K) 187,520 + I(Q) 187,520 + 8·I(B) 1,556,608).
* **NON-OVERLAPPING ACTUAL prepared-capacity ledger for that generic Full8 state** (`receipts/capacity-ledger.txt`;
  every line uses the container's actual `.capacity()`; per-viewer containers are summed over **eight actually
  attached** viewer sessions — the live seat bound). Actual capacities: trusted report rows `7,056·32 =
  225,792`; trusted derived index `7,056·28 = 197,568`; producer exact segment rows `7,056·288 = 2,032,128`;
  producer exact segment index `7,056·28 = 197,568`; sealed report Card rows `7,056·288 = 2,032,128`; sealed report
  events `7,568·104 = 787,072` (full prepared capacity; the unchanged legacy 512-row baseline is listed
  separately); sealed report `wish_points` `7,568·2 = 15,136`; eight viewers' Card bucket vectors (summed actual
  capacity `63,504`) `·288 = 18,289,152`; eight viewers' Card derived indexes (summed actual capacity `63,504`)
  `·28 = 1,778,112`; eight viewers' owned outputs (summed actual capacity `75,536`) `·80 = 6,042,880`.
  **Card-owned actual prepared capacity total 31,597,536 B ≈ 30.13 MiB.** Reported separately and **not** added:
  the conservative planning allowance `N_new = 46,991,264 B` (it already prices the K/Q/B containers with its own
  planning allowances); the unchanged legacy baseline inside the enlarged buffers `1,016,832 B`; the test-only
  transparent Card observer buffers `6,042,880 B`; and allocator overhead, inherited status/Arc/producer
  allocations and unrelated world memory. This is prepared **capacity accounting**, not a measured live-heap
  total and not the design's 21.5675 MiB pristine estimate.
* The design's Full8 `V = 2P + 2R` and training8 `V = 3P + 150` pristine specializations are **not** implemented
  (their proven prerequisites were not established); Root decision requested — see "Open items".

Measured allocation witness (`card_bleed_alloc`, run alone under the test profiler; inherited `bleed:{tick}`
status-tag Arc allocations are excluded by releasing the held trigger after the first hit — they are a property of
the unchanged producer, so no whole-combat zero-allocation claim is made):

| Operation | Blocks |
|---|---:|
| cold construct (`Sim::try_new` + joins + raid step) | 98 |
| cold clone | 66 |
| cold restore | 1,022 |
| rebind | 6 |
| **first unseen raw pair after preparation** | **0** |
| **second unseen raw pair after preparation** | **0** |
| repeated live Card steps (20 measured) | 0 |
| growth to the prepared `Q`/`K` bounds | 0 |
| one raw pair past the prepared bound (trusted stays lossless; documented safety valve) | 2 |

The profiler run itself reports `Total: 3,508,605 bytes in 1,435 blocks` (whole witness including cold
construct/clone/restore and harness setup), `At t-gmax: 2,728,788 bytes in 377 blocks`.

A second isolated profiler witness (`card_bleed_alloc_public_output`, run alone; receipt
`receipts/card-public-output-alloc.log`) measures the actual allocator delta around **one real projector flush of
2,104 prepared public Card rows** — above the legacy `FX_OUTPUT_EVENTS_MAX = 1504` output constant — through the
actual regional-Full8 prepared projector (`prepared owned output capacity 9,442 SeenEvent`s). All setup
(constructor, viewer preparation, synthetic sealed report) happens outside the measured region; the measured
region reports **0 blocks**. This is a scoped owned-buffer growth witness, not a whole-combat/whole-simulation
zero-allocation claim.

## Private Card history envelope and representability repair (Root+Sol pre-seal HOLD)

The first candidate counted **all** sealed events (private server-only `CardBleedHit` history rows included) against
the legacy 512-event cap and sized the sealed report event/wish buffers at the legacy capacity. A valid accepted
restored report with more than 512 retained historical raw rows and a due interval would therefore be sealed
`bounded = false`, and a freshly attached viewer (which has no historical entitlement) would be refused with
`UnsupportedBounds` before any entitlement was considered.

Reproduced with an honest accepted baseline (`a_restored_historical_card_report_over_the_legacy_event_cap_flushes_
without_refusing_a_fresh_viewer`): a real regional-PvE Full8 constructor on the certified seed-1 map (204 camp
spots, 204 spawned mobs) records 600 unique trusted historical raw pairs with a due `since`, serializes and restores
through the real strict checkpoint audit and cold preparation, then takes one ordinary step with **no** new Card
contribution. The due periodic flush emits all 600 trusted rows. RED
(`receipts/card-history-envelope-RED.log`): the fresh viewer's real feed returned `Err(UnsupportedBounds)`; GREEN
(`receipts/card-history-envelope-GREEN.log`): the step is bounded, the fresh viewer feeds `Advanced` and emits
**zero** Card public rows (no historical entitlement), and the trusted flush remains complete.

Minimum repair, as directed:

* `FX_REPORT_EVENTS_MAX` stays the legacy **non-Card** bound (512). `sealed_events_bounded` counts actual emitted
  events independently: legacy non-Card events against 512, private Card raw rows against the cold-prepared
  `Q + T0` envelope. The bound is by actual rows, never by marker count, so an empty Card marker consumes nothing;
  the at-most-one-populated-segment/two-empty-CardFlush/one-CardReset envelope is unchanged and separate.
* `T0` is the actual number of serialized `World.pending_events` Card raw rows at construction/clone/restore
  (valid intake; `step_into` appends them before the step's work, so `Q0`/initial status/deferred pairs do not
  include them). `card_history_envelope` is checked `Q + T0`.
* Cold preparation reserves the sealed report `events` and `wish_points` for `legacy 512 + Q + T0` and stores the
  checked Card row limit on the report; the producer/sealed exact sidecar and trusted report/index reservations are
  unchanged. Marker indices and event/source order are untouched.
* Each `FxProjector::attach`/`rebind` reserves its owned `events` buffer (and the `cfg(test)` transparent Card
  observer) for `legacy FX_OUTPUT_EVENTS_MAX + B` with checked arithmetic and fallible reserve; a refused capacity
  fails that session closed with `UnsupportedBounds` instead of growing warm or truncating.
* The caller-owned `out: Vec<Event>` remains caller-scoped: a caller with a small vector may grow it when raw
  events are emitted; `Sim` does not prepare external buffers.
* The exact generic-Full8 accounting below is a non-overlapping actual-capacity ledger, kept separate from the
  conservative planning allowance; no 21.5675 MiB pristine figure is claimed for live general reserve.

Witnesses: the >512 restored-report flush above; the strengthened serialized pending-Card-history witness
(`serialized_pending_card_history_extends_the_prepared_boundary`: **600** serialized pending Card raw rows, which
exceed both the legacy 512 non-Card bound and the prepared trusted pending bound `Q = 64` of that pristine
two-player world; actual `Clone` and accepted `Sim::restore` prepare `Q + T0`; the ordinary step appends all 600
rows, stays bounded, and a fresh `FxProjector` feed returns `Advanced` with **zero** Card output); legacy bound
unit controls (512 non-Card accepted, 513 rejected even with a huge Card limit; 600 Card rows accepted only with
limit ≥600; mixed/zero/empty-marker cases); prepared-capacity assertions (`report.events`/`wish_points` ≥
`512 + Q + T0`, `card_event_limit = Q + T0`, projector owned output ≥ legacy + `B`); and one isolated synthetic
component capacity witness (`prepared_public_output_beyond_the_legacy_output_constant_uses_the_actual_projector`,
explicitly labelled synthetic — crafted sealed rows, real prepared projector processing) that feeds 2,104 entitled
buckets through a freshly attached regional-Full8 projector whose prepared owned output is `1504 + B = 9442`
`SeenEvent`s: it emits 2,104 public Card rows (> the old 1,504 output constant) and the owned event capacity and
prepared Card bucket/index capacities do not grow. Counts are owned capacities, not whole-combat allocations.

**Representability before allocation.** The derived indexes store `u32` row/link ordinals with
`NO_NODE = u32::MAX` reserved. `capacity_from` validates the checked `K`, `Q` and `B` against that ordinal domain
(largest valid **count** `u32::MAX`; `u32::MAX + 1` unrepresentable) *before* any allocation, and
`CardBleedReport::prepare`, `CardSegment::prepare` and `PairIndex::reserve` refuse an unrepresentable capacity
before touching memory. The control
`capacity_representation_refuses_unrepresentable_or_overflowing_bounds_without_allocating` passes oversized
arguments (`u32::MAX` initial pairs, `usize::MAX` factors) and asserts empty row/index capacities afterwards — a
representation refusal, not a gameplay cap; no enormous allocation is attempted.

## Lifecycle, schedule and hash/restore evidence

`the_real_gate_always_raid_start_records_one_card_reset_marker` drives the actual lobby→active step and observes
exactly one `CardReset`, zero `CardFlush`/`CardSegment`, the trusted report cleared and a bounded settled
projector feed with no output. The run-ended source case witnesses the early `runEnded` flush before the
periodic boundary and proves an already-ended step retains scratch but adds no marker/contribution. The
raid-start source action proves pre-reset contributions are discarded rather than flushed. The teleport source
case proves the partial report survives with no Card marker at the teleport. The no-card control creates no
Card state/marker. Cross-domain isolation is asserted both in the real schedule step and in the sealed-report
projector tests (legacy `Reset`/`Flush` never clear Card; `CardReset` clears only Card).
`cold_clone_restore_and_attach_prepare_the_actual_capacity_set` proves cold constructor/clone/restore/attach
preparation reserves rows **and** index at the full `Q`, the segment and sealed sidecar at `K`, a fresh viewer
session at `B`, the restored report/index equals the preserved state, and observation cadence does not change
the World hash. The strict-intake tests exercise both real decode routes (`Sim::restore` and plain
`Deserialize`) with exact-bit signed-zero/max-finite round-trips and the hash coverage of the new leaf.

## Identity changes (Root-authorized version-only hunks only)

`CHECKPOINT_FORMAT` 29→30, `REPLAY_FORMAT` 23→24, `OBSERVATION_VERSION` 21→22, `POLICY_CONTRACT_VERSION` 15→16
and the new `card-bleed-feedback/1` content visitor marker. The accompanying edits are identity-only:
`crates/rh-sim/tests/checkpoint.rs` and `tests/replay.rs` format assertions, trophy observer OBS assertion,
sentenced `npc_tests.rs` checkpoint format string, `fighter.rs` doc identity. Wire stays **protocol 14**; no
protocol/codec/fixture/client/Unity change.

## Derived native identity regeneration (authorized `827422b5`, completed)

After the unchanged 63-case ability SOURCE gate passed on the final producer semantics twice (receipts
`/tmp/cardlogs/ability-63-source-prefinal.log`, copied to `receipts/ability-63-source-prefinal.log`: command
`cargo test -p rh-sim --lib frozen_full_source_all_63_cases -- --nocapture`, exit 0, 1 passed/0 failed, 16.24 s,
"P-ABIL-1 FULL: 0 named prerequisite cases remain"), Root authorized exactly the existing derived recorder and the
`GOLDEN_CONTENT_HASH` update. Executed:

* `cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored --test-threads=1` → exit 0; the existing
  recorder wrote `parity/abilities/hash-tape.json` (before SHA-256
  `9df7ffb87d81062d513257f17efe6e003fab047fc62d0177e7f8396e1ca3d4c4`, after
  `17fc8309e839fdc411686ec455fc5178ccb1e2a88b303896fe77eaa054457393`): `rh-ability-hash-tape/2`,
  checkpoint `rh-checkpoint/30`, contentHash `fa16f195dc22ef69`, observationVersion 22, 63 recorded cases. No
  hand-edited fold answer; no recorder/checker/source fixture/tool/case edit.
* `crates/rh-sim/tests/content.rs` `GOLDEN_CONTENT_HASH` updated only from `0x8edd_862f_48ff_a100` to the actual
  derived `0xfa16_f195_dc22_ef69`.
* Checker `cargo test -p rh-sim --lib ability_hash_tape_matches_the_base` → exit 0 (1 passed); content suite
  `cargo test -p rh-sim --test content` → 21 passed, 0 failed. The final full-suite receipt also includes the
  unchanged 63-case SOURCE gate passing. No retained receipt verifies the previously stated standalone post-record
  15.60 s timing, so that claim is withdrawn; the retained `ability-63-source-final.log` is the historical 15.85 s
  pre-capacity run, while the genuine post-capacity standalone gate is `ability-63-source-prefinal.log` (16.24 s).
  The pre-record checker failure (`left: String("rh-checkpoint/29")`, `right: "rh-checkpoint/30"`) was
  the genuine expected layout mismatch and is preserved in the full-suite receipt of the pre-record tree.

Two further existing-test identity updates were required by the new Card module and are Card-specific (permitted
by the original packet lease): the `NON_GAMEPLAY` inventory entries for the new representation/test constants
(`NO_NODE`, `MAX_HEIGHT`, `MAX_INDEXED_ROWS`, the three cfg(test) SOURCE_* pins) and the documented
`#[serde(skip)]` list entry for `systems/card_bleed_feedback.rs` (the derived Card pair index). No derived
gameplay answer was hand-written.

## Open items for Root (NOT self-authorized)

1. **Derived native hash tape/pins — completed under the narrow `827422b5` authorization** (section above):
   recorder executed on final code after the 63-case gate, `parity/abilities/hash-tape.json` and only
   `GOLDEN_CONTENT_HASH` updated, checker and content suite green. No source golden/expected gameplay or case was
   edited, dropped or weakened; the pre-record genuine mismatch receipt is preserved.
2. **General accepted-state capacity approved; pristine Full8/training8 specializations explicitly not
   implemented.** Root's final bounded decision approves the general accepted-state capacity for this packet and
   directs that the optional smaller Full8 (`V = 2P + 2R`) / training8 (`V = 3P + 150`) pristine rows are not
   implemented now, and that the 21.5675 MiB pristine figure is not claimed. The actual-capacity ledger and
   conservative planning allowance are reported separately above.
3. **NPC candidate is uncommitted/unsealed** because this worktree's git metadata is read-only: the exact
   `0be00f95` diff (two `mob_checkpoint` Rust files + sanitized evidence) is applied as worktree files only. Its
   six focused tests pass in the combined tree, including the fractional-clock test that required correction 1.
4. No merge/push/deploy/live-client claim and no native/public admission; Root owns integration, identity
   composition and the joint decoder/publish/headless gate.

Sanitized raw receipts (distinct logs, kept outside the private checkpoint/transcript area) live in
`docs/evidence/card-bleed-native/receipts/`: the 63-case SOURCE gate raw logs (`ability-63-source-prefinal.log`), the
authorized recorder + before/after tape digests, the derived checker/content runs, the private Card
history-envelope RED/GREEN pair, the card-owned actual-capacity ledger, the full-suite result summary, the
pre-record genuine failure summary (`pre-record-derived-failures.txt`), the focused post-binding delta
(`card-focused-delta.log`) and final strict lint receipts, the RED/GREEN pairs for the B3 map-null
alias, the fractional accepted clock and the index preallocation/first-pair allocation, and the pinned
clippy receipts. The pre-record full-suite raw log itself was a private `/tmp` path
(`/tmp/cardlogs/rhsim-full-3.log`); its exact genuine failure snippets are preserved in the receipt text.

## Scope limits

Source parity evidence is bounded to the frozen seven cases and the listed controls; no claim is made for all
ability variants, anonymous source pairs in source (source has no viewer audiences), arbitrary IDs, voided-active
source reach, separately invoked empty run-end, full client animation parity, speedup or whole-combat
zero-allocation. Native settled-tick entitlement/redaction is a deliberate ADR0013 privacy extension, not source
parity. The public projection reuses the existing `Hit` wire field only.
