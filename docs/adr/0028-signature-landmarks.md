# ADR0028: Signature landmarks

Status: **Proposed.** Owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); packets P-SIGNATURE-1 and
P-SIGNATURE-1-fix. The matching `DEVIATIONS.md` row is proposed in the P-SIGNATURE-1-fix hand-off (owner signs).

**Per-operation checklist.** D1: new terrain with no legacy counterpart, so an intentional difference (DEVIATIONS row).
D2: n/a. No `rh-sim` change, so the content hash, wire and protocol version are unchanged.

## Context

Each zone should be recognisable at a glance. The owner asked for a volcano with lava, a church with a graveyard, a
giant bog tree and a frozen cave. Holy keeps its temple (the sanctum hall).

## Decision

1. **What they are.** Fire: a volcano cone (wall) with two or three lava streams ending in pools, edged with ember.
   Sentenced: a walled church around the zone's elite camp, a three-tile door facing the map centre, and a graveyard of
   2x3 grave stones beyond the door. Plague: a bog tree (wall) ringed by bog. Frost: a rock cave around an elite camp,
   open to the centre, with ice floor.
2. **Real terrain.** The landmarks are tiles, terrain and map features written into the map on the server, in
   `rh-server` map authoring (`crates/rh-server/src/signature.rs`), before a match exists. They reach clients through
   the existing collision and terrain planes. They collide, burn or slow exactly as the terrain they are made of.
3. **Flag.** Only on pooled maps and only behind `--map-pool --signature-landmarks`. Without the flag nothing changes.
4. **Certifier rule.** The pass runs only when the base map certifies (every zone strict) with zero failures; otherwise
   the map is returned unchanged and nothing is placed. A landmark is kept only if the map certifies with zero
   failures afterwards; otherwise it is skipped, never forced.
5. **Church and graveyard rules.** Grave stones sit on a pitch of 4 across the door axis and 4 along it, so no two
   stones touch orthogonally and walkable gaps remain. A church is kept only if at least one of its three door tiles is
   floor and joined to the first spawn's walkable region; a door with only some tiles open is kept as a narrower door.

## Placement rates (seeds 1-8, after the fix)

bog tree 8, volcano 7, church 6, frozen cave 4 (before: 8, 7, 6, 4; unchanged). All eight base maps certify with zero
failures, so none is left alone by the certifier rule.

## Consequences

Landmarks are not yet at the owner's full wording (stream count, cave placement, tree placement): P-SIGNATURE-2.
