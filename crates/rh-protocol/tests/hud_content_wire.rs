//! P-WIRE17-HUD-2b oracle: the Welcome's HUD content block (weapon scaling rows and the public HUD constants, Wish row
//! first), its golden vectors and its refusals. Layout (docs/backlog/packets/P-WIRE17-HUD-2b.md, "Wire layout"), after
//! the weapon table and before the map:
//!   scaling count u8 (<= 32), rows of id u8, ad f64, ap f64, bonus_hp f64, bonus_defense f64, dominant u8 (0/1);
//!   term count u8 (<= 30 after P-FROST-WALL-2), rows of code u8 (< 30), value f64.
//! Ids and codes strictly ascend; every f64 is finite and in 0..=1e6. All multi-byte values little-endian.
use rh_protocol::hud_content::{
    content_fault, content_len, HUD_TERM_ROW_LEN, MAX_HUD_VALUE, MAX_SCALING_ROWS, SCALING_ROW_LEN,
};
use rh_protocol::map::MapBlob;
use rh_protocol::samples::{malformed_server, sample_hud, server_samples};
use rh_protocol::*;

fn header() -> WelcomeHeader {
    WelcomeHeader {
        protocol: PROTOCOL_VERSION,
        content_hash: 0x0123_4567_89ab_cdef,
        match_id: [7; 16],
        player_id: 3,
        session: [5; 16],
        tick_rate: 20,
        tick: 77,
        server_ms: 3850.0,
    }
}

fn map() -> MapBlob {
    MapBlob::new(4, 3, vec![0; 12])
}

/// A Welcome with an empty archetype table, the default vision block and an empty weapon table, so the block starts at
/// [`offset`].
fn welcome(hud: WireHudContent) -> ServerMsg {
    let h = header();
    ServerMsg::Welcome {
        protocol: h.protocol,
        content_hash: h.content_hash,
        match_id: h.match_id,
        player_id: h.player_id,
        session: h.session,
        tick_rate: h.tick_rate,
        tick: h.tick,
        server_ms: h.server_ms,
        archetypes: Vec::new(),
        vision: WireVision::default(),
        weapons: Vec::new(),
        hud,
        map: map(),
    }
}

/// Where the block starts in [`welcome`]: header, empty archetype table (1), vision block, empty weapon table (1).
fn offset() -> usize {
    WELCOME_HEADER_LEN + 1 + rh_protocol::vision::VISION_BLOCK_LEN + 1
}

/// [`welcome`]'s bytes before the block and the map's bytes after it, whatever the encoder writes in between.
fn frame_with(hud: &[u8]) -> Vec<u8> {
    let full = welcome(WireHudContent::default()).encode();
    let map_len = map().encoded_len();
    let mut out = full[..offset()].to_vec();
    out.extend_from_slice(hud);
    out.extend_from_slice(&full[full.len() - map_len..]);
    out
}

fn sc(
    id: u8,
    ad: f64,
    ap: f64,
    bonus_hp: f64,
    bonus_defense: f64,
    dominant: bool,
) -> WireWeaponScaling {
    WireWeaponScaling {
        id,
        ad,
        ap,
        bonus_hp,
        bonus_defense,
        dominant,
    }
}

fn term(code: u8, value: f64) -> WireHudTerm {
    WireHudTerm { code, value }
}

/// Hand-written block bytes: scaling rows `(id, [ad, ap, bonus_hp, bonus_defense], dominant byte)`, then term rows.
fn block(scaling: &[(u8, [f64; 4], u8)], terms: &[(u8, f64)]) -> Vec<u8> {
    let mut b = vec![scaling.len() as u8];
    for (id, v, dominant) in scaling {
        b.push(*id);
        for x in v {
            b.extend_from_slice(&x.to_le_bytes());
        }
        b.push(*dominant);
    }
    b.push(terms.len() as u8);
    for (code, value) in terms {
        b.push(*code);
        b.extend_from_slice(&value.to_le_bytes());
    }
    b
}

/// The legacy weapon table's scaling (packages/shared/src/weapons.ts:96-124), by wire id: sword, bow, wand, shield, axe,
/// fists.
fn legacy_scaling() -> Vec<WireWeaponScaling> {
    vec![
        sc(0, 1.0, 1.0, 0.0, 0.0, true),
        sc(1, 1.0, 0.0, 0.0, 0.0, false),
        sc(2, 0.3, 1.0, 0.0, 0.0, false),
        sc(3, 0.0, 0.3, 0.0, 0.4, false),
        sc(4, 1.0, 0.0, 0.02, 0.0, false),
        sc(5, 0.6, 0.6, 0.0, 0.0, false),
    ]
}

