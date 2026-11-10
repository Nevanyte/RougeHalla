# Ordinary player-flow cases — preparation only, NOT RUN

This file is a source-backed action/evidence plan, not a browser result or runtime
release. Native source reference: `c52e41a633c91f8402e3f68724e9202351d1cdb3`.
Current Unity target: `57e166f46b35fb703e5f3c76914fcc4e8bf3191c`.
Root reports that main `5e19ef1b801ef363a83217ddecd768c5aba71cac` has the same
client/protocol tree as57e166. The C# controls and source anchors below are unchanged.
The accepted client-target changes are three serialized Unity assets: two
whitespace-only changes and the TMP build-clear1×1 change. Root owns their exact
manifest/equivalence receipt; this statement does not independently validate them.

The historical actual98 Editor result remains scoped to
`6d5d9340a6b9f425a17d7ea4488b49291fff3dc1`; it is not relabelled as a57e166 run and
does not satisfy any browser or raster case below. Root owns the runtime plan,
artifact pins and execution release.

The final Web build/source-overlay manifest, resource hashes, served-byte receipt,
browser version, router configuration, matching Arena/Training `/info`, native
executable/configuration and approved observation script hashes are **PENDING**.
Web1 remains **HELD**. Root released Web2 from frozen57 to the new output
`web-build-57e166-2026-11-09/Web`; its actual output hashes/served bytes remain
pending and are not invented here. The native c52 target is unchanged. Preserve
the earlier6d/c52 PRECHECK and build history as their own cuts. Root's runtime plan
must bind the actual57/c52 outputs and the retargeted checker/new PRECHECK before
execution; old collector/source pins are not silently reused as current acceptance.

## Common controls and prerequisites

Use the ordinary rendered Canvas/uGUI controls with trusted input. Names below
identify source controls, not DOM selectors or guaranteed screen coordinates.
Determine their pixels from the actual released artifact. No handler invocation,
product hook, teleport, installed state/Result, synthetic receipt or debug route
is part of these cases. No credential/profile/checkpoint/storage read or editing
is permitted by this preparation packet. Ordinary account operations may persist
their own state; the observer must not inspect it.

| Purpose | Ordinary action / expected label | Unchanged UI source anchor |
| --- | --- | --- |
| Claim a new callsign or load its existing owner | Callsign field → **LOAD**; successful existing profile shows **Profile loaded. Choose a faction and start your run.** | `MatchHud.Accounts.cs:32–35,154–190`; `MatchClient.Accounts.cs:100–112` |
| Initial Arena seat | Faction choice → **START RUN** | `MatchHud.Accounts.cs:37–51`; `MatchClient.Accounts.cs:130–146` |
| Initial solo practice seat | **TRAINING** | same launch controls; `MatchClient.cs:109–124` |
| Deliberate saved-seat attempt | **RESUME…** → **RESUME ARENA** / **RESUME TRAINING** | `MatchHud.Resume.cs:29–45,102–108` |
| Planning | Available **1 · SPAWN 1** / **2 · SPAWN 2**, offered boon label, then **READY**; await authoritative confirmation / actual raid | `TacticalMapController.cs:79–86,240–268` |
| Quest/trader panels | **J · JOURNAL** or unmodified **J**; **QUESTS**, **TRADERS**, **NOTICES**, **CLOSE** | `MatchHud.PlayerFlows.cs:30–75`; `MatchHud.Features.cs:259–270` |
| Move / interact / combat | WASD or arrows; world RMB to move; LMB/hold to attack; **F** picks up current delivered focus; **R** Wish | `MatchHud.Features.cs:184`; `MatchClient.cs:308–376` |
| Text size | **SETTINGS** → **Text size**, displayed `1.00×` / `1.50×`; close with **CLOSE · ESC** | `ModernSettingsView.cs:37–69,195–220` |
| Final saved-credit retry | Result panel **Check again** when enabled | `MatchHud.Settlement.cs:10–26` |

Use genuinely owned dedicated test callsigns; merely typing a name does not prove
ownership. Initial claim may use a new valid callsign through LOAD. Existing
ownership/passcode input, if needed, uses the ordinary sign-in UI privately and
stays out of screenshots/metadata. Never reveal/copy a recovery key for evidence.
After reload LOAD must re-establish the same existing owner, not claim a substitute.

Root's released Source profile must genuinely reach Active with the required human
population, map and normal planning/lifecycle. The previous plan's min-players2
profile needs a second ordinary human seat; bots alone do not close that lobby
(`room.rs:890,1093–1097`). Do not shorten the lifecycle or substitute a fixture.
Training is a separate solo/immediate practice endpoint. Both destinations and
account API must use the released same browser-origin configuration. Ordinary
direct owned Join is supported; `/control` is not a browser UI route.

