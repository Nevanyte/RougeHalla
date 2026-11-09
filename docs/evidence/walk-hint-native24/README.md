# P-WALK-HINT-NATIVE24-CONSUMER — finite method-parity handoff

Branch `deepseek/walkhint-native24` created from the literal fixed head
`582c0c69ddf74d2744b519bc47d012736bcb043a`; the old `deepseek/p-pack-leader-native29` branch/ref is preserved unchanged.
This is a declared method-parity packet, not earned World, full Frame/physics, live/public or complete boundary admission.
No production/game-rule/schema/identity/state changes were made: the only source-code delta is the appended private inline
`boundary24` test module in `crates/rh-sim/src/systems/walk_hint/helper_tests.rs` (existing 69 helper recipes/assertions and
source bytes unchanged).

## Corpus and declared setup

- `parity/walk-hint/helper-boundaries/source.json` byte-exact from the reviewed seal: 150406 bytes,
  SHA-256 `1702ce0a44940709d229161211cbd6ceaf8b0f4ef55c147d3321b3e3ab78e774`, existing-style FNV guard
  `0x577641fc5c7698cc`. Asserted: format `rh-walk-hint-helper-boundaries/1`, profile base
  `70433a9834ccf082b5ca449dca0fd4319cd072ca`, code `8151b96d177baad5a40fb2fa5854aeb35237040d`, exactly 24 unique IDs,
  exactly eight decision counts (goal8 3, repath250 3, losGrace 2, futureVisibility 4, amoveOrder 3, waypoint1e-6 3,
  directionRounding 3, weaponTie 3), no error records, all observed/events/draws present with zero events/draws.
- Each declared `input.setup`: 64x40 map, borderWalls flag, declared wall tiles, all-zero terrain, the exact three spawn
  options, seed7, player count 1/2/3, p0 Holy and p1/p2 Frost with native IDs 1/2/3 and original store order. The admitted
  helper constructor runs 40 ordinary setup steps to now2000/tick40; LOS cases add exactly two further ordinary
  vision-producing steps (near the declared target, then the declared put back) to now2100/tick42. The documented native
  86400 s deadline versus the source 1e6 s value is a non-reached setup projection.
- Fighters are applied through existing seams (`put`, `motion.path.set_from`, declared history samples, typed weapon /
  targeting / PendingAction fields, actual `status_runtime` apply/reveal and the pre-existing `full_method_gates` readonly
  installer context that is never stepped or restored). Source `planAt=-Infinity` maps native `plan_at=None`; zero `lostAt`
  maps absent; `fists` maps absent weapon. No expected hint, selected target, visibility result or RNG state is installed.
- Every readonly query serializes World and all three RNG streams around the query and requires them unchanged. Mutating
  steps are only the declared source methods (actual `targeting::update` and `operations::remove_into`), with no whole-step
  or earned-combat claim.

## Consumed 24 (actual production functions; assertions use captured expected values only)

- goal-below/equal/above and repath-before/equal/fresh: actual `walk_hint_of`, exact dir/ticks; captured position/path/
  ready/action/lock seen/goal/plan/lost values preserved; plan times asserted by captured binary64 bits.
- los-before/equal: real two-step native vision priming then declared put; actual native gameplay visibility and
  `lockable_now` must be TRUE while physical `has_line_of_sight` is FALSE; actual hint compared; captured `lostAt` bits
  asserted; no trail/reveal cell or true visibility flag installed.
- future-hidden-active/revealed and future-untargetable-before/equal: actual `status::untargetable` at the captured binary64
  `at`; the revealed variant uses actual `status::reveal` (asserted revealFrom), including the nextDown 2049.9999999999995
  versus 2050 boundary. No clock stepping to approximate query times.
- amove-nearest-ordered/hidden-nearest/hide-to-acquire: actual hint before, actual ordered candidate recomputation through
  native fighter iteration + actual `source_distance`/`lockable_now`/`untargetable`/physical LoS, actual `targeting::update`,
  and actual selected target identity. hide-to-acquire additionally performs actual `remove_into(Selector::Kind(Hidden))`,
  compares the removed status projection through the explicit fixture h -> existing helper9000 source mapping, then a second
  readonly hint and selection (a second hint/selection, not a 25th case). Candidate IDs/order/coordinates/distances/booleans
  are compared exactly.
- waypoint-below/equal/above: declared scalar origin/endpoint48 with captured binary64 requested length asserted; actual
  `walk_hint_of` dir/ticks (source 2/3/3 transition).
- direction-below/equal/above: actual `encode_dir` on the captured angle (direct), actual `encode_dir` on native atan2 of the
  captured path deltas (pathKernel), and actual `walk_hint_of`; compared separately. Source direct 255/0/0,
  pathKernel 255/255/255, hints 255/3 are reproduced; no forced transition or direct-angle substitution.
- tie-before/equal/after: actual `queries::weapon_holds_at` at the captured `at` with a real typed sword Swing action and
  exact captured `landsAt` bits (false/false/true); ignored source packet is not a damage/event claim.

## Actual results (raw logs pinned below)

- Focused `cargo test -p rh-sim --lib boundary24`: **1 passed, 0 failed**, exit 0.
- Existing walk_hint regression filters (`cargo test -p rh-sim --lib walk_hint`, covering the existing 14 and 69 helper scopes
  plus native24): **16 passed, 0 failed, 2 ignored**, exit 0.
- `cargo fmt -p rh-sim -- --check`: exit 0. Scoped `cargo clippy -p rh-sim --all-targets -- -D warnings`: exit 0.

## Limits

- These are declared method contexts fed by the captured recipes, not earned World/physics/public/full-brain parity; no
  source execution, recapture, mutation campaign, broad map/workspace run, new cache or Cargo.lock/shared-status change was
  made. The Cartesian direct-transition observation remains separate from collapsed path/hint observations. Unrelated
  pre-existing reds and the old native29 history are untouched. Root owns composition/admission/merge.

## Manifest

`manifest.txt` pins SHA-256 and byte length for every payload in this handoff. Payloads are verified against the actual Git
blobs of the sealed commit; raw `.log` files are dedicated manifest-pinned receipts (force-added where ignored globally).
