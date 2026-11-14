//! P-DRESS-BAKE-1 oracle: the map blob's dressing sections (the prop list and the ground-variant plane reserved by
//! P-WIRE17-MAP-1) gain value checks, and the golden vectors carry dressed maps. The rules, in the order every decoder
//! applies them to each prop row (see docs/backlog/packets/P-DRESS-BAKE-1.md "Wire rules"):
//!
//! 1. `flags` has no bit outside `PROP_FLAG_TALL | PROP_FLAG_LEGACY` ("prop flags");
//! 2. a rule prop (no LEGACY flag) has `kind` in `1..=MAX_PROP_KIND`, a legacy prop `kind < LEGACY_PROP_KINDS`
//!    ("prop kind");
//! 3. a rule prop has `variant <= MAX_PROP_VARIANT`; a legacy prop's variant is not checked ("prop variant");
//! 4. the prop's tile `(x / 32, y / 32)` is inside the map: `x < 32 * w`, `y < 32 * h` (world units) ("prop tile");
//! 5. rows are strictly increasing in `(y, x, kind)`: out of order or a repeated key is refused ("prop order").
//!
//! Every ground-variant cell is at most `MAX_GROUND_VARIANT` ("ground variant"); a short plane stays "length", a long one
//! "run", a count over the cap "prop count", rows past the end "truncated". The encoder refuses the same maps with the
//! same reasons (`EncodeError::BadMap`); the ground plane's wrong length keeps its encoder reason "plane length".

use rh_protocol::map::{
    MapBlob, MapProp, MapPublic, LEGACY_PROP_KINDS, MAX_GROUND_VARIANT, MAX_PROP_KIND,
    MAX_PROP_VARIANT, PROP_FLAG_LEGACY, PROP_FLAG_TALL,
};
use rh_protocol::{
    DecodeError, EncodeError, GroundMode, Reader, ServerMsg, WireVision, Writer, PROTOCOL_VERSION,
};

// ---- hand-written reference encoder (independent of the crate's) ---------------------------------------------------

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

fn row(kind: u8, x: u16, y: u16, variant: u8, flags: u8) -> MapProp {
    MapProp {
        kind,
        x,
        y,
        variant,
        flags,
    }
}

/// `count u16` then `kind u8, x u16, y u16, variant u8, flags u8` per row (the P-WIRE17-MAP-1 layout).
fn props_wire(props: &[MapProp]) -> Vec<u8> {
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

/// One extension section: its wire bytes and what the semantic hash covers.
struct Section {
    wire: Vec<u8>,
    hashed: Vec<u8>,
}
fn list(wire: Vec<u8>) -> Section {
    Section {
        hashed: wire.clone(),
        wire,
    }
}
fn plane(cells: &[u8]) -> Section {
    Section {
        wire: rle(cells),
        hashed: cells.to_vec(),
    }
}

/// An all-floor `w x h` map blob with the given presence flags and sections (mode Off), hashes computed by hand.
fn blob(w: u16, h: u16, flags: u8, sections: &[Section]) -> Vec<u8> {
    let tiles = vec![0u8; usize::from(w) * usize::from(h)];
    let mut layer = 0x811c_9dc5;
    fnv(&mut layer, &u32::from(w).to_le_bytes());
    fnv(&mut layer, &u32::from(h).to_le_bytes());
    fnv(&mut layer, &tiles);
    let mut semantic = 0x811c_9dc5;
    fnv(&mut semantic, b"rh-ground/1\0");
    fnv(&mut semantic, &u32::from(w).to_le_bytes());
    fnv(&mut semantic, &u32::from(h).to_le_bytes());
    fnv(&mut semantic, &[2, flags]);
    for s in sections {
        fnv(&mut semantic, &s.hashed);
    }
    let mut context = 0x811c_9dc5;
    fnv(&mut context, b"rh-map-context/1\0");
    fnv(&mut context, &layer.to_le_bytes());
    fnv(&mut context, &semantic.to_le_bytes());
    fnv(&mut context, &[GroundMode::Off as u8]);
    let mut out = Vec::new();
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&layer.to_le_bytes());
    out.extend_from_slice(&rle(&tiles));
    let mut ext = vec![2, flags];
    ext.extend_from_slice(&semantic.to_le_bytes());
    for s in sections {
        ext.extend_from_slice(&s.wire);
    }
    ext.push(GroundMode::Off as u8);
    ext.extend_from_slice(&context.to_le_bytes());
    out.extend_from_slice(&(ext.len() as u32).to_le_bytes());
    out.extend_from_slice(&ext);
    out
}

