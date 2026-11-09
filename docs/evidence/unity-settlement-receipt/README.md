# Owned match settlement receipt in Unity results

Source: **`17b0f6401d730012f5e3580d2a59ed805e369fdc`**.
Parent: `68749a80cde1704326e65e4cb8982d7475b42302`, a clean merge of the
42-case launch gate/evidence `854a08f1d622e931eff40eba40ba3820cbe040da` and public main
`1a1ac8d70b323ac7159d60dea336e89e7b56389e`. Branch: `codex/unity-settlement-receipt`.

This packet adds the existing owned, match-specific settlement read to the results UI.
It does not change persistence, gameplay, the wire protocol or the account claim contract.
The coordinator authorized the source work and explicitly authorized removing the two
automatic result/Leave calls into the account open/claim flow. The coordinator owns
integration and the next frozen Unity gate; the art chat remains the sole Editor owner.

## Behavior

- Capture an opaque access handle immediately after the owned join intent passes
  `CanJoin`, before creating the match Session. The handle is bound to the exact API
  service, immutable endpoint, confirmed owner object/token and account generation.
- Capture a genuine decoded `Result` from its actual event batch with the current
  Welcome's raw 16 match-ID bytes. Format UUID bytes directly in network order; preserve
  all bits, including all-zero and all-FF IDs. Never use `Guid(byte[])` mixed endianness.
- Query only an accepted, matching Arena session with that exact genuine result and
  current owner. Training and diagnostics never query. A genuine result delivered before
  the first accepted mode fact is retained without querying; a later Arena snapshot permits
  an explicit check and does not silently start one.
- GET only `/api/profile/{canonicalName}/matches/{canonicalUUID}/settlement`, with the
  existing owned header and transport's existing 10-second timeout. No profile fallback,
  new claim, credential recovery, or inferred receipt from balance/wire GV.
- Strictly parse the exact v1 unknown/committed shapes, required fields and types,
  duplicates, echoed UUID, allowed outcome and safe nonnegative integer credit. Explicit
  `outcome:null` is a valid committed void; omitted outcome is malformed. Zero credit is
  valid. Unknown carries no settlement payload and means only that saved credit is not
  confirmed by this read.
- Fence success **and error** by API/owner generation, current Session/join generation,
  genuine result object, captured result-origin epoch, current read epoch, exact raw
  Welcome match ID and read generation. Recheck before presentation. The per-frame ID
  comparison does not allocate; confirmed text is cached.
- Timeline reset/reconnect cancels the burst and clears any saved-credit display. A
  same-match retained genuine result can be checked manually after a fresh accepted Arena
  snapshot. A different Welcome UUID clears the old result context. Duplicate decoded
  results cancel the old identity's read and do not replenish the automatic budget.
- Each burst has at most three sequential reads: the first immediately, then waits of two
  and five seconds after valid unknown replies. Errors stop the burst. Manual bursts have
  a five-second cooldown measured from the prior burst's start. Leave cancels immediately;
  it never waits for HTTP. A transport that ignores cancellation cannot overlap a new read.
- Results show checking, not confirmed, committed, error or paused copy with Check again.
  The scrollable result facts move upward within the existing panel to reserve a separate
  row. Play again and Return to menu remain available. Existing profile balance is not
  incremented or refreshed speculatively; explicit manual LOAD remains unchanged, and
  the generic `ResultBankConfirmed` stays false.
- Typed GET dispatch keeps leaderboard decoding separate; existing POST profile response
  behavior remains unchanged.

If an old canceled HTTP implementation ignores cancellation while a new match's first
result arrives, that result's check remains paused until the old await completes. Check
again is then available. This deliberately avoids overlapping or silently deferred reads.

## Validation

| Check | Observed result |
|---|---|
| Final full .NET suite | **822/822 PASS**, zero skipped; 49 settlement cases and all five allocation controls included |
| Editor Scripts, managed compile against installed Unity DLLs | 0 errors, 0 warnings |
| All Editor test sources, managed compile | 0 errors; one preexisting CS0067 unused-event warning in `MatchHudTrophyEditModeTests.cs:116` |
| Player Scripts, managed compile | 0 errors, 0 warnings |
| Net → Unity Net mirrors | All 24 source files byte-identical |
| Existing Editor test sources | All 30 preexisting `.cs` files byte-identical to `854a08f1d622e931eff40eba40ba3820cbe040da` |
| Compiled fixture metadata | Existing 42 cases plus 22 additive settlement cases, **64 total; all UNRUN at this source** |
| Unity Editor / PlayMode / browser / Web build / server / cloud | **Not invoked** |

Managed tests cover strict UUID/JSON shapes, zero/void/maximum credit, owner/service and
generation privacy, canceled reads, wrong echoed ID, stale success/error, and preserving
leaderboard decode behavior. The additive Editor test source covers actual public owned
Join, decoded Welcome/Snapshot/Result, early/no result, Training, sequential retry budget,
HTTP errors, duplicate result identity, clock cuts, reconnect, changed UUID/owner, Leave,
retired callbacks, pending-delay cleanup and the real HUD row. These new lifecycle cases
have been compiled, **not executed**.

The prior actual 42/42 Unity PASS is retained in
[`unity-functional-0aeddc5b`](../unity-functional-0aeddc5b/editor-first/README.md).
It is not a Unity pass for this changed source. Visual/readability, actual request abort
behavior in Unity, and native/browser end-to-end verification remain for a coordinator
approved frozen gate. No presentation or full-game completion claim is made here.

## Evidence and reproduction

[`receipt.json`](receipt.json) records exact source identities, scope and commands.
[`validation-summary.json`](validation-summary.json) lists the final managed case outcomes
and separates them from unrun Unity cases. [`logs/source-checks.json`](logs/source-checks.json)
records protected files, exact mirrors and source scope. The 192-file source inventories
preserve the final compile inputs and sealed inputs; their sole difference is eight extra
malformed JSON test attributes, compiled and executed by the final 822-case run. Net,
Scripts and Editor test inputs were unchanged after the final compile profiles.

The initial full 809-case run, focused 41-case run after the cancellation guard, full
814-case run, and final full 822-case run are preserved separately. All passed. Build
logs and external compile profiles are retained. The metadata inspector reads assembly
metadata through Mono.Cecil and does not invoke tests or Unity APIs. Two evidence-helper
setup/self-check corrections are disclosed in
[`logs/evidence-preparation-notes.json`](logs/evidence-preparation-notes.json); neither is
an engine or product test failure.

Run the managed suite with:

```sh
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj -v minimal
```

The compile profiles use local installed Unity/package DLLs and this worktree's Net DLL.
Their absolute paths are reproduction context, not portable project configuration.
`MANIFEST.json` pins every payload's bytes and SHA-256; the manifest excludes itself.
