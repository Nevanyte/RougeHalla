# P-MAPGEN-GUARANTEES-1: the per-zone end-of-attempt checks become one registered list beside each styler, one refusal variant

- **Serves:** the land-generation lane's architecture review of 2026-11-13
  (`docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md`, finding 4), asked by the owner ("make sure the
  architecture is well set up"); the review's order (B), second packet after P-MAPGEN-LANDMARK-FRAME-1. Before the
  Frost, Fire and Holy land rules (each would otherwise add a variant, a field and a module), SCALE-4 and HOLY-1.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the pipeline's end of attempt, two stylers, the signature
  step; every option-on map is pinned).
- **Reviewer:** reviewer-opus.
- **Integration base:** `feature/unity-rework` with P-MAPGEN-LANDMARK-FRAME-1 merged. Until it merges this branch is
  stacked on it: `packet/P-MAPGEN-GUARANTEES-1` was cut from `agent/opus/P-MAPGEN-LANDMARK-FRAME-1` @ `7e715bd57`; run
  the gate with `--base agent/opus/P-MAPGEN-LANDMARK-FRAME-1` until then (the coordinator rebases if that branch gains
  a commit).
- **D-rules touched:** D1: no legacy counterpart (DEV-020); option off untouched, option on byte- and draw-identical
  (G8). D2 n/a. No sim tick, wire, save, state-hash or content-hash change (the guarantee lists are not folded into
  `style_zones::visit_content`). Not cross-crate: no crate outside `rh-sim` reads a `pipeline::Refusal` label
  (measured below).
- **Status:** oracle written (2026-11-14, oracle-author, Opus).

