# Held Web build 1 report

**Build result:** Unity’s persisted BuildReport says `Succeeded` for WebGL, build `build_bf4d3ece70b3`. It reports 175349 ms, 106,946,646 output bytes, 17 warnings, and 0 errors.

**Disposition:** HOLD. The build produced output at `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/web-build-6d-2026-11-09/Web`, but the artifact is not released. The post-build inventory found exactly three serialized asset pin mismatches (1281/1284 source pins still match). Root allowance for these assets is `NONE`; no bytes were restored or accepted, and there was no requeue, second build, or 98-test rerun. The nine planned license notices have not been copied into the output.

## Three held source mismatches

| Asset | Frozen bytes → current bytes | Frozen SHA-256 | Current SHA-256 |
|---|---:|---|---|
| `client-unity/UnityProject/Assets/Settings/RoguehallaPipeline.asset` | 4411 → 4413 | `35aab2e06292637cc288ffd981862f9abc9dc7647b3e14cde418588e97363e65` | `ea26d6362d84b96ab37fdbbe03b92f7a723f35e05a5a306b586fc05730e5641c` |
| `client-unity/UnityProject/Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Fallback.asset` | 9359 → 9748 | `1ed305335acc00607b80aaf22d1232f189b8aed773fa1d8bc66e96989aa751a9` | `6792385c280302fc148141e7248f57fdab55b01366c31275e035a8fed3a4d850` |
| `client-unity/UnityProject/Assets/UniversalRenderPipelineGlobalSettings.asset` | 21719 → 21730 | `725624bcda3488d242383ef9e31befde45cb8eacc7001135da6e1a152258df00` | `2458dd20ad332a72f08ff4620754d339a4a7bf814f73476332377852479fb014` |

The two URP asset differences and TMP fallback font/schema/atlas serialization difference remain under expert review. This report preserves the exact byte/hash comparison without interpreting the changed serialized data. The pre/post public PlayerSettings observer results are identical; the Main scene and baked content are exact.

## Build request and report

