//! P-WIRE17-MAP-3 oracle (map blob): each zone's landmark anchor. The byte layout is pinned by the hand-written builder
//! below, independent of the encoder; the prose is docs/backlog/packets/P-WIRE17-MAP-3.md "Wire layout".
//!
//! A map with anchors is a section-version-3 extension with second-presence bit 0x02:
//! `version u8 = 3 | presence u8 | presence2 u8 | semantic_hash u32 | the version-2 sections | patience plane (0x01) |
//!  anchors (0x02) | terrain_mode u8 | context_hash u32`, the anchors section being
//! `count u8 (1..=5) | count x [zone u8, kind u8, centre x u16, centre y u16, footprint x u16, y u16, w u16, h u16,
//!  front u8, entrance count u8 (0..=16), entrance count x (x u16, y u16)]`, all little endian, tile units.
//! The semantic hash covers `[3, presence, presence2]` and, after the patience cells, the anchors section's wire bytes
//! (count included), as every list section. A map without anchors encodes exactly as before this packet.

use rh_protocol::map::{
    EncodedMap, MapAnchor, MapBlob, MapCamp, MapPublic, MapRect, MapTile, ANCHOR_KIND_BOG_TREE,
    ANCHOR_KIND_CAVE, ANCHOR_KIND_CHURCH, ANCHOR_KIND_HALL, ANCHOR_KIND_VOLCANO,
    MAX_ANCHOR_ENTRANCE, MAX_MAP_ANCHORS,
};
use rh_protocol::samples::{malformed_map, server_samples};
use rh_protocol::{DecodeError, EncodeError, GroundMode, Reader, ServerMsg, Writer};

fn w() -> u16 {
    8
}
fn h() -> u16 {
    6
}
fn total() -> usize {
    usize::from(w()) * usize::from(h())
}

// ---- hand-written reference encoder (the spec) ---------------------------------------------------------------------

