//! P-FROST-WALL-2 oracle (wire): a standing Frost Wall is a State key 3 row of field kind 3 followed by its tiles, and
//! the Welcome's HUD block says which Wish Frost has (docs/backlog/packets/P-FROST-WALL-2.md F4, F5).
//!
//! Key 3 row: `kind u8 | ability u8 | owner opt varint | subject opt varint | x y x2 y2 r vx vy f32 | started_at f64 |
//! ends_at f64`, and for kind 3 only: `count u8 (1..=64) | count x tile u32 LE` (row-major indices, strictly
//! ascending, each < MAX_MAP_TILES). Kinds 0-2 keep today's bytes. Decoder order: kind >= 4 "field"; count "wall tiles";
//! the list past the frame Truncated; a tile >= MAX_MAP_TILES "wall tile"; order "wall order".
use rh_protocol::hud_content::{FROST_WISH_FREEZE, FROST_WISH_WALL};
use rh_protocol::map::MAX_MAP_TILES;
use rh_protocol::samples::{malformed_server, server_samples};
use rh_protocol::state::{
    FIELD_KIND_COUNT, FIELD_KIND_TRAIL, FIELD_KIND_WALL, MAX_VISIBLE_FIELDS, MAX_WALL_TILES,
};
use rh_protocol::{
    DecodeError, EncodeError, HudTerm, ServerMsg, StateItem, WireField, WireHudContent, Writer,
    HUD_TERM_COUNT, MAX_HUD_TERMS, PROTOCOL_VERSION,
};

const MAP_W: u32 = 40;

/// The wall of the observation oracle: column 12, rows 37..=43 of a 40-wide map.
fn tiles() -> Vec<u32> {
    (37..=43).map(|y| y * MAP_W + 12).collect()
}

fn wall(tiles: Vec<u32>) -> WireField {
    WireField {
        kind: FIELD_KIND_WALL,
        ability: 0,
        owner: Some(5),
        subject: None,
        x: 400.,
        y: 1408.,
        x2: 400.,
        y2: 1184.,
        r: 0.,
        vx: 0.,
        vy: 0.,
        started_at: 10_000.,
        ends_at: 14_000.,
        tiles,
    }
}

fn trail() -> WireField {
    WireField {
        kind: FIELD_KIND_TRAIL,
        ability: 3,
        owner: None,
        subject: Some(1),
        x: 20.,
        y: 30.,
        x2: 40.,
        y2: 50.,
        r: 12.,
        vx: -2.,
        vy: 0.,
        started_at: 1000.5,
        ends_at: 6000.5,
        tiles: Vec::new(),
    }
}

fn state(fields: Vec<WireField>) -> ServerMsg {
    ServerMsg::State {
        tick: 300,
        items: vec![StateItem::Fields(fields)],
    }
}

// ---- hand-written reference encoder (the spec) ---------------------------------------------------------------------

/// The common part of a key 3 row, exactly as today.
fn row_head(w: &mut Writer, f: &WireField) {
    w.u8(f.kind);
    w.u8(f.ability);
    w.opt(f.owner.as_ref(), |w, id| w.varint(*id));
    w.opt(f.subject.as_ref(), |w, id| w.varint(*id));
    for v in [f.x, f.y, f.x2, f.y2, f.r, f.vx, f.vy] {
        w.f32(v);
    }
    w.f64(f.started_at);
    w.f64(f.ends_at);
}

/// A State frame holding key 3 with `rows`, each a head plus raw bytes after it.
fn frame(rows: &[(WireField, Vec<u8>)]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x88);
    w.varint(300);
    w.varint(1);
    w.varint(3);
    w.varint(rows.len() as u32);
    for (f, after) in rows {
        row_head(&mut w, f);
        w.bytes(after);
    }
    w.finish()
}

/// `count u8 | tiles u32 LE`.
fn list(count: u8, tiles: &[u32]) -> Vec<u8> {
    let mut out = vec![count];
    for t in tiles {
        out.extend_from_slice(&t.to_le_bytes());
    }
    out
}

fn decode(bytes: &[u8]) -> Result<ServerMsg, DecodeError> {
    ServerMsg::decode(bytes)
}

// ---- constants -----------------------------------------------------------------------------------------------------

#[test]
fn constants_match_the_brief() {
    assert_eq!(FIELD_KIND_WALL, 3);
    assert_eq!(FIELD_KIND_COUNT, 4, "zone, cloud, trail, wall");
    assert_eq!(MAX_WALL_TILES, 64);
    assert_eq!(HUD_TERM_COUNT, 30, "codes 23-29 appended");
    assert_eq!(MAX_HUD_TERMS, 30);
    assert_eq!(HudTerm::FrostWish as u8, 23);
    assert_eq!(HudTerm::FrostWallEndSlack as u8, HUD_TERM_COUNT - 1);
    assert_eq!((FROST_WISH_FREEZE, FROST_WISH_WALL), (0.0, 1.0));
}

