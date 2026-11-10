# Numeric and identity contract for independent review

All declared inputs, map bytes, identities, ordering, enums, flags, counters, RNG draws/count/order, clocks/timers/expiry,
status/why strings and discrete outcomes remain exact, unrounded binary64. Undefined/Null/missing and signedzero are
separate representations. No f32 conversion, input rounding, approximate timer, utility/status tolerance or candidate
output exception is authorized. A source threshold's exact discrete outcome binds every boundary case.

The inherited contracts are proposals on this explicit logical-field whitelist, requiring independent review before
native comparison. `2e-6` absolute geometry tolerance may apply only to:

- `result.intents[*].to.{x,y}` when the source why is `flee`, `sudden death: ahead, keeping distance`,
  `orb-walk: step away after the shot`, `sidestep an incoming ball`/`arrow`, `juke the shot as it leaves`, or
  `to the coliseum spot` **when that slot actually has a pickHoldSpot result**. A direct declared coliseum goal point
  remains exact. These are retreatPoint/awayPoint/sideStep/pickHoldSpot geometry leaves.
- Direct Retreat `point` and `pickHoldSpot` result `{x,y}`; direct Orb/Reflex moves' geometry under the same reasons.
- `paths.clear` callback argument1 `{x,y}` only where the actual caller is the geometry leaves above (Retreat, Orb away,
  Reflex sideStep); argument0 is the declared self and remains exact. Normal Fight waypoint-clear calls use actual route
  coordinates and remain exact. Source callback order and boolean results always remain exact.
- `paths.walk` argument1 `{x,y}` only for an actual computed coliseum spot. Declared requested goals/endpoints and
  `paths.los`/`paths.path` arguments remain exact. `paths.walk.result.dist` is an actual source hypot/pathLength-derived
  continuous estimate; its exact/null distinction, exact flag, path shape/order and budget/cache behavior remain exact.

No current new field requires the Gaussian `1e-9 * max(1, abs(source))` allowance: tactics uses reaction/step means and
seeded uniform geometry, not Gaussian samples. Knowledge setup retains source seeded draw order. If a later native
review proposes another continuous field, it must identify that source derivation and exact fixture paths before
comparison; it cannot widen the whitelist to fit an observed native answer.

Memory outputs and actual declared-field callbacks retain the admitted exact Memory contract. Exact intent priorities,
output order, swap slots, lock targets/coordinates copied from declared foes, and timed due arithmetic receive no epsilon.
Static/source maps, fixture input coordinates, paths consisting of tile waypoints, final latch and status strings are
exact. A geometry tolerance never excuses changed collision/region/pass/fail/target/timer outcomes.