fn fnv(state: &mut u32, bytes: &[u8]) {
    for &b in bytes {
        *state = (*state ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
}

fn rle(cells: &[u8]) -> Vec<u8> {
    let mut runs: Vec<(u8, u16)> = Vec::new();
    for &c in cells {
        match runs.last_mut() {
            Some((v, n)) if *v == c && *n < u16::MAX - 1 => *n += 1,
            _ => runs.push((c, 1)),
        }
    }
    let mut out = (runs.len() as u32).to_le_bytes().to_vec();
    for (v, n) in runs {
        out.push(v);
        out.extend_from_slice(&n.to_le_bytes());
    }
    out
}

fn camps_raw(camps: &[MapCamp]) -> Vec<u8> {
    let mut out = vec![camps.len() as u8];
    for c in camps {
        out.extend_from_slice(&c.x.to_le_bytes());
        out.extend_from_slice(&c.y.to_le_bytes());
        out.extend_from_slice(&c.r.to_le_bytes());
        out.push(c.zone);
    }
    out
}

/// One anchor row as the wire carries it.
fn row_raw(a: &MapAnchor) -> Vec<u8> {
    let mut out = vec![a.zone, a.kind];
    for v in [
        a.centre.x,
        a.centre.y,
        a.footprint.x,
        a.footprint.y,
        a.footprint.w,
        a.footprint.h,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.push(a.front);
    out.push(a.entrance.len() as u8);
    for t in &a.entrance {
        out.extend_from_slice(&t.x.to_le_bytes());
        out.extend_from_slice(&t.y.to_le_bytes());
    }
    out
}

/// The anchors section: count byte, then the rows.
fn anchors_raw(anchors: &[MapAnchor]) -> Vec<u8> {
    let mut out = vec![anchors.len() as u8];
    for a in anchors {
        out.extend_from_slice(&row_raw(a));
    }
    out
}

fn tiles() -> Vec<u8> {
    let mut t = vec![0u8; total()];
    for x in 0..usize::from(w()) {
        t[x] = 1;
        t[(usize::from(h()) - 1) * usize::from(w()) + x] = 1;
    }
    t
}

fn camps() -> Vec<MapCamp> {
    vec![
        MapCamp {
            x: 48,
            y: 48,
            r: 80,
            zone: 1,
        },
        MapCamp {
            x: 208,
            y: 112,
            r: 80,
            zone: 4,
        },
    ]
}

/// Camp 1 holds the left block, camp 2 the right block.
fn plane() -> Vec<u8> {
    (0..total())
        .map(|i| match (i % usize::from(w()), i / usize::from(w())) {
            (0..=2, 1..=3) => 1,
            (5..=7, 2..=4) => 2,
            _ => 0,
        })
        .collect()
}

fn t(x: u16, y: u16) -> MapTile {
    MapTile { x, y }
}

fn anchor(
    zone: u8,
    kind: u8,
    centre: (u16, u16),
    fp: (u16, u16, u16, u16),
    front: u8,
    entrance: &[(u16, u16)],
) -> MapAnchor {
    MapAnchor {
        zone,
        kind,
        centre: t(centre.0, centre.1),
        footprint: MapRect {
            x: fp.0,
            y: fp.1,
            w: fp.2,
            h: fp.3,
        },
        front,
        entrance: entrance.iter().map(|&(x, y)| t(x, y)).collect(),
    }
}

/// Five anchors on the 8 x 6 map, one per zone in zone-code order, every kind code, fronts 0..=15, entrances of 0 and
/// 3 tiles, a centre on the footprint's last column and row, a footprint the size of the map. Also the golden vector
/// `welcome_public_anchors` (on the all-sections sample map).
fn five() -> Vec<MapAnchor> {
    vec![
        anchor(1, ANCHOR_KIND_VOLCANO, (1, 1), (0, 0, 3, 3), 0, &[]),
        anchor(
            2,
            ANCHOR_KIND_CHURCH,
            (7, 2),
            (4, 0, 4, 3),
            4,
            &[(4, 0), (4, 1), (4, 2)],
        ),
        anchor(3, ANCHOR_KIND_BOG_TREE, (1, 4), (0, 3, 3, 3), 8, &[]),
        anchor(
            4,
            ANCHOR_KIND_CAVE,
            (5, 4),
            (4, 3, 4, 3),
            12,
            &[(5, 3), (6, 3), (7, 3)],
        ),
        anchor(5, ANCHOR_KIND_HALL, (3, 2), (0, 0, 8, 6), 15, &[]),
    ]
}

/// One anchor: the Frost cave (zone 4) with a three-tile mouth. Also the golden vector `welcome_public_anchor_one`.
fn one() -> Vec<MapAnchor> {
    vec![five()[3].clone()]
}

/// A collision-only map with optional camps, patience plane and anchors (each as wire bytes; the hash covers the plane's
/// cells and the list sections' wire bytes).
#[derive(Clone)]
struct Spec {
    version: u8,
    presence2: u8,
    camps: Option<Vec<u8>>,
    patience: Option<(Vec<u8>, Vec<u8>)>,
    anchors: Option<Vec<u8>>,
    mode: GroundMode,
    semantic_override: Option<u32>,
}

impl Spec {
    fn new(camps: &[MapCamp], patience: Option<&[u8]>, anchors: &[MapAnchor]) -> Self {
        let presence2 = u8::from(patience.is_some()) | (u8::from(!anchors.is_empty()) << 1);
        Spec {
            version: if presence2 == 0 { 2 } else { 3 },
            presence2,
            camps: (!camps.is_empty()).then(|| camps_raw(camps)),
            patience: patience.map(|cells| (rle(cells), cells.to_vec())),
            anchors: (!anchors.is_empty()).then(|| anchors_raw(anchors)),
            mode: GroundMode::Map,
            semantic_override: None,
        }
    }
    /// A version-3 map whose anchors section is the given raw bytes (no camps, no plane).
    fn raw(anchors: Vec<u8>) -> Self {
        Spec {
            version: 3,
            presence2: 0x02,
            camps: None,
            patience: None,
            anchors: Some(anchors),
            mode: GroundMode::Map,
            semantic_override: None,
        }
    }
    fn presence(&self) -> u8 {
        u8::from(self.camps.is_some()) << 2
    }
    fn header(&self) -> Vec<u8> {
        if self.version == 3 {
            vec![3, self.presence(), self.presence2]
        } else {
            vec![self.version, self.presence()]
        }
    }
    fn layer_hash(&self) -> u32 {
        let mut s = 0x811c_9dc5;
        fnv(&mut s, &u32::from(w()).to_le_bytes());
        fnv(&mut s, &u32::from(h()).to_le_bytes());
        fnv(&mut s, &tiles());
        s
    }
    fn semantic_hash(&self) -> u32 {
        let mut s = 0x811c_9dc5;
        fnv(&mut s, b"rh-ground/1\0");
        fnv(&mut s, &u32::from(w()).to_le_bytes());
        fnv(&mut s, &u32::from(h()).to_le_bytes());
        fnv(&mut s, &self.header());
        if let Some(c) = &self.camps {
            fnv(&mut s, c);
        }
        if let Some((_, cells)) = &self.patience {
            fnv(&mut s, cells);
        }
        if let Some(a) = &self.anchors {
            fnv(&mut s, a);
        }
        s
    }
    fn context_hash(&self, semantic: u32) -> u32 {
        let mut s = 0x811c_9dc5;
        fnv(&mut s, b"rh-map-context/1\0");
        fnv(&mut s, &self.layer_hash().to_le_bytes());
        fnv(&mut s, &semantic.to_le_bytes());
        fnv(&mut s, &[self.mode as u8]);
        s
    }
    /// The complete map blob (as `MapBlob::write` emits it).
    fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&w().to_le_bytes());
        out.extend_from_slice(&h().to_le_bytes());
        out.extend_from_slice(&self.layer_hash().to_le_bytes());
        out.extend_from_slice(&rle(&tiles()));
        let semantic = self
            .semantic_override
            .unwrap_or_else(|| self.semantic_hash());
        let mut ext = self.header();
        ext.extend_from_slice(&semantic.to_le_bytes());
        if let Some(c) = &self.camps {
            ext.extend_from_slice(c);
        }
        if let Some((wire, _)) = &self.patience {
            ext.extend_from_slice(wire);
        }
        if let Some(a) = &self.anchors {
            ext.extend_from_slice(a);
        }
        ext.push(self.mode as u8);
        ext.extend_from_slice(&self.context_hash(semantic).to_le_bytes());
        out.extend_from_slice(&(ext.len() as u32).to_le_bytes());
        out.extend_from_slice(&ext);
        out
    }
}

fn base() -> MapBlob {
    MapBlob::new_with_ground(w(), h(), tiles(), None, None, GroundMode::Map).unwrap()
}
fn public(camps: Vec<MapCamp>, patience: Option<Vec<u8>>, anchors: Vec<MapAnchor>) -> MapPublic {
    MapPublic {
        camps,
        patience,
        anchors,
        ..MapPublic::default()
    }
}
fn with(
    camps: Vec<MapCamp>,
    patience: Option<Vec<u8>>,
    anchors: Vec<MapAnchor>,
) -> Result<MapBlob, EncodeError> {
    base().with_public(public(camps, patience, anchors))
}
fn with_anchors(anchors: Vec<MapAnchor>) -> Result<MapBlob, EncodeError> {
    with(camps(), None, anchors)
}
fn encode(map: &MapBlob) -> Vec<u8> {
    let mut out = Writer::default();
    map.write(&mut out);
    out.finish()
}
fn decode(bytes: &[u8]) -> Result<MapBlob, DecodeError> {
    MapBlob::read(&mut Reader::new(bytes))
}
fn refused(spec: Spec, want: DecodeError, what: &str) {
    assert_eq!(decode(&spec.bytes()), Err(want), "{what}");
}
/// The five anchors with `edit` applied to anchor `i`, as raw wire bytes.
fn five_edited(i: usize, edit: impl FnOnce(&mut MapAnchor)) -> Vec<u8> {
    let mut all = five();
    edit(&mut all[i]);
    anchors_raw(&all)
}

// ---- layout and round trip ------------------------------------------------------------------------------------------

#[test]
fn five_anchors_encode_to_the_pinned_layout() {
    let map = with_anchors(five()).expect("five valid anchors are accepted");
    let want = Spec::new(&camps(), None, &five());
    assert_eq!(
        encode(&map),
        want.bytes(),
        "MapBlob::write: section version 3, presence2 0x02, the anchors after the version-2 sections"
    );
    assert_eq!(map.encoded_len(), want.bytes().len(), "encoded_len");
    assert_eq!(map.semantic_hash, want.semantic_hash(), "semantic hash");
    assert_eq!(
        map.context_hash,
        want.context_hash(want.semantic_hash()),
        "context hash"
    );
}

#[test]
fn one_anchor_encodes_to_the_pinned_layout() {
    let map = with(Vec::new(), None, one()).expect("one anchor, no camps, is accepted");
    assert_eq!(
        encode(&map),
        Spec::new(&[], None, &one()).bytes(),
        "one anchor: count 1, one row with a three-tile entrance"
    );
}

#[test]
fn the_anchors_follow_the_patience_plane() {
    let map = with(camps(), Some(plane()), five()).expect("valid");
    assert_eq!(
        encode(&map),
        Spec::new(&camps(), Some(&plane()), &five()).bytes(),
        "presence2 0x03: the plane, then the anchors"
    );
}

#[test]
fn the_server_cache_writes_the_same_bytes() {
    let p = public(camps(), Some(plane()), five());
    let enc = EncodedMap::from_public(w(), h(), &tiles(), None, None, &p).expect("valid");
    let mut out = Writer::default();
    enc.write_with_mode(&mut out, GroundMode::Map);
    assert_eq!(
        out.finish(),
        Spec::new(&camps(), Some(&plane()), &five()).bytes(),
        "EncodedMap::from_public"
    );
    assert!(
        enc.matches_public(w(), h(), &tiles(), None, None, &p),
        "the cache matches its own map"
    );
    let mut moved = five();
    moved[0].front = 1;
    assert!(
        !enc.matches_public(
            w(),
            h(),
            &tiles(),
            None,
            None,
            &public(camps(), Some(plane()), moved)
        ),
        "different anchors are a different map"
    );
}

#[test]
fn the_pinned_layout_decodes_to_the_anchors() {
    assert_eq!(
        decode(&Spec::new(&camps(), None, &five()).bytes()).map(|m| m.public),
        Ok(public(camps(), None, five()))
    );
    assert_eq!(
        decode(&Spec::new(&camps(), Some(&plane()), &five()).bytes()).map(|m| m.public),
        Ok(public(camps(), Some(plane()), five()))
    );
}

#[test]
fn anchors_round_trip_at_the_caps() {
    for anchors in [five(), one()] {
        let map = with(camps(), Some(plane()), anchors.clone()).expect("valid");
        let back = decode(&encode(&map)).expect("decodes");
        assert_eq!(back.public.anchors, anchors);
        assert_eq!(back, map);
    }
    // At the caps: sixteen entrance tiles, front 15, the centre on the footprint's last tile, a 1 x 1 footprint at the
    // map's far corner.
    let full: Vec<(u16, u16)> = (0..MAX_ANCHOR_ENTRANCE as u16)
        .map(|i| (i % 8, i / 8))
        .collect();
    let edge = vec![
        anchor(2, ANCHOR_KIND_CHURCH, (3, 2), (0, 0, 4, 3), 15, &full),
        anchor(5, ANCHOR_KIND_HALL, (7, 5), (7, 5, 1, 1), 0, &[(7, 5)]),
    ];
    let map = with(Vec::new(), None, edge.clone()).expect("anchors at the caps are accepted");
    assert_eq!(
        encode(&map),
        Spec::new(&[], None, &edge).bytes(),
        "layout at the caps"
    );
    assert_eq!(decode(&encode(&map)).map(|m| m.public.anchors), Ok(edge));
}

#[test]
fn the_semantic_hash_covers_the_anchors() {
    let a = with_anchors(five()).expect("valid");
    let mut moved = five();
    moved[3].entrance[1].x = 4;
    let b = with_anchors(moved.clone()).expect("valid");
    assert_ne!(a.semantic_hash, b.semantic_hash, "one entrance tile moved");
    assert_ne!(a.context_hash, b.context_hash, "one entrance tile moved");
    // An anchor altered without re-hashing is refused.
    let tampered = Spec {
        anchors: Some(anchors_raw(&moved)),
        semantic_override: Some(Spec::new(&camps(), None, &five()).semantic_hash()),
        ..Spec::new(&camps(), None, &five())
    };
    refused(
        tampered,
        DecodeError::BadMap("semantic hash"),
        "stale semantic hash",
    );
}

// ---- guards (green today): no anchors, no change ------------------------------------------------------------------

#[test]
fn guard_a_map_without_anchors_encodes_as_before() {
    for camps in [Vec::new(), camps()] {
        let v2 = with(camps.clone(), None, Vec::new()).expect("valid");
        assert_eq!(
            encode(&v2),
            Spec::new(&camps, None, &[]).bytes(),
            "version 2"
        );
        assert_eq!(decode(&encode(&v2)).map(|m| m.public.anchors), Ok(vec![]));
    }
    let v3 = with(camps(), Some(plane()), Vec::new()).expect("valid");
    assert_eq!(
        encode(&v3),
        Spec::new(&camps(), Some(&plane()), &[]).bytes(),
        "version 3 with only the patience bit"
    );
}

#[test]
fn guard_existing_vectors_carry_no_anchors() {
    for (name, msg) in server_samples() {
        if let ServerMsg::Welcome { map, .. } = msg {
            if !name.starts_with("welcome_public_anchor") {
                assert!(
                    map.public.anchors.is_empty(),
                    "{name} keeps its bytes: no anchors"
                );
            }
        }
    }
}

#[test]
fn guard_unknown_second_presence_bits_stay_refused() {
    for bit in [0x04u8, 0x80] {
        refused(
            Spec {
                presence2: 0x02 | bit,
                ..Spec::raw(anchors_raw(&one()))
            },
            DecodeError::BadMap("presence"),
            "unknown presence2 bit",
        );
    }
}

// ---- decoder refusals -----------------------------------------------------------------------------------------------

#[test]
fn an_anchor_count_outside_one_to_five_is_refused() {
    refused(
        Spec::raw(vec![0]),
        DecodeError::BadMap("anchor count"),
        "count 0 (absence is the bit, not an empty section)",
    );
    let mut six = five();
    six.push(anchor(5, ANCHOR_KIND_HALL, (3, 2), (0, 0, 8, 6), 0, &[]));
    assert_eq!(six.len(), MAX_MAP_ANCHORS + 1);
    refused(
        Spec::raw(anchors_raw(&six)),
        DecodeError::BadMap("anchor count"),
        "six anchors",
    );
}

#[test]
fn a_zone_outside_one_to_five_is_refused() {
    refused(
        Spec::raw(anchors_raw(&[anchor(
            0,
            ANCHOR_KIND_HALL,
            (1, 1),
            (0, 0, 3, 3),
            0,
            &[],
        )])),
        DecodeError::BadMap("anchor zone"),
        "zone 0",
    );
    refused(
        Spec::raw(anchors_raw(&[anchor(
            6,
            ANCHOR_KIND_HALL,
            (1, 1),
            (0, 0, 3, 3),
            0,
            &[],
        )])),
        DecodeError::BadMap("anchor zone"),
        "zone 6",
    );
}

#[test]
fn zones_out_of_order_or_repeated_are_refused() {
    let mut swapped = five();
    swapped.swap(1, 2);
    refused(
        Spec::raw(anchors_raw(&swapped)),
        DecodeError::BadMap("anchor order"),
        "zones 1, 3, 2",
    );
    refused(
        Spec::raw(five_edited(2, |a| a.zone = 2)),
        DecodeError::BadMap("anchor order"),
        "zone 2 twice",
    );
}

#[test]
fn an_unknown_kind_code_is_refused() {
    for kind in [0u8, 6, 255] {
        refused(
            Spec::raw(five_edited(0, |a| a.kind = kind)),
            DecodeError::BadMap("anchor kind"),
            "kind code outside 1..=5",
        );
    }
}

#[test]
fn a_footprint_off_the_map_or_empty_is_refused() {
    for (what, fp) in [
        ("past the right edge", (6, 0, 3, 3)),
        ("past the bottom edge", (0, 4, 3, 3)),
        ("zero width", (0, 0, 0, 3)),
        ("zero height", (0, 0, 3, 0)),
        ("x + w overflows u16", (u16::MAX, 0, 2, 3)),
    ] {
        refused(
            Spec::raw(anchors_raw(&[anchor(
                1,
                ANCHOR_KIND_VOLCANO,
                (1, 1),
                fp,
                0,
                &[],
            )])),
            DecodeError::BadMap("anchor footprint"),
            what,
        );
    }
}

#[test]
fn a_centre_outside_its_footprint_is_refused() {
    // The footprint is half-open: x..x+w, y..y+h. Every generated anchor's centre is strictly inside (brief, fact 2).
    for centre in [(3, 1), (1, 3), (0, 4), (7, 0)] {
        refused(
            Spec::raw(anchors_raw(&[anchor(
                1,
                ANCHOR_KIND_VOLCANO,
                centre,
                (0, 0, 3, 3),
                0,
                &[],
            )])),
            DecodeError::BadMap("anchor centre"),
            "centre outside the footprint",
        );
    }
}

#[test]
fn a_front_of_16_or_more_is_refused() {
    for front in [16u8, 255] {
        refused(
            Spec::raw(five_edited(4, |a| a.front = front)),
            DecodeError::BadMap("anchor front"),
            "front past DIR16",
        );
    }
}

#[test]
fn an_entrance_over_the_cap_or_off_the_map_is_refused() {
    let over: Vec<(u16, u16)> = (0..=MAX_ANCHOR_ENTRANCE as u16)
        .map(|i| (i % 8, i / 8))
        .collect();
    refused(
        Spec::raw(anchors_raw(&[anchor(
            4,
            ANCHOR_KIND_CAVE,
            (1, 1),
            (0, 0, 8, 6),
            0,
            &over,
        )])),
        DecodeError::BadMap("anchor entrance"),
        "seventeen entrance tiles",
    );
    for tile in [(8, 0), (0, 6)] {
        refused(
            Spec::raw(anchors_raw(&[anchor(
                4,
                ANCHOR_KIND_CAVE,
                (1, 1),
                (0, 0, 3, 3),
                0,
                &[(2, 2), tile],
            )])),
            DecodeError::BadMap("anchor entrance"),
            "an entrance tile off the map",
        );
    }
    // Entrance tiles outside the footprint but on the map are accepted (only the map bounds are checked).
    assert!(decode(
        &Spec::raw(anchors_raw(&[anchor(
            4,
            ANCHOR_KIND_CAVE,
            (1, 1),
            (0, 0, 3, 3),
            0,
            &[(5, 5)]
        )]))
        .bytes()
    )
    .is_ok());
}

#[test]
fn a_truncated_anchors_section_is_refused() {
    // A count the rows do not fill: the second row's fixed 16 bytes are not in the extension.
    let mut short = anchors_raw(&[five()[0].clone()]);
    short[0] = 2;
    refused(Spec::raw(short), DecodeError::Truncated, "count 2, one row");
    // An entrance count the extension cannot hold is truncated before any tile is read.
    let mut cut = anchors_raw(&[anchor(
        4,
        ANCHOR_KIND_CAVE,
        (1, 1),
        (0, 0, 3, 3),
        0,
        &[(2, 2)],
    )]);
    cut[16] = MAX_ANCHOR_ENTRANCE as u8;
    refused(
        Spec::raw(cut),
        DecodeError::Truncated,
        "entrance count 16, one tile",
    );
    // The frame cut inside the section.
    let bytes = Spec::new(&camps(), None, &five()).bytes();
    assert_eq!(
        decode(&bytes[..bytes.len() - 12]),
        Err(DecodeError::Truncated),
        "cut frame"
    );
}

// ---- encoder refusals (never clamps) --------------------------------------------------------------------------------

#[test]
fn the_encoder_refuses_what_the_decoder_refuses() {
    let edited = |i: usize, edit: &dyn Fn(&mut MapAnchor)| {
        let mut all = five();
        edit(&mut all[i]);
        all
    };
    let mut six = five();
    six.push(anchor(5, ANCHOR_KIND_HALL, (3, 2), (0, 0, 8, 6), 0, &[]));
    let mut swapped = five();
    swapped.swap(1, 2);
    let cases: Vec<(&str, Vec<MapAnchor>, &str)> = vec![
        ("six anchors", six, "anchor count"),
        ("zone 0", edited(0, &|a| a.zone = 0), "anchor zone"),
        ("zone 6", edited(4, &|a| a.zone = 6), "anchor zone"),
        ("out of order", swapped, "anchor order"),
        ("repeated zone", edited(2, &|a| a.zone = 2), "anchor order"),
        ("kind 0", edited(0, &|a| a.kind = 0), "anchor kind"),
        ("kind 6", edited(0, &|a| a.kind = 6), "anchor kind"),
        (
            "footprint off the map",
            edited(0, &|a| a.footprint.x = 6),
            "anchor footprint",
        ),
        (
            "empty footprint",
            edited(0, &|a| a.footprint.w = 0),
            "anchor footprint",
        ),
        (
            "centre outside",
            edited(0, &|a| a.centre = t(3, 1)),
            "anchor centre",
        ),
        ("front 16", edited(0, &|a| a.front = 16), "anchor front"),
        (
            "seventeen entrance tiles",
            edited(4, &|a| a.entrance = vec![t(1, 1); MAX_ANCHOR_ENTRANCE + 1]),
            "anchor entrance",
        ),
        (
            "entrance off the map",
            edited(1, &|a| a.entrance[0] = t(8, 0)),
            "anchor entrance",
        ),
    ];
    for (what, anchors, reason) in cases {
        assert_eq!(
            with_anchors(anchors.clone()).err(),
            Some(EncodeError::BadMap(reason)),
            "with_public: {what}"
        );
        assert_eq!(
            EncodedMap::from_public(
                w(),
                h(),
                &tiles(),
                None,
                None,
                &public(camps(), None, anchors)
            )
            .err(),
            Some(EncodeError::BadMap(reason)),
            "EncodedMap::from_public: {what}"
        );
    }
}

// ---- golden vectors the implementer adds to samples.rs (then regenerates v17.json) ---------------------------------

fn welcome_anchors(name: &str) -> MapBlob {
    let samples = server_samples();
    let Some((_, ServerMsg::Welcome { map, .. })) = samples.into_iter().find(|(n, _)| *n == name)
    else {
        panic!("samples.rs has no {name} Welcome (P-WIRE17-MAP-3 adds it)")
    };
    map
}

#[test]
fn the_server_vectors_carry_anchor_welcomes() {
    // `welcome_public_anchors`: the all-sections sample (`public_map(true)`, no patience plane) plus `five()`.
    let all = welcome_anchors("welcome_public_anchors");
    assert_eq!((all.w, all.h), (w(), h()), "the 8 x 6 public sample");
    assert_eq!(all.public.camps.len(), 3, "the all-sections sample's camps");
    assert!(!all.public.props.is_empty() && all.public.ground_variants.is_some());
    assert_eq!(
        all.public.patience, None,
        "no patience plane (presence2 0x02 only)"
    );
    assert_eq!(all.public.anchors, five());
    // `welcome_public_anchor_one`: the shipped sample (`public_map(false)`) plus `one()`.
    let single = welcome_anchors("welcome_public_anchor_one");
    assert!(single.public.props.is_empty() && single.public.patience.is_none());
    assert_eq!(single.public.anchors, one());
}

#[test]
fn the_malformed_map_vectors_cover_the_anchors() {
    let all = malformed_map();
    for (name, reason) in [
        ("map17_anchor_count_zero", "anchor count"),
        ("map17_anchor_count_over", "anchor count"),
        ("map17_anchor_zone", "anchor zone"),
        ("map17_anchor_order", "anchor order"),
        ("map17_anchor_duplicate", "anchor order"),
        ("map17_anchor_kind", "anchor kind"),
        ("map17_anchor_footprint", "anchor footprint"),
        ("map17_anchor_centre", "anchor centre"),
        ("map17_anchor_front", "anchor front"),
        ("map17_anchor_entrance_over", "anchor entrance"),
        ("map17_anchor_entrance_tile", "anchor entrance"),
        ("map17_anchor_truncated", "truncated"),
        ("map17_v3_presence_unknown", "presence"),
    ] {
        let Some((_, bytes, want)) = all.iter().find(|(n, _, _)| *n == name) else {
            panic!("samples.rs malformed_map has no {name} (P-WIRE17-MAP-3 adds it)")
        };
        assert_eq!(*want, reason, "{name} reason");
        let got = ServerMsg::decode(bytes).expect_err(name);
        let want = if reason == "truncated" {
            DecodeError::Truncated
        } else {
            DecodeError::BadMap(reason)
        };
        assert_eq!(got, want, "{name}");
    }
}
