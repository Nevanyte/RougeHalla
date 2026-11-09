# Earned living NPC sight loss and return

This source-only packet supplies one producer-consistent continuity witness from base `197926e27747545934fb801e3df61ae7070905a2`. Source commit `7edb98c89a2017bf9f47e3f92a6a4a79149b53b2` adds six new tool files and one new fixture; it changes no legacy/native source or earlier corpus. It stops at the living-return slice. Hidden death/replacement, ID-only equivalence and a new public continuity contract remain open.

The actual `createGameWorld` produces three normal Cinder Hounds through `raidStarted` in an explicitly declared all-floor test arena with one three-spot camp. Both ordinary seats start with source-default empty weapon slots. The observer is selected from the actual shuffled placements, approaches on a queued move, leaves on a queued move, waits beyond the real 30-second personal trail, then returns on a queued move. No actor, health, weapon, phase, remembered outcome or movement position is installed after construction. All three moves are accepted; all three mobs remain alive, with the same ordered IDs and unchanged camp state, through **773 actual 50 ms steps**.

## Observed result

| Source time | Actual World / source human producer facts | Actual Memory outcome |
| --- | --- | --- |
| 650 ms / private source tick 13 | `mob1` is alive and inside the screen window; extracted human admission and minimap callbacks and composed bot Percept admit it. | `alive=true`, home `(1584,624)`, Cinder Hound / Axe, full last-seen HP share. |
| 31,750 ms / private source tick 635 | `mob1` is still alive. The source sight trail has expired and the human contact is absent. All camp members remain alive. | First `alive=false` belief. |
| 37,600 ms / private source tick 752 | Same source actor remains alive and currently outside sight; human callbacks and bot minimap omit it. | `alive=false` persists. |
| 38,650 ms / private source tick 773 | Same living actor is admitted again by the actual extracted human callbacks and composed bot Percept after return and delay settling. | `alive=false` persists; HuntAdapter's tracker receives a dead MobLike row. |

The final hunt method returns `player / no mob in reach`. It also retains a real `mob3` stall ban, so this packet does not attribute every hunt decision solely to the stale life belief. These are method returns, never submitted World actions or a full-Brain outcome.

This is a concrete counterexample to equating source minimap omission with authoritative death. It does **not** classify intended behavior or a source bug, prove hidden replacement ambiguity, or authorize a privacy redesign. [DECISION.md](DECISION.md) states exactly what it resolves and what remains unsupported.

## Actual producer boundary

Each real source step is followed by actual FxChannel batch creation, roster extension, real Schema Encoder/Decoder and `rosterSent`, in the source headless publisher's order. The harness publishes full snapshots; it does not claim a Room/socket or delta test. Source `RaidState.tick` is `noSync`: every actual decoder value remains the default 0. Real server tick is recorded separately under private `sourceDiagnostic` and is never injected into consumer input.

The human adapter uses TypeScript 7.0.2 AST selection and esbuild 0.28.2 to execute exact unchanged `RaidScene.ts` source spans: `drawRemote` (930–936), the regional-mob admission prefix (640–642), and the inline minimap source callback (763–771). Source/extracted/transpiled hashes and actual invocation flags are recorded. Real `EntityInterpolator`, `RemoteDraw`, `RaidVision` and `shouldRenderActor` process actual decoded World updates. The callback context supplies the real observer ID, current source-derived positions and a declared zero-jitter receipt clock; draw-ahead is off and local prediction is unrun.

Full `RaidScene.update`, `MobView`, `Minimap.setMobs`, Phaser/DOM/canvas and display rendering do **not** run. No rendering or gameplay dependency is replaced with a stub. The result is exact extracted callback/input evidence, not a full scene or display proof. All actors exercised here are ordinary regional mobs; no zombie/quest view claim follows.

The bot adapter executes actual `perceive -> FrameRing -> Memory -> HuntAdapter/MobHunter`, with real path services and explicit consumer-method streams. It uses actual `canPlayerSee` over the source World, preserving returned list/Map order and IDs. It does not execute full BotRunner's post-compose `vision.filter`, full Brain cadence/reset/humanizer, strategy or action submission. Private raw Schema, source tick, engagement and ban diagnostics remain separate from consumer input. A 50 ms method cadence and explicit `engaged=false` are declared probes, not full-policy cadence proof.

World RNG instrumentation covers only actual `opts.random`: two draws with a pinned little-endian binary64 digest. Private reward/quest streams use fixed declared salts; their draw counts are not instrumented and no equality claim is invented. The separate method RNG seeds, creation draws and per-call draws are retained. No cross-branch ID/order/RNG equivalence is asserted.

## Verification and artifacts

Canonical [source.json](../../../parity/policy/npc-continuity/source.json) is **13,952,630 bytes**, SHA-256 `15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96`. Its 773 rows preserve complete method Frame/Percept/memory/hunt outputs, source diagnostics and actual human callback returns; repeated records are intentional audit data.

- Final pinned Linux amd64 Node 22.23.4 capture plus **one byte-exact check** pass: [raw log](logs/capture-and-bytecheck.log), elapsed 11.413 s. The repository is read-only and npm dependencies/cache are tmpfs; exact image is in the fixture profile.
- All **350 profile pins** match current bytes: 333 source, 9 config, 6 tool and 2 contract files. All 344 baseline inputs also match exact base Git bytes. The inventory is an explicit superset, not a claim every pinned module executes.
- [Static audit](logs/static-audit.json) verifies every source step, actual noSync defaults, all three live actors, stable public camp facts, accepted input receipts, absence of FX batches and the first false Memory belief. Source/method outputs are exactly unchanged from the earlier passing candidate after only the explicitly listed metadata repair; the final byte check itself excludes nothing.
- [Attempt inventory](attempts/README.md) preserves the failed coverage field-name run, an earlier passing candidate before private-clock labeling, focused World development runs and labeled human smoke/failure excerpts. These are historical development receipts, not extra canonical cases or source defects.
- Read-only cross-review inspected producer consistency, extraction bounds, metadata and captured outcomes. The known tick label, actual client-tsconfig input pin, movement-count comment and human admission-assertion issues were corrected before the final capture. [Review record](review.txt) preserves scope and limitations.
- No old mutant campaign, native/Rust/Editor/browser/hosted/performance test was repeated. This packet makes no new deployment, latency, full gameplay, hidden lifetime, universal cap or P15/native design claim.

[receipt.json](receipt.json) pins the separate source commit. [manifest.json](manifest.json) seals source files, baseline guards and all evidence except itself; the evidence commit seals the manifest. Only the three new packet directories are additions. Root owns review, merge, status and design admission.
