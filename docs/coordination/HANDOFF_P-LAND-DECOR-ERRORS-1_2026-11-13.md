# Hand-off: P-LAND-DECOR-ERRORS-1 (a guard test: no attempt errors with landmarks and decor on)

```
PACKET:          P-LAND-DECOR-ERRORS-1 — not in ORDER_OF_OPERATIONS: serves note 2 of the coordinator's reviewer-opus
                 pass on P-LAND-SENTENCED-1 (2026-11-13): "a gate test in your lane (a new file, not the oracle) that
                 runs every attempt of seeds 1-32 with decor on and fails on any generation error"
BRANCH:          packet/P-LAND-DECOR-ERRORS-1 (test and brief @ d2692ba8f, the gated commit; this hand-off and the
                 brief's measured line are one docs-only commit on top), from feature/unity-rework @ 2e51457dd.
                 Worktree /Users/nevinmckinnon/Documents/Projects/RH-landgen. Local only, not pushed. No agent branch:
                 the packet is the test.
GATE:            PASS (full) on d2692ba8f, attempt 1/2 [skipped: Postgres suites, no DATABASE_URL]; 254 test binaries
                 ok, none failed; EditMode 930 of 930
CHANGED:         crates/rh-sim/tests/mapgen_land_decor_attempts.rs (new); docs/backlog/packets/P-LAND-DECOR-ERRORS-1.md
                 (new); this file
D-RULES:         none: a test only. No map, sim, wire, save, state-hash or content-hash change.
DEVIATIONS:      none
SHARED RECORDS:  proposed edits: docs/backlog/README.md (a row for the packet); docs/MIGRATION.md checkpoint
LEGACY DOUBTS:   none
NOT ESTABLISHED: Seeds 1-32 only. The test proves that no attempt returned Err on this tree; it does not prove that
                 every styler's props step ran on every refused attempt (an attempt refused before the stylers never
                 reaches them).
RISKS:           One more generator sweep in the rh-sim suite: 29.8 s in this gate run on a shared machine.
```

## What the test does
`no_attempt_of_seeds_1_to_32_stops_with_a_generation_error_with_decor_on`: with `pipeline::Options::signature` on and
decor on (the default, what the server's pool uses), every attempt of seeds 1 to 32 up to the one that makes the map
must answer `Ok`; an `Err` fails the test, as does a seed with no map within 16 attempts. Refused attempts are legal.
It pins no map, hash, attempt number or refusal count.

Measured on `2e51457dd`: 59 attempts, 27 refused, no error, every seed made (on the lanes branch before the cave:
41 attempts, 9 refused).

## Relation to P-MAPGEN-STYLE-REFUSE-1
That packet's oracle (`crates/rh-sim/tests/mapgen_style_refusal.rs`, on `packet/P-MAPGEN-STYLE-REFUSE-1`) holds a guard
of the same shape for decor off and on, written without sight of this file. Both are kept: this one is the reviewer's
note as asked and has no dependency on that packet; if you would rather have one sweep, drop this packet and say so.

## git diff --stat feature/unity-rework (before this file)
```
 crates/rh-sim/tests/mapgen_land_decor_attempts.rs | 71 +++++++++++++++++++++++
 docs/backlog/packets/P-LAND-DECOR-ERRORS-1.md     | 69 ++++++++++++++++++++++
 2 files changed, 140 insertions(+)
```
