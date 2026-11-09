use rh_protocol::samples::{malformed_server, server_samples};
use rh_protocol::*;

fn server_named(name: &str) -> ServerMsg {
    server_samples()
        .into_iter()
        .find_map(|(candidate, msg)| (candidate == name).then_some(msg))
        .unwrap_or_else(|| panic!("missing server sample {name}"))
}

#[test]
fn quest_metadata_is_ordered_and_exact_view_budget_is_enforced() {
    let aggregate = server_named("state_all_max_budget");
    let aggregate_bytes = aggregate.try_encode().unwrap();
    assert_eq!(aggregate_bytes.len(), 247_696);
    assert_eq!(ServerMsg::decode(&aggregate_bytes).unwrap(), aggregate);

    let max = server_named("state_quests_max_24576");
    let bytes = max.try_encode().unwrap();
    assert_eq!(bytes.len() - 4, 24_576);
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), max);

    let (name, bytes) = malformed_server()
        .into_iter()
        .find(|(name, _)| *name == "state_quests_over_24576")
        .unwrap();
    assert_eq!(name, "state_quests_over_24576");
    assert_eq!(
        ServerMsg::decode(&bytes),
        Err(DecodeError::TooLarge(24_577))
    );

    let available = server_named("state_quests_available");
    let ServerMsg::State { items, .. } = ServerMsg::decode(&available.encode()).unwrap() else {
        panic!("quest vector is State")
    };
    let StateItem::Quests(Some(view)) = items.last().unwrap() else {
        panic!("quest view is available")
    };
    let row = &view.rows[0];
    assert_eq!(row.name, "The Ember Sweep");
    assert_eq!(row.giver_label, "Keeper Asha");
    assert_eq!(row.brief, "Thin the nearby fire mobs.");
    assert_eq!(row.objective, "Defeat 3 fire mobs");
    assert_eq!(row.reward, "A small reward");
}