/// Guard: the protocol number is 18 (P-PROTOCOL-18-STAMP-1 stamped it; until then one number grew by serial packets).
#[test]
fn guard_the_protocol_is_18() {
    assert_eq!(PROTOCOL_VERSION, 18);
}

// ---- layout --------------------------------------------------------------------------------------------------------

#[test]
fn a_wall_row_is_the_common_row_then_its_tile_list() {
    let msg = state(vec![wall(tiles()), trail()]);
    let want = frame(&[(wall(tiles()), list(7, &tiles())), (trail(), Vec::new())]);
    assert_eq!(
        msg.try_encode().expect("encodes"),
        want,
        "the bytes of the brief's layout"
    );
    assert_eq!(decode(&want), Ok(msg), "and they decode back");
}

#[test]
fn a_wall_at_the_caps_round_trips() {
    let max: Vec<u32> =
        (MAX_MAP_TILES as u32 - MAX_WALL_TILES as u32..MAX_MAP_TILES as u32).collect();
    let msg = state(vec![wall(max.clone())]);
    let want = frame(&[(wall(max.clone()), list(64, &max))]);
    assert_eq!(msg.try_encode().expect("64 tiles, the last index"), want);
    assert_eq!(decode(&want), Ok(msg));
    let one = state(vec![wall(vec![0])]);
    assert_eq!(decode(&one.try_encode().expect("one tile")), Ok(one));
}

/// Guard (green today): rows of the other kinds keep today's bytes.
#[test]
fn guard_other_kinds_carry_no_tile_list() {
    let msg = state(vec![trail()]);
    assert_eq!(msg.encode(), frame(&[(trail(), Vec::new())]));
}

// ---- decoder refusals ----------------------------------------------------------------------------------------------

#[test]
fn the_decoder_refuses_malformed_wall_rows_for_the_brief_reasons() {
    use DecodeError::*;
    let mut kind4 = wall(Vec::new());
    kind4.kind = 4;
    let over: Vec<u32> = (0..65).collect();
    let cases: Vec<(&str, Vec<u8>, DecodeError)> = vec![
        (
            "unknown kind 4",
            frame(&[(kind4, Vec::new())]),
            BadField("field"),
        ),
        (
            "count 0",
            frame(&[(wall(tiles()), list(0, &[]))]),
            BadField("wall tiles"),
        ),
        (
            "count 65",
            frame(&[(wall(tiles()), list(65, &over))]),
            BadField("wall tiles"),
        ),
        (
            "count 3, two tiles",
            frame(&[(wall(tiles()), list(3, &[1, 2]))]),
            Truncated,
        ),
        (
            "a tile off every map",
            frame(&[(wall(tiles()), list(2, &[5, MAX_MAP_TILES as u32]))]),
            BadField("wall tile"),
        ),
        (
            "a repeated tile",
            frame(&[(wall(tiles()), list(2, &[5, 5]))]),
            BadField("wall order"),
        ),
        (
            "descending tiles",
            frame(&[(wall(tiles()), list(2, &[6, 5]))]),
            BadField("wall order"),
        ),
    ];
    for (what, bytes, want) in cases {
        assert_eq!(decode(&bytes), Err(want), "{what}");
    }
}

// ---- encoder refusals ----------------------------------------------------------------------------------------------

#[test]
fn the_encoder_refuses_what_a_decoder_would() {
    use EncodeError::BadValue;
    let mut on_trail = trail();
    on_trail.tiles = vec![1];
    let mut kind4 = trail();
    kind4.kind = 4;
    let cases: Vec<(&str, ServerMsg, EncodeError)> = vec![
        (
            "a wall with no tiles",
            state(vec![wall(Vec::new())]),
            BadValue("wall tiles"),
        ),
        (
            "65 tiles",
            state(vec![wall((0..65).collect())]),
            BadValue("wall tiles"),
        ),
        (
            "a tile off every map",
            state(vec![wall(vec![MAX_MAP_TILES as u32])]),
            BadValue("wall tile"),
        ),
        (
            "unordered",
            state(vec![wall(vec![9, 3])]),
            BadValue("wall order"),
        ),
        ("tiles on a trail", state(vec![on_trail]), BadValue("field")),
        ("kind 4", state(vec![kind4]), BadValue("field")),
    ];
    for (what, msg, want) in cases {
        assert_eq!(msg.try_encode(), Err(want), "{what}");
    }
}

