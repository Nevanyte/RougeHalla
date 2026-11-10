# Migration record and checkpoint

The single status record of the Rust + Unity + AWS migration. **Only the coordinator edits this file.** Requirements:
[REQUIREMENTS.md](REQUIREMENTS.md). Invariants and their validation status: [CONTRACTS.md](CONTRACTS.md). Remaining work:
[backlog/README.md](backlog/README.md). Decisions: [adr/](adr/README.md).

## Morning release direction (owner instruction, 2026-11-10 America/Edmonton)

Continue backend development until **10:30am Edmonton on November10 (17:30UTC)**. Do not communicate with Claude
before that time; read-only commit monitoring may continue. Only at/after10:30 attempt the Claude handoff, compose and
verify the final tree, then deploy the authorized test site **https://play.rougehalla.com**, targeting **11am Edmonton
(18:00UTC)**. Production `play.roguehalla.com` remains outside this deployment. The owner explicitly grants standing
Gate3/merge/deployment approval if unavailable; another confirmation is not required for this already authorized scope.

The time target does not replace the complete launch-readiness checklist on `feature/unity-rework`, the real merged
browser/build evidence, final tests/licences, both reports or the final **Opus** review. The Claude handback (`git show feature/unity-rework:docs/coordination/CLAUDE_UNITY_REWORK_HANDBACK.md`) calls for backend integration into `optimization_port` first,
Claude consuming it and rerunning the final client/server gates, then a squash of the completed Unity work and Opus
review of the exact combined runtime/map/flags before AWS activation. No final release or Opus pass is claimed yet.

Backend Card work reserves checkpoint30/replay24/OBS22/policy16 with unchanged wire14. Claude's separate hitbox work
uses the same provisional numbers plus wire16; the second merge must renumber the combined identities (expected
31/25/23/17, subject to final tree review), regenerate derived fixtures and build the server/client together. Never
serve the reworked client from the old server/artifact. Hosting preparation `28d21c3f` + strict response-type repair `29a7d597` is independently reviewed and integrated as
`f72f188c` + `7cb22c0e`: immutable artifact identities and at most12h original absolute expiry, with12offline+7stack
checks passing. [Review](evidence/morning-host-preparation-review/README.md) retains the original malformed-protocol
HOLD. Root-reviewed single-owner launch preparation `40b884aa` is integrated as `15da415c`: Source min1/fill target8/
max1/lobby10/fill3, with Training unchanged and learning off. Existing12offline+7stack checks pass; the initial10s lobby
deadline shortens to at most3remaining seconds after the human minimum is reached. This is configuration preparation,
not an executed final match. Final runtime/map/hitbox flags/artifacts/cloud evidence remain open. The existing CAD20 total budget remains. No AWS guest
is active from the earlier expired demo.

**Full Brain source update:** candidate `6aaa4c6d` is independently released and integrated as `5a5a28c6` + `8fa97f24`.
Fresh pinned capture/coverage, semantic controls and strict reader/manifest reproduction pass; all244 protected files
remain unchanged. The source is transferred to the narrow Hand worker as `90b191b3`. This closes the pending source
review described below; full native composition and live activation remain open. The new
[fair activation plan](backlog/packets/P-BOT-FAIR-ACTIVATION-1.md), committed at `10ddaac0`, inventories actual consumed
facts and missing providers. It is undergoing independent plan review and authorizes no wire/publication change.

## Parallel backend completion lane (owner instruction, 2026-11-09 America/Edmonton)

The owner has resumed remaining Rust gameplay, bots and quests while Claude continues Unity and networking.
Codex manages this lane, delegates most non-Rust architecture/planning/review to Sol and Luna, and assigns Rust
implementation to DeepSeek. Quest work must prepare a backend architecture for a later content/design rework without
silently redesigning current quest rules. The earlier demo-only parking instruction no longer parks this backend lane.

Work is isolated on `codex/backend-gameplay-quests`, based on the latest committed backend `4151b3af`; Claude's
`feature/unity-rework`, hitbox/crash/Unity branches and netcode work remain separate. No Unity or networking/protocol implementation belongs to this lane. The separately authorized morning test-host
preparation and deployment follow the release direction above. The existing backend lead checkout's untracked plague regression
and evidence are preserved. Integration into `optimization_port` follows reviewed scoped changes, not branch replacement.

Private Memory is independently reviewed and integrated on this lane as `8a2d3c6c` (DeepSeek seal `0ea1589a`).
The five code files exactly preserve the repaired `3e3178b9` implementation; new-base Memory27, prefix6 and protection4
filters pass (overlapping coverage), as do format and strict default/all-feature policy lint. The
[independent review](evidence/backend-bot-memory-admission-review/README.md) retains actual-source and synthetic-control
limits. This remains a private component, with no live bot activation or new observation/publication surface.

Sol's [quest architecture](coordination/QUEST_BACKEND_REWORK.md) and
[ordered repair/extraction packet](backlog/packets/P-QUEST-BACKEND-1.md) are prepared. Source seal `c605f2fb` captures
both actual Grand Tour supply outcomes, with bytechecks, semantic mutation and comment/restoration controls passing.
The [frozen evidence](evidence/quest-tour-supply/README.md) is transferred to DeepSeek's quest worktree as `a3d8e8d4`;
the full Source-profile consumer reaches both intended status reds and both repaired greens. DeepSeek seals `4fb5714e` + `36564c33` are [independently released](evidence/quest-backend-admission-review/README.md) and integrated here as `8a11520d` + `56843a8e`. At their recorded cuts, quests34 pass/1 ignored, quest-view26, content21, the unchanged63-case ability tape, selected checkpoint/replay refusal tests and strict all-target/all-feature lint/format pass. Two metadata pins now identify content `8edd862f48ffa100`; protocol14/checkpoint29/replay23/OBS21/policy15 shapes stay unchanged. This is isolated backend admission, not a Claude client/artifact refresh. Stage1 is independently admitted: DeepSeek `9f3e9502` + evidence correction `49a6ab94` integrate here as `ad98c441` + `9debd3e2`. The four-file objective/reward extraction preserves behavior; [independent review](evidence/quest-backend-stage1-review/README.md) verifies12 cases/35 remaining frames through real original/Clone/accepted restore with real pending producer queues. Quests34/1 ignored, quest-view26, checkpoint6/replay6/content21, schedule14, hash-coverage10 and final strict lint/format pass at their recorded cuts; the final code delta is only an identity conversion and formatting. Private invocation metadata is recovered from author tool receipts; toolchain identity is explicitly a later query. Earlier snapshots/refusals, incomplete gate attempts and the lost private compile log stay honestly recorded. No future quest redesign is invented.

Luna's [workplan](coordination/BACKEND_GAMEPLAY_WORKPLAN.md) reconciles remaining gameplay/bot work against code.
DeepSeek's complete private strategy is independently released at `9bde4438` and integrated through `2b05e607` (initial implementation `489c4409`). [Final review](evidence/bot-private-strategy-admission-review/intake-followup-review.md) clears typed-error propagation, shared checked dispatch with declaration-consistent semantic controls and real judged-z ancestry. All98 primary cases/658 operations plus4 supplement histories/48 calls retain callback/RNG/private-state comparison;33 reader negatives and8 reached semantic non-advance paths pass. Author source11/declared11, default/all-feature strict lint and format pass; Root's integration filter now also passes22 tests. Earlier output-only and intake HOLDs remain historical with their real failures and limits. This admits a finite private component, not a live Brain. Tactics and modules native implementation are the next dependencies.
The immutable [primary source witness](evidence/bot-private-strategy-source/README.md) `5ec31212` has98 cases/658 calls,
all nine goal families and19 semantic controls. [Independent fresh-checkout reproduction](evidence/bot-private-strategy-source-review/README.md)
passes exact source/coverage bytes and the pinned-runtime verifier; all17 files remain unchanged. Root transferred it as
`36a3b2b9` to `codex/deepseek-private-strategy`; the complete finite native repair is admitted above. A separate four-case module
JSON-key supplement `1d06f752` also passes [independent fresh reproduction](evidence/bot-module-goal-key-source-review/README.md) of all4 histories/48 calls and all26 protected file hashes. It is transferred as `d629e174`; neither source corpus changes. The next [complete private tactics packet](backlog/packets/P-BOT-TACTICS-1.md) has source `54ff01a2` (154 cases/720 methods/17 semantic controls), [released by Root](evidence/bot-private-tactics-source-review/ADMISSION.md) at `cef8d83d` after independent reproduction `c8d0a5e6` of exact source/coverage/manifest and226 entries. The finite geometry whitelist and typed World empty-route error mapping are explicit; native implementation is dispatched at `2f2e3150` to isolated `backend-bot-tactics` (worker start `f252b8697c`), with only the two declaration/visibility hunks allocated. The packet uses source-shaped private Fight/OrbWalk/Retreat and real existing Reflex reuse.

The [complete modules and Brain delivery plan](coordination/BOT_BRAIN_COMPLETION.md), committed at `bd40fa2a`, confirms actual ChestHunter/card-choice/chest-module gaps while reusing the existing planning, Wish/slip and hazard engines through later source-context bridges. Sol's [complete modules source witness](backlog/packets/P-BOT-MODULES-1.md) `faba1278` is now independently reproduced and admitted on this lane as `d48b79bf` + `63f6fda8`:255 cases/3259 operations,36 reached assertions,24 reader negatives and26 semantic controls. Luna reproduced exact final source/coverage bytes, all26 semantic kills, comment/restoration controls and the complete manifest in a fresh checkout; [final review](evidence/bot-private-modules-source-review/final-review.md) closes the earlier optional `MobSeen.type` and reached-assertion concerns. The finite profile still excludes raw nonfinite Plan inputs. Native modules are now active in isolated `backend-bot-modules` from `9f74ff3e`. Root allocates corrected shared planning/Wish/hazard transition bridges at `de908f2b` after [independent review](evidence/bot-module-bridge-review/README.md), preserving old wrappers, finite f64 source semantics and the five-Wish profile. Full Brain source candidate `6aaa4c6d` is sealed by Sol:31 histories/855 operations,6 hand profiles/12 calls,40 reached assertions,30 reader negatives,31 complete instrumentation comparisons and23 semantic kills, with one intentional survivor. Author pinned bytecheck/manifest pass; fresh independent reproduction is now running in `backend-bot-brain-source-review`. No native comparison/admission follows until that source release. The narrow hand feature gate is dispatched at `dcb33d15` to isolated DeepSeek `backend-bot-hand-feature`; the old constructor remains compatible and the opt-in gate precedes hand mutation/draws. Native composition and fair live/headless binding remain separately required. All older source corpora remain frozen.

Corrected card source `570fe186` (`rh-card-bleed-source/2`,7 cases/390 ordinary steps/410,111 bytes) passes [independent fresh reproduction](evidence/card-bleed-source-review/corrected/README.md), released at `a9a6615e`. It separates retained landed scratch from actual active-pass contributions: the run-end history contains5 fresh contributions, while the later ended tick processes none. The held `10519519` capture and all earlier failures remain preserved. Three semantic controls, comment/restoration checks and accurate Fire burn/backlash-only coverage are recorded. The Card report design now includes canonical B3 amounts, viewer-local numeric failures and the actual f32 wire-representability guard. Root dispatched the complete implementation at `22eef4d1` to a fresh DeepSeek session on `codex/deepseek-card-bleed-feedback`, base `03ec330b`; all source fixtures remain frozen. DeepSeek completed the three isolated numeric/earned-NPC restore probes; the actual receipts are committed at `97b70395` and [preserved separately](evidence/card-bleed-native-probes/README.md). Accepted generic player statuses produce one eligible +Infinity amount or a same-pair fold overflow at contribution3596 of4096 finite rows. A real physical attack/Release earns bleed on a surviving regional NPC, then restore refuses exactly `unsupported mob status domain`. These are reproduced gaps, not production fixes; Root approves the independently reviewed three-tag Card amount representation, with viewer-local typed errors after eligibility; a separate [NPC restore packet](backlog/packets/P-NPC-BLEED-RESTORE-1.md) is dispatched to DeepSeek on isolated `codex/deepseek-npc-bleed-restore`. The [privacy review](evidence/card-bleed-feedback-design-review/README.md) separates legacy
trusted totals from the deliberate native temporal-visibility extension. The public-output, capacity/identity and Claude shared-file lease decisions are recorded in the dispatched packet. The revised exact-pair sidecar and bounded indexes have a provisional static Full8 reservation estimate of21.5675MiB including tag/classification allowances; this is not measured use or native admission. Root rechecked clean primary `edc60c50`, reserved30/24/22/16 with unchanged wire14, and allocated only the reviewed hunks. Actual layout/allocations, source/privacy/restore gates and final union review remain required for native admission. The disposable probe Rust was removed, the canonical base restored, and the exact probe source/patch retained privately; no permission mode was expanded. The [remaining quest notice packet](backlog/packets/P-QUEST-NOTICE-CONTINUATION-1.md) is dispatched to DeepSeek Post Rust on isolated `codex/deepseek-quest-notice-continuation` after Stage1 admission, with no new capture required and only the approved internal teleport visibility hunk. Notice candidate `b4aa87f8` passed its finite source notices/views but received a [review HOLD](evidence/quest-notice-continuation-review/README.md) for meaningful binding/comparator controls, required item/offer state guards and default lint. DeepSeek's completed repair `e499d865` is independently [released](evidence/quest-notice-continuation-review/followup.md) and integrated as `51a43597` + `0085ff79`. Its6 focused tests, unchanged cases0/4 test, default/all-feature strict lint and format pass at the worker cut. Root's combined integration check also passes6 new +1 unchanged notice tests and format. Full181-record transport parity and Claude's real quest UI flows remain outside this bounded notice/preview witness. Earned regional NPC bleed restore is independently released after those clock/overlap repairs and integrated from `0be00f95` as `dedb8658`; [follow-up review](evidence/npc-bleed-restore-review/followup.md) preserves the prior HOLDs. The final added binary64 predicate-shape control is explicitly not an installed status or checkpoint trajectory. Six worker tests, affected overlaps and both strict lints/format pass; Root's [final composition check](evidence/backend-crash-npc-composition/README.md) now passes6 NPC +2 crash tests and format; the five-seed/two-run bounded release soak also passes (termination or truncation, not proof of all matches ending). No complete bot/quest parity, integration-union test,
deployment or Claude client acceptance is claimed.

## Technical demo delivery record (owner decision, 2026-11-09)

**Current hosting status, 2026-11-10 03:53 UTC:** the temporary test window has ended on its original expiry.
Guest termination, stack deletion and all11 independent resource checks pass; the sole test DNS record is removed and
verified empty after reload. **play.rougehalla.com is now offline.** The [cleanup receipt](evidence/calgary-demo-cleanup/README.md)
retains exact targets, operation results and local screenshot evidence. Historical “live” statements below describe the
completed demo window. Local builds/services/user data and worker WIP remain intact. NormalCI42748359516 at code9657cd56
is now terminal SUCCESS across all five jobs. Client/FPS/complete rendered legacy comparison remains with Claude under
the owner-imposed Codex Unity pause; this cleanup does not complete that remaining performance gate.

**NPC observation cache update, 2026-11-10 04:20 UTC:** private ItemObserver tile-history memo reuse now covers NPC
observations, preserving fresh LOS/ward/hidden predicates and existing cache sizing. Four new native differential controls,
20vision tests, the existing zero-warm-allocation pressure check,21content checks, full-faction headless PvE, strict rh-sim
lint and format pass. The [exact release measurement](evidence/npc-tile-memo/README.md) delivers600ticks/30s with sampled
processCPU4.41% of one core versus6.76% before, RSS18.48–18.61MiB and all normal result/cleanup checks passing.
This is a34.7% lower point reading from one run; differing spawn/reveal history and ambient/background work prevent attributing
all of it to the cache or claiming a general speedup. No world/wire/content/Unity field changed. The source cut85e2d7c2 is
locally verified and awaits its own normalCI; the prior9657CI remains green at its recorded cut.

**Unity ownership change, 2026-11-10:** the owner has paused all Codex Unity development and assigned it to Claude.
Unity code/assets/builds, client profiling and browser/Editor work are stopped. Root continues Rust/backend/AWS
coordination. The one approved local benchmark attempt ended before measurement with
`BROWSER_DEFAULT_FLAGS_UNAVAILABLE`; its private browser, native child and both listeners closed, independently checked.
There is no FPS result and no retry is authorized under this pause. The [handoff](coordination/CLAUDE_UNITY_HANDOFF.md)
records the current artifacts, WIP and evidence for Claude.

**Backend measurement update, 2026-11-10 03:10 UTC:** the first [paired M5 Pro backend run](evidence/m5-backend-first-pair/README.md)
now captures the same160×160 collision map, three ordinary Holy seats and a30-second movement window after warmup.
Both deliver600 observed steps. Rust's inner~29s process samples use6.69% of one CPU and18.38–18.48MiB RSS;
legacy uses5.46% and191.58–191.88MiB. This demonstrates about90.4% lower resident memory, **no CPU speedup**;
one active-workstation run, different interest/publication/storage/mechanics and CPU-clock precision prevent a maximum-capacity
or general regression claim. Both owned processes/listeners close independently. A separate10s native CPU sample points to
vision-trail/LOS and Frost/Sentenced scans for investigation; it changes no gameplay or prior measurement. Unity/FPS work remains
paused. Normal source CI at `02551405` also finishes green (all five foundation jobs plus separate latency checks).

The profiled [Frost guard reorder](evidence/frost-edge-guard/README.md) is now pushed at `9657cd56`:32 targeted tests,
21content checks, format and strict all-feature/all-target lint pass. Its correct PostgreSQL-enabled Mac release captures
another600steps/30s with all cleanup/result checks passing. Sampled CPU6.76% versus6.69% before establishes no CPU gain;
no favorable retake or deployed artifact replacement follows. The original no-CPU-win comparison remains the baseline.

The [actual Calgary WSS meter](evidence/calgary-wss-meter/README.md) now captures90 matched ordinary Ping/Pong samples
in one30s/3player stationary Source window: applicationRTTmedian10.72ms/p9521.54ms/max24.60ms; incomingapplication
payload3.68–5.99kB/s perclient (13.56kB/s total). These are Node protocol clients, not Unity/frame/input-to-visible timings;
wire framing/admission are excluded. All owners stay alive/Active with600observed ticks, normal socket/process cleanup passes,
and a later independent read settles publicSource0rooms/0players/6successfulresults,0failed/refused. Original shutdown unchanged.

**Technical demo update 2026-11-10:** owner-authorized Claude Wave1/security and the reproduced stale-echo repair are
composed at `fe0e2983`; 956 managed tests and 102 affected Rust tests pass at their recorded cuts. Web B
`build_81371688fcdf` is the current local release: 14 files/107,046,886 bytes, manifest SHA
`89aa154216996a7df694479d3efc990ffb73521de02dae143a15fa105b4a4455`. Its compiled Assets match canonical `3253da04`;
the Mac release binary SHA `c30fc84f9b284d0212d2bbe0d13c3b7d894f098d6d93271072df6b8ad6f1dc28` serves Source PID 63281
and Training PID 63295 through router PID 64050. 37 focused actual Editor cases pass across the retained runs; all five faction
ability activations and a genuine three-player PvP kill/Trophy chosen-and-taken state now pass in the ordinary browser
at 2560×1440/text 150%. Results capture is finishing. These are functional checks, not measured speedups.

The new-source Linux artifact run 42729941646 at `d265ab95` passes; its strict verified native binary SHA is
`dd7a208cc2b183268740a910d07db6aa7002260d6d1f9511cfaccf3e4791ce6d`. The temporary workflow trigger is removed at
`bac4820f`. The first actual Calgary guest `i-0b2f4485d0491740e` failed `rh-demo-isolation.service` and terminated through
the intended failure/poweroff path. CloudFormation completion did not establish readiness; no public hosted demo is
claimed by those failed attempts. The multiline repair reproduces old NFT syntax failure and passes the actual Ubuntu
parser. Fixed guest `i-00b97e48b4e5c4f31` now passes native/storage readiness, exact binary identity, actual NFT and
8mbit/fq_codel checks. **https://play.rougehalla.com is live** with valid public TLS. Root's actual hosted browser check
passes ordinary profile load, Training join,400ms Right movement and normal Leave to the menu. Production
**play.roguehalla.com** remains untouched. The original fixed shutdown is **2026-11-10 03:50:21 UTC** (November9,
20:50:21 Calgary). This is an ephemeral demo, not retained progression hosting.

An observed cold-load issue is corrected by the explicit response MIME matcher at `9859f700`: the installed Caddy
validates and gracefully reloads the exact candidate, and actual normal-TLS GETs now return gzip for both WASM/data
where the earlier requests did not. A complete normal-TLS download now verifies both decoded hashes against Web B:
WASM58,599,146→16,436,423 bytes (16.86s), data47,874,287→37,908,873 bytes (39.75s). These two HTTP bodies total
54,345,296 compressed bytes versus106,473,433 decoded bytes under the fixed8mbit limit. They do not measure Unity
startup or frame time. Hosted multiplayer, final frame-time/latency/legacy comparison and cleanup/release checks remain
open. Deferred content stays outside the demo critical path.

