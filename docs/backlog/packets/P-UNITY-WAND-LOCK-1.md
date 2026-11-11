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
the target's feet or inside its body box, dead actors and every kind but the local player are accepted (`VisibleActorAt`
filters only self; the server then refuses silently), and
a miss falls back to an unlocked directional shot. When this lands: the client picks the nearest valid target within
the legacy snap radius in world units, a wand never sends a directional attack, and the lock ring shows at once.

## 2. Dependencies
none

## 3. Relevant legacy paths (verified 2026-11-10 by the oracle author)
- `packages/client/src/render/targeting.ts:17-30` `pickTarget(cursor, candidates, radius = TARGET_SNAP_RADIUS)`: Euclidean distance in
  world units on the ground plane from the cursor's world point to each candidate's drawn feet (`:21-23`); the nearest wins;
  the test is strict (`sq < bestSq`, `:24`, initial `bestSq = radius*radius`), so a candidate exactly 64 away is NOT picked;
  an exact tie goes to the lower id (`c.id < best`, `:24`; string comparison in legacy). Nothing in range gives `null`.
- `targeting.ts:8-10` `targetableMob`: a mob is a candidate unless `kind === "quest"`, or `ownerId === localId` (own
  companion), or the gates are locked and it is not a zombie. Players are not subject to the gate rule.
- `targeting.ts:37-39` `targetable(effects)`: not `EFFECT_HIDDEN` (256) and not `EFFECT_UNTARGETABLE` (128)
  (`packages/shared/src/status.ts:45-46`). Every other effect bit leaves the actor pickable.
- `packages/client/src/scenes/RaidScene.ts:1366-1380` `targetCandidates()`: every player except the local one, plus mobs
  passing `targetableMob`; each must be `status === "alive"` and `targetable(effects)` and have a drawn position
  (`this.rendered`). There is NO friendly/team filter beyond the own companion: the server refuses the rest
  (`plague_zombies::hostile`, `crates/rh-sim/src/systems/targeting.rs:44`).
- `RaidScene.ts:1403-1409` `clickAttack`: with a wand in hand (`localWeapon(me) === "wand"`) the click calls `sendTarget` and
  returns; it never reaches the directional `sendInput("attack")` at `:1412`. `RaidScene.ts:1476-1485` `sendTarget`: when
  `pickTarget` is `null` it returns having sent and noted nothing; otherwise it sends `target {id}`, and calls
  `lockDisplay.note(id, now)`. Non-wand weapons never call `pickTarget` on click; they send the directional attack.
- `targeting.ts:58-84` `OPTIMISTIC_LOCK_MS = 500` and `LockDisplay`: `note(id, now)` then `shown(synced, now)` returns `id`
  while `now < until`, else the synced `attackTarget`; so a refused order's ring ends after 500 ms. `RaidScene.ts:1648`
  draws `lockDisplay.shown(me.attackTarget, now)` for a wand only.
- `RaidScene.ts:1644-1647`: hover uses the same `pickTarget` and candidates (legacy hover and click agree).
- `packages/shared/src/constants.ts:401` `TARGET_SNAP_RADIUS = 64`; `:406` `TARGET_RANGE = 640` (server only).
- Legacy tests: `packages/client/test/targeting.test.ts:26-64` (pickTarget), `:15-24` (targetableMob), `:174-191`
  (targetable), `:66-108` (LockDisplay). Their values are copied into the oracle.

### Legacy behaviour that looks wrong (pinned, not fixed)
- Exactly on the radius is outside (strict `<`).
- Legacy ties compare ids as strings; the wire id is numeric, so the oracle pins numeric lower-id (a port decision, not legacy).
- Other players are offered regardless of faction/friendliness: the click can lock a player the server then refuses.
- The wand falls silent (no order, no ring) on a miss, even though the player expects feedback.

### Gap the implementer must resolve (not established)
- The Unity wire carries no zombie owner (`InterpActor` has no owner field; `ActorKind.Zombie` only), so
  `PickCandidate.OwnCompanion` has no source in the observation today. The oracle pins the filter given the flag. The
  implementer sets it from whatever the client genuinely knows; if nothing, leave it false and report it (the server
  refuses a lock on an own zombie, `hostile()`); do not add wire fields (that is another packet).

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/TargetPick.cs` (pure picker, click decision and `LockDisplay`; a compiling stub is
  committed with the oracle)
- `client-unity/RoguehallaNet.Tests/TargetPickTests.cs`

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/TargetPick.cs` (the stub: implement it; signatures are fixed by the oracle), its synced
  copy under `client-unity/UnityProject/Assets/RoguehallaNet/` (run `bash client-unity/sync-net.sh`)
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
- Body-box picking for hover and inspection is unchanged unless the legacy picker replaces it for the wand. (Legacy hover
  uses the same picker, `RaidScene.ts:1646`; using it for hover too is allowed but not required.)

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-WAND-LOCK-1` passes (full).
- `TargetPickTests` (all green): nearest valid candidate strictly inside 64 world units wins; none gives 0; dead/MIA,
  self, own companions, quest NPCs, hidden/untargetable actors and (gates locked) non-zombie mobs are never returned; ties
  go to the lower id; `TargetPick.Decide(Wand, 0)` is `None` and `Decide(Wand, id)` is `Target`; other weapons always
  `DirectionalAttack`; `LockDisplay` shows an ordered lock for 500 ms then the synced one.
- Wiring (not unit-testable in the gate, report in the hand-off): `MatchClient` calls `Decide` for the click, builds
  candidates from `_targetActors` at their drawn positions, uses the cursor's world point (`sx, sy`), and `ArenaView`
  draws the lock from `LockDisplay.Shown`.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/TargetPickTests.cs` (29 tests; 20 fail against the stub, on assertions)

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
