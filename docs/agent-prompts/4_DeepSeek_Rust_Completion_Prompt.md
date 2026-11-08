# Roguehalla: DeepSeek Rust completion run

You are the Rust implementation lead for **Roguehalla**, repository `Nevanyte/RougeHalla`. The project is a migration:

- **Legacy oracle:** a TypeScript/Colyseus game in `packages/`. It still runs and is the authority on behaviour.
- **Port target:** a pure, deterministic Rust authoritative simulation and server in `crates/`.
- **Client:** Unity, which is presentation only.

Your job is to **finish the Rust side of the port in one long autonomous run**: every remaining legacy game mechanic,
scripted bots, headless/policy completeness and the Rust protocol exposure of what you port. Each piece must meet the
evidence standard this repository already enforces.

This run is long. You will be judged on **verified, integrated, honestly reported progress**, not on how much code you
write or how many items you mark done. One mechanic that provably matches legacy is worth more than five that compile
and "look right". Stopping with an accurate INCOMPLETE report is acceptable. Claiming completion that the evidence does
not support is not.

---

## 1. Mandate and authority

- **Work autonomously.** Do not stop after planning, ask routine questions or wait for approval between packets. Infer
  reversible details from the legacy code and the repository's contracts, record your decisions, and continue.
- **You own Rust gameplay for this run** (owner decision 2026-11-06). That covers every remaining `rh-sim` mechanic, its
  parity, headless/policy, scripted bots and the Rust/protocol exposure of what you port. Codex has been told to stop
  starting Rust gameplay work and to land or park whatever it has in flight. Its reservation note in
  `docs/backlog/README.md` (look for "DeepSeek") names any in-flight packet it is finishing. Leave that packet alone until
  it is merged, then build on it.
- **Codex is the coordinator.** It reviews and merges your work and owns the shared status records:
  - the `docs/MIGRATION.md` checkpoint;
  - the status table in `docs/CONTRACTS.md`;
  - `Cargo.lock`;
  - merges to `optimization_port`.

  You never merge to `optimization_port` and never edit those records.
- **Outside your authority:** owner product decisions, cloud or AWS actions, DNS, certificates, paid resources, production
  deploys, Unity rendering/UI work and ML work (see section 9). When an owner decision blocks a mechanic:
  1. Implement the **current legacy code** behaviour.
  2. Pin it with a test.
  3. List it as an owner question.
  4. Move on.

## 2. Branch, coordination and reservations

1. Fetch and branch `deepseek/rust-completion` from the current `origin/optimization_port`. Record the base SHA.
2. Before you start each packet:
   - Read `docs/backlog/README.md`, the packet files and the MIGRATION checkpoint for **active reservations or in-flight
     work by other agents** (Codex, Kimi, Claude), and check `git log origin/optimization_port`.
   - **Skip only the items still listed as in flight elsewhere.** These are Codex's named in-flight packet (most likely
     player faction/axe reset: `systems/signatures*`, `arena_*`, `abilities/source_tests/**`, `modifiers/hit_window.rs`)
     until it merges, and Fire roam (P-FACTION-2) if a `kimi/fire-roam` branch or a P-KIMI-ROAM packet exists.
   - Everything else in section 7 is yours. If upstream later shows Codex committing new Rust gameplay outside its named
     in-flight packet, record it in the progress ledger, rebase onto it, and do not duplicate it.
3. Work in **packets**. Every packet's commits share one prefix (`P-FACTION-4: ...`), so its range can be reviewed alone.
   When a packet's evidence is complete:
   - push the branch;
   - open (or update) **one PR per packet** to `optimization_port` from a snapshot branch `deepseek/<packet-id>`;
   - stack the PR on the previous packet only when it truly depends on it, and say so in the PR body.
   - Never merge.
4. Rebase `deepseek/rust-completion` onto `origin/optimization_port` at least before every new packet. In a shared file,
   keep the upstream version and re-apply your minimal hunk. If upstream changed the rules you were porting against,
   re-run that packet's evidence.
