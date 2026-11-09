# Unity UI player flows: source handoff

Recorded 2026-11-09 05:04 UTC (2026-11-08 local). This is a bounded source and managed-validation receipt, not Unity or browser acceptance.

## Identity and ownership

- Branch: `codex/unity-ui-player-flows`.
- Base: `0ffc9665f4254e362b7c0887083803af568198a0` (Root-approved integration including Net14 `afdc6f7f12559a654c133fc6ca9377ce5548b10c`). Older protocol11 gap reports do not describe this API.
- Source: `49903926f770fa81ebaec3e3be838920bc01d6e7`.
- Source lease: four new runtime partial/view files and metas, narrow hooks in MatchHud/Features and TacticalMapController/Marks, three focused Editor test files and metas: 18 files total. `source.sha256` records their exact bytes.
- No Net, mirrored Net, protocol, Rust, assets, scene, movement, combat, global status record or Cargo.lock edits. Root owns merge/admission; the art lane owns the sole live Editor.

## Delivered behavior

`J` or the Journal header opens a central, exclusive Quest/Trader/Notice panel using existing glass styling. The three existing header actions hide while it is open and restore on close. Escape closes it; input focus blocks underlying movement, attack, pickup and tactical-map actions. Existing stats top-left, health bottom-left, doubled minimap, 1.2 actor/overhead scale, opaque semantic icon colours and translucent navy treatment are inherited and untouched by this packet.

The quest journal distinguishes unseen, unavailable and available-empty views. It renders all five native Rust presentation strings verbatim with rich text disabled, wraps readable fixed-size text inside a masked scroll area, preserves list scroll/selection on metadata updates, and exposes server CanAccept directly. Explicit accept sends only QuestAccept(handle), then shows awaiting-server feedback without changing owner facts. Tracking draws only objectives actually published for a current tracked handle. Deadline text is a display-only countdown from the accepted Session clock; it never changes eligibility. There is no invented decline, turn-in, quest rule or reward action.

The trader panel keeps source order, duplicate names/labels and signed native values. Opening sends no command. Explicit current choices send only Trade(kind,pick); TradeUsed blocks Stats only. There is no local price, range, eligibility, cooldown or offer-cycle calculation, retry or automatic spending. Merchant/choice callbacks guard Session, TimelineEpoch, exact current TradeView, render generation and selected current merchant index/kind. Rebinding or resumed Welcome immediately removes old rows/details; queued input is cleared by Session. During an interrupted connection, retained canonical rows are shown with connection status and disabled controls; they are not current map cues. Result also blocks accepting/trading before a separate MatchEnded arrives.

The received notice history preserves notice order across batches, including identical and empty Toast strings, and never correlates transaction attempts by text. New Session binding and TimelineEpoch clear the feed before any first new batch can appear. The compact feed is suppressed by full panels; history scroll position is preserved unless the reader was already at its tail. Formatting is presentation-only and uses existing/public notice codes.

The small map slice draws only delivered merchant positions, giver positions and the current tracked quest's delivered objectives. Neutral shapes distinguish them from actors; large-map labels use supplied names. Duplicate rows remain distinct. Available-empty replacement, unavailable data and disconnect remove current marks immediately. No actor, attack target, physics object or inferred camp/timer/location is added.

## Validation performed

The managed graph compiles the matching Net source, all Unity runtime scripts and all Editor test sources against installed Unity 6000.0.85f2 assemblies and the art checkout's package DLLs. Runtime/test projects have separate intermediate directories. This checks C# compilation; it does not execute Unity lifecycle, render, native input or engine tests.

```sh
/Users/nevinmckinnon/.dotnet/dotnet build /tmp/roguehalla-ui-player-flows-compile/tests/Tests.csproj --nologo -v:q
```

Initial invocation failed at a trader test fixture helper passing TradeState where WireTradeView was expected. A typed TradeState overload repaired the helper without removing any expectation. The necessary second invocation passed: **0 errors, 1 pre-existing unused-event warning** in MatchHudTrophyEditModeTests. Both outputs are preserved as `managed-compile-initial.log` and `managed-compile-final.log`.

```sh
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter 'FullyQualifiedName~TradeQuest14ProtocolTests|FullyQualifiedName~QuestBridgeProtocolTests' --nologo -v:normal
```

Focused unchanged pure Net selectors: **14/14 passed**, exit0. `net-tests-excerpt.log` preserves the test-execution portion; noisy restore/compiler/copy output was not retained. No broad suite was run. `git diff --cached --check` passed before the source commit; new meta GUIDs are unique across this checkout's Assets.

Three new Editor fixtures contain **19 compiled, unexecuted methods**: journal7, trader6, integration6. `native-selectors.txt` lists exact identities. They use encoded fake-transport frames decoded by the real Session and ordinary InputSender, covering opaque strings, tri-state views, metadata replacement, stale callbacks, binding/Welcome/disconnect, Result-before-MatchEnded, ordered duplicate notices, mixed 17-command split, invalid effective references, delivered map removal and simultaneous J/Tab/world keys. No tests reproduce gameplay formulas.

## Remaining admission and limitations

- Root must integrate the source and the sole Editor owner must run all 19 new selectors on the exact integrated revision. None has been engine-run by this lane.
- Rendered quest/trader/history inspection remains required at representative 720p/1440p, 100%/150% text, long strings, overflow lists, keyboard focus and reduced motion. Real GraphicRaycaster hits, outside-mask rejection, routed wheel/click and advancing Play frames remain required; geometry and direct callbacks do not substitute.
- This packet creates no PNGs, enters no Play mode, launches no Editor or browser and makes no Web build or performance claim. It does not repair or reclassify earlier cyan-drawer, Hub, recovery or acceptance receipts.
- Actual authoritative browser quest/trade outcomes, rewards/refusals, reconnect, privacy/visibility and the complete hub-to-results/profile/training chain are pending coordinator admission. Pending feedback has no protocol attempt IDs; a replacement clears it, while Toasts stay ordered independent notices. An explicit retry remains possible; there is no automatic retry.
- The map slice establishes delivered-point presentation only. It does not claim full terrain/camp/timer/visibility parity or add world merchant actors. It is not completion of the full UI inventory.
- No additional visual campaign or screen expansion is included. The authorized packet is sealed for handoff; Root owns the next integration/acceptance step.
