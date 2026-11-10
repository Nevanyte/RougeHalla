# Card bleed native probes — disposable execution receipts

**Status: evidence only.** No production repair, no Card report/index/version change, no numeric-admission decision,
no status-admission change and no mob-checkpoint repair is made or recommended here. All probe Rust was disposable,
was executed, and has been removed; the canonical tree is restored to the exact base. This evidence records actual
execution results, including earlier failed setup attempts and the one typed restore refusal.

- Immutable base: `36564c333d56beb8d47a9962cec033eea85b1921` (branch `codex/deepseek-card-design-probes`, private
  checkout). Worktree clean before and after; `HEAD` unchanged.
- Static design context read (predictions **UNVERIFIED** by that author, treated as hypotheses only):
  `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests/docs/coordination/CARD_BLEED_NATIVE_DESIGN.md`.
  Every predicted outcome below is reported as **actually observed**, or as a different/earlier result where it differed.
- Toolchain/flags: `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)` from the pinned
  `/Users/nevinmckinnon/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin`, `--offline --locked -j 1`, private
  `CARGO_TARGET_DIR=<repo>/target/card-design-probes-build`. No network, no captures, no full-workspace tests, no
  Cargo/dependency/lock edits, no source-fixture/expectation edits, no protocol/pin/status edits.

## Probe code and preservation

One new `#[cfg(test)]`-only module, `crates/rh-sim/src/card_bleed_native_probes.rs`, plus a 3-line
`#[cfg(test)] mod card_bleed_native_probes;` registration in `crates/rh-sim/src/lib.rs`. Both were removed after the
receipts; the canonical files match the base commit again and the preserved patch re-applies cleanly
(`git apply --check` passed).

Preserved privately under the ignored worktree path `target/card-design-probes-private/` (never Git, never user
messages):

| artifact | SHA-256 |
|---|---|
| `target/card-design-probes-private/card_bleed_native_probes.rs` | `d3c6974fe6f2c92250612981f3949776fe2603a420279e57d643702b60ffd469` |
| `target/card-design-probes-private/lib.rs.patch` (registration + full module) | `6fb2d8d868377ad8ec5f5de4ff401806c933b9678cec0240b26843c421fde039` |

Also preserved there: `commands.log` (invocations/exits), `final-probe-run.log`, `final-probe-run-rerun.log`,
`rerun-diff.txt` (empty), `probe1-run.log`, `probe2-run.log`, `probe3-run.log`, earlier compile/build logs,
`private-sha256.txt`. Full checkpoints and raw state transcripts are deliberately not recorded anywhere in Git; the
private logs contain only the probe's own compact facts.

## Invocation and exits (actual)

```sh
cd /Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/card-bleed-design-probe/repo
export PATH=/Users/nevinmckinnon/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin:$PATH
export CARGO_TARGET_DIR="$PWD/target/card-design-probes-build"

# warm normal build of the untouched test lib (exit 0, 2m02s)
cargo test --offline --locked -j 1 -p rh-sim --lib --no-run

# final receipt run: 5 tests, exit 0
cargo test --offline --locked -j 1 -p rh-sim --lib card_bleed_native_probes \
  -- --nocapture --test-threads=1
# -> "test result: ok. 5 passed; 0 failed"; deterministic rerun exit 0 with the 43 sanitized PROBE/test
#    lines byte-identical (rerun diff empty).
```

Earlier actual exits in this probe session: the first compile of the modern receipt revision failed `exit 101` with
`E0369` (`assert_eq!` over `Result<Sim, _>`, `Sim` is not `PartialEq`) and was fixed in the probe only; the first
Probe 3 constructor attempt panicked `exit 101` on `"initial loot requires explicit MVP storage mode"`; the first
seeded (Fire) Hemorrhage attempt ran `exit 0` but produced no bleed. These prior setup attempts are retained and
re-executed as non-probe receipt tests (below).

Method: normal training/PvE constructors + `add_player` + one ordinary 50 ms step; a real baseline checkpoint
serialized with `serde_json::to_string(&Sim)` and restored through the actual public reader `Sim::restore`; a candidate
checkpoint built by restoring that same checkpoint, adding only the labelled player status rows through the existing
`status_runtime::apply` source helper (which also refreshes effects), re-serializing, and restoring again through
`Sim::restore`; then exactly one ordinary `step()`. Tests assert the reached facts (accepted restore, produced landed
rows, reached hit/on-hit producer, exact typed refusal), so Cargo cannot pass on an early setup refusal.

## Probe 1 — one sourceless player Dot, value 1e307 (actual)

- Baseline: normal training constructor path; `phase=Active`, `tick=1`, `server_time=50ms`, players=1, dummies=2
  (the training gate installs the practice setup even with config `dummies=false`), `check_layout=Ok`.
- Baseline checkpoint restore: **accepted**; restore→reserialize identity true.
- Candidate setup: one generic Dot, tag `numeric-probe:dot0`, source `id=None/owner_id=None`, `ability=None`,
  value `1e307` (finite), `started_at=50`, `until=1050` (delta 1000), default damage shares, `initialized=true`,
  `cast=None`, effects refreshed. Candidate-vs-baseline serialized change is exactly the player status subtree:
  `/world/players/0/core/statuses/{effects,initialized,instances (len 0 -> 1)}`.
- Candidate checkpoint restore: **accepted**.
- One ordinary step: advance exactly 50 ms; events `{Death:1}`.
- Actual trusted eligible landed rows: **1** (`dot=true`, `ability=None`, `sig=None`, `by=None`); landed amount
  **nonfinite (infinite)**.
- Diagnostic `value * TICK_MS / 1000.0` (probe arithmetic, not a system output): nonfinite (infinite).
- Post-step player: `status=Alive`, hp=950 (training settle revived the downed player at full HP); the injected Dot is
  no longer present (fighter-out status cleanup before this observation).
