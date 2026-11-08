# Repaired account adapter: actual Unity Editor gate

**PASS: four actual Editor tests, four passed, zero failed/skipped.** This is the requested bounded JsonUtility/PlayerPrefs gate, not browser, HTTP UI, gameplay, Web build or full account-flow acceptance.

Base: `df0d7bb82bd681747d94a985df6cf5083a8e577f`. The isolated branch `codex/account-f993-editor-proof` composes only adapter `54ca4a69db78cd3a802996e9bc1ad030eecc3ee7` and repair `f993dcdce5dd996d8927315da7db0369d3f1ae1d`. The tested composed source is `9011136dca847da33f24bf32765032ed2e2b2285`. All 21 adapter files match the released f993 manifest exactly. Main's already-admitted native account proof was not cherry-picked or rerun. Art commits `bff5e014`/`5769e273` and external drafts remain separately preserved.

The existing Unity **6000.0.85f2** Editor, PID **9075**, Pipeline **7800**, was reused at `/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject`. No new Editor was launched. Play mode remained stopped; no Web build, server, gameplay campaign or shared UI wiring was performed. The source switch held auto-refresh temporarily, then released it and refreshed synchronously. The Editor reloaded the account assemblies; the subsequent explicit recompile reported up-to-date with no compilation errors.

## Exact results

| Test | Verified behavior | Result |
|---|---|---|
| `ActualUnityJsonDecoderReadsTheRustEnvelopeAndSummaryWithoutClaimingFullProfile` | Actual JsonUtility reads the known profile name/GV/lifetime/stat counters, created flag and fixture ownership credential. This summary DTO does not claim the omitted full-profile maps. | PASS |
| `OmittedCountersRetainInvalidSentinelsInsteadOfBecomingPlausibleZeros` | Omitted GV, lifetime GV and wins retain `-1`, rather than plausible zero counters. | PASS |
| `InvalidJsonIsNotAnOwnedReply` | Malformed and null JSON decode to null. | PASS |
| `PlayerPrefsCredentialKeysSeparateNormalizedApiPrefixesAndCaseFoldedAsciiNames` | Actual PlayerPrefs writes/reads the test's random API namespace, handles ASCII name case, isolates another prefix and deletes only that random test key in `finally`. | PASS |

Invocation: `unity command test run --mode editor --filter-type testName --filter AccountTransportEditModeTests --async-tests false --timeout 60`, targeted to the existing project with `--caller plugin --skill unity-cli --format json`. The raw [test result](editmode.json) lists the four actual cases and durations. No stub/reference-only execution substitutes for these results.

## Source and console receipts

- [Receipt](receipt.json): immutable source identities, 21 exact adapter hashes, result and limits.
- [Project source manifest](source-manifest.json): 489 tracked Unity Assets/Packages/ProjectSettings files as tested.
- [Compile state](compile.json), [recompile request](recompile-start.json), [compile console](compile-console.json).
- [Test console](test-console.json): zero errors/warnings after clearing the compile buffer; six ordinary test-run log entries.
- `bash client-unity/sync-net.sh --check`: PASS. The new Unity network copies match canonical C# source.

Compilation produced nine warning **entries** from existing presentation/test code: deprecated APIs and one unused test event, with some duplicated/clipped Pipeline entries. There were no compilation errors or account-adapter warnings. The raw warning entries are preserved; a clean test console does not erase that compile result.

Unity serialized trailing spaces on `m_Name` and `m_EditorClassIdentifier` in ShaderGraphSettings. The [overlay](serialization-overlay.json) and [actual serialized bytes](as-built-shader-settings.asset) preserve the tested form. Normalized line content is identical to source; the file was restored byte-for-byte afterward. No adapter source or metadata changed during the run.

## Remaining gates

Real WebGL Fetch/CORS/reload persistence, HTTP/account/menu/Join wiring, lifecycle/OnDisable/lost-response behavior, full profile dictionaries and broader account flows remain separate. This gate does not expand API or protocol authority and does not edit shared Bootstrap, MatchClient, MatchHud, migration status or Cargo.lock.