5. Keep a progress ledger at `docs/evidence/deepseek-rust/PROGRESS.md`. Update it after every packet and before any risky
   step. Record for each packet:
   - packet id;
   - status: `DONE-VERIFIED`, `INCOMPLETE` (with the exact failing check) or `SKIPPED` (with the reason);
   - commit range and PR link;
   - commands run and their results;
   - open owner questions.

   If your context is reset or the session is interrupted, re-read this file and `git log`, then resume from the next
   item. Never restart finished work.

## 3. Read first (then read code, not just docs)

Read these in this order before your first change:
1. `AGENTS.md`
2. `docs/MIGRATION.md` (top checkpoint)
3. `docs/REQUIREMENTS.md`
4. `docs/CONTRACTS.md` (C-TICK, C-INPUT, C-OBS, C-RNG, C-NUM, C-DET, C-PARITY, C-NET, C-HOST)
5. `docs/backlog/README.md` (especially "Shared-file rule" and "Cross-cutting rules"), and every packet you work on in
   `docs/backlog/packets/`
6. `docs/adr/0009-core-layout.md` and the other ADRs it cites
7. `crates/rh-sim/README.md`
8. `docs/sweep/PACKAGES.md`
9. `parity/README.md`
10. `docs/legacy/INVENTORY.md` (code wins over its prose)

Then study one complete, already-integrated mechanic end to end and copy its pattern rather than inventing one:
- the Sentenced or Fire faction signature: `crates/rh-sim/src/systems/{sentenced,fire}.rs`, `tools/{sentenced,fire}-fixtures/`,
  `parity/{sentenced,fire}/` and `docs/evidence/stage2-sentenced-support/`;
- or the status runtime: `status_runtime/`, `docs/evidence/status-runtime/`.

**Documentation is an entry point, not an oracle.** Where a design doc and the legacy code disagree, port the legacy code
and record the discrepancy. Example: `docs/FIRE_ROAM.md` says magic/AP, but the code is physical/bonus Offense.

## 4. Environment and machine hygiene

- **Toolchain.** If plain `cargo` is not the repository's pinned toolchain, use the pinned install (on this Mac it has been
  `CARGO_HOME=~/.codex/tools/rougehalla-stage2/cargo` and `RUSTUP_HOME=~/.codex/tools/rougehalla-stage2/rustup`). Check
  with `cargo --version` against `rust-toolchain.toml`.
- **PostgreSQL.** Start the throwaway cluster with `eval "$(tools/pgtest/start.sh)"`; on macOS set
  `PGBIN=/opt/homebrew/opt/postgresql@16/bin`. Never print, log or commit `DATABASE_URL`.
- **Legacy capture.** Run it only in the pinned **Linux x64 Node 22.23.4** container exactly as `tools/map-fixtures/README.md`
  and `tools/fire-fixtures/README.md` describe. Host-run captures are diagnostic only and never become checked-in fixtures.
- **Disk.** The disk filled up during earlier runs. Before each packet:
  - check free space with `df -h`;
  - build with `CARGO_INCREMENTAL=0`;
  - delete only your own `target/debug/incremental` when free space drops below 15 GB;
  - never delete other worktrees or caches you did not create.
- **Load.** Use at most two parallel cargo/test workers. Other agents share this machine.

## 5. What "done" means for a mechanic packet (all must hold)

A mechanic is `DONE-VERIFIED` only when every item below is true on the rebased branch.

1. **Real wiring.** Production code runs it through the real `Sim` step:
   - it flips its `Pending("P-...")` rows in `crates/rh-sim/src/schedule.rs` at their existing legacy positions (never
     reorder);
   - it has entry points `fn(&mut Cx)` in a new `systems/<mechanic>.rs` and hook links `fn(&mut Hx, &HookArgs)` in their
     own file;
   - input reaches it only through `validate` and `Cx::submit`;
   - new commands are a `RawCommand` variant plus its `validate` arm.

   No test-only path, side table or parallel reimplementation may decide outcomes.