/// The legacy Wish constants (packages/shared/src/abilities.ts:140-167), by HudTerm code; then (P-WIRE17-HUD-2c) the
/// Fire roam constants (packages/shared/src/fireRoam.ts:2-7), codes 19-22.
fn legacy_terms() -> Vec<WireHudTerm> {
    [
        1250.0, 450.0, 8000.0, 72.0, 5000.0, 0.8, 0.7, 1.2, 1500.0, 300.0, 200.0, 30.0, 2000.0,
        64.0, 300.0, 5000.0, 0.3, 0.3, 1.0, 20_000.0, 1_000.0, 50.0, 0.4, 0.0, 450.0, 64.0, 224.0,
        4000.0, 24.0, 8.0,
    ]
    .into_iter()
    .enumerate()
    .map(|(i, v)| term(i as u8, v))
    .collect()
}

#[test]
fn constants_match_the_brief() {
    assert_eq!(HUD_TERM_COUNT, 30);
    assert_eq!(MAX_HUD_TERMS, 30);
    assert_eq!(MAX_SCALING_ROWS, 32);
    assert_eq!(SCALING_ROW_LEN, 34);
    assert_eq!(HUD_TERM_ROW_LEN, 9);
    assert_eq!(MAX_HUD_VALUE, 1.0e6);
    assert_eq!(HudTerm::FreezeStunMs as u8, 0);
    assert_eq!(HudTerm::TrialExitStunMs as u8, 8);
    assert_eq!(HudTerm::BlazeMaxDist as u8, 14);
    assert_eq!(HudTerm::LastStandFloorHp as u8, 18);
    assert_eq!(HudTerm::FireRoamBurstAdShare as u8, 22);
}

/// An empty block is two zero bytes between the weapon table and the map; a filled one is exactly the brief's rows.
#[test]
fn the_block_sits_between_the_weapon_table_and_the_map() {
    let empty = welcome(WireHudContent::default()).encode();
    assert_eq!(
        empty.len(),
        offset() + 2 + map().encoded_len(),
        "an empty block is two count bytes"
    );
    assert_eq!(&empty[offset()..offset() + 2], &[0, 0]);
    assert_eq!(content_len(&WireHudContent::default()), 2);

    let hud = WireHudContent {
        scaling: vec![
            sc(0, 1.0, 1.0, 0.0, 0.0, true),
            sc(4, 1.0, 0.0, 0.02, 0.0, false),
        ],
        terms: vec![term(0, 1250.0), term(16, 0.3)],
    };
    let want = block(
        &[(0, [1.0, 1.0, 0.0, 0.0], 1), (4, [1.0, 0.0, 0.02, 0.0], 0)],
        &[(0, 1250.0), (16, 0.3)],
    );
    assert_eq!(want.len(), 2 + 2 * 34 + 2 * 9);
    assert_eq!(content_len(&hud), want.len());
    let msg = welcome(hud);
    let bytes = msg.try_encode().expect("a valid block encodes");
    assert_eq!(bytes, frame_with(&want), "block bytes in place");
    assert_eq!(ServerMsg::decode(&bytes).as_ref(), Ok(&msg), "round trip");

    // The largest block (Welcome size budget): 2 + 32 x 34 + 30 x 9 = 1360 bytes.
    let max = WireHudContent {
        scaling: (0..32)
            .map(|id| sc(id, 1.0, 1.0, 1.0, 1.0, false))
            .collect(),
        terms: (0..30).map(|c| term(c, MAX_HUD_VALUE)).collect(),
    };
    assert_eq!(content_fault(&max), None);
    assert_eq!(content_len(&max), 1360);
}

/// The pre-encoded server path writes the same bytes as `ServerMsg::encode`, block included, and the sample block is the
/// legacy content (the server's own block is held equal to it by crates/rh-policy/tests/hud_content.rs).
#[test]
fn encode_welcome_writes_the_block_like_the_message_encoder() {
    let hud = sample_hud();
    assert_eq!(hud.scaling, legacy_scaling(), "sample scaling rows");
    assert_eq!(hud.terms, legacy_terms(), "sample terms");
    assert_eq!(content_fault(&hud), None);
    let pre = map().pre_encode().unwrap();
    let got = encode_welcome(
        &header(),
        &[],
        &WireVision::default(),
        &[],
        &hud,
        &pre,
        GroundMode::Off,
    );
    let msg = welcome(hud.clone());
    assert_eq!(got, msg.encode());
    let mut out = Vec::new();
    assert_eq!(
        encode_welcome_into(
            &header(),
            &[],
            &WireVision::default(),
            &[],
            &hud,
            &pre,
            GroundMode::Off,
            &mut out
        ),
        Ok(got.len())
    );
    assert_eq!(out, got);
    let ServerMsg::Welcome { hud: back, .. } = ServerMsg::decode(&got).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(back, hud);
}

