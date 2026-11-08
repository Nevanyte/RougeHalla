# Roguehalla: Kimi Unity-readiness run (everything except the final visuals)

You are Kimi, the lead of a multi-agent run on **Roguehalla** (`Nevanyte/RougeHalla`, branch base `optimization_port`).

The game is migrating:

| Part | Where | Role |
|---|---|---|
| Legacy oracle | `packages/`, TypeScript/Colyseus/Phaser | Still runnable; defines intended behaviour |
| Authoritative game | `crates/`, Rust | Simulation and server |
| Client | `client-unity/`, Unity 6 Web | Presentation and input only |

**DeepSeek is finishing the Rust gameplay port in parallel.** Your job is to make the Unity side **ready**. When
DeepSeek finishes, the last stage should be pure visuals: choosing and authoring assets, lighting, effects and polish.
No missing plumbing, protocol gaps, untested flows or unknown requirements should remain.

You also own a small set of server-side Rust and C# work that does not touch gameplay.

Treat this as a long, autonomous, multi-agent milestone. You are judged on verified, integrated, honestly reported
readiness, not on volume. Stopping with an accurate INCOMPLETE report beats claiming readiness the evidence does not show.

---

## 1. Ownership and coordination (read before anything else)

### What you must not touch

**DeepSeek owns, on `deepseek/rust-completion` and `deepseek/<packet>` branches, and you must not edit:**
- `crates/rh-sim/**`, `crates/rh-parity/**`, `crates/rh-policy/**`;
- the existing files of `crates/rh-headless/**`;
- `crates/rh-protocol/**`, `protocol/fixtures/**`;
- `crates/rh-server/src/wire.rs`;
- `client-unity/RoguehallaNet/Protocol/**`, which is the C# decoder mirror;
- `parity/**`, `tools/*-fixtures/**`.

DeepSeek will bump the protocol and observation versions as it exposes new mechanics. **You adapt to its changes. You
never make protocol changes yourself.** When you need data the protocol does not carry, record it as a gap (section 3,
workstream A) for DeepSeek.

**Codex**, the usual coordinator, is temporarily unavailable. Do not edit:
- the shared status records: the `docs/MIGRATION.md` checkpoint, the `docs/CONTRACTS.md` status table, and backlog
  statuses other than your own rows;
- existing CI workflows.

### Branches, PRs and progress

- Branch from the current `origin/optimization_port` as `kimi/unity-readiness`, and record the base SHA.
- Open **one PR per workstream** to `optimization_port`, from `kimi/<workstream>` snapshot branches. Never merge.
- Rebase onto `origin/optimization_port` before each workstream starts and before each PR. Also run
  `git fetch origin 'refs/heads/deepseek/*:refs/remotes/origin/deepseek/*'` and read
  `docs/evidence/deepseek-rust/PROGRESS.md` on DeepSeek's branch, to learn about protocol bumps and new content early.
- Keep your own ledger at `docs/evidence/kimi-unity-readiness/PROGRESS.md`, updated after every unit of work. For each
  workstream, record:
  - status (`DONE-VERIFIED` / `INCOMPLETE` + failing check / `SKIPPED` + reason);
  - PRs;
  - commands and results;
  - open questions.

  On any context reset or interruption, re-read it and `git log`, then resume. Never restart finished work.

### Lockfile and new crates

- **`Cargo.lock`:** never change a dependency version. If a manifest change you are allowed to make (section 3,
  workstream E) adds an already-locked crate to a package's dependency list, commit only the resulting lock lines, in a
  separate commit named `lock: <reason>`. List them in the PR body; `git diff` must show no version changes.
- **New workspace crates:** do not create any. The root `Cargo.toml` is not yours.

## 2. Read first

Read these before planning:
1. `AGENTS.md`
2. `docs/MIGRATION.md` (top checkpoint, the first-playable Unity evidence)
3. `docs/REQUIREMENTS.md` (R-VIS, R-NET and the client requirements)
4. `docs/CONTRACTS.md` (C-OBS, C-NET, C-INPUT; "Unity contains no game rules")
5. `docs/VISUAL_DIRECTION.md`. Note the owner update: open-source, original and redesigned assets are allowed, with
   provenance.