/// The complete Welcome frame `rh_protocol::samples` writes for its `malformedMap` vectors (`welcome_public_raw`): fixed
/// header, empty archetype table, default vision, empty weapon table, empty HUD block, then a 4 x 3 all-floor map.
fn raw_welcome(flags: u8, sections: &[Section]) -> Vec<u8> {
    let mut b = Writer::default();
    b.u8(0x81);
    b.u16(PROTOCOL_VERSION);
    b.u64(0x1234);
    b.bytes(&[7; 16]);
    b.u32(1);
    b.bytes(&[9; 16]);
    b.u8(20);
    b.u32(0);
    b.f64(0.0);
    b.u8(0);
    rh_protocol::vision::write_vision_for_tests(&mut b, &WireVision::default());
    b.u8(0);
    b.bytes(&[0, 0]);
    b.bytes(&blob(RAW_W, RAW_H, flags, sections));
    b.finish()
}

const RAW_W: u16 = 4;
const RAW_H: u16 = 3;
const PROPS: u8 = 0x20;
const GROUND: u8 = 0x40;

fn decode_blob(bytes: &[u8]) -> Result<MapBlob, DecodeError> {
    MapBlob::read(&mut Reader::new(bytes))
}

fn bad(reason: &'static str) -> DecodeError {
    if reason == "truncated" {
        DecodeError::Truncated
    } else {
        DecodeError::BadMap(reason)
    }
}

// ---- the dressing every golden vector and every decoder agrees on ---------------------------------------------------

const GOLDEN_W: u16 = 8;
const GOLDEN_H: u16 = 6;

/// The props of `welcome_dress_props_ground` and `welcome_dress_props_only`, in wire order: a tall rule prop, two props
/// on one y told apart by x, two on one (y, x) told apart by kind, the highest legacy kind with an unchecked variant, and
/// the highest rule kind on the last world unit inside the map.
fn golden_props() -> Vec<MapProp> {
    vec![
        row(41, 48, 40, 0, PROP_FLAG_TALL),
        row(3, 100, 60, 2, 0),
        row(3, 101, 60, MAX_PROP_VARIANT, 0),
        row(7, 101, 60, 0, 0),
        row(LEGACY_PROP_KINDS - 1, 16, 176, 200, PROP_FLAG_LEGACY),
        row(
            MAX_PROP_KIND,
            32 * GOLDEN_W - 1,
            32 * GOLDEN_H - 1,
            1,
            PROP_FLAG_TALL,
        ),
    ]
}

/// The ground plane of `welcome_dress_props_ground`: every id from 0 to `MAX_GROUND_VARIANT`, row-major.
fn golden_ground() -> Vec<u8> {
    let total = usize::from(GOLDEN_W) * usize::from(GOLDEN_H);
    (0..total)
        .map(|i| (i % (usize::from(MAX_GROUND_VARIANT) + 1)) as u8)
        .collect()
}

#[test]
fn the_brief_s_caps_are_the_wire_caps() {
    assert_eq!(PROP_FLAG_TALL, 1);
    assert_eq!(PROP_FLAG_LEGACY, 2);
    assert_eq!(MAX_PROP_KIND, 100);
    assert_eq!(LEGACY_PROP_KINDS, 34);
    assert_eq!(MAX_PROP_VARIANT, 3);
    assert_eq!(MAX_GROUND_VARIANT, 15);
}

// ---- in-range dressing round-trips -----------------------------------------------------------------------------------

