# Wish HUD copy evidence

Text-only HUD copy update at source HEAD `9a56a82454dc026e3d5e948e86d2d695d895dc89`, based on `7d5a496b10083e969f3498502fc25726bbb2b23e`. Scope is limited to `MatchHud.cs` and its focused EditMode tests; their exact source sizes and SHA-256 digests are recorded in `manifest.json`.

## Change

The Wish card now shows relative seconds derived from delivered timestamps and `Session.ServerTimeMs`: `Wish timer`, `Next charge in`, `Full charges in`, and `Casting <ability>`. Recharge duration is displayed directly as seconds from `RechargeMs`. Display values round up to one decimal place with invariant decimal formatting; expired deadlines clamp to `0.0s`. These labels do not predict charge stock, determine eligibility, or gate input. Owner text retains the delivered barrier amount and removes the raw ring count. Visual rings, facts, lifecycle, and proof hooks are unchanged.

At source time 5250 ms, epoch 1, with a synthetic fixture, the High layout reads: `Wish timer: 0.3s`, `Recharge 4.0s`, `Next charge in 1.8s`, `Full charges in 6.8s`, and `Casting Freeze · 1.3s`. At 5000 ms the focused test asserts 0.5s, 2.0s, 7.0s, and 1.5s; at 5250 it asserts 0.3s, 1.8s, 6.8s, and 1.3s. At 13000 ms the values clamp to 0.0s while stock remains 1/2. With zero charges labels remain elapsed-only; with 2/2 and absent optional next/full/cast fields those three rows disappear; with no Wish the card reports `None delivered`.

## Verification

The focused Unity Editor EditMode filter was `MatchHudWishBarrierEditModeTests` (`test run`, mode `editor`, filter type `testName`): 2 passed, 0 failed, 0 skipped, 5.72 seconds. `raw/test-command.json` preserves the Unity pipeline command schema and invocation metadata; `raw/hud-tests.json` preserves the exact result. Final compile status is completed with no errors and no compilation failure. The final High normal and Low reduced-motion screenshots were captured at 1.50 text scale; all five measured UI regions report no overflow and the Wish card uses 24-point text over six lines.

The fixture used manual `Arena`/`HudPresent` calls after a fake protocol 12 `Session.Poll`; `ClientUpdate` was disabled. It was synthetic and had no server. Source time was advanced from 5000 to 5250 ms, epoch 1. Editor target size remained 2560×1440, while the docked runtime GameView reported 752×453. Editor port was 7800; the Editor was pinned at 6000.0.85f2. Play mode was stopped, preferences and background state were restored, and the Editor returned idle.

The focused test command was:

```sh
unity command test run --mode editor --filter-type testName --filter MatchHudWishBarrierEditModeTests --async-tests false --timeout 60 --caller plugin --skill unity-cli --project-path /Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject --format json
```

The capture command used `unity command capture game_view --source screen --width 2560 --height 1440`, the same caller/skill/project flags, and an explicit output path. `raw/editor-fixture.cs` and `raw/advance-fixture.cs` preserve the staging code. Compile and capture metadata are also retained. This follow-up changes no Web artifact and starts no performance campaign.

## Limits

These captures are not browser output, native 144 Hz output, performance profiling, audio proof, or server-backed acceptance. The two actual Editor console errors in `raw/editor-console-entries.json` are Unity Pipeline `HttpListenerResponse` disposed-object response-transport errors; final idle ground truth in `raw/console-idle.json` reports zero console errors and no compilation failure. They are not source or runtime exceptions. The prior reported art evidence under `docs/evidence/wish-barrier-presentation/` remains unchanged. Its earlier 60 EditMode and 383 .NET results belong to that prior revision; they were not rerun for this copy-only change.

`manifest.json` lists every packaged evidence file and both source files with relative paths, byte sizes, and SHA-256 hashes. This package adds evidence only; it does not alter source, Unity settings, or shared status records.
