//! P-BOT-BRAIN-CONTINUITY-1 oracle: on a live seat (`set_tracked_mobs(true)`) a mob record keyed by the seat's own
//! track survives across ticks while the track lives, is dropped [`TRACK_RETAIN_MS`] after its key was last carried,
//! and Memory stays bounded over a long run of ever-new keys. Source-shaped callers (the flag off) keep legacy's rule.
use super::source_input::{MemoryPercept, PerceptExtras, PerceptMinimap, PerceptMob, PerceptSelf};
use super::*;
use crate::bots::types::TierId;
use rh_sim::{FactionId, WeaponId};

fn features() -> Features {
    Features {
        message_types: Vec::new(),
        wishes: false,
        status_effects: false,
        fields: false,
        planning: false,
        chests: false,
        skills: false,
        relics: false,
        camps: false,
        hazards: false,
    }
}

fn memory(tracked: bool) -> Memory {
    let mut m = Memory::new(MemoryConfig {
        self_id: "self".into(),
        tier: TierParams::by_id(TierId::ALL[0]),
        map: MemoryMap { camps: Vec::new() },
        features: features(),
    })
    .expect("memory");
    m.set_tracked_mobs(tracked);
    m
}

fn mob(id: &str, x: f64) -> PerceptMob {
    PerceptMob {
        id: id.into(),
        kind: "mob".into(),
        name: "Cinder Hound".into(),
        type_: Some("cinderHound".into()),
        faction: Some(FactionId::Fire),
        x,
        y: 0.,
        status: "alive".into(),
        hp_frac: 1.,
        in_hand: Some(WeaponId::Axe),
    }
}

fn percept(now: f64, mobs: Vec<PerceptMob>) -> MemoryPercept {
    MemoryPercept {
        now,
        view_t: now,
        self_: PerceptSelf {
            id: "self".into(),
            name: "self".into(),
            x: 0.,
            y: 0.,
            facing: 0.,
            status: "alive".into(),
            hp: 100.,
            max_hp: 100.,
            attack_target: None,
            move_seq: 0.,
        },
        hud_in_coliseum: false,
        fighters: Vec::new(),
        mobs,
        containers: Vec::new(),
        projectiles: Vec::new(),
        minimap: PerceptMinimap {
            t: f64::NAN,
            mobs: Vec::new(),
        },
        events: Vec::new(),
        extras: PerceptExtras::default(),
        features: features(),
    }
}

fn keys(m: &Memory) -> Vec<String> {
    m.mobs.iter().map(|(k, _)| k.clone()).collect()
}

#[test]
fn a_tracked_mob_record_survives_across_ticks_while_its_key_is_carried() {
    let mut m = memory(true);
    for i in 0..200 {
        let now = 1000. + f64::from(i) * 50.;
        m.observe(&percept(now, vec![mob("m7", f64::from(i))]))
            .expect("observe");
        assert_eq!(
            keys(&m),
            vec!["m7".to_string()],
            "tick {i}: one record, the track's"
        );
    }
    let record = m.mob("m7").expect("kept");
    assert_eq!(
        record.home,
        Some(Vec2::new(0., 0.)),
        "the home is where the track began"
    );
    assert_eq!(record.pos, Vec2::new(199., 0.), "refreshed every tick");
}

#[test]
fn an_ended_track_record_is_dropped_after_the_retention_bound() {
    let mut m = memory(true);
    m.observe(&percept(1000., vec![mob("m1", 10.)]))
        .expect("observe");
    // The track ends (the mob left the view): the record is kept for TRACK_RETAIN_MS after it was last carried.
    m.observe(&percept(1050., Vec::new())).expect("observe");
    assert_eq!(
        keys(&m),
        vec!["m1".to_string()],
        "kept just after the track ended"
    );
    m.observe(&percept(1000. + TRACK_RETAIN_MS, Vec::new()))
        .expect("observe");
    assert_eq!(keys(&m), vec!["m1".to_string()], "kept up to the bound");
    m.observe(&percept(1000. + TRACK_RETAIN_MS + 50., Vec::new()))
        .expect("observe");
    assert!(keys(&m).is_empty(), "dropped past the bound");
    assert!(m.m_aux.is_empty(), "its aux record too");
}

#[test]
fn memory_stays_bounded_over_a_long_run_of_new_tracks() {
    let mut m = memory(true);
    let mut peak = 0;
    // 20 minutes at 20 Hz; every second a new track begins and the previous one ends (8 visible at a time).
    for i in 0..24_000u32 {
        let now = f64::from(i) * 50.;
        let first = i / 20;
        let mobs = (first..first + 8)
            .map(|k| mob(&format!("m{k}"), f64::from(k)))
            .collect();
        m.observe(&percept(now, mobs)).expect("observe");
        peak = peak.max(m.mobs.len()).max(m.m_aux.len());
    }
    let bound = 8 + (TRACK_RETAIN_MS / 1000.).ceil() as usize + 1;
    assert!(peak <= bound, "peak {peak} records, bound {bound}");
}

#[test]
fn the_source_rule_keeps_records_for_the_run_when_the_flag_is_off() {
    let mut m = memory(false);
    m.observe(&percept(1000., vec![mob("n5", 10.)]))
        .expect("observe");
    m.observe(&percept(1000. + 10. * TRACK_RETAIN_MS, Vec::new()))
        .expect("observe");
    assert_eq!(
        keys(&m),
        vec!["n5".to_string()],
        "legacy keeps mob records for the run"
    );
}
