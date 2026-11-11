# P-UNITY-WAND-LOCK-1: wand clicks lock the nearest valid target, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (client picking; the legacy client is the reference) · D2 n/a · D9: the client only chooses
  which lock order to send; the server decides the lock (`crates/rh-sim/src/systems/targeting.rs`)

## Plan: beta follow-up, wave 1 (written 2026-11-10)

| ID | Title | Area | Tier | Reviewer | Depends on | Group |
|---|---|---|---|---|---|---|
| P-UNITY-TIMER-1 | Coliseum countdown | Unity HUD | implementer-sonnet | reviewer | none | G1 |
| P-UNITY-WAND-LOCK-1 | Wand lock picking | Unity input | implementer-sonnet | reviewer | none | G1 |
| P-UNITY-MOB-DEATH-1 | Mob death clip plays in full | Unity actors | implementer-sonnet | reviewer | none | G1 |
| P-UNITY-SENTENCED-READ-1 | Sentenced wall/fence contrast | Unity region art | implementer-sonnet | reviewer | none | G1 |
| P-BALANCE-1 | Duel matrix harness | rh-headless | implementer-sonnet | reviewer-opus | none | G1 |
| P-BALANCE-2 | Camp-clear bench, both hitbox modes | rh-headless | implementer-sonnet | reviewer | none | G1 |
| P-HOLY-DEMON-BLOOD-1 | Holy camp lifesteal | rh-sim | implementer-opus | reviewer-opus | none | G1 |
| P-UNITY-SWING-FOLLOW-1 | Swing zone follows the attacker | Unity FX | implementer-sonnet | reviewer | P-UNITY-WAND-LOCK-1 (`ArenaView.cs`) | G2 |
| P-UNITY-OVERHEAD-1 | Legacy overhead layout | Unity actors | implementer-sonnet | reviewer | P-UNITY-MOB-DEATH-1 (`SpriteActorPresenter.cs`) | G2 |
| P-UNITY-PROP-FADE-1 | Tall props fade clearly | Unity region art | implementer-sonnet | reviewer | P-UNITY-SENTENCED-READ-1 (region art files) | G2 |
| P-SIM-BUILDSUMMARY-1 | GAINED strip values, server side | rh-sim | implementer-opus | reviewer-opus | P-HOLY-DEMON-BLOOD-1 | G2 |
| P-UNITY-RANGE-IND-1 | Weapon range indicator | Unity FX | implementer-sonnet | reviewer | P-UNITY-SWING-FOLLOW-1 | G3 |

At most three Rust implementers at once (G1 has exactly three). Unity packets in one group have disjoint write scopes.
Later waves (wire 17, HUD parity, retune, legacy Nov 4 port, map pool, signature terrain, dressing, bots) are written
when their dependencies land; the approved plan lists them.

## 1. ID and outcome
A wand click near an enemy locks that enemy, as in the legacy game. Today a click must land within 22 screen pixels of
the target's feet or inside its body box, dead and friendly actors are accepted (the server then refuses silently), and
a miss falls back to an unlocked directional shot. When this lands: the client picks the nearest valid target within
the legacy snap radius in world units, a wand never sends a directional attack, and the lock ring shows at once.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/render/targeting.ts`: nearest-target picker, candidate filters, the 500 ms instant lock ring
  (oracle author: cite the exact lines for the picker, the filters and the ring)
- `packages/shared/src/constants.ts:401`: `TARGET_SNAP_RADIUS = 64`; `:406` `TARGET_RANGE = 640`
- `packages/client/src/scenes/RaidScene.ts`: the wand click path sends a lock order only (cite the lines)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/TargetPick.cs` (pure picker; name may change)
- `client-unity/RoguehallaNet.Tests/TargetPickTests.cs`

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/TargetPick.cs`, its synced copy under `client-unity/UnityProject/Assets/RoguehallaNet/`
- `client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs` (wand branch `:377-392`, `VisibleActorAt` `:510`)
- `client-unity/UnityProject/Assets/Scripts/View/ActorPick.cs`
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs` (lock target/ring only, around `:252`)
- `client-unity/UnityProject/Assets/Tests/Editor/HitboxPresentationEditModeTests.cs` (the `ActorPick` test `:217-226`)

## 6. Contracts and references
- R-AUTH, ADR 0008, D9: no game rule in Unity. The picker chooses a candidate; range, visibility and wand checks stay
  in `crates/rh-sim/src/systems/targeting.rs:106-159`.
- C-OBS: candidates come only from actors in the client's observation.
- `client-unity/AGENTS.md`: edit the library, then `bash client-unity/sync-net.sh`.

## 7. Behaviour to preserve
- Wire bytes and command kinds: no protocol change.
- Non-wand weapons keep their current click behaviour.
- Body-box picking for hover and inspection is unchanged unless the legacy picker replaces it for the wand.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-WAND-LOCK-1` passes (full).
- Unit tests: nearest of several candidates inside 64 world units wins; none inside 64 gives no target; dead actors,
  the local player's own companions, friendly actors and quest NPCs are never returned; ties resolve as legacy does.
- A wand click with no candidate sends nothing that fires an unlocked shot (assert on the produced command).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/TargetPickTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Unity 6000.0.85f2, `-runTests -testPlatform EditMode`, Editor closed; command in
  `docs/rework/PERF_REPORT.md`). Not part of the gate: report whether it was run.

## 10. Risk and suggested model tier
Sonnet. Small and client-only; the risk is copying a legacy filter wrongly, which the unit tests pin.

## 11. Known traps
- Legacy measures in world units from the cursor's world point, not screen pixels; zoom must not change the radius.
- A click on a refused target must not leave a ring showing: the instant ring ends after 500 ms unless the server
  confirms the lock.
- The stale-copy check fails the gate if `sync-net.sh` was not run.

## Notes from previous attempts
