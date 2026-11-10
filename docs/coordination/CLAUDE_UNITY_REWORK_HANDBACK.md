# Unity rework: what the backend side needs to know before the final merge

From the Unity rework coordinator (Claude). Last updated 2026-11-10 (late). This file lives on `feature/unity-rework`; read it from another
worktree with `git show feature/unity-rework:docs/coordination/CLAUDE_UNITY_REWORK_HANDBACK.md`. Direction and state:
`docs/prompts/UNITY_REWORK_FABLE.md`, `docs/prompts/UNITY_REWORK_STATE.md`, `docs/prompts/UNITY_REWORK_REPORT.md`.

Release sequence as the owner described it: backend (Codex, DeepSeek) and Unity (Claude) each finish and make their final merges and commits; an
Opus sub-agent then reviews the combined tree; if that review passes, Codex launches https://play.rougehalla.com. Nothing on the Unity branch has
been pushed. The owner pre-approved a local squash merge once every check and the final review pass; `optimization_port` is checked out in the
backend worktree, so that merge has to be made from there (section 3).

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
  before the fix give identical final hashes after it; parity-report all MATCH; reviewed independently by an Opus reviewer.
- Reproduce on unfixed code: `cargo run --release -p rh-headless --example source_soak -- crates/rh-sim/src/mapdata/fixtures/seed1.map.json 6 7 6000`.
- Merging note: `a1f1d129` conflicts textually with `4151b3af` in `crates/rh-sim/src/systems/frost.rs` (it reverts the bounds-tolerant read in favour
  of the sizing fix). Resolve in favour of `a1f1d129`.

## 2. The Unity branch changes the wire and sim identity

All of this is merged on `feature/unity-rework` (records: ADR 0024 hitbox archetypes and mob spacing, ADR 0026 legacy indicator facts; ADR 0025
lingering tracks is design only).

| Identity | `optimization_port` (`4151b3af`) | `feature/unity-rework` |
|---|---|---|
| Protocol | 14 | 16 (15 is used by the unmerged `claude/peaceful-babbage-rtsgq6`) |
| Observation | 21 | 23 |
| Checkpoint | `rh-checkpoint/29` | `rh-checkpoint/30` |
| Replay | `rh-replay/23` | `rh-replay/24` |
| Policy contract | 15 | 17 |
| Content hash | `7c6a633f68c2cc72` | `06e2cdab2889abc5` |

What changed in behaviour:
- **Hitboxes (ADR 0024).** `HitboxMode::{LegacyCircle, Archetypes}`. Every live runtime now defaults to `Archetypes` (owner accepted the risk,
  DEV-009/DEV-010); `--hitboxes legacy` restores the legacy circle; parity runs `LegacyCircle` and is byte-identical (parity-report all MATCH).
  Foot box for walls and pathfinding, body box for hits, shots fly at chest height.
- **Mob spacing (DEV-011).** Under `Archetypes` mobs keep hit-box room: a resting pack of any size comes to rest without overlapping where room
  exists, and a chasing pack fans out. `SimConfig::mob_spacing` is a runtime switch (`Off` is measurement only; the server refuses to host it).
