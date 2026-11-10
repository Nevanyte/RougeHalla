# Unity rework: what the backend side needs to know before the final merge

From the Unity rework coordinator (Claude), 2026-11-10. This file lives on `feature/unity-rework`; read it from another worktree with
`git show feature/unity-rework:docs/coordination/CLAUDE_UNITY_REWORK_HANDBACK.md`. Direction and state: `docs/prompts/UNITY_REWORK_FABLE.md`,
`docs/prompts/UNITY_REWORK_STATE.md`, `docs/prompts/UNITY_REWORK_REPORT.md`.

Release sequence as the owner described it: backend (Codex, DeepSeek) and Unity (Claude) each finish and make their final merges and commits; an Opus
sub-agent then reviews the combined tree; if that review passes, Codex launches https://play.rougehalla.com. The Unity branch is not merged or pushed
until the owner approves its Gate 3 report.

## 1. A room-killing sim bug is only half fixed on `optimization_port` (take this now)

`optimization_port` at `4151b3af` carries my first patch (`attack_started` out of bounds in `frost::after_weapons`). That cured one panic only.
A second one in the same family still kills rooms on the full map with bots, typically about 100 s into a match:

- Symptom: `index out of bounds` at `crates/rh-sim/src/state.rs:1149` (`World::core`), room task panics, every client dropped.
- Cause: the ledger damage pass records each victim's fighter slot before it starts. If a Plague owner dies earlier in the same pass, the FighterOut
  hook removes the owner's zombie from the mob list, every later mob shifts down one slot, and a later victim points one past the end. When it does
  not panic, a victim behind the removed zombie silently takes its neighbour's hits.
- Fix on `feature/unity-rework`: `a1f1d129` (reacquire ledger victim slots by id; also replaces the first patch with a proper `attack_started`
  sizing fix in `weapons::update`) and `406279b3` (regression tests `crates/rh-sim/src/systems/fighter_churn_tests.rs` and a full-map soak
  `crates/rh-headless/tests/source_arena_soak.rs` plus `examples/source_soak.rs`).
- Evidence: 64 full-map bot matches (seeds 1-64) with zero panics; seeds 6, 17, 28, 42 and 62 panic on the unfixed code; the 31 seeds that completed
  before the fix give identical final hashes after it; parity-report all MATCH; reviewed independently by an Opus reviewer (correct in every ordering,
  no DEVIATIONS row needed).
- Reproduce on unfixed code: `cargo run --release -p rh-headless --example source_soak -- crates/rh-sim/src/mapdata/fixtures/seed1.map.json 6 7 6000`.
- Merging note: `a1f1d129` conflicts textually with `4151b3af` in `crates/rh-sim/src/systems/frost.rs` (it reverts the bounds-tolerant read in favour
  of the sizing fix). Resolve in favour of `a1f1d129`.

## 2. The Unity branch changes the wire and sim identity

On `rework/hitbox` (not yet merged into `feature/unity-rework`; review fixes in progress), per ADR 0024 on that branch:

| Identity | `optimization_port` | Unity rework |
|---|---|---|
| Protocol | 14 | 16 (15 is used by the unmerged `claude/peaceful-babbage-rtsgq6`) |
| Observation | 21 | 22 |
| Checkpoint | 29 | 30 |
| Replay | 23 | 24 |
| Policy contract | 15 | 16 |
| Content hash | `7c6a633f68c2cc72` | changes (archetype table folded in) |

What it adds: an archetype table in Welcome, archetype ids on actors and self, projectile height, and (being added) the vision parameters in Welcome.
Hitboxes default to `LegacyCircle`, so every existing parity scenario is byte-identical; `--hitboxes archetypes` opts a live runtime in. New fixtures:
`v16.json`, `archetypes_v1.json`, `pathfinding_v2.json`, `server_walk_v2.json`, `sight_v1.json`. One existing file changes:
`parity/abilities/hash-tape.json` (it pins the checkpoint tag, content hash and observation version).

Consequences for the backend side:
- **Version numbers.** If any backend branch bumps protocol, observation, checkpoint, replay or policy, the numbers collide. Numbers should rise in
  merge order; whoever merges second renumbers and regenerates fixtures.
- **Server and client must be built from the same tree.** The Web client bakes the server's content hash (`client-unity/UnityProject/Tools/build-web.sh`
  reads `/info`) and speaks one protocol version. A protocol-14 server cannot serve the reworked client and vice versa.
- **Rust touched by the Unity branch:** `crates/rh-sim` (new `archetype.rs` and geometry kernels; edits in `movement.rs`, `terrain/walk.rs`,
  `pathfind.rs`, `melee.rs`, `projectiles.rs`, `checkpoint.rs`, `observe.rs`; the ledger and weapons crash fixes; a test-only `vision/golden.rs`),
  `crates/rh-protocol`, `crates/rh-server` (wire, `--hitboxes` flag), `crates/rh-parity` (new golden bins and tests), `crates/rh-headless`
  (`--hitboxes`, soak), `crates/rh-policy` (contract 16). Quests, bots and cards code is not touched.

## 3. Suggested merge order

1. Backend branches merge into `optimization_port` first.
2. I merge `optimization_port` into `feature/unity-rework`, resolve, regenerate fixtures at the final numbers and re-run everything
   (`cargo test --workspace`, parity-report, `dotnet test`, JS vectors, browser proof, Unity EditMode, WebGL build and browser checks).
3. Owner approves Gate 3; `feature/unity-rework` merges into `optimization_port` (squash recommended: the branch history holds about 370 MB of old
   screenshot blobs that should not reach the public repo).
4. Opus final review of the combined tree, against the exact server flags, map and runtime that will be deployed.

## 4. What the final review will need from the backend side

- The final backend commit hash on `optimization_port`.
- The exact launch command for the beta (runtime, map, `--fill-bots`, `--hitboxes`, TLS and account API settings), so the review exercises what ships.
- Whether the hosted page and the game server share an origin: the client only offers the arena when the match server and the account API share an
  origin (`AccountConnectionPolicy`), otherwise the launch screen reports that no arena server is set up for the page.

## 5. Local processes that are not mine

I have left alone: rh-server PID 63281 on port 7777 and Unity Editor PID 9075 on `RogueHalla-unity-art`. My own test servers use ports 7787 and up.