- Post-step `check_layout=Ok`; checkpoint after the step serialized and restored: **accepted**.
- Factual scope: the non-finite amount is the tick-scratch landed diagnostic; it is not serialized/hashed, and this
  single-step World receipt stayed finite. No Card report exists in this base to persist it.

## Probe 2 — 4096 sourceless player Dots, value 1e306 each (actual)

- Candidate: **4096** Dot rows, 4096 distinct tags, all values finite `1e306`, all source `None` (id and owner), all
  `ability=None`, all `Payload::default()`; `initialized=true`, `cast=None`.
- Candidate checkpoint restore: **accepted** (serialized checkpoint 1,552,160 bytes; size fact only).
- One ordinary step: advance exactly 50 ms; events `{Death:1}`.
- Actual eligible landed count: **4096 / 4096**; every row `victim=player`, `by=None`, `ability=None`, `sig=None`,
  `weapon=None`; **all individual landed amounts finite**; distinct amount bit patterns = **1** (every row 5e304).
- Actual grouping before any same-pair claim: `actual_groups=1`, group `(victim=player, by=None)`, rows 4096.
- Per-`(victim,by)` binary64 fold from the **actual** landed amounts, in landing order (source insertion order for
  this single pair): **first non-finite contribution = 3596 (1-based)**; prospective same-pair total non-finite.
- Type sizes observed on this base (in-crate, no public export added): `LandedHit=48`, `Event=104`, `SeenEvent=80`;
  the prospective design types `fx_report::Op`, `ExactSum` and `Bucket` **do not exist in this base** (unavailable,
  not measured).
- Post-step `check_layout=Ok`; checkpoint after the step serialized and restored: **accepted**. As in Probe 1, the
  overflowing total/non-finite row is the ledger/HP/landed diagnostic path; the persisted single-step World stayed
  finite. No Card report accumulation was implemented or tested.

## Probe 3 — earned Hemorrhage no-ability Dot on a regional NPC (actual)

- World: normal `Sim::try_new` PvE profile (mob mode PvE, admitted five-faction mode, abilities/hazards off,
  `initial_loot=true` through the MVP storage path, consumables off), validated seed1 arena export (50 camps, 204
  regional spots), real `add_player` (Holy; physical share 1.0), ordinary raid-start `step()` → `Active`,
  204 regional NPCs.
- Target selection: live regional NPC by retained typed `ActorOrigin::Mob` provenance, with a declared legal adjacent
  placement (walkable, melee ray clear, within fists reach). Setup declared: card grant/loadout, position/facing,
  history reset — no Dot/status/pending report installed, no validator bypassed.
- Baseline checkpoint (after card/loadout/position setup, **before** the hit): restore **accepted**; restore→
  reserialize identity true.
- Real input through `validate` + budgeted `Sim::submit`: ordinary **Attack** → normal schedule step. The hit producer
  was reached: **2 Fists weapon-hit landed rows**; the real `cards::on_hit` producer created no-ability bleed Dots on
  regional NPCs (`tag=bleed:2`, source = the real player).
- Ordinary **Release** validated and submitted → next normal step; the bleed ticked: **2** no-ability Dot landed rows.
- Focused NPC (surviving): Dot `kind=Dot`, `ability=None`, `source=player`, owner None, duration **2000 ms**, value
  finite, physical shares `(1.0, 0.0, 0.0)`; NPC **alive and hp>0** after the hit.
- Checkpoint taken while that status is present: restore **refused** with exactly the typed result
  `CheckpointError::Malformed("unsupported mob status domain")`; Display:
  `malformed checkpoint: unsupported mob status domain`.
- This reproduces the design's predicted refusal through a genuinely earned trajectory; it is not a direct
  installation of an unsupported status and does not change the predicate. No mob-checkpoint repair is proposed here.

## Retained prior setup attempts (not probe results)

- **Constructor attempt:** the first Probe 3 harness revision asked for seed1 PvE with `initial_loot=false`; the normal
  `try_new` refused with exactly `"initial loot requires explicit MVP storage mode"` (exit 101). Final world uses the
  admitted MVP storage path. Re-executed as a prior receipt test.
- **Fire-seat attempt:** the first seeded world used a Fire seat. The ordinary Fists hit producer/ledger ran and landed
  real weapon-hit rows, but produced **0** bleed Dots: Hemorrhage's producer multiplies by the faction physical share,
  and Fire's physical share is `0.0`. The final physical seat is Holy (`phys=1.0`). Re-executed and asserted as a prior
  receipt (real hits landed, no bleed); this is a producer/setup fact, not evidence about the final earned path.

## Honest limits

- One pinned toolchain/OS (macOS aarch64, Rust 1.97.0), run twice deterministically; not a cross-platform claim.
- Only the new probe module's unit tests were built/run (plus the untouched test-lib warm build); no workspace sweep,
  no other suites, no captures.
- The prospective Card report/indexes/version work was not implemented; measured sizes for its types are unavailable
  because the types do not exist at this base.
- The Probe 3 refusal is the current typed admission outcome only; this evidence makes no numeric/status/mob-checkpoint
  admission decision and authorises no repair.
- **Git limitation:** this checkout is a linked worktree whose git metadata is
  `/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/repo2`, outside the session's `workspace-write`
  scope. `git checkout -- <file>`/`git commit` are denied with
  `fatal: Unable to create '…/.git/worktrees/repo2/index.lock': Operation not permitted`. The canonical source was
  therefore restored by direct file edit/deletion (verified `git status` clean, `HEAD` at base, preserved patch
  re-applies), and this evidence is left **uncommitted in the working tree** rather than expanding permissions.