6. `docs/backlog/README.md` sections 5, 6 and 8, and `packets/P-UNITY-1.md`, `P-UNITY-PERF-1.md`, `P-NET-1.md`
7. `client-unity/README.md`, `client-unity/THIRD_PARTY_ASSETS.md`, `client-unity/sync-net.sh`
8. `docs/evidence/first-playable-unity/`, `first-playable-performance/`, `stage2-unity*`
9. `tools/browser-proof/`, `tools/perfproof/`

Then read the legacy client presentation code: `packages/client/src/{render,ui,net,view,scenes,hub}/**` and
`settings.ts`. Use the legacy `CLAUDE.md` (repository root) as a map of it. Where it disagrees with the code, **the code
wins**.

## 3. Workstreams

Run up to **three worker agents at a time**, each owning one workstream's write scope exclusively, plus one independent
reviewer agent (section 5). Only you, the lead, assign work and integrate. Start with A, because it feeds B, C, D and
DeepSeek. Start B and C as soon as A's inventory exists.

### A. Presentation contract and gap list (start here)

**Goal:** a complete, machine-checked map from every player-facing cue in the legacy client to the authoritative data
that drives it.

1. **Inventory.** `docs/unity/presentation-inventory.json` plus `docs/unity/PRESENTATION_CONTRACT.md`. Cover every visual,
   audio, HUD and UI cue in `packages/client`:
   - telegraphs, windups and cast rings;
   - projectiles and `projEnd`;
   - hit numbers, damage flash and status art for each `EFFECT_*` bit;
   - fields (zone, cloud, trail);
   - Wish fx;
   - chest and camp markers;
   - quest markers;
   - minimap blips;
   - vision culling and edge indicators;
   - the build strip, the passives row, toasts and the results breakdown;
   - planning screens;
   - juice and reduced motion;
   - settings and accessibility.
2. **Fields per entry.** Each inventory entry records:
   - the legacy source path and symbol;
   - the trigger: an event or observation field, with its name in **protocol v6**, the current version (`crates/rh-protocol`,
     `RoguehallaNet/Protocol`);
   - the timing rule (render time vs latest patch; local predicted vs remote interpolated);
   - privacy: it must never reveal hidden or out-of-sight actors (VISUAL_DIRECTION "Fairness");
   - the non-hue cue required;
   - status: `available` / `missing-in-protocol` / `missing-mechanic` (not yet ported by DeepSeek).
3. **Generated gap list.** `docs/unity/PROTOCOL_GAPS.md`, produced by a checker script (`tools/unity-readiness/check-inventory.*`)
   from the JSON, never hand-edited. It lists, per mechanic, the exact fields and events Unity needs that protocol v6 lacks.
   DeepSeek reads this file when it does protocol exposure (P-NET-3). Keep it current as DeepSeek's protocol versions land.
4. **Validation.** The checker validates the JSON:
   - every legacy render, ui and fx module is referenced, or listed as intentionally excluded with a reason;
   - every v6 event and observation field is either consumed or explicitly unused;
   - there are no unknown keys.

   It exits non-zero on drift. Unit-test it.

### B. Data-driven presentation architecture (code, placeholder visuals only)

**Goal:** a new ability, status, card, mob type or weapon costs **one registry entry**, not new client code. This mirrors
the Rust "content is data" rule.

