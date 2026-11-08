# Frost source continuation on frozen protocol 13

This isolated integration composes reviewed candidate `e38d16c30cde16bddfa7eef038076527fdabf433` onto exact frozen
`1310ae002870bf3fc674c7b65f38ff5ea55a7d75`. It is a future checkpoint26/replay20 candidate, not a modification to the
frozen protocol13/checkpoint25/replay19 browser milestone. See README.md and proof.json for the original candidate's
source/allocation/mutant/serialized-leaf evidence; integration.json records this composition's focused checks separately.

The sole textual merge conflict was checkpoint.rs after world validation. Resolution retains Frost source-Vec
preparation followed by the root's fresh TickScratch/reserve_actors. Root `9b364db7`'s retained-actor reserve inside
TickScratch::clone is preserved verbatim. The candidate's explicit Sim::clone additionally prepares both source list
capacity and the actual fighter count. The root's two no-submit restore/clone tests remain intact; their checkpoint25
literal is adapted to the exported format constant. The first focused run caught only that stale test literal; its
red log is retained separately. No gameplay/input warming was added to make either test pass.

Composition checks passed using final-env.sh followed by explicit private absolute CARGO_TARGET_DIR and RH_PGTEST_STATE
overrides (jobs2/debug0), never root final-target:

- Frost unit/source suite: 28 passed, with the allocator case selected separately below.
- Checkpoint6, no-submit actor scratch2, replay6 and Wish event-time5 passed.
- Actual source teleport/reset3 and private digest3 passed.
- Isolated warm allocator case passed: actual ten-NPC source workload, birth/restore/actual teleport reset, 100 warm
  plus20 measured steps per phase. All60 measured steps allocate zero blocks, active source list exceeds eight.
- New source bytecheck passed in the pinned container: eight cases, 940 ordinary frames plus ten helper observations,
  exact repeat and corpus SHA256 `9f5c1a4836ac6ea59b48883eb4beea44ceabfd53e08368cb704aeea26f159b12` unchanged.
- Strict all-target Clippy for rh-sim/rh-headless/rh-parity passed with default and all features; affected formatting
  and diff checks passed.

The original four semantic mutant executions and generic serialized-leaf gate belong to e38's recorded proof and
are not represented as newly rerun here. This composition adds no serialized leaf beyond that candidate. The five
strict source-born Wish cases and their pending profile inventory are unchanged; no Full/Sentenced gate is opened.
The draft P-SENTENCED-NPC-SOURCES is planning only and authorizes no implementation or version assignment.

Exact code delta from frozen root is the reviewed32-file Frost candidate plus the necessary existing scratch-test
format adaptation and this integration evidence. No existing source corpus, golden vector, content registration,
tape, shared status, Cargo.lock, public protocol/observation/policy/client or production Sentenced code is changed.
Final combined identity/content/tapes and admission remain coordinator work after review.