/// The encoder refuses every block a decoder would refuse, with the decoder's reason, in the brief's order.
#[test]
fn the_encoder_refuses_a_block_a_decoder_would_refuse() {
    let good = WireHudContent {
        scaling: legacy_scaling(),
        terms: legacy_terms(),
    };
    assert_eq!(content_fault(&good), None);
    let with_scaling = |f: &dyn Fn(&mut Vec<WireWeaponScaling>)| {
        let mut c = good.clone();
        f(&mut c.scaling);
        c
    };
    let with_terms = |f: &dyn Fn(&mut Vec<WireHudTerm>)| {
        let mut c = good.clone();
        f(&mut c.terms);
        c
    };
    let cases: Vec<(&str, WireHudContent)> = vec![
        (
            "scaling count",
            with_scaling(&|s| {
                *s = (0..33)
                    .map(|id| sc(id, 1.0, 0.0, 0.0, 0.0, false))
                    .collect()
            }),
        ),
        ("scaling", with_scaling(&|s| s[0].ad = f64::NAN)),
        ("scaling", with_scaling(&|s| s[1].ap = -0.5)),
        (
            "scaling",
            with_scaling(&|s| s[2].bonus_hp = MAX_HUD_VALUE * 2.0),
        ),
        (
            "scaling",
            with_scaling(&|s| s[3].bonus_defense = f64::INFINITY),
        ),
        ("scaling order", with_scaling(&|s| s.swap(0, 1))),
        ("scaling order", with_scaling(&|s| s[1].id = 0)),
        ("hud term count", with_terms(&|t| t.push(term(22, 1.0)))),
        ("hud term code", with_terms(&|t| t[29].code = 30)),
        ("hud term", with_terms(&|t| t[0].value = f64::NAN)),
        ("hud term", with_terms(&|t| t[5].value = -0.8)),
        (
            "hud term",
            with_terms(&|t| t[2].value = MAX_HUD_VALUE + 1.0),
        ),
        ("hud term order", with_terms(&|t| t.swap(3, 4))),
        // Order of reasons: scaling before terms; values before order; a bad code before a bad value.
        ("scaling", {
            let mut c = with_terms(&|t| t[0].code = 200);
            c.scaling[0].ap = f64::NAN;
            c
        }),
        (
            "scaling",
            with_scaling(&|s| {
                s.swap(0, 1);
                s[0].ad = -1.0;
            }),
        ),
        (
            "hud term code",
            with_terms(&|t| {
                t[0].value = f64::NAN;
                t[29].code = 30;
            }),
        ),
        (
            "hud term",
            with_terms(&|t| {
                t.swap(0, 1);
                t[3].value = f64::INFINITY;
            }),
        ),
    ];
    let pre = map().pre_encode().unwrap();
    for (why, c) in cases {
        assert_eq!(content_fault(&c), Some(why), "{c:?}");
        assert_eq!(
            welcome(c.clone()).try_encode(),
            Err(EncodeError::BadValue(why)),
            "try_encode {why}"
        );
        let mut out = Vec::new();
        assert_eq!(
            encode_welcome_into(
                &header(),
                &[],
                &WireVision::default(),
                &[],
                &c,
                &pre,
                GroundMode::Off,
                &mut out
            ),
            Err(EncodeError::BadValue(why)),
            "encode_welcome_into {why}"
        );
        assert!(out.is_empty());
    }
    // Boundaries are accepted: zero and the cap, the last code, an empty block, one row each.
    for c in [
        WireHudContent::default(),
        with_terms(&|t| t[0].value = MAX_HUD_VALUE),
        with_terms(&|t| t[0].value = 0.0),
        WireHudContent {
            scaling: vec![sc(31, 0.0, 0.0, 0.0, MAX_HUD_VALUE, true)],
            terms: vec![term(22, 1.0)],
        },
    ] {
        assert_eq!(content_fault(&c), None, "{c:?}");
    }
}