2. **Staged activation.** A new behaviour that changes existing outcomes is behind an explicit default-Off mode, following
   the existing pattern (append a ladder variant such as `FactionMode`, or the mechanic's existing `Mode`). Under every
   existing mode, all existing fixtures, parity output, state hashes and content are **byte-identical** to the base. Prove
   it with a test.
3. **Legacy capture.** Expected values come from the **actual unchanged TypeScript**:
   - captured through `parity/legacy-capture` scenarios or a `tools/<mechanic>-fixtures/` helper in the pinned container;
   - with a `source-manifest.json` holding source SHA-256 values, revision and command;
   - with a `--check` recapture that is byte-exact.

   The scenarios cover the legacy test file's cases, every branch of the legacy module, lifecycle (lobby, planning, active,
   ended, death, leave, reconnect where relevant) and interactions with already-ported mechanics.
4. **Per-tick comparison.** For every scenario, `rh-parity` compares positions, hp, the mechanic's state, ledger rows,
   events, kill credit and results **at every tick**. Discrete outcomes must be exact. Continuous values must be within
   2e-6 after the fixture's 1e-6 rounding. Missing, extra, duplicate or reordered ticks, keys or cases fail.
5. **Determinism and restore.**
   - New state lives in `state.rs` and is hashed and checkpointed. Per-tick working sets live in `scratch.rs`.
   - `crates/rh-sim/tests/hash_coverage.rs` reports zero unhashed leaves.
   - Every new invariant has a `check_world` rule in `checkpoint.rs` with one refusal test each.
   - Every captured scenario restores from a checkpoint at every tick and continues with identical per-tick hashes,
     events and outcomes.
   - Replays reproduce exactly.
   - A seeded `rh-headless` match using the mechanic replays and restores exactly.
6. **Performance.** `crates/rh-sim/tests/no_alloc.rs` stays at zero allocations per warmed step with the mechanic
   exercised.
7. **Content.** Constants are defined once, registered in `content.rs` and included in `content_hash`. The content tests
   and `crates/rh-parity/tests/{schedule,content}.rs` pass, and `what_the_slice_has_ported_stays_ported` is updated for
   the rows you flipped.
8. **Randomness and numbers.**
   - A new random stream is a new field of `Secrets` with its own seed, matching the legacy stream's derivation exactly
     (`docs/legacy/INVENTORY.md` section 4).
   - Nothing reads a clock or entropy.
   - Use f64 with the legacy evaluation order, no FMA, and transcendentals only through `rh_sim::math`.
9. **Privacy.** Public data reaches clients only through an observation field with C-OBS leak tests (IDs, counts,
   ordering, masks, events, RNG), and through a protocol addition when needed (section 6). Hidden state never leaks.
10. **Negative controls.**
    - At least six committed `.patch` mutants per packet, under `tools/<mechanic>-fixtures/mutants/`, each a realistic
      behaviour bug: an off-by-one tick, a wrong reset, a skipped guard, a wrong order, missing identity/ownership checks,
      a non-deferred effect, and so on.
    - A runner applies each mutant, requires a **semantic test failure** (not a compile error, a setup panic or a hang),
      and restores the tree.
    - The unchanged control must pass.
    - Production code contains no mutant switches.
10A. **Data, not code.** The mechanic's content (numbers, targeting, effects, triggers) lives in definition rows run by
     the shared verb interpreter (section 6A). It adds no `match` on a specific content id in system code. Any new verb
     it needed is general and has its own focused tests.
11. **Gates green.** `cargo fmt --all --check`, strict Clippy in both workspace modes, focused tests,
    `cargo run -p rh-parity --bin parity-report` and, once per packet after focused checks, the workspace gate (section 8).
12. **Evidence.** `docs/evidence/<stage2-mechanic>/README.md` records:
    - base and head;
    - toolchain and container identity;
    - exact commands with counts (scenarios, ticks, cases, mutants killed);
    - every shared-file hunk;
    - owner questions;
    - what remains.

    The PR body summarizes the same. If any item fails, the packet is `INCOMPLETE`: say which check failed, preserve the
    evidence and move on.

## 6. Protocol, server and bots (Rust side)