Close text fields and blocking panels before gameplay input. Planning permits
quest review only: trader/notice tabs are disabled there, and review cannot move
the character (`MatchHud.PlayerFlows.cs:55–75,99–120`). Panels do not pause a run.

## R-A / R-T: genuine new-document reload and same-seat Resume

Run separate natural cycles for Arena (R-A) and Training (R-T). The tab holds one
saved run/mode; an Arena save and Training save are not simultaneous independent
slots. Do not use **FORGET SAVED RUN** during a positive cycle.

1. LOAD/claim the genuine owner, then **START RUN** (Arena) or **TRAINING**.
   Arena: complete ordinary planning and wait for actual Active gameplay.
   Require an initial nonresume Hello and its public Welcome, then the ordinary
   verified mode HUD and playable world. Arena's active phase strip is **RAID ·**;
   Training is **PRACTICE · NO RUN REWARDS**. Welcome has no mode, and the default
   `Training=false` is never mode verification (`MatchClient.cs:46–54,109–124`;
   `MatchHud.Features.cs:204–211`).
2. Use ordinary movement, release input, and record the rendered outcome. Natural
   checkpoint saving occurs only after the current owned mode-verified accepted
   snapshot (`MatchClient.Resume.cs:205–223`). Successful saving silently clears
   ResumeStatus: there is no positive “saved” indicator. Do not inspect storage.
3. Record only approved public Welcome fields (protocol/content, raw16 match hex,
   player ID), current-mode screenshot and the own observer metadata. Perform
   ordinary same-tab browser **Reload**. Do not Leave, close the tab, replace the
   BrowserContext or use Training's bare Escape (it deliberately leaves practice).
4. Establish a genuine new document/Unity runtime: same tab/browser context/origin,
   changed execution-context witness, per-document nonce and `performance.timeOrigin`,
   navigation type `reload`, no BFCache restoration. A soft socket reconnect or
   reinstalling the observer in the original document is insufficient.
5. In that new document, **LOAD** the same existing owner → **RESUME…** → the
   matching explicit **RESUME ARENA** / **RESUME TRAINING** button. Do not click
   START RUN/TRAINING. Correlate the actual trusted pointerup with screenshot
   evidence. No game socket/Hello may precede that pointerup; require one resume
   Hello (`resumePresent=true`) and the same connection's subsequent Welcome.
6. Require exactly the initial public match bytes and player ID. Await a newly
   verified correct-mode HUD and then rendered gameplay, in that order after
   Welcome. Close panels, perform ordinary movement and record the newly rendered
   response. Training's console must be available only in confirmed practice;
   use **CONSOLE → TRAINING CONSOLE → CLOSE** to observe its ordinary view, without
   invoking spawn/set/clear actions. Its availability is not an Arena result/reward
   (`TrainingConsoleView.cs:61–65`; `MatchHud.Training.cs:38–48`).
7. Keep observation coverage through the final gameplay sample, so a later fresh
   join/fallback cannot be omitted by exporting an early wire snapshot. No
   nonresume Hello, replacement match/player, wrong mode or fallback is accepted.

Keep normal50ms/20Hz pacing and unchanged default real10s grace (`room.rs:30–33`).
Startup, Web loading, LOAD and Resume verification all consume real time. Record
reload-request → resumed received Welcome (strictly less than10000ms for this
bounded success case), and trusted Resume pointerup → Welcome separately. Use
the same document's monotonic time for within-document ordering. Browser pagehide
or the reload request is **not** an exact server Away timestamp. Exact Away/grace
cause requires separately released credential-free server corroboration; without
that corroboration the exact countdown claim remains OPEN. Never extend grace,
alter timers, edit cache or use accelerated native-test pacing to obtain a pass.

Success requires the whole chain above; raw wire prefixes do not attest Unity
acceptance or rendering. Missing artifact/observation evidence is OPEN. Changed
identity, pre-click connection, fresh fallback, wrong mode or contradictory
rendered behavior is FAIL. A warm build that cannot reload and verify under the
default window is an observed limitation, not permission to increase grace.

## R-N: separately reported refusal controls

Each control starts with a naturally saved real seat; it is not a replacement for
either positive cycle. Use current ordinary UI and keep secrets opaque.

