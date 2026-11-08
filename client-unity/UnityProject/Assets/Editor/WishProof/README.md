# Editor Wish proof utility

`Roguehalla.Editor.WishProof.WishProof` exposes these Editor CLI entrypoints:

- `Begin(url, profile, ticket, faction, timeoutSeconds)` joins through the scene's single active `MatchClient` and waits for live phase, an alive owner, a published Wish, positive stock, no active cast, and server time at or past `readyAt` before enabling the bounded trial trace.
- `RequestTargets()` asks the next normal `MatchClient` frame to record the currently delivered screen targets.
- `QueueWishAtTarget(actorId, clickMouse = false)` or `QueueWishAtPoint(screenX, screenY)` queues mouse movement and an R key press for normal Input System dynamic updates. These are queued Unity input-device events, not OS keyboard hardware. The point API sends no actor reference; target selection requires a currently delivered actor.
- `ExportJson()` returns copied facts and bounded trace records; `Stop()` ends an unfinished trial as incomplete.

`nativeInputQueued` records an encoded Cast frame after it is queued on an open native transport. It marks the queue boundary, not a completed TCP/WebSocket write. `nativeFxReceived` records only an encoded server FX frame at main-thread receive dispatch before Session/presentation subscribers run. A later authoritative landed cue and the composed art consumer's `presentWishLanded` marker are both required for a complete result. Every observed own landed occurrence after the measured sample must pair in order with one distinct applied marker by caster, ability, and original event time; missing, extra, or reordered markers keep the trial incomplete. Completion also requires a later authoritative snapshot from the same active Session owner, with the same ability and fewer charges than the ready baseline, after the exact matched encoded Cast queue frame. A changed ability, configuration-only changes, increased stock, or another owner's update cannot satisfy this gate.

This utility is diagnostic only. The all-five trial remains incomplete until the final composed Unity art build contains the real applied-cue `WishPresented` consumer, and the full Editor player-loop run is performed. Stub checks prove observer/matcher contracts and compilation; they do not prove live Unity input, rendering, or Editor timing.

## Reproducible stub contract check

From the repository root, run the Editor branch against the real C# protocol codec and transport/trace/proof sources with Unity APIs stubbed:

```sh
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet run --project tools/latency/editor-proof-contract/WishProofContract.csproj
```

The durable harness is in `tools/latency/editor-proof-contract/`. It checks readiness gating, sample-before-queue ordering and timestamp, encoded Cast matching, raw native FX receipt decoding/filtering, duplicate FX multiplicity, presentation ordering and identity, overflow downgrades, and same-owner strict charge-spend matching. It does not launch Unity or a browser.
