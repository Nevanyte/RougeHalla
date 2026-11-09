# Bot vision: negative and mutation controls

Two different things are kept apart. **Source semantic controls** (below, part A) need a future
variant-preparation lease and an actual run each; all are DEFINED, UNRUN. **Native test sensitivity**
(part B) ran in this lane; it shows the hand-derived Rust tests react to a deliberate native defect.
It is not parity and not a source control. A compile, provenance, hash or envelope refusal is never a
semantic kill.

## A. Source semantic controls — DEFINED, UNRUN

Each is one edit to a *copy* of `packages/server/src/bots/brain/vision.ts` (or `shared/src/vision.ts`)
with its own manifest. The pristine runtime correctly refuses any changed source byte, so a control
needs its own reviewed provenance; that refusal is not a kill. Intended KILL = the named verifier check
fails *and* the native parity comparison reports a first discrepancy at the named step.

| ID | Source mutation | Intended KILL at |
| --- | --- | --- |
| S1 | drop `Math.fround` on the seat position | `trail-throttle[0]` diagnostic `lastX`; check `trail: fround origin` |
| S2 | fields: drop `|| this.canSee({x: f.x2, y: f.y2})` (one trail end) | `filter-families[1]` output fields; `filter: a trail needs both ends` |
| S3 | death redaction keeps `by` | `filter-families[1]` events; `filter: unseen death redacted` |
| S4 | `canSee` expiry `>` → `>=` | `trail-throttle[12]` canSee; `trail: exclusive expiry boundary` |
| S5 | bush reveal `until > this.now` → `>=` | `bush-reveal[5]` diagnostic `bushReveal` |
| S6 | ward rebuild ignores `ward.map !== sight` | `wards[5]` diagnostic ward map; `wards: renewal and gate rebuild` |
| S7 | remove `this.memory.clear()` before restore | `reconnect-restore[4]` diagnostic; `restore: last accepted snapshot wins entirely` |
| S8 | effects filter by unfiltered fighters | `filter-families[1]` extras.effects; `filter: effects trimmed` |
| S9 | `sight = this.map` always (ignore `gatesLocked`) | `gates-coliseum[0..1]`; `gates: locked hides a cell that open shows` |
| S10 | disabled branch keeps the trail | `reset-gates[10]`; `reset: nonactive clears trail and wards` |
| N1 (NONKILL) | comment-only change in `vision.ts` | must reach the same raw bytes except provenance; no check fails |

## B. Native test sensitivity — RUN (hand-derived tests only)

`rust-mutations.json` records the final sequential run over the Rust sources committed at `2c988ff0`
(`cargo test -p rh-policy vision -- --skip actual_source`, one mutation at a time, file restored):

| ID | Native mutation | Result | Killed by |
| --- | --- | --- | --- |
| M1 | no fround | KILL | `fround_origin_and_the_throttle_ignores_movement` |
| M2 | trail end ignored | KILL | `filter_trails_need_both_ends_deaths_redact_and_effects_trim` |
| M3 | unseen death dropped instead of redacted | KILL | same |
| M4 | inclusive expiry | KILL | `reuse_refreshes_only_the_previous_scan_and_expiry_is_exclusive` |
| M5 | no 100 ms throttle | KILL | `fround_origin_and_the_throttle_ignores_movement` |
| M6 | bush boundary `>=` | KILL | `bush_concealment_boundary_and_reveal` |
| M7 | effects keep input order (no JS key order) | KILL | `effects_order_is_canonical_even_from_a_native_visible_order` |
| M8 | ward rebuild ignores map identity | KILL | `wards_follow_owner_expiry_index_and_map_identity` |
| M9 | first accepted snapshot wins | KILL | `restore_accepts_only_valid_cells_and_the_last_snapshot_wins` |
| M10 | bush reveal kept at `until == now` | KILL | `bush_concealment_boundary_and_reveal` |
| M11 | reuse path disabled | NONKILL (expected) | equivalent by design: on an immutable map a full rescan from the same origin refreshes the same cells |
| M12 | disabled update keeps the trail | KILL | `restore_accepts_only_valid_cells_and_the_last_snapshot_wins` |
| M13 | any ward owner accepted | KILL | `foreign_seed_wards_and_reveals_grant_no_sight` |
| M14 | restore ignores the map seed | KILL | `foreign_seed_wards_and_reveals_grant_no_sight` |

Retained history: the first pass reported M7 and M10 as NONKILL. The canonical-order effects test and the
`bushReveal` diagnostic assertion were then added (before the code commit) and the whole set was rerun
sequentially. During that work one scratch mutation script of this lane overlapped two test runs; those two
red runs reflected temporarily mutated files and are not product failures. The final table comes from a
sequential run with no overlapping process, followed by two clean full-crate passes.

## C. Privacy-shaped negative controls in the native tests

- another map's (seed 2) reconnect snapshot installs nothing; refused envelopes leave the trail unchanged;
- a ward owned by another seat grants no sight; a ward whose camp index has no map site is skipped;
- a fighter outside the trail/wards is removed and its effects entry with it; an unseen death keeps
  neither position nor killer; an unseen hit/block is dropped;
- a bush occupant beyond 64 is concealed unless its own synced `bushRevealUntil` is strictly after now;
- source-throwing inputs (nullish private message or player, minimap without mobs, event without `at`)
  are refused before any native mutation; disabled updates read neither privates nor players.