| Case | Action after same-tab reload | Expected finite outcome |
| --- | --- | --- |
| Different current owner | LOAD another genuinely owned callsign, then Resume original mode | **The saved run does not match this profile, destination or build.** No game connection. |
| Wrong saved mode | Save Arena, reload, LOAD same owner, choose **RESUME TRAINING** | Same mismatch line, no game connection; this proves mode-context mismatch only. |
| Expired seat | Save natural seat, reload without Leave, allow real expiry, LOAD same owner and Resume original mode | If the actual typed `NoSuchSession` path occurs: **That saved run is no longer available. Start a new run separately.** Resume Hello, no Welcome/fresh fallback. A second explicit attempt shows **No saved run is available in this tab. Start a new run separately.** without connecting. |

Generic **Could not resume…** or another rejection does not prove expiry. Such
failures keep details for explicit retry/Forget; never manufacture the desired
refusal by installing a record. Endpoint/content mutation and in-flight stale
callback races are not covered by the natural wrong-mode case. Source:
`MatchClient.Resume.cs:99–164,226–251`; `MatchHud.Resume.cs:145–168`.

## Q-A: actual Arena quest acceptance and automatic turn-in

This is a separate gameplay case after a verified live Arena launch/resume. It
requires a genuinely published, completable quest and sufficient live time. No
specific quest, hidden giver/objective, spawn coordinate or seed is promised.

1. **J · JOURNAL → QUESTS**. Select an actually delivered row. Record its real
   name, giver, brief, objective, reward, participant/status text and server
   deadline. Use **TRACK OBJECTIVE** if useful. Close the journal and use ordinary
   movement toward delivered map giver/objective marks only. Tracking is a local
   guide; it does not move the player or reveal hidden points.
2. Approach the actual giver through normal movement. Reopen the selected row;
   press **ACCEPT QUEST** only when the current delivered `CanAccept` makes it
   available. **Acceptance queued · waiting for server update** is a queued intent,
   not success. Require the subsequent owner **Accepted** state/current participant
   change and ordinary notice. Native acceptance requires Active, standing/action
   eligibility, an open published quest, giver, range64 and LOS.
3. Fulfil the actual displayed objective with ordinary combat/camp-clear/pickup
   gameplay, as applicable to that quest. For pickup use **F** only at the normal
   current focus; do not call a command or write inventory/progress. Capture the
   real progress/carrier/ready transition supported by the delivered UI and notices.
4. Return to the delivered giver with the genuine prerequisites met. **There is
   no TURN IN button.** The native quest system automatically completes a ready,
   standing human within64 units and LOS while gates permit it. Record the actual
   **Quest complete: <name>** notice and corresponding delivered completed/closed
   row, owner GV/stat presentation where observable. Continuous capture may be
   necessary because ready/completed states can be brief.

Anchors: `QuestJournalView.cs:53–70,256–298,347–368`;
`TacticalMapMarks.cs:46–66,85–90`; `quests/live.rs:589–663,666–763,868–899`;
completion/reward channels at `quests/live.rs:357–381`.
Native files above are under `crates/rh-sim/src/`.

If no entitled quest exists, the route cannot be completed naturally, the quest
expires or another player wins it, record that actual result and leave the desired
completion OPEN for a separately authorized natural attempt. Do not turn an
Editor fixture or native encoded-router acceptance test into this browser proof.

## T-A: actual Arena trader interaction

1. Find an actually delivered visible merchant via normal exploration/map; open
   **J · JOURNAL → TRADERS** and select its current **VISIBLE MERCHANTS** row.
   The UI renders its actual name/kind and public **X / Y**. Walk normally toward
   the merchant and refresh its current delivered position: traders can move.
2. For Stats, wait for genuine first-contact offers. Record the delivered quote's
   label/cost/gain, choose one ordinary offered button, then require subsequent
   **stat trade used this run**, delivered applied-stat rows and/or authoritative
   **Stat trade: <label>** notice. **choice queued · awaiting server state** alone
   is not a trade. Retained offers do not prove present range/arrival.
3. Separately, if naturally obtained weapon/potion prerequisites permit a barter,
   select the real Barter merchant and an actual displayed numbered choice. Require
   the resulting inventory/potion change and **Traded for…** / **Traded weapon for
   a small healing potion** notice. Respect the server's barter deadline/cooldown.
   A legitimate refusal proves that refusal only; it does not satisfy a successful
   barter case. No inventory grant, teleport or forced clock is allowed.

Native trade requires Active/standing/action eligibility and current range112 +
movement LOS. Stat trade is once per run; barter has its own prerequisites/cooldown
and is not disabled merely because stat trade was used. UI buttons defer authority
to Rust. Anchors: `TraderDialogView.cs:155–211,244–320,499–549`;
`crates/rh-sim/src/traders/runtime.rs:108–150,217–281,283–383`.
Unavailable/empty trade view and missing real resources remain honest OPEN
prerequisites. Training has no quest/trade/plan collection
(`crates/rh-server/tests/runtime_admission.rs:626–643`); Q-A/T-A are Arena-only.