## 1. ID and outcome
The end-of-attempt checks of a signature attempt are mixed today (`pipeline/mod.rs`, end of `build_attempt`):
`Refusal::SignatureDiscarded` covers `SignatureContext::intact` (owned tiles, entrances, styler features in aprons,
`aprons_apart`, AND the Frost lake rule `cave::lake_at_mouth`, a styler's rule judged in landmark code) and the strict
certifier; Plague's check is a module in `pipeline/` (`plague_pools.rs`) with its own variant (`SignaturePools`), a
`Pipeline.pool_detour` field and a test seam (`with_pool_detour`). After this packet:

- `style_zones` has `Guarantee { rule: &'static str, check: fn(&GameMapData, &LandmarkFrame) -> bool }` and
  `guarantees(zone) -> &'static [Guarantee]` (stub commit), the lists written beside each styler:
  `style_rime::guarantees()` = [`"lake-at-mouth"`]; `style_warren::guarantees()` = [`"pool-walks"`, `"pool-wet"`];
  Fire, Sentenced and Holy: empty (the lookup's `&[]`). Functions, not `pub const` items (`tests/content.rs` reads every
  `pub const` as a tunable).
- The end of an option-on attempt runs, in this order: `intact` (owned tiles, door, aprons, `aprons_apart`; NO lake
  rule) or the certifier fails -> `Refusal::SignatureDiscarded` (unchanged); then ONE loop over the attempt's frames
  (`Placed::frames`, placement order = `signature::reserved_zones()` = Fire, Sentenced, Plague, Frost) and, for each,
  its zone's guarantees in list order: the first that returns `false` -> `Refusal::Guarantee { zone, rule }`.
- `cave::lake_at_mouth` moves to `style_rime` as the check of `"lake-at-mouth"` (with its unit tests). `intact` no
  longer calls it; nothing under `landmarks/signature/` names the lake rule.
- `pipeline/plague_pools.rs` moves to `style_warren` as `"pool-walks"` (every Plague spawn's walk growth with styler bog
  forbidden is at most `POOLS.walk_detour`) and `"pool-wet"` (`dry_pools` is empty). Two rules, because `keeps` is
  exactly `walks && wet` and the two halves read different things. `plague_pools.rs`, `plague_pools_tests.rs`,
  `Refusal::SignaturePools`, `Pipeline.pool_detour` and `with_pool_detour` are deleted.
- `walk_growth` is general over a forbidden-ground predicate and a spawn zone: `style_zones::walk_growth(m, zone,
  forbidden)` (stub commit, real body, identical numbers: `mapgen_land_plague.rs` compares it with its own walk oracle on
  seeds 1-96). With `zone` = Frost it is the Frost land rules' dry-way-round check.

Nothing a player, a styler, the server or the client sees changes. Which attempts are kept does not change, so no map
changes, option on or off, and nothing is re-pinned. Only the LABEL of some discarded attempts changes:
- an attempt failing only the lake rule: `SignatureDiscarded` -> `Guarantee { zone: Frost, rule: "lake-at-mouth" }`;
- an attempt failing the pool check (and passing `intact` and the certifier): `SignaturePools` ->
  `Guarantee { zone: Plague, rule: "pool-walks" | "pool-wet" }`.

## 2. Dependencies
- In the base: P-MAPGEN-LANDMARK-FRAME-1 (`LandmarkFrame`, `Placed::frames`; `finish` borrows `&p.frames`). Its hand-off:
  switch `if let Some(p) = placed` before `finish` to `if let Some(p) = &placed` so the frames stay for the checks.
- After: P-LAND-FROST-1 and the Fire/Holy land rules add guarantees to their lists; review finding 6 moves the lake
  tunables beside the styler (not here: the check reads `signature::DEFAULT_DEFINITION.lake_reach + lake_slack`,
  which is what the pipeline builds its `SignatureContext` from, so the numbers are identical).
- Shared-file rule: `pipeline/mod.rs`, `style_zones/mod.rs`, `signature/mod.rs`: merge alone.

## 3. Relevant paths (stub commit lines; re-find by name)
- `crates/rh-sim/src/mapgen/pipeline/mod.rs`: `Refusal` (`:69-104`, `Guarantee` added by the stub at `:100`),
  `Pipeline.pool_detour` (`:149`), its initialiser (`:205`), `with_pool_detour` (`:208-214`), the end of the attempt
  (`:702-737`: `placed_any`, `finish`, `intact || certifies` at `:730`, `plague_pools::keeps` at `:734`).
- `pipeline/plague_pools.rs` (`walk_growth`, `dry_pools`, `keeps`, `is_styler_bog` made `pub(crate)` by the stub) and
  `pipeline/plague_pools_tests.rs` (hand-built maps; two pipeline tests through `with_pool_detour`).
- `landmarks/signature/mod.rs`: `intact` (`:870-960`; the lake call is the last conjunct, `:959`) and its doc comment.
- `landmarks/signature/cave.rs`: `lake_at_mouth` (`:23-108`) and its unit tests (`:110-274`).
- `style_zones/guarantee.rs` (new, stub), `style_zones/mod.rs` (`pub use guarantee::{guarantees, walk_growth,
  Guarantee}`), `style_rime/guarantees.rs` and `style_warren/guarantees.rs` (new, stub: empty lists;
  `style_warren::{is_styler_bog, dry_pools}` delegate to `plague_pools.rs`).

## 4. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_zones/{guarantee.rs, mod.rs}`: bodies, doc comments, private helpers. The public names
  and signatures of `Guarantee`, `guarantees` and `walk_growth` may not change.
- `style_rime/{guarantees.rs, mod.rs, README.md}` and new test modules under `style_rime/`: the lake rule and its
  moved unit tests.
- `style_warren/{guarantees.rs, mod.rs, README.md}` and new test modules under `style_warren/`: the pool rules, the
  bodies of `is_styler_bog` and `dry_pools` (public names and signatures fixed), the moved hand-built-map tests.
- `pipeline/mod.rs` (the end of the attempt, `Refusal`, the `Pipeline` fields, a `#[cfg(test)]` seam, the module list),
  `pipeline/README.md`; delete `pipeline/plague_pools.rs` and `pipeline/plague_pools_tests.rs`.
- `landmarks/signature/mod.rs`: `intact` loses the lake conjunct, its doc comment; the module list if `cave.rs` is
  emptied. `landmarks/signature/cave.rs`: `lake_at_mouth` and its tests leave (keep or delete the file; the module doc
  says where the rule went).
- NOT in scope: every file under `crates/rh-sim/tests/` (the oracle commit made every change they need), `intact`'s
  owned-tile, door and apron logic (decided: unchanged here), the stylers' shaping code (`lakes.rs`, `pools.rs`,
  `walk.rs`), `rh-mapdress`, other crates.

