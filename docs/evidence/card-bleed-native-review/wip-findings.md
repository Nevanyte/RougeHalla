# Card native WIP review findings

Root code review,2026-11-10 approximately08:57–09:00UTC, of the active `backend-card-bleed-feedback` worktree
based at `03ec330b`. This is an unsealed moving candidate, not a byte-pinned final review or a claim of executed
new regressions. Findings were delivered to the active DeepSeek worker; all implementation/tests remain its scope.

1. **Unproven clock grid:** `CardBleedReport::validate` rejects `since % TICK_MS !=0`, although the reader accepts
   lifecycle-Off fractional clocks and the report records actual `world.server_time`. The independently admitted NPC
   repair already has real accepted-clock producer trajectories. Require a real Card producer/restore continuation
   from such an accepted baseline, preserve its initial failure, and retain only proved generic clock invariants.
   A fixed-grid rejection test is not evidence that the producer invariant holds.
2. **Incomplete cold index reservation:** `CardBleedReport::prepare` reserves the full row bound but `rebuild_index`
   reserves only currently stored row count. `PairIndex::insert` then pushes new nodes during gameplay. Reserve full
   derived Q for both rows/index before the hot path and retain it across rebuild/Clone/restore. Allocation evidence
   must include first unseen pairs after preparation and expansion through the bounded domain, not only repeated keys.
   Keep inherited status/tag allocations separately disclosed.
3. **Capacity accounting:** the candidate applies the generic accepted-restore bound to pristine constructors too.
   This is conservative for capacity safety, but does not justify reporting the smaller approved provisional pristine
   Full8/player-only/training table. Implement only the proved pristine predicates or explicitly propose/measure the
   larger safe alternative. Never restrict generic restore admission or claim an unmeasured21.5675MiB footprint.
4. **Expected-answer filtering:** `compare_public_windows` filters actual public Hit rows by membership in the set of
   expected amounts before comparison, also selecting only named own-source rows. Extra wrong-valued emissions can
   disappear from the comparison. Require output-independent Card provenance/envelope accounting and comparison of
   every Card row, with a control that retains all expected rows and appends a wrong-valued extra row, which the actual
   comparator must reject. Keep genuine full-projector feeds and distinguish actual-source histories from synthetic
   privacy controls. No public/wire tag is authorized merely to simplify testing.
5. **Possible noncanonical special-value intake:** at09:22UTC Root asked DeepSeek to reproduce whether the custom
   `deserialize_enum`/`unit_variant` reader accepts `{"PositiveInfinity":null}` or `{"NotANumber":null}` in addition
   to the required canonical special strings. Existing tests covered finite-null and special numeric/bool payloads,
   but not these map-null forms. This is a code-review suspicion, not an executed failure. Require actual decoder and
   accepted-restore checks for both trusted report rows and pending events, preserving any first RED; raw duplicate-key
   cases must also be covered. The actual Card emission test observer should explicitly reject unexpected non-Hit
   variants rather than silently omit them when claiming complete emission coverage. The worker received this follow-up
   through the active task; no Rust probe or production edit was authored by Root.

These findings do not invalidate the separately frozen legacy source capture. They hold native admission pending
repairs and evidence. The final independent reviewer must inspect the actual sealed delta and all packet gates;
Root has not yet authorized derived native ability-tape/content-pin regeneration without the actual63-source-case pass.
