//! Native replay of the frozen separately-labelled Knowledge constructor witness (32 constructors / 2,240 draws /
//! 111 Brain call bindings), P-BOT-BRAIN-NATIVE-1.
//!
//! This is the constructor dependency that sits outside the Brain's observer lanes: for each declared `(tier, tag-3
//! seed)` the harness creates a real `Knowledge`, records all 70 constructor draws from the same mulberry stream and
//! compares every declared query result, then binds the 111 frozen Brain `knowledge.*` callback rows to the actual
//! Knowledge instance (recomputed from their declared arguments), while the main replay harness separately compares those
//! same callback rows transitively through the native Brain trace.

use super::source_input;
use super::trace::BVal;
use crate::bots::knowledge::Knowledge;
use crate::bots::random::Rng;
use crate::bots::types::{BotWeapon, FightOdds, OpponentSnapshot, SelfView, TierParams};
use rh_sim::{FactionId, WeaponId};

fn as_arr<'a>(value: &'a BVal, label: &str) -> &'a [BVal] {
    value
        .as_arr()
        .unwrap_or_else(|| panic!("{label}: expected an array"))
}

fn as_str<'a>(value: &'a BVal, label: &str) -> &'a str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("{label}: expected a string"))
}

fn as_num(value: &BVal, label: &str) -> f64 {
    value
        .as_num()
        .unwrap_or_else(|| panic!("{label}: expected a number"))
}

fn as_bool(value: &BVal, label: &str) -> bool {
    value
        .as_bool()
        .unwrap_or_else(|| panic!("{label}: expected a bool"))
}

fn faction_of(name: &str, label: &str) -> FactionId {
    FactionId::ALL
        .iter()
        .copied()
        .find(|faction| faction.as_str() == name)
        .unwrap_or_else(|| panic!("{label}: unknown faction {name}"))
}

fn bot_weapon_of(name: &str, label: &str) -> BotWeapon {
    BotWeapon::parse(name).unwrap_or_else(|| panic!("{label}: unknown bot weapon {name}"))
}

fn encode_odds(odds: &FightOdds) -> BVal {
    BVal::obj([
        ("edge", BVal::num(odds.edge)),
        ("score", BVal::num(odds.score)),
        ("known", BVal::flag(odds.known)),
        ("why", BVal::text(&odds.why)),
    ])
}

fn encode_num(value: f64) -> BVal {
    BVal::num(value)
}

/// Build the typed `SelfView` the source `Knowledge.odds` reads from the declared self fixture object.
fn self_view_from(args: &[BVal], label: &str) -> SelfView {
    let me = &args[0];
    let weapons = as_arr(me.get("weapons").unwrap_or(&BVal::Null), label);
    let slot = as_num(me.get("slot").unwrap_or(&BVal::Null), label);
    let faction = me
        .get("faction")
        .and_then(BVal::as_str)
        .filter(|name| !name.is_empty())
        .map(|name| faction_of(name, label));
    let weapon = |value: &BVal| match value {
        BVal::Null | BVal::Undefined => None,
        BVal::Str(name) => Some(bot_weapon_of(name, label)),
        _ => panic!("{label}: weapon slot shape"),
    };
    SelfView {
        id: as_str(me.get("id").unwrap_or(&BVal::Null), label).to_string(),
        faction,
        x: as_num(me.get("x").unwrap_or(&BVal::Null), label),
        y: as_num(me.get("y").unwrap_or(&BVal::Null), label),
        facing: as_num(me.get("facing").unwrap_or(&BVal::Null), label),
        status: as_str(me.get("status").unwrap_or(&BVal::Null), label).to_string(),
        hp: as_num(me.get("hp").unwrap_or(&BVal::Null), label),
        max_hp: as_num(me.get("maxHp").unwrap_or(&BVal::Null), label),
        effects: 0,
        weapons: [weapon(&weapons[0]), weapon(&weapons[1])],
        slot: (slot as u8).min(1),
        attack_target: None,
        owner_lock: None,
        ready_at: 0.,
    }
}

