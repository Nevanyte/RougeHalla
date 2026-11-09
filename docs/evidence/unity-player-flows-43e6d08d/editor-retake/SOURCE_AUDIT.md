# 43e6d08d post-test source audit

Read-only comparison of the current checkout with its frozen `as-tested-source.json` after the 20-method Editor test run. No project files were changed by this audit.

- Exact HEAD: `43e6d08d90e8ee63e3a16ef002bba3e971c9e30f`, branch `codex/unity-43e6d08d-functional-proof`.
- The manifest covers 1,136 tracked `client-unity/UnityProject` files. All are present; 1,135 match byte-for-byte and by SHA-256. No missing baseline or untracked project files were found.
- Sole drift: `client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset`, 555 → 557 bytes. The only changes are two trailing spaces after empty `m_Name:` and `m_EditorClassIdentifier:` values; serialized values are unchanged.
- Git status contains only that ProjectSettings file. No art-preparation additions or other project/source changes are present.

The detailed baseline/current hashes are in `source-after-tests.json`. Parent owns any cleanup of the settings serialization overlay; this audit did not restore it.
