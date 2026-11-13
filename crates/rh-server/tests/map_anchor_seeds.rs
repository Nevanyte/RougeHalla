//! P-WIRE17-MAP-3 reviewer note 1: on the landmark-mode generator the server runs (`StyledMaker { signature: true }`, the
//! pool's maker), every zone's anchor on seeds 1..=8 is one the wire accepts, so an anchor the encoder would refuse is
//! caught here, at gate time, instead of as pool maps quietly refused on admission. Several anchors have no wire-shaped
//! guarantee by construction: the Holy hall's centre is the hall feature's anchor point `(ax, ay)` and its footprint the
//! feature's `bbox` (`rh_sim::mapgen::landmarks::signature`), so "centre inside the footprint" is only measured.
//!
//! No geometry is pinned: each map is checked against the wire's own rules and against what the generator recorded.

use rh_protocol::map::{MapBlob, ANCHOR_KIND_HALL, ANCHOR_KIND_VOLCANO, MAX_ANCHOR_ENTRANCE};
use rh_protocol::{GroundMode, Reader, Writer};
use rh_server::map_pool::{admit_made, MapMaker, StyledMaker};
use rh_server::public_ground::anchor_sections;

const SEEDS: std::ops::RangeInclusive<u32> = 1..=8;

#[test]
fn every_landmark_anchor_on_seeds_1_to_8_is_one_the_wire_accepts() {
    let maker = StyledMaker { signature: true };
    for seed in SEEDS {
        // The pool's own path: the generator's map, dressed, with its anchors read before the arena drops them.
        let made = maker
            .make_dressed(seed)
            .unwrap_or_else(|e| panic!("seed {seed}: generator error {e}"))
            .unwrap_or_else(|| panic!("seed {seed}: no attempt certified"));
        let map = &made.arena.map;
        let (w, h) = (u16::try_from(map.w).unwrap(), u16::try_from(map.h).unwrap());
        let recorded = made.anchors.clone();
        assert_eq!(recorded.len(), 5, "seed {seed}: one anchor per zone");

        // Each anchor converts to wire form (known kind, non-negative tiles that fit u16)...
        let wire = anchor_sections(&recorded)
            .unwrap_or_else(|e| panic!("seed {seed}: anchor_sections refused {e:?}: {recorded:?}"));
        // ...and passes the wire's per-row rules, named here so a failure says which anchor and which rule.
        let mut previous = 0;
        for (a, src) in wire.iter().zip(&recorded) {
            let what = format!("seed {seed} zone {} ({:?}): {src:?}", a.zone, src.kind);
            assert!(
                a.zone > previous && (1..=5).contains(&a.zone),
                "{what}: zone order"
            );
            assert!(
                (ANCHOR_KIND_VOLCANO..=ANCHOR_KIND_HALL).contains(&a.kind),
                "{what}: kind code"
            );
            let f = a.footprint;
            assert!(
                f.w >= 1
                    && f.h >= 1
                    && u32::from(f.x) + u32::from(f.w) <= u32::from(w)
                    && u32::from(f.y) + u32::from(f.h) <= u32::from(h),
                "{what}: footprint inside the {w} x {h} map"
            );
            assert!(
                (f.x..f.x + f.w).contains(&a.centre.x) && (f.y..f.y + f.h).contains(&a.centre.y),
                "{what}: centre inside the half-open footprint"
            );
            assert!(a.front < 16, "{what}: front is a DIR16 index");
            assert!(
                a.entrance.len() <= MAX_ANCHOR_ENTRANCE,
                "{what}: entrance cap"
            );
            assert!(
                a.entrance.iter().all(|t| t.x < w && t.y < h),
                "{what}: entrance tiles on the map"
            );
            previous = a.zone;
        }

        // The pool's admission encodes the Welcome blob with them (the encoder's own checks), and a client decodes them back.
        let assets = admit_made(made)
            .unwrap_or_else(|e| panic!("seed {seed}: admission refused the map: {e}"));
        let mut out = Writer::default();
        assets
            .welcome_map
            .write_with_mode(&mut out, GroundMode::Map);
        let bytes = out.finish();
        let blob = MapBlob::read(&mut Reader::new(&bytes))
            .unwrap_or_else(|e| panic!("seed {seed}: the served blob does not decode: {e:?}"));
        assert_eq!(
            blob.public.anchors, wire,
            "seed {seed}: the served anchors are the generator's"
        );
    }
}
