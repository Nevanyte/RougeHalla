# Private future Frost NPC source candidate

Base: `8cd510752ddab9e30b210efce85ca5faced8bbbd`. Packet: `138a10de`,
`docs/coordination/P-FROST-NPC-SOURCES.md`. This isolated candidate uses checkpoint 26 / replay 20. It does not
change the current protocol-13 / checkpoint-25 / replay-19 milestone, public observations, policy, content registry,
hash tapes, existing source corpora, dependencies or shared status records.

## Implemented boundary

Frost source history is one ordered-unique retained `Vec<PlayerId>` per actor. The reserve is eight player seats plus
the actual Frost map camp spot count, or eight plus the twelve-live-practice limit in training. There is no invented
per-camp or actor cap. Only player and typed Frost camp/practice actors can contribute. Returning NPCs cannot contribute
through either engagement direction. NPCs contribute base chill; shield/haste bonuses remain player-only. The instant
AttackStarted hook remains player-only. Existing victim resistance, hook order and cached movement behavior remain intact.

Restore validates source length, uniqueness and retained actor origin, including bodies already removed. Player source
history uses the known-player namespace; it does not invent immutable birth-faction history or reconstruct today's
engagement graph. Dummy/zombie/non-Frost NPC source identities are refused. Empty history is the empty list; the removed
count field and predecessor format are refused. Values, length and order are state-hashed and privately fingerprinted;
spare capacity is derived. Birth, restore, clone, teleport, nonstanding and raid-reset paths retain/prepare storage.

Only the existing Frost PvE engagement level gains typed Frost camps. Sentenced NPC and Full PvE admission remain held.
Existing training choices are preserved; this is not admission of the still-unported complete training Sentenced kernel.
The five strict full-signature-source-born Wish cases remain pending without expectation/profile changes.

## Evidence and limits

See [source.md](source.md) and the recorder README for the pinned actual-source input/output boundary. The new corpus
contains five runtime cases / 940 ordinary frames plus three helper cases / ten diagnostic observations. The ten-spot
runtime reaches ten NPC source IDs at source tick 20 / 1000ms using normal AI and validated commands. Native comparison
checks every runtime frame, ordered Frost history, existing strict typed actor/gear/Mark binding, damage/events/timing
and reward RNG continuation. Every next ordinary native step is compared between the uninterrupted session and a freshly
restored copy. Declared placement/HP/card setup is not a claim that a ReplayInput trace acquires that setup.

Helper mode/engagement/clock operations are explicitly diagnostic and never install captured expected post-state. The
source untyped regional-grunt helper is adapted to a native typed practice recipient solely to compare Frost recipient
behavior; it makes no matching constructor/HP/AI/provenance/restore claim. The NPC modifier-mirror helper proves base
Frost arithmetic under positive encoded shield/haste, not a restore-valid NPC modifier producer. Reaped historical
signature rows are omitted only after both current source/native bodies are absent and retained native origin is checked.

Four independently compiled mutants fail semantic comparisons: truncation at eight (ordinary runtime), Return inclusion
(declared helper), applying player bonuses to an NPC (declared helper), and reversing first insertion (ordinary runtime).
The exact hunks, source/log hashes and restored control are recorded in `proof.json`.

The real supported workload exposed pre-existing allocations in mob contributor snapshot and wake selection. The approved
repair streams the identical present-player/positive-hit filter without an intervening hook, retains the wake order
buffer, and compacts the owned wake-request snapshot in place. Controls compare the previous first-camp/rank/tie algorithm,
duplicate/invalid/dead targets, world RNG, contributors and empty settlement buffers. No cap, truncation or shuffle change.
The final allocation gate strengthens the original three-NPC workload to the actual ten-NPC source case: birth, restore
and the actual teleport reset hook, 100 warm + 20 measured steps each, with an active list exceeding eight in every phase.
All 60 measured steps allocate zero blocks. This is a warm-allocation claim, not a frame-time/throughput benchmark.

Restore and clone also exposed a pre-existing actor scratch length-eight panic without any post-restore input. Actual
eight-player/three-basic-Fire-NPC checkpoint-25 repros and a separate portable patch were handed to the coordinator.
This future candidate prepares both actor scratch and retained source lists in restore/clone. The headless optional mob
type panic is fixed for real training dummies; the typed-NPC legacy fingerprint is unchanged by that sentinel repair.

## Focused checks

All commands use a private absolute target, jobs 2 / debug 0, and `--locked` where applicable. Exact log hashes/results
are in `proof.json`; raw logs and red allocation stacks are retained beside this isolated checkout.

- `bash tools/frost-source-fixtures/capture.sh --check`: two pinned runs, exact byte comparison.
- `cargo test -p rh-sim --lib systems::frost::tests --locked`: 28 passed, allocation test separately selected below.
- `cargo test -p rh-sim --lib signatures::teleport_tests --locked`: 3 passed.
- `cargo test -p rh-sim --test checkpoint --test replay --test wish_event_time --locked`: 6 + 6 + 5 passed.
- `cargo test -p rh-headless --test frost_sources_digest --locked`: 3 passed.
- `cargo test -p rh-sim --lib frost_sources_warm_alloc --locked -- --ignored --test-threads=1`: 1 passed.
- Generic serialized-leaf gate: 91,556 leaves, 62,907 hash-changing perturbations, zero unhashed; all six obsolete
  chiller/count exemptions removed. Later changes affect derived scratch/clone preparation and headless diagnostics,
  not this serialized schema.
- Affected `rh-sim`, `rh-headless`, `rh-parity` strict clippy, all targets, default and all features; affected formatting.

No full-map campaign or wider Full-faction acceptance is claimed. Final combined content registration/tapes and private
format admission remain coordinator work after independent review.