## B-A: genuine Source Result → authenticated saved-credit confirmation

This is its own acceptance chain, not inferred from Resume, quest reward, a trader
change, displayed run GV, Session.Ended, a balance delta or a declared fixture.

1. Use the released real Source Arena/map, ordinary owned human seats and normal
   planning/gameplay at20Hz. Reach a real native resolution/outcome through ordinary
   gameplay, with no installed Result, manipulated HP/kill, forced lifecycle or
   test endpoint. A deliberate reload failure/MIA is not a substitute for the
   planned earned-outcome case. If it is not reached, this chain remains OPEN.
2. Observe the genuine **RUN RESULTS** panel (Victory/Draw/Defeated/etc., place,
   kills, GV and duration) from the current session's actual Result. Correlate it
   to the current public Welcome match bytes and owner. A panel saying **No
   authoritative result received.** is expressly insufficient.
3. Keep that owner/session/match current. The existing service automatically starts
   a bounded authenticated receipt burst after the first genuine Result when
   Arena is verified; it can make at most three reads (initial, then2s, then5s).
   If needed, use **Check again** only when enabled. Do not loop a hidden API,
   mutate balances, synthesize a receipt or return to menu before the observation.
4. Require ordinary **Saved credit confirmed: +N GV** for the exact match and a
   genuine committed authenticated receipt. **Checking saved credit…**, **Saved
   credit not confirmed for this match.**, paused/error states or an `unknown`
   response are not confirmation. `unknown` does not mean pending. A voided
   committed receipt is labelled **Match voided ·** and is reported distinctly.
5. Root's separately approved credential-free evidence must tie normal gameplay's
   native Result to fsynced spool, actual PostgreSQL commit and the existing
   owner-authenticated settlement read, with only allowed public outcome/GV and
   aggregate status fields. Preserve the exact current Welcome network-order UUID;
   do not hash/log/copy private tokens, headers, DB rows, spool or replay contents.
   Ordinary **PROFILE & RECORDS** reconciliation after confirmation is supporting
   evidence; a balance increase alone is not the per-match receipt.

The normal service calls
`GET /api/profile/{name}/matches/{network-order-Welcome-UUID}/settlement` with its
opaque current-owner credential. It validates the returned match and fences owner,
session, join generation, timeline and stale completions. Sources:
`MatchHud.cs:289–301`; `MatchClient.Settlement.cs:35–54,107–138,146–191`;
`client-unity/RoguehallaNet/Net/AccountApiService.cs:165–214`.
Training has no normal Result/banking (`crates/rh-server/src/room.rs:439`), and its
**PRACTICE · NO RUN REWARDS** must not be presented as B-A.

The existing reload observer allowlist covers public Hello/Welcome metadata; it
does not parse accepted Result/quest/trade or authenticated HTTP receipts. Its
consistency result cannot close Q-A/T-A/B-A. Further evidence collection must be
explicitly reviewed by Root before execution, without widening credential reads.
Durable DB/spool configuration and cleanup belong to Root's separate runtime plan;
this file supplies no process/DB command or execution approval.

## Browser presentation matrix and result ledger

Coordinate with Art after the actual coherent Web artifact and runtime are released.
Use actual browser content-viewport dimensions, recording DPR/browser zoom/fullscreen
state; do not claim Editor preview, physical display resolution or CSS dimensions
alone establish rendered canvas size. Set text through normal **Text size** UI;
capture the displayed value, and confirm its ordinary post-reload state without
reading preferences. Root/Art own any run sequencing and layout adjustments.

| Case family |1280×720 / default1.00× |1280×720 /1.50× |2560×1440 / default1.00× |2560×1440 /1.50× |
| --- | --- | --- | --- | --- |
| R-A Arena genuine reload + resumed rendering/input | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| R-T Training genuine reload + resumed rendering/input | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Quest/trader/Result/receipt panels, when naturally reached | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

For each tested cell retain meaningful before/after screenshots and trusted action
timings: menu/LOAD, Resume chooser, correct-mode active HUD, resumed input outcome,
and any actually reached journal/trader/result/receipt state. Check readability,
clipping, scrolling, reachable buttons and modal focus at the current text setting.
Rendering a panel does not satisfy its gameplay/receipt case. A panel not naturally
reached in that cell remains OPEN; do not silently reuse another size/mode's raster.

Each recorded outcome must identify exact artifact/runtime/observer manifests,
case + matrix cell, public match/player correlation where applicable, observation
coverage and actual PASS/FAIL/OPEN reason. Preserve failed attempts. Nothing in
this preparation is an actual gameplay, browser, latency, cloud or banking pass.
