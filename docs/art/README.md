# Roguehalla visual art board

Open [index.html](index.html) for the curated source preview and visual direction. The selected primary family is Flare game art: credited fantasy characters with animation-frame/anchor metadata and a matching isometric dungeon atlas. The Unity-facing frame inventory is `client-unity/UnityProject/Assets/Art/ThirdParty/Flare/sprite-frame-metadata.json`.

The project now includes selected Flare audio as well as art: two music tracks, one ambience loop, and five UI/combat/item effects. The original source files are unchanged. Exact pins, hashes, attribution and license records are kept beside the assets. See [ARMOR.md](ARMOR.md), [AUDIO.md](AUDIO.md), and [client-unity/THIRD_PARTY_ASSETS.md](../../client-unity/THIRD_PARTY_ASSETS.md) before redistribution. No Asset Store package, paid asset, 3D asset, or generated artwork was acquired.

## Readiness and coverage

[COVERAGE.md](COVERAGE.md) distinguishes prepared/imported assets from the subset wired into the live server-fed renderer, and lists known art and data gaps. Related implementation notes: [palette and color review](PALETTE.md), [presentation settings](SETTINGS.md), and [WebGL shell](WEB_SHELL.md). The canonical gameplay-presentation readiness inventory is [docs/unity/PRESENTATION_CONTRACT.md](../unity/PRESENTATION_CONTRACT.md), with exact protocol gaps in [PROTOCOL_GAPS.md](../unity/PROTOCOL_GAPS.md).

The exact local build passed 19/19 browser flow checks, 329 networking C# tests and 11 Unity presentation tests. [Verification and local run links](VERIFICATION.md), [performance report](PERFORMANCE.md) and [portable evidence](evidence/summary.json) are available. Native 2560×1440 / 144 Hz acceptance remains open because the attached display is 1920×1080 at 60 Hz. Uncapped submission measurements are reported separately.
