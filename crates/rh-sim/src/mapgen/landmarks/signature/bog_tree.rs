//! Plague: the giant bog tree (no legacy counterpart, DEV-020).
//!
//! The tree IS the owner-approved blueprint (P-MAPGEN-SIG-SCALE-3; ADR 0028 G9, decision 4): `Definition::bog_grid`, a
//! 29 x 29 drawing centred in the zone's reserved site (P-MAPGEN-SIG-RESERVE-1; its centre tile, the trunk's centre, on
//! the site's centre tile), its front row toward the coliseum (the dominant axis of DIR16 from the centre tile toward
//! it), mirrored or not by one draw of the Plague stream. `T` (trunk) and `r` (roots) are the tree's walls, `%` its
//! marsh (floor, terrain bog), all off every apron marked before; `.` and the causeways `:` stay unwritten floor. A site
//! that cannot hold the drawing refuses the attempt; the drawing is never served smaller. The generic stamp
//! (`super::stamp`) draws it from its table entry (`super::spec`); the older rule-drawn tree is gone
//! (P-MAPGEN-SIG-BLUEPRINT-2), so this module holds no code.
