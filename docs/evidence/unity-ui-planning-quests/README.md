# UI-022 planning quest review: source handoff

This is a bounded source/managed-validation receipt. No Editor, native test, Play, screenshot, browser or server-outcome run occurred in this lane.

## Identity and scope

- Root-approved exact base: `11d04034c18a6cf2764dafa82553ab4b49b3c8de`.
- Source: `ed2e4c5d15658d6b277565c32b9b5e6d7c54dbed`, branch `codex/unity-ui-planning-quests`.
- Exactly five source files: MatchHud.PlayerFlows.cs, its narrow MatchHud.Features.cs key/help hook, QuestJournalView.cs and the two affected existing Editor fixtures. No new metas/assets/screens, map renderer/controller changes, Scene, Net/mirror/protocol/Rust, movement/combat, status or Cargo.lock changes.
- The separate acceptance-ledger reconciliation is `ab817acbe6fed52121a51ee8a31b35b48e410287` on `codex/unity-ui-acceptance`; it checks the already-admitted engine20 receipts and does not accept this new source.
- Root owns review/merge and the sole art Editor owner owns future engine/rendered admission. The lane stops after this source/evidence handoff.

## Authoritative semantics checked before implementation

At the exact base, `crates/rh-sim/src/quest_view/mod.rs` publishes entitled quest rows, including an unpublished preview for its finder once publish_at exists. `quests/live.rs` keeps quest acceptance eligibility false outside Active; quest_view derives the public CanAccept fact from that authority. Giver placement occurs only in Active. These were source inspections, not new Rust execution or a client reproduction of those rules.

Accordingly, planning access is review of the current delivered QuestView. Native CanAccept remains the sole eligibility affordance; no client phase, range, deadline, reward or acceptance formula was added. An explicit accept still uses the journal's existing current Session/epoch/view/handle/CanAccept/LastResult guards and ordinary QuestAccept input. No opening/review/close action queues input. Planning previews currently arrive with CanAccept false; the UI does not invent a way to accept them.

QuestView.Roster/OwnerRoster and row.Participants are quest-reference facts. They do not establish a full lobby roster. Unpublished preview participants remain empty according to the server's publication policy. The UI displays only participants included in the selected delivered row; no visibility or privacy policy is implemented client-side.

## Behavior

- J and the existing header button open the existing quest journal during planning, including the reconnecting-planning read-only state. The planning label is `J · QUESTS` and help names the planning restriction.
- Page gating is explicit: only quests are accessible during planning. Trader and Notice tabs are disabled and their deferred callbacks recheck the current gate. Entering planning closes a previously open non-quest page. Ordinary run pages recover when delivered planning state ends.
- The planning map and decision rail remain rendered/instantiated with the same server-confirmed spawn, boon and Ready facts. The journal temporarily disables the map's CanvasGroup interaction/raycast flags so exposed map/rail edges cannot receive UI actions behind the modal. Alpha is untouched. Closing restores the captured flags and restores an eligible remembered map control only for the same Session/epoch still in planning.
- Existing modal/text-entry, map-key and world-input fences remain. Opening J with Tab, planning digits, movement or F cannot select a spawn, Ready, accept, move, pick up or attack behind the journal. J closes it normally. Drop/Welcome/timeline lifecycle uses existing row/action cleanup and restores map input.
- The existing detail scroll gains a readable fixed-font PARTICIPANTS field. Typed RosterId lookup preserves source order and duplicate display names; OwnerRoster adds the `You` marker. Only delivered Accepted and Progress are formatted. No Visited bit math, completion target, full roster or camp/location inference is introduced. Text is literal, wrapping and scrollable; formatting is cached per immutable view/selected-row pair and clears on selection/replacement/rebind.
- HUD corners, icon opacity/colour, navy glass, map size, actor scale, route/Ready logic and ordinary pickup remain inherited. This packet adds no new map point or actor.

## Validation

```sh
/Users/nevinmckinnon/.dotnet/dotnet build /tmp/roguehalla-ui-planning-quests-compile/tests/Tests.csproj --nologo -v:q
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter 'FullyQualifiedName~PlanningSelectionsTests|FullyQualifiedName~QuestBridgeProtocolTests' --nologo -v:minimal
```

Two managed graph compiles passed, each with zero errors and one existing unused-event CS0067 warning in MatchHudTrophyEditModeTests. The second follows a fixture-only consistency clarification: participant rows are Open rather than unpublished previews and native owner accepted/progress fields match the explicit delivered participant values. Both raw outputs are tracked; the final compile matches the sealed source. The matching Net, actual Unity runtime source and all Editor test source were compiled against installed Unity6000.0.85f2 and art package assemblies, with separate runtime/test intermediate directories. Compilation does not execute Unity.

Focused unchanged pure controls passed **11/11**: PlanningSelections5 and QuestBridge6. Raw stdout chunks from the single invocation are preserved in `pure-controls.log`; no broad suite or Rust test was run. No expectation or engine failure was suppressed. A pre-compile read-only review caught and corrected two new assertions that had treated the existing void SelectQuest method as boolean; they now check displayed current selection and rejected old-handle action instead. No compile failure occurred for that source correction.

All original20 method identities and bodies are preserved; **five methods are added**, producing **25 compiled, engine-UNRUN** selectors (QuestJournal8, TraderDialog6, PlayerFlows11). The earlier exact engine20 pass at43e6d08d is historical and does not transfer to the changed source. New real encoded Session fixtures cover planning map/rail and Ready=false/true preservation, no commands on review, J+Tab/world/digit ownership, per-page gates, current native acceptance, deferred stale callback retirement, drop/reconnecting J, resumed Welcome, text/settings focus and typed duplicate participant labels/removal/rebind. Existing core tests retain notice ordering, epoch fencing, batching and other prior controls. See `native-selectors.txt`, `added-native-selectors.txt` and `validation.json` for exact identities/hashes/check counts.

Source scope/whitespace, exact commit byte hashes, unchanged metadata and native selector/body preservation checks pass. `source.sha256` pins all five changed files; the managed project paths/hashes are also recorded. No live Editor/project preferences were touched.

## Remaining acceptance

Root must review/integrate this exact source and release the finite25 engine selector list to the sole Editor owner. Actual rendered planning/journal layering, large participant lists/long strings at720p and1440p with100%/150% text, keyboard focus and real routed map/rail click rejection still require an advancing Play/rendered gate. CanvasGroup flags and EditMode assertions do not substitute for those hits or pixels.

Actual server-driven planning preview publication, phase transition, acceptance/refusal, reconnect and full browser flow remain unaccepted. This is no full UI-022, full lobby roster/build, camp map or original inventory completion. The historical cyan drawer, frame-progress/capture blocker, other held screens, browser chain, accessibility and performance gates remain unchanged. No optional UI expansion is included.
