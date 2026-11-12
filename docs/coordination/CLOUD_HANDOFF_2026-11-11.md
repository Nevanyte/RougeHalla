# Cloud session hand-off, 2026-11-11

A cloud session (no Unity Editor, no Mac) continued Rust-only work while the owner's laptop was closed. It worked as a
worker, not as the coordinator: no shared status record, `Cargo.lock`, `packages/`, `hosting/` or protected path was
changed, nothing was deployed, and nothing was merged into `feature/unity-rework`, `optimization_port` or `main`.

- **Branch:** `claude/youthful-cerf-qur7nu`, based on `origin/feature/unity-rework` @ `e43e8cf6` (integration 2, the last
  pushed head). The Mac's later local commits (P-AGENT-GATE-1 `cdb7731d`, the P-UNITY-HUD-CAMPS-1 merge, the agent
  definition edits, `agent/opus/P-WIRE17-HUD-1` @ `e9dc0b84`, resume note `e1d71a01`) were not on origin and are not
  included.
- **Merge order proposed:** the Mac's unpushed commits first, then this branch. No identity changes here (protocol 17,
  observation 24, checkpoint 31, replay 25, policy 18, content hash `b35f23ed00df75b3` all unchanged), so P-WIRE17-HUD-1's
  "content hash and checkpoint unchanged" claims still hold after both land. Textual overlap with the Mac's work is
  limited to `SimConfig { .. }` literals (one added line each) and `director.rs`/`main.rs`/`runtime.rs`; none of
  P-WIRE17-HUD-1's exclusive files (`rh-protocol`, `v17.json`, `rh-policy/src/delivery/`, `rh-server/src/wire.rs`,
  `rh-sim/src/observe.rs`, the C# codec) is touched.
- **Packets were done single-agent** (brief, `stub:`/`oracle:` commits, implementation). No independent review ran; each
  packet still needs the reviewer its routing names before merge.

## Packets

```
PACKET:          P-REGEN-COMBAT-1 — serves not in the plan: owner beta-follow-up decision 2 (2026-11-10), legacy f8cd956e
BRANCH:          claude/youthful-cerf-qur7nu @ 3a028a40 (stub 3b3408a2, oracle a54ee43e)
GATE:            see "Gate" below
CHANGED:         crates/rh-sim/src/{statics.rs,lib.rs,systems/regen.rs}, crates/rh-sim/tests/hash_coverage.rs,
                 crates/rh-server/src/runtime.rs, every full SimConfig literal (one line), docs/DEVIATIONS.md
D-RULES:         D1 loose proof (one unit test); D2 n/a; D5/D6/D9 none
DEVIATIONS:      proposed DEV-017 (balance): live profiles heal nothing in combat; the Legacy default keeps the oracle's
                 0.25%/s. Pending owner signature.
SHARED RECORDS:  proposed edits: MIGRATION (record the packet and DEV-017); backlog (row for P-REGEN-COMBAT-1)
LEGACY DOUBTS:   none
NOT ESTABLISHED: duel or camp balance effect of the change (it is the unreleased legacy rule, not a tuned number)
RISKS:           the Unity client needs no change (content hash unchanged), but a running beta keeps the old rule until the
                 server is redeployed
```

**Changed from the approved plan, and why.** The plan said "set the constant to 0, bring f8cd956e into `packages/`,
recapture the regen fixture, move the content hash". Applying the legacy commit to `packages/shared/src/constants.ts`
changes a file whose SHA-256 is pinned by 218 captured files (`rh-sim/tests/mob_catalog.rs` re-hashes it live; about 40
CI `capture.sh --check` steps embed it), so one value would have forced a recapture of most of `parity/`. Instead the rule
is a `SimConfig::regen_in_combat` switch modelled on `mob_spacing` (cd71ea1c): the default `Legacy` serializes as null and
changes no hash; `Off` is folded into the state hash, checkpoints and replays; `rh-server` `--runtime source-arena` and
`training` opt in. `packages/` is untouched. If legacy ever takes f8cd956e, flip the default and retire the switch.

```
PACKET:          P-MAP-3 — serves backlog row P-MAP-3 (Coarse) and owner decision 5 (2026-11-10)
BRANCH:          claude/youthful-cerf-qur7nu @ 891af976 (stub 40578831, oracle 8227709b)
GATE:            see "Gate" below
CHANGED:         crates/rh-server/src/{map_pool.rs,map_pool/tests.rs,lib.rs,director.rs,main.rs,runtime.rs}
D-RULES:         D1 loose proof (real generator: two seeds certify, admit, differ; a source-arena Sim steps 100 ticks on
                 one); D2 n/a; D5/D6/D9 none
DEVIATIONS:      none (legacy training-room reuse has no counterpart: Rust training plays the practice arena; an exhausted
                 fallback serves the configured --map where legacy throws)
SHARED RECORDS:  proposed edits: backlog row P-MAP-3 "Coarse" -> "implemented behind --map-pool, off by default"
LEGACY DOUBTS:   none
NOT ESTABLISHED: server load, memory and tick time per room on a full 160x160 / ~50-camp generated map (the beta map is
                 48x40 with 3 camps; maps/README.md's budget covers only that map); Unity frame time and rendering on a
                 generated map; a hosted run with the flag on
RISKS:           a hung generator thread cannot be killed (it is abandoned and holds a core until it returns)
```

Oracle correction (recorded in commit 891af976): the refill test first expected the queue back at exactly 3 after three
quick takes. Legacy's refill rule (ask up to target once queue + in-flight is at most `refill_at`) settles at
`refill_at + 1` or `target` depending on when the takes are seen, so the test now asserts that range. The implementation
follows legacy.

