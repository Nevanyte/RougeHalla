# e2baad post-gate source audit

Read-only comparison of the current checkout with `as-tested-source.json` following the stopped finite gate. No project files were changed by this audit.

- Exact HEAD is `e2baadae03dd25cf74979bdfeb3bf35fd696393d`, branch `codex/unity-e2baad-native-proof`.
- The frozen manifest covers 1,122 tracked `client-unity/UnityProject` files. All 1,122 are present; 1,121 match byte-for-byte and by SHA-256. No baseline file is missing and there are no untracked project files.
- The sole drift is `client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset`, 555 → 557 bytes. The only changes are trailing spaces on empty `m_Name:` and `m_EditorClassIdentifier:` scalars. Serialized values are unchanged; this is Unity settings whitespace serialization.
- Git status contains only that ProjectSettings file. No project asset, study, runtime/UI source, or Net mirror changes are present.
- No helper source was written: helper planning was interrupted before an external helper artifact existed. It is unexecuted and supplies no acceptance evidence.

See `source-after-tests.json` for the baseline-manifest hash and per-file before/after hashes. The settings overlay is left untouched for parent cleanup.