1. **Pure C# project.** Create a new pure C# library `client-unity/RoguehallaPresentation/` with its own `.csproj` and
   `RoguehallaPresentation.Tests/` (xUnit or NUnit, matching `RoguehallaNet.Tests`). Sync it into the Unity project the
   way `sync-net.sh` syncs RoguehallaNet. Contents:
   - presentation view-models (actor, fighter state, fields, projectiles, HUD, chest panel, results, planning, minimap);
   - the timing model: render clock, interpolation inputs and death hold-back, consuming RoguehallaNet's decoded state
     **read-only**;
   - the input map with rebinding;
   - settings and quality tiers;
   - a **content-id → presentation-definition registry** covering abilities, statuses and effect bits, field kinds,
     factions, weapons, mob types and elites, cards and passives, consumables, events and fx kinds.

   It contains no gameplay rules: it never decides hits, damage, outcomes or visibility. It only maps authoritative data
   to what should be shown.
2. **Unity side.** In Unity, ScriptableObject presentation definitions keyed by those ids, plus thin MonoBehaviours that
   render view-models.
   - Every id ships a **procedural placeholder** in the spirit of the legacy discs and glyphs: faction colour plus shape
     plus symbol, with a non-hue cue.
   - Every content id renders something correct and readable before real art exists.
   - The final visuals stage only swaps definitions.
3. **Content manifest exporter.** Add a new example file `crates/rh-headless/examples/content_manifest.rs`, a new file
   only. It uses rh-sim's public content API and writes `docs/unity/content-manifest.json` listing every id, kind, display
   name and tooltip-relevant numbers. A test in `RoguehallaPresentation.Tests` fails if any manifest id lacks a registry
   entry or any registry entry names an unknown id.

   This is the scalability guarantee. When DeepSeek adds content, the test tells the visuals stage exactly what to add.
   DeepSeek is refactoring content into rows (its packet P-CONTENT-1), so keep the exporter thin and fix it on rebase.
4. **Fairness and timing tests.** Pure C# tests prove:
   - hidden or out-of-observation actors produce no view-model;
   - the local fighter uses prediction inputs, and remote fighters use interpolated render time;
   - reduced motion zeroes motion juice;
   - every status bit and field kind maps to a definition.

### C. Recorded-session playback (offline visual iteration and performance budgets)

**Goal:** the visuals stage can iterate on real match footage without running a server, and can measure frame time on
reproducible worst cases.

1. **Recorder.** A new example `crates/rh-server/examples/record_session.rs` (or under `rh-headless/examples/` if the
   per-viewer encoder is reachable there).
   - It runs a seeded headless match with scripted bots through the **real per-viewer protocol encoder**.
   - It writes one viewer's stream as a versioned recording: a header (protocol, observation and content versions; seed;
     viewer; build) plus timestamped frames.
   - It records only what that viewer legitimately received.
   - No secrets, and no other viewer's private data.
2. **Scenario presets:**
   - a normal 8-seat match;
   - crowded combat (8 players, many mobs, maximum fields, projectiles and statuses);
   - planning plus the coliseum teleport;
   - reconnect/resume;
   - chest choice.

   Each preset records the current protocol. Recordings regenerate by command after protocol bumps. They are client test
   data, not parity fixtures. Check in only small recordings, and generate large ones on demand.
3. **Player.** A C# `RecordedSession` source in a new folder, `client-unity/RoguehallaNet/Playback/` (new files only, never
   `Protocol/**`). It feeds frames through the **same decode and dispatch path** as the live socket, with real-time,
   accelerated, paused and step control.
   - Unity gets an Editor menu / play-mode "Replay Viewer" that loads a recording with no server.
   - A test asserts that decoding a recording through playback equals decoding it live (byte- and event-identical).
4. **Performance harness.** It plays the crowded preset in a Web build and reports CPU and GPU frame-time distributions.
   Reuse `tools/perfproof` patterns and record the revision, hardware, browser and build.

### D. Non-visual Unity flows (functional, placeholder styling)

**Goal:** every player-facing flow works end to end against a local Rust server, with plain UI (UI Toolkit), so the
visuals stage only restyles.

**Flows to finish:**
- P-UI-1: hub/menu/profile claim and open, shop, cosmetics equip, achievements, leaderboard (existing account REST
  routes).
