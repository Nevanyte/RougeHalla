# Test Framework version audit — 2026-11-09

No resolved package mismatch was found. **Recommend no package edit before the next combined gate.** This audit wrote only this new external report and its pins; the sealed Training leaf and historical receipts are unchanged. No Editor/Unity CLI invocation, refresh, resolution, import, Library mutation or build was performed.

All source paths below are relative to `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/`.

| Source revision | Direct manifest | Selected lock node |
|---|---|---|
| Frozen4 `5b7877f99805d6ef980577eda86a779ee4614d9f` | 1.6.0 | 1.6.0, depth 0, builtin |
| Functional `0aeddc5b4ce0feb5fc0060f2cf2d56c05dff8944` | 1.6.0 | 1.6.0, depth 0, builtin |
| Settlement `5457b9c03149333ed3b2bcebdfb10b224364fc25` | 1.6.0 | 1.6.0, depth 0, builtin |

The package files are byte-identical across these three revisions:

- `client-unity/UnityProject/Packages/manifest.json:7`: `dependencies["com.unity.test-framework"] = "1.6.0"`; SHA-256 `48db1aa7682891877ae10e3bf60c2fca07604439dcdd002c1644b501ede54fc9`.
- `client-unity/UnityProject/Packages/packages-lock.json:135–143`: selected `dependencies["com.unity.test-framework"].version = "1.6.0"`; SHA-256 `0bf5d9c3a47cad85f431635db3ac7e33c4508e398143f4519d5b9504b36c4769`.

The `1.4.6` at lock line 20 is **Collections 2.7.1's dependency request**, at `dependencies["com.unity.collections"].dependencies["com.unity.test-framework"]`. It is not another selected Test Framework node. Pipeline 0.10.0-exp.1 and Performance Testing 3.5.0 also request 1.1.33 (lines 67 and 150). These older dependency edges coexist with the single selected builtin 1.6.0.

The current `client-unity/UnityProject/Library/PackageManager/projectResolution.json:52–60` selects 1.6.0 builtin, compatibility `6000.0.44f1`, fingerprint `082c24152fd4906ea828826ae9d9773b8a56b3ff`. Its PackageCache manifest at `client-unity/UnityProject/Library/PackageCache/com.unity.test-framework@082c24152fd4/package.json:2–6` reports name/version/minimum Editor consistently; SHA-256 `c71d7096402097ffa44ecdec03a99e68b37d40bd259b6e17840ac869ca3356c2`.

The installed Editor's `/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/Resources/PackageManager/BuiltInPackages/com.unity.test-framework/package.json:2–6` itself contains version 1.6.0, `unity = 6000.0`, `unityRelease = 44f1`; SHA-256 `3fb2cc0cf7c8e97c67ac8ba69aff049e314ee6ab99828582a74927b1bf3a39d5`. The cached and bundled parsed manifests differ only by the cache's generated `_fingerprint`. `client-unity/UnityProject/ProjectSettings/ProjectVersion.txt:1–2` pins 6000.0.85f2. This is the Editor's bundled compatible core package.

The saved native observations in both `functional-0aeddc5b-2026-11-09/evidence/actual-test-framework.json` and `settlement64-5457b9c0-2026-11-09/evidence/actual-test-framework.json`, under `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/`, report `PackageInfo.FindForAssembly(typeof(TestRunnerApi).Assembly)` as package `com.unity.test-framework`, version 1.6.0, resolved to that PackageCache directory. Both receipt SHA-256 values are `a01a38c323426bb0f867fa67b884a77f3d97c4c854a2faec7677e6e94fd7c709`; both observer sources hash to `22ba2e536ffbc0441da52c3166f41b1850c7a4b9c4827a042e28d6a57ba9d40c`. These are preserved historical observations, not a new live Editor query. The runner's assembly version 1.0.0.0 is separate from package semver; its package `UnityEditor.TestRunner/AssemblyInfo.cs:15` declares that assembly version.

The CLI tool is distinct: cached `client-unity/UnityProject/Library/PackageCache/com.unity.pipeline@303cb578aa66/package.json` is 0.10.0-exp.1. Its `Editor/Commands/TestCommands.cs:9,38` imports the TestRunner API and calls PipelineTestRunner; `Editor/Testing/PipelineTestRunner.cs:9,179,369` imports the API, creates TestRunnerApi and calls `api.Execute`. The actual Test Framework package owns UnityEditor.TestRunner's asmdef and sources. The evidence supports the genuine bundled/resolved package, rather than a tool-injected replacement. This does not establish why any historical test passed or failed.

[Unity's 6000.0 Test Framework documentation](https://docs.unity.com/en-us/engine/6000.0/manual/packages-list/packages-all/pack-core/com-unity-test-framework) identifies it as a core package fixed to the Editor. [Core package documentation](https://docs.unity.com/en-us/engine/6000.0/manual/packages-list/packages-all/pack-core) says these versions are distributed with the Editor. [UPM resolution documentation](https://docs.unity.com/en-us/engine/6000.0/manual/packages-list/dependencies-lp/upm-conflicts) gives built-in packages priority over version-based dependencies; [package manifest documentation](https://docs.unity.com/en-us/engine/6000.0/manual/packages-list/cus-pkg-development/upm-manifest-pkg) defines the compatibility fields. The local selection is consistent with those rules.

Retain manifest and generated lock unchanged. For the next ordinary gate receipt, read the exact selected JSON node and record Editor 6000.0.85f2, Test Framework 1.6.0 and Pipeline 0.10.0-exp.1 separately; compare the package owning TestRunnerApi to that selection. If an observer uses the first text match, correct that interpretation only. No downgrade, lock/cache deletion, transitive-edge rewrite or PackageManager operation is indicated. Root owns any future source/report admission change; original raw receipts stay preserved.

Full source, disk, bundled package, tool and historical observation pins are in `PINS.json` (SHA-256 `637e70661a423650110f4a598fd454f0137a436632a029c92e5d6a132c25667e`).
