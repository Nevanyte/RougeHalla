# Verified-session Training console integration

Source **`e0da2de0b5100d979901aa5e20cc3d8f964e0626`** is a direct child of merge
`6a61b069f7928c4dc4f571f13c0d994270a8fdd1`: actual settlement proof
`1a7774e4b23b5f10a0ab3a1b687a2dec5bbf21f4` plus reviewed reusable Training leaf
`70d176c3d29a5e13749ed536905130042d613eb0`. Branch: `codex/unity-training-integration`.

The coordinator authorized shared MatchHud/MatchClient integration, new script metadata,
focused wiring regressions, managed compilation and a proposed combined Editor contract.
The current Editor/art checkout was not touched. No Unity Editor, PlayMode, native test,
browser, Web build, server, cloud or applied-Training campaign was invoked here.

## Resulting behavior

- One Training console is created under the existing MatchUI Canvas after shared features.
  It adds no Canvas or EventSystem. A null/default confirmation cannot arm it.
- Binding occurs only in the actual accepted-snapshot callback, with that exact
  `Session.Latest` object, the same live HUD/client Session and the owner's verified
  `ConfirmedPractice`. The current window must have focus and no higher panel may own UI.
- Replacement/Leave, launch state loss, timeline reset, disconnect, HUD disable/destroy,
  result, higher modal and window focus loss null-bind/close the console. Retired callbacks
  cannot borrow a later Session/epoch/confirmation. A later accepted same-session Training
  snapshot can restore a closed console; focus gain or modal close alone cannot rearm it.
- The console is nonmodal after a pointer interaction releases focus, matching the original
  Training console. Focused controls, text and expanded dropdowns own keyboard input.
  Training Tab can enter the collapsed launcher or cycle the open panel. Arena hold-Tab
  remains the tactical map gesture.
- Escape first requests an owned popup's public Hide, then closes an open console, then a
  later bare Escape leaves confirmed Training. The original behavior is in
  `packages/client/src/scenes/RaidScene.ts:1733` and `ui/trainingConsole.ts:6,297`.
  Higher panels receive Escape first. No new key or backend eligibility rule was added.
- Ownership uses the Input System's public `InputState.updateCount`, the same update clock
  as key edges. Repeated reads of one edge cannot leave or send world input after closing
  a control. A narrow `OpenStateChanged` view notification lets the owner keep that token
  when a pointer closes its own hit target.
- Opening Journal/Build/Help/Settings during Training suspends the console and ends later
  HUD routing in that consumed update. Simultaneous shortcut+C+digit cannot choose a chest
  behind the newly opened panel. Expanded dropdown ownership follows its console-owned
  control, rather than assuming the selected popup item has a particular parent.
- All five existing Train command kinds remain ordinary intents. `FlushInput` deliberately
  sends **all** already pending commands in their original order/batches. No local award,
  eligibility, AI, physics, combat or applied-state prediction was introduced.
- Settlement ownership, Result/Welcome/epoch fencing, retry budget/manual retry, typed HTTP
  parsing and generic banking flag remain unchanged. Training still promises no run rewards
  or banking.

## Validation boundary

| Check | Observed result |
|---|---|
| Full managed suite | **826/826 PASS**, zero failed/skipped; 49 settlement cases and all five allocation controls included |
| Editor Client source compile | 0 errors, 0 warnings |
| Player Client source compile | 0 errors, 0 warnings |
| All Editor test source compile | 0 errors; one preexisting CS0067 unused `Closed` event warning at `MatchHudTrophyEditModeTests.cs:116` |
| Net → Unity Net mirrors | All 24 exact, including reviewed `InputSender.Train` |
| Previously admitted 64 cases | All 64 prior Editor source/meta paths unchanged from `1a7774e4b23b5f10a0ab3a1b687a2dec5bbf21f4` |
| Reusable leaf's 13 tests/evidence | Test bodies and sealed leaf evidence unchanged from `70d176c3d29a5e13749ed536905130042d613eb0` |
| New script metadata | Seven valid unique GUIDs: five leaf scripts plus the new HUD partial and integration test; all 609 existing meta files unchanged |
| Combined Editor execution | **UNRUN at this source**; exact source-declared typed contract supplied separately |

Compiled metadata contains **90 unique leaves across eight fixtures**: prior64, the leaf's
five selector/eight view cases, and thirteen integration cases. The contract validates the
prior64 full names and typed arguments against actual public discovery. This remains a
proposed90 contract until native discovery at Root's frozen source binds the exact set.

Thirteen new integration methods exercise real public owned Join with an injected account
transport and encoded Welcome/Snapshot/State facts through the real Session decoder. They
cover pending/Arena exclusion and Arena Tab, exact Training confirmation, ordinary pending
input order, reconnect/source-clock cuts, retired callbacks/replacement, controlled keyboard
focus/typing, repeated Escape reads, background snapshots after focus loss, pointer-close
input ownership, popup Hide routing, higher modal suspension, J/B/H plus chest digits in
one read, and wrong delivered mode. They have been compiled, **not executed**.

The popup regression calls real TMP `Show`/`Hide` and observes the hide request. Its test-only
subclass uses TMP's intended virtual disposal hooks to retire owned popup/blocker objects
immediately in EditMode; no logs are suppressed and no private TMP method is invoked.
Public disable completes popup cleanup. It does not claim that the Player's deferred fade
was rendered or completed. Actual pointer delivery, scrolling, transitions and server
application remain later proof obligations.

The actual prior settlement64 PASS at source `5457b9c03149333ed3b2bcebdfb10b224364fc25`
is preserved in the base proof. That receipt is not an engine pass for this changed source.
The coordinator must freeze, independently bind actual public discovery to the proposed
typed contract, and grant the sole Editor lease before one combined run. Preserve first
failures and cleanup; do not silently retry or substitute cases.

## Evidence and next gate

`source-checks.json` pins scope/protected paths. `meta-pins.json` records all seven new
source/meta pairs and the case-insensitive GUID uniqueness check. Existing uppercase GUIDs
are valid and remain byte-for-byte unchanged. `managed-summary.json`, raw TRX/logs and the
external compile profiles distinguish managed tests/compilation from native execution.
`source-inputs.json` and the proposed contract bind exact compiled inputs and fixture tuples.
The supplemental `unity-mirror-pins.json` verifies all 29 Net/Protocol source copies, including
the five unchanged Protocol sources, against the Unity mirror byte-for-byte.
The manifest pins every evidence payload and excludes itself.

[LAYOUT_CHECKS.md](LAYOUT_CHECKS.md) gives the required screenshot/input observations and
cleanup boundary for Root's next gate. Source tests do not establish browser Training,
server-applied camp/stats/cards/chest/clear effects, visual acceptance or full-game UI parity.