The single submission used source `6d5d9340a6b9f425a17d7ea4488b49291fff3dc1`, PID 46583, `BuildOptions.None` plus the report detail option `DetailedBuildReport`, with development mode off and `Assets/Scenes/Main.unity` as its scene. It passed dry-run validation. Terminal report: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/web6d-build-persisted-status-002.json` (SHA-256 `d4f41a5ade6b590a7998a87a486d967eb800faf9912b7ec50cd95eb91fda26ce`). It lists five generated WebGL files. The nine required notice sources were identified by the plan but have not yet been copied, so this is not a distributable package.

The current 17 warnings are all CS0618 and match historical warning groups; see [web6d warning review](web6d-warning-review.md). They are not evidence of browser or runtime acceptance.

## Status and timing record

The queued receipt identifies `build_bf4d3ece70b3`. Persisted status observed it building at `2026-11-09T20:18:12.3643800Z`; the contemporaneous status command reported the Editor unreachable. The later terminal status reports success. The terminal report says `2026-11-10T02:18:12.3940060Z` to `2026-11-10T02:21:07.7437132Z` (175349 ms); its times are about six hours later than the submission/queued status timestamps. The report’s internal interval agrees with its duration, but the time basis discrepancy is unresolved.

## Separate layout attempts

Two off-screen layout attempts each stopped before capturing an image (0 PNGs): `STOP_FIRST_LAYOUT_ERROR` and `STOP_FIRST_LAYOUT_ERROR`. These failures are separate from the WebGL build result and do not constitute visual review.

## Evidence index

| Evidence file | Bytes | SHA-256 |
|---|---:|---|
| `run-02/WEB6D_BUILD_PLAN.md` | 2544 | `fa8978562952d3473e4fae7be46876f56195cea62e2fccd54543dfc00162f0a1` |
| `run-02/WEB6D_BUILD_PLAN.json` | 5444 | `26dca77f57ffa70b8d809e975dc294cbb68b6f068abc44a5eadfba6dc6c2e419` |
| `run-02/ROOT_WEB6D_BUILD_RELEASE.json` | 3725 | `b3f04e42211573806d52a2af45333083486f8b013c37e817754f54e4362052c3` |
| `run-02/evidence/web6d-plan-file-preflight.json` | 3708 | `33613ca509a81549db2c4afd9f4f9483fcc79a3e3aee0878d4b2860be5d8c414` |
| `run-02/evidence/web6d-build-dry-run.json` | 56 | `741f5dafba6ab0a2059959ac5dbf2539948c245d096686c9831ded05b1409a72` |
| `run-02/evidence/web6d-build-submission.json` | 671 | `b3b77f6cad45e62ef2bed5fee283f76e8462da055d9ba3a1fe9eea1c8e0c5c91` |
| `run-02/evidence/web6d-build-queued.json` | 51 | `ce2a02421384027a3a14ba43ca87d7857d4e01f702ba8a76d25e0a279befa862` |
| `run-02/evidence/web6d-build-persisted-status-001.json` | 264 | `4ec6e6e8e30f1e8bfbccd5279f2f18a30aedd1241777fa7030e54ec6661595dd` |
| `run-02/evidence/web6d-build-persisted-status-001.observation.json` | 445 | `73a2fea833be002a9bb225a62911d84cf4447e5fcfeb95e5eba954d638ef3d73` |
| `run-02/evidence/web6d-build-status-001.json.target.json` | 1490 | `f1c4c6ab4a162e81e70c911e145317847e65dc16d52c5aa82f65b9a219b5ce89` |
| `run-02/evidence/web6d-build-status-001.json.target.json.invocation.json` | 401 | `e6862097845c75a03ee8c925ea4087f9da609fe5694c88e68853e3828fa31af8` |
| `run-02/evidence/web6d-build-status-terminal.json` | 1095387 | `b3347314b53afd53108d58e68b059ef50a001ab67bb5e1fbb2335250cb51d7f0` |
| `run-02/evidence/web6d-build-persisted-status-002.json` | 1095386 | `d4f41a5ade6b590a7998a87a486d967eb800faf9912b7ec50cd95eb91fda26ce` |
| `run-02/evidence/web6d-prebuild-source-guard.json` | 488 | `0cf08e8e13772ede4c5b0d060294ab00d48d89fb0ac9b1b65e2083503d97188f` |
| `run-02/evidence/web6d-prebuild-effective-settings.json` | 4138 | `8611129d109dc21e4c251cc296b5a5f6a5043634752b7c078b8146496665fce6` |
| `run-02/evidence/web6d-postbuild-source-guard.json` | 188 | `8d1ca8af3ac518053b654ecdad3d5ce52645d9007ffa9a4783d026c7c6ad784e` |
| `run-02/evidence/web6d-postbuild-drift-inventory.json` | 2056 | `508c8441331f532bafdc9cdf65465d24afeae5cd88e71480cb3647395c811584` |
| `run-02/evidence/web6d-postbuild-effective-settings.json` | 4138 | `f36d1a1490dab5cd957f978b05c24275cdf58baf9e7f2840a85c5805e85f25a3` |
| `run-02/evidence/native98-raw-reconciliation.json` | 4523 | `b4c31681312d8787258fd432835ecdd6fb937c6629d24f6a6482f6351685ff9e` |
| `run-02/evidence/layout6d-final.json` | 4654 | `407ab88dbd1e3e99044606482b0f9d681ed00a8c6bb108518fae09f99f460380` |
| `run-02/evidence/layout6d-r2-final.json` | 6304 | `1bd73303a74dc9f77fdd09f5b445523fdf351f6108b8b6cdce275e28186b586d` |
| `layout6d-preparation/web6d-warning-review.json` | 11564 | `9a9c74e05fe08305d4782a568218eaaf538374e7e518647eee7d56c3c9cc110c` |
| `layout6d-preparation/web6d-warning-review.md` | 2982 | `62972a9e76ba704ba647b67cd2c94b299a1855f3a336257053258a1b98d4a9db` |

Evidence excludes private preference snapshots, raw Editor logs, compiled binaries, and the build artifact binaries. No browser, runtime, visual, or performance acceptance is claimed.
