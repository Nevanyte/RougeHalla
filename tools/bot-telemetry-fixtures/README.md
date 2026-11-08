# Bot telemetry RunRecord witness (P-BOTS-6 telemetry remainder)

Captures ONE REAL docs/TELEMETRY.md RunRecord (schema v1) from the unmodified legacy recorder, driven through the real
telemetry runtime and file sink in the pinned linux/amd64 Node 22.23.4 container. This is evidence for the scoping
decision in docs/evidence/stage2-bots-telemetry/SCOPED_PLAN.md: the capture is feasible and honest; porting the record's
VALUES to the Rust runner needs producer work outside this packet's write scope.

## What it captures

The declared scenario in capture.mts: a hand-built open 60x40 floor (the source telemetry rig's map shape), the declared
sim config and seed 11, two human players (fire/frost), one scripted hit that opens the p0/p1 duel, one killing blow, and
one stat chest whose offer p0 picks. The recorder is installed by TelemetryRuntime.attach; the record is finalized by
RunTelemetry.finalize and submitted through createSyncFileSink, the real NDJSON file path. The record is then read back
from the sink's line, checked to equal the sink's serialization of the returned record, and validated with the source
validateRunRecord (null = valid).

Normalization is declared and minimal: only the random runId (a fixed UUID) is replaced; the runtime's clock is a declared
constant (1_700_000_000_000), so the epoch fields are deterministic and are NOT normalized. recapture with --check is
byte-identical.

The fixture (parity/telemetry/run-record.json) keeps:
- the exact normalized NDJSON line (recordLine) in the sink's serialization order,
- the parsed record,
- the declared scenario, normalized fields, schema version, the 14 hashed source files and the tool hash, so every
  field's provenance is pinned.

## Commands

    tools/bot-telemetry-fixtures/capture.sh            # write parity/telemetry/run-record.json
    tools/bot-telemetry-fixtures/capture.sh --check    # byte-identical recapture/compare

RH_TELEMETRY_OUTPUT selects another output directory. The repository is mounted read-only and npm ci uses the lockfile
in a temporary node_modules mount; nothing is written outside the declared output and the container's /tmp.

## Variant matrix (additive corpus)

capture-matrix.mts (same pinned container, same declared-clock technique) produces 11 additional REAL source records in
parity/telemetry/run-record-matrix.json, additively; the base record file is left byte-identical. Coverage:
- bot-client-net: a bot PlayerRecord with tier/persona, one client perf sample, drops/reconnects, build.commit null;
- death-terrain-sudden: DeathCause terrain and suddenDeath kinds, firstBlood;
- death-quit: a mid-run leave, DeathCause quit / PlayerOutcome mia;
- draw-both-down: the run ends in a draw with both players down in one tick;
- void-null-nullables: end void, outcomes alive, null firstBlood/death/pids, and a duel closed by runEnd with comeback null;
- abandoned-end: end abandoned;
- long-run-snapshots-tiles-afk: four power snapshots, dense 1 Hz tiles, afk/afkMs true, truncated.samples;
- offers-truncated / duels-truncated: truncated.offers / truncated.duels at the recorder caps, with full arrays;
- planning-mia: planningMia counted from a planning leave;
- win-bonus-opponents: winBonusWithheld true with winBonusWhy opponents (the base record covers starters).

Three variants cannot be produced from the unmodified recorder in this bounded harness and are DOCUMENTED in the corpus
blockers instead of approximated: mob/zombie death causes (need a live regional-mob / Plague-zombie roster arena),
non-empty camps and truncated.camps (need a generated camp arena with credited mob kills), and truncated.tiles (needs a
record over the 512 KiB cap so the sink retries without tiles).

## Shape-only Rust slice (fixture consumer, no producer wiring yet)

The same branch also carries the record SHAPE as a Rust type surface in crates/rh-headless/src/telemetry_record.rs: every
RunRecord/PlayerRecord/duel/offer/camp field in the captured serializer order, the null-vs-absent optional distinction,
JSON-number representation preserved (JsNumber) and by-name map insertion order preserved (OrderedMap). Its parity test
deserializes EVERY captured source NDJSON line (base + all matrix variants) and re-serializes it byte-identically; negative
controls require required/required-nullable fields, keep absent optionals absent, and detect an added/reordered field
(the committed field-order mutant experiment fails the parity test). This is deliberately a FIXTURE-CONSUMER TYPE SURFACE pending
the lead's producer-wiring decision (follow-ups A/B in the SCOPED_PLAN): no runner path fills or emits a RunRecord, no
value is fabricated, and the reduced printed report, --json payloads and the existing telemetry writer are untouched.

## Not in this packet

The Rust runner still writes the reduced per-game summary through its existing error-propagating telemetry writer, and
the printed report/--json payloads are unchanged. The field-by-field port plan, producer map and blockers are in
docs/evidence/stage2-bots-telemetry/SCOPED_PLAN.md.
