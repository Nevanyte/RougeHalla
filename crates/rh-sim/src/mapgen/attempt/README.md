# P-MAP-1 M3a: actual attempt prefix through fixed ground

`begin_attempt(&AttemptContext, seed, attempt)` implements stages 1–3 of the real TypeScript generator and returns
`Result<Option<AttemptFrame>, AttemptInputError>`. `None` means the prefix failed; `Some` is an intermediate frame,
not a finished map. Seed and attempt metadata use the canonical DTO's signed/nonnegative JavaScript-safe integer
domains. The intermediate frame owns its advanced `Mulberry32` and all mutable arrays; no shared scratch or clock,
entropy, I/O or gameplay-private random stream is introduced.

The prefix preserves:

1. Binary64 `seed + attempt * 0x9e3779b1` before JavaScript ToUint32, with attempt zero using seed directly.
2. Pillar choice followed by the real Fisher-Yates draw order over faction order.
3. Four layout rounds on that same stream: partition failure ends the attempt immediately; camp failure alone redraws
   zones. Seed 17 exercises this distinction and reaches stage 3 on its second layout round.
4. Fixed border, selected pillars and coliseum walls, then open gates; exact ordered camp clearing indices and StyleCamp
   views. Clearing cells are recorded here, not prematurely floored (the real safety net does that at stage 7).

`AttemptContext::from_definitions` rebuilds a matching parent ZoneContext and uses the supplied camp definition for
CampContext construction. The existing parent clearing offsets and camp-radius getters supply both clearing geometry
and StyleCamp radii; these rule values are not redeclared. `AttemptDefinition` contains only the two newly owned values,
layout tries and the binary64 retry seed stride. `visit_content` emits their declaration-ordered words without allocation.

`AttemptState` retains internal zone labels, CampSite order and 1-based territory IDs. Camp spots remain empty.
`AttemptFrame.rng` is the actual stream after the prefix; later stages must continue it rather than reconstruct/reseed it.
No faction canonicalization or `records()` work happens here. The private assembler accepts an observational callback
so tests compare each actual failed/successful partition and camp boundary; production uses the same code with a no-op.

The oracle `tools/map-fixtures/attempt-frame.ts` reads the actual `packages/shared/src/mapgen.ts` into a temporary module.
It preserves consumer statements and dependencies, aliases the real RNG constructor for read-only word observations,
adds explicit exports of the private build entry/layout bound, and inserts taps at existing partition/camp/stage-3 lines.
Relative import specifiers become absolute URLs to the original source modules. No package file is written. Every tap
copies immediately: retaining live references would let stage 8 and records overwrite the supposedly earlier capture.
Before writing any fixture, the tool requires the complete final map/null and actual mapHash to equal an unmodified real
`tryAttempt` invocation. This observer check applies both to plain invocations (landmarks/bushes retained) and a styled
invocation. Capture-source SHA256, pinned Linux x64 Node 22.23.4 provenance and the actual layout bound are recorded.

Fourteen complete-prefix cases include seed 17, two more real camp failures/redraws, explicit attempt 1, negative/wide
seeds, a wider-than-u32 attempt, maximum safe metadata and binary64 arithmetic beyond the safe-integer range. Tests
compare every frame cell/view, every failed-round partition/camp result, exact uncoerced initial-number bits, consumed RNG
words and eight continuation words. Additional actual JavaScript coercion vectors cover fractions, wrap boundaries,
signed zero and nonfinite numbers. Rule mutation tests exercise the live definitions, four exhausted layout rounds,
immediate partition failure and shared custom geometry. Parameterized failure-boundary tests are not claimed as failed
map seeds; captured ordinary cases recover from camp failure. Captured final hashes validate the observer only—they do
not establish a Rust finished-map hash or PINNED_PLAIN parity.

Pinned generation/check: `node --import tsx tools/map-fixtures/attempt-frame.ts [--check]` on Linux x64 Node 22.23.4.
The fixture is `mapgen/fixtures/attempt-frame.json`. Only this leaf, its tool and its fixture are worker-owned; the
coordinator owns the parent module hook/content fold. Landmarks, spawn pools, stylers, nets, loot, repair, records,
full validation/certification and finished-map pin parity remain later work.