```
PACKET:          P-LEECH-GROUPING-1 — serves open reviewer finding, integration 1 (kill_augments.rs:368-369)
BRANCH:          claude/youthful-cerf-qur7nu @ 0a0da282 (oracle 88691f10)
GATE:            see "Gate" below
CHANGED:         crates/rh-sim/src/kill_augments.rs, crates/rh-sim/src/kill_augments/build_marks_tests.rs
D-RULES:         D1 bit-exact against the legacy formula (combatReadability.ts:102, :135); D2 n/a
DEVIATIONS:      none
SHARED RECORDS:  proposed edit: MIGRATION, remove the finding from "Open, found by reviewers, not acted on"
LEGACY DOUBTS:   none
NOT ESTABLISHED: a new legacy capture (the test computes legacy's grouping directly over 100 combinations)
RISKS:           none: last-bit differences only (reproduced: 1.5000000000000002 before, 1.4999999999999998 legacy and now)
```

## Not done, and why

- **Training practice camps count as camp clears** (the other integration-1 reviewer finding): confirmed real. Legacy
  `camps.ts:94-101` pays a practice camp's clear through `payCampHeal` (potion plus `campsCleared` for nearby
  contributors). Rust records no contributors in training (`systems/mob_life.rs:194`) and `kill_training_mob` pays no camp
  heal. Porting it needs per-practice-camp contributor state, which is checkpoint state (format bump), so it was left for
  a coordinator-scheduled packet.
- **Zone-themed camp buffs** (legacy `a7b5c4ce`): adds `CampRoster.buff` (checkpoint and observation bumps) and is meant
  to land after P-WIRE17-HUD-1 (its brief says so). Scoped: about 400-550 lines; roster roll in
  `mob_catalog/rosters.rs`, kill credit in `systems/mob_life.rs`, bot route split in `rh-policy`.
- **Frost Wall** (legacy `78dd8bd4`): new ability code 5 and field kind 3 on the wire collide with P-WIRE17-HUD-1's files;
  the sim side needs a mutable collision overlay (about 43 `collision_map` call sites); Unity needs an aim mode and
  preview that cannot be verified without the Editor.

## Gate

Baseline (`e43e8cf6`, full with Postgres, 4-core container): clippy and the workspace build passed;
`rh-server --test runtime_admission source_endpoint_hello_planning_ready_and_live_quest_trade_state` failed once under
load at a 143.6 s game-time condition and passed when rerun alone (0.19 s). Treated as a load-sensitive flake, not a
regression; worth watching.

Final head (code as of `0a0da282`; later commits add docs and `hosting/` only), full gate with Postgres:
**PASS with one environment exception.** Path checks, rustfmt, clippy (all features and default), workspace tests,
the `rh-sim` suite (trusted-status-probes) all pass. In the `rh-server` Postgres suite,
`result_recovery::database_stopped_during_a_match_ticks_continue_and_the_result_lands_after_restart` cannot run in this
container: it calls `pg_ctl stop` directly and PostgreSQL refuses to run as root (the container's user); after
installing the `en_US.UTF-8` locale its start step passes. The gate stops at the first red step, so the remaining steps
were run by hand with the same commands: the rest of the `rh-server` Postgres suite and the `rh-placement` Postgres
suite pass; parity report: 109 slice scenarios + 13 capture-only and 300 pathfinding queries, all MATCH; JS decoder
agrees with `v17.json`; C# 1,444/1,444 and the Unity copy is current; headless smoke (seed1, 8 bots, 4,000 ticks) runs.
Not run here: Unity EditMode and Web build (no Editor), capture `--check` tools, perfproof, cross-architecture
determinism, browser proof. CI on the pushed branch is the final word.

## Second round (owner request 2026-11-11: measurement, Brain, signature terrain)

Owner answers recorded in chat on 2026-11-11: degraded fair Brain approved; the learner runs on the beta too; the Plague
marsh slows with bog only (water is presentation); live faction terrain exemptions stay as they are.

- **Full-map cost** ([evidence](../evidence/full-map-cost/README.md), commit b3cfa848): on this 4-vCPU host a pooled
  160x160 map costs 5-12x the beta map per tick (mean 0.93 ms vs 0.15 ms, p99 up to 5.3 ms, one 33 ms spike), about
  7-8 MiB per room and 56 ms to generate. Not measured: wire/socket cost, human clients, Unity.
- **Learner on the beta** (commit 81ded797): `hosting/technical-demo/bootstrap.py` runs Source with
  `--bot-learning single-writer`; Training keeps `off` (rh-server refuses learning in training). Owner-approved protected
  edit; R-ML's amendment is still unsigned, so record the approval when it is signed. Nothing deployed.
- **P-SIGNATURE-1** (commit 6181bc9e): `--map-pool --signature-landmarks` adds a volcano, church, bog tree and frozen
  cave as real terrain on pooled maps; each landmark is kept only if the strict certifier finds no new failure. Seeds 1-8:
  bog tree 8, volcano 7, church 6, cave 4. No content-hash, protocol or parity change. Not viewed in Unity.
- **P-BOT-BRAIN-LIVE-1**: scoped and written as a ready packet with the composer design
  (`docs/backlog/packets/P-BOT-BRAIN-LIVE-1.md`); not implemented here. It is about 1,500-2,500 lines across rh-policy,
  rh-server and rh-headless and is best done as one focused Opus packet with an Opus review.

Proposed shared-record edits for the coordinator: MIGRATION entries for P-SIGNATURE-1, the measurement and the learner
switch; backlog rows for P-SIGNATURE-1 (implemented behind flags) and P-BOT-BRAIN-LIVE-1 (ready packet).
