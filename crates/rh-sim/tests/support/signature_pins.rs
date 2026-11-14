// The signature landmarks' digest-neutrality pins, in one place (P-MAPGEN-SIG-BLUEPRINT-1). A packet that is meant to
// change no generated map proves it against these; a packet that is meant to move a landmark re-pins them here, once,
// with the values `mapgen_signature_blueprint.rs` `print_signature_pins` prints (run it with `--ignored --nocapture`),
// and says so in its brief. Pinned on the stub commit of P-MAPGEN-SIG-BLUEPRINT-1 (the generator of
// feature/unity-rework @ 9890f291b, which holds the blueprint church and the Plague pools), before the generic stamp.
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
/// the accepted attempt, `map_hash`, `map_digest`).
pub fn pinned_on_maps() -> [(i64, u64, &'static str, u64); 32] {
    [
        (1, 1, "4714e5ba", 0xec10_0a9a_b0a3_f47c),
        (2, 4, "79a3e7e4", 0x6f0b_753e_6da6_eb56),
        (3, 0, "9322a080", 0xd7c7_6b1e_be59_63d5),
        (4, 0, "14935aac", 0xb683_ac5d_ac8a_8e2a),
        (5, 1, "262e3217", 0xb160_abee_d407_60ec),
        (6, 0, "79f9afdc", 0xf258_6670_c26a_2586),
        (7, 2, "bfbe7365", 0xd158_9754_db0f_128c),
        (8, 1, "74efb9d8", 0x874c_dbd3_0e04_d840),
        (9, 1, "7059d679", 0x6ef1_25e5_3680_2b70),
        (10, 0, "7f0f5469", 0x522b_2335_3dca_d21c),
        (11, 0, "9660b535", 0xd6fe_9710_1afa_749b),
        (12, 3, "a3a72c2e", 0x944a_d554_d7c5_cd4c),
        (13, 1, "1b9bfa01", 0x3042_8f55_1dd2_e793),
        (14, 0, "9734bfe3", 0x685a_3331_8d22_4276),
        (15, 0, "af9e81e4", 0xc4aa_96ef_0d2e_ebbd),
        (16, 0, "6fa7aa3c", 0xd390_7863_d7e3_6f69),
        (17, 1, "fc90a09e", 0x3cea_9f34_dea2_1832),
        (18, 0, "6e563aff", 0xd802_6973_bcf6_48b6),
        (19, 1, "d39f6f31", 0xf90b_7996_b8ef_aa87),
        (20, 0, "546bbe15", 0x7008_b1cb_22f7_fee1),
        (21, 0, "b93afa8d", 0x0294_6bbf_5fb6_d35d),
        (22, 1, "120cf50b", 0x8fd4_3ea4_db4f_51b7),
        (23, 0, "71acf3d6", 0xeb9f_99fa_10d1_f191),
        (24, 1, "cdb7c5e1", 0x1347_9b52_a1a7_ffd8),
        (25, 1, "8057df73", 0xfb81_3fb0_a04a_4143),
        (26, 1, "d5b2bca7", 0xd53b_4e0a_222c_fc6b),
        (27, 1, "8de38e9a", 0x05b3_794e_d058_fb30),
        (28, 0, "9995eed3", 0x93dc_055d_c88d_758a),
        (29, 1, "edc830d0", 0xf611_aeca_4cbb_564a),
        (30, 0, "7007b8d9", 0xd757_7ecc_8943_dc26),
        (31, 0, "37c72b64", 0xde8e_f645_7c2b_c8fa),
        (32, 0, "29caed0f", 0x0853_28d5_6744_3d83),
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
