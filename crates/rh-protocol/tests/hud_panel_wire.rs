//! P-WIRE17-HUD-2 oracle: the champion panel appended to State key 13, its golden vectors, and the shared negative
//! vectors for the P-WIRE17-HUD-1 fields (reviewer note 2026-11-11). Layout (docs/backlog/packets/P-WIRE17-HUD-2.md,
//! "Wire layout"): after the mob rows, panel count u8 (<= MAX_PANEL_VALUES), then rows of code u8 (< PANEL_CODE_COUNT,
//! strictly ascending) and value i32 LE in HUD_QUANTUM units. Every multi-byte integer is little-endian.
use rh_protocol::samples::{malformed_server, server_samples};
use rh_protocol::state::{
    WireBuildSummary, WireMobBonusRow, WirePanelValue, MAX_PANEL_VALUES, PANEL_CODE_COUNT,
};
use rh_protocol::*;

const T_STATE: u8 = 0x88;

fn state(items: Vec<StateItem>) -> ServerMsg {
    ServerMsg::State { tick: 5, items }
}

fn round_trip(msg: &ServerMsg) -> Vec<u8> {
    let bytes = msg.try_encode().expect("the panel state encodes");
    assert_eq!(
        &ServerMsg::decode(&bytes).expect("the panel state decodes"),
        msg,
        "decode(encode(x)) == x"
    );
    bytes
}

fn pv(code: u8, value: i32) -> WirePanelValue {
    WirePanelValue { code, value }
}

/// A Fire owner's panel (codes 0..=9): hit split, attacks per second, burn, its two ratios, DoT mult, roam.
fn fire_panel() -> Vec<WirePanelValue> {
    vec![
        pv(0, 18_182),
        pv(1, 473_697),
        pv(2, 0),
        pv(3, 19_800),
        pv(4, 643_750),
        pv(5, 6_000),
        pv(6, 5_000),
        pv(7, 12_500),
        pv(8, 2_500_000),
        pv(9, 0),
    ]
}

fn fire_summary() -> WireBuildSummary {
    WireBuildSummary {
        gains: [25_000, 15_000, 0, -5_000, 0, 0, 0, 0, 0],
        mob_rows: vec![WireMobBonusRow {
            mob_type: 0,
            stat: 2,
            stacks: 7,
            total: 700,
        }],
        panel: fire_panel(),
    }
}

/// T_STATE, tick 5, one item, key 13, present, then the summary bytes as the brief lays them out.
fn frame(s: &WireBuildSummary) -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 13, 1];
    for g in s.gains {
        b.extend_from_slice(&g.to_le_bytes());
    }
    b.push(s.mob_rows.len() as u8);
    for r in &s.mob_rows {
        b.push(r.mob_type);
        b.push(r.stat);
        assert!(r.stacks < 0x80, "one-byte varint in these cases");
        b.push(r.stacks as u8);
        b.extend_from_slice(&r.total.to_le_bytes());
    }
    b.push(s.panel.len() as u8);
    for p in &s.panel {
        b.push(p.code);
        b.extend_from_slice(&p.value.to_le_bytes());
    }
    b
}

#[test]
fn the_panel_is_appended_to_key_13_after_the_mob_rows() {
    assert_eq!(
        PANEL_CODE_COUNT, 28,
        "codes 0..=22 (brief, Field list), 23..=27 (P-WIRE17-HUD-2c)"
    );
    assert_eq!(MAX_PANEL_VALUES, 28, "at most one value per code");
    let s = fire_summary();
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(Some(s.clone()))])),
        frame(&s),
        "Fire panel layout"
    );
    let empty = WireBuildSummary::default();
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(Some(empty.clone()))])),
        frame(&empty),
        "an empty panel is one zero count byte"
    );
    // Every code once, extreme values: the largest panel.
    let full = WireBuildSummary {
        panel: (0..PANEL_CODE_COUNT)
            .map(|c| pv(c, if c % 2 == 0 { i32::MAX } else { i32::MIN }))
            .collect(),
        ..WireBuildSummary::default()
    };
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(Some(full.clone()))])),
        frame(&full)
    );
}

