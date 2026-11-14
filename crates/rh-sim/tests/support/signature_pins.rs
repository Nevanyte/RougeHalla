// The signature landmarks' digest-neutrality pins, in one place (P-MAPGEN-SIG-BLUEPRINT-1). A packet that is meant to
// change no generated map proves it against these; a packet that is meant to move a landmark re-pins them here, once,
// with the values `mapgen_signature_blueprint.rs` `print_signature_pins` prints (run it with `--ignored --nocapture`),
// and says so in its brief. Pinned on the stub commit of P-MAPGEN-SIG-BLUEPRINT-1 (the generator of
// feature/unity-rework @ 9890f291b, which holds the blueprint church and the Plague pools), before the generic stamp.
// The option-on pins (`pinned_on_maps`, `pinned_landmarks`) were last re-taken by P-MAPGEN-SIG-SCALE-4 on
// agent/opus/P-MAPGEN-SIG-SCALE-4 @ c62867ea4 (the 22 x 22 volcano with three streams); `pinned_off` is unchanged.
//
// Anchors are not in `map_hash`; the JSON digests below sort each anchor's `entrance` row-major first, so that
// P-MAPGEN-SIG-BLUEPRINT-2, which sorts the entrances in the generator (nothing in the generator, the server or the
// client reads their order), needs no re-pin. The order itself is pinned by `mapgen_signature_table.rs`
// `every_anchors_entrance_is_row_major` (P-MAPGEN-SIG-BLUEPRINT-2).
#![allow(dead_code)]
use rh_sim::mapdata::GameMapData;
use rh_sim::mapgen::landmarks::signature::SignatureContext;
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, coliseum};

/// FNV-1a 64.
pub fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// `m` with every anchor's entrance sorted row-major (y, then x).
pub fn with_sorted_entrances(m: &GameMapData) -> GameMapData {
    let mut m = m.clone();
    for a in &mut m.anchors {
        a.entrance.sort_by_key(|p| (p.y, p.x));
    }
    m
}

/// FNV-1a 64 of the map's JSON with every anchor's entrance sorted row-major.
pub fn map_digest(m: &GameMapData) -> u64 {
    fnv(&serde_json::to_vec(&with_sorted_entrances(m)).expect("map JSON"))
}

/// What the Landmarks phase leaves on (seed, attempt), option on, as one number: 1 when the prefix fails, 2 when the
/// legacy landmark stage refuses, 3 when the signature step refuses the attempt; otherwise FNV-1a 64 of the step's
/// anchors (JSON, entrances sorted row-major), the stage's tiles, terrain, feature owners (u16 LE), features (JSON),
/// protection, the masks `boxes` and `near1`, and the step's terrain layer.
pub fn landmarks_digest(seed: i64, n: u64) -> u64 {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let Some(frame) =
        attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")
    else {
        return 1;
    };
    let Some(mut st) = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")
    else {
        return 2;
    };
    let Some(placed) = SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")
    else {
        return 3;
    };
    let mut bytes = Vec::new();
    for a in placed.anchors() {
        let mut a = a.clone();
        a.entrance.sort_by_key(|p| (p.y, p.x));
        bytes.extend(serde_json::to_vec(&a).expect("anchor JSON"));
    }
    bytes.extend(&st.state.tiles);
    bytes.extend(&st.state.terrain);
    for &o in &st.state.feature_owner {
        bytes.extend(o.to_le_bytes());
    }
    for f in &st.state.features {
        bytes.extend(serde_json::to_vec(f).expect("feature JSON"));
    }
    bytes.extend(&st.protect);
    bytes.extend(&st.masks.boxes);
    bytes.extend(&st.masks.near1);
    bytes.extend(&placed.terrain);
    fnv(&bytes)
}