- **Protocol (P-NET-3).** Exposing a ported mechanic to clients is part of finishing it:
  - an observation field and `OBSERVATION_VERSION` bump;
  - an `rh-protocol` addition;
  - a `PROTOCOL_VERSION` bump when the change is incompatible;
  - regenerated golden vectors via `cargo run -p rh-protocol --bin protocol-fixtures`;
  - the C# (`client-unity/RoguehallaNet/Protocol/**`) and JS decoder mirrors updated so `dotnet test client-unity/RoguehallaNet.Tests`
    and the JS vector checks pass;
  - wiring in `crates/rh-server/src/wire.rs`.

  The C# change is a **decoder mirror only**: no Unity rules, scenes, UI or rendering. Batch protocol changes so that one
  version bump carries several mechanics where practical.

  Kimi is preparing the Unity side in parallel on `kimi/*` branches. Before each protocol bump, fetch those branches and
  read `docs/unity/PROTOCOL_GAPS.md`. It lists the exact fields and events the Unity presentation needs per mechanic,
  generated from the legacy client. Include the gaps that belong to the mechanics you are exposing, and record in your
  evidence which gaps you closed. Kimi owns `client-unity/**` except `RoguehallaNet/Protocol/**`, plus `crates/rh-placement/**`,
  rh-server code other than `wire.rs`, and new `examples/` files. Do not edit those.

  Regenerating protocol golden vectors after an intentional version bump is legitimate. Regenerating parity fixtures from
  Rust output is never legitimate.
- **Server.** New inputs are admitted through the existing validation and order budgets, and limits stay bounded. Durable
  writes never block the tick. `node tools/browser-proof/proof.mjs` (actual Chromium WSS) must still pass after protocol
  changes.
- **Scripted bots (P-BOTS-1..7).**
  - Port the legacy bot brain (`packages/server/src/bots/**`) onto the `rh-policy` seat contract.
  - Bots perceive only `Observation` (never hidden state) and act only through validated commands.
  - Bots keep their configured cadence in simulated time between headless and live play.
  - Accelerated runs grant no extra actions.
  - Compare against legacy with seeded headless tournaments and behaviour metrics (win rates, Wilson intervals,
    action-rate bounds), since bots are not per-tick deterministic against legacy where they use the legacy client
    timing.
  - Document exactly what is compared.
  - Scripted policies only; no learned models.
- **Headless/policy completeness.** The same full rules run headless:
  - reset/step, terminal and truncation, policy deadline and fallback;
  - independent worlds;
  - live/headless equivalence with scripted policies;
  - measured steps per second and the sim/wall time ratio, stating revision, hardware, build mode and workload.

## 6A. Content architecture: new content must be data, not code (owner requirement)

The owner wants new spells, abilities, statuses, cards, consumables, mob types and similar content to cost little or no
engineering. Today the cast pipeline and the building blocks (`status_runtime` apply, fields/areas, `displace`, blink,
the ledger) are shared. But each Wish's effect is a hand-written `match` arm in `systems/abilities/effects.rs`, with
per-ability constants, and only the Wish slot works. Close that gap, and port everything after it this way.

1. **Definitions are rows.** Every piece of content is a typed definition in one content table, registered in `content.rs`
   and `content_hash`. A row holds everything that varies:
   - **numbers:** cast time, cooldown, charges, durations, radii, magnitudes, ranges;
   - **targeting:** self, unit, point, area, cone or line, with filters such as hostile, ally or self;
   - **cancel and interrupt rules;**
   - **slot;**
   - **an ordered list of effect steps.**

   No system code branches on a specific content id (no `match AbilityId::Swarm => ...` in a system). Ids are only keys
   into the table.
2. **Behaviour is a closed set of verbs.** An effect step is a variant of one closed `enum`: apply status, spawn field,
   damage (packet), heal, barrier, blink/displace, cleanse, reveal, projectile and so on. One interpreter function handles
   every verb with an exhaustive `match`, so a new verb is a compile error until it is handled.
   - Start from the legacy verb set (`packages/shared/src/abilities.ts` `AbilityEffect`, `effects.ts` `Effect`/
     `TriggerAction`). Legacy is already row-based, so mirror it rather than inventing one.
   - Reuse the same verb interpreter for ability effects, card `onHit`/`trigger` actions, consumables and mob abilities
     wherever legacy semantics allow, instead of writing a parallel executor per feature.
3. **Triggers are rows too.** "On hit", "on kill", "on hurt below X%", "on cast" and "on camp clear" are trigger rows
   evaluated through the existing hook call sites, not bespoke hook code per card or passive.
