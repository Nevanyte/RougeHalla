//! P-WIRE17-HUD-2c oracle (wire side): State key 13's champion panel gains codes 23-27 (Fire roam speed bonus and
//! burst, hit multiplier, weapon scaling's physical and magic additions) and the Welcome HUD block gains terms 19-22 (the
//! Fire roam constants). Layout unchanged from P-WIRE17-HUD-2 / -2b; only the bounds move: `PANEL_CODE_COUNT` and
//! `MAX_PANEL_VALUES` 23 -> 28, `HUD_TERM_COUNT` and `MAX_HUD_TERMS` 19 -> 23 (docs/backlog/packets/P-WIRE17-HUD-2c.md).
use rh_protocol::samples::{malformed_server, sample_hud, server_samples};
use rh_protocol::state::{WireBuildSummary, WirePanelValue, MAX_PANEL_VALUES, PANEL_CODE_COUNT};
use rh_protocol::*;

const T_STATE: u8 = 0x88;

fn pv(code: u8, value: i32) -> WirePanelValue {
    WirePanelValue { code, value }
}

/// The P-WIRE17-HUD-2 Fire panel (codes 0..=9, `state_build_summary_panel`) followed by the new codes for the same
/// worked owner (Fire, Wand, Here Comes the Boom, Offense I, SO I, 5 s out of combat; see
/// crates/rh-sim/src/observe/panel_tooltip_tests.rs): roam bonus 0.125, burst 50 + 0.4 x 12 = 54.8, hit mult 2.5,
/// scaling 0.3 x 12 / (0.6 x 1.65) = 3.636364 physical and 12 / 0.99 = 12.121212 magic, in 1e-4 quanta.
fn tooltip_panel() -> Vec<WirePanelValue> {
    [
        (0, 18_182),
        (1, 473_697),
        (2, 0),
        (3, 19_800),
        (4, 643_750),
        (5, 6_000),
        (6, 5_000),
        (7, 12_500),
        (8, 2_500_000),
        (9, 0),
        (23, 1_250),
        (24, 548_000),
        (25, 25_000),
        (26, 36_364),
        (27, 121_212),
    ]
    .into_iter()
    .map(|(c, v)| pv(c, v))
    .collect()
}

/// T_STATE, tick 5, one item, key 13, present, nine zero gains, no mob rows, then the panel.
fn summary_frame(panel: &[WirePanelValue]) -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 13, 1];
    b.extend_from_slice(&[0; 36]);
    b.push(0);
    b.push(panel.len() as u8);
    for p in panel {
        b.push(p.code);
        b.extend_from_slice(&p.value.to_le_bytes());
    }
    b
}

fn state(panel: Vec<WirePanelValue>) -> ServerMsg {
    ServerMsg::State {
        tick: 5,
        items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
            panel,
            ..WireBuildSummary::default()
        }))],
    }
}

#[test]
fn the_bounds_move_for_the_appended_codes() {
    assert_eq!(PANEL_CODE_COUNT, 28, "panel codes 0..=27");
    assert_eq!(MAX_PANEL_VALUES, 28, "at most one value per code");
    assert_eq!(HUD_TERM_COUNT, 30, "HUD terms 0..=29");
    assert_eq!(MAX_HUD_TERMS, 30);
    assert_eq!(HudTerm::FireRoamRampMs as u8, 19);
    assert_eq!(HudTerm::FireRoamChargeMax as u8, 20);
    assert_eq!(HudTerm::FireRoamBurstBase as u8, 21);
    assert_eq!(HudTerm::FireRoamBurstAdShare as u8, 22);
}

#[test]
fn key_13_carries_codes_23_to_27_and_refuses_beyond() {
    let msg = state(tooltip_panel());
    let bytes = msg.try_encode().expect("codes 23-27 encode");
    assert_eq!(bytes, summary_frame(&tooltip_panel()), "layout unchanged");
    assert_eq!(ServerMsg::decode(&bytes).as_ref(), Ok(&msg), "round trip");

    // Every code once: the largest panel is 28 rows.
    let full: Vec<_> = (0..28).map(|c| pv(c, i32::MIN)).collect();
    assert!(state(full.clone()).try_encode().is_ok(), "28 codes encode");
    assert!(ServerMsg::decode(&summary_frame(&full)).is_ok());

    let mut unknown = tooltip_panel();
    unknown.push(pv(28, 1));
    assert!(state(unknown.clone()).try_encode().is_err(), "code 28");
    assert_eq!(
        ServerMsg::decode(&summary_frame(&unknown)),
        Err(DecodeError::BadField("summary panel code"))
    );
    let mut order = tooltip_panel();
    order.swap(10, 14); // 27 before 23
    assert!(state(order.clone()).try_encode().is_err(), "order");
    assert_eq!(
        ServerMsg::decode(&summary_frame(&order)),
        Err(DecodeError::BadField("summary panel order"))
    );
    let over: Vec<_> = (0..29).map(|c| pv(c, 1)).collect();
    match state(over.clone()).try_encode() {
        Err(EncodeError::TooMany { n, max, .. }) => assert_eq!((n, max), (29, 28)),
        other => panic!("29 panel values must be refused as TooMany, got {other:?}"),
    }
    assert!(matches!(
        ServerMsg::decode(&summary_frame(&over)),
        Err(DecodeError::TooMany(_))
    ));
}

#[test]
fn the_tooltip_panel_vector_is_committed() {
    let got = server_samples()
        .into_iter()
        .find_map(|(n, m)| (n == "state_build_summary_panel_tooltip").then_some(m))
        .expect("new server vector state_build_summary_panel_tooltip (brief, Vector names)");
    assert_eq!(
        got,
        ServerMsg::State {
            tick: 216,
            items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
                gains: [25_000, 15_000, 0, -5_000, 0, 0, 0, 0, 0],
                mob_rows: Vec::new(),
                panel: tooltip_panel(),
            }))],
        }
    );
}

