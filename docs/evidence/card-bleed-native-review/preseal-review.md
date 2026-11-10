# Card native pre-seal review

Read-only code review of the moving WIP in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`.
This is not final admission, a source rerun, or a test result. Worker HEAD at review start: `03ec330be74d695ee6034def69c1cb5df72e7b34`.
I did not run tests/builds, edit worker files, or contact the author. The prior Root findings are in this integration
tree's [WIP findings](../card-bleed-native-review/wip-findings.md).

## Defensive classifier consistency HOLD: later invalid pair member after exact overflow

At `crates/rh-sim/src/systems/card_bleed_feedback.rs:425-433`, `CardSegment::note` returns immediately when either
local flag is already set. If finite entries first make `ExactSum::add` return `SumError::Overflow`, a later NaN,
infinity, or negative input for that same raw pair is skipped and `invalid` stays false. `crates/rh-sim/src/fx_projector/card.rs:120-128`
copies both flags when present, and `:142-147` deliberately gives `InvalidAmount` precedence over `Overflow`.

The packet's per-pair classification contract says an eligible nonfinite source amount fails with `InvalidAmount`,
while checked exact accumulation/merge/rounding failure is `Overflow`. The current updater only preserves whichever
classification was first. Same-pair invalid source classification should survive a prior limb/carry failure, matching
the existing bucket's `InvalidAmount` precedence; this is a defensive classifier consistency defect. It is not an
executed or proved reachable producer bug: the 34-limb sum has 78 carry bits, and ordinary `usize`-addressable
per-tick finite contributions do not establish that this carry-failure state can occur. A synthetic carry-failure
control should prove the local classification rule without a huge iteration probe. No global cross-bucket error
precedence is implied. This is not a privacy leak or a proposal to expose hidden bad pairs.

Root accepted that narrow same-pair rule and delivered the repair/control request to the active DeepSeek worker at
approximately09:52UTC. Arithmetic may remain skipped after carry failure, but later source-invalid classification must
remain observable to that pair's existing viewer error rule. No new source capture or large iteration probe is requested.

## WIP checks against the earlier findings

These are code-presence observations only; no tests or captures were run here.

- **Fractional accepted clock:** the old fixed-grid check is gone. `CardBleedReport::validate` now checks finite,
  nonnegative, not-future `since` and row/actor invariants (`systems/card_bleed_feedback.rs:317-359`). New
  `an_accepted_fractional_clock_records_a_real_card_report_and_restores_continuation` constructs an accepted
  fractional baseline, lands a real deferred eligible Dot through `step`, checks the actual producer clock, restores
  and reaches the ordinary 500 ms flush (`systems/card_bleed_feedback/tests.rs:932-1029`). It also distinguishes
  attach-after-existing-report from attach-before-new-report entitlement. This is the right kind of actual producer
  continuation for the prior review finding; execution receipt still needs review.
- **Cold index reservation:** trusted rows and the AVL index both reserve full `Q` in report preparation
  (`systems/card_bleed_feedback.rs:250-270`, `index.rs:64-69`). Segment and sealed exact rows reserve `K`
  (`systems/card_bleed_feedback.rs:400-407,575-589`); clone and restore call that preparation
  (`sim.rs:46-64`, `checkpoint.rs:237-250`). Existing tests assert those capacities and first unseen pair allocations
  (`tests.rs:742-775,1240-1298`), but those are unexecuted in this review.
- **Capacity profile:** only the explicitly pristine player-only case gets `V=P`; other accepted states use the larger
  checked `A0+14P+2R+150` bound (`systems/card_bleed_feedback.rs:509-552`). The code no longer assumes the smaller
  pristine Full8/training figures for every constructor. A test prints measured type sizes and one player-only plus
  one general PvE capacity profile (`tests.rs:800-924`), but no output/evidence receipt was present in this WIP review
  tree, so I do not attest those measurements or a memory footprint. The deliberate beyond-prepared-bound test still
  grows trusted storage losslessly; it is not evidence that every accepted future path fits the preallocated envelope.
- **Expected-output filtering:** source expected rows now derive from frozen source contributions and settled sight
  masks; actual rows come from a test-only transparent Card output observer. `compare_public_stream` checks exact
  per-viewer length, every row's identity/order/value and rejects non-seat viewers (`source_tests.rs:445-608`). It
  explicitly panics on a non-Hit Card-path emission and includes an extra wrong-valued row control retaining all
  expected rows (`source_tests.rs:619-664`). This removes the reviewed expectation-membership filter. Again, no
  control execution receipt was present here.
- **Canonical B3 aliases:** deserialization accepts special tags only as unit strings and `Finite` only as a single
  finite nonnegative one-key map (`systems/card_bleed_feedback.rs:135-205`). Raw checkpoint-string controls exercise
  special-tag map-null aliases and duplicate keys in both the report and pending-event paths
  (`tests.rs:1415-1463`). The source-only raw Card event remains server-only, omitted by `to_seen`, and the Card
  projector consumes only its separate settled report sidecar (`events.rs:128-132,285-296`, `observe.rs:420-430`,
  `fx_projector/mod.rs:332-358`). The source comparator observes all rows emitted specifically by that Card path and
  fails on unexpected variants; no raw Card amount is used as a public expectation input.

## Ownership, staging and lifecycle observations

The current projection resolves settled `sees(viewer,victim) || by==viewer` before reading a row's invalid/overflow
flags, redacts `by` before indexing/grouping, and merges different hidden source pairs only under the anonymous
`(victim,None)` key (`fx_projector/card.rs:77-130`). `flush_into` may have staged earlier events before finding a later
bad bucket, but `FxProjector::feed` routes every Card error through `fail`, which clears the whole viewer's staged
events, Card/legacy buckets and test observer and disables that projector until rebind (`fx_projector/mod.rs:131-150`).
This is viewer-local fail-closed behavior; it does not clear trusted World rows. Tests cover hidden unentitled invalid/
overflow pairs, eligible failure with no prefix, redaction before merge and fresh rebind/attach (`fx_projector/card.rs:312-375,678-710`).

The producer reads only actual `s.landed` at the Card after-damage position with `dot && ability == None && sig == None`
and records the first segment offset (`systems/card_bleed_feedback.rs:603-623`, `cards/after_damage.rs:41-50`).
Periodic and run-end both call the report flush; raid start clears only Card and records reset (`:627-658`,
`cards/runtime.rs:51-58`, `schedule.rs:1698`). Clone/restore rebuild the trusted pair index, reset derived projector
identity, and cold-prepare the represented capacities (`sim.rs:46-64`, `checkpoint.rs:237-250`). `FxTickReport`
reuses two buffers by swap/clear and preserves the empty markers under its bounded op envelope (`fx_report.rs:176-213`).
Nothing in this review establishes a historical audience for the raw source aggregate; freshly attached projectors
correctly start with empty Card public buckets.

The checkable privacy boundary is appropriate in the current code shape: `CardBleedHit` is typed/tagged trusted state
and classified `ServerOnly`; `observe::to_seen` returns `None`; the separately approved Card projection adds existing
`SeenEvent::Hit` only after settled entitlement/redaction and f32 representability checks (`fx_projector/card.rs:133-164`).
The independent Root leases for private headless digest and parity omission are present, but their execution and complete
union gates remain outside this pre-seal review.

## Review disposition

**HOLD pending the narrow defensive classifier repair/control above and final sealed evidence/reproduction.** The prior four
code-review findings appear addressed in current WIP, but their tests, source comparisons, allocation measurements and
final file hashes have not been executed/reviewed here. Do not treat this moving cut as admitted, freeze parity data, or
claim privacy/full-game acceptance from this inspection.

Key paths inspected were `systems/card_bleed_feedback.rs`, `systems/card_bleed_feedback/index.rs`,
`systems/card_bleed_feedback/tests.rs`, `systems/card_bleed_feedback/source_tests.rs`, `fx_projector/card.rs`,
`fx_projector/mod.rs`, `fx_report.rs`, `checkpoint.rs`, `sim.rs`, `events.rs`, `observe.rs`,
`cards/after_damage.rs`, `cards/runtime.rs`, and `schedule.rs`. Code hashes and moving status must be re-bound by the
final reviewer at the sealed candidate.
