# Expected source identity — native 42 case gate

Gate source commit: `9c658e049d4b4e77118004d481349d1523e2ded4`. Source approval: `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b`. Expected: **42 cases**. This is a read-only identity packet; it does not execute tests.

## Exact fixture sources

| Fixture | Namespace / type | Cases / methods | Source SHA-256 | Meta GUID |
|---|---|---:|---|---|
| `QuestJournalViewEditModeTests` | `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 / 8 | `a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508` | `629434afa706419fbb9172e17b76ce43` |
| `TraderDialogViewEditModeTests` | `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 / 6 | `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb` | `fbeed4975d944443b6c6f34fe85c6d32` |
| `PlayerFlowsEditModeTests` | `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 / 11 | `d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26` | `2695dbaec0cf4aa3b68c217e1e45dd55` |
| `MatchLaunchEditModeTests` | `<global>` / `MatchLaunchEditModeTests` | 17 / 14 | `85d3fa8ae38a23bc6647a24e10836cc83802aba21f5157740992af22483508ea` | `fcfb3901a322446bbd5299b1e19524d6` |

Each source path, source SHA, `.meta` path, `.meta` SHA, and GUID is also recorded in the JSON packet. All four blobs were read from exact commit `9c658e049d4b4e77118004d481349d1523e2ded4`.

## Existing 25-case contract

The frozen selector list is `docs/evidence/unity-ui-planning-quests/typing-guard/native-selectors.txt` with SHA-256 `2d619f2f0c69c3770c685f4e1403b68213dde6320257a09350de44d0c1b16c2b`. Its 25 full names exactly match the 8 Quest Journal, 6 Trader Dialog, and 11 Player Flows `[Test]` methods in the selected source files. The complete names are preserved in `EXPECTED_SOURCE_IDENTITY.json`; they must remain unchanged.

## Added MatchLaunch cases

The frozen source-case file `docs/evidence/unity-launch-modes/expected-native-cases.json` has SHA-256 `160f16431671daa01b8463a44a51d47075b5bfcae84445b04c36c40b6d8da1b5` and defines **17 cases from 14 methods**. Its authored approval/source tag is `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b`; the test source blobs audited here are from the gate commit `9c658e049d4b4e77118004d481349d1523e2ded4`. Every method and every literal `[Test]` / `[TestCase(...)]` source argument is recorded in the JSON packet. In particular, parameterized cases are `false`, `true`; `MatchLaunchMode.Arena, false`; `MatchLaunchMode.Training, true`; `MatchLaunchMode.Arena, true`; and `MatchLaunchMode.Training, false` as listed per method.

Before execution, discover the real NUnit leaf cases and bind each to the expected type + method + argument tuple. Require 17 unique matches with no missing, extra, substitute, or case-count-only pass. Preserve the prior 25 full names and test bodies.

## Public discovery API note

The local Test Framework package cache reports version 1.6.0, while `Packages/packages-lock.json` reports 1.4.6; the manifest and cache report 1.6.0. Confirm the package actually loaded by the Editor before execution. In the cached package source, `ITestAdaptor` exposes `TypeInfo`, `Method`, `Arguments`, and `FullName`; `Filter.testNames` documents parameterized names with arguments in parentheses. The public `RetrieveTestList(TestMode.EditMode, callback)` method is marked obsolete, and its comment recommends `RetrieveTestTree`; verify that newer method exists in the Editor’s loaded package. Safest binding is to compare expected tuples against discovered adaptor leaves and execute using the discovered exact `FullName` values, never guessed formatting.

## Status

This packet is source identity only. Unity compilation, discovery, binding, and execution remain for the coordinator.