/// Build the typed `OpponentSnapshot` from the declared fighter fixture object.
fn opponent_from(args: &[BVal], label: &str) -> OpponentSnapshot {
    let them = &args[1];
    let faction = them
        .get("faction")
        .and_then(BVal::as_str)
        .filter(|name| !name.is_empty())
        .map(|name| faction_of(name, label));
    let weapon = |value: Option<&BVal>| match value {
        Some(BVal::Str(name)) => Some(bot_weapon_of(name, label)),
        Some(BVal::Null) | Some(BVal::Undefined) | None => None,
        _ => panic!("{label}: fighter weapon shape"),
    };
    OpponentSnapshot {
        id: as_str(them.get("id").unwrap_or(&BVal::Null), label).to_string(),
        faction,
        in_hand: weapon(them.get("inHand")),
        other_slot: weapon(them.get("otherSlot")),
        hp_frac: as_num(them.get("hpFrac").unwrap_or(&BVal::Null), label),
        bounty: as_num(them.get("bounty").unwrap_or(&BVal::Null), label) as u32,
        dist: as_num(them.get("dist").unwrap_or(&BVal::Null), label),
        tint: as_num(them.get("tint").unwrap_or(&BVal::Null), label),
    }
}

fn encode_call(knowledge: &Knowledge, name: &str, args: &[BVal], label: &str) -> BVal {
    match name {
        "mobShare" => {
            let me = faction_of(as_str(&args[0], label), label);
            let region = faction_of(as_str(&args[1], label), label);
            let elite = as_bool(&args[2], label);
            encode_num(knowledge.mob_share(me, region, elite))
        }
        "factionEdge" => {
            let a = faction_of(as_str(&args[0], label), label);
            let b = faction_of(as_str(&args[1], label), label);
            encode_num(f64::from(knowledge.faction_edge(a, b)))
        }
        "weaponEdge" => {
            let a = bot_weapon_of(as_str(&args[0], label), label);
            let b = bot_weapon_of(as_str(&args[1], label), label);
            encode_num(f64::from(knowledge.weapon_edge(a, b)))
        }
        "odds" => {
            let me = self_view_from(args, label);
            let them = opponent_from(args, label);
            encode_odds(&knowledge.odds(&me, &them))
        }
        other => panic!("{label}: unknown knowledge query {other}"),
    }
}

fn check_all(label: &str, expected: &BVal, actual: &BVal) {
    let mut failures = Vec::new();
    super::trace::compare(label, expected, actual, &mut failures);
    assert!(
        failures.is_empty(),
        "{label}: first source mismatch: {}",
        failures.first().cloned().unwrap_or_default()
    );
}