#[test]
fn in_range_dressing_encodes_to_the_reference_bytes_and_decodes() {
    let tiles = vec![0u8; usize::from(GOLDEN_W) * usize::from(GOLDEN_H)];
    for ground in [Some(golden_ground()), None] {
        let map = MapBlob::new(GOLDEN_W, GOLDEN_H, tiles.clone())
            .with_public(MapPublic {
                props: golden_props(),
                ground_variants: ground.clone(),
                ..MapPublic::default()
            })
            .expect("in-range dressing is accepted by the encoder");
        let mut w = Writer::default();
        map.write(&mut w);
        let bytes = w.finish();
        let mut sections = vec![list(props_wire(&golden_props()))];
        let mut flags = PROPS;
        if let Some(g) = &ground {
            sections.push(plane(g));
            flags |= GROUND;
        }
        assert_eq!(bytes, blob(GOLDEN_W, GOLDEN_H, flags, &sections));
        let back = decode_blob(&bytes).expect("in-range dressing decodes");
        assert_eq!(back.public.props, golden_props());
        assert_eq!(back.public.ground_variants, ground);
    }
}

// ---- decoder refusals ------------------------------------------------------------------------------------------------

/// The refusals every decoder applies, by name (the `malformedMap` vector names the implementer adds), with the reason
/// and the frame on the 4 x 3 sample map (world units: x < 128, y < 96).
fn dressing_refusals() -> Vec<(&'static str, Vec<u8>, &'static str)> {
    let cells = usize::from(RAW_W) * usize::from(RAW_H);
    let one = |p: MapProp| raw_welcome(PROPS, &[list(props_wire(&[p]))]);
    let two = |a: MapProp, b: MapProp| raw_welcome(PROPS, &[list(props_wire(&[a, b]))]);
    let mut truncated = props_wire(&[row(1, 16, 16, 0, 0), row(1, 48, 16, 0, 0)]);
    truncated.truncate(truncated.len() - 7);
    vec![
        (
            "map17_dress_prop_kind_zero",
            one(row(0, 16, 16, 0, 0)),
            "prop kind",
        ),
        (
            "map17_dress_prop_kind_over",
            one(row(MAX_PROP_KIND + 1, 16, 16, 0, 0)),
            "prop kind",
        ),
        (
            "map17_dress_legacy_kind_over",
            one(row(LEGACY_PROP_KINDS, 16, 16, 0, PROP_FLAG_LEGACY)),
            "prop kind",
        ),
        (
            "map17_dress_prop_flags",
            one(row(1, 16, 16, 0, 4)),
            "prop flags",
        ),
        (
            "map17_dress_prop_variant",
            one(row(1, 16, 16, MAX_PROP_VARIANT + 1, 0)),
            "prop variant",
        ),
        (
            "map17_dress_prop_x_outside",
            one(row(1, 32 * RAW_W, 16, 0, 0)),
            "prop tile",
        ),
        (
            "map17_dress_prop_y_outside",
            one(row(1, 16, 32 * RAW_H, 0, 0)),
            "prop tile",
        ),
        (
            "map17_dress_prop_order",
            two(row(1, 16, 48, 0, 0), row(1, 16, 16, 0, 0)),
            "prop order",
        ),
        (
            "map17_dress_prop_duplicate",
            two(row(1, 16, 16, 0, 0), row(1, 16, 16, 0, 0)),
            "prop order",
        ),
        (
            "map17_dress_props_truncated",
            raw_welcome(PROPS, &[list(truncated)]),
            "truncated",
        ),
        (
            "map17_dress_ground_over",
            raw_welcome(GROUND, &[plane(&vec![MAX_GROUND_VARIANT + 1; cells])]),
            "ground variant",
        ),
        (
            "map17_dress_ground_long",
            raw_welcome(GROUND, &[plane(&vec![1; cells + 1])]),
            "run",
        ),
    ]
}

#[test]
fn the_reference_welcome_builder_matches_the_samples_builder() {
    // The builder above writes the same frame as `samples::welcome_public_raw`: checked on an existing vector.
    let existing = rh_protocol::samples::malformed_map()
        .into_iter()
        .find(|(name, _, _)| *name == "map17_prop_count_zero")
        .expect("map17_prop_count_zero is a sample")
        .1;
    assert_eq!(raw_welcome(PROPS, &[list(vec![0, 0])]), existing);
}

#[test]
fn the_decoder_refuses_out_of_range_dressing_for_its_reason() {
    for (name, frame, reason) in dressing_refusals() {
        assert_eq!(
            ServerMsg::decode(&frame).err(),
            Some(bad(reason)),
            "{name} must be refused for \"{reason}\""
        );
    }
}