#[test]
fn the_panel_refuses_unknown_codes_disorder_and_an_over_cap_count() {
    // Sanity: the unmodified summary is accepted, so the refusals below are about the named fault.
    round_trip(&state(vec![StateItem::BuildSummary(Some(fire_summary()))]));
    let mut cases = Vec::new();
    let mut s = fire_summary();
    s.panel.push(pv(PANEL_CODE_COUNT, 1));
    cases.push(("panel code 28", s, "summary panel code"));
    let mut s = fire_summary();
    s.panel.swap(0, 1);
    cases.push(("panel codes out of order", s, "summary panel order"));
    let mut s = fire_summary();
    s.panel[1].code = 0;
    cases.push(("duplicate panel code", s, "summary panel order"));
    for (why, s, reason) in cases {
        assert!(
            state(vec![StateItem::BuildSummary(Some(s.clone()))])
                .try_encode()
                .is_err(),
            "encoder refuses: {why}"
        );
        assert_eq!(
            ServerMsg::decode(&frame(&s)),
            Err(DecodeError::BadField(reason)),
            "decoder refuses: {why}"
        );
    }

    let over = WireBuildSummary {
        panel: (0..=MAX_PANEL_VALUES as u8).map(|c| pv(c, 1)).collect(),
        ..WireBuildSummary::default()
    };
    match state(vec![StateItem::BuildSummary(Some(over.clone()))]).try_encode() {
        Err(EncodeError::TooMany { n, max, .. }) => assert_eq!((n, max), (29, 28)),
        other => panic!("29 panel values must be refused as TooMany, got {other:?}"),
    }
    assert!(
        matches!(
            ServerMsg::decode(&frame(&over)),
            Err(DecodeError::TooMany(_))
        ),
        "the decoder refuses a panel count of 29 before reading the rows"
    );
}

fn sample(name: &str) -> ServerMsg {
    server_samples()
        .into_iter()
        .find_map(|(n, m)| (n == name).then_some(m))
        .unwrap_or_else(|| panic!("server sample {name} is missing (brief, Vector names)"))
}

#[test]
fn the_golden_vectors_carry_the_panel() {
    let names: Vec<&str> = server_samples().into_iter().map(|(n, _)| n).collect();
    assert!(
        names.contains(&"state_build_summary_panel"),
        "new server vector state_build_summary_panel"
    );
    assert_eq!(
        sample("state_build_summary_panel"),
        ServerMsg::State {
            tick: 216,
            items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
                gains: [25_000, 15_000, 0, -5_000, 0, 0, 0, 0, 0],
                mob_rows: Vec::new(),
                panel: fire_panel(),
            }))],
        },
        "state_build_summary_panel is the brief's Fire panel"
    );
    // The existing HUD-1 vectors keep their values and gain an empty panel.
    let ServerMsg::State { items, .. } = sample("state_build_summary") else {
        panic!("state")
    };
    assert!(matches!(&items[0], StateItem::BuildSummary(Some(s)) if s.panel.is_empty()));

    // The all-key maximum State carries every panel code (still within its exact byte budget, which the existing
    // quest_metadata test pins at 247,696).
    let ServerMsg::State { items, .. } = sample("state_all_max_budget") else {
        panic!("state")
    };
    let summary = items
        .iter()
        .find_map(|i| match i {
            StateItem::BuildSummary(Some(s)) => Some(s),
            _ => None,
        })
        .expect("max State carries a summary");
    assert_eq!(
        summary.panel.iter().map(|p| p.code).collect::<Vec<_>>(),
        (0..PANEL_CODE_COUNT).collect::<Vec<_>>(),
        "max State summary carries all 28 panel codes"
    );
    assert!(summary.panel.iter().all(|p| p.value == i32::MIN));
}