## 5. Contracts and references
ADR 0028 G1, G5 (a map that breaks a rule is discarded, never repaired), G8 (option off unchanged); C-PARITY; AGENTS.md
determinism (pure predicates: no draw, ordered iteration). The frame is generator working state, never serialized.

## 6. What was found and measured (oracle author, 2026-11-14, macOS arm64, debug build; throw-away instrumentation, not committed)

### Readers of the refusal labels
- Outside `rh-sim`: none. `rh-server` (`map_pool.rs`) and every other crate call `certified_styled`, which returns
  `Option` (a refused attempt is `None`, its label dropped); only `Error` values are formatted (`{e:?}`), and a label
  reaches an `Error` only through a numbered `generate_*(seed, Some(n))`, which nothing outside `rh-sim` tests calls.
  `rh-headless`, `rh-load`, `tools/`, the wire, the decoders: no reference to `pipeline::Refusal`. Not cross-crate.
- No pin table pins an end-of-attempt label (`tests/support/signature_pins.rs` pins maps and Landmarks-phase digests
  only; the `refusals` maps in `mapgen_signature_{scale,bog_tree,church}.rs`, `mapgen_land_sentenced.rs`,
  `mapgen_land_plague.rs` and `mapgen_signature_frost.rs` are printed reports).
- Tests that name the labels: `mapgen_signature_fire.rs::note2_refusals_tell_no_site_from_a_discarded_map` (all three of
  its discards, seeds 7, 8, 9 attempt 0, fail only the lake rule: after the change it would count 0 and fail its
  `discarded >= 1`), `mapgen_land_plague.rs` (`SignaturePools`, `plague_pools::{walk_growth, dry_pools, keeps}`),
  in-crate `pipeline/plague_pools_tests.rs`. The first two are updated in the oracle commit (section 9); the third is
  the implementer's (section 7).

### Counts (option on, every attempt up to each seed's map)
| | attempts | kept | `SignatureDiscarded` | of which lake rule alone | of which `intact` (lake passing) alone | certifier | `SignaturePools` |
|---|---|---|---|---|---|---|---|
| seeds 1-32 | 54 | 32 | 14 | 11 | 3 | 0 | 0 |
| seeds 1-96 | 178 | 96 | 44 | 34 | 10 | 0 | 0 |
No attempt of seeds 1-96 fails two of {`intact` without the lake rule, the lake rule, the certifier, `pool-walks`,
`pool-wet`}. Other labels (unchanged): seeds 1-32 `Prefix` 4, `SpawnRatio` 3, `Repair(RadiusPost)` 1.

### Order of checks
Order decides the label, never the keep (an attempt is kept only if every check passes). Cases where the order shows:
- lake rule + `intact`/certifier: `SignatureDiscarded` today and after (intact and certify run first). Occurs 0 times
  on seeds 1-96.
- lake rule + a pool rule (intact and certifier passing): `SignatureDiscarded` today; after, the frames' order runs
  Plague before Frost, so `Guarantee { Plague, "pool-walks" | "pool-wet" }`. Occurs 0 times on seeds 1-96; pinned by the
  in-crate test of section 7, not by a seed.
- `pool-walks` + `pool-wet`: `pool-walks` (list order). Occurs 0 times.
So no test on seeds 1-96 can see the order; the in-crate test pins it.

## 7. Behaviour to preserve, and the in-crate tests the implementer writes
- Every option-on map of seeds 1-32 and every Landmarks phase of seeds 1-16 attempts 0-1:
  `mapgen_signature_blueprint.rs` `option_on_maps_are_unchanged` and `the_landmarks_phase_is_unchanged`, green with no
  re-pin. Option off: the `option_off_is_todays_generator` guards, untouched. Every `mapgen_signature_*`,
  `mapgen_land_*`, `mapgen_style_refusal`, `mapgen_landmark_frame`, `rh-mapdress`, `rh-server --test map_anchor_seeds`:
  green, unchanged.