The latest normal source CI runs42729941642 (`d265ab95`) and42727133953 (`112f8ec7`) both pass provenance, simulation,
C# and card-source jobs but fail Rust's all-feature Clippy compile on the missing `RoomCmd::Input.received` test field.
The one-line test repair is `2c665f6a`; Root's strict all-feature/all-target `rh-server` Clippy passes in25.97s, without
running tests or rebuilding the release binary. Fresh normal [CI42739863259](https://github.com/Nevanyte/RougeHalla/actions/runs/42739863259)
at exact `388e35572f05f41e7cf0a16fb3d403a2fe4502ca` now passes all five jobs, including PostgreSQL lease tests,
headless/source checks and the actual Chromium/WSS proof. This supersedes the earlier failed runs at their recorded cuts.
Claude's newer `1f7c5460` is explicitly protocol15 WIP with missing C#/JS consumers and concrete bounded review
findings. It is not merged or deployed. The [focused completion handoff](coordination/CLAUDE_NETCODE_CHECKPOINT_FINISH.md)
preserves the approved speed direction and lists the actual interoperability/lifecycle/track/counterplay work.

The finite M5 profiling runner is composed at `64327d70`:24 scoped Node controls and its exact frozen-B
asset/dependency preflight pass. It enables the Chromium sandbox, excludes unsafe SwiftShader fallback and classifies
the actual renderer. The owner approved one local experiment; it failed before measurement and was cleaned up. The
subsequent Unity pause now prevents Codex repair/retry. Its proposed30s local-WS/three-seat/48×40 window is not a matched legacy comparison.
A fresh isolated Phaser production build and the actual shared160×160 map identity guard also pass. The first backend-only
common-map pair is now captured above; a matched rendered client/FPS comparison remains open under Claude ownership.

The bounded hosted Source protocol test now passes: two fresh normal accounts join the same WSS match, complete
ordinary Plan/Ready, reach Active/alive/nontraining, and each send one Move/Stop with accepted sequence0→1→2 and
delivered positions. Each sees the opposite-faction player through its own legitimate observer rows; local aliases are
not cross-compared with Welcome IDs. No attacks, rewards farming, grants or hidden reads. Both normal Leave/close and
the owned Node process exit are confirmed; final public Source is0rooms/0players/resultsFailed0. This is actual hosted
multiplayer transport/input acceptance, not a new hosted full-match outcome or frame-rate test.

The owner now prioritizes a complete visual/networked **technical demo as soon as possible** to measure Unity 2D and
AWS/Rust speed. Full quests, every augment/elite reward, advanced bot parity and production completeness no longer block
this delivery. The [demo scope and owners](coordination/TECHNICAL_DEMO.md) supersede earlier full-port release blockers
below; the existing Rust authority/privacy/input rules remain. Settings and icon-first HUD are composed at `68ef361e`,
with one combined optimized Web build and real core-match acceptance next. Normal `cdec` and `7401` CI each pass four
jobs; Rust stops at a demonstrated private-output Docker UID permission failure. The reviewed caller-UID fix reproduces
both unchanged historical NPC outputs exactly (13,952,630 and30,636,484 bytes). The reviewed native packaging repair
passes25 offline tests; its first Linux run compiled successfully but failed postbuild for an unknown reason, retained
as a failure. One diagnostic retry is authorized. These are preparation results, not completed demo/hosting/performance
claims. The actual optimized Linux retry42720842809 at8e3afa69 now passes build, PostgreSQL readiness, clean stop and
strict archive validation; the temporary trigger is removed/pushed at4b423b41. Root independently verifies the same
archive without executing it. Combined Settings/HUD14 focused cases pass after two retained fixture hierarchy failures
and literal-only test repairs; the single optimized Web build is in preparation. AWS CLI profile rougehalla-staging is
renewed through the in-app browser and STS confirms048226733033; the still-expired plugin connections no longer block
CLI-based staging preparation. An actual M5 release server build uses the existing render-trace cache at jobs1.

## Latest integration update (2026-11-09 21:45 UTC; before demo scope change)

The native identity remains **protocol14/checkpoint29/replay23/OBS21/policy15/content7c6a633f68c2cc72**. Canonical `optimization_port` now includes reviewed three-asset Unity serialization merge `5e19ef1b`; no P15 or full Brain activation is implied. The exact [Web57 artifact](evidence/unity-web57-admission/README.md) passes its fresh actual build, complete pre/post source/settings checks and Root's independent14-file/37-payload verification. Earlier native98 remains scoped to6d; both zero-case layout failures and the first successful compiler job's failed source guard remain retained. Actual browser flows and the raster matrix are next.

The [actual protection/cue Source witness](evidence/bot-protection-cues/root-first-capture/README.md) is now composed: all11 cases/1,056 ordinary World steps/2,112 complete Frames, with2,046 Percepts and66 startup nulls. Actual inputs now include player fighters, Bow/Wand lifecycles, delayed flights, containers and events. The [private MethodValue component](evidence/bot-temporal-method-values-root-admission/README.md) distinguishes source undefined/null/missing without public/schema changes. DeepSeek's [native replay](evidence/native2112-and-expiry-admission/README.md) now matches all2,112 inputs to2,046 outputs/66 nulls with zero numeric error; Root's merged three affected tests pass. All six Source semantic controls now reach their intended KILL and the comment-only control NONKILL; independent raw/outcome review accepts the [complete finite suite](evidence/bot-protection-cues-variants/remaining-six-controls/README.md). External reproduction, full fair publication and live Brain remain open. The full source Memory/strategy/reflex/hunt/loot/learning/tournament outcome path remains the largest implementation gap. A newly confirmed smaller seam is card-only bleed grouped hit feedback/run-end flush; existing bleed damage is implemented.

[Normal c52 CI](evidence/ci-c52-npc-context-root/README.md) passes four jobs and the Rust native/PG/placement/parity/offline14/both full-map smoke/vector prefix, then fails the unchanged NPC witness comparison on exactly the CONTRACTS documentation provenance hash. Source/config/tool bodies remain exact. An explicit historical-input wrapper preserves both current normative and frozen metadata inputs; Root's first corrected Source-only-limit continuity run now matches all13,952,630 original bytes. The runner/nested-continuity check also matches all30,636,484 bytes. Normal8da run42706253349 later fails in the wrapper without retaining its underlying receipt/error in the public job log; the root cause remains unproven, and bounded receipt/stderr/npm diagnostics are added before the next normal run. No captured gameplay expectation changes. The two earlier npm resource failures occurred before Source and stay retained.

The [readonly Linux device collector](evidence/staging-host-device-root-admission/README.md) is composed with20 author synthetic passes and independent source review. The [executable expiry component](evidence/native2112-and-expiry-admission/README.md) is now composed after the reviewed quiet-enable repair; Root21 synthetic tests pass. Real Linux/cloud execution remains open. The account chat next prepares a manual Linux release component build, with no dispatch/deployment yet. Actual browser startup resumed the same owned local PG cluster without new grants: all three durability settings are ON, restricted app role/peer socket checks pass, Source/Training/router start, then a public-metadata probe AttributeError stops the run. All four owned processes stop cleanly; no browser/profile claim/Hello/admission occurred. The subsequent [third bootstrap](evidence/browser-c52-local-bootstrap/README.md) corrects only the probe alias and passes public identities/readiness, all15 static URL rows, CORS and both no-Hello WebSocket upgrade/EOF checks. Known owned services remain alive. The first actual normal IAB Training flow now passes fresh callsign/LOAD/confirmed Practice/no rewards and400ms native Right movement/release; actual720p screenshot and receipt are retained. This finite visible baseline does not prove Arena, reload/Resume, banking or performance.

Complete current browser/account/quest/trader/result/reload acceptance, deployable durable hosting/backup/restore/provider lifecycle, full M5 Pro matched legacy performance and release/rollback checks remain open. AWS renewal remains owner-deferred; no new permission is needed for useful local work. Practice rougehalla.com, Calgary account048226733033, CAD20 TOTAL and unchanged production remain the operating scope.

## Reviewed protocol14 wrap-up checkpoint (2026-11-09 UTC)

This checkpoint supersedes the versions and pending descriptions below. The composed code identifies **protocol14 /
checkpoint29 / replay23 / observation21 / policy15 / content `7c6a633f68c2cc72`**. The lead owns integration into
`optimization_port`; a development checkpoint is not a hosted release. The [native29 admission](evidence/native29-admission/README.md)
adds source SlowStarter, complete MarkTax, pass-start PackLeader and the readonly WalkHint/timing producer. All63 strict source cases,21 content checks, the newly derived63-case native tape/checker and four public-digest checks pass at their recorded cuts. Earlier component/hash/restore/lint receipts remain revision-scoped; no second whole-workspace result is implied. [Actual canonical /info](evidence/native29-baked-info/README.md) supplies the matching generated BakedContent. The latest complete normal CI is [8e467beb /42631043999](https://github.com/Nevanyte/RougeHalla/actions/runs/42631043999), all five jobs green; this newer composition requires its own normal CI.

The [private temporal core](evidence/bot-temporal-core/root-admission/README.md) is composed and inactive. Root passes11 tests, including1549 actual Frame inputs→1541 matching Percepts/8 startup nulls with max numeric error0.0. Its empty fighter/flight/event families, native-only controls and public admission limits remain explicit. [Normal7a13 CI](evidence/ci-7a13-startup/README.md) fails at GitHub startup: four executed jobs pass, but Rust has no job/result; the internal server error does not close that required gate. A fresh normal run must attest the new Rust batch.

The [finite WalkHint boundary24 consumer](evidence/walk-hint-native24/root-admission/README.md) is now composed after three source-sequence test corrections. Root's existing/new WalkHint filter passes16 with two preexisting ignores. These are declared method contexts, preserving the separate direct-angle versus Cartesian coverage limit; no gameplay or identity change is implied.

The [combined client admission](evidence/native29-client-composition/README.md) records Root's933/933 managed run, fair-perception9, runtime admission7,34 scene-candidate regressions, strict workspace all-feature lint and subsequent server lint/format checks at their exact cuts. The original stale-cache compile and duplicate test-module lint failures remain explicit. This composition still awaits normal CI.

The [native98 functional admission](evidence/unity-resume98-admission/README.md) now composes explicit owned-seat Resume after all98 exact actual Editor cases pass once at frozen6d5d9340: the prior90 plus eight Resume cases. Root verifies the entire client/protocol tree matches that tested cut. The fresh isolated Editor and single approved generated settings overlay leave the original dirty Editor untouched. The312-payload portable proof retains original tooling/schema failures and the withdrawn pre-test release; three authorized preference keys restore, while dirty RAM/asset deltas remain explicit. Layout/raster, a current Web build and actual browser reload/settlement remain OPEN. Earlier [Training90](evidence/unity-training90-dropdown-editor-first/README.md), its failed layout observer and unresolved original AutoRefresh assertions keep their historical scopes. The [owned-seat tab checkpoint component](evidence/owned-seat-checkpoint/README.md) and initial-resume/Detach library are reviewed. The private [SceneCandidate socket](evidence/scene-candidate14-socket/README.md) passes39 scoped checks and is independently reviewed; it does not activate a new Room/client/public fact protocol. The original [composition receipt](evidence/root-final14-composition/README.md) retains its earlier exact cuts.

[Normal76d CI](evidence/ci-76d-staging-pin/README.md) creates all five jobs. Provenance, C#, card-source and complete simulation pass; Rust passes its native/default/PostgreSQL/placement/parity and lint gates, then fails one of14 offline staging checks on an obsolete frozen runtime fingerprint. Subsequent Rust-job gates are skipped. The [reviewed preparation batch](evidence/wrapup-preparation-admission/README.md) now repairs this with a consistent76d native refreeze, exact five-file coverage and stale-a0c artifact receipt refusals; Root14/14 passes at the merged cut. The same batch adds the independently reviewed nondeployable installer foundation and browser reload readiness after its exact-source check repair. Actual host and browser execution remain open. A fresh normal CI must attest this composition; the old red is retained.

Typed neutral quest givers, ordered NPC Frost sources, Sentenced NPC/group combat and all63 strict source cases are
composed. The actual Overkill threshold is registered without changing its arithmetic; strict predecessor refusals and
source-derived native tape checks pass. [Native identity admission](evidence/native28-admission/README.md) retains the
original checks. Owner combat and complete quest/trader metadata use the reviewed eleven-key Rust/C#/JS transport.
HumanBot consumes accepted decoded public frames; pre-accept failures preserve staged publication and panicked/refused
fallback proposals are discarded. Session affinity prevents cross-session NPC-reference equality, not NPC continuity.

The frozen e2 workspace run completed1928 passes/1 failure/11 ignored. The sole failure was an obsolete raw-callback
headless test. Its independently reviewed accepted-history replacement passes the full3-test target at43e6d08d; the
new two-case quest consumer passes there too. The remaining gates pass: postgres-feature server349passed/3ignored and placement236passed/0ignored,
strict all-target workspace lint with all features and with defaults, fmt,109 compared slice scenarios and300
path queries MATCH (13 additional cases are capture-only), and a bounded eight-player full-map headless smoke. Both test PostgreSQL clusters used durable settings
and were stopped. The original red run remains explicit; this is not a claim that a second complete workspace run was
performed. [CI42585284401](https://github.com/Nevanyte/RougeHalla/actions/runs/42585284401) at exacta0c4818c passes all five jobs,
including complete simulation, Rust/backend/source witnesses and C#. [CI42597461815](https://github.com/Nevanyte/RougeHalla/actions/runs/42597461815) at exactdb5ed80b also passes all five jobs, including the owned settlement read contract and private-proof guards. Later additions retain their own
revision-scoped receipts. C# net752/752 and JS49,311 checks pass; the protected provenance
chain is admitted and the new source witnesses are wired into CI without changing captured expected gameplay.

Live bot reset streams0/1/2 now match source with independent Knowledge3. The exact135-frame farm/mirror consumer and
native quest cases0/4 (including reached end closure and foreign-row privacy) are reviewed and integrated. The new
[normal-fight/orb source witness](evidence/bot-fight/README.md) is source-only:16 tactics sequences/47 frames,6 orb
sequences/20 frames and90 timing probes. The separately reviewed ownTimings helper now matches90 timing rows and6 nulls in three focused tests; it does not activate live fight. The reviewed normal-fight/Orb and sudden-death retreat components now match their captured methods (including the additional8sequences/46SDframes); they do not activate live fight. The [standalone Reflex component](evidence/bot-reflex-native/root-admission/README.md) is now reviewed and passes8focused composed tests over the actual49-sequence oracle and corrected37-row geometry. It remains inactive: live reflexes still require reviewed remote
Bow/Wand cues, projectile course/identity and own immunity facts; stable NPC hunt memory needs an explicit public
continuity contract. The [uncapped MarkTax witness](evidence/mark-tax-uncapped/root-admission/README.md) genuinely reaches nonzero tax through accepted Training inputs; the complete native consumer is now included in the native29 admission above. Its private owner/index/farm ordering and public-only digest retain their own tests. Root chose complete required fact publication, not a restricted bot subset as completion. The [earned living-return/actual Runner source witness](evidence/npc-runner-callsite/root-admission/README.md) is also reviewed:773real World steps, five delivery schedules and genuine Runner/Brain/filter demonstrate the source Memory discrepancy without changing native semantics. The intended-behavior choice remains pending. Full
strategy/reflex/perception/hunter/loot/learning/tournament-outcome acceptance remains open.

The quest journal, trader dialog, ordered duplicate notice feed and delivered-only map markers passed all20 actual
engine selectors at43e6d08d ([receipt](evidence/unity-player-flows-43e6d08d/editor-retake/README.md)). Planning quest review,
current typed participant lookup and consistent focused-text hotkey guards now pass all25 exact engine selectors atfa0c0891
([receipt](evidence/unity-functional-fa0c0891/editor-retake/README.md)). The typed Arena/Training launch and corrected captured-Arena disposal now pass all42 exact actual Editor cases at0aeddc5b (Quest8/Trader6/PlayerFlows11/Launch17). The [Root launch admission](evidence/unity-launch-native-gate/root-admission/README.md) binds all source/result/cleanup receipts and the773/773 composed managed run; it preserves all three prior failed42-case runs. The later [owned settlement UI admission](evidence/unity-settlement-native-gate/root-admission/README.md) adds an actual frozen5457b9c0 Editor run: all64 cases pass once (the previous42 unchanged plus22 settlement cases). It binds genuine Result/current Welcome UUID, owned account generation and Session/epoch to the existing strict settlement API, with bounded reads and stale success/error fences. Source822/822 managed passes retain their separate revision. In-tab mode selection/return and settlement adoption are accepted in this Editor scope; genuine game-to-receipt browser proof remains open. A read-only package audit confirms the selected and loaded builtin Test Framework1.6.0; earlier1.4.6 mismatch wording referred to a nested Collections requirement. No package files changed. Earlier recovery2
and binding4 passes keep their own exact scopes. Opening views does not spend or invent server rules. Same-session
clock cuts and rebinds fence stale callbacks. BakedContent is generated from a real loopback server /info; the older proof below used643d294869db55a4, while the current native29 preparation above uses7c6a633f68c2cc72. An actual matchinga3d4b3ce baseline Web build succeeds (14files/106,765,469bytes); its later
Unity changes are outside that artifact. The actual browser run reaches ordinary profile claim, join, movement, active
HUD and same-seat resume with a rendered scrolling drawer. [Attempt03](evidence/unity-web14-a3d4b3ce/ROOT_ADMISSION.md)
retains rawPARTIAL/7PASS/5OPEN with zero contract failures; Root separately admits the finite rendered subcases. Original
attempts01/02 remainFAIL. Complete browser/account/banking acceptance remains required.

Explicit protocol14 full-game endpoint admission is now reviewed: `--runtime source-arena --map <rh-map/2-export>`
requires the validated source map and enables Source planning, all factions/Wish, quests, PvE, loot and terrain;
`--runtime training` selects a separate solo/immediate practice endpoint without normal results/replay. No flag retains
the previous core endpoint. The actual encoded-router tests include the captured160x160map reaching Active, quest
acceptance and stat trade through public-coordinate navigation, and isolated Training/resume. See the
[batch receipt](evidence/root-runtime14-composition/README.md) for exact source, scoped243passes and six overlapping
postgres-feature memory-backed runtime passes. No database restart, hosted, long-match or browser full-game claim follows.

The [fullSource result bridge](evidence/full-runtime-account-bridge/README.md) now proves actual HTTP-owned hosted seats,
Plan/Ready, ordinary public-coordinate combat, real native kill/award, fsyncedspool→committedPostgreSQL→authenticated
profile/leaderboard, genuine duplicate/foreign-owner refusals and private replay throughEnded. Author final004 and
[Root's fresh durable retake](evidence/full-runtime-account-bridge/root-retake/README.md) pass separately with durable
settingsON and both ownedclusters stopped. Native50ms steps use accelerated3ms wall wakes on the unchanged smallmap;
this is no physical20Hz/browser/full-map population/cloud proof. Client match-correlated bank confirmation has finite Editor acceptance above; genuine browser acceptance remains open.
The [allocation measurement isolation](evidence/csharp-allocation-isolation/root-linux-admission/README.md) is reviewed after an actual23case Linux diagnostic, preserving all existing byte budgets. Original986CI has a retained751/752 C#allocation failure with1128unattributed window bytes; narrow diagnostic success does not relabel it or replace normal integrationCI. The subsequent exact1a1ac8d7 normal CI42610654982 also fails C#756/757 (protocol1 allocation120.108 versus120;2160extra aggregate bytes), while provenance/simulation/Rust/card-runtime-source all pass. A single private full-context Linux diagnostic42625291466 passes the normal757-case suite but fails five traced cases: three have outer-window extras and two have isolated measured-body spikes. The decoder-free object control also has an outer-window gap. These observations do not establish a physical cause or explain historical failures; body-only subtraction would still fail two cases and is not an admitted fix. The private diagnostic workflow is not merged. Budgets and normal CI are unchanged. Later exact3126e5c3 CI42615460588 passes provenance, C#, complete simulation and card-runtime-source, but fails the Rust job at an unlabelled8s runtime-admission fixture predicate. The [reviewed test-only repair](evidence/ci-runtime-admission-3126/README.md) waits for the current broker Move acknowledgement and actual public arrival rather than retained quotes; its seven focused tests and strict lint pass without changing the deadline, production or Trade assertions. A reproduced stale-quote race demonstrates the fixture defect without retroactively identifying the original anonymous predicate. Exact8e467beb normal CI42631043999 subsequently passed all five jobs; the newer native29/client composition above awaits its own normal CI. The [owned settlement API](evidence/owned-bank-receipt/root-admission/README.md) now supplies a minimal authenticated
unknown/committed read of the actual same-snapshot result/ledger credit. Its30fixture/API checks and security review
pass; client receipt adoption now has the64-case Editor acceptance above, while genuine game-to-receipt browser acceptance remains open.

The earlier native b4 player-loop frame1/noPNG failure remains held separately. The actuala3d browser screenshots now
show the drawer rasterized without cyan in the inspected views; this does not turn its failed harness run into a pass.
See the [rendered proof contract](ui/DRAWER_PROOF_CONTEXT.md). Prepared assets remain separate; audio sample-rate acceptance
is unresolved. The [offline Calgary preparation](evidence/staging-training-backup-guard/root-admission/README.md) is reviewed with14fast tests, but remains explicitly nondeployable; no host installer/actual backup/cloud run is admitted. The owner deferred AWS login renewal. Durable Calgary
hosting within the TOTAL CAD20 cap, regional tests and the matched legacy performance comparison remain open.
Production play.roguehalla.com is unchanged; practice rougehalla.com is authorized. No60FPS goal/cap is introduced.

## Previous consolidated checkpoint (2026-11-08; historical)

This checkpoint supersedes the older implementation identities and status descriptions below. **The full port is still
in progress.** The owner requested repository consolidation after parallel DeepSeek, Kimi and Cursor work, appointed
the OPTimization_port Codex chat project lead, and asked to keep active workers running. The lead owns merges and
acceptance; the [coordination record](PROJECT_COORDINATION.md) defines lanes, report requirements and next gates.
The original full-port requirements remain; the earlier playable-core staging milestone and its cleanup are historical.

The primary project checkout now owns **`optimization_port`**. The former managed checkout is retained as a clean detached
review snapshot. Use `git worktree list` to locate the checkout on the branch before writing; do not edit the detached
snapshot. Worker checkouts remain isolated, and the original loose owner prompts remain available locally.

The integration branch is **`optimization_port`**. Current identity: **protocol13 / checkpoint25 / replay19 /
observation19 / policy13 / content `67183626db240b6a`**. [ADR0021](adr/0021-protocol11-union.md) records the union
of parallel transports and their exact tag/readiness assignments. Earlier protocol/checkpoint numbers in packet reports
are branch-local history. Native integration includes the 80-card runtime, faction/consumable/mob continuations, Source
arena/training, quests/traders, bot core/planning/fill and tournament prefixes; none of those labels certifies all packet
remainders or complete public/client flows. The Cursor card runtime was reviewed against the wider admitted native
runtime; its native training fix was retained, and competing runtime/schema changes were not layered on top.

The admitted Wish/Trophy union is based on frozen native/runtime `1310ae002870bf3fc674c7b65f38ff5ea55a7d75`.
[ADR0023](adr/0023-protocol13-wish-trophy-admission.md) records its final identity and extends ADR0022's checked
barrier/Wish contract. G6 Second Skin producer/decay, player Frost resistance and basic-NPC recipients, MarkRate history,
private owner Trophy lifecycle/format/availability and all supported wire options are composed. Gathering Storm remains
a direct-grant compatibility domain, not ordinary INTERACTIVE acquisition. Frost NPC sources/checkpoint26/replay20 are a
separate reviewed future candidate; Sentenced NPC/group combat and five strict source-born Wish cases remain pending.

Unity keeps authoritative movement reconciliation and same-frame input submission. All three codecs agree on13; owner
Trophy rows are now published whole after eligibility, with exact typed binary64 gain and ordinary Choose. Checked
barrier views and all five ordinary player Wish input/stock/lifecycle facts are supported under explicit --wish-full.
No hidden target coordinate fallback or partial option compaction is introduced. Quest/trade and remaining player flows
stay open. Measured RTT admission and source held-attack lag semantics remain unchanged.

The fresh frozen gate passes830 workspace-excluding-sim tests; real PostgreSQL16.15 server332/two existing ignores and
placement postgres+fault236 are separate overlapping feature suites. Both strict workspace Clippy modes, formatting and
parity109compared +13capture-only +300paths pass. Simulation coverage remains split by revision, including the earlier
609 non-map prefix and later affected checks; unchanged191 map units were not repeated locally. Rust protocol93,
C#399, JS18,205 and actual pinned Editor62 tests pass at their recorded source identities. These are not an inflated
single full-workspace count. CI42517747299 at70579162 exposed a stale training observation18 guard and one stale protected protocol13 JS-checker
metadata pin in the card-catalog capture. The focused fixes retain all409 source cases and pass13 training tests;
[the follow-up](evidence/ci-card-catalog-protocol13/COORDINATOR.md) records the failed run and exact repair scope.
Subsequent CI remains revision-scoped; older green runs are historical evidence.

CI42521426323 atdf0d7bb8 now passes the complete simulation job and C#. Native Rust/default/PG/placement, strict lints,
parity/headless and the complete source campaign pass before the final browser step. That step exposed another stale
protocol11 assertion; the [driver repair](evidence/ci-browser-protocol13/README.md) passes a focused15-check local
Chromium WSS proof against a freshly built native df0d7bb8 dev binary. The separate
[card-runtime provenance repair](evidence/ci-card-runtime-provenance/README.md) is now admitted throughc14fd959:
genuine pinned recaptures change only4/4 runtime and14/14 witness metadata leaves; root independently compares all
non-provenance payloads/private records, checks every source/harness pin and original FROZEN pins, and verifies27 portable
evidence hashes. The separate checker reproduces both positive/negative controls. The original workflow remains
**failed**; both repairs now await the next exact integration-head CI run.

The follow-up CI42525598022 at `a894574f` passes simulation, C# and the card-runtime source job, but the Rust job
fails its catalog capture: the browser-driver repair changed the exact protected `tools/browser-proof/proof.mjs` hash.
This is a second provenance dependency, not a changed409-case source payload. A bounded metadata-chain repair and fast
read-only provenance auditor are assigned; this run is **failed**, and no final green-CI claim follows.

That [browser provenance-chain repair](evidence/ci-browser-provenance-chain/ADMISSION.md) is now admitted through
`90574c57`: actual pinned recaptures retain all payload/private records, original FROZEN pins and explicit prior lineage.
Root independently verifies exact1/8/8/24/24 metadata differences, all non-provenance content,37 portable evidence hashes,
and the passing fast auditor. The auditor checks all78 catalog source/five harness/325 protected entries plus runtime/
witness references. A new early CI job gates the four existing jobs on that check, without removing any native/source
tests. [CI42531608964](https://github.com/Nevanyte/RougeHalla/actions/runs/42531608964) at exact checkpoint
`a31f02e188b9712cdad8db6b7467bdb4f03ef966` now passes all five jobs: provenance, complete simulation, Rust/backend
(including PostgreSQL, strict lints, source recaptures and Chromium WSS), C# and card-runtime source. Older failed runs
remain historical failures. Later recovery/package/source additions and private Full/protocol14/Unity candidates are
not covered by that exact-head result; each retains its own focused evidence and remaining integration gates.

The subsequent [CI42536838870](https://github.com/Nevanyte/RougeHalla/actions/runs/42536838870) passes all five jobs at
`dbd70f9d810330099b754281b70d511a60f62cf8`, including the admitted recovery-key accessor, direct Unity package pin and
human-eligibility source evidence. The later [operation-owner query](evidence/account-operation-owner/ADMISSION.md)
is admitted after31 focused API tests and independent review; it gives the Hub a read-only registration/current-owner
check while preserving unknown transaction history and the existing SendAsync authority. Its UI adoption remains
separate, and that later commit is not part of the recorded dbd CI result.

One actual final Unity Web build passes,14files/74,247,550bytes. Generated BakedContent is aa64c642; the manifest binds
frozen1310 source, exact as-built serialization overlay and the dev server binary SHA20d5b70e…5b4b0. Independent checks
verify82source hashes,24packaged build-evidence files and all14served resources. There is no embedded runtime revision
stamp; build identity relies on that recorded chain. [Actual browser acceptance](evidence/frozen-browser-1310/README.md)
passes all five normal R abilities through trusted input, same-frame Cast, own server FX, exact applied presentation and
stock spending, with the normal45second readiness. A separate real three-seat Trophy path passes ordinary victim Boost
acquisition/Build increase, trusted Unity credited kill, trusted HUD Choose and authoritative Picked/Taken/TakenBy.
Incomplete driver attempts are retained. Browser wire has no cumulative killStats: exact native grant is separate
matching-source backend proof. No display/input-to-photon, final full-game performance or cloud claim follows.

A later valid native training growth case uncovered another transient-scratch preparation hole: two ordinary Camp
commands create more actors than the eight-seat default before the same step's after-weapons pass. The minimal
[backport](evidence/ci-card-catalog-protocol13/TRAINING_GROWTH.md) prepares actual actor scratch immediately after
birth, without extra input, altered rules or identity changes. Root passes the new growth and two existing input-free
restore/Clone regressions. The public training admission gate stays unchanged.

The [actual-source quest/trader public witnesses](evidence/quest-trade-public/ADMISSION.md) throughf034ace7 are now
admitted. Root pinned bytechecks and8semantic mutant kills/two provenance-only non-kills/restored controls pass. These
are declared method/schema/receiver rigs, not Room/socket/Unity proof. Finder-adjusted hidden count is distinguished
from raw unpublished count; source rolled trade-offer disclosure is recorded without granting Rust publication.
The [local account cross-path proof](evidence/account-durability/README.md) connects actual HTTP-issued credentials to
hosted admission, observed away→resume, real combat/results/spool and authenticated profile/leaderboard after service/
pool reconstruction. Root independently passes the new real-PG test1/1. It does not certify process-kill/database
restart, cross-volume recovery, backup restoration or missing Unity account/training/placement flows.

The repaired account clientf993 is admitted as reusable HTTP/credential infrastructure, including36 account cases in
the recorded435-test C# suite and both actual-listener preflight configurations. Independent review closes the request
header/CORS and cancelled late-claim storage holds. Its [actual pinned Editor gate](evidence/account-editor-f993/README.md)
passes four JsonUtility/PlayerPrefs tests; root verifies489 tested project hashes (including the recorded whitespace-only
serialization overlay) and21 exact adapter files. It does not yet wire normal menu/Join, implement full-profile maps,
prove browser reload durability or establish bank completion. The account owner supplies reusable lifetime/origin APIs;
the separately owner-approved Unity UI modernization lane owns their functional Bootstrap/MatchClient/MatchHud integration.

The [local cold-backup/restore proof](evidence/backup-restore-proof/ADMISSION.md) is admitted through `b9785ecf` after
independent fresh execution and focused assertion strengthening. Distinct durable PostgreSQL clusters, actual HTTP and
combat-produced pending spool records, explicit old-writer fencing, logical dump/restore, exact metadata/original-time
retention, duplicate replay, live-lease and successor-fence controls pass. Root verifies all19 portable evidence hashes;
production server/persistence code is unchanged from the tested base. This extends the earlier service-reconstruction
proof to a quiescent local cold restore; cloud/PITR/power-loss and populated purchase/bot-learning recovery remain open.

A [fresh-import Unity settings repair](evidence/unity-tagmanager-parser/README.md) is admitted at `f4f418be`. Two isolated
pinned Editor probes show27 bare empty layer entries caused parser errors; explicit empty strings remove those errors
while retaining all32 layer names and sorting-layer values. The existing live Editor was untouched. This is settings
parser evidence, not acceptance of the pending combined UI/Web build.

The [eight source quest-giver witnesses](evidence/quest-giver/ADMISSION.md) and
[five native/source pending-Wish terminal cases](evidence/wish-terminal-producers/ADMISSION.md) are admitted through
`146264b8`. Independent review exposed and repaired runner exit-status, failed-hasher and double-restoration defects;
root executes the real-runner disposable controls and exact payload verifier, plus the integrated terminal consumer and
its strict lint. Giver evidence does not implement a native neutral actor. The terminal test changes no gameplay and
does not close the five strict source-born NPC signature prerequisites.

The [reusable account coordinator/full-profile APIs](evidence/account-full-profile/ADMISSION.md) are admitted through
`538de384`. Independent review and repair close current-leaderboard-error binding and exact purchase409 classification;
root verifies all36 authored manifest files. Ownership-safe rich reads, stable purchase intents, explicit uncertain
outcomes, immutable presentation catalogs and generation-fenced leaderboard data are available to the UI lane.
The separate frozen first-UI/account composition passes554 C# tests at `cc7790b7`; actual combined Editor/Web screens,
UPM direct pin, deployed preflight and reload/banking guarantees remain open. No native gameplay/wire identity changes.

The [explicit current-owner recovery-key read](evidence/account-recovery-key/ADMISSION.md) is admitted at `ab95420a`
after independent generation/selection/account-reference review; it performs no I/O or state change. The UI still owns
deliberate masked reveal and clearing. The [actual UPM package pin](evidence/unity-combined-d660/package-pin/README.md)
is separately admitted at `86ead858`: official Newtonsoft3.2.2 is now direct rather than transitive, with no version or
unrelated dependency drift. The combined candidate's actual Editor run remains **failed:71/82 passed**, with11 UI/test
failures and a separate invalid offline fixture. No layout/Web acceptance follows; repairs are isolated from main.

The [human/bot quest-eligibility source evidence](evidence/quest-human-eligibility/ADMISSION.md) is admitted through
`b6d8ae75`: six producer scenarios, three bounded unreachable histories and two labelled malformed-state diagnostics.
Independent review verifies125 source/14 tool pins and the corrected real-signal driver. Declared region-wipe helper
and unreachable/mutant limits are preserved. This source-only admission does not close native/public quest flows.

[Frozen gate scopes and receipts](evidence/native-wish-union/FROZEN13_GATE.md) supersede the private pre-admission status
below. The older results and artifact descriptions that follow retain their historical revision limits.

Validation is recorded as split, revision-scoped gates rather than an inflated aggregate: **1,401 distinct Rust tests**
passed across the consolidated native and remaining-workspace batches, including real private PostgreSQL. The 191
unchanged map-generator unit tests were deliberately excluded locally; three existing manual tests were ignored.
Subsequent affected server/reward/checkpoint/hash tests pass. Both strict workspace Clippy modes, formatting and the
parity report pass: **109 compared scenarios and 300 pathfinding queries MATCH**, with 13 separate capture-only cases.
C# passes **329 tests**, synchronized Unity net sources pass, and JS passes **16,656 golden checks**. The pinned
Unity **6000.0.85f2 WebGL-target Editor compile** and actual **15-check Chromium WSS proof** pass. This compile is not a
fresh full Web player or performance claim. [Consolidation evidence](evidence/git-consolidation/README.md) records
exact batch scopes, code repairs, receipts and preserved recovery refs. Source metadata reconciliation did not alter
expected gameplay payloads or claim a new capture; the derived ability hash tape admits 58 cases and retains five
named full-source prerequisites as strict pending work.

The reviewed Unity 2D presentation through `55825c10` is integrated in `46ceebba`, with runtime `4f37e9f0` based on native
gameplay `e90a38f6`. The bounded follow-up adds readable native potion notices, five distinct unlit faction footprints/
backed insignia and Accurate normal lighting on High via mutually exclusive authored presets. Existing light budgets,
visibility removal and lower tiers are preserved. All 14 files in the 74,041,096-byte Web distribution match on disk
and over local HTTP. Twenty-seven EditMode tests, the test-only diagnostic cleanup, all 19 required browser outcomes
and three new High GPU windows are verified against revision-scoped evidence; six proof/census tests pass after merge.
GPU p99 is 5.848/5.795/5.813 ms under the 6.944 ms diagnostic limit, with no disjoint observations or resource errors.
[Repair verification](art/REPAIR_VERIFICATION.md) and [portable evidence](art/evidence/repair/summary.json) keep the
earlier `ebff286b` artifact and nine profiles separate. Workloads differ, so no isolated performance improvement follows.
The staged normal-input A/B and bounded static color-vision review pass their stated scopes; full live faction, motion,
telegraph and art coverage remain open. Captures use a real 2560×1440 backbuffer, but the physical display is
1920×1080/60Hz. Displayed 144 FPS and managed allocation throughput remain open. Callback/GPU diagnostics do not prove
displayed frames, and the older-base artifact is not a fresh final-union build.

The later delivered prop/signature distinctions and no-network catalog action/eight-direction selector are integrated
through `f16bca0d`. Their complete Unity project tree matches tested source `04d8de08`; Unity6000.0.85f2 recompilation
and42 EditMode tests pass (14 new,28 existing). Root verifies nine raw artifact hashes and31 source-manifest entries.
This is [source/Editor admission](art/evidence/source-cues/ADMISSION.md), with no new runtime/performance claim. The
separate audio research is excluded. Camp-stock and these cues await the next final-union Web/client-flow batch.

The camp-potion stock follow-up `289a01e2` is integrated in `ecf9564c`: the HUD invalidates and shows the canonical large/
camp count, including large-only changes and inventory clearing. One actual-HUD Editor regression and a1.50-text
maximum-stock layout check pass. This is source/Editor evidence; the served Web artifact remains `4f37e9f0`. The delivered-
cue proposal `88dbc5cf` is retained in `ae11f90e`; its later drafts and audio research are not admitted runtime work.

The latency lane's controlled measurements remain bound to its
recorded older candidate, not the new union or display/input-to-photon latency. The bot Knowledge/fair-view prefix now includes the independently reviewed
[RNG/rounding/null repair](coordination/KNOWLEDGE_REPAIR.md) `fdea457b` (57 policy tests, three semantic mutants and
canonical byte comparison pass). Bot learning is admitted with the independently reviewed exclusive-session lease,
bounded shutdown and source-order repair `3619280f`. It defaults Off and connects only managed-faction learning; 246
affected server/persistence/policy tests, both strict Clippy modes and formatting pass. The tournament CLI/JSON prefix
now includes the reviewed timer/write-error repair in `cc2cbb69` (13 focused tests, including a flush-only failure
control). Bot fill/configuration and the exact Unicode trim follow-up are admitted in `43abe070`, with 384 affected server/policy
tests, both strict workspace Clippy modes, formatting and a fresh 15-check WSS proof passing in an isolated target.
Effective fill precedes optional profile-name lookup; disabled fill performs none. Further tournament telemetry stays
isolated. New Rust consumers reproduce 300 pathfinding queries and all 723 prediction walk samples exactly; no goldens
were rewritten.

The completed DeepSeek composition was reviewed as four units against its actual base `455a202f`. A–C are integrated
in `fdf65513`: explicit bot-seat overrides preserve automatic-fill draws/defaults, Committed refuses second-slot barter
before spending/cooldown, and quest run-end/camp-clear captures use actual producers. Candidate D was held for semantic
defects despite green lane tests. The reviewed repair `c9bdf0d8` is integrated with it in `8ce725db`: learning defaults
Off/refuses unsupported On, gameMs averages individual worker durations,256-command queues bound jitter consumption,
and delayed commands resolve before every actual step even when the policy is not due. Advanced damage/first-hit
telemetry is explicitly unavailable, rather than understated. Full manager timing, active learning, recorder production
and full-brain outcomes remain open.

At the composed union, **956 remaining-workspace tests** pass with real private PostgreSQL (two existing manual ignores),
plus20 disjoint affected simulation tests. Bot-fill16/16 is already included in956; do not double-count it. Both strict
workspace Clippy modes, formatting and15-check real Chromium WSS pass. All five affected pinned source-capture commands
reproduce byte exactly. Unchanged map campaigns were not repeated locally; full CI remains revision-scoped. Identity
remains11/24/18/17/13/content `801a76cde4cfd305`. The [fair-view review](coordination/FAIR_OBSERVATION_ADMISSION_REVIEW.md)
keeps broad observation changes held. The corrected partial source [witness](evidence/percept-witness/README.md) is
integrated in `b0310e73`, with no production/version changes. Root source recapture, three semantic mutants/restored
control and four focused native tests pass; actual room lifecycle, committed prepared carry and visibility-time
equivalence remain unproved. The later barrier-view source slice is admitted in `33d72c34`: six corpora reproduce
byte-exact with four compiled semantic mutants and restored control. This is source-only method/schema evidence;
real G6 caller and native/client publication proof remain separate. Corrected source human Wish witnesses through
`ecda2212` and Trophy lifecycle/text evidence through `f9dcaea0` are now admitted in `6dfe9116`/`3af96c1a`. Root reproduces
both source families byte-exact and5/4 semantic mutants with restored controls. The Wish terminal-batch selections are
corrected; removed source IDs remain a labelled disclosure, and native redaction is a separate correction. Trophy's
old whole-file mutant claim is withdrawn: named case mismatches exclude provenance, with a provenance-only non-kill
control. These are method/source witnesses, not real keyboard/scene/native transport proof. Both captures join CI.
The next G6 heal-barrier assignment
is a private native candidate under its [packet](coordination/P-G6-HEAL-BARRIER-NATIVE.md), with checkpoint25/replay19
reserved only for that candidate and a new content identity required. It cannot activate on the public profile before
the lead resolves barrier publication/gating.

Private continuation is now allocated under [ADR0022](adr/0022-barrier-wish-publication.md): one protocol12/
Observation18 Wish/barrier publication candidate, with actual producer-time cues, anonymous permitted spatial landings,
strict coordinate redaction and explicit per-frame source time. Main identities/guards are unchanged. Native checked
observation work and networking PhaseB proceed with sequential shared-file leases. G6 handover is complete at
`2a384510`: actual before/after-slot callers and anti-heal pass review, root's private G6/Frost composition passes67
focused native checks and both new source captures reproduce byte-exact. State/checkpoint/format/hash-coverage passes
to networking; final content and derived tapes remain lead-owned. The private barrier numeric source consumer
separately passes5 tests plus warm zero-allocation. A separate
[Frost-resistance packet](coordination/P-FROST-RESISTANCE-1.md) fixes missing victim
slow resistance in the admitted player domain. None of these private assignments closes full NPC signatures, brain or
public/client gates. [CI42485021427](https://github.com/Nevanyte/RougeHalla/actions/runs/42485021427) at `01b14dca`
passes all four foundation jobs, including full simulation and the corrected partial perception evidence.
The subsequent [CI42492522571](https://github.com/Nevanyte/RougeHalla/actions/runs/42492522571) at `fb738cd9` also passes
all four jobs, including the newly admitted source barrier capture. This precedes the new Wish/Trophy source admissions
and does not validate the private protocol12/gameplay union. Cross-feature private testing found and repaired a legitimate
Iron Will/Sentenced Mark checkpoint rejected by the old two-increment progress validator. Reviewed `e6f9680a`/`c5b11341`
add historical resisted/deepened progress and monotonic
card-tier bounds, with real grant/swap/training Clear controls. Root composes it in `bc9cdd7b` and independently passes
all26 affected Sentenced tests; lane70 focused tests/both strict lint modes/fmt pass. This changes restore validation,
not gameplay, schema or identities. The separately diagnosed Gathering Storm MarkRate consumer remains the next
bounded native/source task; it is not covered by the restore repair's gameplay-parity claim.
The complete networking candidate `a40e1c6e` is now composed privately in `f62af90f`; actual Unity R/render proof and
final gameplay content/derived-tape composition remain open. NPC Frost recipient candidate `7d831c28` remains held:
missing Plague/draw/return/death proof, mismatched active installer profile, partial comparisons and other affected
actor-form restore checks are assigned in its repair packet. No full NPC signature gate has been removed.

The initial pushed CI passes C#, native card-runtime source, legacy recapture, hosting and latency-report checks. Rust
CI exposed an admission-test lifecycle race: two fixture players could start/end a match, so an expired reservation
retry correctly met session_ended precedence. `36a3222b` keeps that TTL scenario in Lobby and asserts HTTP/phase facts;
all 24 control tests pass in default and all-feature modes, with no production behavior or longer sleeps. The next run at `b01fc9e2` then passed all1,520 default workspace tests (three existing ignores), including the map suite,
but reached the cumulative40-minute job limit during later source/feature gates. The final workflow partitions the
complete simulation suite from remaining backend/source checks in parallel, preserving the former feature union and
all checks; CI symbols are disabled and each job is bounded at60minutes. [Run42471329922](https://github.com/Nevanyte/RougeHalla/actions/runs/42471329922)
at `48f4bb28` passes all four jobs: Rust, simulation, C# and card-runtime source. The subsequent art admission changes no
native code, net library or workflow. The observation-leaf proposal needs lead approval and a fresh version before
brain memory/strategy consumers proceed. Full recorder/brain and public-flow continuations stay isolated until
reviewed. The bounded art lighting/readability repair is admitted; source-only delivered-cue drafts are separately scoped
and future visual gaps return to the lead before new
implementation, preserving Rust/full-game public-flow priority.

Git metadata was backed up before repair; renamed worktree links were repaired, stable dirty histories were committed
to recovery refs, and 46 clean merged historical worktrees were removed without force while their refs were retained.
The stale missing registry entry was pruned; a process-owned historical tree and active workers were kept. Exact owner
prompts/design PDFs are archived under [agent-prompts](agent-prompts/README.md), with originals still available locally.
The [restore/disposition map](evidence/git-consolidation/historical-worktree-dispositions.json) and private full-ref
bundle/common-dir archive preserve recovery. Historical nonancestor legacy branches are not wholesale merged into the
Rust port. No production deployment or new cloud resource was made by this consolidation.

Calgary/practice-domain staging remains removed. CAD20 is a **total** cap; no account-plan or spend expansion is implied.
Fresh CLI identity verifies the approved staging account ending3033 with explicit Calgary ca-west-1; scoped old EC2,
volume, address, bucket, stack and VPC resources are absent. AWS Core also freshly verifies account3033 and Calgary opted-in through the explicitly selected staging connection;
both read APIs succeed. CLI and connector access are available, without new permissions or account changes. The owner session Billing console was inspected read-only; detailed evidence
stays in the local coordination archive. No new launch, paid billing API query, account-plan or DNS change was made. Complete gameplay parity/headless, public transports, browser/
account flows, durable progression, regional lifecycle and matched full-game performance still gate completion.

## Stage 2 working checkpoint (2026-11-06)

Implementation branch: **`optimization_port`**, starting at `e7e85338` (the closing Stage 1 documentation merge).
Implementation checkout: a separate local worktree; the original `Fix-autos` checkout and its untracked prompt files are
preserved. A detached, unmodified checkout of `e7e85338` is used only to establish the baseline. All Stage 2 implementation
edits and commits belong to `optimization_port`.

### First playable release scope — owner decision 2026-11-05

The owner selected **playable core first** to improve development efficiency. The immediate milestone is one complete
browser-playable match with combat, mobs, a small card/chest selection, a functional Unity HUD and one AWS staging region.
Quests, traders, advanced bots, visual polish and large-scale hosting tests are deferred. Original full-port requirements
remain in the backlog; they do not all block this first milestone. Included Rust gameplay/parity/headless precede its HUD.

The finish line is an actual join/start → fight players and mobs → obtain loot/open chests/apply the selected cards →
finish/results loop in the Unity browser build. Verify reconnect and authoritative results, focused parity/restore/privacy
checks, and MVP performance on the M5 Pro. Deploy that loop to the practice domain in one region with valid TLS and
the existing **CAD20 total** staging cap and cleanup. Production remains unchanged. A library test or helper is not an
end-to-end milestone; progress reports should lead with playable capabilities. Extra content, polish and scale work wait.

### Full-port continuation — owner decision 2026-11-06

The owner explicitly confirmed **continue this same goal through the full original port** after the playable-core
milestone. Earlier MVP deferrals are sequencing decisions, not removed requirements. The complete Rust game/parity/
headless foundation again leads the next implementation work; Unity rules remain prohibited. The
[requirements audit](evidence/stage2-scope-audit/README.md) records42 requirements and the original five completion gates,
all still partial at full-port scope. The bounded Calgary run was cleaned up and verified at13:03:33UTC after the
scheduled13:00 DNS removal; continuation does not enlarge CAD20 total or authorize a Paid-plan upgrade/production rollout.

The bounded P-TERRAIN-1 native kernel is integrated after independent review: ember, bog, ice and light use the ordinary
Rust movement/ledger/heal paths, with private clocks/statistics, source hook resets and restored path-array identity.
Its witnesses retain66 original cases,11 ice traces and a separate21-case/88-frame actual-born NPC extension. Both
pinned Linux amd64 Node22.23.4 captures reproduce byte exactly; CI checks both. Twenty born cases fully compare; the
lethal-credit case preserves an exact full-world reward-card mismatch. Full P-TERRAIN-1 remains **INCOMPLETE**.

Current native identity: content `e95d55ba96b2feca`, checkpoint19/replay17, observation15/policy12; protocol6 unchanged.
The independently reviewed bounded P-ARENA-1 kernel and five-Wish P-ABIL-1 kernel are integrated. Rust owns planning/
deals, coliseum/teleport/gates, patience/sudden death, historical collision/vision and administrative abandonment, plus
validated Cast intake, canonical stocks/casts/refunds, atomic landing and all five ordinary player Wishes. The genuine
arena Freeze/Last Stand/teleport/refund prerequisite now executes through its dedicated source consumer, with the
explicit Off-slip helper boundary preserved. This does not certify the entire case27 arena-owned projection or full hooks.

The coordinator verified1,188 distinct native tests in split batches, including real PostgreSQL, restore/replay, privacy,
headless/policy, warmed all-five Wish allocations and three compile-fail docs. Both strict workspace Clippy modes,
final affected sim checks, formatting and the15-check Chromium WSS proof pass. The global audit traverses77,358 leaves
with54,154 hash-changing perturbations and zero unhashed;61 optional patterns have actual Some. The191 unchanged
map-generator unit tests were not repeated locally. Completed full
[Rust/C#/source/WSS CI42238404509](https://github.com/Nevanyte/RougeHalla/actions/runs/42238404509) passes at preceding
`0f2f9763`; this newer Wish integration needs its own CI. [Wish native evidence](evidence/stage2-abilities/native/README.md)
records exact scope/commands/repairs; [arena evidence](evidence/stage2-arena-native/README.md) retains its earlier checkpoint.
Protocol6 refuses Source lifecycle and Full Wishes before simulation/offers, including Full with arena Off; no public
activation, Unity rebuild or deployment occurs here.

Full P-ABIL remains **INCOMPLETE**:53 original source cases plus six companion scenarios pass the bounded owned-state
consumer; exactten original card/own-Mark/player-reset/training/full-NPC-signature prerequisites remain explicitly
unattempted and fatal in strict mode. Full arena strict mode now executes genuine Wish/refund, then fails pending
card reset/deferred hooks, full case27 projection and Source transport/durability. Terrain retains its exact reward
options failure. Player-reset and pure80-card catalog proposals are under separate repair/review; full card runtime,
training, remaining signatures, browser/account/cloud/durable/regional and other original-port requirements remain.
The former Calgary MVP deployment is cleaned up; no new live profile is deployed.

The complete card/reward source prerequisite is independently accepted:409 cases,80 complete catalog definitions,
all ten effect payload kinds and14 interactive reward selections. A coordinator pinned Node22.23.4 read-only check
reproduces the exact corpus; source/protected snapshot and helper-coverage documentation corrections are explicit.
[Card evidence](evidence/stage2-cards/README.md) records the scoped worker-write violation, exact-byte quarantine and
reviewed seven-file integration. The [full card packet](backlog/packets/P-CARDS-1.md) retains actual runtime captures,
all hooks/guards/grants/rewards and the strict terrain options mismatch as unfinished work; no native scope widened.

The full [Wish packet](backlog/packets/P-ABIL-1.md) retains its63-case/6,318-step original source corpus and separate
void companion unchanged. New focused source companions add two real overlapping-Blaze cases/106 ordinary steps and
one actual first-refund→second-teleport continuation/13 steps. Review rejected earlier stock/overlap admission bugs;
repaired v3 preserves source stock reachability, pending rollback, multi-charge clocks, refreshed burns and stunned aim.
A single card-owned last-spend record and canonical cast producer avoid synchronized shadows. Native scope is bounded,
with coupled producer and wire completion still explicit; see [the native evidence](evidence/stage2-abilities/native/README.md).

The [65-case card runtime source prerequisite](evidence/stage2-card-runtime/README.md) is independently accepted and
integrated with6,236 ordinary50ms steps,3,298 full frames and3,179 exact private records. Four reviewed prose corrections
qualify assertion coverage, frame selection, Slow Burn and the original reason-stripping observation control. Runtime
harness/corpus bytes remain exact. The separately accepted Witness companion adds two matched traces/six ordinary
ticks, actual8% damage consequence and three reason-preserving controls/30 private comparisons. Source evidence does
not admit native full-card builds or certify all80-card/runtime/public completion.

### Current playable-core checkpoint

The local Unity browser now completes the selected match loop: nickname/faction menu, real Rust combat and visible mobs,
loot pickup, potion use, an actual chest choice with a server-confirmed build change, results, reconnect and fresh rejoin.
The final Chromium run passes every functional check without page/decoder errors. Unity contains presentation/input only.
The native six-seat proof terminates at tick688, replays exactly and restores its terminal checkpoint. The live profile
is opt-in `--first-playable`; [maps/README](../maps/README.md) documents its eight-seat and four-hour-plus-drain bounds.
Quests, traders, other consumables, remaining regional mechanics and the full card pool are still deferred.

The preceding playable-core all-feature workspace gate passed **1,304 tests**, including three compile-fail documentation checks,
with two existing manual ignores. The long simulation suite was split from the remaining workspace to avoid repeating completed map tests. Both strict Clippy modes and
formatting pass. C# passes267 tests; JS passes15,377 golden and61 focused assertions. Wire6 now binds all seven reliable
collections and the new gameplay inputs. That deployed checkpoint uses content `74192c062ab9eac1` and
checkpoint16/replay14/observation13/policy10; the newer native terrain identity is recorded above.
The hash audit finds zero unhashed leaves across44,428 leaves, with actual mob runtime states included.
Checkpoint `484cef25` also passes Rust/C# CI42190950142 and hosting CI42190950113.

The rebuilt Unity Web player and actual UI screenshots are recorded in
[the Unity evidence](evidence/first-playable-unity/INTEGRATION.md); native source/restore/privacy evidence is in
[the core record](evidence/first-playable-core/INTEGRATION.md). M5 Pro measurements are scoped to this MVP:
normal browser CPU submission/GPU medians1.70/0.206ms, and native Sim-only means11.3–12.7µs/tick over three short
deterministic trials. Browser/display pacing and experimental uncapped callbacks are reported separately in
[the performance record](evidence/first-playable-performance/README.md). These are not a full-game legacy speedup claim.

**Calgary staging was functionally verified at [rougehalla.com](https://rougehalla.com/); the temporary run is now removed.** The actual Unity
browser passes the full MVP loop over publicly trusted HTTPS/WSS in `ca-west-1a`, including a chest choice, results,
reconnect and rejoin, with zero page/decoder errors. This uses the reviewed temporary small-host exception in ADR0020;
GameLift/provider/scale and durable progression remain separate. AWS Core still refuses authentication; the approved
CLI verifies the new account and the Cloudflare dashboard made only the marked practice DNS record. No production
change or Paid-plan upgrade was made. [Cloud evidence](evidence/first-playable-calgary/README.md) records exact artifacts,
public TLS, runtime guards and budget scope. Wasm/JS use gzip; further loading optimization remains open.

Actual-domain M5 Pro profiling now measures59.98FPS over24.409s, socket RTT9.9ms median/11.7ms p99, GPU0.203ms
median and fresh Unity readiness24.5s under the8Mbit/s cap. A separate experimental uncapped run submits755.5 GL callbacks/s;
this is not confirmed displayed/shipping FPS. The new Calgary room reports game-step63/159µs median/p99 in its scoped
histogram. [Full domain metrics](evidence/first-playable-domain-performance/README.md) separate rendering, network,
loading, memory and server work; no source/player/quality changes were made.

A bounded follow-up fixes the reusable browser proof’s false-green risk: all15 required outcomes now need actual
coverage; missing/unexercised reports exit2/INCOMPLETE and observed errors exit1/FAIL. The actual saved local/Calgary
proofs remain complete;58 focused coverage-contract checks pass through a lightweight Node CI job. No game rules changed.
An [offline loading improvement](evidence/first-playable-web-compression/README.md) adds lossless data sidecars and correct
MIME/health routing for the next bundle: actual local transfer saves7.409MB, with identical decoded bytes. The measured
playtest payload and24.5s baseline are unchanged; the projected7.4s wire saving still needs future public-load measurement.

**The playable-core staging milestone, including cleanup, is complete.** The owner playtest ended at06:00 Edmonton
on2026-11-06. The coordinator removed the exact marked practice DNS record at the scheduled13:00UTC; after its full60s
TTL window, the cleanup helper deleted the owned stack and artifact bucket. Independent API/DNS checks completed at
13:03:33UTC: instance terminated, root volume/stack/bucket/VPC absent, no owned ENI/IP allocation and both authoritative
nameservers return no practice address. [Cleanup evidence](evidence/first-playable-calgary/cleanup.json) pins the checked
report. Production was untouched; posted billing remains unverified, so no zero-bill claim is made. CAD20 total remains
the cap. The same goal continues through the full original port; broader gameplay/client/regional/state/performance
gates remain open. Caffeinate remains active for ongoing development.

### Current architecture, before Stage 2 changes

| Boundary | Implemented state at `e7e85338` | Evidence / remaining scope |
|---|---|---|
| Live reference | TypeScript npm workspaces: shared rules/map/content, authoritative Colyseus/Express server, Phaser browser client. A Cloudflare Worker routes to a game container; a singleton profile file is mirrored to private R2. | `packages/`, `deployment/cloudflare/`; retained as the gameplay reference and production rollback path. |
| Rust core | `rh-sim`: fixed 20 Hz deterministic simulation; `Sim` facade, immutable `MatchStatic`, serialized `World`, derived `TickScratch`, explicit RNG, ordered entity store, executable tick and hook tables. | `crates/rh-sim/README.md`, `sim.rs`, `state.rs`, `schedule.rs`. Only movement, fists combat, ledger/credit/results and lifecycle are ported; Pending rows mark the other mechanics. |
| Live Rust adapter | Axum/Tokio WSS transport, director/rooms, bounded outboxes, input validation, pacing, reconnect/resync, liveness, drain and local health/control APIs. | `crates/rh-server/src/{lib,main,director,room,conn}.rs`; real AWS lifecycle integration remains unproven. |
| Network | Custom binary protocol v4, full snapshots and per-connection deltas, append-only masks, bounded State channel, admission ticket and result re-send. Rust/C#/JS golden fixtures. | `crates/rh-protocol/`, `protocol/fixtures/v4.json`, ADRs 0002/0010/0011; no Colyseus compatibility layer. |
| Headless/policies | `rh-headless` drives the same `Sim` without wall-clock waits; `rh-policy` contract v2 supplies immutable observations, reset/cadence/deadline/fallback handling. | `crates/rh-headless/src/lib.rs`, ADR 0005. Full legacy bot behavior is still pending. No models or ML training are authorized. |
| Persistence | PostgreSQL store with surrogate profile ids, atomic/idempotent results, append-only GV ledger, fenced session ownership and schema compatibility. | `crates/rh-persist/README.md`; lease renewal, crash recovery, full profile API and achievements still need completion. |
| Unity | Engine-independent C# protocol/session/prediction library plus a skeletal Unity project and browser WebSocket bridge. Presentation/input only; walk prediction is narrow and still lacks pathfinding parity. | `client-unity/README.md`, `UnityProject/Assets/Scripts/`; first real Editor compile and Web build have not yet been verified. |
| Verification | Legacy capture/parity fixtures, replay/checkpoint/hash/leak tests, native server/PG integration tests, JS vectors, C# tests, browser proof and performance harness. | Existing Stage 1 results below are historical. Fresh arm64 baseline checks are running before Stage 2 evidence is claimed. |

### Session authorization and environment

- The owner created and signed in to a new AWS staging account after old-account MFA blocked access; CLI identity is verified.
  The new account replaces the previous target; the total authorized staging spend is **CAD 20**, not a monthly target.
  Cloud resources must be planned against the remaining total with cleanup; the old experiment's USD 150 ceiling is not
  authorized. The reviewed Calgary playtest run is now removed; its verified cleanup is recorded above.
- Practice domain: **`rougehalla.com`**. Cloudflare dashboard sign-in is verified. The one marked TTL60 playtest A record
  has been removed, restoring the previously empty zone. The dashboard was used because the saved tool OAuth scope refuses DNS requests. Production **`play.roguehalla.com`** must remain unchanged; production
  cutover requires later owner authorization.
- Unity Personal sign-in/license and Web module are available. The project now pins Unity `6000.0.85f2` (revision
  `b028303d8e7d`), with a resolved package lock and URP 17.0.4. Both the first protocol-4 bootstrap and the rebuilt
  protocol-5 IL2CPP/WebGL player compiled and ran in Chromium. Evidence below keeps these two revisions distinct.
- Installed local prerequisites: Rust/Cargo 1.97.0 (rustfmt/clippy), .NET SDK 8.0.427, PostgreSQL 16.15. Docker is running.
  The temporary PostgreSQL cluster listens on loopback only; its state/credentials are kept outside the repository.
- Owner choices confirmed 2026-11-05: **MIT** for project-authored code and **Apple M5 Pro** as the initial performance reference. The owner then replaced the 60 FPS goal with **highest sustainable frame rate**, preserving intended quality and measuring CPU/GPU frame times separately from display limits. Third-party/Unity terms remain separate; full-game performance is unverified.
- `caffeinate -i` is running for this work and is to be stopped after work completes.
- Owner priority update (2026-11-05): finish Rust simulation, parity and headless before Unity visual expansion. All rules,
  physics, collision, combat, AI and bots belong only to Rust. The sole Unity gameplay exception is local movement
  prediction checked against Rust vectors and always server-corrected; headless/policy runs never call Unity.
- Owner visual update (2026-11-05): assets need not match the legacy art one-to-one. Compatible open-source assets,
  original assets made with Unity tooling and creative presentation changes are allowed, superseding existing-art-only
  restrictions. Readability, Rust authority, source asset terms and Rust-first priority remain. See R-VIS and ADR0008.

### Execution and current evidence

Project-scoped worker defaults are in `.codex/config.toml`: Luna/low for ordinary work, with explicit Sol/medium overrides
for the capture harness and Unity integration. The calling coordinator's model is not changed by pretending to set a
different model; consequential changes receive an independent Astra/high review. This session has verified model/effort
overrides through the actual delegation tool. The config keys were checked against the
[official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and the installed CLI
(`0.166.0-alpha.6`): `codex app-server --strict-config --print-startup-config` exited 0, and `codex debug models` confirmed
Luna, Sol 6.1 and Astra plus their low/medium/high effort levels. No global model or permission settings are changed.
Normally two workers are active; additional independent validation and critical-review workers are used when their
exclusive scopes allow useful parallel work. Routine test setup used Luna/low; combat and independent reviews used
Astra/high. Runtime-only model overrides are explicit; no unsupported global settings were persisted.

| Work | Current status | Next evidence |
|---|---|---|
| Frozen foundation baseline | `e7e85338` was not fully green: the drain test sent attacks in the lobby, then both clients timed out. The fixed test waits for active spawns, aims correctly, checks both results and termination; a disconnect-on-drain mutation fails it. | Baseline fmt/clippy, 13 slice scenarios + 300 paths, C# 199 and JS 2,078 passed. A follow-up all-feature run passed 361 tests/1 ignored with only the known drain test filtered. Baseline practice headless: 4/4 matches terminated (2,286 ticks), replay verified (737 steps); large map: 4/4 intentionally truncated at 4,000 ticks. |
| PG helper portability | Empty command-prefix arrays failed under Apple Bash 3.2; root status checks also missed a running root-owned cluster. Both execution paths now use the correct OS user. | `tools/pgtest/smoke.sh` passed start/query/same URL and postmaster PID reuse/stop/cleanup on macOS Bash 3.2 + PG 16.15 and as root in a throwaway Linux container + PG 15. No host service installed. |
| P-CAPTURE-1 | Implemented, critically reviewed; no ignored unknown event/input/action or unconsumed timeline records. Real production order-budget defaults and acceptance outcomes are compared. | 8 TS helper checks, all Rust harness checks, exact fresh output inventory comparison; Linux x64 Node 22.23.4 recaptures reproduce. Every old gameplay value is preserved apart from provenance and explicitly added event/setup fields. |
| P-COMBAT-1 core | Melee weapons, pickup/swap/drop, shield/riposte, sword stagger, per-source axe shred, replay/checkpoint and steady allocations implemented. | Six new legacy cases: 2,698 ticks, 1,162 events, 12 results; max position error 0, max HP error 5e-7. 20 compared scenarios and 300 paths MATCH; 15 scenarios remain capture-only. A 7% -> 9% shield mutation fails at tick 3. Checkpoint is `/4`, observation version is 3, content hash `b0b7169709bd0a83`. |
| P-COMBAT-2 authoritative phase | Bow/wand flight, collision, reflection, interception, splash, owner departure, replay/restore and private events implemented and independently reviewed. Public projection/transport remain open. | Seven new cases, 594 ticks, 204 events, 80 launches, 3 results; max position error 0, HP 4.83e-7. Independent 41-case/3,936-tick legacy and restore probe agrees. Corrupt checkpoint serial/packet cases refused. See `docs/evidence/stage2-projectiles-map/`. |
| P-COMBAT-3 core/policy/headless | Wand locks, chase/aim/trigger, exact cast preservation/cancellation, attack-move and public actor intake implemented and independently reviewed. Live protocol/client integration remains open. | 42 compared scenarios/300 paths agree; 3,120 independent ticks/813 events agree. Seven invalid lock tuples refused; 17,613 leaves checked, zero unhashed. Hidden/missing guesses no longer alter later discovery. See `docs/evidence/stage2-targeting-zones/`. |
| P-FACTION-1 Holy foundation | Private engagement, trusted contacts/landed damage, Holy lifesteal and internal heal implemented/reviewed in explicit `FactionMode::EngagementHoly`, default Off. Plague is recorded in the next row; other faction effects remain open. | 15 genuine Holy traces/1,614 tick restores; independent ordinary and overfull-HP sweeps matched. 762 warmed steps allocate zero; caller output cannot affect rules. Source coefficient mutation fails. See `docs/evidence/stage2-holy-camps/`. |
| P-FACTION-1 Plague/reporting | Explicit EngagementHolyPlague mode, Disease/execute, cap sharing, pause, visible bits and private delayed windows implemented/reviewed. Temporal public projection follows ADR 0013. | Four source traces/449 continuations; independent 20 ledger cases, 26 sequences, two terminal cases and 160 restored states pass. Public review covers 5,400 transitions, live/headless/async lifecycle and five mutations. Stale foreign async reply repaired and independently retested. See `docs/evidence/stage2-plague-map/`. |
| P-FACTION-1 player Fire | Burn, Backlash, genuine performed requests and separate instant public reports implemented/reviewed in the explicit partial mode. | 540 captured ticks plus 720 independent ordinary steps and continuations; exact ledger/barrier/order/terminal behavior. Public review covers 6,400 mixed plus 5,400 delayed transitions and live/headless/policy adapters. Empty-matrix validation gap repaired. See `docs/evidence/stage2-fire-landmarks/`. |
| P-FACTION-1 base Frost | Complete power-zero player rate/proximity/ranged chill implemented/reviewed in the explicit partial mode. | 2,265 ordinary ticks/restores, separate source helper/runtime/ledger proofs, 2,728 independent cases, private state/hash/restore/headless/policy and 1,170 warmed zero-allocation steps. Auxiliary/card/mob behavior remains open. See `docs/evidence/stage2-frost-search/`. |
| P-FACTION-1 base Sentenced | Singleton power-zero Mark, typed swap/kill/execute-denial hooks and safe current-state markers implemented/reviewed. | 22 traces/5,042 restores; 56 runtime/13 denial cases plus one explicit arena reference; independent private/public/identity/count/order and mutation proofs. Stale public bit and synchronous projector-fault authority repaired. See `docs/evidence/stage2-sentenced-support/`. |
| P-MAP-1 M0/M1 | Full typed `rh-map/2` admission and deterministic math/grid/fixed-layout foundations implemented inside `rh-sim`; full generator remains open. | 295-grid foundation corpus; independent 24-map/614,400-query full-layer review and three real safe-integer producer captures agree. Border/gate/bush/camp-reference and checkpoint admission holes fixed. Same-map constructor allocations 235,363 -> 49. No map re-pin. See `docs/evidence/stage2-vision-map/`. |
| P-MAP-1 M2a | Exact zone partition stage implemented and independently reviewed; camp/territory/style/full-generator stages remain open. | 1,024 real prefixed streams agree, 398 with retries. Another 90 independent cases match 19,324,440 bytes. Actual larger-radius boundary panic fixed. One 28-field definition drives implementation/content identity; no re-pin. |
| P-MAP-1 M2b | Initial camp placement, territories and reach implemented/reviewed. Spots, repair and canonical renumbering remain open. | Pinned 128-stream scan: 116 successes/12 terminal failures; ten full cases agree. Independent 144-case differential and custom-radius probes passed. All thirteen camp fields drive runtime/content identity. |
| P-MAP-1 M3a | Actual attempt prefix through stages 1–3 implemented/reviewed, returning an intermediate frame with advanced RNG. | Fourteen pinned cases and 37 additional actual-source cases agree on arrays, retry boundaries, seed bits and continuations. Observational captures verify final map/null/hash equality against the unmodified caller. No finished-map/plain-pin claim. |
| P-MAP-1 M3b and elite bushes | Spawn preparation/picking/protection, pure gate decisions and actual stage-11b elite bushes implemented/reviewed. | Exact source arrays/RNG/path bits, 27/11 shared rule words, independent 369 paths and 323 bush cases with impactful mutations. Real landmarks and original pool masks retained. Landmark callbacks and full pipeline/records/certifier/pins remain open. |
| P-MAP-1 landmark runtime/templates | Whole-wall guards/transactions, source-exact geometry, parsing/orientations/stamp fits and real helper placement implemented/reviewed. | Full per-command scratch/counter/layer comparisons, refusal-budget persistence, 757 template caller events/116 snapshots; independent 83-template/6,776-stamp corpus and 17 behavior/deletion mutations. Malformed terrain and overflow-index admission fixed. Callbacks/full generator/pins remain open. |
| P-MAP-1 landmark search | Exact candidate/bound/score/guard order, SAT cache and scoped ownership implemented/reviewed. | Five actual attempts/22 searches plus 30 helper streams; independent 21 search replays, 17 detected mutations, source-byte reproduction and positive/negative ownership controls. Sparse-success coverage repaired; production logic unchanged. Recipes/full pipeline/certifier/pins remain open. |
| P-MAP-1 recipe support | Read-only exact helpers, admitted metadata/streams, current doors and corresponding fixed-rule borrow implemented/reviewed. | Seven complete source-output/hash controls/35 zero-draw contexts, eight repository tests and independent helper domains. All fourteen independent mutants detected; exact inventories and scalar probes kill four prior checked-in survivors. Recipes/stage4/pipeline/certifier/pins remain open. |
| P-MAP-1 complete generator | Complete plain/styled orchestration and all five callbacks are implemented/reviewed. All 400 original plain/styled pins,8 original OPEN pins and complete DTOs match;800 independent hard checks pass. | Native M5 Pro paired release medians:13.47 ms plain /22.21 ms styled; source 29.48 ms /45.32 ms, both decor:false. Map checkpoint content `105333d9ac5d8d92`; checkpoint 14/replay 12/observation 11/policy 8/wire 5 unchanged. See `docs/evidence/stage2-styled-map/`. |
| P-VISION-1 prerequisite | Actual 30-second private trail, bush concealment and attack exposure implemented and independently reviewed; public sampling does not mutate simulation state. | Two genuine fixtures/720 ticks, 210,820 independent point queries, props/events/caches/reconnect/restore and terminal-deadline regression passed. Source corrects stale 120-second docs. Ward/hunter/training/ability producers and dynamic gates remain open. |
| Privacy corrections | Hidden pickup targets no longer differ from absent targets in owner feedback; unseen hit and death sources are redacted. Full authoritative event reasons and credit remain unchanged. | Differential absent/far/wall-hidden tests, LOW-fence and visible-distant positives, full/cached/earlier-step event paths; reverting projection rules fails the new tests. Independent recheck passed all 8 observation tests. |
| P-NET-3 combat transport | Protocol 5, ADR 0012, actual Swap/Pickup input-queue methods, passive Hit, Block/Stagger and private refusal events implemented in Rust/C#/JS. Cross-version envelope unchanged. | 73 Rust protocol tests, 220 C# tests, 3,344 JS checks, 9 wire tests, source-copy check and actual Chromium WSS proof passed. Oversize frames, unknown enum encodings, BOM preservation and wrong-version Welcome were corrected and independently rechecked. |
| P-PERSIST-2 store portion | Achievements and cosmetics now commit atomically with fenced/idempotent results, including concurrent retry and crash rollback. | 26 catalog entries and 83 legacy evaluator observations agree; 32 PG tests passed. The later rows complete ending metadata and live renewal; crash recovery and REST routes remain open. |
| Profile catalog prerequisite | All 57 legacy cosmetics, prices, slots and validated look-word packing are available in `rh-persist`; no runtime Node dependency. | 301 actual legacy look observations agree; all 35 persistence checks passed (32 PostgreSQL integration tests plus 3 catalog unit tests), Clippy passed. HTTP/API and live look presentation remain open. |
| P-PERSIST-2 live leases | Off-room renewal, confirmed room deadlines, stable authenticated profile ownership and cancellation cleanup implemented/reviewed. | Defaults 120 s TTL/30 s renewal/5 s DB budget, configurable with one-hour TTL ceiling. Real PostgreSQL aliases/name reassignment, cancelled acquisition/join, blocked row, late commit, host-stop takeover and stale receipts verified. No schema/dependency change; unwritten-result crash recovery remains open. See `docs/evidence/stage2-leases/`. |
| P-PERSIST-2 ending metadata | Explicit join choice and selected raw slot after drop now reach the existing fenced writer. | Fifteen actual legacy room/store cases and 72 independent combinations agree; real-PG full counters, duplicate/rename/stale/rollback/old-v1, wire/privacy and replay/restore/digest checks pass. Defaults and posthumous winners preserve actual legacy semantics. See `parity/persistence/README.md`. |
| P-UNITY-1 bootstrap | Exact Editor and packages, real compile, Web build and Chromium movement over HTTP/WS and HTTPS/WSS passed. The full client packet is still open. | Protocol-4 bootstrap is historical. Current protocol-5 build is 53,892,988 bytes; each smoke receives 54 snapshots (ticks 2->53), move sequence 0->16 and changed authoritative position, with no page/console errors. Four ReadPixels warnings per run; no performance guarantee. See `docs/evidence/stage2-unity-v5/`. |
| Client authority correction | Removed unverified client walk/collision code; current local view follows accepted server positions. Requested same-tick Full recovery works without allowing ordinary duplicates to corrupt the delta base. | 214 C# tests and independent duplicate/stale/recovery reproductions passed; Unity library copies match. Local view clears on self absence; verified native mesh ownership fix retained. These later source changes still require a fresh Web build. |
| Integrated native gate | Latest `cargo test --workspace --all-features --locked`: 1,252 passed, 0 failed, 2 ignored, no filtered tests. Both workspace Clippy modes and formatting passed. Native generated maps pass headless checkpoint/replay with a 200-tick cap. The bridge E2E passed at the preceding external checkpoint; its current manual test and the heap measurement remain ignored. | Existing gameplay fixture bytes unchanged. Parity: 97 compared/13 capture-only/300 paths, all MATCH. Map checkpoint `fba510aa`, server integration `904ad78d` and load integration `cbdf82cf` passed Rust/C# CI `42104246778`, `42105176881` and `42106334019`. External integration `5b1a7aae` passed Rust/C# CI `42110941659` and all six native determinism jobs `42110939993`; Map checkpoint `a232c779` passed Rust/C# CI `42118517547`, all six native determinism jobs `42118515782` and Hosting validate `42118517820`; Holy/helper checkpoint `8e9e9e54` passed Rust/C# CI `42123267238` and all six native determinism jobs `42123266734`; styled-generator checkpoint `d1027eac` passed Rust/C# CI `42132791905` and all six native determinism jobs `42133186195`. Stat-kernel checkpoint `7f294cc7` passed Rust/C#/browser CI `42140634731` and all six native determinism jobs `42140667566`. Catalog checkpoint `03060965` passed Rust/C#/browser CI `42156086659` and all six native determinism jobs `42156125508`. |
| Shared loot/inventory | P-NET-ITEMS-1 core/policy/headless implemented and independently reviewed. Policies and external observers discover, pick and swap using only public offers. Reliable live State is implemented/reviewed; source admission and actual socket/Unity item gate remain **open**. | Observation 4, policy contract 3, checkpoint /5, replay /3. Privacy, exact targets/grace, async failure/deadline, budgeted misses and restore checked. 512 changed rows allocate zero after warm-up. See `docs/evidence/stage2-items/`. Socket State/resume, source setup bounds, wire costs and Unity item UI remain. |
| P-STATUS-1 | Bounded generic runtime integrated after independent acceptance, required repair/test overlays and coordinator content/version/adapter work. | 79 real-Sim cases plus one role leaf and14 fresh privacy pairs pass; canonical source bytes,1,252-test workspace, both strict Clippy modes, parity and actual WSS browser proof pass. Content `256add608aea64e6`; checkpoint15/replay13/observation12/policy9. The status checkpoint used protocol5; protocol6 below now carries fact scalars/fields. Remaining ability effects and card/mob producers remain. See status-runtime evidence. |
| P-KIMI-FOLD-1 | Independently accepted as a pure, unwired kernel after repairs to NaN truthiness, recursive fixture/provenance admission, bounded stress and replay diagnostics. Integrated after the repaired leaf and coordinator content registration passed the full workspace gate. | 463 original +252 independent source cases; 4,096 CI/100,000 distinct canonical stress inputs and ten actual implementation mutants verified independently. Aggregate definition/metadata identity is `24c5098abed31dfb`; no state/protocol format change. Cards/status gameplay remains pending. See `docs/evidence/stat-fold/`. |
| P-CLAUDE-PLACEMENT-2 | Integrated locally after three preserved recovery/migration failures were repaired and independently reviewed. Schema 3 retains ambiguous start/DNS obligations and rejects unsafe old-schema writes; explicit scoped release replaces ID-only deletion. | 236 independent placement tests, eight effective behavior mutants; integrated workspace 1,196 passed/0 failed/2 existing ignored, 144 default placement tests without DATABASE_URL, both strict Clippy modes and unchanged parity pass. Rust/C#/browser CI `42147913799` and Hosting validate `42147913830` passed. Scheduler/backoff, HTTP auth, real provider/TLS/deployment remain open. See `docs/evidence/placement-durability-review/integration.json`. No cloud actions. |
| P-MOBS preparation | Source review corrected stale return immunity, loose-drop, map-export, NPC timing and private RNG assumptions. The pure catalog/roster leaf is independently accepted and integrated with content `b5a9b0f84279dcfb`. | 322 original +120 fresh source cases, 16 compiled behavior mutants and 327 aggregate perturbations pass; the 1,207-test integrated gate is green. Corrected P-MOBS-1 retains four stages; native actor/spawn, sfc32, NPC combat/AI and applied rewards remain pending. No pure helper or role-only status proof closes the runtime. |
| Full game / cloud / release gates | Not achieved | Remaining backlog and Stage 2 prompt still apply in full; baseline checks do not imply full-game parity or release readiness |

Integrated foundation is committed and pushed as `c93b659d`. The chat now uses its managed worktree on
`optimization_port`; the previous implementation checkout is detached at that revision and preserved. Both legacy recapture
and Rust foundation CI passed, including C#, PostgreSQL and Chromium WSS. P-NET-ITEMS-1 shared public observation/intake
is committed at `120ecd93`, with its 411-test gate and CI passed. Unity's measured mesh-leak repair is preserved; unverified
instancing is archived as an inactive patch. Further visual work and long profiling are suspended in favor of Rust completion.
The unverified straight-line client predictor has been removed in favor of accepted authoritative positions until Rust-vector
parity exists (`c6906268`, 214 C# tests). P-COMBAT-2 authoritative flight and map M1 foundations passed the prior
431-test gate and CI at `d8c4af9f`. Vision and M0 full layers passed the integrated 456-test gate and CI at `fcfb4d09`.
Targeting, zone partitioning and live leases passed the integrated 489-test gate and CI at `e42f5d97`. Holy engagement
and initial camps passed the integrated 505-test gate and CI at `29e4747c`. Ending metadata and the actual attempt prefix
passed the integrated 521-test gate and are pushed as `135ad2d5`. Its first CI run exposed SQLSTATE 55P03 in the lease
proof's direct expired-renew assertion: the director's lease give-back can take the row after the test releases its lock.
Test-only correction `f4f38755` retains every safety assertion and retries only that transient SQLSTATE. Controlled
contention and the full 127-test PG server suite passed; Rust CI `42023715522` is green, including C#, the new oracles,
headless and Chromium WSS. Plague, temporal observations, spawn stages and elite bushes now pass the post-fix
557-test native gate, both Clippy modes, formatting and parity (61 compared/13 capture-only/300 paths). Both independent
combat and projection reviews passed, including the repaired foreign-session async reply. That checkpoint's content is
`44fb7ebcf48f519f`, checkpoint /11, replay /9, observation 8, policy 5 and wire 5. FactionMode defaults Off; explicit
EngagementHoly and EngagementHolyPlague remain partial installations. New signature presentation is explicitly omitted
from wire 5. Source canonical inventory is 76 files; the old 72 values remain unchanged. Checkpoint `0fc178a0` passed
Rust CI `42033821121` and legacy recapture CI `42033821099`, including the standalone proofs, map oracles, PostgreSQL,
C#, headless and Chromium WSS.
See `docs/evidence/stage2-plague-map/` for source precision, 449 continuations, 220 measured zero-allocation steady steps,
map differential/mutation coverage, 540 independent exact-sum cases and reviewed public lifecycle behavior.
Fire and whole-wall landmark runtime/templates now pass the 586-test native gate, formatting, both Clippy modes and
parity (65 compared/13 capture-only/300 paths). Canonical inventory is 80 files; the previous 76 remain unchanged.
Both independent Fire reviews and the independent template review passed. The source-backed template fixture contains
757 events, 18 planning views and 116 runtime snapshots; its checked-in tests exercise the actual Rust placement helper.
The source-offset overflow artifact is explicitly refused while valid Int16-wrapped indices retain exact behavior.
The Fire checkpoint's content is `03c4ef099f3921cd`, checkpoint /12, replay /10, observation 9, policy 6 and wire 5. The runtime's three
rule words and separate landmark gap drive content identity; all 19 content checks pass. Wire 5 still explicitly omits
all signature-qualified effects/bits. No Unity code changed. See `docs/evidence/stage2-fire-landmarks/`.
Pushed checkpoint `7fe10989` passed Rust CI `42049800438` and legacy recapture CI `42049800443`; C#, PostgreSQL,
headless smoke runs, all source/map oracles and Chromium WSS are green.
Fire implementation moved to Sol 6.1/medium after an observed Astra capacity failure. The original high-tier gameplay
review completed; Sol 6.1/high independently completed final public review after the first reviewer hit capacity. The
coordinator made the small test-only matrix inventory repair after its worker also hit capacity. Sol 6.1/high performed
the separate template review under the same recorded fallback.
Base-player Frost and exact landmark search/cache now pass the 602-test workspace gate, both Clippy modes, formatting
and parity (75 compared/13 capture-only/300 paths). The test-only sparse-source repair then passed all 15 landmark tests,
three ownership doctests and full-feature workspace Clippy. Both independent reviews are accepted; no production search
logic changed for the fixture repair. Canonical inventory is 90, with the previous 80 unchanged. That Frost checkpoint's content is
`30c9741ffc6abb77`, checkpoint /13, replay /11, observation 10, policy 7 and wire 5. All 20 content tests pass.
The ten Frost constants are in the single content registry; both search words and actual Frost formula boundary probes
are folded too.
The initial GitHub PG failure has no established historical cause. A test-only follow-up now checks acknowledged
post-lock snapshot progress, exact room identity, both other seats and deadline/phase diagnostics without changing any
production timing or weakening safety assertions. Independent negative controls distinguish scheduling outage from a
blocked actor; both PG targets (7 + 9 tests) and strict server Clippy pass. See
`docs/evidence/stage2-leases/ci-progress-probe.md`. This is stronger verification, not a claimed production repair.
Diagnostic checkpoint `c5e016ef` passed full Rust CI `42070970303`, including PostgreSQL, C#, all source checks, headless
and Chromium WSS. The initial failure's exact historical cause remains unproven. No protocol/Unity/package/dependency/cloud/DNS change accompanies this checkpoint. See
`docs/evidence/stage2-frost-search/` for exact source, allocation, mutation, domain and post-review evidence.
Sentenced and shared landmark recipe support now pass the 634-test native workspace gate, formatting, both Clippy
modes and parity (97 compared/13 capture-only/300 paths). Canonical inventory is 112 with the previous 90 unchanged.
Independent gameplay, public/session and shared-helper reviews are accepted after their concrete findings were repaired.
That checkpoint's content is `aa629bdb1a320371`, checkpoint /14, replay /12, observation 11, policy 8 and wire 5; all 21 content tests
pass. Code checkpoint `165f61b6` also passed full Rust CI `42078813203` and legacy recapture CI `42078813201`.
Public marker identity and same-tick state corrections follow ADR 0014. Dense report limits remain explicit;
private damage is never truncated for presentation. The one explicit source arena helper case remains reference-only.
Shared helper tests now reject empty inventories and detect the previously surviving round/distance changes. A test-only
serde_json dependency reuses the locked version; no package source, protocol, Unity, cloud or DNS change accompanies this
checkpoint. See `docs/evidence/stage2-sentenced-support/`.
The five actual stage-4 landmark recipes, registry and ordered admission now pass the final **649-test** native
workspace/all-features/locked gate (0 failures/filtered, one intentional heap test ignored), formatting and both strict
workspace Clippy configurations. Parity remains 97 compared/13 capture-only/300 paths, all matching; the 112 existing
canonical gameplay fixture files are unchanged. All five live callbacks match across eight actual attempts/40 zones,
including exact original protection, building order, masks, complete runtime state and RNG continuations. Independent
additional corpora and semantic mutants pass; two concrete test-evidence gaps were repaired and independently rechecked.
All 767 recipe-content perturbations pass. Current content is `1e0774e8e0ba1649`; checkpoint /14, replay /12,
observation 11, policy 8 and wire 5 are unchanged. New source recapture checks are in Rust CI; the new checkpoint's CI
passed for code checkpoint `998fc95d` in Rust foundation CI `42089479662` (Rust and C# jobs).
See ADR0015 and `docs/evidence/stage2-landmark-recipes/`.
Pure map record finalization, terrain validation and exact source map identity now pass the **672-test** native
workspace/all-features/locked gate (0 failures/filtered, one intentional heap measurement ignored), formatting and both
strict workspace Clippy configurations. Parity remains 97 compared/13 capture-only/300 paths, all MATCH; existing
gameplay fixture bytes are unchanged. All three leaves passed canonical Linux x64 Node 22.23.4 byte-exact recapture
and independent review. Every genuine record output also reproduces its source hash and passes terrain/M0 admission.
Two fixture-inventory defects were repaired and independently retested; aggregate content checks cover 127 new policy
mutations. Current content is `52d21bbbf403dd64`; checkpoint /14, replay /12, observation 11, policy 8 and wire 5 remain
unchanged. The pure exact formatter adds pinned ryu-js1.0.3 (archive/licenses verified; local compiler1.97, no local
MSRV1.85 execution). Source hash omissions and the narrower bounded terrain diagnostic domain are explicit in ADR0016.
See `docs/evidence/stage2-map-finalization/`. Code checkpoint `568f58a1` passed Rust foundation CI `42096841501` (Rust and C# jobs), including
the three new source recaptures, PostgreSQL, headless and browser checks.
Camp/crate/ground spots, safety nets/territory repair and final terrain/decor/shape checks now pass the **703-test**
native workspace/all-features/locked gate (0 failed/filtered, one intentional heap measurement ignored), formatting
and both strict Clippy configurations. Parity remains 97 compared/13 capture-only/300 paths, all MATCH. All three
canonical recaptures/byte-checks and independent reviews pass. Review repaired two malformed-definition panics and
three tail evidence gaps; original failing controls now detect the fixes. Thirty-nine new aggregate policy mutations
pass. Repair reuses the existing balancer and a compile-time view of the existing terrain table. Content is now
`a35c49ba5c73e88b`; checkpoint /14, replay /12, observation 11, policy 8 and wire 5 are unchanged.
See `docs/evidence/stage2-map-placement/`. Full orchestration, stage-six stylers, independent certifier integration
and canonical pins remain open. No full generator or performance claim follows.
Kimi PR24 (`3558f83a`) passed native Linux x86_64/aarch64 production, exact comparison and foreign replay verification
in both directions (CI `42093826602`). Coordinator comparator25 and focused Rust12 tests pass. It is merged as
`1d26fd61`; native verification of that merge passed all six jobs in `42101769249`. This is implemented-domain
evidence, not full-game completion. Claude PR25 and 26 are merged with reviewed account-identity, kick-retry and load
harness fixes as `904ad78d` and `cbdf82cf`. PR27 is integrated with five placement/operation/policy/DNS repairs and
the final 905-test workspace gate; its merge-commit CI remains pending. The real local bridge E2E also passed when
explicitly invoked. See `docs/evidence/stage2-external-integration/` for the exact scope and limitations.
Result-spool recovery covers same-volume process restarts; host-volume loss and managed database failover remain open.
Placement ownership is protected in process, but durable ledger/restart recovery and the production adapters remain open.
PR27 is merged as `5b1a7aae`. Native determinism CI `42110939993` passed all six jobs for that exact code revision,
including both native architectures, exact comparison and both foreign-replay directions. Rust/C# CI `42110941659`
passed both jobs. The initially manual-only hosting-validation workflow could not be dispatched because GitHub had not
discovered it on the default branch. The coordinator adds relevant `optimization_port` push/PR triggers for its
credential-free checks; deployment remains manual. Its first automatic run awaits this checkpoint. No default-branch change was made.
The owner requested two further external goals: Claude's single milestone is durable placement/restart reconciliation
([P-CLAUDE-PLACEMENT-2](backlog/packets/P-CLAUDE-PLACEMENT-2.md)); Kimi's is the pure Rust stat fold and bounded
differential stress suite ([P-KIMI-FOLD-1](backlog/packets/P-KIMI-FOLD-1.md)). Their separate scopes require no cloud
or Unity login. Both remain pending implementation and independent review.
Complete plain orchestration, independent hard certification and the guarded style runtime now pass the **931-test**
native workspace/all-feature/locked gate, formatting and both strict Clippy modes. The four canonical Linux amd64
Node 22.23.4 bytechecks pass. All 200 original plain pins and complete maps match; no pin file changed. Independent review
adds 49 real-source attempts/repeats,400 baseline plus 90 fresh hard checks, and high-owner-ID controls at 255/256/257/65535.
Runtime prop homes now come from the sole typed catalog; all 69 certifier thresholds, 16 runtime policies and 3 orchestration
limits are registered with aggregate mutation coverage. Remaining guard geometry is folded as well. The expected content
identity is `d6a8763491c65535`; checkpoint 14/replay 12/observation 11/policy 8/wire 5 are unchanged. Existing gameplay fixture
bytes remain unchanged. Parity 97 compared/13 capture-only/300 paths all MATCH; a fresh full-layer 200-step headless
recording verifies without a content override. These are correctness checks, not full-game or frame-rate evidence.
See `docs/evidence/stage2-map-pipeline/`. Styled generation and the original styled pins remain open. Holy's stage-six
callbacks and the remaining generic style helpers are now integrated after bounded independent acceptance;
Fire/Plague/Frost callbacks are being ported in isolated scopes. No new dependencies or cloud/DNS/Unity changes.
Holy shape/surface/props and shared geometry/graph/field/search helpers now pass the **944-test** native workspace
all-feature/locked gate (0 failures/filtered,2 ignored), formatting, both strict Clippy modes and unchanged parity 97/13/300.
The two new canonical Linux amd64 Node 22.23.4 bytechecks pass. Helper review covers 2,800 fresh cases; Holy review covers
88 fresh complete callback contexts plus one explicitly labelled surface-only input, with complete state/RNG checks.
Shared scan geometry preserves all six prior stage-four regressions; test-only source-prefix restoration has 14 atomic
refusal controls. It restores captured prerequisite INPUT, never expected callback output. All 20 new numeric policy
fields and actual direction coordinates participate in content identity. Current content is `58dc066ada48c13f`;
checkpoint 14/replay 12/observation 11/policy 8/wire 5 are unchanged. See `docs/evidence/stage2-holy-style/`.
Warren, Scorch and Rime have separate frozen implementations pending independent acceptance; Gallows is being completed.
Continuous native stage-six dispatch, styled pipeline and original styled pins remain open. No new dependencies,
Unity visual implementation, AWS/DNS mutation or production change follows from this checkpoint.
Auxiliary factions, status/cards/abilities/mobs/bots and reliable item State/client integration remain open.
The first external handoffs are integrated. Follow the current backlog reservations before starting further parallel work.
Unity visuals stay deferred; no full-game/pin/performance or cloud staging/production release is implied.
All gameplay/core, Unity full-flow, browser-matrix/performance, AWS lifecycle/scaling, migration and release requirements
from the Stage 2 prompt remain in scope. No cloud staging or production release is implied by these local gates.

Complete five-faction styled generation now passes the 997-test native workspace gate, both strict Clippy modes,
formatting and unchanged gameplay parity (97 compared/13 capture-only/300 paths, all MATCH). All 200 original styled
pins and complete decorated DTOs match, adding 160,996 ordered props to the existing source-bound bare-map backbone;
all 200 original plain pins and8 original OPEN pins remain intact. Independent reviewers reproduce full maps, phase
continuations, source noninterference, repeated-state behavior and semantic mutations. Three malformed initial
metadata cases now refuse before any zone writes by sharing existing Scorch/Rime admission. Actual Rime normals,
all callback tunables/resolved Gallows dials and registry phase flags participate in identity. Native generated maps
enter ordinary eight-bot headless play with a 200-tick cap, checkpoint continuation and serialized replay.
Content is `105333d9ac5d8d92`; checkpoint 14/replay 12/observation 11/policy 8/wire 5 remain unchanged.
Quiet native Apple M5 Pro measurements (18 CPU cores,64 GiB RAM; Rust 1.97 release, Node 22.23.4 arm64;40 common seeds,
5 warmups/mode,both decor:false) give 13.47 ms plain /22.21 ms styled Rust medians against 29.48 ms /45.32 ms source.
These are map-creation timings; full-game throughput, rendered FPS and deployment readiness remain unproved.
`tools/map-bench` retains the portable off-core harness; raw samples, exact code fingerprints, methods and limits are in
`docs/evidence/stage2-styled-map/`. Checkpoint `d1027eac` passed Rust/C# CI `42132791905` and all six native determinism jobs `42133186195`. Rust gameplay completion remains
the next priority; the generator does not complete map-pool operation, transport, mobs/statuses or other remaining mechanics.


The independently repaired P-KIMI-FOLD-1 kernel is integrated from producer `f14a89e8`, preserving that history and
all original 463 source case inputs/answers and 207 coverage entries. Only the recorded schema hash changed in the
canonical corpus. The frozen version-two review binds the NaN truthiness repair, recursive duplicate/provenance
admission, complete bounded 100,000-input stress run, ten real implementation mutations and exact failure replay.
The coordinator folds the actual 33 numeric policies and 184 key/category/index metadata words into content
`24c5098abed31dfb`; exhaustive aggregate perturbations pass. Checkpoint14/replay12/observation11/policy8/wire5 remain
unchanged. Local integrated validation: 1,031 passed, zero failed/filtered and two previously documented ignored tests
across111 suites; formatting, both strict workspace Clippy modes,97 compared/13 capture-only/300 paths,214 C# tests,
3,344 JS vector checks, library synchronization, eight Node runner tests and host-diagnostic4,096 differential inputs
pass. Canonical Linux x64 Node22.23.4 byte checking also passes. The earlier independent4,096/100,000 canonical
comparisons apply to the exact repaired leaf bytes. CI now recaptures the canonical corpus and runs the Node and4,096
case gates. Native determinism `42140667566` passed all six jobs, including both foreign replay checks; Rust/C#/browser CI `42140634731` also passed, including the new canonical stat-fold and 4,096-case gates. See `docs/evidence/stat-fold/integration.json` and the immutable review
manifest. This pure kernel does not activate status/cards, alter gameplay or establish a runtime speedup.


Durable placement ownership is integrated from producer `4843cd51` with the accepted version-two repair and independent
three-test overlay. Original late-start/late-upsert failures and the first repair's already-open legacy-writer failure
remain preserved. Unknown starts never finish from age or repeated absence; per-send DNS obligations survive retries,
cleanup and restart. Schema 3 refuses a nonempty older ledger without changing data/nonce and uses an exclusive migration
lock plus a database metadata constraint against still-open legacy writers. Offers remain immutable to automatic cleanup;
authorized scoped release retains original-zone identity. All 11 process-crash and nine delayed-effect cases are included
in the 236-test independent gate; four compiled selectors and four physical implementation mutations fail semantically.
Root validation: 1,196 all-feature workspace tests across 120 suites, zero failed/filtered and two existing manual ignores;
144 default placement tests pass with DATABASE_URL absent, both strict workspace Clippy modes/fmt pass, and existing
97 compared/13 capture-only/300 path parity remains MATCH. CI now requires the PostgreSQL/fault/process-recovery gate;
Rust/C#/browser CI `42147913799` and Hosting validate `42147913830` passed. Content `24c5098abed31dfb`, checkpoint14/replay12/observation11/policy8/wire5 are unchanged.
No simulation, protocol, C# or source TypeScript changes belong to this infrastructure checkpoint. No cloud/DNS spending
or deployment occurred. A real provider adapter, authenticated HTTP, explicit reaper cadence/backoff, TLS/staging and
nonempty old-ledger operator reconciliation remain separate gates. See `docs/evidence/placement-durability-review/`.

The pure mob catalog/roster leaf is now integrated after independent acceptance and coordinator registration of the
actual visitor. Its original 322 and independent 120 actual-source cases agree, both corpora reproduce byte for byte
on canonical Linux x64 Node22.23.4, and 16 compiled behavior mutations are detected. Content is now
`b5a9b0f84279dcfb`, with 327 aggregate sensitivity checks; checkpoint14/replay12/observation11/policy8/wire5 remain
unchanged. Full validation passes 1,207 tests across122 suites, zero failed/filtered and two existing manual ignores,
formatting, both strict workspace Clippy modes,97 compared/13 capture-only/300 paths,214 C# tests and3,344 JS checks.
The canonical source gate is added to CI; checkpoint `03060965` passed Rust/C#/browser CI `42156086659` and all six native determinism jobs `42156125508`. This does not close
P-MOBS-1 or imply runtime RNG/actors/spawn/AI/rewards/respawn or a performance gain. See
`docs/evidence/stage2-mob-catalog/INTEGRATION.md`.

The generic status core is now integrated with its required source/native/test overlays and independently reviewed
coordinator selections. One ledger owns all14 kinds and axe shred; fields/displacement and queued/next-tick effects run
at their source positions, with unfinished ability subresponsibilities explicitly pending. Content `256add608aea64e6`
folds172 actual words and real axe/ability keys while preserving map/stat/mob injection. Checkpoint15/replay13 and
observation12/policy9 are current. Full validation:1,252 passed across129 suites, zero failed/filtered and two existing
manual ignores; both strict Clippy modes/fmt,97 compared/13 capture-only/300 paths,214 C# and3,344 JS checks pass.
All79 real-Sim source cases plus one role leaf and14 privacy pairs agree; all four corpora and fresh privacy bytes
reproduce canonically. Actual Chromium WSS admission/deltas/resync/input/reconnect/results proof passes. Protocol5
is unchanged and explicitly omits status/field facts; full transport remains P-NET-3. Rust/C#/browser CI `42159058642`, legacy recapture `42159058669` and all six native determinism jobs `42159246989` passed.
No cloud or client-rule change occurred. See `docs/evidence/status-runtime/INTEGRATION.md`. The owner-selected
playable-core milestone above now governs the immediate work; the full original backlog remains for later.

The bounded protocol6 transport is now integrated: human seats resolve delivered pickup handles through the shared
observer/validate/submit path; reliable inventory/props/fields replacements survive snapshot coalescing and refresh on
join/resume/resync. Handle and baseline commits follow atomic reliable enqueue. Full/delta effects and displacement
reach Rust/C#/JS, including explicit clears and short-displacement presentation. Focused gates pass76 protocol tests,
83 server library +20 live/publish/metadata tests,229 C# tests and3,811 JS checks. Strict all-target/all-feature network
Clippy, formatting and synced Unity library pass. Actual Chromium WSS join/combat/results/resync/reconnect/mismatch
proof passes; an independent transport review found no blocker. Content/checkpoint/replay/observation/policy remain
`256add608aea64e6`/15/13/12/9. Wire is6; the existing Unity Web player still needs rebuilding.

This is a transport checkpoint, not MVP completion. Reward/build keys4/5 are explicit empty replacements and potion
counts are zero until the actual native producers are integrated; Choose/Use inputs are not yet mapped. Native source
loot admission bounds, actual socket/Unity loot selection, remaining effect announcements and the functional HUD stay
open. No gameplay rule or cloud/DNS action was added. See [protocol6 evidence](evidence/protocol6/INTEGRATION.md)
and [ADR0018](adr/0018-keyed-state-protocol-v6.md). Subsequent native gameplay integration must retain these live
observer and reliable commit paths.

The approved MVP source comparison uses a named assembler of unchanged selected installers in original module order,
with quests/traders and deferred whole modules omitted. It does not claim full-default-world equivalence. If the full
consumables installer cannot be separated without importing cannon/wind gameplay, the minimal potion routine is a
labelled Partial subresponsibility at its original schedule position with a separate actual-source routine proof.
Selected-card eligibility is a restricted source-pool projection; it is not full14-augment draw-distribution parity.

## Checkpoint (end of Stage 1)

| | |
|---|---|
| Branch | `optimization_port` (created from `main` at `75c5b83`, the legacy baseline) |
| Stage 1 revision | the head of `optimization_port` carrying this file (Stage 1 commits: `114156b`..HEAD; see `git log 75c5b83..`) |
| Working tree at handoff | clean (everything committed and pushed) |
| Verdict | **READY FOR THE BULK PORT WITH EXTERNAL GATES** (gates below) |
| Sweep revision | `ae0c37b` on `optimization_port`: P2b, P10a, P7a, P5b, P5c, P7b, P5d, P8, P9, the CI perf gate, the P10b measurement, H-server, H-server-2, H-sim and **P10c (protocol v3)** are merged (`git log --merges 07bc297..ae0c37b`) |
| Efficiency and lock-in revision | `b326676` on `optimization_port`: E-sim, E-pub, E-backlog, E-simplify, E-sight (efficiency) and L-envelope, L-durable, L-sim, **L-v4 (protocol v4)** (lock-in) are merged on top of the sweep (`git log --first-parent 056bb31..b326676`; `056bb31` is the merge of the closing sweep docs) |
| Next | The core optimization sweep, the efficiency pass and the lock-in pass are complete ([sweep/README.md](sweep/README.md), "Efficiency and lock-in pass"). Next: backlog wave 0 (P-CAPTURE-1) and wave 1 (the bulk port); P-UNITY-PERF-1 is for the Codex stage. The wire is protocol v4 ([ADR 0011](adr/0011-protocol-v4.md): append-only varint masks over the per-connection deltas of ADR 0010) |
| Sweep status | **Complete** at `ae0c37b` (efficiency and lock-in passes complete at `b326676`); the Stage 1 tables below are kept as recorded and marked, the "Sweep results" section carries the current numbers (merged table, corrections and open follow-ups: sweep/README.md). P10c: protocol v3 per-connection deltas, 908 -> 305 B/player/s on the slice at 1.048x wire Ir, fingerprints identical |

### External gates (cannot be resolved inside this repository)
1. **Unity Editor + license**: none was available. The Unity project (`client-unity/UnityProject`) was never opened,
   compiled or built for Web; the browser path was proven with a JavaScript client and a .NET client instead (below).
   Unblock: a machine with Unity 6 LTS and a license; packet P-UNITY-1.
2. **AWS access + budget authorization**: the environment's AWS credentials were invalid (`sts get-caller-identity` →
   `InvalidClientTokenId`). GameLift staging was not run; a valid TLS certificate and public DNS were not proven.
   Unblock: a sandbox account, a budget guard, a domain; run [hosting/STAGING_EXPERIMENT.md](hosting/STAGING_EXPERIMENT.md)
   (packet P-HOST-1). The 200 matches / 1,600 players scenario stays an assumption.
3. **Owner decisions**: license (none declared), map re-pin policy (P-MAP-1), latency ceilings, the 60 FPS reference
   hardware, profile-API placement, legacy retirement (list in [backlog/README.md](backlog/README.md)).

## What Stage 1 built (and what it did not)
Built and tested: the Rust workspace (`rh-sim`, `rh-protocol`, `rh-policy`, `rh-headless`, `rh-server`, `rh-persist`,
`rh-parity`); a real gameplay slice (movement and collision with the exact legacy A* path, fists melee with zero-windup
player swings, cooldowns and lag-compensated rewind, the damage ledger with the PvP factor, mitigation, hit cap,
simultaneous resolution, kill credit, bounty, GV, the win-bonus gate, leaving as MIA, results); a differential harness that
replays captured legacy scenarios; protocol v1 with golden vectors in Rust and C#; a live WSS server; a browser proof;
PostgreSQL persistence; the policy seam; CI.

**Not ported** (everything else; see the backlog): items and the other weapons, projectiles, target lock, faction
signatures, statuses and Wishes, cards and chests, mobs and camps, consumables, traders, quests, vision memory and bushes,
terrain hazards, planning, coliseum and sudden death, training, telemetry, the bot brain, the map generator, the profile
REST API, the Unity flows and visuals, hosting integration. **The slice is not the full game; no full-game parity or
release readiness is implied.**

## Legacy baseline (revision `75c5b83`)
- Code size: shared 21k, server 37k, client 36k lines of TypeScript; 432 test files.
- Inventory, numbers, random sources, secret vs public state, hosting shape and doc/code disagreements:
  [legacy/INVENTORY.md](legacy/INVENTORY.md). The legacy architecture document moved to
  [legacy/CLAUDE_LEGACY.md](legacy/CLAUDE_LEGACY.md) (verbatim, partly stale: code wins).
- Flow traced: client input → `enqueueClientMessage` (validated, queued) → fixed 20 Hz `step()` (secret per-tick order,
  fixed system order, ledger) → Colyseus state patches + `fxs` tuples to every client (no interest management) → Phaser
  render in the past (adaptive delay) with local prediction → `resolved` results → `ProfileStore` JSON file (single
  writer; production mirrors the whole file to R2).

### Legacy test baseline (pre-existing; recorded, not caused by Stage 1)
Run on this machine while other work competed for its 4 vCPUs (so time-limited tests are fragile here):
- `npm run typecheck`: passed.
- `npm test -w @raid/client`: 2,838 passed, 5 failed (159 files). All 5 are timeouts (5 s / 30 s limits) in
  `minimapLayout`, `questPathing` and `zoneShapesBake`.
- `npm test -w @raid/server`: 5,831 passed, 8 failed (171 files; `perf.test.ts` then skipped by the script's `&&`). Six are
  timeouts (60-120 s limits: `chestsModule`, `tournament`, `mapPool` x2, `planning` "taken", `terrain` seeds 1..20); two
  are CPU-budget gates under load (`perception` cost 2.08 ms vs < 1 ms; `terrainPerf` step avg 7.2 ms vs < 5 ms).
- `npm test -w @raid/shared`: 1,816 passed, 8 failed. Five are timeouts; three are CPU-budget gates under load (styler
  12.8 ms vs <= 6 ms, pathfind 2.26 ms vs < 2 ms, warren 48.7 ms vs < 30 ms). Re-run the gates on a quiet machine.
None of these is a behavioural failure; they are recorded as pre-existing environment failures. Stage 1 changed no file
under `packages/` (verify: `git diff 75c5b83 --stat -- packages` is empty).

## Tool versions (Stage 1 environment)
rustc 1.97.0 (pinned in `rust-toolchain.toml`), cargo 1.97.0; Node v22.23.4, npm 10.9.9; .NET SDK 8.0.427; PostgreSQL 16.15;
Python 3.13.18; Playwright 1.63.0 with HeadlessChrome 153.0.8010.12; Claude Code 2.1.318. Machine: Linux 6.18 x86_64,
4 vCPU Intel Xeon @ 2.80 GHz (virtualized cloud container, native x86_64 execution, shared CPU), 15 GB RAM.

## Commands and results (actually run at the Stage 1 revision)

| Command | Result |
|---|---|
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | clean |
| `cargo test --workspace --all-features` (with `DATABASE_URL` from `tools/pgtest/start.sh`) | 63 passed, 0 failed, in three consecutive full runs (rh-sim, rh-parity, rh-protocol, rh-policy, rh-headless, rh-server incl. `live` 11, `pg_e2e` 2, `sigterm` 1, `equivalence` 1, rh-persist) |
| `cargo run -p rh-parity --bin parity-report` | 13 slice scenarios MATCH (max position error 5.0e-7 u, max hp error 4.9e-7), including `drop_releases_trigger` and four `tie_kill_credit_*` scenarios decided only by the secret action order; 300 findPath queries MATCH; `bow_wand_capture` capture-only |
| `dotnet test client-unity/RoguehallaNet.Tests` | 72 passed; `client-unity/sync-net.sh --check` up to date |
| `node tools/browser-proof/proof.mjs` | PASS (re-run after the exit-review fixes): admission + map hash, input applied and acked, resume into the same seat, authoritative results, no page errors ([evidence/browser-proof.json](evidence/browser-proof.json)) |
| `dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7461/ws --content-hash <from /info> ...` | Welcome + 157 snapshots in 8 s, RTT p50 8.4 ms, no errors; the server then drained on SIGTERM ([evidence/csharp-probe.json](evidence/csharp-probe.json)) |
| `npm run typecheck` (legacy) | passed |

### Gates at `3ad072b` (from the H-server report and review; the merge itself re-ran them; P10c, H-server-2 and H-sim ran theirs on their own branches, see sweep/README.md)
Not re-run for this docs-only record; counts are the H-server package's own gate results on its branch (`d5f2eac`..`0aff006`,
merged as `3ad072b`):

| Command | Result |
|---|---|
| `cargo fmt --all --check`; `cargo clippy --workspace --all-targets --all-features -- -D warnings` | clean |
| `cargo test --workspace --all-features` (PostgreSQL via `tools/pgtest/start.sh`) | 262 passed, 0 failed, 1 ignored |
| `cargo run -p rh-parity --bin parity-report` | 13 slice scenarios MATCH + 1 capture-only, 300 pathfinding queries MATCH |
| `dotnet test client-unity/RoguehallaNet.Tests`; `bash client-unity/sync-net.sh --check` | 138 passed (72 at Stage 1, 128 at `a0e705e`; 175 with P10c); Unity copy up to date |
| `node tools/protocol-js/check-vectors.mjs` | 12 server vectors, 31 malformed, 663 checks (v2.json at that revision; `ae0c37b`, v3.json: 14 server vectors, 45 malformed, 9 delta chains, 1945 checks) |
| `cargo build -p rh-server && node tools/browser-proof/proof.mjs` | PASS: 386 snapshots, 110 fx frames, RTT p50 0.9 ms, no page errors, `resultsOk` 2 |
| C# probe against `target/debug/rh-server` | welcome, 118 snapshots in 6 s, RTT p50 7.57 ms, no rejects; the server drained on SIGTERM |
| `pg_e2e` + director/conn/room tests + `transport`, 20 consecutive runs under 4 CPU burners | 20 of 20 green |
| `python3 tools/perfproof/perfproof.py --baseline <merge-base> --max-ir-ratio 1.03 --max-alloc-increase 0` | the CI gate (`.github/workflows/perfproof.yml`, [CONTRIBUTING.md](../CONTRIBUTING.md)); the same command runs locally with valgrind on Linux |

## Benchmarks (labelled; the machine is a shared 4-vCPU container, read the shape, not the decimals)
The tables in this section are the **Stage 1 record** (revision at the checkpoint above, wall-clock, protocol v1); the
sweep and the later passes changed the tick, the wire and the server since. Current deterministic numbers are in "Efficiency and lock-in pass" (newest) and "Sweep results" below. Wire
bytes and the tick costs in the tables below are historical; do not quote them as current.
Release builds; `x86_64`, native; the shared 4-vCPU container described above. Sources: `parity-bench`,
`parity/legacy-capture/bench.ts`, `wirebench`, `rh-headless`, and the legacy `stepBench.ts` / `bandwidth.ts`.

**Tick CPU on identical recorded workloads** (same map, inputs, outcomes; 20 runs after warm-up; µs per `step()`):

| Scenario (ticks per run) | Rust slice mean / p50 / p99 | Legacy TS (Node 22) mean / p50 / p99 |
|---|---|---|
| `crowded_8`: 8 players brawling (901) | 1.81 / 1.44 / 6.01 | 883.6 / 946.6 / 1894.6 |
| `fists_duel` (280) | 0.84 / 0.63 / 2.99 | 69.4 / 32.9 / 444.5 |
| `duel_chase` with pathfinding (716) | 0.52 / 0.31 / 1.36 | 113.6 / 54.7 / 455.0 |

Not a like-for-like "port speedup": the outcomes are identical, but the legacy world also runs every installed system
(vision memory, stat-mirror folding, camps/quests/consumables bookkeeping) while the Rust number covers the slice only.
What it does show: the slice's mechanics cost a few microseconds per tick in Rust.

**Legacy full game** (`stepBench.ts`, 8 scripted players, 204 mobs, 1,200 ticks): step avg 5.90 ms, p50 5.69, p99 12.41,
max 15.12 (gate avg < 5: exceeded on this busy machine; CPU-time avg 8.62 ms). With hazards on every 4th tile: avg 6.22.
This, not the slice, is the workload the Rust port must eventually beat; measure it per mechanic as packets land.

**Rust headless throughput** (`rh-headless`, 8 brawler bots): practice arena: 50 matches, all terminated, 76,523
ticks/s on one thread (p50 per-match mean step 14.1 µs); legacy seed-1 map 160x160: 20 matches, 364,595 ticks/s
(2.7 µs/step), all truncated at 12,000 ticks because the wandering bots rarely meet on the big map (a scripted-bot
limitation, not the sim's).

**Bytes per player, Stage 1, protocol v1** (payload only, no WebSocket/TCP/TLS framing; protocol v2 is 908, v3 305 and v4 285 B/player/s on
the "players only" workload, see "Sweep results" and "Efficiency and lock-in pass"; the other rows were not re-measured):

| | Rust slice (`wirebench`) | Legacy (`bandwidth.ts`, seed 1) |
|---|---|---|
| Players only, spread over the 160x160 map | 1.89 KB/s (mean 1.5 actors in sight) | 4.94 KB/s ("no mobs" scenario) |
| Worst case: 8 fighters in one room, all in sight | 4.87 KB/s | n/a |
| Typical / heavy with ~204 mobs | n/a (no mobs yet) | 11.18 / 15.17 KB/s |
| Join payload | Welcome with the 160x160 map: 4,911 B | first full sync 32.8 KB (6.6 KB players only); the map itself was generated client-side |

Encoding: observe + encode one player's frames 1.33 µs per tick (seed-1 map), 2.19 µs (8 in sight).

**Join and RTT** (browser proof, loopback, debug build): Hello→Welcome 2.4 ms; page load→Welcome 129 ms (TLS, `/info`);
resume Hello→Welcome 2.5 ms; Ping RTT p50 1.4 ms. C# probe: RTT p50 8.25 ms under load. Not measured: real-network RTT,
browser frame times (the Unity client does not exist yet; the legacy Phaser figures in `docs/legacy/CLAUDE_LEGACY.md`
are historical, not re-measured), memory per match (the slice's `Sim` is small; measure with mobs).

**Capacity:** not established. The slice's numbers say nothing about the full game's density; the sizing scenario
(200 matches / 1,600 players) remains an assumption (ADR 0004). The sweep added an in-process density estimate, clearly
labelled below ("Sweep results"); it is not AWS capacity.

## Sweep results (core optimization sweep, complete; merged head `ae0c37b`)
Machine for every number here: x86_64 cloud container, 4 vCPU (Intel Xeon @ 2.80 GHz, shared), Linux 6.18. Instruction and
allocation figures are **deterministic counts** (valgrind callgrind Ir and DHAT, deterministic up to the stated noise floor); wall times are not
used for any claim. Packages merged: P2b, P10a, P7a, P5b, P5c, P7b, P5d, P8, P9, the CI gate, the P10b measurement,
H-server, H-server-2, H-sim and P10c (details, per-package proofs, the merge-message omissions and the corrections to merged
claims: [sweep/README.md](sweep/README.md)). The wire was protocol v3 at this record (it is v4 since the lock-in pass, next section); figures labelled v2 or Stage 1 are history.

**Noise floor.** perfproof's self-comparison noise is about +-0.1% (up to 0.3% on the smallest per-step workloads), not the
+-0.02% earlier records stated: the sweep-wide proofs review compared `a0e705e` with itself and measured 0.9989 (crowded_8),
0.9994 (duel_chase) and 0.9991 (fists_duel), and 0.9971 on fists_duel between two revisions with no Rust change. The CI gate
(Ir ratio 1.03) and the per-package gates were sized with that in mind; differences under 0.3% are not evidence.

**Per-package results since `a0e705e`** (each against its own merge-base, deterministic counts; the full rows are in
[sweep/README.md](sweep/README.md)):

| Package | Result |
|---|---|
| P8 state identity | 0 unhashed leaves of 12,696 (66 before); hashing cost 15,170 -> 2,915 Ir per tick (0.192x); verify_replay 0.444x; step cost +1.2% (crowded_8) and +0.6% (headless_seed1_8bots), unattributed |
| P9 observation and publish | wire 32,345 -> 25,842 Ir/step (0.799x); publish 1.13 allocations per viewer-tick (22.73 -> 9.08 per step); headless 0.717x; headless_arena 0.529x |
| CI perf gate | `perfproof.yml`: Ir <= 1.03x, no allocation increase, declared fingerprints; dry run passes; not yet seen on a real PR |
| P10b delta measurement | 62.0% of bytes at 8 players (908 -> 345 B/player/s), about 1.06x publish Ir (estimate); decision: protocol v3, shipped as P10c |
| H-server hardening | wire 25,811 -> 25,918 Ir/step (+0.41%), densitybench +0.30% Ir per match-second, fingerprints identical |
| H-server-2 | small server follow-ups (camelCase `/info` keys, no session for a gone room, duplicate result reports give their lease back); no sim or wire figure |
| H-sim restore hardening | `Sim::restore` refuses the states its rules cover (rules: CONTRACTS C-DET), saturating counters, opaque `Command`; Ir vs `3ad072b` within 1.0056 on four workloads (worst `sim_duel_chase`), allocations and fingerprints identical, base-recorded replays verify; 0 false refusals on between-step checkpoints of bot and lobby matches (`restore_real.rs`) |
| P10c protocol v3 | per-connection Full/Delta snapshots encoded in the writer task, deferred never-dropped Resync (forced Fulls 20 ticks apart); wirebench 908 -> 305 B/player/s (mean snapshot 43.0 -> 12.8 B); `wire_seed1_8bots` 25,929 -> 27,178 Ir/step (1.0482x vs `2e8682c`), allocations 9.08 = 9.08, allocated bytes 366 -> 827; outcome digest and state-hash folds identical; Rust, C# (175 tests) and JS (1,945 checks) agree on `v3.json` |

**Cumulative against the Stage 1 head `7d94332`** (sim and headless rows measured at `2e8682c`: `python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,headless_seed1_8bots,headless_arena_8bots`; they stay valid at `ae0c37b` because P10c changed nothing in `crates/rh-sim`, `rh-headless` or `rh-policy` (`git diff --stat 2e8682c ae0c37b` on them is empty). The wire row was measured at `ae0c37b`: `python3 tools/perfproof/perfproof.py --baseline 7d94332 --only wire_seed1_8bots --allow-fingerprint-change wire_seed1_8bots.bytesPerPlayerPerSec,wire_seed1_8bots.meanSnapshotBytes`. Needs valgrind; gate: pass for both):

| Workload (per step / tick) | Instructions | Allocations |
|---|---|---|
| sim_crowded_8 | 15,273 -> 7,667 (0.502x, harness caveat) | 19.32 -> 0.13 |
| sim_duel_chase | 5,899 -> 3,030 (0.514x, harness caveat) | 10.71 -> 0.07 |
| sim_fists_duel | 5,511 -> 2,718 (0.493x, harness caveat) | 10.45 -> 0.18 |
| wire_seed1_8bots (protocol v3; allocated bytes 5,273 -> 827) | 50,692 -> 27,179 (0.536x) | 72.16 -> 9.08 |
| headless_seed1_8bots | 14,647 -> 7,307 (0.499x) | 13.34 -> 0.06 |
| headless_arena_8bots | 48,844 -> 21,836 (0.447x) | 32.15 -> 0.46 |

Against `3ad072b` (the previous record) the sim-side rows moved by +0.46% (crowded_8, 7,632 -> 7,667), +0.70% (duel_chase,
3,009 -> 3,030), -0.22% (fists_duel, 2,724 -> 2,718), +0.11% (headless_seed1, 7,299 -> 7,307) and +0.21% (headless_arena,
21,791 -> 21,836), from H-sim (saturating tile arithmetic and the finiteness test in the pathfinder), not isolated further.
crowded_8 and duel_chase are above the noise floor, and headless_arena arguably too. These deltas compare against an earlier
record, not an A/B run, which is why duel_chase reads 1.0070 here against the H-sim A/B maximum of 1.0056. Allocations and
bytes per unit are unchanged. Outcome digests equal the previous record; the H-sim A/B against `3ad072b` found every
fingerprint identical. At `a0e705e` (before P8, P9, H-server) the same table read 7,545 / 2,979 / 2,665 for the three sim rows, 32,345 for wire,
10,124 for headless_seed1 and 41,315 for headless_arena. The sim rows rose 1.0% to 2.2% with P8 (the statics digest and the hash
walk; above the noise floor), the wire and headless rows fell with P9. The wire row at `ae0c37b` is 0.536x of Stage 1
(v2 at `3ad072b`: 0.511x): the delta encoder costs 1.0482x for 66% fewer bytes.

Harness caveat: the `sim_*` rows compare the old `parity_bench` (parsed fixture JSON inside the measured loop) with the new one
(P7b moved the parsing out), so they include removing the harness's own work. With an overlay of the new harness on both sides
(P7b report, never committed, not re-runnable): crowded_8 0.595x and duel_chase 0.612x Ir per step vs `7d94332` at `29d341c`.
Behaviour fingerprints equal the per-package ones; the base at `7d94332` prints no outcome digest or final hash, so identity to
it is transitive across the package gates. Declared changes over the sweep: the P10a wire bytes, the P8 hash values and the
P10c wire bytes. (At `3ad072b` the declared ones were the P10a bytes and the P8 hash definition; the sim-side run at `2e8682c`
declared nothing because the base prints no hash; the wire run at `ae0c37b` declared the two byte keys.)

**Wire** (`cargo run --release -p rh-server --bin wirebench`, seed 1, 8 bots, 2,400 steps, payload bytes only), measured at
`ae0c37b`: **305 B/player/s** (snapshot 256, fx 48, events 0; 22.9 frames per player-second; mean snapshot 12.8 B, 8 Full and
19,192 Delta frames; mean 1.49 actors in sight; Welcome 4,911 B). History: 1,888 B/player/s (mean snapshot 89.8 B) under
protocol v1 at `7d94332`, 908 under v2 (P10a), 305 under v3 (P10c): 0.162x of Stage 1. The wire workload is 0.536x Ir/step of
Stage 1 at `ae0c37b`, including everything else that changed. Not measured: v3 on a real network (a client that keeps refusing
deltas costs one Full frame per 20 ticks).

**Server density** (`densitybench`, in-process: the real Room, Outbox and Pacer on a paused clock, in-process clients, no
sockets, TLS or kernel network). `cargo build --release -p rh-server --features bench --bin densitybench`, then
`target/release/densitybench --rooms 4 --humans 8 --secs 20` (practice map, 8 humans per room, no bots): notifies 1.0 and
writer wakes 1.0 per human-tick (1.097 notifies before P5c), 1.0947 frames and 92.83 B per human-tick, **4,178,279 Ir per
match-second** (callgrind: (519,590,708 at `--secs 30` - 185,328,394 at `--secs 10`) / (4 rooms x 20 s)). From the P5b report,
not re-run here: about 82 KB heap per room (DHAT, practice map, `--rooms 1` vs `--rooms 5` t-gmax), 31.1 M Ir per match-second
on the seed-1 map (2 rooms), per-room step telemetry 384 B (fixed histogram; was an unbounded sample list).

**Capacity estimate (an ESTIMATE, not measured AWS capacity):** the bench prints matches per vCPU from this machine's
single-thread paused-clock wall time with 50% CPU headroom: 539.5 on the practice map in the run above (wall time is noisy);
the P5b report recorded 566 (practice map) and 73 (seed-1 map, the large map) per vCPU. There are no sockets, TLS or kernel
network in it; the Stage 1 audit measured sockets at about 80% of server CPU on the slice, so a real instance will be well
below these figures and must be measured on the target instance (ADR 0004, P-HOST-1). Use the deterministic counts (Ir per
match-second per map, wakes and notifies per human-tick, heap per room) as the sizing inputs, not these wall-clock estimates.

**Scaling** (`cargo run --release -p rh-headless --features bench --bin scalebench -- step 212 200`). The P7b report's "ledger
Ir per entry 873 at N=32 and 878 at N=212 (1.006x; 3.96x before P7b)" did not reproduce and is **withdrawn**. Reproducible
(the sweep-wide review; `valgrind --tool=callgrind --toggle-collect='*ledger*apply*' target/release/scalebench step <N> 100`,
toggled Ir divided by the ledger entries the bench counts): **664 Ir per entry at N=32 and 740 at N=212 over the first 100
ticks, 1.115x**, under the 1.3x limit. In steady state (a differential of T=400 minus T=300) it is 592 and 945 Ir per entry,
**1.60x, over the limit**, from the linear `Credit.damaged.contains` scans in `systems/ledger.rs`; an O(1) membership is an open
follow-up (sweep/README.md). `Sim::step` Ir per fighter per step in a packed melee 1,730 / 2,628 / 5,019 / 7,204 at N = 8 / 32 /
128 / 212 (17,425 at N=212 before P7b: the melee candidate scan is still O(attackers x bodies)); observe 7.3 us and publish
9.6 us at 204 synthetic actors (wall, noisy). These P7b figures were not re-run for this record.

**Commands for these numbers:** perfproof as above (self-contained: it builds the baseline in a temporary worktree; use
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only` and about 6 GB of free disk; delete `target/perfproof`
afterwards); `cargo run --release -p rh-server --bin wirebench`; densitybench and scalebench as above;
`cargo test -p rh-sim --test no_alloc` (0 allocations per steady-state step); the CI gate and its local form are in
[CONTRIBUTING.md](../CONTRIBUTING.md) (`python3 tools/perfproof/perfproof.py --baseline $(git merge-base origin/main HEAD)
--max-ir-ratio 1.03 --max-alloc-increase 0`).

## Efficiency and lock-in pass (complete; merged head `b326676`)
Same machine and method as the sweep (deterministic callgrind Ir and DHAT counts; wall time is not used for any claim). Two stages
followed the core sweep: **efficiency** (E-sim, E-pub, E-backlog, E-simplify, E-sight) from the final efficiency review, and
**lock-in** (L-envelope, L-durable, L-sim, L-v4) for the decisions that are cheap before the bulk port and expensive after it.
What each package changed, what was dropped and why, and the open follow-ups with their locations:
[sweep/README.md](sweep/README.md), "Efficiency and lock-in pass". Per-package figures are from the package reports, each against
its own merge-base:

| Package | Result |
|---|---|
| E-sim kernel fast paths (bit-identical) | `sim_crowded_8` 0.964x, `sim_duel_chase` 0.919x, `sim_fists_duel` 0.999x, `paths_300` 0.948x, `headless_arena_8bots` 0.872x, wire 0.940x; scalebench step N=212 1,562,992 -> 1,297,737 Ir (0.830x) with identical final hashes; every fingerprint identical |
| E-pub publish path | wire Ir 0.995x; allocated bytes per wire step 827 -> 107 at equal allocation counts; `densitybench` Ir -1.0% and allocated bytes -47%; v3 bytes identical |
| E-backlog | docs: P-UNITY-PERF-1 (Codex stage), P-NET-7 |
| E-simplify | type-aware content scan (`NON_GAMEPLAY` 58 -> 17; 23 after E-sight added 6 `sight.rs` entries), lease conformance table on both stores, dead APIs removed |
| E-sight sight memo | wire 0.875x, `headless_arena_8bots` 0.832x, `headless_seed1_8bots` 0.985x; worst case (all-moving humans) +0.30% / +0.04% whole-process Ir per match-second (10 s minus 4 s); fingerprints identical |
| L-envelope | frozen Hello prefix and Reject frame, unknown Reject codes decode, strings over 255 bytes refused; owned Unity `Net/` views; wire 1.0000x |
| L-durable | `profile_id` key, versioned match record and `matches` table, tolerant blobs, `schema_compat` gate, build and content headers on replays and checkpoints, pinned durable ids; gameplay fingerprints identical. **The initial migration `0001_init.sql` changed: local and test databases must be recreated; the first production deployment freezes it** |
| L-sim | policy contract v2 (`MatchStart`), optional damage source, `FighterIx` addressing; Ir at most 1.0045x, fingerprints identical |
| L-v4 protocol v4 | **305 -> 285 B/player/s**; wire Ir 1.0041x; headless 1.0000x; Rust, C# (199 tests) and JS (2,078 checks) agree on `protocol/fixtures/v4.json`; the Result is re-sent after a resume |

**Cumulative against the Stage 1 head `7d94332`**, measured at `b326676` for this record:
`python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,wire_seed1_8bots,headless_seed1_8bots,headless_arena_8bots --allow-fingerprint-change wire_seed1_8bots.bytesPerPlayerPerSec,wire_seed1_8bots.meanSnapshotBytes`
(needs valgrind; gate `pass`; the declared changes are the two wire byte keys):

| Workload (per step / tick) | Instructions | Allocations | Allocated bytes |
|---|---|---|---|
| sim_crowded_8 | 15,272 -> 7,432 (0.487x, harness caveat) | 19.32 -> 0.13 | 1,804 -> 125 |
| sim_duel_chase | 5,895 -> 2,790 (0.473x, harness caveat) | 10.71 -> 0.07 | 625 -> 58 |
| sim_fists_duel | 5,518 -> 2,718 (0.493x, harness caveat) | 10.45 -> 0.18 | 669 -> 116 |
| wire_seed1_8bots (protocol v4) | 50,692 -> 22,344 (0.441x) | 72.16 -> 9.08 | 5,273 -> 99 |
| headless_seed1_8bots | 14,647 -> 7,098 (0.485x) | 13.34 -> 0.06 | 1,502 -> 284 |
| headless_arena_8bots | 48,845 -> 15,912 (0.326x) | 32.15 -> 0.47 | 5,014 -> 281 |

Harness caveat for the `sim_*` rows: the base side runs the old `parity_bench` (fixture JSON parsed inside the measured loop) and the
candidate the new one (P7b moved the parsing out), so those rows include the removal of the harness's own work and overstate the
simulator's gain (same-harness figures from the P7b report, not re-runnable: crowded_8 0.595x, duel_chase 0.612x at `29d341c`);
the `wire_*` and `headless_*` rows do not use `parity_bench`. Against the `ae0c37b` record above, the same rows read
7,667 -> 7,432, 3,030 -> 2,790, 2,718 -> 2,718, 27,179 -> 22,344, 7,307 -> 7,098 and 21,836 -> 15,912 Ir. Outcome digests, final
state hashes and state-hash folds equal the `ae0c37b` record, so the two passes changed no gameplay outcome. The headless rows allocate
22 to 29 bytes more per tick than at `ae0c37b` (allocations: `headless_seed1` equal at 0.06, `headless_arena` 0.46 -> 0.47); the `sim_*` rows also moved (124 -> 125, 57 -> 58, 112 -> 116 B per step). The rise splits per the package A/B logs: E-sim +17 (seed1) and +7 (arena), E-sight +5 and +22 (the sight memo table, sized per match and roster); see the sweep README. `no_alloc.rs` stays at 0 per steady-state step.

**Wire** (`wirebench`, seed 1, 8 bots, 2,400 steps, payload only): **285 B/player/s** with v4 (snapshot 236, fx 48; mean snapshot
11.8 B; 8 Full and 19,192 Delta frames; Welcome 4,911 B). History: 1,888 (v1), 908 (v2), 305 (v3), 285 (v4): 0.151x of Stage 1.
Crowd: 204 synthetic fighters cost 20,046 B/viewer/s with the v4 codec (`wirebench --synthetic 204 --ticks 60`, under the `bench` feature; 21,855 at the default 2,400 ticks; E-pub measured 20,085 with the v3 codec); at
1000 fighters 757 of 800 viewer snapshots exceed `MAX_ACTORS` and are refused (a limit for the mobs stage, not new).

**Not measured, not addressed:** the kernel socket cost. With idle lobby clients (connheap at 128 connections, strace at 16; the best case for P-NET-7) kernel and socket work is about 53% of server CPU, about one
`sendto` per viewer-tick; no package here changes that (P-NET-7, which builds on v4, is the candidate and needs an owner decision).
The `densitybench` capacity estimate above still excludes sockets, TLS and the kernel network, so it is not AWS capacity.

## Optimizations made in Stage 1 (with evidence)
| Change | Mechanism | Evidence | Behavioural risk |
|---|---|---|---|
| Interest-managed replication | Each client gets only what its observation contains (legacy synced every entity to everyone) | `wirebench` bytes per player (table above); leak tests | Vision trail memory not yet ported: a client sees less than legacy until P-VISION-1 (never more) |
| Server-sent canonical map | Clients no longer run the generator and compare hashes; one RLE blob per join | Welcome size (table above) | Generator port must keep layers identical (P-MAP-1) |
| Rust core on identical workload | Native code, no GC; same algorithms and order (parity holds) | `parity-bench` vs `bench.ts` (table above) | None measured (parity suite) |
| Off-tick durable I/O with idempotency | Results through a retrying writer (~2 min, capped backoff; the process waits for it on exit), keyed by (match, profile), fenced by the lease the seat was admitted under | `rh-persist` tests, `pg_e2e` | Lease renewal not wired; no local spool (P-PERSIST-2) |
| Hashed tokens | Profiles store SHA-256 of tokens (legacy stored plain tokens) | `rh-persist` tests | Rollback to legacy needs the original file |
| *Sweep:* derived state hash | `Sim::state_hash` is a serde walk over `World`; a new component is hashed when it becomes a serde field | `hash_coverage.rs`: 0 unhashed of 12,696 leaves; hashing 0.192x | Replays are `rh-replay/2`; the hash is server-private (C-RNG) |
| *Sweep:* due-only bot observation, one publish path | Bots build an observation only on decision ticks; the room and `wirebench` share `Publisher::frames` with reused buffers | wire 0.799x, headless 0.717x, 1.13 allocations per viewer-tick | Events between decisions are bounded (256) |
| *Sweep:* batched egress, fair reader, refusing encoders | One push and one notify per client per tick; flush once per wake; reader fairness; Events and Fx refuse, never clamp | notifies per human-tick 1.097 -> 1.0; mutation-checked tests | Superseded on the wire by v3 deltas (next row) |
| *Sweep:* per-connection snapshot delta (protocol v3) | The writer task encodes Full or Delta against the last snapshot that connection wrote; Resync deferred, never dropped | wirebench 908 -> 305 B/player/s; wire 1.048x Ir; vectors agree in Rust, C#, JS | Clients refuse and Resync on a delta they cannot apply; a lossy link costs Full frames (1 per 20 ticks at most) |
| *Efficiency and lock-in:* kernel fast paths, shared quantization, sight memo | Bit-identical fast paths in the sim kernel (E-sim), each actor checked and quantized once per wake and right-sized frames (E-pub), a derived exact-endpoint sight memo (E-sight) | wire 0.441x and headless_arena 0.326x of Stage 1; allocated bytes per wire step 99; fingerprints identical | None measured (parity, replays of base-recorded matches verify) |
| *Lock-in:* protocol v4 | Append-only varint masks, actor kind, a reserved State channel, an admission ticket, the Result kept across a resume | wirebench 305 -> 285 B/player/s; wire 1.0041x Ir; vectors agree in Rust, C#, JS | A stale client gets a decodable reload (the envelope is frozen) |
Queued with evidence or as measurement tasks: spatial indexing for
mobs and perception (P-MOBS-1, when entity counts rise), client-side A* for prediction (P-NET-1), Graviton builds (P-HOST-1).

## Defects found and fixed in Stage 1 (with regression evidence)
1. TLS crypto provider panic: two rustls providers compiled in and none selected; the server panicked at the first TLS
   handshake. Found by the browser proof; fixed by building axum-server without a provider and installing `ring`
   (`crates/rh-server/src/main.rs`). Regression: `tools/browser-proof/proof.mjs` (in CI).
2. A new room closed itself before its first player was seated when admission was still acquiring the durable lease
   (fast in memory, slower in PostgreSQL). Found by `pg_e2e`; fixed with an unclaimed-room timeout
   (`crates/rh-server/src/room.rs` `UNCLAIMED_TIMEOUT`). Regression: `pg_e2e`.
3. JSON replays/checkpoints were not bit-exact (serde_json's default float parsing); fixed with `float_roundtrip`.
   Regression: `rh-headless/tests/env.rs`.

Found by the exit review (below) or by its re-runs; each fixed on this branch with the regression named:

4. Rooms did not report the lobby → run transition; once any run was in progress new players were refused `MatchFull`
   instead of getting a new lobby. Regression: `live.rs` `a_new_player_gets_a_new_lobby_while_a_run_is_in_progress`.
5. A half-open old socket could steer or detach the seat its resume had replaced. Fixed with per-connection ids.
   Regression: `live.rs` `a_replaced_connection_can_neither_steer_nor_detach_the_resumed_seat`.
6. A player who left mid-run lost the MIA result in PostgreSQL: the profile's lease was freed first and the write
   presented fence 0 (`StaleFence`). Leases were also never released on leave, refusal or room close. Regression:
   `pg_e2e.rs` `an_mia_leave_is_banked_under_its_fence` (fails on the old code).
7. The last human's MIA result was dropped when the room closed before its next step. Regression: `live.rs`
   `the_last_humans_mia_result_is_banked_although_the_room_closes`.
8. SIGTERM (what ECS/GameLift send) was not handled: only Ctrl-C drained. Regression: `sigterm.rs` runs the real binary.
9. No liveness: a silent half-open connection held its seat forever and a stuck socket write blocked its writer.
   Regression: `live.rs` `a_silent_connection_is_dropped_and_its_seat_lapses`.
10. C# client: closing raced queued sends (a Leave was lost); a `TooSlow` reject ended the session instead of resuming.
    Regression: `RoguehallaNet.Tests`.
11. A dropped connection kept its trigger held (legacy releases it and drains queued inputs). Regression: legacy
    fixture `drop_releases_trigger`.
12. `state_hash` missed fields that decide later outcomes (GV parts, credit state, budgets, drop times, pending results);
    checkpoints lost results emitted between steps; replays loaded from JSON lacked map tables. Regression:
    `sim.rs` `the_state_hash_sees_every_outcome_field`, `a_checkpoint_keeps_results_emitted_between_steps`.
13. The parity suite never exercised the secret action order, so its negative control passed trivially. Regression: four
    `tie_kill_credit_*` fixtures and a negative control that swaps in a consistent salt and must catch the changed killer.
14. The result writer gave up after a few attempts and the process exited without waiting for in-flight writes.
15. A rate-limited (flooding) client could miss its `RateLimited` reject: the server dropped the socket with unread input
    and the kernel reset it (1 failure in a full-suite run under load). Fixed with a 1 s close linger
    (`conn.rs` `CLOSE_LINGER`). Regression: `live.rs` `a_flooding_client_is_rate_limited` (0 failures in 3 full-suite and
    6 `live` runs after the fix).
16. Docs overstated C-PERSIST, C-HOST and C-NET as fully passed; [CONTRACTS.md](CONTRACTS.md) now states what is and is
    not proven.

Found and fixed during the sweep (each with a regression test that fails on the old code; details in sweep/README.md):

17. P5d: two real admission races in `director.rs` and a test race behind the `pg_e2e` rejoin flake (3 of 15 failures under CPU
    load before, 30 of 30 green after).
18. P9: on a multi-step wake an event was judged against a later step's line of sight and some events were dropped; fixed by
    per-step filtering with a per-human carry (`publish.rs`, mutation-checked).
19. H-server: a failed admission attempt could free its profile entry before its own lease give-back landed, and a give-back could
    run in parallel with the result write it fences (owner tokens, lease states); permanent write refusals were retried; the
    `LEAVING_WAIT` bound was per attempt (about 12 s worst case); a room panic left seats and leases held; an overloaded room
    starved its inbox; Ping and Pong were not charged to the frame bucket; a flood of ready frames could hide a finished writer;
    Welcome and Reject sends had no timeout; Events and Fx could be encoded with clamped values; the JS decoder and the C#
    encoders accepted what Rust refuses.

## Exit gate: independent review
One review workflow, run read-only against this branch: four independent reviewers (high effort; lenses: simulation and
determinism, networking and server, persistence and hosting, handoff and requirements), each asked to challenge the
foundation against [REQUIREMENTS.md](REQUIREMENTS.md) and executable evidence, then one skeptic per critical or major
finding trying to refute it (6 verified, all confirmed). Ten agents in total. Every confirmed finding and the
consequential minor ones are fixed above (4-16). Accepted as open, with owners:
- Lease renewal and the crash lockout: a crashed host's profiles stay leased for the fixed 3600 s TTL; unwritten
  results live only in memory (~2 min of retries), with no local spool (P-PERSIST-2).
- A database error at admission is reported with a generic reject code (minor; P-PERSIST-2).
- The secret order salt is observable through tied outcomes (inherited from legacy; [CONTRACTS.md](CONTRACTS.md) C-RNG).
- Legacy callsigns are case-sensitive while the new store is not (owner decision; backlog list).
- Unity build and AWS staging: external gates 1 and 2.

## Risks (ranked) and next actions
1. Unity Web build unproven (external gate 1): the C# library is tested, the Unity glue was written without a compiler.
2. Hosting unproven on AWS (external gate 2): TLS/DNS on container fleets and `ca-west-1` are the main unknowns.
3. Durable sessions are not crash-safe yet: no lease renewal, no result spool (P-PERSIST-2 before any real players). A room
   panic is now contained (H-server), but a crashed host still leaves its leases to their TTL.
4. The slice's per-tick cost says little about the full game's (mobs, signatures, statuses, quests): measure each
   mechanic as it lands (`stepBench`-style gates per packet) before choosing host density.
5. Legacy behaviour lives in ~95k lines; parity coverage grows only as fast as fixtures are captured (P-CAPTURE-1 first).
6. Observation scope (current sight only) is stricter than legacy (120 s tile trail): the client will show less until
   P-VISION-1.
7. The CI perf gate has not run on a real pull request, and the state hash is server-private (never log or export it).
8. Protocol v4 (L-v4, over the v3 deltas of P10c) is merged and has only been exercised in process and over loopback (no real-network test; with idle lobby clients, kernel socket work is about 53% of server CPU and is not addressed). Restore hardening (H-sim) is merged: `Sim::restore` refuses
   the states the tick cannot survive (CONTRACTS C-DET); a packet that moves bodies past `COORD_MARGIN` or adds items or ranged
   actions must widen those rules.

## Agents used in Stage 1 (recorded per the brief)
Verified once: Claude Code 2.1.318; the Agent tool exposed a model and an effort setting per invocation; no `.claude/agents`
definitions were needed; no organization override was observed. The coordinator/lead architect was the interactive session.
Workers: legacy-inventory scout (low effort), hosting investigator (medium, web access), persistence builder (medium, isolated
worktree), C# builder (medium), backlog builder (medium); exit-gate reviewers and verifiers (high effort; 10 agents in one
workflow, outside the two-worker limit, run once at the exit gate). At most two building workers ran at once. Model names are
deliberately not recorded in this repository. The sweep used one implementer and one independent reviewer per package, plus
a fix pass where the review blocked (sweep/README.md, Method).
