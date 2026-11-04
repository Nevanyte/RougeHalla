# ADR 0008: Unity Web client with an engine-independent C# net library

**Status:** Provisional: the Unity project has not been opened or built (no Unity Editor or license was available in
Stage 1). **Decision.**
- Unity 6 LTS (`client-unity/UnityProject/ProjectSettings/ProjectVersion.txt`, PROVISIONAL patch number), URP, the Input
  System; Web (WebGL2) target first; WebGPU optional later behind a fallback.
- All protocol and client-network logic lives in `client-unity/RoguehallaNet` (netstandard2.1, C# 9, no reflection, no
  threads on the hot path): built and tested with plain `dotnet` against the golden vectors (71 tests), so it does not
  need the Editor. The Unity project copies it (`client-unity/sync-net.sh`, checked by a test).
- WebGL transport: a jslib bridge to the browser WebSocket (`RhWebSocket.jslib`), polled each frame; Editor/desktop use
  `ClientWebSocket`.
- Prediction is narrow: only the local player's walk, reconciled to the server by `move_seq`; never attacks, damage,
  deaths or other players. Remote players interpolate in the past with an adaptive delay (70-150 ms).
- Existing art only (colored primitives and the legacy palette); visual targets: [../VISUAL_DIRECTION.md](../VISUAL_DIRECTION.md).

**To confirm (packet P-UNITY-1):** the exact LTS patch and package versions, a Web build in Chrome, Firefox, Safari and
Edge, frame time on named mid-range hardware, download size, memory.
