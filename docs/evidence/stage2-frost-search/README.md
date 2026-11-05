# Base-player Frost and scoped landmark search

Branch: `optimization_port`. The native M5 Pro workspace gate passed **602 tests, zero failures/filters and one intentional
ignored heap measurement**. Formatting and both all/default-feature workspace Clippy modes passed. Parity is **75 compared
scenarios, 13 capture-only and 300 path queries: all MATCH**. After the test-only sparse-fixture repair described below,
all 15 landmark tests, three ownership doctests and all-feature workspace Clippy passed again. No production search or
Frost code changed in that repair. The previous 80 canonical files remain unchanged; ten Frost traces bring the inventory
to 90. Full simulation, complete generator/certifier/pins, bots, client flows and release gates remain open.

## Frost simulation and observations

The explicit `EngagementHolyPlagueFireFrost` mode adds base-player rate, proximity and ranged movement chill together.
Off and the previous partial installations preserve their gameplay. All rules remain in Rust. This does not install
cards, build bonuses/resistance, elite passives, mobs, Fire roam or other auxiliary systems.

Previous-tick chill scales the existing weapon clocks, engagement cadence and Fire/Plague damage consumers, including
instant Backlash. The rate is evaluated as source `1 - 0.32`. An ephemeral actual-start marker preserves action identity:
carried new starts receive their correction exactly once; stretching an old Draw does not make it a new action. Draw
start/landing mirrors, ready/buffer clocks, multiplication order and stagger pauses remain source-exact.

Post-ledger Frost updates follow surviving engaged edges in both directions, deduplicate sources and take their minimum
rate. Proximity episodes, hold/thaw/reset clocks, thousandth-quantized movement, ranged refresh/expiry and the next-step
live-source distance check retain their separate source semantics. Ranged landed hits require surviving shooter/victim;
barrier, immunity, signature and melee exclusions are checked. Persistent source IDs and clocks are private, serialized,
validated against retained roster history and hash-covered. Observations expose existing chilled bits and legitimate
timing/movement consequences; they expose no source identities or episode history. Policies and headless use the same Sim.

Ten genuine ordinary-input traces compare **2,265 ticks**, restoring and continuing after every tick through ongoing
chilled Draws. One asymmetric trace establishes that an idle Frost outside its own reach can chill its ranged attacker
through the reverse engaged edge. Separate source proofs are explicitly labelled trusted/direct-helper setups:
**150 stretch probes, 13 thaw probes, 21 runtime cases and 15 ranged-ledger cases**. They do not masquerade as ordinary
intake. See [the reproduction commands and pinned manifest](../../../tools/frost-fixtures/README.md).

Independent review reproduced every canonical capture in its own Linux x64 Node 22.23.4 container and matched all three
proof files byte-for-byte. It adds **2,728 trusted/helper cases** across action identity, proximity/ranged/episode clocks,
stretch domains, engagement and mixed Fire/Plague production. Independent checkpoint, replay, hash, observation, policy,
headless, allocation, content and full parity checks passed. Eleven of twelve semantic mutants fail. Removing chilled
cadence division is equivalent within the legal power-zero domain: even the slowest supported cadence plus slack is
2834.267 ms, below the 3000 ms floor. The exact division remains in production; future card/slow domains must exercise
the branch beyond that floor rather than treating this bounded equivalence as full-game proof.

Review repaired an accidentally activated TELEPORTED hook row: it was a no-op for the wrong argument type but falsely
marked unrelated lifecycle work ported. The row is Pending again and regression-tested; only the intended ATTACK_STARTED
link is installed. Root's content scanner also caught ten initially standalone gameplay constants; all ten now live in
the single content registry. No gameplay-number exemption was added.

Warmed allocation evidence is **460 eight-player steps** with every retained observer/projector plus **710 Frost trace
steps**, all zero allocations. Result-bearing terminal steps retain the established exclusion. These are simulation
allocation measurements, not full-game frame-rate claims. The performance objective remains highest sustainable FPS on
the M5 Pro while preserving quality, with display limits measured separately.

