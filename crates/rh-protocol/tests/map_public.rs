//! P-WIRE17-MAP-1 oracle: protocol 17 map blob public sections (camp markers, coliseum and gates, bush plane, and the
//! reserved prop list and ground-variant plane). The byte layout is pinned by a hand-written builder below, independent of
//! the encoder; see docs/backlog/packets/P-WIRE17-MAP-1.md "Byte layout" for the prose of the same rules.

use rh_protocol::map::{
    EncodedMap, MapBlob, MapCamp, MapColiseum, MapGate, MapProp, MapPublic, MapTile,
    MAX_COLISEUM_GATES, MAX_GATE_TILES, MAX_MAP_CAMPS, MAX_MAP_PROPS,
};
use rh_protocol::{DecodeError, EncodeError, GroundMode, Reader, Writer, PROTOCOL_VERSION};

const W: u16 = 8;
const H: u16 = 6;
const TOTAL: usize = W as usize * H as usize;
const SECTION_VERSION_17: u8 = 2;

// ---- hand-written reference encoder (the spec) ---------------------------------------------------------------------

fn fnv(state: &mut u32, bytes: &[u8]) {
    for &b in bytes {
        *state = (*state ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
}

/// `u32 run count` then `[value u8, len u16 LE]` runs, maximal runs (as every existing plane).
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

fn coliseum_raw(c: &MapColiseum) -> Vec<u8> {
    let mut out = Vec::new();
    for v in [c.x, c.y, c.w, c.h] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.push(c.gates.len() as u8);
    for g in &c.gates {
        out.push(g.side);
        out.push(g.tiles.len() as u8);
        for t in &g.tiles {
            out.extend_from_slice(&t.x.to_le_bytes());
            out.extend_from_slice(&t.y.to_le_bytes());
        }
    }
    out
}

fn props_raw(props: &[MapProp]) -> Vec<u8> {
    let mut out = (props.len() as u16).to_le_bytes().to_vec();
    for p in props {
        out.push(p.kind);
        out.extend_from_slice(&p.x.to_le_bytes());
        out.extend_from_slice(&p.y.to_le_bytes());
        out.push(p.variant);
        out.push(p.flags);
    }
    out
}

/// A plane as wire bytes plus the cells the semantic hash covers.
#[derive(Clone)]
struct Plane {
    wire: Vec<u8>,
    cells: Vec<u8>,
}
fn plane(cells: &[u8]) -> Plane {
    Plane {
        wire: rle(cells),
        cells: cells.to_vec(),
    }
}

#[derive(Clone)]
struct Spec {
    w: u16,
    h: u16,
    tiles: Vec<u8>,
    version: u8,
    extra_flags: u8,
    terrain: Option<Vec<u8>>,
    regions: Option<Vec<u8>>,
    camps: Option<Vec<u8>>,
    coliseum: Option<Vec<u8>>,
    bushes: Option<Plane>,
    props: Option<Vec<u8>>,
    variants: Option<Plane>,
    mode: GroundMode,
    semantic_override: Option<u32>,
}

impl Spec {
    fn empty(w: u16, h: u16, tiles: Vec<u8>) -> Self {
        Spec {
            w,
            h,
            tiles,
            version: SECTION_VERSION_17,
            extra_flags: 0,
            terrain: None,
            regions: None,
            camps: None,
            coliseum: None,
            bushes: None,
            props: None,
            variants: None,
            mode: GroundMode::Off,
            semantic_override: None,
        }
    }

    fn flags(&self) -> u8 {
        u8::from(self.terrain.is_some())
            | u8::from(self.regions.is_some()) << 1
            | u8::from(self.camps.is_some()) << 2
            | u8::from(self.coliseum.is_some()) << 3
            | u8::from(self.bushes.is_some()) << 4
            | u8::from(self.props.is_some()) << 5
            | u8::from(self.variants.is_some()) << 6
            | self.extra_flags
    }

    fn layer_hash(&self) -> u32 {
        let mut s = 0x811c_9dc5;
        fnv(&mut s, &u32::from(self.w).to_le_bytes());
        fnv(&mut s, &u32::from(self.h).to_le_bytes());
        fnv(&mut s, &self.tiles);
        s
    }

    /// FNV-1a 32 over: "rh-ground/1\0", w u32, h u32, [section version, flags], then in wire order the decoded cells of
    /// each present plane and the wire bytes (count included) of each present list section.
    fn semantic_hash(&self) -> u32 {
        let mut s = 0x811c_9dc5;
        fnv(&mut s, b"rh-ground/1\0");
        fnv(&mut s, &u32::from(self.w).to_le_bytes());
        fnv(&mut s, &u32::from(self.h).to_le_bytes());
        fnv(&mut s, &[self.version, self.flags()]);
        for part in [
            self.terrain.as_deref(),
            self.regions.as_deref(),
            self.camps.as_deref(),
            self.coliseum.as_deref(),
            self.bushes.as_ref().map(|p| p.cells.as_slice()),
            self.props.as_deref(),
            self.variants.as_ref().map(|p| p.cells.as_slice()),
        ]
        .into_iter()
        .flatten()
        {
            fnv(&mut s, part);
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

    fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&self.w.to_le_bytes());
        out.extend_from_slice(&self.h.to_le_bytes());
        out.extend_from_slice(&self.layer_hash().to_le_bytes());
        out.extend_from_slice(&rle(&self.tiles));
        let semantic = self
            .semantic_override
            .unwrap_or_else(|| self.semantic_hash());
        let mut ext = vec![self.version, self.flags()];
        ext.extend_from_slice(&semantic.to_le_bytes());
        for t in [&self.terrain, &self.regions].into_iter().flatten() {
            ext.extend_from_slice(&rle(t));
        }
        for part in [
            self.camps.as_deref(),
            self.coliseum.as_deref(),
            self.bushes.as_ref().map(|p| p.wire.as_slice()),
            self.props.as_deref(),
            self.variants.as_ref().map(|p| p.wire.as_slice()),
        ]
        .into_iter()
        .flatten()
        {
            ext.extend_from_slice(part);
        }
        ext.push(self.mode as u8);
        ext.extend_from_slice(&self.context_hash(semantic).to_le_bytes());
        out.extend_from_slice(&(ext.len() as u32).to_le_bytes());
        out.extend_from_slice(&ext);
        out
    }
}

// ---- fixtures -------------------------------------------------------------------------------------------------------

fn tiles() -> Vec<u8> {
    let mut t = vec![0u8; TOTAL];
    for x in 0..W as usize {
        t[x] = 1;
        t[(H as usize - 1) * W as usize + x] = 1;
    }
    t[2 * W as usize + 3] = 2;
    t
}
fn regions() -> Vec<u8> {
    (0..TOTAL).map(|i| (i % 7) as u8).collect()
}
fn bushes() -> Vec<u8> {
    let mut b = vec![0u8; TOTAL];
    b[W as usize + 1] = 1;
    b[W as usize + 2] = 1;
    b[3 * W as usize + 6] = 7;
    b
}
fn variants() -> Vec<u8> {
    (0..TOTAL).map(|i| (i / 5 % 3) as u8).collect()
}
fn sample_public() -> MapPublic {
    MapPublic {
        camps: vec![
            MapCamp {
                x: 80,
                y: 48,
                r: 80,
                zone: 1,
            },
            MapCamp {
                x: 208,
                y: 144,
                r: 80,
                zone: 5,
            },
        ],
        coliseum: Some(MapColiseum {
            x: 2,
            y: 1,
            w: 4,
            h: 3,
            gates: vec![
                MapGate {
                    side: 0,
                    tiles: vec![MapTile { x: 3, y: 1 }, MapTile { x: 4, y: 1 }],
                },
                MapGate {
                    side: 2,
                    tiles: vec![MapTile { x: 3, y: 3 }, MapTile { x: 4, y: 3 }],
                },
            ],
        }),
        bushes: Some(bushes()),
        props: vec![
            MapProp {
                kind: 3,
                x: 100,
                y: 60,
                variant: 2,
                flags: 1,
            },
            MapProp {
                kind: 9,
                x: 250,
                y: 180,
                variant: 0,
                flags: 0,
            },
        ],
        ground_variants: Some(variants()),
        patience: None,
        anchors: Vec::new(),
    }
}
fn sample_map() -> MapBlob {
    MapBlob::new_with_ground(W, H, tiles(), None, Some(regions()), GroundMode::Map)
        .unwrap()
        .with_public(sample_public())
        .unwrap()
}
fn sample_spec() -> Spec {
    let p = sample_public();
    Spec {
        regions: Some(regions()),
        camps: Some(camps_raw(&p.camps)),
        coliseum: Some(coliseum_raw(p.coliseum.as_ref().unwrap())),
        bushes: Some(plane(&bushes())),
        props: Some(props_raw(&p.props)),
        variants: Some(plane(&variants())),
        mode: GroundMode::Map,
        ..Spec::empty(W, H, tiles())
    }
}

fn encode(map: &MapBlob) -> Vec<u8> {
    let mut w = Writer::default();
    map.write(&mut w);
    w.finish()
}
fn decode(bytes: &[u8]) -> Result<MapBlob, DecodeError> {
    MapBlob::read(&mut Reader::new(bytes))
}

// ---- version ---------------------------------------------------------------------------------------------------------

#[test]
fn protocol_version_is_17() {
    assert_eq!(PROTOCOL_VERSION, 17);
}

// ---- layout and round trip ------------------------------------------------------------------------------------------

#[test]
fn every_public_section_encodes_to_the_pinned_layout() {
    let map = sample_map();
    let want = sample_spec();
    assert_eq!(encode(&map), want.bytes(), "MapBlob::write layout");
    assert_eq!(map.encoded_len(), want.bytes().len(), "encoded_len");
    assert_eq!(map.semantic_hash, want.semantic_hash(), "semantic hash");
    assert_eq!(
        map.context_hash,
        want.context_hash(want.semantic_hash()),
        "context hash"
    );
}

#[test]
fn every_public_section_round_trips() {
    let map = sample_map();
    let back = decode(&encode(&map));
    assert_eq!(back.as_ref().map(|m| &m.public), Ok(&sample_public()));
    assert_eq!(back, Ok(map));
}

#[test]
fn the_pinned_layout_decodes_to_the_sections() {
    let back = decode(&sample_spec().bytes()).map(|m| m.public);
    assert_eq!(back, Ok(sample_public()));
}

#[test]
fn absent_sections_decode_to_empty_lists() {
    // A collision-only map: version 2, flags 0, nothing after the semantic hash but the tail.
    let plain = MapBlob::new(W, H, tiles());
    let want = Spec::empty(W, H, tiles());
    assert_eq!(encode(&plain), want.bytes());
    assert_eq!(
        decode(&want.bytes()).map(|m| m.public),
        Ok(MapPublic::default())
    );
    // Empty lists and None encode as absent, byte for byte the same as never attaching them.
    let attached = MapBlob::new(W, H, tiles())
        .with_public(MapPublic::default())
        .unwrap();
    assert_eq!(encode(&attached), want.bytes());
    // Ground planes alone keep the new bits clear.
    let ground =
        MapBlob::new_with_ground(W, H, tiles(), None, Some(regions()), GroundMode::All).unwrap();
    let want = Spec {
        regions: Some(regions()),
        mode: GroundMode::All,
        ..Spec::empty(W, H, tiles())
    };
    assert_eq!(encode(&ground), want.bytes());
    assert_eq!(
        decode(&want.bytes()).map(|m| m.public),
        Ok(MapPublic::default())
    );
}

#[test]
fn each_section_alone_round_trips() {
    let full = sample_public();
    let singles = [
        MapPublic {
            camps: full.camps.clone(),
            ..MapPublic::default()
        },
        MapPublic {
            coliseum: full.coliseum.clone(),
            ..MapPublic::default()
        },
        MapPublic {
            bushes: full.bushes.clone(),
            ..MapPublic::default()
        },
        MapPublic {
            props: full.props.clone(),
            ..MapPublic::default()
        },
        MapPublic {
            ground_variants: full.ground_variants.clone(),
            ..MapPublic::default()
        },
    ];
    for (bit, public) in singles.into_iter().enumerate() {
        let map = MapBlob::new(W, H, tiles())
            .with_public(public.clone())
            .unwrap();
        let bytes = encode(&map);
        // The extension starts after the collision head (12 bytes), its runs and the u32 extension length.
        let runs = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let ext = 12 + 3 * runs + 4;
        assert_eq!(bytes[ext], SECTION_VERSION_17, "section version");
        assert_eq!(bytes[ext + 1], 4 << bit, "presence bit for section {bit}");
        assert_eq!(decode(&bytes).map(|m| m.public), Ok(public));
    }
}

#[test]
fn encoded_map_cache_matches_the_blob() {
    let map = sample_map();
    let enc =
        EncodedMap::from_public(W, H, &tiles(), None, Some(&regions()), &sample_public()).unwrap();
    let mut w = Writer::default();
    enc.write_with_mode(&mut w, GroundMode::Map);
    let bytes = w.finish();
    assert_eq!(bytes, sample_spec().bytes());
    assert_eq!(enc.len(), bytes.len());
    assert_eq!(enc.semantic_hash(), map.semantic_hash);
}

// ---- the semantic hash covers every new section ---------------------------------------------------------------------

#[test]
fn semantic_hash_covers_the_new_sections() {
    let base = sample_map();
    let mut moved = sample_public();
    moved.camps[1].x += 32;
    let other = MapBlob::new_with_ground(W, H, tiles(), None, Some(regions()), GroundMode::Map)
        .unwrap()
        .with_public(moved)
        .unwrap();
    assert_ne!(base.semantic_hash, other.semantic_hash, "camp moved");
    assert_ne!(base.context_hash, other.context_hash, "camp moved");

    // Altering one byte of a section without re-hashing is refused, for every section.
    let good = sample_spec();
    let stale = Some(good.semantic_hash());
    let mut camps = good.camps.clone().unwrap();
    camps[1] ^= 1;
    let mut col = good.coliseum.clone().unwrap();
    col[0] ^= 1;
    let mut bush = bushes();
    bush[0] = 9;
    let mut props = good.props.clone().unwrap();
    props[3] ^= 1;
    let mut var = variants();
    var[0] = 9;
    let tampered = [
        Spec {
            camps: Some(camps),
            semantic_override: stale,
            ..good.clone()
        },
        Spec {
            coliseum: Some(col),
            semantic_override: stale,
            ..good.clone()
        },
        Spec {
            bushes: Some(plane(&bush)),
            semantic_override: stale,
            ..good.clone()
        },
        Spec {
            props: Some(props),
            semantic_override: stale,
            ..good.clone()
        },
        Spec {
            variants: Some(plane(&var)),
            semantic_override: stale,
            ..good.clone()
        },
    ];
    for (i, spec) in tampered.iter().enumerate() {
        assert_eq!(
            decode(&spec.bytes()),
            Err(DecodeError::BadMap("semantic hash")),
            "section {i}"
        );
    }
}

// ---- decoder refusals -----------------------------------------------------------------------------------------------

fn refused(spec: Spec, reason: &'static str) {
    assert_eq!(
        decode(&spec.bytes()),
        Err(DecodeError::BadMap(reason)),
        "{reason}"
    );
}

fn camp(i: u16) -> MapCamp {
    MapCamp {
        x: 16 + i,
        y: 16,
        r: 80,
        zone: 1 + (i % 5) as u8,
    }
}

#[test]
fn version_1_sections_are_refused() {
    refused(
        Spec {
            version: 1,
            ..Spec::empty(W, H, tiles())
        },
        "section version",
    );
}

#[test]
fn unknown_presence_bit_is_refused() {
    refused(
        Spec {
            extra_flags: 0x80,
            ..Spec::empty(W, H, tiles())
        },
        "presence",
    );
}

#[test]
fn camp_count_over_the_cap_is_refused() {
    let at_cap: Vec<MapCamp> = (0..MAX_MAP_CAMPS as u16).map(camp).collect();
    let ok = Spec {
        camps: Some(camps_raw(&at_cap)),
        ..Spec::empty(W, H, tiles())
    };
    assert_eq!(decode(&ok.bytes()).map(|m| m.public.camps), Ok(at_cap));
    let over: Vec<MapCamp> = (0..=MAX_MAP_CAMPS as u16).map(camp).collect();
    refused(
        Spec {
            camps: Some(camps_raw(&over)),
            ..Spec::empty(W, H, tiles())
        },
        "camp count",
    );
    // Present with zero rows is a malformed section, not an empty list.
    refused(
        Spec {
            camps: Some(vec![0]),
            ..Spec::empty(W, H, tiles())
        },
        "camp count",
    );
}

#[test]
fn camp_zone_outside_1_to_5_is_refused() {
    for zone in [0u8, 6] {
        let bad = MapCamp { zone, ..camp(0) };
        refused(
            Spec {
                camps: Some(camps_raw(&[bad])),
                ..Spec::empty(W, H, tiles())
            },
            "camp zone",
        );
    }
}

fn coliseum_with(f: impl FnOnce(&mut MapColiseum)) -> Spec {
    let mut c = sample_public().coliseum.unwrap();
    f(&mut c);
    Spec {
        coliseum: Some(coliseum_raw(&c)),
        ..Spec::empty(W, H, tiles())
    }
}

#[test]
fn gate_tile_outside_the_map_is_refused() {
    refused(
        coliseum_with(|c| c.gates[0].tiles[1] = MapTile { x: W, y: 1 }),
        "gate tile",
    );
    refused(
        coliseum_with(|c| c.gates[1].tiles[0] = MapTile { x: 3, y: H }),
        "gate tile",
    );
}

#[test]
fn malformed_coliseum_is_refused() {
    refused(coliseum_with(|c| c.gates[0].side = 4), "gate side");
    refused(coliseum_with(|c| c.gates[0].tiles.clear()), "gate tiles");
    refused(
        coliseum_with(|c| c.gates[0].tiles = vec![MapTile { x: 3, y: 1 }; MAX_GATE_TILES + 1]),
        "gate tiles",
    );
    refused(
        coliseum_with(|c| {
            let g = c.gates[0].clone();
            c.gates = vec![g; MAX_COLISEUM_GATES + 1];
        }),
        "gate count",
    );
    refused(coliseum_with(|c| c.w = 0), "coliseum rect");
    refused(coliseum_with(|c| c.x = W - 3), "coliseum rect");
    refused(coliseum_with(|c| c.h = H), "coliseum rect");
    // At the limits it is accepted: a full-map rectangle and the last tile.
    let ok = coliseum_with(|c| {
        c.x = 0;
        c.y = 0;
        c.w = W;
        c.h = H;
        c.gates[0].tiles[0] = MapTile { x: W - 1, y: H - 1 };
    });
    assert!(decode(&ok.bytes()).is_ok());
}

#[test]
fn truncated_bush_plane_is_refused() {
    // Runs that cover one cell fewer than the map.
    let short = Plane {
        wire: rle(&bushes()[..TOTAL - 1]),
        cells: bushes()[..TOTAL - 1].to_vec(),
    };
    refused(
        Spec {
            bushes: Some(short),
            ..Spec::empty(W, H, tiles())
        },
        "length",
    );
    // A zero run count.
    refused(
        Spec {
            bushes: Some(Plane {
                wire: 0u32.to_le_bytes().to_vec(),
                cells: Vec::new(),
            }),
            ..Spec::empty(W, H, tiles())
        },
        "run",
    );
    // A run count the extension cannot hold.
    let mut wire = rle(&bushes());
    wire[0..4].copy_from_slice(&40u32.to_le_bytes());
    assert_eq!(
        decode(
            &Spec {
                bushes: Some(Plane {
                    wire,
                    cells: bushes()
                }),
                ..Spec::empty(W, H, tiles())
            }
            .bytes()
        ),
        Err(DecodeError::Truncated)
    );
}

#[test]
fn truncated_ground_variant_plane_is_refused() {
    let cells = &variants()[..TOTAL - 1];
    refused(
        Spec {
            variants: Some(plane(cells)),
            ..Spec::empty(W, H, tiles())
        },
        "length",
    );
}

#[test]
fn prop_count_over_the_cap_is_refused() {
    // Positions inside the 8x6 map (256 x 192 world units), strictly increasing by (y, x): P-DRESS-BAKE-1's decoder
    // checks a prop's tile and order, so the cap is tested with props that are otherwise legal.
    let prop = |i: usize| MapProp {
        kind: 1,
        x: (i % 256) as u16,
        y: (i / 256) as u16,
        variant: 0,
        flags: 0,
    };
    let at_cap: Vec<MapProp> = (0..MAX_MAP_PROPS).map(prop).collect();
    let ok = Spec {
        props: Some(props_raw(&at_cap)),
        ..Spec::empty(W, H, tiles())
    };
    assert_eq!(decode(&ok.bytes()).map(|m| m.public.props), Ok(at_cap));
    let over: Vec<MapProp> = (0..=MAX_MAP_PROPS).map(prop).collect();
    refused(
        Spec {
            props: Some(props_raw(&over)),
            ..Spec::empty(W, H, tiles())
        },
        "prop count",
    );
    refused(
        Spec {
            props: Some(vec![0, 0]),
            ..Spec::empty(W, H, tiles())
        },
        "prop count",
    );
}

// ---- encoder refusals (the encoder never repairs) -------------------------------------------------------------------

fn attach(f: impl FnOnce(&mut MapPublic)) -> Result<MapBlob, EncodeError> {
    let mut p = sample_public();
    f(&mut p);
    MapBlob::new(W, H, tiles()).with_public(p)
}

#[test]
fn encoder_refuses_what_the_decoder_refuses() {
    let bad = |r| Err(EncodeError::BadMap(r));
    assert_eq!(
        attach(|p| p.camps = (0..=MAX_MAP_CAMPS as u16).map(camp).collect()),
        bad("camp count")
    );
    assert_eq!(attach(|p| p.camps[0].zone = 0), bad("camp zone"));
    assert_eq!(
        attach(|p| p.coliseum.as_mut().unwrap().gates[0].tiles[0] = MapTile { x: W, y: 0 }),
        bad("gate tile")
    );
    assert_eq!(
        attach(|p| p.coliseum.as_mut().unwrap().gates[0].side = 4),
        bad("gate side")
    );
    assert_eq!(
        attach(|p| p.coliseum.as_mut().unwrap().w = W + 1),
        bad("coliseum rect")
    );
    assert_eq!(
        attach(|p| p.bushes = Some(vec![0; TOTAL - 1])),
        bad("plane length")
    );
    assert_eq!(
        attach(|p| p.ground_variants = Some(vec![0; TOTAL + 1])),
        bad("plane length")
    );
    assert_eq!(
        attach(|p| p.props = vec![p.props[0]; MAX_MAP_PROPS + 1]),
        bad("prop count")
    );
}