/// The largest key 3 the decoders accept still fits a server frame: 512 walls of 64 tiles.
#[test]
fn the_field_cap_and_the_tile_cap_fit_a_frame() {
    let max: Vec<u32> = (0..MAX_WALL_TILES as u32).collect();
    let msg = state((0..MAX_VISIBLE_FIELDS).map(|_| wall(max.clone())).collect());
    let bytes = msg.try_encode().expect("the caps fit");
    assert_eq!(decode(&bytes), Ok(msg));
}

// ---- golden vectors (added to samples.rs by the implementer, then v17.json regenerated) -----------------------------

fn server(name: &str) -> ServerMsg {
    server_samples()
        .into_iter()
        .find(|(n, _)| *n == name)
        .unwrap_or_else(|| panic!("missing server vector {name} (P-FROST-WALL-2 adds it)"))
        .1
}

#[test]
fn the_wall_vectors_are_the_brief_rows() {
    assert_eq!(
        server("state_frost_wall"),
        state(vec![wall(tiles()), trail()]),
        "state_frost_wall: the observation oracle's wall, then a trail"
    );
    let max: Vec<u32> =
        (MAX_MAP_TILES as u32 - MAX_WALL_TILES as u32..MAX_MAP_TILES as u32).collect();
    assert_eq!(
        server("state_frost_wall_max"),
        state(vec![wall(max)]),
        "state_frost_wall_max: 64 tiles ending at the last index"
    );
}

fn hud(msg: ServerMsg) -> WireHudContent {
    let ServerMsg::Welcome { hud, .. } = msg else {
        panic!("a Welcome")
    };
    hud
}

fn term(h: &WireHudContent, code: HudTerm) -> f64 {
    h.terms
        .iter()
        .find(|t| t.code == code as u8)
        .unwrap_or_else(|| panic!("the block carries {code:?}"))
        .value
}

#[test]
fn the_welcome_vectors_say_which_wish_frost_has() {
    let freeze = hud(server("welcome"));
    let codes: Vec<u8> = freeze.terms.iter().map(|t| t.code).collect();
    assert_eq!(
        codes,
        (0..HUD_TERM_COUNT).collect::<Vec<_>>(),
        "every code once"
    );
    assert_eq!(term(&freeze, HudTerm::FrostWish), FROST_WISH_FREEZE);
    let wall = hud(server("welcome_frost_wall"));
    assert_eq!(term(&wall, HudTerm::FrostWish), FROST_WISH_WALL);
    for h in [&freeze, &wall] {
        assert_eq!(term(h, HudTerm::FrostWallRange), 450.0);
        assert_eq!(term(h, HudTerm::FrostWallMinRange), 64.0);
        assert_eq!(term(h, HudTerm::FrostWallLength), 224.0);
        assert_eq!(term(h, HudTerm::FrostWallMs), 4000.0);
        assert_eq!(term(h, HudTerm::FrostWallCellReach), 24.0);
        assert_eq!(term(h, HudTerm::FrostWallEndSlack), 8.0);
    }
    // Apart from the one term, the two Welcomes are the same message.
    let mut same = server("welcome_frost_wall");
    if let ServerMsg::Welcome { hud, .. } = &mut same {
        hud.terms[HudTerm::FrostWish as usize].value = FROST_WISH_FREEZE;
    }
    assert_eq!(same, server("welcome"));
}

#[test]
fn the_malformed_vectors_are_refused_for_their_reasons() {
    use DecodeError::*;
    let wanted: [(&str, DecodeError); 7] = [
        ("state_field_kind_unknown", BadField("field")),
        ("state_wall_tiles_zero", BadField("wall tiles")),
        ("state_wall_tiles_over", BadField("wall tiles")),
        ("state_wall_tiles_truncated", Truncated),
        ("state_wall_tile_off_map", BadField("wall tile")),
        ("state_wall_tile_order", BadField("wall order")),
        ("welcome_hud_term_code", BadField("hud term code")),
    ];
    let committed = malformed_server();
    for (name, want) in wanted {
        let bytes = &committed
            .iter()
            .find(|(n, _)| *n == name)
            .unwrap_or_else(|| panic!("missing malformed vector {name} (P-FROST-WALL-2 adds it)"))
            .1;
        assert_eq!(decode(bytes), Err(want), "{name}");
    }
    // The first unknown HUD code moves with the count.
    let bytes = &committed
        .iter()
        .find(|(n, _)| *n == "welcome_hud_term_code")
        .unwrap()
        .1;
    assert!(
        bytes
            .windows(9)
            .any(|w| w[0] == HUD_TERM_COUNT && w[1..] == 1.0f64.to_le_bytes()),
        "welcome_hud_term_code carries code {HUD_TERM_COUNT} (value 1.0)"
    );
}