## Exact landmark search and cache ownership

The new search leaf implements source-exact fit/SAT tables, candidate order, heap bounds, shortlist ties and guarded
attempts. It preserves IEEE NaN/infinity/signed-zero behavior, strict-less-than bound pruning and score calls even when
tries is zero. Cache invalidation checks feature count and box sum; success patches only occupied stamp cells and rebuilds
SAT rows from the affected row. Refused attempts retain real runtime budget history. Planning hard/open views and memo
lifetimes remain separate from the original placement transaction.

A non-cloneable scoped session exclusively borrows one runtime and fixed planning policy. Score/bound callbacks see only
immutable runtime and scratch-stamp borrows; caller-local memoization and counters can still be mutable. Foreign cache
attachment and mutable runtime access are excluded by the API. Explicit reservation/policy changes require reset; weak
source checksums are not presented as detecting same-sum edits. Private test-only read-view transfers exercise mutations
that production ownership prevents.

Five genuine source attempts capture **22 searches, 19,744 bound calls, 7,040 score calls and 189 guarded attempts**, with
complete callback arguments/results, candidate/table/shortlist traces, surrounding placements and runtime snapshots.
Actual cases include Gallows first-success/second-cache reuse and pruning, Scorch fresh planning views with a failed margin
retry, and Rime's genuine seed-176 fallback after prior refusals consumed eight join checks. The oracle verifies complete
map/null and hash equality against the unmodified generator before saving observations. Thirty labelled direct-helper
streams cover numeric boundaries, cache/reset/sum behavior, sparse holes, memoization and failed-attempt budget controls.
No faction scoring recipe is copied into Rust: tests replay recorded callback results as exact IEEE bits.

Independent review reproduced the final **18,896,660-byte** fixture exactly (SHA-256
`e22c6bf43c6943cf78c547364d47a7bcdd345ffd06a9482ef2cb0a9177fc5188`), added five actual-source replays (21 searches, 20,196 bounds, 5,598 scores and 67 attempts), and checked mutable
FnMut/memo positive controls. Negative examples fail for the intended private-field, mutability or escaping-borrow
reasons. All fifteen required behavior mutations and two additional signed-zero mutations are detected after repairing one test gap: the case named sparse
success originally failed its sole placement and never patched anything. It now selects an actual successful interior
stamp and asserts both underscore holes stay eligible in both wall/floor tables. The identical bbox-zeroing mutant now
fails; production patch logic was already correct.

Search is independently scoped from faction recipes and Rime's local scanner. Full stage orchestration, plain/styled pins,
generator and certifier remain open. `PINNED_PLAIN` continues to require real landmarks and bushes.

## Identity and reproduction

Current content: `30c9741ffc6abb77`; checkpoint /13, replay /11, observation 10, policy 7 and wire 5. Both runtime search
words (default tries 12, origin stride 2), all Frost constants and boundary probes of the actual Frost timing/thaw formulas
drive content identity. All 20 content tests pass. Protocol 5 still intentionally omits signature effects/bits. Unity,
protocol definitions, package source, dependencies, cloud resources, DNS and production services are unchanged.

Use the pinned Rust toolchain, disposable PostgreSQL 16 and Linux x64 Node 22.23.4. Run the workspace all-feature tests,
formatting, both Clippy modes, parity report, the three byte-compared Frost proof tools and
`node --import tsx tools/map-fixtures/landmark-search.ts --check`. CI includes these source oracles. Sol 6.1/medium workers
implemented both packets; independent Sol 6.1/high reviews follow the recorded fallback after Astra capacity failures.

The original Rust CI at `485c6f9e` failed the lease proof's clock-progress assertion. Test-only diagnostic follow-up
`c5e016ef` passed Rust CI `42070970303`; production timing was unchanged. See the
[diagnostic evidence](../stage2-leases/ci-progress-probe.md). The original cause remains unproven.
