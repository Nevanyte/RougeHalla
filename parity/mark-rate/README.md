# `parity/mark-rate` — pinned actual-source Gathering Storm / MarkRate witness

`runtime.json` — `rh-mark-rate-source/1`, 8 cases, 82,049 bytes, SHA256
`b55227988496ab01717cbf08c26ee56750cb05db544f28a81272f25116847954`, captured by
`tools/mark-rate-fixtures/capture.mts` in the pinned linux/amd64 Node 22.23.4 container from the unmodified source.

Declared profile: player-only/no-mobs full-player faction world (`config.mobs:false`, `modules.signatures:true`),
generated map seed 1 attempt 0; one Sentenced seat and one Frost seat; real `grantCard` cards (Gathering Storm, Iron
Will, Haste II, Swift Judgment after its Haste base, No Commutation) and ordinary validated target/attack/swap inputs;
the training-clear-history case uses the real Train Clear command. No expected Mark progress/chill/tier/damage is
installed. Cases: neutral-rate, gathering-storm, mid-mark-grant, frost-resisted, frost-deepened, tier-flags,
opponent-card-control and training-clear-history. Frames record actual source public facts and private Mark/chill/tier/
counter state.

Provenance records the image/platform/Node, capture tool hashes, package-lock hash, the recorded profile/config/modules
and all 127 imported source-file hashes. `bash tools/mark-rate-fixtures/capture.sh --check` re-runs the bounded source
capture and requires identical bytes. Native consumer: `crates/rh-sim/src/systems/sentenced/mark_rate_source_tests.rs`.
