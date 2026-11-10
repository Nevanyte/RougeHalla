# Backend gameplay and bot workplan

**Inventory cut:** `optimization_port` at `4151b3af` (isolated backend coordination worktree). This is a task inventory, not a change to the shared migration checkpoint or contract status table. Unity and network-client implementation remain with Claude; root owns architecture, integration, public identity/version choices, and shared status.

## Owner release window (2026-11-10)

Backend work continues until10:30am Edmonton (17:30UTC). **No communication with Claude before10:30am.** Then attempt
handoff, finish the reviewed composition and deploy `play.rougehalla.com` for the11am target. Read-only commit monitoring
is permitted beforehand. The owner pre-approves Gate3, merge and this test-site deployment if unavailable; complete
checklist evidence and final combined-tree Opus approval still gate publication. Backend merges first; Claude consumes
it, renumbers colliding identities and verifies the final browser artifact. Full details and existing budget constraints
are in [MIGRATION.md](../MIGRATION.md#morning-release-direction-owner-instruction-2026-11-10-americaedmonton).

## Current execution checkpoint (2026-11-10)

- **Private bot components admitted:** Memory `8a2d3c6c`; complete Strategy `2b05e607`; Tactics `df62934a`;
  Modules/shared planning-Wish-hazard cores `721d04da`; feature-aware Hand `483c1490`; shared room path-allowance
  bridge `07babf29`; Strategy Send/mutable-goals bridge `04577169`. Source witnesses cover98/658 plus4/48 Strategy,
  154/720 Tactics,255/3259 Modules and6/12 Hand. Exact independent reviews and their limits are linked in MIGRATION.
- **Combined dependency verification:** Root's unchanged code at `721d04da` passes389 policy-library tests, format
  and strict default/all-feature lint. The existing release full-map soak passes five seeds twice each, up to6000ticks,
  with no panic and matching results. It uses existing HumanBot and accepts termination or truncation; it is not a
  full private Brain or all-matches-ended claim. [Receipt](../evidence/bot-private-modules-admission-review/README.md).
- **Full private Brain active:** independently released source `6aaa4c6d`/`5a5a28c6`/`8fa97f24` contains31 histories/
  855 operations plus Hand6/12 and separately labelled Knowledge constructor evidence. Root dispatch `c050d938`
  starts `codex/deepseek-private-brain` in `backend-bot-brain-native`, using the [final four-file interface lease](../backlog/packets/P-BOT-BRAIN-NATIVE-1.md)
  and new Brain paths. Source order, same actual component/providers, Send-safe ownership, cfg/service/module identity,
  strict four-status intake and all-command Memory.noteSent are required. No native Brain admission yet.
- **Fair live activation remains open:** the [reviewed F0/F1 plan](../backlog/packets/P-BOT-FAIR-ACTIVATION-1.md)
  inventories missing accepted facts and binding. The [primary protocol16 delta](../evidence/bot-fair-activation-primary16-delta/README.md)
  adds static geometry/vision parameters and projectile height, not the missing dynamic cues/identity/history. Potion
  same-sample Active healing equivalence is admitted as `ae29dc1b` plus5 Root tests at `06833e40`; Lobby/Planning are
  unproved, Ended and missing inventory refused. No hidden-state input or live activation is authorized by private parity.
- **Quest backend architecture and bounded parity admitted:** stored-mask repair `8a11520d` + `56843a8e`, behavior-
  preserving objective/reward extraction `ad98c441` + `9debd3e2`, and all six bounded notice/view cases `51a43597` +
  `0085ff79`. Their real producer, diagnostic/direct-producer and comparison limits stay explicit. The independently reviewed [completion-through-Room/Outbox/decode proof](../backlog/packets/P-QUEST-ROOM-DELIVERY-1.md)
  is dispatched from `9ee84dfe` to isolated `backend-quest-room-delivery`; no literal181-record equality or browser proof is
  claimed. Future quest design is not invented by these architecture seams.
- **Card feedback independently admitted:** Root sealed DeepSeek's exact58-file candidate as `8d06e5e8` and
  integrated it as `37a02542`; [final review](../evidence/card-bleed-native-review/admission-review.md) closes the
  historical capacity/privacy/strict-intake HOLDs. Author full simulation exits0 (881 library passes/15 ignored,
  all integration targets green); final focused29 Card/28 projector and separately executed allocation controls pass.
  Source7/390 steps and ability63 remain unchanged. The real2104-output synthetic flush measures0 allocation blocks;
  eight-viewer actual reservations are accounted separately from planning and total live heap. Root's integrated
  Card29, both CI-feature allocator tests, NPC6, ability63, tape, content21 and format pass. NPC deduplicates;
  no Unity/wire16 union or hosted acceptance is implied.
- **Release remains separate:** backend/Unity composition, actual final browser acceptance, reports/licences,
  exact runtime/artifacts, Opus review and authorized AWS test deployment follow the owner window above. No complete
  port, full private bot activation, final performance or hosted release is implied by these component checks.

## Historical starting inventory at 4151b3af

The current checkpoint above supersedes the pending/active language in this original inventory. It preserves the original code findings, including the since-repaired Grand Tour bug.

- The repaired private Memory is now admitted on this lane as `8a2d3c6c`, from DeepSeek worker seal `0ea1589a37cdcf957195fe4955a917e644c4b88e`. Sol independently verified the exact five-file transplant from `3e3178b9`, unchanged source corpora and new-base test/lint receipts. Memory27/prefix6/protection4 filters pass (overlapping tests), as do scoped format and strict default/all-feature policy lint. See [independent release](../evidence/backend-bot-memory-admission-review/README.md). This is private component admission, not full/live bot activation or an integration-union test result.
- [P-BOT-STRATEGY-1](../backlog/packets/P-BOT-STRATEGY-1.md) now owns the next complete private strategy/HuntAdapter/MobTracker/MobHunter/BuildRoute closure. Sol prepares actual-source Memory API and strategy witnesses with independent review; DeepSeek's prepared branch `codex/deepseek-private-strategy` starts at `d21552d3` and may implement source-derived classes in parallel after interface review; frozen source gates fixture comparison/admission. Preserve all goal families/stateful dependencies rather than extending the existing reduced public goal surface.
- The candidate models declared public FrameRing method inputs, **not** an Observation adapter, real World/earned history, BotVision, publication, or live Brain activation. Its source-witness gaps include never-dotted minimap absence, source-executed `noteSent`/`recordChoice`/`whereabouts`, bounties/choices/last-order/last-cast, Wish `castLand`, chasing/third-party engagement, and plan/chest/death/teleport. Keep this as private deterministic state work until the fair-publication contract and consumer boundary are separately admitted. Unity must never receive the private Memory.
- The source card feedback gap is narrower than missing bleed damage. Hemorrhage/DoT damage and `LandedHit.dot` are implemented. Legacy `packages/server/src/sim/cardHooks.ts:270-334` aggregates DoT hit FX by victim/source, flushes every `DOT_FX_MS`, and flushes remaining groups on `runEnded`; Rust schedules `cardHooks.afterDamage` at `crates/rh-sim/src/schedule.rs:1185-1187` but has no corresponding report accumulator/periodic or run-end consumer. The run-end slot is explicitly `pending_link("cardHooks.flushBleeds", ..., "P-CARDS-1")` at `schedule.rs:1693-1698`. This needs a source capture for periodic grouping and final flush before selecting state/event ownership; use the existing hit-FX representation if the current event path supports it, and ask root before any wire/version change.
- Native quest lifecycle is substantially present (`crates/rh-sim/src/quests/live.rs`), and current server bridge/reconnect/privacy tests exist (`crates/rh-server/src/quest_bridge_tests.rs`). The older backlog's `P-QUEST-1 = Coarse` label is stale: current `docs/MIGRATION.md` lines 150-170 record typed givers, producer captures and public bridge work. The remaining verified witness is explicitly partial: native source-consumer cases 0 and 4, with reached run-end closure and foreign-row privacy, are reviewed; the six-case Source witness still documents direct-producer/diagnostic limitations; no 181-record Rust notice-stream equality is claimed (`docs/CONTRACTS.md:24-38`, `docs/MIGRATION.md:150-170`, `docs/evidence/quest-notices/native-consumer.md`). Do not rewrite quests from the stale backlog row. Close the remaining real producer cases (1, 2, 3, 5) as separate parity work, then take the public browser/account quest-flow gate with Claude's client owner.
- A separate reachable quest logic bug is confirmed in `crates/rh-sim/src/quests/live.rs:947-958`: `offer.visits` stores a bitmask, but `close_impossible` converts it to `count_ones()` and uses that count as a mask in `(seen & (1 << i))`. Legacy `packages/server/src/sim/quests.ts:371-375` retains a Set and tests `seen.has(zone)` directly. For Grand Tour (`count=3`), after visits to zones 0 and 2 (`mask=0b00101`, progress=2, need=1), if remaining alive mobs exist only in zone 1, legacy counts one fresh region and keeps the offer possible; Rust sets `seen=2` (`0b00010`), treats zone 1 as visited, counts zero fresh regions, and can expire it. Conversely, if remaining mobs exist only in zones 0 and/or 2, legacy sees no fresh region while Rust treats those bits as fresh and leaves an impossible offer open. The source-aligned fix should bit-test the stored mask, not count it. `docs/coordination/QUEST_BACKEND_REWORK.md` and packet `P-QUEST-BACKEND-1` are now on disk. Sol owns the source witness; DeepSeek Post Rust owns the scoped native repair/extraction. Keep source evidence, repair and later extraction separately reviewable.
- The backlog and packet remain useful as architecture, but their statuses are stale compared with the later checkpoint. In particular `docs/backlog/README.md:164` still says quests Coarse and `:177-183` retain generic bot labels. Use current evidence/commit scopes, not those status adjectives.

## Same-cycle work queue

| Order | Work item | Exclusive implementation scope | Dependencies / exit boundary |
|---|---|---|---|
| 1 | Admit private Memory candidate (complete privately) | Packet `P-BOT-MEMORY-ADMISSION-1`; branch `codex/deepseek-bot-memory`; exact scope and source commit pins are in that packet. | Reviewed and integrated as `8a2d3c6c`; new-base focused tests/format/strict lint pass. The slice completes only private Memory; it does not complete or activate the bot. |
| 2 | Fix Grand Tour visited-mask predicate | `docs/backlog/packets/P-QUEST-BACKEND-1.md` Stage 0 and `docs/coordination/QUEST_BACKEND_REWORK.md`. Sol owns actual-source witness; DeepSeek Post Rust owns native work. | Complete: source `c605f2fb`, DeepSeek repair/pins `4fb5714e` + `36564c33`, independent release and integration `8a11520d` + `56843a8e`. Both directions pass through real native producers. Stage1 objective/reward extraction is admitted as `ad98c441` + `9debd3e2`; no protocol/Unity change. |
| 3 | Finish card bleed feedback flush | `P-CARD-BLEED-FEEDBACK-1` is dispatched at `22eef4d1` to isolated DeepSeek worktree `backend-card-bleed-feedback`, base `03ec330b`. Frozen source, B3 numeric/public privacy design and exact file leases are approved. | Actual source/privacy/restore/layout/allocation gates and Root-reviewed native tape/pins still required. Separate NPC restore repair `0be00f95` is independently released and integrated as `dedb8658`; the Card worker is authorized to import that exact nonoverlapping commit. Wire14/Unity stay outside this lease. |
| 4 | Complete remaining bounded quest notice producer parity | Completed native seal `e499d865`, integrated as `51a43597` + `0085ff79`; the reviewed internal teleport visibility hunk and additive consumer tests preserve current behavior. | Six focused tests and unchanged cases0/4 pass, with meaningful binding/comparator controls and reached item/offer/closure state. Root passes6 new +1 unchanged tests. Diagnostic/direct-producer/order-only limits remain explicit; full181-record transport and public quest UI acceptance remain separate. |
| 5 | Compose the complete private source Brain | Active `P-BOT-BRAIN-NATIVE-1`, clean worker base `c050d938`; new Brain paths and exactly four private interface files. | All component dependencies and source are admitted; full31/855 composition and controls, independent review and final gates remain. Fair publication and live/headless driver activation are separate, with no hidden-state shortcut. |

## Ownership and dependency notes

**Current worker assignments (2026-11-10):** DeepSeek owns active Card feedback in `backend-card-bleed-feedback`
(base `03ec330b`), complete private Brain in `backend-bot-brain-native` (base `c050d938`), and the bounded
quest Room-delivery proof in `backend-quest-room-delivery` (base `9ee84dfe`). Memory, Strategy,
Tactics, Modules, Hand, PathBudget, Potion proof, quest notices and NPC restore workers are complete; their exact reviewed
seals are integrated. Sol/Luna handle independent native review and remaining fair-fact equivalence analysis. All workers
retain Workspace Write and isolated targets. No worker may communicate with Claude before17:30UTC/10:30am Edmonton.

- **Root:** select current base and feature order; decide fair-publication facts, public identities and whether a card FX can use existing encoding; review isolated DeepSeek changes; update only shared `MIGRATION.md`, `CONTRACTS.md`, and `Cargo.lock` when required.
- **DeepSeek Rust:** bounded Rust mechanics and fixture-driven policy work in isolated branches, with exact base, exclusive file list, immutable source corpus, focused affected checks, raw evidence and explicit limits. Do not merge or change shared status records. The repository documents branch/PR handoffs in `docs/agent-prompts/5_Codex_Rust_Handoff_To_DeepSeek.md` and records work in `docs/evidence/deepseek-rust/PROGRESS.md`; that handoff prompt contains older stop-new-packets guidance, superseded here by the current owner instruction and root's packet/runtime dispatch. No repository script/tool or credential was invoked.
- **Claude:** Unity UI/network consumption and browser-level public quest/game flows. Keep all game rules, bot behavior, combat and physics in Rust.
- **Source parity before implementation:** private Memory/strategy work uses declared actual-source method histories; live activation separately needs accepted public Observation leaves; card feedback needs event/state ownership confirmation; quest lifecycle consumers need genuine accepted producer cases. These are separate gates and should not be bundled into a wire/client change.

## Validation boundaries

Do not claim or schedule a whole-workspace run for every slice. Each owner should run focused tests, format and relevant strict lint on the exact sealed base, preserving failures and revision scope. Root runs the integration gate for the admitted union. Every simulation mechanic follows `docs/sweep/PACKAGES.md`, C-TICK/C-INPUT/C-OBS/C-RNG/C-PARITY and ADR 0009: captured legacy behavior, source-order schedule, state/hash/checkpoint coverage, no per-step allocation, and no public hidden-state leak.

The notice HOLD is repaired and independently admitted as stated above; its finite witness limits remain. Full Brain
source is independently released and native composition is active; fair live activation is separately required. Earned
regional NPC bleed restore is integrated as `dedb8658` after clock/consumer HOLDs cleared. Component evidence is bound
to its recorded cut; only the recorded Root checks establish combined dependency behavior.
