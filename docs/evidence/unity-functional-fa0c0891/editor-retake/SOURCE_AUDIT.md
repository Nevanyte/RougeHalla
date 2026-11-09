# Source audit after the fa0c0891 engine gate

Compared the current art checkout at `fa0c0891f78e2fd4a65fb08d71d226d8a426e724` against the sealed `as-tested-source.json` inventory (1,136 project files).

- All 1,136 baseline paths exist.
- One file differs: `client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset` (555 → 557 bytes). Its only diff is one trailing space added to each of `m_Name:` and `m_EditorClassIdentifier:`. No other setting/value change appears in the text diff.
- No untracked project files were found. Git status shows only that one modified file.
- No art-preparation additions or new live bindings are present in this audited Unity project file set.

This is an observation, not a restoration. Parent owns preservation/restoration decisions. The static offscreen preview method remains unexecuted and is not a result of the engine gate.

The canonical frozen-four preparation review is `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/unity-frozen4-preparation-review.md`. It authorizes private preparation only, holds audio publication, and grants no live, Play, visual, browser, performance, or Web-build acceptance. The new static preview method remains separately proposed and requires Root's release after the gate and cleanup seal.

Machine-readable comparison: [source-after-tests.json](source-after-tests.json).