- The lake rule's numbers: `lake_reach + lake_slack` from `signature::DEFAULT_DEFINITION` (10 steps), the mouth = the
  Frost anchor's `entrance` (the frame's `anchor.entrance`, equal to the exported anchor's by construction), the cave =
  the map's `Cave` feature, the ice = the catalog's ice code; largest body first in row order on a tie. The four unit
  tests of `cave.rs` move with it, assertions unchanged (they may build a `LandmarkFrame` by hand).
- The pool rules' numbers: `POOLS.walk_detour` (2); styler bog = floor, terrain bog, owned by a `BogPool`; walks on the
  whole map from the coliseum centre and gates. The hand-built-map tests of `plague_pools_tests.rs` move to
  `style_warren`, assertions unchanged, `walk_growth(&m)` becoming `style_zones::walk_growth(&m, Zone::Plague, |i|
  is_styler_bog(&m, i))` and `keeps(&m, detour())` becoming "both Plague guarantees pass".
- **Required in-crate pipeline tests** (they replace `plague_pools_tests.rs`'s two pipeline tests; an integration test
  cannot reach a `#[cfg(test)]` seam, and no attempt of seeds 1-96 fails a pool rule). Add a seam such as
  `#[cfg(test)] Pipeline::with_guarantees(fn(Zone) -> &'static [Guarantee])` replacing the lookup, and test:
  1. seed 1, option on, at its kept attempt, with a Plague list whose `"pool-walks"` check uses a detour of -1:
     `report.refusal == Some(Refusal::Guarantee { zone: Zone::Plague, rule: "pool-walks" })`, no map, the trace's last
     phase `Records`, and `styled_attempt` returns `Ok(None)`;
  2. option off with that seam: `certified_styled` of seeds 1-2 unchanged (the loop never runs without frames);
  3. order: a Plague and a Frost rule that both fail -> the Plague one is reported (frames in placement order); two
     failing rules in one zone -> the first in its list.

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_guarantees`: 7 green (7 red on the stub).
- `mapgen_signature_fire` and `mapgen_land_plague` green (amended in the oracle commit; green on the stub too).
- The whole `cargo test -p rh-sim --features trusted-status-probes`, `cargo test -p rh-mapdress`,
  `cargo test -p rh-server --test map_anchor_seeds`: green.
- These print nothing:
  - `rg -n 'SignaturePools|pool_detour|with_pool_detour|plague_pools' crates/rh-sim/src`
  - `rg -n 'lake_at_mouth|lake-at-mouth' crates/rh-sim/src/mapgen/landmarks`
- These print the rules where they now live: `rg -n '"lake-at-mouth"' crates/rh-sim/src/mapgen/style_rime`;
  `rg -n '"pool-walks"|"pool-wet"' crates/rh-sim/src/mapgen/style_warren`.
- `rg -n 'Refusal::Guarantee' crates/rh-sim/src/mapgen/pipeline/mod.rs` shows the one place it is produced.
- `cargo fmt --all -- --check`; `cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D warnings`.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-GUARANTEES-1 --base agent/opus/P-MAPGEN-LANDMARK-FRAME-1`, then the
  full gate with the same flags.

## 9. Validation commands
```
export PATH="$HOME/.cargo/bin:$PATH"
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p rh-sim --features trusted-status-probes --test mapgen_guarantees
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_fire --test mapgen_land_plague --test mapgen_signature_frost_lake --test mapgen_signature_blueprint
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p rh-sim --features trusted-status-probes
```

## 10. Known traps
- `finish` must borrow the frames (`&placed`), or there is nothing to loop over at the end.
- Run the guarantees only with the option on (`placed` is `Some`); the loop over no frames is the option-off path.
- Keep `intact` and the certifier before the guarantees, and keep `intact`'s other conjuncts exactly: an attempt
  failing `intact` and the lake rule must stay `SignatureDiscarded`.