/// Hand-built blocks spliced between the weapon table and the map: each is refused for the brief's reason.
#[test]
fn the_decoder_refuses_each_fault_for_the_documented_reason() {
    use DecodeError::*;
    let s0 = (0u8, [1.0, 1.0, 0.0, 0.0], 1u8);
    let s1 = (1u8, [1.0, 0.0, 0.0, 0.0], 0u8);
    let good_terms = [(0u8, 1250.0), (1u8, 450.0)];
    let cases: Vec<(&str, Vec<u8>, DecodeError)> = vec![
        // Count over the cap, refused before any row is read (no rows follow).
        ("scaling count 33", vec![33], BadField("scaling count")),
        ("scaling count 255", vec![255], BadField("scaling count")),
        (
            "dominant 2",
            block(&[(0, [1.0, 1.0, 0.0, 0.0], 2)], &good_terms),
            BadField("scaling dominant"),
        ),
        (
            "dominant 2 beats a NaN in its own row",
            block(&[(0, [f64::NAN, 1.0, 0.0, 0.0], 2)], &good_terms),
            BadField("scaling dominant"),
        ),
        (
            "scaling NaN",
            block(&[(0, [f64::NAN, 1.0, 0.0, 0.0], 1)], &good_terms),
            BadField("scaling"),
        ),
        (
            "scaling negative",
            block(&[s0, (1, [1.0, -0.5, 0.0, 0.0], 0)], &good_terms),
            BadField("scaling"),
        ),
        (
            "scaling over max",
            block(&[(0, [1.0, 1.0, 0.0, 1.0e6 + 1.0], 1)], &good_terms),
            BadField("scaling"),
        ),
        (
            "scaling order",
            block(&[s1, s0], &good_terms),
            BadField("scaling order"),
        ),
        (
            "scaling duplicate id",
            block(&[s0, (0, [1.0, 0.0, 0.0, 0.0], 0)], &good_terms),
            BadField("scaling order"),
        ),
        (
            "scaling values before order",
            block(&[s1, (0, [f64::INFINITY, 0.0, 0.0, 0.0], 0)], &good_terms),
            BadField("scaling"),
        ),
        (
            "term count 31",
            {
                let mut b = block(&[s0], &[]);
                *b.last_mut().unwrap() = 31;
                b
            },
            BadField("hud term count"),
        ),
        (
            "term code 30",
            block(&[s0], &[(0, 1250.0), (30, 1.0)]),
            BadField("hud term code"),
        ),
        (
            "term code 255 beats a NaN value before it",
            block(&[s0], &[(0, f64::NAN), (255, 1.0)]),
            BadField("hud term code"),
        ),
        (
            "term infinite",
            block(&[s0], &[(0, f64::INFINITY)]),
            BadField("hud term"),
        ),
        (
            "term negative",
            block(&[s0], &[(5, -0.8)]),
            BadField("hud term"),
        ),
        (
            "term order",
            block(&[s0], &[(4, 5000.0), (3, 72.0)]),
            BadField("hud term order"),
        ),
        (
            "term duplicate code",
            block(&[s0], &[(3, 72.0), (3, 72.0)]),
            BadField("hud term order"),
        ),
        (
            "term values before order",
            block(&[s0], &[(4, 5000.0), (3, f64::NAN)]),
            BadField("hud term"),
        ),
    ];
    for (what, hud, want) in cases {
        assert_eq!(ServerMsg::decode(&frame_with(&hud)), Err(want), "{what}");
    }
    // A frame that ends inside the block is truncated.
    let full = welcome(WireHudContent::default()).encode();
    let mut cut = full[..offset()].to_vec();
    let b = block(&[s0], &good_terms);
    cut.extend_from_slice(&b[..b.len() - 4]);
    assert_eq!(ServerMsg::decode(&cut), Err(Truncated), "cut inside a term");
    let good = block(&[s0, s1], &good_terms);
    assert!(
        matches!(ServerMsg::decode(&frame_with(&good)), Ok(ServerMsg::Welcome { ref hud, .. }) if hud.scaling.len() == 2 && hud.terms.len() == 2),
        "the hand-built good block decodes"
    );
}

/// The golden vectors: every Welcome sample carries the sample block, and the named refusal vectors are committed.
#[test]
fn the_golden_vectors_carry_the_block() {
    let welcome = server_samples()
        .into_iter()
        .find(|(n, _)| *n == "welcome")
        .expect("welcome sample")
        .1;
    let ServerMsg::Welcome { hud, .. } = welcome else {
        panic!("welcome")
    };
    assert_eq!(hud, sample_hud());
    assert_eq!(hud.scaling.len(), 6);
    assert_eq!(hud.terms.len(), 30);

    use DecodeError::*;
    let wanted: [(&str, DecodeError); 11] = [
        ("welcome_hud_scaling_count", BadField("scaling count")),
        ("welcome_hud_scaling_dominant", BadField("scaling dominant")),
        ("welcome_hud_scaling_nan", BadField("scaling")),
        ("welcome_hud_scaling_negative", BadField("scaling")),
        ("welcome_hud_scaling_order", BadField("scaling order")),
        ("welcome_hud_term_count", BadField("hud term count")),
        ("welcome_hud_term_code", BadField("hud term code")),
        ("welcome_hud_term_infinite", BadField("hud term")),
        ("welcome_hud_term_over_max", BadField("hud term")),
        ("welcome_hud_term_order", BadField("hud term order")),
        ("welcome_hud_truncated", Truncated),
    ];
    let committed = malformed_server();
    for (name, want) in wanted {
        let bytes = &committed
            .iter()
            .find(|(n, _)| *n == name)
            .unwrap_or_else(|| panic!("missing malformed vector {name}"))
            .1;
        assert_eq!(ServerMsg::decode(bytes), Err(want), "{name}");
    }
}