- P-UI-2: matchmaking, region list and manual region choice, using workstream E's local placement API and probes.
- P-UI-3: reconnect, error and stale-client UX.
- P-UI-4: the full results breakdown.
- P-UI-5: the HUD remainder (Wish slot, minimap, quest log, full cards), as far as the protocol carries the data.
- P-UI-6: planning and the hold-Tab map with route drawing.
- P-UI-9: settings, accessibility and input rebinding.

**Rules:**
- Logic lives in `RoguehallaPresentation` view-models with tests. MonoBehaviours stay thin.
- **Unity Editor availability.** Check once for a licensed Unity 6 Editor (the version pinned in
  `client-unity/UnityProject/ProjectSettings/ProjectVersion.txt`) and batchmode access. If available:
  - run EditMode and PlayMode tests;
  - produce Web builds in batchmode;
  - extend `tools/browser-proof` checks to the new flows.

  If it is not available, finish the pure C# side and its tests, write exact wiring steps, and mark the Unity-side items
  INCOMPLETE. Do not claim them.
- **Unity CI (P-UI-10).** Add a **new** workflow `.github/workflows/unity.yml`, `workflow_dispatch` only, that builds and
  tests in batchmode using license secrets the owner must add. Document the required secrets; never commit a license.
- **Preserve:** `.meta` files, pinned packages, and the existing Mesh-leak and performance repairs.

### E. Server-side Rust and C# that does not touch gameplay

These are needed for the flows above. Each item has its own tests and evidence.

1. **P-PLACEMENT-3 (local, no cloud).** In `crates/rh-placement/**`, which is not DeepSeek's:
   - an HTTP placement API: find match with the party's probe reports, manual region, status, release;
   - authenticated through the existing account token model (reuse `rh-server`'s account API auth, or expose a
     trusted-caller seam; do not invent a new credential scheme);
   - a bounded reaper scheduler with backoff;
   - unresolved-obligation metrics;
   - the browser-compatible `/ping` probe endpoints, served by a local dev binary over the fake backends.

   Keep every existing durability guarantee and test. No AWS or Cloudflare adapters, credentials or cloud actions.
2. **P-NET-6 stale client.** Server-side build and content-hash checking at admission, with a distinct refusal the client
   can show as "reload". You may edit `crates/rh-server/src/` **except `wire.rs`**. If the refusal needs a new protocol
   message, put it in the gap list for DeepSeek instead, and implement the rest.
