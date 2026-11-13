//! P-WIRE17-HUD-2 oracle: the delivery projection carries the observation's champion panel inside the owner's build
//! summary (State key 13), quantized to `HUD_QUANTUM`, in ascending code order, and re-sends the summary only when a
//! quantized panel value changes.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_protocol::state::{WireBuildSummary, WirePanelValue, HUD_QUANTUM};
use rh_protocol::{ServerMsg, StateItem};
use rh_sim::build_summary::{ChampionPanel, PanelCode as C};
use rh_sim::observe::SummaryView;
use rh_sim::Observation;

fn items(frame: &[u8]) -> Vec<StateItem> {
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).expect("state frame") else {
        panic!("not a state frame")
    };
    items
}

fn summary_of(items: &[StateItem]) -> Option<WireBuildSummary> {
    items.iter().find_map(|item| match item {
        StateItem::BuildSummary(Some(v)) => Some(v.clone()),
        _ => None,
    })
}

/// A Fire owner's panel, unrounded, as `rh_sim::build_summary::champion_panel` produces it (shape only).
fn fire_panel() -> ChampionPanel {
    let mut p = ChampionPanel::default();
    for (code, v) in [
        (C::HitPhysical, 1.818_181_818_181_818),
        (C::HitMagic, 47.369_696_969_696_975),
        (C::HitTrue, 0.),
        (C::AttacksPerSecond, 1.98),
        (C::BurnDps, 64.375_04),
        (C::BurnSoRatio, 0.6),
        (C::BurnOffenseRatio, 0.5),
        (C::DotMult, 1.25),
        (C::RoamCharge, 250.),
        (C::RoamArmed, 0.),
    ] {
        p.set(code, v);
    }
    p
}

fn owner_obs() -> Observation {
    let mut obs = Observation::default();
    obs.summary = Some(SummaryView::default());
    obs.panel = Some(fire_panel());
    obs
}

fn full_state(obs: &Observation) -> Vec<StateItem> {
    let publisher = CollectionPublisher::default();
    let pending = publisher
        .prepare(obs, false, false, false)
        .expect("encodes");
    items(pending.frame.as_ref().expect("full state"))
}

#[test]
fn identities_move_for_the_panel() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        28,
        "observation gains the owner's panel (26), then codes 23-27 (27, P-WIRE17-HUD-2c); 28: P-WIRE17-HUD-3"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        22,
        "policy projection gains the panel (20), then codes 23-27 (21, P-WIRE17-HUD-2c); 22: P-WIRE17-HUD-3"
    );
}

/// The numeric sanity test on the wire side: every observed panel value arrives within half a quantum, under its
/// own code, in ascending code order, and nothing else is added.
#[test]
fn the_owner_panel_rides_in_key_13_within_half_a_quantum() {
    let obs = owner_obs();
    let wire = summary_of(&full_state(&obs)).expect("the owner's summary");
    let observed: Vec<(C, f64)> = fire_panel().iter().collect();
    assert_eq!(
        wire.panel.iter().map(|p| p.code).collect::<Vec<_>>(),
        observed.iter().map(|(c, _)| c.code()).collect::<Vec<_>>(),
        "exactly the observed codes, ascending"
    );
    for (w, (code, v)) in wire.panel.iter().zip(observed) {
        let back = f64::from(w.value) * HUD_QUANTUM;
        assert!(
            (back - v).abs() <= HUD_QUANTUM / 2. + 1e-12,
            "{code:?}: wire {} -> {back}, observed {v}",
            w.value
        );
    }
    assert_eq!(
        wire.panel[8],
        WirePanelValue {
            code: 8,
            value: 2_500_000
        },
        "roam charge 250 is 2,500,000 quanta"
    );
}

#[test]
fn a_summary_without_a_panel_sends_an_empty_panel() {
    let mut obs = owner_obs();
    obs.panel = None;
    let wire = summary_of(&full_state(&obs)).expect("the owner's summary");
    assert!(wire.panel.is_empty());
}

#[test]
fn a_non_finite_panel_value_is_refused_not_clamped() {
    let mut obs = owner_obs();
    obs.panel.as_mut().unwrap().set(C::BurnDps, f64::NAN);
    let publisher = CollectionPublisher::default();
    assert!(
        publisher.prepare(&obs, false, false, false).is_err(),
        "a NaN panel value is an encode error"
    );
    obs.panel.as_mut().unwrap().set(C::BurnDps, 1e9);
    assert!(
        publisher.prepare(&obs, false, false, false).is_err(),
        "a value past i32 quanta is an encode error"
    );
}

/// The roam charge and the Holy leech move every tick; the summary is re-sent only when a quantized panel value
/// changes, alone.
#[test]
fn the_summary_is_resent_only_when_a_quantized_panel_value_changes() {
    let mut obs = owner_obs();
    let mut publisher = CollectionPublisher::default();
    publisher
        .prepare(&obs, false, false, false)
        .expect("encodes")
        .commit(&mut publisher);

    obs.tick = 1;
    let p = obs.panel.as_mut().unwrap();
    p.set(C::BurnDps, p.get(C::BurnDps).unwrap() + HUD_QUANTUM / 10.);
    let quiet = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    assert!(quiet.frame.is_none(), "a sub-quantum change sends nothing");
    quiet.commit(&mut publisher);

    obs.tick = 2;
    obs.panel.as_mut().unwrap().set(C::RoamCharge, 255.);
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    assert!(pending.frame.is_some(), "a quantized change is sent");
    let items = items(pending.frame.as_ref().unwrap());
    assert_eq!(items.len(), 1, "only the summary is re-sent");
    let wire = summary_of(&items).expect("summary");
    assert_eq!(wire.panel[8].value, 2_550_000);
}