#[test]
fn the_decoder_accepts_dressing_on_every_boundary() {
    let w = GOLDEN_W;
    let h = GOLDEN_H;
    let last_x = 32 * w - 1;
    let last_y = 32 * h - 1;
    let props = vec![
        row(1, 0, 0, 0, 0),
        row(MAX_PROP_KIND, 1, 0, MAX_PROP_VARIANT, PROP_FLAG_TALL),
        row(0, 2, 0, 255, PROP_FLAG_LEGACY),
        row(
            LEGACY_PROP_KINDS - 1,
            3,
            0,
            0,
            PROP_FLAG_LEGACY | PROP_FLAG_TALL,
        ),
        row(1, last_x, last_y, 0, 0),
    ];
    let ground = vec![MAX_GROUND_VARIANT; usize::from(w) * usize::from(h)];
    let bytes = blob(
        w,
        h,
        PROPS | GROUND,
        &[list(props_wire(&props)), plane(&ground)],
    );
    let map = decode_blob(&bytes).expect("boundary dressing decodes");
    assert_eq!(map.public.props, props);
    assert_eq!(map.public.ground_variants, Some(ground));
}

// ---- encoder refusals ------------------------------------------------------------------------------------------------

fn attach(props: Vec<MapProp>, ground: Option<Vec<u8>>) -> Result<MapBlob, EncodeError> {
    let total = usize::from(GOLDEN_W) * usize::from(GOLDEN_H);
    MapBlob::new(GOLDEN_W, GOLDEN_H, vec![0; total]).with_public(MapPublic {
        props,
        ground_variants: ground,
        ..MapPublic::default()
    })
}

/// What is attached (the props and the ground plane) and the reason the encoder names.
type EncoderCase = (&'static str, Vec<MapProp>, Option<Vec<u8>>, &'static str);

#[test]
fn the_encoder_refuses_what_the_decoder_refuses() {
    let total = usize::from(GOLDEN_W) * usize::from(GOLDEN_H);
    let ok = row(1, 16, 16, 0, 0);
    let cases: Vec<EncoderCase> = vec![
        ("kind zero", vec![row(0, 16, 16, 0, 0)], None, "prop kind"),
        (
            "kind over",
            vec![row(MAX_PROP_KIND + 1, 16, 16, 0, 0)],
            None,
            "prop kind",
        ),
        (
            "legacy kind over",
            vec![row(LEGACY_PROP_KINDS, 16, 16, 0, PROP_FLAG_LEGACY)],
            None,
            "prop kind",
        ),
        ("flags", vec![row(1, 16, 16, 0, 4)], None, "prop flags"),
        (
            "variant",
            vec![row(1, 16, 16, MAX_PROP_VARIANT + 1, 0)],
            None,
            "prop variant",
        ),
        (
            "x outside",
            vec![row(1, 32 * GOLDEN_W, 16, 0, 0)],
            None,
            "prop tile",
        ),
        (
            "y outside",
            vec![row(1, 16, 32 * GOLDEN_H, 0, 0)],
            None,
            "prop tile",
        ),
        ("order", vec![row(1, 16, 48, 0, 0), ok], None, "prop order"),
        (
            "kind order on one spot",
            vec![row(2, 16, 16, 0, 0), ok],
            None,
            "prop order",
        ),
        ("duplicate", vec![ok, ok], None, "prop order"),
        (
            "ground over",
            vec![],
            Some(vec![MAX_GROUND_VARIANT + 1; total]),
            "ground variant",
        ),
        (
            "ground short",
            vec![],
            Some(vec![1; total - 1]),
            "plane length",
        ),
    ];
    for (what, props, ground, reason) in cases {
        assert_eq!(
            attach(props, ground).err(),
            Some(EncodeError::BadMap(reason)),
            "{what}: the encoder refuses for \"{reason}\", it never repairs"
        );
    }
}

// ---- golden vectors (protocol/fixtures/v18.json, regenerated by the implementer) ------------------------------------

