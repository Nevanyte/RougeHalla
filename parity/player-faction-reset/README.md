# Base-player faction lifecycle source companion

Five unchanged-TypeScript worlds cover Holy, Fire, Plague, Frost and Sentenced through actual raid start, weapon combat,
ordinary timer teleport, retained heal lockout, continuing combat and actual run end. Each world uses the declared
`signatures` installer profile. This is a bounded base-player domain: cards, once-trigger/HoT rows, NPC signatures,
grouped NPC Marks and training remain prerequisites and are not seeded or normalized.

`source.json` is `rh-player-faction-reset-source/1`: 5 cases, 1,146 ordinary 50ms steps. Its SHA-256 is
`3ea819614fc9b1141a8a1abafded6966e6a2a91f8ca4d4027fb4ea6c04940d3a`.
Capture and fresh byte comparison both ran in the pinned Node 22.23.4 linux/amd64 container. `INPUT_SHA256.json`
pins the complete original 132-file source inventory, original seven-file Wish harness, frozen 63-case corpus and
all six companion harness files. Neither legacy gameplay nor original source corpora changed.

Run `bash tools/player-faction-reset-fixtures/capture.sh --check` from the repository. Native comparison is
`cargo test -p rh-sim --lib all_five_player_lifecycle_source_witnesses --features trusted-status-probes`.
The consumer constructs actual worlds from declared setup and drives validated inputs and ordinary steps. Expected
snapshots are assertions only. Declared post-teleport position helpers and two calls to the actual source heal helper
are explicitly trusted fixture setup/probes; there is no public healing command or mid-step checkpoint API.

Captured reset-hook snapshots assert source transitions without seeding native state. Ordinary boundaries compare
private engagement/contact/combat/AP-history/Mark/chill/DoT state, the delayed signature-hit flushes, public faction
mirrors, health/credits, complete weapon/motion/path/history state, arena clocks, Wish state and RNG. The source
`seenAction` pointer is implemented through the native weapon/scratch owner, not a duplicate persistent pointer;
full weapon state and post-reset continuation are compared. `engagedOn` is source auxiliary metadata for unavailable
card producers, not a native producer admission. HoTs/fired rows remain source-absent in this profile. Captured
constructor/module/card scaffolding outside those owned fields is retained as oracle context, not claimed consumed.

Sentenced has a genuine kill before teleport, retains sentence, clears its old Mark and earns a fresh Mark afterward.
Frost produces and resets real chill, then chills again. Holy continues real sustain. Fire and Plague reset nonempty
old DoT windows, produce new windows and flush nonempty accumulated damage at run end. Teleport retains combatAt;
an immediate ordinary heal yields zero, then the same helper heals after the actual three-second lockout. Run end
flushes DoT presentation state and preserves private signature state.