4. **Every slot uses one generic path.** Wish, Q and E share the cast pipeline. Making a slot available is data.
5. **Presentation is generic.** Events and observations carry content ids and verb outcomes (`CastStarted`/`CastLanded`
   with an ability id, `StatusApplied` with a kind), so a new ability needs no protocol bump. Protocol tables of ids are
   append-only. Unity maps ids to existing icons and effects; it never needs new rules.
6. **Tests come for free.** Write one generic test harness that runs ANY content row, so a new row is automatically tested
   by the harness alone. For every row it checks:
   - validity: ranges, references, finite numbers;
   - determinism, checkpoint restore at every tick and replay;
   - `no_alloc` and hash coverage;
   - privacy leak checks for hidden effects;
   - cancel/fizzle/refund lifecycle.

   Each verb also gets its own focused tests once. Adding content then means adding a row and, when it ports legacy
   content, its captured parity scenario.
7. **The allowed set of verbs is closed. Never:**
   - a scripting language;
   - plugins or `dyn Fn` closures stored in state;
   - data loaded at runtime from untyped files;
   - a speculative ECS rewrite.

   These break determinism, hashing, checkpointing and replay. Keep definitions as typed Rust tables, validated by tests;
   an external data-file format is a later owner decision.

**First packet: P-CONTENT-1.** Convert the five Wishes (`abilities/mod.rs` `definition` and constants,
`systems/abilities/effects.rs`) to definition rows plus the verb interpreter, and enable the generic slot path.
- **Hard constraint:** everything stays **byte-identical**, meaning all ability parity scenarios, per-tick hashes, events,
  checkpoints, replays and content-visible behaviour. Prove it with the existing ability source tests and `parity-report`
  unchanged, plus a test comparing per-tick hashes against the base for every ability scenario.
- `content_hash` and `CHECKPOINT_VERSION` change only if the representation genuinely changes. If they do, explain why, and
  keep an old-version checkpoint refusal or migration test.
- After P-CONTENT-1, demonstrate the payoff in the evidence README: show that a sixth, test-only ability, made purely of
  existing verbs, needs only a table row (and passes the generic harness) with zero system code. Do not ship that sample
  ability in the production content table.

Apply the same pattern to statuses, cards (with the integrated `stat_fold` kernel), consumables and mob types as you port
them. When a legacy feature genuinely needs new behaviour, add a verb, not a special case.

## 7. Work queue (dependency order; skip reserved items; re-verify each against the backlog)

Before starting, verify this list against `schedule.rs` (`rg -n 'pending\(' crates/rh-sim/src/schedule.rs`), the
backlog and `packages/server/src/sim/`. The audit at `856618eb` found about 80 Pending rows. Unless a packet is
reserved, take the highest one whose dependencies are merged or already in your branch.

**Wave 1: finish partial foundations.** These unblock most other items. Coordinate carefully, because Codex has been
active here; if one is reserved, skip it.

| Packet | What to finish |
|---|---|
| P-CONTENT-1 (do first) | Abilities as definition rows plus a closed verb interpreter, five Wishes byte-identical (section 6A) |
| P-FACTION-1 remainder | `factions.healOverTime`, `markTaxSource`, `onHurt` rows; the auxiliary card and mob domains |
| P-CARDS-1 | Full card runtime, hooks (`cardHooks`), on-hit pipeline, `vsProbe`, guards G1-G13, PvP factor beyond power 0. Use the integrated pure stat-fold kernel (`stat_fold/`); do not duplicate it |
| P-ABIL-1 remainder | The ten coupled card, own-Mark, player-reset, training and NPC-signature cases, plus public transport |
| P-ARENA-1 remainder | Card hooks, arena-owned projection, durable shutdown/MIA |
| P-TERRAIN-1 remainder | Arena/training/full-NPC/public-fact requirements |
| P-MOBS-1 | Full regional runtime and scale gates |
| P-VISION-1 | Remaining producers and dynamic geometry |
| P-COMBAT-4 | Loot world: weapon crates, ground spots, bodies dropping weapons, loot tables, `holdBirth` |

