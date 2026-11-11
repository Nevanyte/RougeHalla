# P-UNITY-TIMER-1: the top-centre clock counts down to the coliseum, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (HUD text; the legacy client is the reference) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The Unity HUD shows "RAID · mm:ss" counting up and has no countdown before the gates lock. Legacy shows only a
countdown: "Coliseum m:ss" to the gate lock, then to sudden death (amber), then "Coliseum · sudden death" (red); the
lobby and planning lines count down too. When this lands the Unity top-centre line and the lobby/planning status lines
show the legacy text and the legacy clock for every phase, computed in the engine-free library.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/ui/hud.ts`: status line for lobby and planning, and the coliseum countdown pill (oracle author:
  cite the exact lines; the survey read `:41-56` and `:258-285`, unverified)

## 4. New paths
- none expected (tests extend existing files)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/Indicators.cs` (`ArenaLine`, `:145`) and its synced copy under
  `client-unity/UnityProject/Assets/RoguehallaNet/`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (`:171`, the "RAID" line)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (static "PLANNING" / "FORMING MATCH" text only)

## 6. Contracts and references
- All clocks are already in client state (`client-unity/RoguehallaNet/Net/Collections.cs:98-102`: lobby end, plan end,
  gate lock, sudden death, gates locked). No wire change.
- Rust leaves the sudden-death time at 0 until the gates lock (`crates/rh-sim/src/systems/coliseum.rs:122-142,180-181`),
  as legacy does: the line must not depend on it before the lock.

## 7. Behaviour to preserve
- Wire bytes; every other HUD line.
- `ArenaLine`'s callers keep compiling; a signature change stays inside the write scope.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-TIMER-1` passes (full).
- Unit tests in `IndicatorFactsTests.cs` (replacing the pinned case at `:36-42`): before the lock the line counts down to
  the gate-lock time with sudden death 0; after the lock it counts down to sudden death; at sudden death it reads the
  legacy text; lobby and planning lines count down; no phase produces an elapsed (counting-up) clock.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/IndicatorFactsTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Sonnet. Small; the existing test pins the wrong behaviour and is replaced by the oracle.

## 11. Known traps
- Server clocks are in server milliseconds; use the client's server-time estimate the HUD already uses, not local time.
- Rounding: legacy formats m:ss; check whether it rounds up or down at the second boundary and copy it.
- The colour states (amber, red) are part of the legacy information: carry a state enum out of the library.

## Notes from previous attempts
