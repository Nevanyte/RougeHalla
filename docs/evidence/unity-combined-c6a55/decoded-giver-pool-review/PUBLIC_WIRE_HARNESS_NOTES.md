# Protocol 14 public-wire actor reuse harness

Read-only source audit at art checkout commit `c6a55d3d68d0023e60ace98b55fd23f581217b38`. No source, Unity, or Git files were changed. These notes describe an offline harness that sends real encoded server frames through the public decoder/session APIs, then presents decoded samples in `ArenaView`; it must not fabricate `InterpActor` inputs.

## Exact v14 giver vector

`protocol/fixtures/v14.json`, server entry `snapshot_quest_giver_actor` (index 16), provides this actual protocol-14 full snapshot:

```text
830e0900018180808008fb06d903460e71e1ff49c102043412111d0b02
```

Decoded actor: id `2147483649`, kind 4 (`QuestGiver`), raw faction 15, weapon 15, mob type code 0, alive, barrier 11%, ring step 2. The raw kit 15/15 is the reserved “no identity” sentinel for a quest giver; it is not a sixth faction or a weapon. Mob type code zero means absent; nonzero wire mob codes are one-based.

Relevant files in the Unity runtime:

- `Assets/RoguehallaNet/Protocol/Messages.cs`: public `WireActor`, `ServerMsg.Decode`, `ServerMsg.Snapshot.Encode`.
- `Assets/RoguehallaNet/Net/Session.cs`: `ITransport`, `SessionOptions`, frame processing, `Snapshots`, `Latest`, `Me`.
- `Assets/RoguehallaNet/Net/SnapshotBuffer.cs`: `Sample(double, List<InterpActor>)` and decoded actor projection.
- `Assets/Scripts/View/ArenaView.cs`: `RefreshVisibility(Session)`, `Present(List<InterpActor>, SelfView, LocalMotion, float)`, `IsObserved(uint)`, `TrySoundContext(...)`.
- `Assets/Scripts/Presentation/SpriteActorPresenter.cs`: keyed actor dictionary and object pool.

Projection details: `SnapshotBuffer.Emit` maps a kind-4 actor’s faction, weapon, and mob type to nullable `null`; the same sentinel nibbles remain enum values for non-givers. `Net/Views.cs` defines `ActorKind.Player=0`, `ActorKind.QuestGiver=4`, Fire=0, Sword=0. `SpriteActorPresenter.Present` treats a quest giver as neutral even though its kind is non-player; neutral actors retain barrier/ring rendering, while non-neutral mobs suppress those cues. `TrySoundContext` returns false for a giver because its projected faction and weapon are absent.

## Public setup

A fake `ITransport` is sufficient; it must never open a real socket. Implement `Connect` by raising `Opened`, have `Send` record/ignore the Hello and ping frames, and raise queued `Received(frame)` events from `Poll()` on Unity’s main thread. Let `Close`/`Closed` be no-ops for this proof.

```csharp
var options = new SessionOptions {
    Url = "ws://offline.invalid/", Profile = "wire-preview", Build = "offline-preview",
    Now = () => nowMs, PingIntervalMs = double.MaxValue,
};
var transport = new QueuedTransport();
var session = new Session(transport, options);
session.Connect(); // fake raises Opened; Hello is sent; state becomes HelloSent
transport.Enqueue(welcomeBytes);
session.Poll();    // fake raises Received; Session becomes InMatch
```

For a welcome, the golden v14 `server[29]` fixture (`name=welcome`) is usable. Or encode a public `ServerMsg.Welcome`:

```csharp
new ServerMsg.Welcome {
    Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3,
    Session = new byte[16], TickRate = 20, Tick = 0, ServerMs = 0,
    Map = new MapBlob(2, 2, new byte[4]),
}.Encode();
```

For fighter/empty frames use public full-snapshot encoding; they are still real wire frames and will be decoded and delta-tracked by Session:

