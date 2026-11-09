# Unity functional 854a08f1 — independent review

Verdict: **RELEASE for the finite actual 42-case EditMode functional scope** at frozen source `0aeddc5b4ce0feb5fc0060f2cf2d56c05dff8944`, evidence seal `854a08f1d622e931eff40eba40ba3820cbe040da`. No blocking result, identity, selector or restoration defect found. This does not release a browser/Web/full-port milestone.

Static/source/artifact review only. No Unity, Cargo, build, test, capture, merge or repository mutation was performed. Recorded Editor observations below were read from retained receipts, not a newly queried Editor session.

## Seal and exact source

Read the actual Git tree under `docs/evidence/unity-functional-0aeddc5b/editor-first` in the primary repository. Verified 854 is a direct child of exact0aedd and adds only this evidence directory; prior failure evidence, production code and test sources are unchanged by the seal. Integration repository contains the same objects.

`MANIFEST.json` covers exactly all **50 payload files**, excluding itself. Every byte count/SHA256 matches the sealed Git blob; there are no missing or unlisted payloads. Manifest SHA256: `6b9a7fcffafcc1f6551002200534a57dc70fac529143d51f2902246e051705a6`.

Independently resolved all **1,153** `SOURCE_IDENTITY.frozen.json` pins against exact0aedd Git blobs, verifying bytes and SHA256. Frozen identity file SHA256 is `3059615e58dd3700d09bcc2a5bd744c1b2268994e7342ff9797de8d899136323`. Separately verified all **1,140** `evidence/as-tested-source.json` Unity inputs against exact0aedd, including recorded Git blob IDs, byte counts and SHA256. These are distinct enumerations, not an assumption that their counts should be equal.

Four fixture source/meta pairs match expected identities. The three fixtures comprising the old25 also match exact `fa0c0891` source bytes. Frozen selectors remain `32d8c1612e3c0c7672802f31859057e4b1a97678e4a9445081922045e7c220c9`.

## Actual results and binding

Independently parsed `discovered-cases.json`, `EXPECTED_SELECTORS.frozen.json`, the ledger and all four actual `evidence/tests-*.json` files. Confirmed exactly42 unique Runnable discovered leaves and exactly the same42 unique actual result names, each Passed with null failure message/stack; zero missing, extra, substituted, skipped, failed or inconclusive cases.

| Actual fixture | Passed | Recorded start UTC |
|---|---:|---|
| QuestJournalViewEditModeTests | 8/8 | 2026-11-09 11:41:11.874397 |
| TraderDialogViewEditModeTests | 6/6 | 2026-11-09 11:41:17.774671 |
| PlayerFlowsEditModeTests | 11/11 | 2026-11-09 11:41:22.881514 |
| MatchLaunchEditModeTests | 17/17 | 2026-11-09 11:41:29.590764 |

The ledger has one successful invocation per exact filter, matching the raw result summaries. The prior25 full names match exactly. All17 launch method/argument tuples bind one-to-one across14 methods; Boolean types/values and `Roguehalla.Net.MatchLaunchMode` enum type/name/numeric values were checked, including both wrong-delivery combinations and the two cancellation Boolean cases. The global MatchLaunch fixture is correctly distinct from the other fixtures' namespace.

Discovery uses the public TestRunner API and records `executedTests:false`. Its helper observes public NUnit metadata without calling test methods. The failed uniqueness assumption and initial IL observer formatting error were pre-execution orchestration/observation failures, retained separately; they are not failed functional runs or functional retries. No test assertions or selectors were weakened to obtain this result.

## Assembly identity nuance

The current imported production MatchClient and read-only own-method IL receipt agree on the single loaded Client assembly MVID **`17da474b-9a95-4b98-8af9-13124aff40e9`**, DLL SHA256 **`812b702a3c995d9f0daa838e023279adba2c811f3483e98ae40aff7b57de52dd`**, source GUID `dc5507f1996f942f3b34b0d1c46b89e0` and dependency hash `d3a07a2f6eaef05b36eb8fb35b800080`. The actual helper calls SetActive, branches on Application.isPlaying and selects DestroyImmediate/Destroy; both CloseCurrentSession and JoinCore call that helper. The observer reads CLR metadata/IL and file bytes; it invokes none of these methods.

All discovered test methods retain **`b78f3c03-15d1-4924-b90a-9fe89d2737f4`**. This does not invalidate the run: fixture bytes/GUIDs/attributes are unchanged and coordinator clarification explicitly permits the unchanged test MVID while requiring changed production identity and fresh loaded/source reads. A unique test MVID is not substituted for source binding. The retained failed observer is honestly a zero-operand formatting failure; its corrected observer changes formatting only.

Actual loaded Test Framework **1.6.0** versus locked **1.4.6** is disclosed. No causal explanation or package-lock correction is inferred from that difference.

## Cleanup and Frozen4 return

Sealed pre/post-run state records stopped, noncompiling, nonbackground Editor; one empty clean Main scene plus the preexisting one preview; the original InputSettings instance `-1029656`. Post-test native inventory has zero Light2D/EventSystem objects and no current EventSystem. Immediate post-run text preference0.85 is not hidden: the separate restoration receipt restores its original absent/default1 state. Session auto-tick is disabled and refresh guard released.

The sole recorded post-test source overlay is ShaderGraphSettings trailing spaces; observed bytes/patch are retained. Final composed restoration reports all1140 Unity inputs/all1153 coordinator pins exact, with no test/assertion changes, empty clean Main, original input instance and default preferences.

Return to Frozen4 happened after sealing and is **not one of 854's50 payloads**. Separately inspected the actual eight files in `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/functional-0aeddc5b-2026-11-09/return-evidence`. Their refresh/reload/final-idle receipts show successful stopped/ready return, guard released, auto-tick off, empty clean Main, unchanged original input/default preferences/background flags. At review the art repository is clean at exact **`5b7877f99805d6ef980577eda86a779ee4614d9f`**. This is a read-only Git observation plus separate retained Editor receipts, not an assertion that those external return artifacts are included in the sealed manifest.

External final-idle receipt SHA256: `780024e37edd9c580c1406144866d7807087992e59687774fe88096d11e51dab`; ready-after-reload SHA256: `dd1b6c2650886787e40d61b24e662868492cf7bf31b8099b5c3067e6f21db932`; final-refresh SHA256: `e6bfd25fda239343095b6c6309cc3a4137cde9d015e22dae9b4190c87ebebe91`.

No additional Editor rerun is required by this review. Browser rendering/input/account/banking, Web artifacts, live/server gameplay, art/audio integration and complete-port/performance acceptance remain separate gates.
