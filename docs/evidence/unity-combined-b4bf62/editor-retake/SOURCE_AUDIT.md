# b4bf62 post-native source audit

Read-only comparison of the current checkout with `as-tested-source.json` after the readiness gate stopped. No project files were changed by this audit.

- Exact HEAD: `b4bf621d7ed285bb6af4eb737073e197450415df`, branch `codex/unity-b4bf62-native-proof`.
- The manifest covers 1,122 tracked `client-unity/UnityProject` files. All are present; 1,121 match byte-for-byte and by SHA-256. There are no missing baseline files or untracked project files.
- Sole drift: `client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset` (555 → 557 bytes). Only trailing whitespace was added after the empty `m_Name:` and `m_EditorClassIdentifier:` values. Their serialized values are unchanged.
- `ProjectSettings/ProjectSettings.asset` matches the frozen baseline exactly, consistent with the temporary background-mode setting having been restored. Git status contains only `ShaderGraphSettings.asset`.
- The external `drawer-proof-functions.cs.txt` helper was written as preparation but was **UNEXECUTED**. It was not imported or invoked and is not evidence of drawer acceptance.

Exact baseline/current hashes and status are recorded in `source-after-native.json`. Parent owns restoration of the remaining settings overlay; this audit did not restore it.