```csharp
new ServerMsg.Snapshot {
    Tick = tick, Phase = 1, Me = null,
    Actors = new[] { new WireActor {
        Id = 2147483649u, X = 120f, Y = 180f, Facing = 0f,
        Faction = (byte)FactionId.Fire, Weapon = (byte)WeaponId.Sword,
        HpPct = 100, Status = (byte)ActorStatus.Alive, Kind = (byte)ActorKind.Player,
        MobTypeCode = 0, BarrierPct = 60, BarrierRingStep = 6,
    }},
}.Encode();
```

For an eviction frame, encode a newer full snapshot with `Actors = Array.Empty<WireActor>()`. Keep ticks strictly increasing. Session processes incoming frames from its `ITransport` only while in match; avoid bypassing it with direct `SnapshotBuffer.Add` if the goal is an end-to-end Session→ArenaView check. Use `Session.Poll()` rather than `Update()` to avoid `FlushInput()`.

## Sequence and visual assertions

Use the same actor id and exactly one remote actor so a single pooled root makes reuse deterministic:

1. Queue/poll a fighter full snapshot at tick 10, with Fire/Sword and e.g. barrier 60%, ring 6.
2. Queue/poll an empty full snapshot at tick 11; present. This removes current membership and evicts/hides the actor root.
3. Queue/poll the exact giver golden vector above (tick 14 is valid after 11); present. Assert `ArenaView.IsObserved(id)`, `TrySoundContext(id, …) == false`, weapon cue disabled, giver has no faction/weapon/mob, barrier visible, and exactly ring steps 1–2 visible.
4. Queue/poll another empty full snapshot at tick 15; present and confirm eviction/root hidden.
5. Queue/poll a fighter full snapshot at tick 16; present. Assert Fire/Sword sound context and weapon cue return, barrier/ring reflect the fighter’s supplied values, and no stale giver identity remains.

For each frame, use actual decoded actor samples:

```csharp
view.RefreshVisibility(session); // current sample membership; calls presenter Retain
var remote = new List<InterpActor>(1);
session.Snapshots.Sample(session.Snapshots.NewestMs, remote);
view.Present(remote, session.Me, session.Motion, 0f);
```

Attach `ArenaView` to an enabled GameObject on Unity’s main thread. `Build(session.Map)` is optional and only needed for a background. `RefreshVisibility` also presents the latest NPC facts before `Present`; the second call stamps the ordinary frame pass.

For pool identity without private-field access, the presenter creates direct child objects named `Observed actor` under the ArenaView transform. In this one-actor scenario record the child’s `GetInstanceID()` before eviction and compare after the giver/fighter reuses. Read renderer state under that child for `Equipped weapon cue`, `Confirmed barrier`, and `Barrier ring step 1` through `8`. The renderer names and hierarchy are presentation evidence, not a gameplay API.

## Pitfalls

- Do not retain `Session.Latest`, snapshots, or actor arrays across frames: Session recycles them. Copy via `SnapshotBuffer.Sample` into a caller-owned list immediately before presentation.
- Do not manually construct `InterpActor`, inject it into `ArenaView`, or call `RetainObservedActors` with hand-authored facts. Keep the chain encoded frame → fake transport → Session decode/tracker → `Snapshots.Sample` → ArenaView.
- `SnapshotTracker` validates reconstructed kind-4 identity on full and delta frames. A giver delta must leave the tuple raw 15/15 with mob code 0; malformed transitions are refused before presentation.
- Eviction is observed only after `RefreshVisibility`/present runs against the empty snapshot. `SpriteActorPresenter.Evict` disables barrier/rings/signature icons, clears the identity owner, hides the root, then pools it.
- This proves canonical projection and presentation reuse only. Do not add combat, eligibility, hit, collision, visibility inference, network input, or server behavior. Raycast/input, browser, performance, and live-service protocol acceptance remain outside this offline harness.