/// Today's option-off generator, seeds 1-8: (seed, `map_hash`, FNV-1a 64 of the map's JSON) (G8). Moved here
/// unchanged by P-MAPGEN-SIG-BLUEPRINT-2 from the seven `mapgen_signature_*` oracles that each carried a copy (`_fire`,
/// `_frost`, `_frost_lake`, `_reserve`, `_scale`, `_church`, `_bog_tree`); option off has no anchors, so the plain JSON
/// digest (`fnv` of `serde_json::to_vec(&map)`) is meant.
pub fn pinned_off() -> [(i64, &'static str, u64); 8] {
    [
        (1, "d09b4fd9", 0xf638_ce4a_8563_d41d),
        (2, "190cd50f", 0xf13c_e037_fbd7_f651),
        (3, "b82117b8", 0xeb4f_0525_0310_7414),
        (4, "bec16d65", 0x785a_11c3_0a31_46b7),
        (5, "25032ba7", 0x0f6e_a513_6ba7_ca0d),
        (6, "2d58fdf5", 0x600e_c62d_a4c6_d207),
        (7, "6255dbbe", 0x7188_b411_554a_ddb7),
        (8, "dbb3602f", 0xd855_dc2a_be46_a4eb),
    ]
}

/// Seeds 1-32, option on (`pipeline::Options { signature: true, ..Default::default() }`, `certified_styled`): (seed,
/// the accepted attempt, `map_hash`, `map_digest`). Re-pinned by P-MAPGEN-SIG-SCALE-4 (2026-11-14: the 22 x 22 volcano
/// with three streams and the Fire fan; 89 attempts over the 32 seeds, worst 9 on seed 22).
pub fn pinned_on_maps() -> [(i64, u64, &'static str, u64); 32] {
    [
        (1, 1, "72b7d697", 0x0278_c324_ed7e_b71b),
        (2, 0, "b84d49c8", 0x4cb8_e47a_651f_9db6),
        (3, 1, "9d32c159", 0x3e07_1525_218d_057b),
        (4, 0, "27ec1783", 0x0bb4_8731_b36e_b323),
        (5, 0, "5f14ef7b", 0x28ff_32af_17cc_f28a),
        (6, 0, "6bfe49e8", 0xb932_fd7f_e504_85e9),
        (7, 2, "a69ed836", 0xb5cd_5bcd_3be4_0337),
        (8, 1, "f7b0b961", 0x24df_fbae_5e51_2f35),
        (9, 2, "db09abaf", 0xf36e_118a_bb16_6308),
        (10, 0, "72f8e6de", 0xc3e9_8190_ab47_d951),
        (11, 0, "d1d49be6", 0x81f1_dbed_4369_a988),
        (12, 1, "b583aad5", 0x71b8_e60a_4068_d954),
        (13, 3, "ed59efd2", 0x28f7_ec62_445a_fe95),
        (14, 1, "1d12c80c", 0xa07d_0910_a638_0eb0),
        (15, 0, "4d6aa3a5", 0x72d0_2906_348c_7bd6),
        (16, 2, "625955e7", 0x08e7_e5de_8e3f_7122),
        (17, 2, "66742d6b", 0x4c95_8508_187e_48a9),
        (18, 7, "a6eb84c4", 0xf8da_1d59_d883_4b95),
        (19, 0, "27923d72", 0xe654_58be_5d1c_458b),
        (20, 0, "f2dbd96d", 0x2ece_6c97_669c_849f),
        (21, 1, "4efccec8", 0x292d_217a_6907_30f5),
        (22, 9, "219c86a8", 0xc5e9_cb7c_48d3_6acd),
        (23, 4, "e2f137f2", 0x3f0b_998c_deb7_2d1c),
        (24, 4, "9ef2a4d9", 0x0b4e_c412_4f4f_f566),
        (25, 1, "cb86cfdd", 0x8ce8_b0a6_d7c1_d4cf),
        (26, 7, "2bfaaca2", 0xc0f5_8dc2_bf43_967f),
        (27, 0, "ed4ea447", 0x0733_4801_219b_f5b0),
        (28, 2, "d81b2446", 0x5e55_4757_e173_fea6),
        (29, 1, "84260b47", 0x0c12_8189_8006_348d),
        (30, 4, "4f4b140f", 0x58bb_a5bb_441a_ef98),
        (31, 1, "cefe90db", 0x53c1_2b7c_7e71_3372),
        (32, 0, "530f8c02", 0x8af0_ec61_6052_491a),
    ]
}

/// Seeds 1-16, attempts 0 and 1, option on: (seed, attempt, `landmarks_digest`). Seeds 2 and 11 fail their prefix on
/// attempt 1 (1); no attempt here is refused by the stage (2). Re-pinned by P-MAPGEN-SIG-SCALE-4 (2026-11-14): the
/// three-stream volcano's signature step refuses five of them (3: seed 7 attempt 0, 9/1, 12/0, 13/0, 16/0).
pub fn pinned_landmarks() -> [(i64, u64, u64); 32] {
    [
        (1, 0, 0xaf63_9053_39cd_7d76),
        (1, 1, 0x9cf8_0561_bdfc_ff72),
        (2, 0, 0x385e_a010_8d36_36da),
        (2, 1, 1),
        (3, 0, 0xf2b9_ba86_a974_39bb),
        (3, 1, 0x8103_8e53_75c3_3caf),
        (4, 0, 0xeeb7_ec6a_8b31_2708),
        (4, 1, 0xd508_72cf_44db_2399),
        (5, 0, 0x8657_7aaa_eed4_ed66),
        (5, 1, 0x96ad_64c4_53d6_61c5),
        (6, 0, 0x80b3_6ea0_2b34_d7af),
        (6, 1, 0xc351_9456_d4be_3633),
        (7, 0, 3),
        (7, 1, 0xf64f_7999_7b9a_2818),
        (8, 0, 0xc45f_d410_b928_1b52),
        (8, 1, 0xd8c7_d77d_cc70_f1c3),
        (9, 0, 0xd4cd_8967_3d4c_8813),
        (9, 1, 3),
        (10, 0, 0xf5fb_6560_2f29_cb78),
        (10, 1, 0x0bb0_40ea_936b_b1f6),
        (11, 0, 0x631b_fce9_ac89_04a1),
        (11, 1, 1),
        (12, 0, 3),
        (12, 1, 0x2b10_bae2_68fc_6129),
        (13, 0, 3),
        (13, 1, 0x147e_b971_053c_c139),
        (14, 0, 0xece4_012f_b5a7_d274),
        (14, 1, 0xcb02_a2c3_08a8_69f2),
        (15, 0, 0x3f9f_cd57_b22c_4d2c),
        (15, 1, 0xdba8_ba6e_f71b_9ff4),
        (16, 0, 3),
        (16, 1, 0xd22c_b645_0e56_3123),
    ]
}
