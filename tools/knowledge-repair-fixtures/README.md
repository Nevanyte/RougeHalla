# Knowledge repair witness (P-BOTS-1 remainder repair)

Captures, from the unmodified legacy brain in the pinned linux/amd64 Node 22.23.4 container, the three source facts the
repair packet fixes:

1. **Knowledge wiring**: the derive function text is extracted from `packages/server/src/bots/brain/brain.ts` and
   evaluated as a read-only probe; the tag-3 literal is read from the actual knowledgeRng wiring line (line 146 at this
   revision, created at 147); for declared seeds it records the source-derived tag-3 seed, the source stream's first
   draws, and the Knowledge layer the wiring creates (wheels, mob shares, one odds row) against the layer the decision
   stream would wrongly create. The packet's tag3 vectors (seed 0 -> 3971731199, 1 -> 197380189, 7 -> 2057029952,
   42 -> 3268108958, 4294967295 -> 1587572149) are asserted against the extracted source derive during capture.
2. **Diagnostics**: `Knowledge.odds` why strings at exact `toFixed(2)` half ties (lead terms and tint scores of
   0.125/0.375/1.625 and their negatives), where JavaScript rounds away from zero and the Rust formatter would not.
3. **Fair-view probe**: `detectFeatures` with an explicit `player: null` and with no player instance, matching the
   source `probe.player ?? firstPlayer(state)` (the state players are a real Map in the capture; the corpus declares
   the first player in the Rust probe model's shape).

Only the pinned official image is accepted (digest in `capture.sh`); the repository is mounted read-only and npm ci uses
the lockfile in a temporary node_modules mount. Expected values are actual source outputs, never computed from Rust.
This corpus is additive: it is a new file, and the existing Knowledge/perception fixtures are untouched.

## Capture and check

```sh
tools/knowledge-repair-fixtures/capture.sh            # write parity/policy/bot-knowledge-repair.json
tools/knowledge-repair-fixtures/capture.sh --check    # one canonical recapture/compare
```

`RH_KNOWLEDGE_REPAIR_OUTPUT` selects another output directory.

Rust validation: `cargo test -p rh-policy --lib --all-features knowledge_repair` (the wiring/derive, half-tie
diagnostic and explicit-null tests, plus the seat-level reset regression in `bots::bot`).

## Mutants

```sh
CARGO=... tools/knowledge-repair-fixtures/run-mutants.sh
```

The focused mutants restore the old decision-stream wiring, the Rust `{:.2}` diagnostic formatting and the Some(Null)
player handling; each must make the parity/seat tests fail semantically, and the unchanged control must pass.