#[test]
fn knowledge_constructor_dependencies_replay_32_2240_111() {
    let source = source_input::load().expect("checked frozen source intake");
    assert_eq!(
        source.knowledge.len(),
        32,
        "32 separately labelled Knowledge dependencies"
    );
    let case_ids: Vec<&str> = source.cases.iter().map(|case| case.id.as_str()).collect();
    let mut draws_total = 0usize;
    let mut calls_total = 0usize;

    for dependency in &source.knowledge {
        let label = format!("knowledge {} cfg {}", dependency.case, dependency.cfg);
        assert!(
            case_ids.contains(&dependency.case.as_str()),
            "{label}: case exists"
        );
        assert_eq!(
            super::config::derive(dependency.seed, 3),
            dependency.derived,
            "{label}: tag-3 derived seed"
        );
        assert_eq!(dependency.wiring.len(), 5, "{label}: source wiring witness");
        assert!(!dependency.derive_source.is_empty());
        assert!(!dependency.observability.is_empty());
        let tier: &'static TierParams = Box::leak(Box::new(dependency.tier));
        let mut rng = Rng::new(dependency.derived);
        let shadow = rng.clone();
        let knowledge = Knowledge::create(tier, &mut rng);
        // Recover the 70 constructor draws from the pure mulberry recurrence (the constructor takes `&mut Rng`).
        let mut probe = shadow;
        let mut draws = Vec::with_capacity(70);
        for _ in 0..70 {
            draws.push(probe.next_f64());
        }
        assert_eq!(probe, rng, "{label}: constructor consumed exactly 70 draws");
        assert_eq!(
            draws, dependency.draws,
            "{label}: constructor draw values differ from the frozen source"
        );
        draws_total += draws.len();

        assert!(
            dependency.queries.len() > 100,
            "{label}: declared query surface"
        );
        for (index, query) in dependency.queries.iter().enumerate() {
            let args = as_arr(&query.args, &label);
            let actual = encode_call(
                &knowledge,
                &query.name,
                args,
                &format!("{label} query {index} {}", query.name),
            );
            check_all(
                &format!("{label} query {index} {}", query.name),
                &query.result,
                &actual,
            );
        }

        // Bind the 111 frozen Brain knowledge callback rows to the actual constructor instance; the callback rows are
        // located in the frozen operation traces by (operation, sequence) exactly as runner.mts knowledgeDependency does.
        let case = source
            .cases
            .iter()
            .find(|case| case.id == dependency.case)
            .expect("case");
        let brain_handle = case
            .initial_trace
            .as_arr()
            .expect("initial trace")
            .iter()
            .find_map(|row| {
                if row.get("kind").and_then(BVal::as_str) == Some("caller")
                    && row.get("name").and_then(BVal::as_str) == Some("createBrain")
                    && row.get("cfg").and_then(BVal::as_str) == Some(dependency.cfg.as_str())
                {
                    row.get("handle").and_then(BVal::as_str)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| panic!("{label}: setup createBrain row for cfg"));
        let mut located = 0usize;
        for (operation_index, operation) in case.operations.iter().enumerate() {
            for row in operation
                .expected
                .trace
                .as_arr()
                .expect("operation trace array")
            {
                if row.get("kind").and_then(BVal::as_str) != Some("callback") {
                    continue;
                }
                let name = row.get("name").and_then(BVal::as_str).unwrap_or("");
                let Some(short) = name.strip_prefix("knowledge.") else {
                    continue;
                };
                if !["mobShare", "factionEdge", "weaponEdge", "odds"].contains(&short) {
                    continue;
                }
                if row.get("actor").and_then(BVal::as_str) != Some(brain_handle) {
                    continue;
                }
                let sequence = row
                    .get("sequence")
                    .and_then(BVal::as_num)
                    .expect("callback sequence") as u64;
                let matched = dependency.actual_calls.iter().find(|call| {
                    call.operation == operation_index as u64
                        && call.sequence == sequence
                        && call.name == short
                });
                let Some(call) = matched else {
                    continue;
                };
                located += 1;
                assert_eq!(
                    row.get("args"),
                    Some(&call.args),
                    "{label}: frozen Brain call args at op {operation_index} seq {sequence}"
                );
                assert_eq!(
                    row.get("result"),
                    Some(&call.result),
                    "{label}: frozen Brain call result at op {operation_index} seq {sequence}"
                );
                let args = as_arr(&call.args, &label);
                let actual = encode_call(
                    &knowledge,
                    &call.name,
                    args,
                    &format!(
                        "{label} actual_call op {operation_index} seq {sequence} {}",
                        call.name
                    ),
                );
                check_all(
                    &format!(
                        "{label} actual_call op {operation_index} seq {sequence} {}",
                        call.name
                    ),
                    &call.result,
                    &actual,
                );
            }
        }
        assert_eq!(
            located,
            dependency.actual_calls.len(),
            "{label}: every declared Brain knowledge call was located in the frozen trace"
        );
        calls_total += located;
    }
    assert_eq!(draws_total, 2240, "32 constructors x 70 draws");
    assert_eq!(calls_total, 111, "111 actual Brain Knowledge call bindings");
    let _ = WeaponId::Sword;
}
