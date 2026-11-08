# Protocol 13 final Web build lane

This evidence records one successful Unity Web build and loopback HTTP integrity campaign. The frozen source is `1310ae002870bf3fc674c7b65f38ff5ea55a7d75` on `codex/unity-protocol13-web-proof`; generated `BakedContent` is committed separately at `aa64c64256ca718755187b4f0f4896a169ea950d`. The only source difference from the freeze is the actual `/info` generated content hash changing from `801a76cde4cfd305` to `67183626db240b6a`. No manual override or gameplay/UI edit was made.

## Build and artifact

The existing Unity 6000.0.85f2 Editor (URP 17.0.4) compiled successfully and built Web once. The recorded configuration targets WebGL 2 / OpenGLES3 with compression disabled, threads disabled, decompression fallback off, and the existing 45-second normal gameplay lock left unchanged. The build result identifies source `1310ae...` and content hash `67183626db240b6a`. Unity was idle afterward, not compiling, with background execution disabled.

The Web output was copied to the external immutable archive `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/builds/protocol13-1310ae00`: 14 files, 74,247,550 bytes. The archive receipt confirms every archived file matches the build manifest. The original 4f37e9f0 artifact was separately preserved at `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/builds/accepted-repair-4f37e9f0`: 14 files, 74,041,096 bytes, verified against its original manifest. The new external build manifest is included byte-for-byte in `raw/build-manifest.json`, with SHA-256 `eab8c97fc3ef3593811546982c0ef0980da6b8b09204ca80b623d27c046e299f`.

The archived build was served on loopback at `http://127.0.0.1:18913/` (PID 12630). The served-artifact receipt records successful HTTP status and SHA-256 verification for all 14 resources, including `application/wasm` for the WebAssembly file. No recognizable runtime source stamp was found, so none is claimed. Build identity is supported by the frozen source record, generated-content receipt, full as-built overlay, build result, and external manifest digest.

## Source preparation and cleanup

The full as-built overlay and normalization record preserve the exact temporary serialization state used for the build: four whitespace-only settings files plus temporary fallback-material serialization, dynamic atlas clearing, and the atlas value change from 0 to 1 pixel, along with generated BakedContent. After archiving, all five automatic files were restored byte-for-byte; the intended generated BakedContent was retained and committed at `aa64...`. The asset preparation and project normalization records are included. No second build was run.

The server binary used for identity was frozen at source `1310ae...`, SHA-256 `20d5b70e9ed79863f03350fbeb9478fd7f45e0a7a644ea2a802a13c14d75b4b0`. Its `/info` response reports protocol 13 and content hash `67183626db240b6a`, with zero rooms, lobbies, and players at observation. Before baking, the tracked `UnityProject`, standalone `RoguehallaNet`, and `tools/latency` trees had no differences from preserved ref `79af41a6`; this preserves prior actual 62-test source identity only. The 62 tests and .NET suite were not rerun or claimed here.

## Limits and warnings

Networking owns the single browser campaign, covering the five normal R scenarios and the separate first-playable real-Trophy scenario. Its outcomes are pending this build-lane handoff. This package does not claim browser gameplay outcomes, Trophy interaction success, performance, audio, cloud, or end-to-end acceptance. The backend evidence separately establishes matching-source Trophy grant behavior; it does not prove browser display of hidden kill statistics.

The Editor's final state was idle with zero errors and compilation errors. Captured warning history contains 13 buffered warning entries; the final ground-truth sample reports 4 current warnings and 5 logs. Obsolete API and the test transport's unused event warnings are preserved in `raw/console-build-warnings.json`; the build is not described as warning-free.

The built 74 MB artifact remains in its external archive and is not copied into this repository. `manifest.json` lists packaged evidence files by relative path, byte length, and SHA-256 and records the frozen source and generated BakedContent commit. The external build manifest itself is preserved byte-for-byte. This package does not include growing `serve.log`, unused driver/schema material, or the archive helper script.

The original Editor build log is preserved byte-for-byte as a UTF-8 JSON string in `raw/build-editor-log.json`, with its original byte count and SHA-256. This keeps literal log whitespace intact without adding trailing whitespace to repository text files.