/// The panel refusal vectors follow the new bounds (exact bytes; P-WIRE17-HUD-2 "summary prefix" = `88 05 01 0d 01` +
/// 36 zero bytes). `state_build_summary_panel_code_23` is retired (code 23 is now valid) and replaced by the
/// bound-neutral `state_build_summary_panel_code_unknown` (code = PANEL_CODE_COUNT = 28).
#[test]
fn the_panel_refusal_vectors_follow_the_new_bounds() {
    let committed = malformed_server();
    let find = |name: &str| {
        committed
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, b)| b.clone())
    };
    assert_eq!(
        find("state_build_summary_panel_code_23"),
        None,
        "retired: code 23 decodes now"
    );
    let unknown = find("state_build_summary_panel_code_unknown").expect("new malformed vector");
    assert_eq!(unknown, summary_frame(&[pv(28, 1)]));
    assert_eq!(
        ServerMsg::decode(&unknown),
        Err(DecodeError::BadField("summary panel code"))
    );
    let over = find("state_build_summary_panel_count_over").expect("kept");
    let rows: Vec<_> = (0..29).map(|c| pv(c, 1)).collect();
    assert_eq!(over, summary_frame(&rows), "29 rows, codes 0..=28");
    assert_eq!(ServerMsg::decode(&over), Err(DecodeError::TooMany(29)));
}

/// The Welcome's HUD block carries the Fire roam constants (packages/shared/src/fireRoam.ts:2-7), as the legacy roam
/// line prints them (championCombatModel.ts:115-116): ramp 20000 ms ("20 s"), full charge 1000, burst 50 + 0.4 x
/// Offense.
#[test]
fn the_welcome_block_carries_the_fire_roam_terms() {
    let hud = sample_hud();
    let tail: Vec<(u8, f64)> = hud
        .terms
        .iter()
        .filter(|t| t.code >= 19)
        .map(|t| (t.code, t.value))
        .collect();
    assert_eq!(
        tail,
        vec![
            (19, 20_000.0),
            (20, 1_000.0),
            (21, 50.0),
            (22, 0.4),
            (23, 0.0),
            (24, 450.0),
            (25, 64.0),
            (26, 224.0),
            (27, 4000.0),
            (28, 24.0),
            (29, 8.0)
        ],
        "sample terms 19-29"
    );
    assert_eq!(hud.terms.len(), 30, "every code once");
    let welcome = server_samples()
        .into_iter()
        .find(|(n, _)| *n == "welcome")
        .expect("welcome")
        .1;
    let ServerMsg::Welcome { hud: sent, .. } = welcome else {
        panic!("welcome")
    };
    assert_eq!(sent, hud, "the welcome vector carries the sample block");

    // Round trip of a block carrying only the new terms, and the term refusals at the new bounds.
    let terms = |rows: &[(u8, f64)]| WireHudContent {
        scaling: Vec::new(),
        terms: rows
            .iter()
            .map(|&(code, value)| WireHudTerm { code, value })
            .collect(),
    };
    assert_eq!(
        hud_content::content_fault(&terms(&[(19, 20_000.0), (22, 0.4)])),
        None
    );
    assert_eq!(
        hud_content::content_fault(&terms(&[(30, 1.0)])),
        Some("hud term code")
    );
    let all: Vec<(u8, f64)> = (0..31).map(|c| (c, 1.0)).collect();
    assert_eq!(
        hud_content::content_fault(&terms(&all)),
        Some("hud term count")
    );
    assert_eq!(
        hud_content::content_fault(&terms(&[(22, 0.4), (19, 20_000.0)])),
        Some("hud term order")
    );
}

/// The Welcome term refusal vectors keep their names and move to the new bounds: `welcome_hud_term_count` is a count of
/// 31 with no rows, `welcome_hud_term_code` one term (30, 1.0). Both are the `welcome_hud_term_infinite` frame (one term
/// row (0, +inf)) with only that row changed.
#[test]
fn the_welcome_term_refusal_vectors_follow_the_new_bounds() {
    let committed = malformed_server();
    let find = |name: &str| {
        committed
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, b)| b.clone())
            .unwrap_or_else(|| panic!("missing malformed vector {name}"))
    };
    let infinite = find("welcome_hud_term_infinite");
    let mut row = vec![0u8];
    row.extend_from_slice(&f64::INFINITY.to_le_bytes());
    let at = infinite
        .windows(row.len())
        .rposition(|w| w == row.as_slice())
        .expect("the infinite term row");
    assert_eq!(infinite[at - 1], 1, "one term");

    let mut want_code = infinite.clone();
    want_code[at] = 30;
    want_code[at + 1..at + 9].copy_from_slice(&1.0f64.to_le_bytes());
    let code = find("welcome_hud_term_code");
    assert_eq!(code, want_code, "welcome_hud_term_code: term (30, 1.0)");
    assert_eq!(
        ServerMsg::decode(&code),
        Err(DecodeError::BadField("hud term code"))
    );

    let mut want_count = infinite[..at - 1].to_vec();
    want_count.push(31);
    want_count.extend_from_slice(&infinite[at + 9..]);
    let count = find("welcome_hud_term_count");
    assert_eq!(
        count, want_count,
        "welcome_hud_term_count: count 31, no rows"
    );
    assert_eq!(
        ServerMsg::decode(&count),
        Err(DecodeError::BadField("hud term count"))
    );
}
