// The signature landmarks' digest-neutrality pins, in one place (P-MAPGEN-SIG-BLUEPRINT-1). A packet that is meant to
// change no generated map proves it against these; a packet that is meant to move a landmark re-pins them here, once,
// with the values `mapgen_signature_blueprint.rs` `print_signature_pins` prints (run it with `--ignored --nocapture`),
// and says so in its brief. Pinned on the stub commit of P-MAPGEN-SIG-BLUEPRINT-1 (the generator of
// feature/unity-rework @ 42ce9a72f plus the blueprint church), before the generic stamp.
//
// Anchors are not in `map_hash`; the JSON digests below sort each anchor's `entrance` row-major first, so that
// P-MAPGEN-SIG-BLUEPRINT-2, which sorts the entrances in the generator (nothing in the generator, the server or the
// client reads their order), needs no re-pin. The order itself is pinned elsewhere: exactly by
// `mapgen_signature_blueprint.rs` `placed_landed_rederives_every_written_cell` and the `pinned_others` digests.
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
    for a in &placed.anchors {
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

/// Seeds 1-32, option on (`pipeline::Options { signature: true, ..Default::default() }`, `certified_styled`): (seed,
/// the accepted attempt, `map_hash`, `map_digest`).
pub fn pinned_on_maps() -> [(i64, u64, &'static str, u64); 32] {
    [
        (1, 1, "f9e07c80", 0x5e4a_9353_77e4_fe50),
        (2, 0, "f1dee641", 0x5c2e_cf63_cac0_fc5c),
        (3, 0, "a2529cf4", 0x1154_9125_e1b5_fd75),
        (4, 0, "16abc908", 0xdf1f_57fd_f42f_e16e),
        (5, 1, "97f0b1c5", 0xa28c_3422_52c9_aa95),
        (6, 0, "55e3ecd7", 0xa67e_8ce4_9414_a210),
        (7, 2, "e815621b", 0x4ad4_982b_817a_f3ca),
        (8, 1, "e31cdbf9", 0x3a36_1d71_aa57_42a5),
        (9, 1, "568a6149", 0xc64b_6489_e689_ea21),
        (10, 0, "da53555d", 0xe561_51c6_3bbc_0a41),
        (11, 0, "033b6ac1", 0xabf5_585a_e151_dc1f),
        (12, 3, "440aa68b", 0x015a_2497_e098_4225),
        (13, 1, "bc9b1fca", 0x49aa_1980_5a58_477e),
        (14, 0, "c75372a8", 0x4ba5_2ac2_e433_4d32),
        (15, 0, "c2f26b50", 0xcc31_f713_a42c_b50a),
        (16, 0, "daac1a27", 0xdb24_52b4_b21f_e1da),
        (17, 1, "53259257", 0x4d77_378e_e771_11e0),
        (18, 0, "f9dd9315", 0xfe29_6b87_835e_6248),
        (19, 1, "8f028e11", 0xabbf_3f8e_bc19_7371),
        (20, 0, "c0f3811e", 0xf2b7_f97c_1051_0a15),
        (21, 0, "77009a7d", 0xa185_7e22_8402_44ed),
        (22, 1, "3a11b81d", 0x2ee6_2590_51ba_ee00),
        (23, 0, "482bc2c8", 0xe6a1_b91b_fe19_4986),
        (24, 1, "8f2fdab8", 0x7576_f396_5749_09d2),
        (25, 1, "952967c4", 0x077e_0c1a_6c7e_204e),
        (26, 1, "a7eacbff", 0x2e92_fa9a_ee46_3c1a),
        (27, 1, "7df5dd9a", 0xa755_853e_6410_7872),
        (28, 0, "8d84d7d0", 0xe26a_af82_b9e3_f4fc),
        (29, 1, "ca7142e3", 0x80d1_b8c6_f786_b1a4),
        (30, 0, "f702d886", 0x4c33_29fe_fdd4_bc76),
        (31, 0, "9d2f48db", 0x33ff_dce0_b72f_82e1),
        (32, 0, "10e3c8f7", 0x7c49_aac7_ae0f_ace4),
    ]
}

/// Seeds 1-16, attempts 0 and 1, option on: (seed, attempt, `landmarks_digest`). Seeds 2 and 11 fail their prefix on
/// attempt 1 (1); no attempt here is refused by the stage (2) or by the signature step (3).
pub fn pinned_landmarks() -> [(i64, u64, u64); 32] {
    [
        (1, 0, 0x25f7_43ec_affe_0a9f),
        (1, 1, 0xefa8_aa09_671d_ddce),
        (2, 0, 0x508b_c42f_e949_b826),
        (2, 1, 1),
        (3, 0, 0x59b7_9b40_ea5b_ce7c),
        (3, 1, 0x30a1_afec_352e_ffe4),
        (4, 0, 0xf928_3e9e_82d2_0e6d),
        (4, 1, 0x651d_8d3c_b8b7_c165),
        (5, 0, 0xdd1a_6223_b8c3_150a),
        (5, 1, 0x720d_2170_a9fc_bad7),
        (6, 0, 0xd2cd_429d_65d6_8c34),
        (6, 1, 0x1ff1_26a4_9f78_11f9),
        (7, 0, 0xf804_d4b8_a326_748b),
        (7, 1, 0xb2c0_0c4e_7d8e_f3a9),
        (8, 0, 0x6cbe_63ae_25d1_5e15),
        (8, 1, 0x0b8a_78c9_4533_424c),
        (9, 0, 0xb077_e0d7_c3b7_0dbf),
        (9, 1, 0x6611_ba19_c75a_058d),
        (10, 0, 0xf174_0aea_dd50_92bf),
        (10, 1, 0x4e73_baae_0973_707a),
        (11, 0, 0xb9c3_292d_8adb_3c6e),
        (11, 1, 1),
        (12, 0, 0xbdc4_3006_9d5f_bd85),
        (12, 1, 0x4606_4d4e_7064_5b02),
        (13, 0, 0x2769_76d2_8dca_9a8f),
        (13, 1, 0x3b9c_3643_eba6_c567),
        (14, 0, 0x56d4_7028_0292_0d78),
        (14, 1, 0xc045_0c9a_461c_a10c),
        (15, 0, 0x2076_20d7_c227_1922),
        (15, 1, 0x7723_446f_884e_4ae2),
        (16, 0, 0x3bf8_469f_5772_f33c),
        (16, 1, 0x1cd4_e944_652b_d7a2),
    ]
}
