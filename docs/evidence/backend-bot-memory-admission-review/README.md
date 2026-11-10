# Private Memory admission — independent review

**RELEASE the private component at `0ea1589a37cdcf957195fe4955a917e644c4b88e`.** No blocking finding remains for
P-BOT-MEMORY-ADMISSION-1. This admits the repaired source-method Memory implementation on backend base
`4151b3af597cc06d1b3b77f4e3e21cc9906b6a86`; it does not activate or complete the full bot.

Reviewer inspected immutable Git blobs, current source, the earlier independent report and every new-base receipt.
No Rust edit, build, test, Source capture, cache operation, merge or push was performed by the reviewer. Only this new
review document was written in the coordinator's isolated integration worktree. Claude's primary checkout was untouched.

## Exact transplant and scope

The final worker worktree was clean at the inspected seal. Its complete diff from `4151b3af` contains exactly five
code paths plus nine new evidence files under `docs/evidence/backend-bot-memory-admission/`.

- `crates/rh-policy/src/bots/temporal_percept.rs`: only `mod memory;` added.
- `crates/rh-policy/src/bots/temporal_percept/memory.rs`.
- `crates/rh-policy/src/bots/temporal_percept/memory/source_input.rs`.
- `crates/rh-policy/src/bots/temporal_percept/memory/source_input/reader.rs`.
- `crates/rh-policy/src/bots/temporal_percept/memory/source_tests.rs`.

All five complete code blobs compare byte-for-byte equal to repaired final
`3e3178b993ae88021f459b601ac20cb1717d22be` (original code `00972d3e`, cleanup `34128472`, repairs `ed779463`).
The full parent `temporal_percept.rs` also matches that final; no newer parent code was overwritten. `data.rs` and
`input.rs` remain byte-identical to the old original base `6a251045`. No conflict resolution or comparator adaptation
was needed. No Cargo.lock/dependency, rh-sim, server, network/protocol/decoder, Unity, cloud, shared-status or existing
fixture path is in the candidate diff. The old evidence trees were not transplanted or changed.

Independent hashes of unchanged source inputs:

| Input | Bytes | SHA-256 |
|---|---:|---|
| `parity/policy/bot-protection-cues/source.json` | 45,079,140 | `0a8af4c8dee518e5e6bc6b31c3445dc2e5ab61e889810a830642381d9cf92e6e` |
| `parity/policy/npc-continuity/source.json` | 13,952,630 | `15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96` |
| `packages/server/src/bots/brain/memory.ts` | 35,038 | `29c2086be936ec867ddec97c2e4442b86acdbf1255e55de001e73892f7b128a8` |

Memory stays inside the private `temporal_percept` module. Its records and entry points are crate-private; no live
caller, `World`/`Sim` read, authoritative ID resolver or public intake was added. There is no RNG, clock, I/O or hidden
state access in the production Memory component. The existing ancestor inactivity allowance remains; no new blanket
lint allowance was introduced. The JSON/file readers are test-only. C-OBS publication, C-INPUT and the current wire
are unchanged.

## Earlier findings are repaired

Reviewed against `full-memory-06c4115c-independent-review.md` in the coordinator's external report directory and the
immutable `06c4115c..3e3178b9` repair delta. The four substantive defects have source-aligned code and named controls:

| Earlier defect | Current repair and evidence |
|---|---|
| First visible, never-dotted alive mob panics | `fold_mobs` creates auxiliary state immediately after regional-kind filtering, before creation/dead handling. `review_repair_visible_never_dotted_mob_initializes_aux_positive` checks the first visible-only encounter and continuation/return inference. |
| Death record uses percept clock | The event branch stores event `t` in `died_at`, while Announcement still uses percept `now`. `review_repair_death_event_time_control` distinguishes 150 from 200 for a previously undrawn fighter. |
| Unknown/nonplayer hit advances player-hit clock | The clock update is inside the remembered-fighter check. `review_repair_hit_clock_control` preserves the prior known-player clock for unknown and null sources while advancing `last_hit_at`. |
| Pickup refusal differs from source regex | UTF-16 code units reproduce the source non-`u` `/can.?t reach that/i` optional single-character behavior and line-terminator exclusions; no `cannot`/`can not` extension remains. Exact positive/negative matrix and retained pickup skip/clear state controls both pass. |