fn fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(format!("v{PROTOCOL_VERSION}.json"));
    std::fs::read_to_string(&path).expect("the committed vectors")
}

/// The one-line entry `{"name": "<name>", "hex": "…", …}` of the vectors file.
fn entry<'a>(fixture: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{{\"name\": \"{name}\", \"hex\": \"");
    fixture.lines().find(|l| l.trim_start().starts_with(&key))
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let key = format!("\"{key}\": \"");
    let at = line.find(&key)? + key.len();
    let len = line[at..].find('"')?;
    Some(&line[at..at + len])
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

fn welcome_map(fixture: &str, name: &str) -> MapBlob {
    let line = entry(fixture, name);
    assert!(
        line.is_some(),
        "protocol/fixtures/v18.json has no server vector {name} (add it to samples::server_samples and regenerate)"
    );
    match ServerMsg::decode(&unhex(field(line.unwrap(), "hex").unwrap())) {
        Ok(ServerMsg::Welcome { map, .. }) => map,
        other => panic!("{name} is not a Welcome: {other:?}"),
    }
}

#[test]
fn the_vectors_carry_a_map_with_props_and_a_ground_plane() {
    let f = fixture();
    let map = welcome_map(&f, "welcome_dress_props_ground");
    assert_eq!((map.w, map.h), (GOLDEN_W, GOLDEN_H));
    assert_eq!(map.public.props, golden_props());
    assert_eq!(map.public.ground_variants, Some(golden_ground()));
}

#[test]
fn the_vectors_carry_a_map_with_props_only() {
    let f = fixture();
    let map = welcome_map(&f, "welcome_dress_props_only");
    assert_eq!((map.w, map.h), (GOLDEN_W, GOLDEN_H));
    assert_eq!(map.public.props, golden_props());
    assert_eq!(map.public.ground_variants, None);
}

#[test]
fn the_vectors_carry_every_dressing_refusal() {
    let f = fixture();
    for (name, frame, reason) in dressing_refusals() {
        let line = entry(&f, name);
        assert!(
            line.is_some(),
            "protocol/fixtures/v18.json has no malformedMap vector {name} (add it to samples::malformed_map and regenerate)"
        );
        let line = line.unwrap();
        assert_eq!(field(line, "reason"), Some(reason), "{name} reason");
        assert_eq!(
            unhex(field(line, "hex").unwrap()),
            frame,
            "{name}: the frame is the brief's"
        );
    }
}

/// FNV-1a 64 of a vector's hex text.
fn digest(hex: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in hex.as_bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[test]
fn a_map_without_dressing_keeps_today_s_bytes() {
    // Pinned on the integration branch before this packet (b3a8fb516): the Welcomes without dressing (and the one with
    // the reserved sections, whose dressing is already in range) keep their exact bytes.
    let f = fixture();
    let pinned: [(&str, usize, u64); 4] = [
        ("welcome", WELCOME_LEN, WELCOME_DIGEST),
        ("welcome_public_shipped", SHIPPED_LEN, SHIPPED_DIGEST),
        ("welcome_public_all", ALL_LEN, ALL_DIGEST),
        ("welcome_ground_both", GROUND_BOTH_LEN, GROUND_BOTH_DIGEST),
    ];
    for (name, len, want) in pinned {
        let line = entry(&f, name).unwrap_or_else(|| panic!("{name} is still a vector"));
        let hex = field(line, "hex").unwrap();
        assert_eq!(
            (hex.len(), digest(hex)),
            (len, want),
            "{name} keeps its bytes"
        );
    }
}

// Moved with the version field at protocol 18: v17/v18 Welcomes differ only in 811100 -> 811200 (protocol_18_stamp.rs).
const WELCOME_LEN: usize = 1832;
const WELCOME_DIGEST: u64 = 0x8e41_80ea_69be_ae1e;
const SHIPPED_LEN: usize = 2324;
const SHIPPED_DIGEST: u64 = 0xf246_bf47_6f05_5b28;
const ALL_LEN: usize = 2424;
const ALL_DIGEST: u64 = 0x6e5e_fdb3_841e_7401;
const GROUND_BOTH_LEN: usize = 1868;
const GROUND_BOTH_DIGEST: u64 = 0xce78_20ad_a094_81cd;