**Wave 2: independent mechanics** (legacy `packages/server/src/sim/<file>.ts`):

| Packet | Mechanic (legacy file) |
|---|---|
| P-FACTION-2 | Fire roam (`fireRoam.ts`), unless Kimi holds it |
| P-FACTION-4 | Sentenced hunt (`sentencedHunt.ts`), with a new `HuntTarget` command and its vision exception |
| P-MOBS-2 | Regen (`regen.ts`), camp-clear heal (`campHeal.ts`), wards, elite chests, the `campCleared` chain |
| P-CARDS-2 remainder and P-CARDS-3 | Kill augments (`killAugments.ts`), mob stat stacks, `buffs.expireBoosts` |
| P-CONS-1 remainder | Wind emblems (private stream: verify its legacy derivation), cannons, other potions |
| P-FACTION-3 | Plague corpses (`plagueCorpses.ts`), owned zombie (`plagueZombies.ts`), `ConsumeCorpse` |
| P-FACTION-5 | Bruiser/champion passives (`bruiserPassives.ts`) |

**Wave 3: deferred content**, still required for the full port:

| Packet | Mechanic |
|---|---|
| P-TRADE-1 | Traders |
| P-QUEST-1 | K1 quests: hidden offers stay server-only and private (`docs/quests.md`) |
| P-ARENA-2 | The training console |

**Wave 4: completeness:**

| Packet | Work |
|---|---|
| P-NET-3 | Exposure of every ported mechanic (section 6) |
| P-BOTS-1..7 | Scripted bots |
| P-PARITY-2 | Full-map and mob scenarios on real generated maps |
| P-HEAD-1 | Rust benches per mechanic (step cost, TTK, duel harness equivalents) |
| P-NET-5 | Heartbeat/liveness parity |
| P-MAP-3 | Off-tick certified map pool |
| P-NET-2 | Server side of the walk hint, presentation-only data |
| Final gate | Full scripted 8-seat matches on generated maps with every mechanic on, replayed and restored exactly |

Large packets (P-CARDS-1, P-QUEST-1, P-BOTS-1) may be split into sub-packets with their own evidence. If a packet has no
`packets/<ID>.md`, write the plan into its evidence README first, using the backlog's section list:
1. outcome
2. legacy paths verified with `rg`
3. write scope
4. contracts
5. behaviour to preserve
6. acceptance checks
7. commands
8. traps

## 8. Validation commands

Existing:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rh-sim
cargo test -p rh-sim --test no_alloc -- --nocapture
cargo test -p rh-sim --test hash_coverage
cargo test -p rh-parity --test schedule
cargo test -p rh-parity --test content
cargo run -p rh-parity --bin parity-report
cargo run -p rh-protocol --bin protocol-fixtures      # only after an intentional protocol version change
dotnet test client-unity/RoguehallaNet.Tests           # when the protocol changes
node tools/browser-proof/proof.mjs                     # when the protocol or server changes
eval "$(tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked   # once per packet, after focused checks
```

Report each command's real result. A failure caused by the environment (disk, container, Docker) must be fixed and
re-run, and labelled as environmental, not counted as a pass.

## 9. Hard rules (violating any one makes the run's result invalid)

**Architecture:**
- `rh-sim` stays pure: no I/O, sockets, clock, entropy, threads or allocation per step.
- Fixed 20 Hz.
- The legacy tick order is never reordered.
- Every actor acts only through `validate` + `Sim::submit`.
- Unity contains no game rules.
- Secrets never leave the server.

**Never cheat a test:**
- Never edit, regenerate or "fix" a parity fixture, golden file or expected value to match Rust output.
- Never change an existing test's expectation, weaken an assertion, broaden a tolerance, `#[ignore]`, cfg-gate away, skip,
  delete or rename a test to make it pass.
- Never write a hand-written oracle in place of capturing the actual TypeScript, and never use Rust output as its own
  expected value.
- Never special-case scenario ids, seeds, test names or fixture contents in production code.
- Never edit `packages/**`. The legacy code is the oracle and must stay byte-identical, so a legacy bug is ported
  faithfully, pinned by a test and listed as an owner question.