Strict-reader repairs also remain: camp state rejects fractional/out-of-range/null input; faction fields return typed
errors instead of panicking; the region fallback reads each camp's `region` without imposing equality to outer region ID.
`review_repair_reader_controls_are_strict` includes a Frost outer region containing a Fire camp, malformed faction fields,
and 2.5/3/-1/null camp state controls. The former discarded bad-weapons pseudo-control is no longer a claimed refusal.

The expanded API controls now actually exercise positive/unknown/dead/expired whereabouts, recorded stop/target/cast,
move failure/arrival, stop reflection, target failure and pickup refusal state, alongside the earlier Move/recordChoice
control. They are correctly labelled synthetic declared-method controls. They are not newly executed source or World
parity. The never-dotted-absence mutation's historical SURVIVED result remains open; the visible-only positive repair
does not change that result.

## New-base evidence, actual scope and limits

Read all six committed logs directly at `0ea1589a`. Each binds command, cwd, target and precommit source HEAD
`4151b3af`. Exact code was present as the reviewed five-file working diff when these commands ran and is now sealed
unchanged. All six have explicit `EXIT=0`:

| Gate | Result |
|---|---|
| `cargo test -p rh-policy --lib memory --locked --offline -- --nocapture` | 27 pass, 0 fail; 167.97s test execution, first compilation 46.96s |
| `cargo test -p rh-policy --lib memory_prefix --locked --offline -- --nocapture` | 6 pass, 0 fail; 0.01s |
| `cargo test -p rh-policy --lib protection_cues --locked --offline -- --nocapture` | 4 pass, 0 fail; 62.64s |
| `cargo fmt -p rh-policy -- --check` | pass |
| `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings` | pass |
| Same Clippy with `--all-features` | pass |

The dedicated target is `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/target-memory`; the repository
pins Rust 1.97.0. The worker records jobs 1, `CARGO_INCREMENTAL=0` and debug info 0. Those environment settings are
worker-reported rather than echoed in the raw headers; the headers and pinned toolchain are independently visible.
This is not a full workspace or integration-union result.

The filters overlap: six prefix tests and the complete protection Memory consumer occur within the 27-test filter;
the four protection tests rerun that same Memory consumer plus three existing temporal controls. Do not report 37
distinct new tests or 27 complete-Memory source scenarios. There are 13 tests in the new Memory source-test module.

The actual source consumers retain all 2,112 protection snapshots: 66 factory initialization comparisons and 2,046
observes; all eight copied Memory outputs plus returned stimuli are compared. The NPC consumer retains all 773 rows:
two initialization comparisons and 771 observes, limited to mobs/camps/self/stimuli. The strict comparator preserves
ordered Map entries, complete object keys/arrays, exact binary64 bits, and Undefined versus Null. It still counts 10,560
protection Maps and 82 Undefined leaves; expected outputs are never used as Memory inputs. Existing temporal Frame
composition also reports all 2,112 rows with zero raw numeric error on this base. No expectation or tolerance changed.

The historical actual-source red receipts and mutant outcome limits are available through immutable old commits; no
new-base mismatch occurred, so no new red was erased. The earlier continue-after-first-mismatch process deviation stays
historical and is not repeated or recast as an authorized new-base repair.

Admission does not establish generic atomic validation of arbitrary manually constructed typed nonfinite records.
`Memory::observe` consumes crate-private typed inputs, has no preflight, and its current `Result` does not itself prove a
refusal path; the checked test reader refuses before calling Memory. Nor does it establish a safe native BotVision,
earned World history, accepted fair publication, live strategy, full Brain, allocation budget, learning or tournament
outcomes. These finite limits are explicitly retained in worker evidence.

## Next implementation handoff: full private strategy and hunting closure

Next packet: [P-BOT-STRATEGY-1](../../backlog/packets/P-BOT-STRATEGY-1.md), with an additive source-witness phase first and separately reviewable
Rust dependency/strategy commits. This is practical now because Memory is private and source-bound enough to supply
declared method histories without waiting for Claude's networking/Unity work. It must implement the whole source
strategy; do not ship another reduced candidate selector or wire it into `HumanBot` as this packet's result.

Verified source closure:

