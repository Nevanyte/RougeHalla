# Wish barrier presentation evidence

Evidence for the Unity Wish and barrier presentation slice at source HEAD `5a1b5af9bb41a6c39e1473f7442ea2d396bf4f64`, against immutable base `abd1ccfe6edc90df16c64283af09c913bddbd81d`. The seven slice-owned commits, oldest first, are `ab6bd056`, `0d425588`, `bf0a17df`, `855b5b24`, `c3f032e0`, `378b5c12`, and `5a1b5af9`. The trace marker change in `855b5b241e239c65937104116706c5be11f9d144` is an exact `-x` cherry-pick of upstream diagnostic API commit `10cbfa25789378a5ded021a2265700ffd46e5484`; see the independent review note.

This branch is `codex/unity-wish-barrier-presentation`, composed on a private client interface candidate. It is ready for coordinator review; this report does not record main admission or completed server transport.

## Behaviors and verification

The presenter displays delivered Wish opening/cast/recharge/full timing, charges, barrier amount and the 0..8 ring. Owner vitals preserve empty capacity; actor segments preserve independently rounded shares totaling 105%. NPC, death, missing membership and pool reuse clear barrier artwork. All five confirmed cues use bounded owned scalar copies, original event times, and existing unlit shapes. Anonymous permitted world effects remain spatial; Blaze requires both delivered endpoints. Same-time occurrences are retained. Opt-in trace markers occur after visual application or terminal cleanup; ordinary play records nothing.

The real `Session.Poll` lifecycle tests deliver protocol 12 frames through a fake transport. An accepted equal-time epoch cut installs canonical owner, inventory and movement facts before clearing the Arena's pending queue, flashes, Wishes, actor-local timers and audio voices. Later cues in the same poll survive, subscriptions remain bound, canonical collections/membership remain intact and the steering goal sends no Stop. Rebind, Leave and explicit Editor teardown hooks are covered. A separate running Play-mode check verifies engine-dispatched destruction removes the owned arena and listeners.

The isolated Editor is Unity **6000.0.85f2**, PID 9075, Pipeline port 7800. Source coverage is 42 existing plus 18 new EditMode tests; the final batch reports 60 passing in 7.34 s. Trace guards report six passing. The standalone .NET suite reports 383 passed, zero failed, zero skipped. No source or assets changed after these final tests; the delivery commit adds this evidence package.

Commands ran from the art checkout, with `P=client-unity/UnityProject` expanded to its absolute path for Unity commands:

```sh
unity command script recompile --caller plugin --skill unity-cli --project-path "$P" --format json
unity command script recompile_status --caller plugin --skill unity-cli --project-path "$P" --format json
unity command test run --mode editor --filter-type assembly --filter Roguehalla.Client.EditModeTests --async-tests false --timeout 60 --caller plugin --skill unity-cli --project-path "$P" --format json
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests
client-unity/sync-net.sh --check
node --test tools/latency/trace-guard.test.mjs
unity command script eval --file /absolute/path/to/editor-fixture.cs --caller plugin --skill unity-cli --project-path "$P" --format json
unity command capture game_view --source screen --width 2560 --height 1440 --output-path /absolute/path/to/capture.png --caller plugin --skill unity-cli --project-path "$P" --format json
```

Art-owned runtime files are `UI/MatchHud.cs`, `View/ArenaView.cs`, `Presentation/SpriteActorPresenter.cs`, new `OwnerVitalBars.cs` and `ConfirmedWishPresenter.cs`, the narrow `ShowcaseSoundscape.ResetTransientCues` surface, and `Net/MatchClient.cs` lifecycle forwarding. Five new Editor test classes cover HUD, actor barriers, confirmed cues, timeline lifecycle and presentation trace. The separately released networking commit also supplies its `LatencyTrace.cs`, `RhLatency.jslib`, MatchClient diagnostic lines and Node guards. No gameplay, protocol, prediction or steering code was authored by this art packet.

The Editor fixture uses synthetic protocol 12 events with no server and disabled client input. It advances source time to 5250 ms at epoch 1; the Wish opening is 250 ms away and the cast is 1250 ms away. It captured High normal, High reduced-motion, and Low reduced-motion states at 1.50 text scale. All measured HUD regions report no overflow. The final engine teardown observation reports match=false, arena=false, cues=0, listeners=0. Editor readiness, play frames/stop, console entries/status/clear/idle, and restored preferences are preserved in `raw/`.

## Limits

The three screenshots are Unity GameView captures with a 2560×1440 target setting; the actual docked GameView reported 752×453. These are synthetic fixture captures, not browser output, native 144 Hz output, performance evidence, or end-to-end server acceptance. No sound was unlocked or output-proven. No new third-party or AI artwork was acquired. The served Web artifact remains `4f37e9f0`; full plan acceptance remains open. A fresh Editor ground-truth count of zero was established only after recording two Pipeline `HttpListenerResponse` disposal transport errors; those errors were tool transport errors, not source compile errors. Existing warnings are obsolete API warnings and the intentional missing optional point-light test warning.

Raw diagnostics under `raw/diagnostic-history/` retain superseded meta/test/orphan observations with notes; they must not be read as final passing results. The Editor-added two trailing spaces in ShaderGraph settings were recorded in `raw/editor-generated-whitespace.patch.json` and normalized before delivery. Prior art/audio remain on `codex/unity-art-direction` at `f9a6c891` and `codex/recovery/unity-audio-pre-wish-20261108` at `e81d70a4`; neither was merged into this packet.

All evidence files are listed in `manifest.json` with relative path, byte length, and SHA-256. The manifest excludes itself.