- `Refusal` derives `Deserialize`; `rule: &'static str` compiles because nothing deserializes a `Refusal` (do not add
  one; use `String` only if it must be owned, and then the oracle's patterns still compare by value).
- Do not fold the lists into `style_zones::visit_content` or any hash.
- The lake check's mouth order does not matter (a BFS from all mouth tiles); its body labelling order (row order) does.
- `tests/content.rs` treats every `pub const` in `rh-sim` as a tunable: return lists from functions (the stub does).
- `style_warren::POOLS` is `pub(crate)`; the check reads it inside the crate.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_guarantees.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_fire.rs` (`note2_refusals_tell_no_site_from_a_discarded_map` counts a
  `Refusal::Guarantee` after `Records` as a discard)
- `crates/rh-sim/tests/mapgen_land_plague.rs` (the pool-check section reads `style_zones::walk_growth` and
  `style_warren::{is_styler_bog, dry_pools}`, and counts `SignaturePools` or a Plague `Guarantee` label)
- `docs/backlog/packets/P-MAPGEN-GUARANTEES-1.md`
- The stub commit's files are the implementer's where section 4 says so.

## The oracle (`crates/rh-sim/tests/mapgen_guarantees.rs`)
Red on the stub (empty lists; the pipeline still labels as today), each on an assertion:
| Test | Pins | Red on the stub |
|---|---|---|
| `the_registry_lists_the_frost_and_plague_rules_and_nothing_else` | Fire [], Sentenced [], Plague [`pool-walks`, `pool-wet`], Frost [`lake-at-mouth`], Holy [] | every list empty |
| `every_guarantee_holds_on_every_kept_map_of_seeds_1_to_32` | each check of each frame's zone passes on the kept map with its frame; 96 checks | 0 checks vs 96 |
| `lake_at_mouth_fails_with_the_mouth_walled_and_passes_with_no_lake` | kept maps with a lake (>= 16): the mouth walled -> fails; the lake dried too -> passes | "no guarantee \"lake-at-mouth\" registered" |
| `pool_wet_fails_when_a_pool_loses_its_bog_and_pool_walks_still_holds` | kept maps with a pool (>= 16): one pool's bog cleared -> `pool-wet` fails, `pool-walks` passes | "no guarantee \"pool-walks\"" |
| `pool_walks_fails_when_pool_bog_rings_a_plague_spawn_and_pool_wet_still_holds` | (>= 16 maps) a Plague spawn's unowned floor neighbours made pool bog -> `pool-walks` fails, `pool-wet` passes | same |
| `the_refusal_labels_of_seeds_1_to_32_are_todays_relabelled` | every refused attempt's label per seed (section 6's mapping applied to the stub's run) | seed 1: `SignatureDiscarded` vs the Frost guarantee |
| `a_lake_failure_is_refused_after_records_as_the_frost_guarantee` | 11 lake refusals; every `SignatureDiscarded`/`Guarantee` trace ends at `Records`; `generate_styled(seed, Some(n))` is `Err(AttemptRefused(Guarantee { Frost, "lake-at-mouth" }))` | 0 lake refusals vs 11 |

Checked before committing: with a throw-away prototype of the change (lists registered, the lake conjunct dropped
from `intact`, the loop at the end; not committed) all 7 pass, and `mapgen_signature_fire` (11) and
`mapgen_land_plague` (26) stay green.

## Departures from the plan (and why)
- The plan's oracle "a doctored finished map that breaks each rule is refused with `Refusal::Guarantee`" is split: the
  doctored maps go to the checks directly (a finished map cannot be fed back into the pipeline from outside), and the
  pipeline's refusal is shown on the 11 real lake failures of seeds 1-32 plus the in-crate seam tests of section 7.
- `walk_growth` takes the spawn zone as well as the predicate (the Frost rules walk from Frost spawns) and lives in
  `style_zones` beside `Guarantee`, shared by both stylers.
- `Refusal::Guarantee`'s `rule` is `&'static str` (the registry's name), so tests match on literals.
