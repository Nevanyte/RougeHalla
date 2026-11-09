# Slow Starter native29 candidate

Bounded private implementation for independent Root review. Branch `codex/slow-starter-native29` starts at exact Root prerequisite `dfca7746dab87407bfd1dec2920322446c5a5598` and merges frozen source assessment `fdf4227bdebbe1c119bfd42f4ef9db9bb6497e34`. Root allocated checkpoint29/replay23 and `CARD_FIGHT_GAP_MS=3000` before this implementation. Public protocol14, observation/policy, final content/hash coverage/old derived tapes and integration remain Root-owned. No identity/golden/tape/header/dependency/lock/shared-status edits are part of this implementation. One worker, no added agents, no cloud or live data.

## Result and private state

`Player.card_runtime` now lazily owns `fight:Option<FightClock{start,last}>`, alongside Wish spend. Runtime's Option fields are required in the new serde shape, with unknown fields denied. A watched row alone allocates no runtime. The source-equivalent watch derives from the player's actual flattened FightTime rows, not an enum or NPC credit owner.

At the existing live `mods.updateMods` entry (`items::fold_armor`), the clock consumes the actual completed landed list once, before the existing refold loop and **after the ledger has paid its cached damage**. It touches actual by and victim IDs, including dead players, with no amount/weapon/ability/DoT filter. An NPC victim still allows its watched player attacker to be touched. Duplicate same-time touches are idempotent. Gap>=3000 restarts both timestamps; otherwise only last changes. Holds uses strict recent-gap<3000 and age>=arg*1000; expired clocks remain stored. No change to SourceFn/source-query order or MarkTax's separate adapter is included.

Losing all FightTime rows during a real refold clears only fight, retaining Wish; an owner with neither field canonicalizes to None. Generic cardHooks reset preserves fight while retaining the existing Wish/streak/etc reset. Death/teleport gain no new reset. Source Training Clear removes the clock through row loss. Actual Slow Starter TrainCard1/0 and reward admission remain restricted by the unchanged interactive whitelist; all card setup grants in these tests are honestly declared real grant helpers, not ordinary acquisition claims.

Restore validates independent nonempty ownership, row presence and finite ordered nonfuture timestamps. Source lifecycle's existing absolute clock domain also checks its50ms timestamp grid. Baseline/Off permits genuinely produced fractional epochs. Every existing Wish-only mode/timing/stock equation remains, including Off stock refusal and Full-before-start checks, now scoped to wish_cast. Fight-only Off, Wish-only and combined state remain distinct. Cached modifier snapshots are not refolded from current time to manufacture a restore result.

## Source/native verification

The immutable seven-case assessment at `docs/evidence/slow-starter-assessment/source.json` is the only new source oracle; no further source campaign ran. Native setup reproduces declared constructor seeds, room/spawns, profiles, player positions/weapons and real card grants. Actual attacks/releases/Training commands use validate+budgeted Sim::submit. NPCs are genuinely born by the real Training producer and retain their identity/type/maxHP/position. No expected frame, clock, HP, death, hit, phase or RNG post-state is installed.

Every retained ordinary frame compares exact clock/watch/holds, cached damage sum, actual landed count/actor IDs and damage, player HP/maxHP/status/positions, born NPC count/kind/HP/maxHP/positions, coliseum state, and combat/lifecycle event-type+actor order. Main and reward generator states match complete source draw prefixes at every offset; each recorded value is also regenerated and compared exactly. The closed source cases have no quest draws. Source event payloads beyond those stated projections are not claimed as a full transport comparison.

The2950/3000/3050 gap cases match high/high/low already-paid hits. In particular7050ms still pays48.786255552652214, then restarts start/last7050 and folds−30%;7100ms pays25.29657695322707. Mutual hits, watched victim death12850/retained expired clock15850, real Clear4550/no retroactive old-landed scan after helper gain, and actual normal patience teleport5050 all match. No ordinary card-door widening or unrelated gameplay change is needed.