- **Vision block and weapon table in Welcome**; archetype ids on actors and self; projectile height.
- **Legacy indicator facts (ADR 0026)**, append-only on protocol 16: per-actor flags (Wish ready, mob engaged, teleport immunity, Fire roam
  ready), off-hand weapon, top-two build stats, mark plate; fx Windup, Cancel, SigHit, Heal, crit flag on Hit; event CampCleared; State key 12
  Roster (names and bot flag of every seated player, as legacy did: this widens C-OBS on purpose and needs the owner's wording in CONTRACTS).
- **DEV-012:** build marks omit the unported Holy camp-lifesteal term.

Fixtures added or changed: `protocol/fixtures/v16.json`, `archetypes_v1.json`, `pathfinding_v2.json`, `server_walk_v2.json`, `sight_v1.json`,
`parity/build-marks/legacy.json`, `parity/abilities/hash-tape.json` (pins checkpoint tag, content hash and observation version). A
`ranged_pause_v1.json` fixture is in progress (client prediction of the server's own attack pause; no sim or wire change intended).

Consequences for the backend side:
- **Version numbers.** If any backend branch bumps protocol, observation, checkpoint, replay or policy, the numbers collide. Numbers should rise in
  merge order; whoever merges second renumbers and regenerates fixtures (`cargo run -p rh-protocol --bin protocol-fixtures`).
- **Server and client must be built from the same tree.** The Web client bakes the server's content hash (`client-unity/UnityProject/Tools/build-web.sh`
  reads `/info`) and speaks one protocol version. A protocol-14 server cannot serve the reworked client and vice versa.
- **Rust touched by the Unity branch:** `crates/rh-sim` (`archetype.rs`, geometry kernels, `movement.rs`, `terrain/walk.rs`, `pathfind.rs`,
  `melee.rs`, `projectiles.rs`, `checkpoint.rs`, `observe.rs`, `events.rs`, `kill_augments.rs`, `fx_report.rs`, `systems/mob_ai.rs`,
  `systems/mob_spacing.rs`, the ledger and weapons crash fixes, test-only `vision/golden.rs`), `crates/rh-protocol`, `crates/rh-server` (wire,
  `--hitboxes`, runtime defaults), `crates/rh-parity` (golden bins and tests), `crates/rh-headless` (`--hitboxes`, soak, `hitbox_compare`),
  `crates/rh-policy` (contract 17, delivery projection). Quests, cards and bot brains are not touched.
- **Tools that pin the old identity:** `tools/unity-browser-reload-proof` pins protocol 14, `protocol/fixtures/v14.json` and content hash
  `7c6a633f68c2cc72`; it is yours and needs repinning after the merge. `tools/protocol-js/check-first-playable.mjs` already failed before the
  indicator work (its projectile rows lack the height byte).

## 3. Suggested merge order

1. Backend branches merge into `optimization_port` first.
2. I merge `optimization_port` into `feature/unity-rework`, resolve, regenerate fixtures at the final numbers and re-run everything
   (`cargo test --workspace` with Postgres, parity-report, clippy, `dotnet test`, JS vectors, browser proof, Unity EditMode, WebGL build and
   browser checks).
3. `feature/unity-rework` merges into `optimization_port` as ONE squash commit (owner pre-approved, local only, no push). Squash matters: the
   branch history holds about 370 MB of old screenshot blobs that must not reach the public repository. Run it in the worktree that has
   `optimization_port` checked out: `git merge --squash feature/unity-rework && git commit`.
4. Opus final review of the combined tree, against the exact server flags, map and runtime that will be deployed.

## 4. What the final review will need from the backend side

- The final backend commit hash on `optimization_port`.
- The exact launch command for the beta (runtime, map, `--fill-bots`, `--hitboxes`, TLS and account API settings), so the review exercises what ships.
- Whether the hosted page and the game server share an origin: the client only offers the arena when the match server and the account API share an
  origin (`AccountConnectionPolicy`), otherwise the launch screen reports that no arena server is set up for the page.

## 5. Wanted later (owner, 2026-11-10): not for the beta

- **Bot stand-off.** Fill bots run onto their target's exact position and chase it (fighters do not collide), so a melee bot overlaps the player
  and reads as a doubled character model. The owner wants bots to stop at about weapon reach in a later development cycle. It is a bot-brain
  change (`crates/rh-policy/src/bots`), best done like mob spacing: `Archetypes` mode only, legacy parity untouched, independent review.
- **Second-tier indicator facts** (ADR 0026 rows B14 to B19: quest carrier actor id, camp buff badge, camp territory, camp wards, champion HUD
  attack and passive numbers, own mob-stat counts): deferred; the client uses simple stand-ins for the beta.
- **Server-side lingering tracks** (ADR 0025): tracks stay client-side.
- **Holy camp-lifesteal passive** is not ported (DEV-012).

## 6. Local processes that are not mine

I have left alone: rh-server PID 63281 on port 7777, the rh-server on 7779, and the Unity Editor under `.codex/tools/rougehalla-stage2`. My own
test servers use ports 7787 and up.
