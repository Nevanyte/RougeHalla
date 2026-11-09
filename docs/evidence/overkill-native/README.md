# P-OVERKILL-NATIVE arithmetic/filter repair

Bounded native continuation from root native union 6db02195abab67d9867f6340cc61a8dc7d4f6114 with the three additive
source commits preserved (6aba752d, 0731bf29, 9434ac44; branch base head 6d48b6e6). The existing five-case source corpus
parity/overkill-producer/source.json is immutable: sha256
916a1cc143b09addeab92ecd0b84fa4e87e78d3b4ddfd51a42ee2938f90c4577. No source recapture, no production/source edits outside
the leased native files, and no header/content/tape/Cargo.lock/status changes.

## Native mechanical repair

crates/rh-sim/src/systems/ledger.rs now matches packages/server/src/sim/ledger.ts:310-405 for the Overkill producer:

- A dead victim's absorbed amount is max(0, barrierBefore - currentBarrier) for player victims and zero otherwise.
- excess = total - absorbed - applied in source operation order; the Overkilled hook fires only when excess > 1e-9.
- Included hits are positive mitigated amounts and non-arena entries, in original ledger entry order, not ranked
  application order.
- Each OverkillHit carries both the actual mitigated/capped/denied amount (amount) and its original pre-mitigation raw
  from this pass (raw, after scaling/settlement multiplication and before mitigation/caps/denials). The existing Overkill
  splash still consumes raw unchanged; only the direct test construction gained the explicit amount.
- The reusable per-victim raw vector lives in TickScratch (ledger_raws) alongside the existing per-victim working lists;
  no per-entry heap object or canonical/world field was added. Hook order and C-TICK/input/schedule are unchanged.

## Actual-source consumer

NEW crates/rh-sim/src/systems/ledger/overkill_source_tests.rs consumes all five pinned source cases using real native
setup and ordinary attacks/steps/real labelled heal, with the source corpus only as assertion input. It compares:

- pre/post player HP, barrier and max HP; status/weapon where captured; positions after the declared setup
- exact tick/time for producer hooks and full Overkill arguments
- overkilled, total, amount and raw for every actual included hit
- included entry order, positive/non-arena filter, no-hook negative
- hitLanded, hurt, fighterOut, staggered records and the filtered producer hook order
- a typed, read-only ProbeLog.overkilled diagnostic (default disabled, cleared per step, outside canonical
  state/hash/restore; HookRecord shape and Full comparator outputs unchanged) plus a disabled/noninterference state-hash test.
- a labelled pure boundary unit check for the 1e-9 predicate; no captured-source equality is claimed at that boundary.

Case facts confirmed: lethal-no-barrier (52.604651 excess / 53.604651 total / 64.325581 raw), barrier-absorbs (barrier
147.994949, HP 1, no Overkilled), barrier-lethal (22.604651 excess, absorbed 30), multi-contribution (two ordered p0/p1
rows, 106.209302 excess), arena-contribution (36.137967 non-arena raw 64.325581; arena row contributes to total but is
filtered from hits).

## Commands / gates

Run from the candidate worktree with root final-env.sh and an isolated target (CARGO_TARGET_DIR=/tmp/overkill-native-target,
CARGO_INCREMENTAL=0, jobs <= 2):

- cargo test -p rh-sim --all-features --lib overkill_source_tests -> 3 passed (five-case consumer, boundary unit,
  disabled/noninterference).
- cargo test -p rh-sim --all-features --lib cards::on_overkilled::tests -> 1 passed.
- cargo test -p rh-sim --all-features --lib buffs::caller_tests -> 1 passed; buffs::replay_tests -> 1 passed;
  floor_sees_post_barrier_overkill... -> 1 passed.
- RH_ABIL_REQUIRE_FULL=1 cargo test -p rh-sim --all-features --lib frozen_full_source_all_63_cases -> 1 passed.
- cargo fmt --all -- --check -> clean; cargo clippy -p rh-sim --all-targets -- -D warnings and
  --all-features -- -D warnings -> clean.
- Broader lib sweep (not required scope): 738 passed (735 untouched-base + 3 new tests), 3 failed, 7 ignored. The same three failures occur unchanged at the
  untouched base 6d48b6e6: ability_hash_tape_matches_the_base expects checkpoint version 27 but base records 25 (the
  known old-Full hash tape; NOT refreshed here), trial_convicted_radius expects 200 but base gives 300, and
  basic_pve_mode_content_and_join expects full PvE construction to be refused but base accepts it. They are pre-existing
  root-union/base issues outside this lease, not caused by this repair.
- The existing no_alloc steady-state test fails identically at base 6d48b6e6 with Malformed invalid Sentenced state for
  actor 1 after the Sentenced crowded scenario; the same failure remains without any new allocation introduced here.
- parity/overkill-producer/source.json remains sha256 916a1cc143b09addeab92ecd0b84fa4e87e78d3b4ddfd51a42ee2938f90c4577.

## Controls

Each semantic fault ran in a fresh disposable native copy with its own cargo target; compilation succeeded in every
variant, so these are actual test kills, not compile/provenance failures:

| Fault | New real-consumer failure |
| --- | --- |
| absorbed omitted (dead player uses absorbed=0) | overkill 52.604651 != source 22.604651 in barrier-lethal |
| raw replaced by mitigated amount | hit/raw 53.604651 != source 64.325581 |
| non-arena filter removed | Overkill hit count 2 != source 1 in arena-contribution |

The final unchanged candidate consumer passes, and all disposable copies/targets were removed.

## Files and hashes

- crates/rh-sim/src/systems/ledger.rs sha256 4df61d4fd74da54c66ca4397e670f52f595b3b66b503f81b308f26339c22842c
- crates/rh-sim/src/systems/ledger/overkill_source_tests.rs (new) sha256 1a5b3a167b09c8e76565e025ad29b77ca83ba023ef5494e35948541cc3effd35
- crates/rh-sim/src/scratch.rs sha256 ee9097471f8ade324015a45b3db71f364559fbc369ee20eba08d0efca2bd1838
- crates/rh-sim/src/status_runtime/probe.rs sha256 1b225a86344dbaa938208bc167353cb6be5208ccd7e39b32fd9c00aee0bd75ce
- crates/rh-sim/src/cards/on_overkilled.rs sha256 55fc08f1ea5be109ff5f78d386d298832e7391043b094eafb99c692104cce321
- immutable corpus parity/overkill-producer/source.json sha256 916a1cc143b09addeab92ecd0b84fa4e87e78d3b4ddfd51a42ee2938f90c4577

## Limits

1. The source producers did not reach the exact 1e-9 boundary; the boundary check is a pure native predicate unit test.
2. This is a bounded five-case actual-source consumer, not a whole-world/event/Room or native hash equality claim.
3. Root owns content registration, derived tapes/final versions/main merge; a changed old Full hash tape, if any, needs
   root reconciliation and was not refreshed here.
