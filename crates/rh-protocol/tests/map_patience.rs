//! P-WIRE17-MAP-2 oracle (map blob): the camp patience plane. The byte layout is pinned by the hand-written builder below,
//! independent of the encoder; the prose is docs/backlog/packets/P-WIRE17-MAP-2.md "Wire layout".
//!
//! A map with a patience plane is a section-version-3 extension:
//! `version u8 = 3 | presence u8 | presence2 u8 | semantic_hash u32 | the version-2 sections in presence-bit order |
//!  patience plane (presence2 0x01: u32 run count, [value u8, len u16 LE] runs) | terrain_mode u8 | context_hash u32`.
//! The semantic hash covers `[3, presence, presence2]` instead of `[2, presence]` and the plane's decoded cells after the
//! ground-variant cells. A map without the plane is version 2, byte for byte as before this packet.

use rh_protocol::map::{EncodedMap, MapBlob, MapCamp, MapPublic};
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

/// A collision-only map (walls on the top and bottom rows) with an optional camps section and an optional patience plane.
#[derive(Clone)]
struct Spec {
    version: u8,
    presence2: u8,
    camps: Option<Vec<u8>>,
    /// Wire bytes of the plane and the cells the semantic hash covers.
    patience: Option<(Vec<u8>, Vec<u8>)>,
    mode: GroundMode,
    semantic_override: Option<u32>,
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

/// Camp 1 holds the left block, camp 2 the right block; the rest is 0. Values never exceed the two camps.
fn plane() -> Vec<u8> {
    (0..total())
        .map(|i| {
            let (x, y) = (i % usize::from(w()), i / usize::from(w()));
            match (x, y) {
                (0..=2, 1..=3) => 1,
                (5..=7, 2..=4) => 2,
                _ => 0,
            }
        })
        .collect()
}

impl Spec {
    fn v3(camps: &[MapCamp], cells: &[u8]) -> Self {
        Spec {
            version: 3,
            presence2: 0x01,
            camps: (!camps.is_empty()).then(|| camps_raw(camps)),
            patience: Some((rle(cells), cells.to_vec())),
            mode: GroundMode::Map,
            semantic_override: None,
        }
    }
    fn v2(camps: &[MapCamp]) -> Self {
        Spec {
            version: 2,
            presence2: 0,
            camps: (!camps.is_empty()).then(|| camps_raw(camps)),
            patience: None,
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
fn with_patience(camps: Vec<MapCamp>, patience: Option<Vec<u8>>) -> Result<MapBlob, EncodeError> {
    base().with_public(MapPublic {
        camps,
        patience,
        ..MapPublic::default()
    })
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

// ---- layout and round trip ------------------------------------------------------------------------------------------

#[test]
fn a_map_with_a_patience_plane_encodes_to_the_pinned_version_3_layout() {
    let map = with_patience(camps(), Some(plane())).expect("a valid plane is accepted");
    let want = Spec::v3(&camps(), &plane());
    assert_eq!(
        encode(&map),
        want.bytes(),
        "MapBlob::write: section version 3, presence2 0x01, the plane after the version-2 sections"
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
fn the_server_cache_writes_the_same_version_3_bytes() {
    let public = MapPublic {
        camps: camps(),
        patience: Some(plane()),
        ..MapPublic::default()
    };
    let enc = EncodedMap::from_public(w(), h(), &tiles(), None, None, &public).expect("valid");
    let mut out = Writer::default();
    enc.write_with_mode(&mut out, GroundMode::Map);
    assert_eq!(
        out.finish(),
        Spec::v3(&camps(), &plane()).bytes(),
        "EncodedMap::from_public"
    );
    assert!(
        enc.matches_public(w(), h(), &tiles(), None, None, &public),
        "the cache matches its own map"
    );
    let other = MapPublic {
        patience: Some(vec![0; total()]),
        ..public.clone()
    };
    assert!(
        !enc.matches_public(w(), h(), &tiles(), None, None, &other),
        "a different plane is a different map"
    );
}

#[test]
fn the_pinned_version_3_layout_decodes_to_the_plane() {
    let back = decode(&Spec::v3(&camps(), &plane()).bytes()).map(|m| m.public);
    assert_eq!(
        back,
        Ok(MapPublic {
            camps: camps(),
            patience: Some(plane()),
            ..MapPublic::default()
        })
    );
}

#[test]
fn the_patience_plane_round_trips_with_every_other_section() {
    let map = with_patience(camps(), Some(plane())).expect("valid");
    let back = decode(&encode(&map)).expect("decodes");
    assert_eq!(back.public.patience.as_deref(), Some(&plane()[..]));
    assert_eq!(back, map);
    // An all-zero plane is present data, not absence (as for every plane).
    let zero = with_patience(camps(), Some(vec![0; total()])).expect("valid");
    assert_eq!(
        decode(&encode(&zero)).map(|m| m.public.patience),
        Ok(Some(vec![0; total()]))
    );
}

#[test]
fn the_semantic_hash_covers_the_plane() {
    let a = with_patience(camps(), Some(plane())).expect("valid");
    let mut moved = plane();
    moved[usize::from(w()) + 1] = 2;
    let b = with_patience(camps(), Some(moved.clone())).expect("valid");
    assert_ne!(a.semantic_hash, b.semantic_hash, "one cell moved");
    assert_ne!(a.context_hash, b.context_hash, "one cell moved");
    // A cell altered without re-hashing is refused.
    let tampered = Spec {
        patience: Some((rle(&moved), moved)),
        semantic_override: Some(Spec::v3(&camps(), &plane()).semantic_hash()),
        ..Spec::v3(&camps(), &plane())
    };
    refused(
        tampered,
        DecodeError::BadMap("semantic hash"),
        "stale semantic hash",
    );
}

// ---- guards (green today): no plane, no change --------------------------------------------------------------------

#[test]
fn guard_a_map_without_a_plane_stays_version_2() {
    for camps in [Vec::new(), camps()] {
        let map = with_patience(camps.clone(), None).expect("valid");
        assert_eq!(
            encode(&map),
            Spec::v2(&camps).bytes(),
            "version 2, unchanged"
        );
        assert_eq!(decode(&encode(&map)).map(|m| m.public.patience), Ok(None));
    }
}

#[test]
fn guard_existing_public_vectors_carry_no_plane() {
    for (name, msg) in server_samples() {
        if let ServerMsg::Welcome { map, .. } = msg {
            if name != "welcome_public_patience" {
                assert_eq!(
                    map.public.patience, None,
                    "{name} keeps its bytes: no plane"
                );
            }
        }
    }
}

// ---- decoder refusals -----------------------------------------------------------------------------------------------

#[test]
fn a_camp_index_past_the_camp_count_is_refused() {
    let mut over = plane();
    over[usize::from(w()) + 1] = 3; // two camps
    refused(
        Spec::v3(&camps(), &over),
        DecodeError::BadMap("patience camp"),
        "index 3 of 2 camps",
    );
    let mut at = plane();
    at[usize::from(w()) + 1] = 2;
    assert!(
        decode(&Spec::v3(&camps(), &at).bytes()).is_ok(),
        "index 2 of 2 camps is accepted"
    );
    // Without a camps section every non-zero cell is past the count.
    refused(
        Spec::v3(&[], &plane()),
        DecodeError::BadMap("patience camp"),
        "a plane without camps",
    );
}

#[test]
fn a_plane_of_the_wrong_size_is_refused() {
    let short = &plane()[..total() - 1];
    refused(
        Spec::v3(&camps(), short),
        DecodeError::BadMap("length"),
        "one cell short",
    );
    let mut long = plane();
    long.push(0);
    refused(
        Spec::v3(&camps(), &long),
        DecodeError::BadMap("run"),
        "one cell long",
    );
}

#[test]
fn a_truncated_plane_is_refused() {
    // A run count the extension cannot hold.
    let mut wire = rle(&plane());
    wire[0..4].copy_from_slice(&200u32.to_le_bytes());
    refused(
        Spec {
            patience: Some((wire, plane())),
            ..Spec::v3(&camps(), &plane())
        },
        DecodeError::Truncated,
        "run count past the extension",
    );
    // The frame cut inside the plane.
    let bytes = Spec::v3(&camps(), &plane()).bytes();
    assert_eq!(
        decode(&bytes[..bytes.len() - 8]),
        Err(DecodeError::Truncated),
        "cut frame"
    );
}

#[test]
fn version_3_needs_a_known_second_presence_byte() {
    // Version 3 without any presence2 bit would be a second encoding of a version-2 map.
    refused(
        Spec {
            presence2: 0,
            patience: None,
            ..Spec::v3(&camps(), &plane())
        },
        DecodeError::BadMap("presence"),
        "presence2 0",
    );
    for bit in [0x02u8, 0x80] {
        refused(
            Spec {
                presence2: 0x01 | bit,
                ..Spec::v3(&camps(), &plane())
            },
            DecodeError::BadMap("presence"),
            "unknown presence2 bit",
        );
    }
    refused(
        Spec {
            version: 4,
            ..Spec::v3(&camps(), &plane())
        },
        DecodeError::BadMap("section version"),
        "version 4",
    );
}

// ---- encoder refusals (never clamps) --------------------------------------------------------------------------------

#[test]
fn the_encoder_refuses_what_the_decoder_refuses() {
    let mut over = plane();
    over[0] = 3;
    assert_eq!(
        with_patience(camps(), Some(over.clone())),
        Err(EncodeError::BadMap("patience camp"))
    );
    assert_eq!(
        with_patience(Vec::new(), Some(plane())),
        Err(EncodeError::BadMap("patience camp"))
    );
    assert_eq!(
        with_patience(camps(), Some(vec![0; total() - 1])),
        Err(EncodeError::BadMap("plane length"))
    );
    assert_eq!(
        EncodedMap::from_public(
            w(),
            h(),
            &tiles(),
            None,
            None,
            &MapPublic {
                camps: camps(),
                patience: Some(over),
                ..MapPublic::default()
            }
        )
        .err(),
        Some(EncodeError::BadMap("patience camp")),
        "the server path refuses too"
    );
}

// ---- golden vectors the implementer adds to samples.rs (then regenerates v17.json) ---------------------------------

/// The all-sections public sample with a plane over its three camps: cell `i` carries `i % 4`.
fn golden_plane() -> Vec<u8> {
    (0..total()).map(|i| (i % 4) as u8).collect()
}

#[test]
fn the_server_vectors_carry_a_patience_welcome() {
    let samples = server_samples();
    let Some((_, ServerMsg::Welcome { map, .. })) = samples
        .iter()
        .find(|(n, _)| *n == "welcome_public_patience")
    else {
        panic!("samples.rs has no welcome_public_patience Welcome (P-WIRE17-MAP-2 adds it)")
    };
    assert_eq!(
        map.public.camps.len(),
        3,
        "the all-sections sample's three camps"
    );
    assert!(!map.public.props.is_empty() && map.public.ground_variants.is_some());
    assert_eq!(map.public.patience.as_deref(), Some(&golden_plane()[..]));
}

#[test]
fn the_malformed_map_vectors_cover_the_plane() {
    let all = malformed_map();
    for (name, reason) in [
        ("map17_patience_camp_over", "patience camp"),
        ("map17_patience_without_camps", "patience camp"),
        ("map17_patience_length", "length"),
        ("map17_patience_truncated", "truncated"),
        ("map17_v3_presence_empty", "presence"),
        ("map17_v3_presence_unknown", "presence"),
    ] {
        let Some((_, bytes, want)) = all.iter().find(|(n, _, _)| *n == name) else {
            panic!("samples.rs malformed_map has no {name} (P-WIRE17-MAP-2 adds it)")
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
