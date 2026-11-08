# Original-source hazard module witness

`capture.sh` runs the original `packages/server/src/bots/brain/modules/hazards.ts` exports in pinned Node22.23.4
linux/amd64, with a read-only checkout and disposable npm tmpfs. Contexts are declared public map/owner and remembered
policy goal/stillness/engagement inputs. The existing seed1 static map is reused, not regenerated; a deterministic clear
area is painted with declared floor terrain. Synthetic painted map metadata carries legacyMapHashU32=0, not the original oracle hash. This is helper/FSM parity, not whole-brain or simulation outcome parity.

`capture.mts` records 75 classifications,28 FSM steps and20 adjustments. Provenance pins the shared+brain TS files,
package-lock/manifests/tsconfigs/static map and all four tool files; captureSha256 includes profile and excludes itself.
Run `bash tools/bot-hazards-fixtures/capture.sh --check` for exact bytes.

`RH_BOT_HAZARDS_MUTANT_OUTPUT=/absolute/external/dir bash tools/bot-hazards-fixtures/run-mutants.sh` copies source to
container `/tmp`; the host checkout stays read-only. Three actual compiled source mutations (249ms still threshold,
1499ms hold, lost bog-risk classification) must change step/adjustment results at the required semantic category.
Compile/import/capture errors abort. Comparator excludes profile/captureSha256; a provenance-only mutation must compare
semantically equal, and the restored source must pass. Raw mutant files are evidence outputs, not replacement goldens.
