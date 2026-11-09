# Unity player-flow independent source review

**HOLD — two bounded fixes before the actual Editor gate.** Exact source `49903926f770fa81ebaec3e3be838920bc01d6e7`, evidence seal `8c21f0e5faf13cc35f8f15c5a23a811d6b4827ab`, base `0ffc9665f4254e362b7c0887083803af568198a0`; clean reviewed checkout `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-ui-player-flows`. No candidate/main/root/status/lock edits or execution were made. Findings below are source-derived, not observed engine-test results.

## Required bounded repairs

### P2: same-Session timeline reset does not fence an already-dispatched notice callback

`client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs:158` captures only Session identity. `Events` at213–218 appends whenever that Session is still bound. `MatchHud.PlayerFlows.cs:82–90` clears the feed and advances its epoch on TimelineReset, but does not invalidate an old callback's originating epoch. Thus a callback already in an EventsReceived multicast invocation list can append a pre-cut batch after the feed was cleared for a new epoch. The existing old-Session rebind test covers a different boundary.

Concrete source reproduction using the existing real encoded Session fixture (no reflection into canonical state):

1. Start from its accepted Tick1/ServerMs50 snapshot. Register a one-shot EventsReceived subscriber before the HUD subscriber, using the existing unsubscribe/re-Bind ordering pattern in `InFlightOldSessionNoticeCallbackCannotAppendAfterRebind`.
2. Deliver an Events Toast batch. In that earlier subscriber, deliver a valid newer Tick2/ServerTimeOverrideMs50 Snapshot through the same fake transport. Session's actual source-cut predicate increments TimelineEpoch and invokes TimelineReset; HUD clears its notice feed and sets the new `_playerFlowEpoch`.
3. Return to the original EventsReceived invocation list. Its old HUD delegate still passes ReferenceEquals because the Session object is unchanged. `Events` sees the already-updated epoch and appends the old Toast into the new history.

Minimal repair: bind each notice delegate to Session **and its originating epoch**, rotate/invalidate that binding when TimelineReset is processed, and reject an old dispatched delegate after either boundary. Capturing the epoch only once at initial Bind is insufficient because Welcome legitimately advances it. Keep new-epoch first-batch preservation and the existing cross-Session guard. Add one focused same-Session source-cut analogue of the existing rebind control: old batch absent; the next new-epoch batch preserves every ordered entry, including duplicates, after TickPlayerFlows without loss or double append. This requires only UI subscription/lifecycle code and its focused Editor fixture; no Net/protocol change.

### P2: one compiled reconnect test contradicts its explicit runtime branch

`QuestJournalView.cs:149` maps SessionState.Reconnecting to `Reconnecting · quest actions paused`. `QuestJournalViewEditModeTests.cs:253–256` drops the transport, refreshes, asserts that exact Reconnecting state, then expects `Quest journal unavailable while disconnected.` The two cannot both pass. This is a definite source/assertion mismatch, not a reported engine failure.

Minimal repair: assert the deliberate reconnect-specific message for that proven state, preserving the same test's no-accept, cleared rows, resumed Welcome and missing-old-handle controls. Do not change production eligibility or accept a generic/default/nil result just to pass. The currently compiled19-selector count is historical; add/update the finite retake list if the new epoch regression raises the repaired count.

## Otherwise acceptable source boundaries

- Quest row/accept callbacks retain Session, TimelineEpoch, exact immutable current QuestView and handle; actions recheck current membership and server CanAccept immediately before ordinary Input.QuestAccept. LastResult blocks acceptance even before MatchEnded. Pending text changes no canonical owner facts; deadline copy never changes eligibility. All five Rust presentation strings remain literal via unchanged MythicUi.Text.richText=false; typed handles, not labels, select authority.
- Trader callbacks bind Session/epoch/view/render generation/current selected merchant index and kind; they revalidate state/LastResult/choice bounds at intake. TradeUsed blocks Stats only. Barter does not infer range, timing, costs or availability from display math. Duplicate merchants, labels and stat rows remain ordered; signed values are presentation formatting. Explicit choices use ordinary Input.Trade, and opening/rebinding never rolls, spends or retries.
- Unseen/unavailable/available-empty handling, replacement cleanup, queued-command clearing through real Session Welcome, disconnected disabled trade rows and result-before-MatchEnded guards are present. Quest disconnect clears rows/actions. Ordered notice storage preserves duplicates and empty Toast strings across batches without matching transaction attempts by text; both full/recent text use literal TMP rendering. The epoch finding concerns an in-flight boundary, not ordinary sequential Welcome handling.
- Tactical map additions consume only delivered merchant points, giver points and objectives belonging to a currently tracked published QuestHandle. Empty/unavailable/disconnect presentation clears them. Neutral marks/labels are UI shapes, not fabricated actor identity, attack capabilities, physics or inferred locations. Existing actor projection/collision code is unchanged.
- The new launcher/panel focus hooks block simultaneous world/map input and keep account/settings/build/help modal rules. New result processing closes flows once per new authoritative Result; subsequent history access uses the existing stored-result identity guard. No local gameplay rules or outcome synthesis was introduced.

## Seals and retained validation scope

Independently verified all18 source manifest entries against exact source49903926, sealed8c21f0e5 and current bytes; source.sha256 itself is `5a626db4bc9438859c9f92a65df801b55f2c0ee302fad56d8f17038ac2ab833c`. The complete source diff is exactly those18 files including metas; the final diff is25 files (seven evidence files added). No Net/mirrored Net/Rust/protocol/status/lock/assets/scenes changed. New meta GUIDs are unique within the tracked Assets tree.

All19 native selector identities match actual compiled methods: QuestJournal7, Trader6, integration6. They use actual Session encoded fake-transport delivery and ordinary InputSender. Existing tests cover17-command batching, no automatic opening commands, invalid effective references, stale replacement/rebind, Result gating, duplicate notices, map clearing and simultaneous keyboard input. These19 methods are **COMPILE ONLY / engine UNRUN**; the reconnect assertion defect is therefore not contradicted by their compile receipt.

Read retained initial CS1503 fixture-helper compile failure and corrected final compile (zero errors/one inherited unused-event warning); no expectations were removed by the typed helper overload. Both recorded managed project templates still exist, match their recorded SHA256s and point to this source tree. Read the unchanged pure Net14/QuestBridge execution excerpt:14/14 passed. Those14 pure Net passes do not execute the new Unity fixtures or prove layout, TMP/native lifecycle, raycast/mask behavior or browser authority.

No build/test/capture/Editor/browser/cloud command was run for this review. Root should keep the sealed author refs, request only the two bounded repairs, re-review their exact diff, then let the sole Editor owner run the repaired finite selector list on the integrated revision. Actual rendered720p/1440p/text scaling/focus and authoritative browser quest/trade/reconnect acceptance remain separate required gates; no new screen or feature scope is proposed here.