Watched-without-clock, started/mature/expired/restarted source states, Off/Full fight-only and actual Full Wish+fight states undergo JSON checkpoint/clone continuation. JSON-serialized `ReplayInput::Command` fragments pass through the existing replay input dispatcher and ordinary simulation; events and private hashes match each step, with repeated restore during continuation. Actual Wish spends, row-loss preservation and explicit generic card-reset diagnostics are tested separately. Hash sensitivity independently changes valid start and last leaves; malformed clocks/empty owners/missing Option fields/nonfinite values/no-row state and invalid Wish state are refused.

**Replay limit:** current ReplayStart/ReplayInput cannot encode declared Slow Starter grants, and ordinary live doors omit this optional card. This packet does not add a grant input or claim a full-from-lobby `run_replay` of this optional row. The clock proof is a produced checkpoint plus recorded-command continuation. Existing six public Replay23 tests pass separately; Root retains full identity/tape admission.

## Root-approved fractional history repair

The first actual fractional restore was red: declared Baseline/Off epoch0.1 before joins, real Attack, unmodified produced samples50.1→100.1. Their bits are `0x40490ccccccccccd` and `0x4059066666666666`; subtraction is49.99999999999999 (`0x4048ffffffffffff`). The original `next-previous>=50` predicate falsely refused that actual producer. Sim advances `server_time += TICK_MS` and movement records that actual clock.

Root explicitly extended the lease for exactly one checkpoint predicate hunk: `next >= previous + TICK_MS`. It preserves the existing first-equal/Blaze exception and all other finite/future/arena/history restrictions, with no epsilon, rounding, history reset or post-state repair. All four declared epochs0.1,1/3,100000.1 and100000+1/3 now reach real Attack and restore/continue with the actual histories. One-ULP-nearer, reversed,25ms-dense and future samples are rejected for the intended history reasons. Existing actual overlapping Blaze/path history repair tests pass. The old giver workaround, fixtures and derived tapes are untouched.

## Commands and check boundaries

Use the existing exclusive target only under a Root lease. This candidate used:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/slow-starter-native29-unused-pg
export CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cargo fmt --all -- --check
cargo clippy --locked -p rh-sim --lib --tests -- -D warnings
cargo clippy --locked -p rh-sim --features trusted-status-probes --lib --tests -- -D warnings
cargo test --locked -p rh-sim --lib cards::fight_clock::tests -- --nocapture
cargo test --locked -p rh-sim --lib cards::fight_clock::tests::slow_starter_warm_alloc -- --exact --ignored --test-threads=1 --nocapture
cargo test --locked -p rh-sim --lib abilities::source_tests::repair_tests -- --nocapture
cargo test --locked -p rh-sim --lib abilities::source_tests::training_tests -- --nocapture
cargo test --locked -p rh-sim --test checkpoint a_mid_fight_checkpoint_continues_identically -- --exact
cargo test --locked -p rh-sim --test replay
python3 tools/slow-starter-native29/mutants.py /absolute/new/task-owned/mutant-directory
shasum -a 256 -c docs/evidence/slow-starter-native29/SHA256SUMS
```

No database command used that unused task-specific state. The allocation test is intentionally ignored in concurrent general test runs because the existing global dhat profiler must run alone; its explicit invocation measures60 actual attacking steps in each original/clone/restore phase after warming,180 measured steps total, all zero allocations. This is allocation evidence, not a latency or performance claim.

Five compiled temporary mutants exercise false FightTime, excluded victim touches, incorrect gap equality, retained row-loss clock and generic reset loss. The runner requires a real assertion failure rather than compilation failure and restores exact original source bytes in finally blocks. It never changes source fixtures or expected tapes. A canonical rebuild follows the mutation run. The original source assessment's eight damaged-observation controls are separate checker tests, not these compiled native controls.

No whole workspace/map campaign or final hash-coverage/content/derived-tape admission is claimed. Native production changes are limited to the approved private clock owner/module, row-loss/holds read, one late touch call, field-specific Wish validation, and the separately approved one-line history predicate. Remaining static/unrun source lifecycle cases (same-world exported startRaid, Training death/revive, unsupported same-string actor re-add) retain their original labels.

Tracked log copies trim trailing line/EOF whitespace for the Git whitespace gate; messages, failures and values are unchanged. Raw command logs remain under `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/slow-starter-native29-*.log` and `slow-starter-native29-mutants-001/`, with their original byte hashes retained in receipt.json. No failed result is promoted to a pass.