- `packages/server/src/bots/brain/strategy.ts` (901 lines): entire stateful strategy and every goal family.
- `brain/huntAdapter.ts`: remembered fighter/mob conversion, home seeding, catch-up, release and awake-near behavior.
- `bots/mobHunt.ts`: still-missing `MobTracker` and `MobHunter` state machines, using existing reviewed pure helpers.
- `brain/buildRoute.ts`: still-missing stateful `BuildRoute`, using existing reviewed build/value helpers.
- `brain/memory.ts`, `brain/types.ts`, `brain/random.ts`, `brain/knowledge.ts`, and shared definitions actually imported
  by those modules. Existing Rust random/knowledge/types/static catalogs should be reused only after checking equivalent
  source argument/value semantics. Runtime service results and module/learned callbacks need explicit declared contracts.

Existing Rust `build_route.rs` and `mob_hunt.rs` document that they port only leaves; the stateful classes above cannot
be replaced by constants or fabricated hunter answers in the final native strategy replay. Existing public
`brain::Goal` lacks Hunt/Loot/Flee/Module and uses a different Farm shape; keep a complete private source goal union
rather than changing that public/live compatibility surface.

Proposed exclusive native write scope: new files below
`crates/rh-policy/src/bots/temporal_percept/strategy/`, its new `strategy.rs`, and only its module declaration in
`temporal_percept.rs`; narrow Memory visibility/API changes only if explicitly listed and source-witnessed. Keep
stateful hunter/tracker/build-route implementations in this private closure. Do not edit public `bot.rs`, `brain.rs`,
policy seats, simulation, observation, server, protocol/decoders, Unity, dependencies, Cargo.lock or shared status.
Sol/Luna source tooling should use new `tools/bot-private-strategy-fixtures/`,
`parity/policy/bot-private-strategy/` and dedicated evidence paths, without rewriting existing corpora.

Source-witness phase must execute unchanged real APIs and freeze exact chronological inputs/outputs before Rust:

1. Close Memory gaps with actual `createMemory.observe`, `noteSent`, `recordChoice` and `view.whereabouts` call histories:
   full commands and reflection/failure/arrival; bounties/choices/lastOrder/lastCast; Wish `castLand`; chasing/third-party;
   plan/chest/death/teleport; never-dotted absence. Include counterexamples at expiry/timer boundaries. Capture ordered
   Maps, Undefined/Null, all eight outputs and returned stimuli using the existing exact-value convention. Declared
   histories remain honestly component inputs; do not claim source-earned gameplay from manually installed rows.
2. Drive complete unchanged `createStrategy` over those Memory histories and source-defined additional percept fields.
   Capture every candidate in source order, decision/choice/why, public Strategy state, route/contests, hunter target/stats,
   awake-near answers, and ordered decide/lapse draws. Record path/knowledge/learned/module callback arguments, results
   and order. Module service witnesses may be declared/labelled, but hunter/tracker/route decisions must execute real
   source classes, and native parity must execute their native ports rather than replay expected candidate answers.
3. Cover all goals (Idle/Farm/Hunt/Fight/Loot/Flee/Roam/Hold/Module), excluded/dedup/tie behavior, tunnel attention and
   hysteresis, pursuit progress/avoid renewal/release, appraisal caching, flee/evade/ban timings, remembered targets,
   loot skip/budget/safety, camp/build route/replan/contest, coliseum/patience/sudden death, learned bias and feature-module
   ordering. Include hunt catch-up below/at/above 240ms and its cap, homes/returning/death, retreats/bans/locks and reset.

Native acceptance: consume frozen actual-source traces through the real new Memory+strategy+hunter+route closure;
compare exact discrete outcomes, ordered candidates/state and RNG consumption, preserving exact binary64 where the
captured method contract requires it. Every implemented source branch must have an honest coverage ledger; surviving
mutants and uncovered branches remain open. Semantic controls should detect changed candidate order, expiry comparison,
hysteresis, pursuit reset, loot exclusion, hunter catch-up and route contest/replan behavior. Preserve the admitted
Memory and temporal consumers, run focused affected tests plus scoped format and strict default/all-feature policy
library/test Clippy in a new packet-owned target, and retain failures before repair. No live activation belongs here.

After this complete private closure, the next full-bot work remains private tactic/reflex/loot/module integration,
complete Brain orchestration and source-executed end-to-end headless outcomes, then separately reviewed fair live
publication/admission. Learning persistence, fill and tournament integration remain explicit later requirements.