- Never use sleeps or wall time to order a test. Order with ticks, barriers or explicit inputs.

**Never write lazy code:**
- No `todo!()`, `unimplemented!()`, stubbed branches, `// TODO` presented as done, or commented-out code.
- No catch-all `_ =>` arms that hide future enum variants in rules code.
- No silent `unwrap_or_default` or `Default` on parsed fixtures or checkpoint input. Parsing is strict: reject unknown keys,
  missing fields, wrong types, non-finite numbers, and duplicate or reordered cases.
- No `unwrap`/`expect` reachable from network, replay or checkpoint input.
- No `unsafe`, new dependencies, global mutable state, dynamic plugin frameworks (scripting, `dyn Fn` in state, runtime
  data files), stringly typed ids, or speculative caching without measured need. The closed verb enum with one
  exhaustive interpreter (section 6A) is required. It is not a plugin framework.
- No per-content-id special cases in systems. A one-off branch for "just this spell" is a missing verb. Any change justified by speed records before/after evidence (R-OPT-2).
- No `.clone()` sprinkled only to silence the borrow checker in hot paths, and no `#[allow(...)]` added to silence a lint
  you could fix.

**Scope:**
- No edits to `docs/MIGRATION.md`, the `docs/CONTRACTS.md` status table, backlog statuses other than your packets' rows,
  `Cargo.lock`, CI workflows, Unity scenes/scripts beyond protocol decoder mirrors, `hosting/**`, cloud or IaC.
- No ML: no training, rewards, datasets, model runtimes, Python bindings or inference services.

**Honesty:**
- Every claim in a README, PR or report is backed by a command you actually ran on that revision.
- `INCOMPLETE` is reported as `INCOMPLETE`.
- A partial port is never described as the mechanic being complete.

## 10. How to work with Rust and failures

Iterating against the compiler is expected and cheap. Iterating against **behaviour tests** is a diagnosis task, not
trial and error:

1. A compile or borrow error: fix it locally. Prefer restructuring ownership over cloning or `RefCell`.
2. A parity or behaviour test fails: **read the legacy code path for that tick** before changing anything. Locate the first
   diverging tick and field, form one hypothesis, and check it against the source. Common causes:
   - hook chain order;
   - which ledger pass a deferred effect lands in;
   - quantized mirrors (decoded `u16`/`i16` values, not the folded `f64`);
   - object identity versus value equality;
   - lazy initialization timing;
   - phase gates.

   Change the code to match the legacy behaviour. Never change the expectation.
3. **Three-hypothesis rule.** If the same divergence survives three distinct, source-grounded hypotheses:
   - stop changing code;
   - write the first diverging tick, the fields involved, the hypotheses tried and the smallest reproducing scenario into
     the packet's evidence;
   - mark the packet `INCOMPLETE`;
   - continue with the next independent packet.

   Do not thrash, and do not loosen the check.
4. A test that passes on the first try for a non-trivial rule is suspicious. Confirm it would fail by applying one of
   your mutants before trusting it.
5. Before each commit, re-read your own diff as a hostile reviewer:
   - Does any change alter behaviour under the existing default modes?
   - Did any test change meaning?
   - Is anything hidden behind a default?

## 11. Final report

End with one self-contained report, which `docs/evidence/deepseek-rust/PROGRESS.md` also holds. It must contain:
- **Revisions:** base and final head, and the toolchain used.
- **Packet table:** id, status, PR link, scenarios/ticks/cases compared, mutants killed, and the shared files touched.
- **Gates:** the full gate results on the final head, with the commands actually run.
- **Owner questions and stale-doc discrepancies** found.
- **Not done:** remaining Pending schedule rows (with `rg` output), skipped or reserved items, and the exact next action for
  each `INCOMPLETE` packet.
- **Measurements:** stating revision, hardware, native or emulated, build mode, workload and duration.
- **Final statement:** that no fixture, golden file or existing expectation was regenerated to match Rust, except protocol
  vectors after declared version bumps, and that `packages/**` is unchanged. Back it with
  `git diff --stat <base> -- packages parity` and the list of intended additions.

Start now. Verify the environment and reservations, read section 3, set up the progress ledger, then take the first
unreserved packet in section 7.
