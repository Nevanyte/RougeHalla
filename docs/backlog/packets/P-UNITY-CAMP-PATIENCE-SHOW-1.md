# P-UNITY-CAMP-PATIENCE-SHOW-1: camp patience outlines show only while the local player is attacking that camp

- **Serves:** owner decision 7 (HUD parity) as amended by the owner's sentence of 2026-11-14 (below)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** `coord/int-43` (the coordinator's staging head)
- **D-rules touched:** D1 legacy drew the outlines always; this is an owner-directed presentation deviation (row proposed below) · D2 n/a · D5/D6/D9 none (looks only; Unity decides no outcome; no Rust, wire or protocol change)

## 1. ID and outcome
Owner decision, 2026-11-14 (chat): "camp patience zones should be light but only show up when attacking a camp, legacy version
showed them always, I want this to be a unity side, no need to be in rust".

When this lands, a camp's dashed patience outline and its "PATIENCE RANGE" label are drawn only while the local player is
attacking that camp, and hidden otherwise. Their look is unchanged (the light colours the owner approved; `CampPatienceOutlines.cs`
stays on the gate's mesh-colour allowlist, `scripts/gate.sh:245`; do not touch the colour space). The legacy rules for phase,
training and living mobs still apply on top (an attacked camp with no living mob, or outside an active run, draws nothing).

### The signal chosen for "attacking a camp"
The wire carries no mob-to-camp link, no mob target and no camp patience clock (`WireCamp`, `Protocol/State.cs:108`: type, alive, state,
cleared/respawn times, reward, ward; `State` 1 "engaged" is sticky history for anyone, `CampMarks.cs:6`). `FlagEngaged` says a mob
fights *someone* (`Messages.cs:338`) and is not used. So the decision uses what is exact:

- **Damage fx between the local player and a mob.** A `FxKind.Hit` or `FxKind.SigHit` (`Messages.cs:1007`, decoded at `:1161`/`:1177`) with
  `By == local player` and `Victim` a mob, or `Victim == local player` and `By` a mob. A redacted source (`uint.MaxValue`) never matches.
  Delivered by `Session.FxReceived` (`Net/Session.cs:136`, raised at `:538`; `Session.PlayerId` `:85`).
- **A mob's camp = the patience plane value under it** (`MapBlob.Patience`, 1-based camp refs, tile = floor(position / 32), the same
  plane `PatienceOutline.Edges` outlines). A mob never chases past its camp's plane. Mob positions: the regional mobs in the
  interpolated actor list (`InterpActor`, `Net/SnapshotBuffer.cs:8`; `ActorKind.RegionalMob`, `Net/Views.cs:44`). The decision remembers
  each mob's camp from the frames it was seen, so a killing blow (mob gone next frame) still counts.
- **Linger:** a camp stays attacked for `CampAttack.LingerMs` (a dial, 2500 ms) after the last such damage; each camp has its own clock.
- **No seat** (`localId == 0`, a spectator) or **dead local player**: nothing is attacked, pending hits are dropped, and a revival
  does not bring the old state back.

Weaker than the coordinator's default in two ways, both flagged: (1) "the camp's patience clock is running because of the local
player" is not on the wire and cannot be used; (2) "targeted by one of the camp's mobs" is approximated by *damaged by* one (a mob
that targets you but has not yet hit you does not show the outline; a chasing mob's first hit does). Not used: the owner combat
lock target (`OwnerCombatView.Lock`, `Net/Views.cs:99`): it can stay held on a far target, which would pin the outline on; a swing
that misses everything therefore does not show it. If the owner finds either gap in play, widening is a follow-up packet.

## 2. Dependencies
P-UNITY-WORLD-MARKS-2 (the outlines presenter) and P-WIRE17-MAP-1 (patience plane) are in the base.

## 3. Relevant legacy paths
- `packages/client/src/render/CampPatience.ts:92-93` draws a camp's outline while `alive > 0`; `RaidScene.ts:676` while `state.phase === "active" && !state.training`. Nothing about the local player enters: legacy shows them always. (Cited from `PatienceOutline.cs:49-52`; the hidden-unless-attacking rule has no legacy counterpart: owner-directed.)
- Same-tick note: Hit fx arrive in their own message (`Fx`), not in a snapshot; they are noted when received and resolved at the next frame's `Update` with that frame's clock. Hits and mob removal can land in one frame (killing blow): see Known traps.

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/CampAttack.cs` (stubbed by the `stub:` commit; synced copy and `.meta` under `UnityProject/Assets/RoguehallaNet/Net/Ui/`)
- `client-unity/RoguehallaNet.Tests/CampAttackTests.cs` (oracle)
- `client-unity/UnityProject/Assets/Tests/Editor/CampPatienceShowEditModeTests.cs` (+ `.meta`) (oracle)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/CampAttack.cs`, then `bash client-unity/sync-net.sh` (the Unity copy; `--check` must be clean)
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampPatienceOutlines.cs`: honour the `ICampAttacked` argument already in the stub's signature (the stub only added the parameter)
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`: feed `_campAttack` (the stub declares the field and passes it at the `_patience.Update` call, lines ~47, ~596, ~707): subscribe to `Session.FxReceived` for `Hit`/`SigHit` -> `NoteHit` (unsubscribe where the view detaches), call `Update` each frame with the regional mobs, local id (`PlayerId`), `Me.Status == Alive`, `Map.Patience`/`W`/`H`, and a clock in ms; `Clear()` when the map changes or the view resets
- `docs/unity/DIALS.md`: one row for the `camp-attack-linger` dial (`CampAttack.LingerMs`, 2500 ms, range 2000 to 3000, pinned by `CampAttackTests.The_camp_stays_shown_for_the_linger_after_the_last_damage_then_hides`, scene: none renders it (a live fight); judge in a Web round)

