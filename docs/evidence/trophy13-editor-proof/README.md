# Trophy protocol 13 Editor proof

This package records the actual Unity Editor presentation proof for Trophy protocol 13. Tested source is `f4ba7cfe3a3dc2473e3c642d91b5288de191d343`, based on `4a649e17bf54ec2ff50b86374c0979f044ef4866`, branch `codex/unity-trophy13-editor-proof`. The only source change in this proof branch is a one-line `SessionState` alias in the Editor proof harness. The initial Editor compile failed with CS0104 in `WishProofEditor`; after the approved alias, compile status was clean. Both results are kept separately in `raw/compile-initial-failed.json` and `raw/compile-after-alias.json`.

## Result and scope

One full Unity EditMode batch passed 62/62 tests in 7.34 seconds, with no failures or skips. This is the prior 60 plus two `MatchHudTrophyEditModeTests`: one covers canonical taken/picked/can-choose button states and skip; the other covers decoded gain refresh on the actual HUD and ordinary choose retaining handle 73 and option index 1. Those tests invoke the actual `MatchHud.Choose` path and validate the queued handle/index. They do not click a real UI button and do not receive a server acknowledgement. The raw batch result is `raw/editmode-results.json`.

High normal and Low reduced-motion captures use a synthetic protocol 13 owner-reward fixture. Synthetic transport bytes pass through `Session.Poll`, collections, and manual HUD presentation; client input is disabled. `Choose` was not invoked in either capture: `picked=false`, `canChoose=true`. No fabricated post-choice runtime state is shown. Both screenshots use 1.50 text scale. Nine measured HUD/reward regions report no overflow; reward option text is 30-point and fits on one line, while Wish text is 24-point over six lines. Target capture size is 2560×1440; the docked runtime GameView reported 752×453.

The fixture selects three stress examples from the immutable source-format capture: `+118.8% movement speed` (longest title in the captured rows), `+3.3 Soul Offence` (largest parsed gain in those rows), and `+118.8% attack speed`. These are formatter-capture extrema only, not global gameplay maxima; the source has no global gain cap. `raw/external-trophy-fixture-provenance.json`, `raw/source-format.json`, and `raw/source-corpus-check.json` preserve and verify that provenance. The actual source-format byte hash is `b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c`.

## Commands and environment

The focused Unity invocation was EditMode `test run` filtered to assembly `Roguehalla.Client.EditModeTests`; the recorded result is the full 62-test batch. Source synchronization was checked with `client-unity/sync-net.sh --check` and returned exit 0 (`Unity copy is up to date`); `raw/source-copy-observed.json` is a transcription of the observed command result, not a rerun. Compile status after the alias is completed, with no errors and no compilation failure. No .NET suite, Web build, server, cloud, profile, or audio proof was run for this package.

The existing Unity 6000.0.85f2 Editor used PID 9075 and Pipeline port 7800, with WebGL selected. Settings and background state were restored and the Editor returned idle. BakedContent was recorded before and after with unchanged 212-byte SHA-256 `4147b66e5278ee2e5abee4f683eda1c3bd6997fb79e250342eefd7ad2bb0be7a` and ulong hash `0x801a76cde4cfd305`; it was never prepared, edited, regenerated, or overridden. This is the existing baked value, not a claim about the future final server/content identity. The original art branch at `46c7a2e85b5a2189a3c2f98b7ea3451916afe76f` was preserved exactly.

The compile and bounded test commands used the same absolute project target:

```sh
unity command script recompile --caller plugin --skill unity-cli --project-path /Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject --format json
unity command script recompile_status --caller plugin --skill unity-cli --project-path /Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject --format json
unity command test run --mode editor --filter-type assembly --filter Roguehalla.Client.EditModeTests --async-tests false --timeout 60 --caller plugin --skill unity-cli --project-path /Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject --format json
```

The capture command used `unity command capture game_view --source screen --width 2560 --height 1440`, the same caller/skill/project flags, and an explicit output path. The staging code is retained as `raw/trophy-fixture.cs`.

Two actual Unity Pipeline console errors were captured: `HttpListenerResponse` disposed-object response errors. They are pipeline transport errors, not C# source compile errors or runtime product exceptions. After recording and clearing, fresh idle console ground truth reported zero errors. Obsolete API and intentional missing-optional-point-light warnings are preserved. The Editor whitespace normalization record documents restoration of two generated ShaderGraph trailing spaces; no product source change resulted.

`manifest.json` lists evidence files with relative path, byte length, and SHA-256, plus source corpus file hashes at the tested revision for the harness, HUD, Trophy formatter, affected tests, protocol decoder/state/collections, network version, and the immutable source-format corpus. The initial compile failure is intentionally preserved as a failure; it is not represented as the final compile result.
