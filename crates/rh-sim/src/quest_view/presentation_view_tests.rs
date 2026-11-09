//! Entitlement/privacy controls over real native facts; grants here are labelled trusted producer setup.
use super::*;
use serde_json::Value as V;
fn captured_reward(def: &str, context: &str) -> String {
    let v: V = serde_json::from_str(include_str!(
        "../../../../parity/quest-presentation/source.json"
    ))
    .unwrap();
    let row = v["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == def)
        .unwrap();
    row["probes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["input"]["name"] == context)
        .unwrap()["observed"]["reward"]
        .as_str()
        .unwrap()
        .to_owned()
}
#[test]
fn owner_farm_context_is_private_read_only_and_independent_of_duplicate_labels_and_hidden_rows() {
    let mut s = sim_with_names([false; 3], ["same label", "same label", "third"]);
    assert_eq!(s.w.players[0].seat.name, s.w.players[1].seat.name);
    let mut one = QuestObserver::new(PlayerId(1));
    let mut two = QuestObserver::new(PlayerId(2));
    let before_one = committed_view(&mut one, &s);
    let before_two = committed_view(&mut two, &s);
    let def_id = before_one
        .rows
        .iter()
        .find(|row| row.state == RowState::Open)
        .unwrap()
        .def
        .clone();
    let def = crate::quests::def_by_id(&def_id).unwrap();
    let (stat, _) = crate::quests::rules::reward_stats(def);
    // Existing real native grant producer is trusted setup, not a C-INPUT acquisition or source-world parity claim.
    assert_eq!(
        crate::modifiers::farm::grant_mob_stat(&s.k, &mut s.w, PlayerId(1), stat, 137),
        137
    );
    let snapshot = serde_json::to_value(&s).unwrap();
    let after_one = committed_view(&mut one, &s);
    let after_two = committed_view(&mut two, &s);
    assert_eq!(
        serde_json::to_value(&s).unwrap(),
        snapshot,
        "formatting never mutates state/RNG"
    );
    let own = after_one.rows.iter().find(|row| row.def == def_id).unwrap();
    let foreign = after_two.rows.iter().find(|row| row.def == def_id).unwrap();
    assert_eq!(own.reward, captured_reward(&def_id, "open-counted-feed0"));
    assert_eq!(foreign.reward, captured_reward(&def_id, "open-zero"));
    assert_eq!(
        own.handle,
        before_one
            .rows
            .iter()
            .find(|row| row.def == def_id)
            .unwrap()
            .handle
    );
    assert_eq!(
        foreign.handle,
        before_two
            .rows
            .iter()
            .find(|row| row.def == def_id)
            .unwrap()
            .handle
    );
    assert_eq!(
        crate::modifiers::farm::grant_mob_stat(&s.k, &mut s.w, PlayerId(2), stat, 7),
        7
    );
    assert_eq!(
        committed_view(&mut one, &s),
        after_one,
        "foreign Farm facts cannot influence the owner's metadata"
    );
    // Deliberately noncanonical hidden-data guard: unentitled rows must not even read this bogus definition index.
    let hidden =
        s.w.quests
            .as_mut()
            .unwrap()
            .offers
            .iter_mut()
            .find(|offer| !offer.published && offer.finder.is_none())
            .unwrap();
    hidden.def = u16::MAX;
    assert_eq!(committed_view(&mut one, &s), after_one);
}
#[test]
fn disabled_bot_and_unknown_viewers_get_no_quest_metadata() {
    let s = sim_with_bots([false, true, false]);
    assert!(crate::observe(&s, PlayerId(2), &[]).quests.is_none());
    assert!(crate::observe(&s, PlayerId(99), &[]).quests.is_none());
    let arena = arena();
    let at = arena.spawns[0];
    let plain = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(7),
        &[Placement {
            profile: "plain".into(),
            faction: crate::FactionId::Holy,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    assert!(crate::observe(&plain, PlayerId(1), &[]).quests.is_none());
}
