# Training console validation

## Verified

The managed .NET suite passed **777/777, 0 skipped** in the recorded `net-tests` TRX. The run includes the Train wire-shape/decoder tests, all five command encodings, options cloning and ordering across flushes, refusal of only invalid command bytes or more than three options, and cancellation of a queued Train across a fresh Welcome. The current managed and Unity-mirror `InputSender.cs` files are byte-identical (SHA-256 `52913b46d4bcc6884cf43a82b0780663cfe42fdfe6d5b0bf2102741d8cfc61ac`). The sealed run output is in `docs/evidence/unity-training-console/net-tests-invocation2.stdout.txt`; its TRX is `docs/evidence/unity-training-console/net-tests/net-tests-first.trx`.

A standalone Roslyn compile (not a Unity Editor compile) passed the Editor, EditMode test, and WebGL Player assembly scopes with zero errors. The EditMode test source was included in that compile at SHA-256 `b7c190585813a1d4ffb564c0a747dd43fc878029844b95850e0ca5de506144f3`. Managed UI source and test compilation does not mean the Editor tests ran. The earlier compile receipt used `TrainingConsoleView.cs` SHA-256 `b0de11cc888ccc53b6266f84722987859b03915851ca7bb93461ce1e593699b0`; the current source is `54fc30f34bfd04040bb310ce2ad90ae869821ecdbd7374d4be16825b6e23e4906` after the focus-preservation correction. The final affected-source receipt at `docs/evidence/unity-training-console/final-focus-compile/COMPILE_RECEIPT.json` now confirms this final hash compiled for Editor Client, Editor test assembly and WebGL Player Client with zero errors (35, 1 and 35 recorded warnings). Unchanged Net and Editor-helper source retains its earlier successful compile receipts; the managed suite was not repeated for this UI-only focus correction.

The pre-settlement-lease protected-source receipt records `previous42SourceAndMetaUnchanged`, `sharedOwnerFilesUnchanged`, and `editorWorktreeCleanExactFrozen4` as true. It covers 20 protected files and is preserved at `docs/evidence/unity-training-console/protected-source.json`. Its clean Frozen4 observation is historical: the coordinator subsequently assigned the sole Editor to its settlement worker. This leaf did not inspect or switch that checkout during that lease.

## Failed attempts retained

The first `dotnet`-on-PATH invocation stopped before tests because `dotnet` was not found (exit 127); no tests ran in that attempt. The successful run used the explicit SDK path and produced the 777-pass TRX.

An initial standalone compiler attempt failed on two existing `HubAtriumView.cs` `Color32`/`Color` conditional-expression errors. A later broad Editor-source glob failed because it included `Assets/Editor/WishProof/WishProof.cs` without its Input System references. These were compiler-selection/setup failures, not fixes to those source files. The corrected asmdef-scoped source compilation passed; all raw receipts and logs remain under `docs/evidence/unity-training-console/`. Compiled DLLs are retained only in the external work directory, with their hashes recorded in the receipts.

## Not verified

No Unity Editor test execution, runtime UI/layout interaction, screenshot, Play session, server behavior, browser/WebGL build, or gameplay validation was performed for this console. The newly compiled Editor tests are still awaiting the coordinator’s Unity test run. The 777 managed tests do not cover Unity rendering or the console’s actual pointer/keyboard behavior.

The shared-HUD integration patch is intentionally unapplied. New source files have no newly generated Unity `.meta` files because no import was authorized in this source-only lease; the coordinator must include their import/metadata in the later coherent native batch.
