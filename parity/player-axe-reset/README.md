# Actual Axe/Shred lifecycle companion

One unchanged-TypeScript base Fire player world reuses the accepted player lifecycle constructor, declared setup and
ordinary actions, changing only the declared weapon to Axe. The actual hit callback creates Shred and refolds the
armor mirror. Ordinary timer teleport clears the status but retains the source-timed cached armorBonus (-60), then
real continued Axe combat produces new Shred. No cache/status/clock/expected-state injection is used.

The pinned Node22.23.4 linux/amd64 capture contains one case / 229 ordinary 50ms steps. SHA-256:
`3c412bcf4520f6fc73a9ae48e7a33fc1de632c6ea205b380f66740eae2623af0`.
Capture and fresh byte comparison pass. `INPUT_SHA256.json` verifies all132 unchanged original source files, the
original seven-file Wish harness/corpus, the accepted six-file player lifecycle harness and immutable five-case
lifecycle corpus, plus all five files of this focused adapter. The original five cases were not recaptured.

Run `bash tools/player-axe-reset-fixtures/capture.sh --check`. Native test:
`cargo test -p rh-sim --lib genuine_axe_shred_reset_and_continuation --features trusted-status-probes`.
The native consumer compares the complete existing lifecycle assertions plus exact armorBonus wire values and status
instances, restoring each captured ordinary frame. It explicitly checks a cleared-status/nonidentity-cache teleport
checkpoint and rejects impossible folded values, out-of-range armor and fractional wire values through the canonical
modifier owner validator. It never recomputes a fresh cache during restore. Neutral Build/Farm and existing
NPC/card/training restrictions remain unchanged.
