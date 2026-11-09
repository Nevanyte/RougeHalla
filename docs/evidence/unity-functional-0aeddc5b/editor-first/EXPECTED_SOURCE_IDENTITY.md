# Expected source identity — 0aedd MatchClient gate

Gate commit: `0aeddc5b4ce0feb5fc0060f2cf2d56c05dff8944`. Source-tree commit: `0763368538dc401e243bb603293f271634aee4d9`. Frozen `SOURCE_IDENTITY.json`: SHA-256 `3059615e58dd3700d09bcc2a5bd744c1b2268994e7342ff9797de8d899136323` (250551 bytes, 1153 entries). All 1,153 file pins were verified against Git blobs at the exact gate commit; 0 mismatches.

## Exact comparison with the prior 8c packet

The only changed project input is `client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs` (8c: 19338 bytes, SHA-256 `c31b74999497a830402c3eec84f3e246cd3a3ffad0e4144a92f5db90f54c52f3`; 0aedd: 19865 bytes, SHA-256 `7066c76deb34a22c6fe4b89214cd9e55b19e1e84b41240b0765ce5d4d42b3fec`).

All four fixture sources and `.meta` files match the 8c packet byte-for-byte, with unchanged GUIDs, namespaces/full type names, methods, attributes, and argument tuples. The three fixture sources containing the preserved 25 cases also match `fa0c0891f78e2fd4a65fb08d71d226d8a426e724` byte-for-byte. The frozen selector file remains SHA-256 `32d8c1612e3c0c7672802f31859057e4b1a97678e4a9445081922045e7c220c9`: all 25 preserved full names and all 17 new method/argument tuples are unchanged. Exact source/meta hashes and method attributes are in `EXPECTED_SOURCE_IDENTITY.json`.

## Fixture identities

| Fixture | Full type name | Cases / methods | Source SHA-256 | Meta GUID |
|---|---|---:|---|---|
| `QuestJournalViewEditModeTests` | `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 / 8 | `a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508` | `629434afa706419fbb9172e17b76ce43` |
| `TraderDialogViewEditModeTests` | `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 / 6 | `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb` | `fbeed4975d944443b6c6f34fe85c6d32` |
| `PlayerFlowsEditModeTests` | `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 / 11 | `d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26` | `2695dbaec0cf4aa3b68c217e1e45dd55` |
| `MatchLaunchEditModeTests` | `MatchLaunchEditModeTests` | 17 / 14 | `1df70730e10dd3a3ea82365cd88db15a2fa631f313d4b168cbdbfe47e5c3323a` | `fcfb3901a322446bbd5299b1e19524d6` |

## Gate scope

This is an expected identity packet, not a Unity compile, fresh NUnit discovery, binding, or test result. The only production code input difference from 8c is `MatchClient.cs`; the 42 fixture cases themselves are unchanged. Coordinator owns any execution.