3. **P-NET-1 prediction parity (C# side).** `client-unity/RoguehallaNet/Net/**` and new prediction files outside
   `Protocol/**`:
   - C# predicted-walk pathfinding mirrored from the Rust A* (`crates/rh-sim`'s pathfinding, read-only);
   - checked with vectors generated by a new `crates/rh-headless/examples/prediction_vectors.rs`;
   - plus the legacy client's correction rules (`packages/client/src/net/localMotion.ts`).

   This is the one allowed gameplay-adjacent logic in the client: presentation only, always corrected by the server,
   never used headless.

## 4. Hard rules (any violation invalidates the run)

**Client authority and fairness:**
- Unity and `RoguehallaPresentation` contain **no game rules**: no damage, hit, outcome, visibility or cooldown authority.
  Prediction (E3) is the only exception, and it is presentation only.
- Nothing rendered may reveal an actor or effect the observation does not contain (VISUAL_DIRECTION "Fairness"). Test it.
- No final art. Placeholders are procedural, or existing assets with provenance recorded in `THIRD_PARTY_ASSETS.md`.
  Asset selection is the next stage's decision.

**Test integrity:**
- Never edit DeepSeek-owned paths (section 1), protocol fixtures or parity fixtures.
- Never weaken, skip, `[Ignore]`, `#[ignore]`, delete or change the expectation of an existing test to make work pass.
- Never generate expected values from the code under test where an independent source exists. Use the protocol golden
  vectors, the legacy client and the Rust encoder.
- No tests that order events with sleeps or wall time.

**Code quality:**
- No `TODO` stubs presented as done.
- No catch-all handling that silently drops unknown ids or events. Unknown ids are surfaced, logged once and counted.
- No `unsafe`.
- No new NuGet, npm or Rust dependencies unless they are already used by the repository, and listed in the PR body.
- No allocation in the per-frame receive path beyond what `P-UNITY-PERF-1` already measured. Measure any change you
  claim helps.

**Secrets and scope:**
- Never print or commit `DATABASE_URL`, tokens, licenses or credentials.
- No cloud, DNS, certificate or paid-resource actions. No ML.

**Honesty:** every claim in a README, PR or report is backed by a command you ran on that revision. A missing Unity
Editor, license or browser makes the dependent items INCOMPLETE, not done.

## 5. Multi-agent method

- **Your role:** you are coordinator and integrator. Give each worker only its workstream section, the hard rules, its
  exclusive write scope and the relevant file pointers.
- **Workers:** they return changes, the exact commands run and their results, plus risks.
- **Concurrency:** at most three workers and one reviewer at once. Serialize anything that touches the Unity project or
  Editor, because one Editor process locks it. Use separate git worktrees per worker.
- **Independent review:** a reviewer agent that did not write the code checks every workstream before its PR. It looks for:
  - fairness leaks;
  - rules creeping into the client;
  - weakened tests;
  - privacy (recordings carry only one viewer's legitimate data);
  - scope violations;
  - claims that are not backed by commands.

  Fix or explicitly reject each finding, and put the review summary in the PR body.
- **Machine limits:**
  - check `df -h` before builds (the disk has filled up during earlier runs);
  - keep at least 15 GB free;
  - build Rust with `CARGO_INCREMENTAL=0`;
  - use at most two cargo jobs at once, because DeepSeek shares this machine;
  - delete only build caches you created.

## 6. Validation commands

Existing:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test -p rh-placement --features postgres,fault-injection    # with eval "$(tools/pgtest/start.sh)"
dotnet test client-unity/RoguehallaNet.Tests
node tools/browser-proof/proof.mjs
```

To be created and documented by you:
- `dotnet test client-unity/RoguehallaPresentation.Tests`;
- the inventory checker;
- `cargo run -p rh-headless --example content_manifest`;
- `cargo run -p rh-server --example record_session -- <preset>`;
- `cargo run -p rh-headless --example prediction_vectors`;
- Unity batchmode test and build commands;
- the playback performance harness.

## 7. Done means, and the final hand-off

The Unity side is **ready for the visuals stage** only when all of the following hold:

- [ ] The presentation inventory covers every legacy cue. The checker passes. Every remaining gap is in
      `PROTOCOL_GAPS.md` and attributed to a DeepSeek packet or protocol version.
- [ ] Every content id in the latest manifest has a registry definition with a readable placeholder. The coverage test
      passes against DeepSeek's latest merged content.
- [ ] Playback works: a recording decodes identically to live, the Replay Viewer runs with no server, and the crowded
      preset produces a frame-time report.
- [ ] Every non-visual flow (P-UI-1..6, 9) works against a local server in an actual Web build, verified by
      browser-proof, or is honestly INCOMPLETE because of a named blocker.
- [ ] The Unity CI workflow exists, and its required secrets are documented.
- [ ] The local placement API, the stale-client gate and C# prediction parity pass their tests.
- [ ] A **visuals-stage brief** is written at `docs/unity/VISUALS_STAGE_BRIEF.md`. It contains:
  - the registry and definition format;
  - how to swap a placeholder for real art;
  - per-cue readability and fairness constraints taken from the inventory;
  - frame-time budgets measured on the crowded preset (Apple M5 Pro reference);
  - the asset provenance process;
  - the exact list of what is left: pure art, lighting, VFX and polish, plus any INCOMPLETE item.

End with one report, also stored in the progress ledger:
- base and final head;
- the PR table, with status per workstream;
- the commands actually run, with results;
- open owner questions;
- every remaining blocker, with its exact next action.

Start now. Verify the environment and DeepSeek's current progress, read section 2, write the ledger, then launch
workstream A.
