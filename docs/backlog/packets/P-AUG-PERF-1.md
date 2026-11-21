# P-AUG-PERF-1: the rework's cost in legacy worlds, back under perfproof's budget

- **Serves:** CI green for PR 80, the augment and elite rework (owner, 2026-11-20: "Please push and merge the new
  augments"). CI's `perfproof` job (`.github/workflows/perfproof.yml`; CONTRIBUTING.md "Performance gate") fails it.
- **Tier:** `implementer-opus` (hot paths in `rh-sim`, possibly `rh-policy`; state, hash and checkpoint code must stay
  byte-for-byte equivalent). Reviewer: `reviewer-opus`.
- **Base:** `feature/unity-rework` at the commit that adds this brief.
- **Oracle (already failing):** `python3 tools/perfproof/perfproof.py --baseline 1dd79a938 --max-ir-ratio 1.03
  --max-alloc-increase 0`, on Linux with valgrind. `1dd79a938` is origin's tip that PR 80 merged (its merge-base).
  - CI run 44862423148 (PR 80 head `52bd52065`) failed it on instructions alone:

    | workload | Ir ratio |
    |---|---|
    | sim_crowded_8 | 1.1519 |
    | sim_duel_chase | 1.1741 |
    | sim_fists_duel | 1.1734 |
    | headless_seed1_8bots | 1.0416 |
    | headless_seed1_recorded | 1.0472 |
    | headless_arena_8bots | 1.0487 |
    | verify_replay | 1.0583 |

  - `paths_300` and `wire_seed1_8bots` passed. Every fingerprint matched and no allocation count rose.
  - After the coordinator merges origin's P-TICK-6 (`5567458fb`: rh-server and docs only), CI's merge-base moves to
    `5567458fb`. Its sim, policy and headless library code equals `1dd79a938`'s, so measure against `1dd79a938`.

## What is known

- Every workload runs **legacy rules** (`SimConfig` default: `augments` and `elites` are `Legacy`). The rework's rules are
  off there, so the extra instructions are in seams that run whatever the rule says.
- No build setting changed between the two revisions (no profile, toolchain or dependency change). One feature line did:
  `rh-sim`'s `trusted-status-probes` now also turns on `trusted-build-setup`.
- **Suspects (the coordinator's reading of what the rework put on per-step and per-hit paths; none measured):**
  - `cards::Tuning` lookups (`cards/tuning.rs`, `cards/rework_overrides.rs`) where constants used to be: `Build::rows`,
    `outgoing_damage`, `execute_share`, `maximum_packet`;
  - the rule-aware cached-modifier check in `modifiers/mod.rs`;
  - the native hook calls inside existing systems (`cards/native/hooks.rs` and its call sites) and the own-only readout
    producer;
  - the elite seam reads on `MobRuntime`;
  - Plant Your Feet's range multiplier on the pending action (`abilities/checkpoint.rs`, `systems/weapons.rs`);
  - new state that the per-step state hash now walks (the sim workloads fold a state hash).
- **Measure first.** Attribute the delta between the two builds before changing code, and measure each fix.

## Must

- **No behaviour change.** Every perfproof fingerprint stays equal. Every parity fixture, digest guard, the hash tape,
  `tests/hash_coverage.rs` and every `*no_alloc*` test stay green.
  - No serialized field, state-hash definition, checkpoint, replay or observation format, wire format, content hash or
    RNG draw changes.
- **Rework worlds keep their behaviour too.** Every rework test (`crates/rh-sim/src/cards/**`, `reward_chests/**`,
  `systems/mob_life/**` and `crates/rh-headless/tests/rework_at_25ms.rs`, release) passes unchanged.
- No test is edited, added or removed.
- Typical fixes, each with a measured effect:
  - an early return when the rule is `Legacy` or no player holds a native card;
  - a `Tuning` lookup hoisted out of a loop;
  - work done once per step instead of once per hit;
  - a plain branch instead of a table walk;
  - `#[inline]` on a small hot accessor.
- **Target:** every workload at or below 1.02 (1.03 is the line; leave margin for CI's x86 runner).
- **Stop and report** if, after the measured fixes, any workload stays above 1.03. Report the table, what the remaining
  delta is attributed to, and what removing it would cost. The budget lives in `.github/workflows/perfproof.yml`, an
  owner-only file: the coordinator takes it to the owner.

## Running the oracle on this Mac

- Docker Desktop is up. Another agent is running a long emulated amd64 capture in it. Never start, stop or restart
  Docker, and never touch a container you did not start.
- Use your own config dir: a directory holding `config.json` with `{"auths":{}}`. Run every docker command with
  `DOCKER_CONFIG=<that dir>` and `DOCKER_HOST=unix://$HOME/.docker/run/docker.sock` exported.
- Run a **native arm64** Linux container, for example:

  ```
  docker run --rm --platform linux/arm64 \
    -v <repo root>:<repo root> -v rh-perfproof-cargo:/usr/local/cargo/registry \
    -w <your worktree> rust:1-bookworm bash -lc \
    'apt-get update -qq && apt-get install -y -qq valgrind python3 >/dev/null && git config --global --add safe.directory "*" \
     && python3 tools/perfproof/perfproof.py --baseline 1dd79a938 --max-ir-ratio 1.03 --max-alloc-increase 0'
  ```

  - Mount the main repo at its own absolute path, so the worktree's `.git` link resolves.
  - rustup installs the toolchain that `rust-toolchain.toml` pins.
  - Use `--only` while iterating, and `--keep` to keep builds between runs.
  - Afterwards, run `git worktree prune` for the baseline worktree perfproof made.
- The arm64 ratios approximate CI's x86 ones; CI is the final word. Iterate natively on macOS for speed (time
  `parity-bench crowded_8 11` on both builds, or use a sampling profiler). Use the container run as the proof.

## Write scope

- Non-test code under `crates/rh-sim/src/`, `crates/rh-policy/src/` and `crates/rh-headless/src/`.
- `docs/evidence/rework-perf-2026-11-21/README.md` (new): the before and after tables, and what each fix bought.
- This file (the hand-off section).

Never: any test file, `Cargo.toml`, `Cargo.lock`, `parity/**`, `protocol/fixtures/**`, `.github/`, `scripts/gate.sh`,
`tools/`, or schedule row order. If a fix needs a Cargo feature change, stop and report.

## Gate

- While iterating: `scripts/gate.sh --quick`.
  - Its only waived red is the card provenance pin of `tools/protocol-js/check-vectors.mjs`, which P-CI-GREEN-7
    refreshes in parallel.
- Before hand-off, also run:
  - `cargo test --release -p rh-headless --test rework_at_25ms --test frost_wall_bots --test frost_wall_live --test brain_choices`
  - the oracle above, all workloads, in the container.

## Done

- perfproof passes in the container: every workload at or below 1.03 (aim for 1.02), fingerprints equal, no
  allocation increase.
- The quick gate is green except the waived pin.
- The evidence README is written, and the AGENTS.md hand-off report is in this file.

## Hand-off (implementer-opus, 2026-11-21)

```
PACKET:          P-AUG-PERF-1 — serves CI green (perfproof) for PR 80, the augment and elite rework (owner, 2026-11-20)
BRANCH:          agent/opus/P-AUG-PERF-1 @ 05d7c357a (code; this hand-off and the evidence README are the next commit)
GATE:            quick: PASS except the waived card provenance pin (tools/protocol-js/check-vectors.mjs, P-CI-GREEN-7);
                 release rework_at_25ms, frost_wall_bots, frost_wall_live, brain_choices: PASS;
                 oracle (perfproof vs 1dd79a938, arm64 container): every Ir ratio 0.91-1.00, fingerprints equal,
                 allocations equal; passes with --allow-fingerprint-change verify_replay.contentHash (see RISKS)
CHANGED:         crates/rh-sim/src/cards/mod.rs, crates/rh-sim/src/cards/native/mod.rs,
                 crates/rh-sim/src/systems/weapons.rs, docs/evidence/rework-perf-2026-11-21/README.md, this file
D-RULES:         D1 n/a (no mechanic ported; every perfproof fingerprint, parity report and the hash-bearing suites
                 unchanged); D2 n/a; D5/D6/D9 untouched
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none
NOT ESTABLISHED: x86 ratios (CI is the final word; arm64 measured 0.91-0.99 on the workloads that were 1.04-1.17 on
                 CI's x86); rh-policy and rh-headless suites beyond the four release tests were not run (no file there
                 changed)
RISKS:           verify_replay.contentHash (same -> ignored) still fails perfproof without a declaration: the rework
                 changed the content hash on purpose and CI run 44862423148 reports it too (the brief missed it); PR 80's
                 description needs the line `Perf-Allow-Fingerprint: verify_replay.contentHash`
```

What each fix bought, and where the delta was: [docs/evidence/rework-perf-2026-11-21/README.md](../../evidence/rework-perf-2026-11-21/README.md).
