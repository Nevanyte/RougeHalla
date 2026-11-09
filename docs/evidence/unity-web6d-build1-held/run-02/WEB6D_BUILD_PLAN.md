# Current6d Web build plan (unrun)

Installed build run rejects None and defaults DetailedBuildReport. Explicit report-only flag needs Root acceptance; no silent substitution. RhBuild.BuildWeb is not used.

Existing scene: `Assets/Scenes/Main.unity`; no settings/source/scene writes.

Dry-run:

```sh
unity command build run --project-path /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject --caller plugin --skill unity-cli --format json -- --target WebGL --output-path /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/web-build-6d-2026-11-09/Web --scenes '["Assets/Scenes/Main.unity"]' --options '["DetailedBuildReport"]' --dry-run true
```

One build after Root release:

```sh
unity command build run --project-path /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject --caller plugin --skill unity-cli --format json -- --target WebGL --output-path /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/web-build-6d-2026-11-09/Web --scenes '["Assets/Scenes/Main.unity"]' --options '["DetailedBuildReport"]' --confirm true
```

Poll:

```sh
unity command build status --project-path /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject --caller plugin --skill unity-cli --format json
```

- Require exactly46583/canonicalproject/6000.0.85f2/WebGL; no old9075/ports/default route.
- Before queue and after terminal build: verify HEAD6d/tree/all1284Git+diskpins/626GUIDs and only exact approved1044Bstartupoverlay; preserve first mismatch/diff without restoration.
- Before/after: read exact same publicPlayerSettings probe, source BakedContent and existing Main scene hashes; no setters, scene operation, source/package/Baked edit or SaveAssets.
- One dry-run validates explicit scene/output/options then one confirm submission only; bind queuedbuildId and poll build status without requeue/restart/clean cache. Preserve raw stdout+command receipts before parsing.
- After success only: copy9 existing notices byte-for-byte to external Licenses and verify hashes; generate artifact manifest/download sizes and preserve BuildReport warnings/errors.
- No Play/defaultBootstrap, realaccount/network/browser/hosting or furtherEditorlayoutattempt; actualbrowsermatrix is separate Root/networking packet.
