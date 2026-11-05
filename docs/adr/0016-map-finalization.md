# ADR 0016: map records, exact legacy identity and terrain acceptance

Status: Accepted. Evidence: [stage2-map-finalization](../evidence/stage2-map-finalization/README.md).

Three pure leaves now expose the final generator boundary inside `rh-sim`: `records::finalize`,
`map_hash::map_hash` and `terrain_gate::validate`. They run without I/O, clocks or entropy. They do not replace the
server's imported maps or constitute a complete generator or independently written certifier.

Records consume genuine post-spawn-gate generator layers. The port preserves faction/camp order, territory remapping,
pre-remapping area counts, fractional radii, pole ties and landmark exclusions, spawn round robin, feature log order,
ownership-derived feature bounds and infill. Malformed references are refused before modifying territory. Canonical
faction/weapon and ICE policy is borrowed from one definition used by both execution and content visitation.

Map identity reproduces the actual source field/list order, wrapping FNV-1a, UTF-16 low/high bytes and delimiters.
Numbers use exact ECMAScript Number strings through pinned `ryu-js =1.0.3`, with no mandatory runtime dependencies.
Upstream is dual Apache-2.0 OR BSL-1.0; its declared MSRV is 1.71. The local executed compiler is 1.97, not an asserted
MSRV-1.85 run. Rust scalar strings cover admitted map DTO strings; lone JS surrogates remain outside that domain.
The source deliberately omits props, coliseum and region mob-camp lists. Matching its compatibility identity therefore
does not certify those fields or replace the complete imported-map/static-state identity.

Terrain validation preserves ordered T1–T11 results, early returns, topology, table overrides and exact diagnostic
number strings. Its borrowed terrain/prop rows, ICE identity and hazard distances drive both checks and content words.
This is generator-owned `validateTerrain`, not independent `mapCertify`, nor gameplay terrain effects. Explicit input
bounds prevent invalid indexing and unbounded camp expansion. Structural import admits larger finite radii; these
necessarily fail source T8 for an in-bounds centre and wall border, but this gate returns typed `Coordinates` before
expansion. Exact diagnostic parity is not claimed for that narrower rejected metadata domain.

Independent review repaired two evidence gaps: removable genuine record cases and repeated numeric-map inputs that
could satisfy nominal counts. Tests now require exact nonempty record inventories and independently reconstructed
numeric bit sets. The same attacks fail after repair. Production behavior and canonical fixture bytes did not change.
The integrated records test also checks the real source hash, terrain acceptance and M0 structural admission for every
genuine output. Aggregate content tests cover every new live policy field, table order/length and Option presence.

Content identity changes; checkpoint /14, replay /12, observation 11, policy 8 and protocol 5 do not. Remaining generator
stages, orchestration, independent certification and canonical pins are still required before generator cutover.
