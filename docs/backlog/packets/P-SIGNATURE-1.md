# P-SIGNATURE-1: signature landmarks as real terrain on pooled maps (rule half)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); owner answers
  2026-11-11 (chat): the marsh's slow is bog only, water is presentation; faction exemptions stay as the live mode has them.
- **Implementer tier:** cloud session (single agent)
- **Reviewer:** reviewer-opus (map authoring feeding every pooled match)
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (new design, no legacy oracle) · D2 n/a · D5 new design inside the freeze, by
  explicit owner direction · D6/D9 none

## 1. ID and outcome
A server started with `--map-pool --signature-landmarks` adds one landmark per zone to every pooled map:
- **Fire:** a volcano cone (wall) with two or three lava streams (impassable LOW lava) ending in pools, edged with ember
  (burns).
- **Sentenced:** a walled church around an elite camp, its door facing the centre, with grave stones beyond the door.
- **Plague:** a giant bog tree (wall) ringed by two bands of bog (slow).
- **Frost:** a rock arch around an elite camp, open towards the centre, with an ice floor.
- **Holy:** keeps its temple.

The pass edits only free zone floor, records every change as a certifier-known feature, recomputes the camps' derived
area and radius, and keeps a landmark only if the strict certifier finds no new failure; a landmark that does not fit
is skipped. Without the flags nothing changes.

## 2. Dependencies
P-MAP-3 (the pool).

## 3. Relevant legacy paths
None: new design. Certification rules: `crates/rh-sim/src/mapgen/certify/{features.rs,mod.rs,rules.rs}`; map validation:
`crates/rh-sim/src/mapdata/validate.rs`.

## 4. New paths
- `crates/rh-server/src/signature.rs`, `crates/rh-server/src/signature/tests.rs`

## 5. Exclusive write scope
- the new files; `crates/rh-server/src/{lib.rs,map_pool.rs,map_pool/tests.rs,runtime.rs,main.rs}`

## 6. Contracts and references
- It lives in `rh-server` (map authoring before a match exists): `rh-sim`'s content hash, the client's expected identity
  and every parity fixture are unchanged. The terrain reaches clients through the existing collision and terrain planes
  of the map blob; no protocol change.
- No new terrain kind: lava (1), ember (4), bog (5) and ice (6) already exist with their sim rules.

## 7. Behaviour to preserve
- Without `--signature-landmarks`, pooled maps are exactly the generator's.
- Every served map stays certified (strict, every zone) and admitted (wire range, spawns, Welcome).

## 8. Acceptance checks
- `signature::tests`: over seeds 1-8 every landmark is placed at least once (measured: bog tree 8, volcano 7, church 6,
  cave 4), no placed landmark adds a certifier failure, every map validates and admits, the live source-arena rules step
  a match on a signed map, and the pass is deterministic.
- `runtime.rs`: `--signature-landmarks` needs `--map-pool`; training refuses both.

## 9. Validation commands
- `cargo test -p rh-server --lib signature`, `cargo test -p rh-server --lib runtime`

## 10. Risk and suggested model tier
Medium: map authoring. The certifier is the safety net, and a refused landmark is skipped, never forced.

## 11. Known traps
- A camp's `radius` field is its territory radius (15-25 tiles), not its clearing (`r`, 3 tiles).
- Walls inside a territory change its floor count; `refresh_camps` recomputes area and radius with the certifier's formula.
- Under the live terrain mode (`Mode::All`) ember, bog and ice affect every faction, home factions included (owner
  2026-11-11: unchanged).
- Not established: how the landmarks look in Unity (the client draws walls and terrain from the planes it already
  reads; the church, tree and volcano have no bespoke art), and bot behaviour around them.

## Notes from previous attempts
None.
