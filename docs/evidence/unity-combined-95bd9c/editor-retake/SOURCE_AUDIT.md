# 95bd9c post-test source audit

Read-only comparison of the current checkout with the frozen `as-tested-source.json` snapshot after the bounded recovery test stopped. No files were changed by this audit.

- Exact HEAD and branch remain `95bd9c1efcde9b71cb07f23f24aef8ff4fb17013` / `codex/unity-95bd9c-native-proof`.
- The snapshot covers 1,122 tracked `client-unity/UnityProject` files. All 1,122 still exist; 1,121 are byte/hash identical. No baseline files are missing and no untracked UnityProject files exist.
- The sole drift is `client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset`: 555 → 557 bytes. Only two empty YAML scalars gained trailing spaces: `m_Name:` → `m_Name: ` and `m_EditorClassIdentifier:` → `m_EditorClassIdentifier: `. The serialized values are unchanged; this is whitespace serialization drift.
- Git status contains only that ProjectSettings modification. There are no art-preparation additions, study/runtime/UI source changes, or non-frozen Net mirror changes in the worktree.

The exact per-file baseline/current SHA-256 receipt is in `source-after-tests.json`. This report does not restore or otherwise touch the permitted Unity serialization overlay; parent owns any cleanup.