## 6. Contracts and references
R-AUTH / ADR 0008 (Unity decides no outcome: this is a presentation filter over server facts), C-OBS (only observed facts are used: visible mobs and fx the viewer received), `docs/unity/DIALS.md`, `docs/agent/TUNING_LANE.md`.

## 7. Behaviour to preserve
- The outlines' look, edges, label text and position, build-once-per-map and zero-allocation steady frames (`WorldMarks2EditModeTests`).
- Legacy visibility rules for phase, training and living mobs (`PatienceOutline.Visible`), still tested.
- No Rust, wire, protocol or state-hash change; `PROTOCOL_VERSION` untouched.
- Mesh colours stay as they are (allowlisted file; no sRGB/linear change).
- The steady frame stays allocation-free: `CampAttack.Update` and `IsAttacked` must not allocate in a steady frame (use pre-sized collections).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-CAMP-PATIENCE-SHOW-1` passes (full).
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~CampAttackTests` green; the Unity EditMode classes `CampPatienceShowEditModeTests` and `WorldMarks2EditModeTests` green.
- `bash client-unity/sync-net.sh --check` clean.

### Owner-directed amendments to existing tests (done in the `stub:` commit, signed by the owner's 2026-11-14 sentence)
`WorldMarks2EditModeTests.cs` (`client-unity/UnityProject/Assets/Tests/Editor/`): the presenter's `Update` gains a required last parameter, so every `o.Update(...)` call now passes `All`, a fake that reports every camp attacked, so these tests keep pinning the outline's shape and rules and not the old "always visible" behaviour. The five tests whose assertions need a drawn outline are:
`A_living_camp_with_tiles_is_outlined_and_labelled_in_an_active_run`, `A_cleared_camp_loses_its_outline_and_gets_it_back_when_its_mobs_respawn`, `The_outline_is_built_once_per_map_not_per_frame`, `A_frame_where_nothing_changed_allocates_nothing`, `The_label_sits_25_px_below_the_camp_centre`. The other tests in the region (`Nothing_is_drawn_outside...`, `No_phase_yet...`, `Guard_a_map_without...`) only gain the argument. No assertion changed. The library test `PatienceOutlineTests` pins edges and `Visible` and is unchanged. No capture or look-check scene pins "always visible" (searched `client-unity` for `CampPatience`/`PATIENCE`: only these files and `ArenaView`).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/CampAttackTests.cs` (12 tests; red now: the 6 that expect a camp shown)
- `client-unity/UnityProject/Assets/Tests/Editor/CampPatienceShowEditModeTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/CampPatienceShowEditModeTests.cs.meta`
- `docs/backlog/packets/P-UNITY-CAMP-PATIENCE-SHOW-1.md`

(`WorldMarks2EditModeTests.cs` is amended in the `stub:` commit and stays editable only for the arguments, not its assertions.)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~CampAttackTests`
- `client-unity/UnityProject/Tools/editmode.sh` (whole EditMode suite)
- `bash client-unity/sync-net.sh --check`
- `scripts/gate.sh --quick`

### Proposed DEVIATIONS row (coordinator adds it; exact text)
`| DEV-0xx (proposed, unsigned) | presentation | Legacy draws every living camp's patience outline and "PATIENCE RANGE" label for the whole active run (`packages/client/src/render/CampPatience.ts:92-93`, `RaidScene.ts:676`). Unity draws a camp's outline only while the local player is attacking it (damage dealt to or taken from one of the camp's mobs within 2.5 s; a mob's camp is the patience-plane value under it), and hides it otherwise. Owner-directed 2026-11-14 ("camp patience zones should be light but only show up when attacking a camp"). |`

### The Web shot for the coordinator
From the running Web client in a Rogue/active match: stand 12+ tiles from any camp that has a living mob (outline absent on every camp), then walk to that one camp and trade blows with one of its mobs: outline and "PATIENCE RANGE" label appear on that camp only, other camps stay clean; stop fighting (or step out of reach) and they vanish about 2.5 s later. Take three shots at the same camp: before (far), mid-fight, 3 s after. Judged by the owner only from the Web client.

## 10. Risk and suggested model tier
Sonnet: one pure state holder plus wiring into `ArenaView`. The risk is the wiring (fx subscription lifetime, the mob list without allocation) and misreading the camp of a mob; the tests pin the decision and the presenter, not the `ArenaView` wiring, so the reviewer must read it.

## 11. Known traps
- Hit fx and a mob's removal can arrive in the same frame: resolve a hit's camp from the current mob list first, else from the remembered one.
- A hit noted before the mob was ever listed (first sight and first hit in one frame) must resolve from the current list.
- Death of the local player drops pending hits too; do not let a hit noted just before death show the outline after respawn.
- `localId == 0` (spectator) must not match a mob whose `By`/`Victim` is 0, and `uint.MaxValue` (redacted) never matches.
- Position to tile: sim units / 32, floor; negatives and out-of-map positions are in no camp (do not index out of range).
- The 4-argument `Update` is gone (stub); `ArenaView` passes `null` at its reset call (`:707`): null means nothing attacked.
- Clear on a new map, or the previous match's attack lingers into the next one.

## Notes from previous attempts