/// The camp row of hud_wire.rs before its HUD tail: T_STATE, tick 5, one item, key 6, one row, mob 3, elite 29,
/// alive 2, state 0, cleared_at 1000, respawn_at 181000.
fn camp_prefix() -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 6, 1, 3, 30, 2, 0];
    b.extend_from_slice(&1000f64.to_le_bytes());
    b.extend_from_slice(&181000f64.to_le_bytes());
    b
}

/// T_STATE, tick 5, one item, key 13, present, nine zero gains.
fn summary_prefix() -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 13, 1];
    b.extend_from_slice(&[0; 36]);
    b
}

/// The shared negative vectors (brief, "Vector names"): exact bytes, each refused for its reason.
fn wanted_negatives() -> Vec<(&'static str, Vec<u8>, DecodeError)> {
    use DecodeError::*;
    let with = |mut b: Vec<u8>, tail: &[u8]| {
        b.extend_from_slice(tail);
        b
    };
    let mut gains_short = vec![T_STATE, 5, 1, 13, 1];
    gains_short.extend_from_slice(&[0; 32]);
    let row = |mob: u8, stat: u8| {
        let mut r = vec![mob, stat, 1];
        r.extend_from_slice(&1i32.to_le_bytes());
        r
    };
    let panel_row = |code: u8| {
        let mut r = vec![code];
        r.extend_from_slice(&1i32.to_le_bytes());
        r
    };
    let mut over = summary_prefix();
    over.push(0);
    over.push(29);
    for c in 0..29 {
        over.extend(panel_row(c));
    }
    vec![
        (
            "state_camp_reward_stat_10",
            with(camp_prefix(), &[10, 0x10, 0x27, 0]),
            BadField("camp reward"),
        ),
        (
            "state_camp_ward_verdict_3",
            with(camp_prefix(), &[0, 3]),
            BadField("camp ward"),
        ),
        (
            "state_camp_ward_missing_expiry",
            with(camp_prefix(), &[0, 1]),
            Truncated,
        ),
        ("state_build_summary_gains_short", gains_short, Truncated),
        (
            "state_build_summary_mob_stat_9",
            with(with(with(summary_prefix(), &[1]), &row(0, 9)), &[0]),
            BadField("summary stat code"),
        ),
        (
            // P-WIRE17-HUD-2c: code 23 is valid now; the bound-neutral name carries code PANEL_CODE_COUNT = 28.
            "state_build_summary_panel_code_unknown",
            with(with(summary_prefix(), &[0, 1]), &panel_row(28)),
            BadField("summary panel code"),
        ),
        (
            "state_build_summary_panel_order",
            with(
                with(with(summary_prefix(), &[0, 2]), &panel_row(3)),
                &panel_row(3),
            ),
            BadField("summary panel order"),
        ),
        ("state_build_summary_panel_count_over", over, TooMany(29)),
    ]
}

#[test]
fn shared_negative_vectors_cover_the_hud_fields() {
    let committed = malformed_server();
    let missing: Vec<&str> = wanted_negatives()
        .into_iter()
        .map(|(name, _, _)| name)
        .filter(|name| !committed.iter().any(|(n, _)| n == name))
        .collect();
    assert_eq!(
        missing,
        Vec::<&str>::new(),
        "malformed server vectors missing from samples::malformed_server"
    );
    for (name, bytes, reason) in wanted_negatives() {
        let got = committed.iter().find(|(n, _)| *n == name).expect(name);
        assert_eq!(got.1, bytes, "{name}: bytes as the brief defines them");
        let err = ServerMsg::decode(&bytes).expect_err(name);
        assert_eq!(
            std::mem::discriminant(&err),
            std::mem::discriminant(&reason),
            "{name}: {err:?}"
        );
        if let (DecodeError::BadField(a), DecodeError::BadField(b)) = (&err, &reason) {
            assert_eq!(a, b, "{name}");
        }
    }
}
