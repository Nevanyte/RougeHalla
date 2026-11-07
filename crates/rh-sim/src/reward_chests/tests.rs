use super::*;
use crate::{FactionId, Placement, Secrets, Sim, SimConfig, WeaponId};
use serde_json::{json, Value};
fn sim(faction: FactionId) -> Sim {
    sim_mode(faction, false)
}
fn sim_mode(faction: FactionId, signatures: bool) -> Sim {
    let rows = (0..24)
        .map(|y| {
            (0..32)
                .map(|x| {
                    if x == 0 || y == 0 || x == 31 || y == 23 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    let arena = crate::Arena {
        map: crate::map::TileMap::from_rows(&rows).unwrap(),
        spawns: (0..8)
            .map(|i| Vec2::new(200. + f64::from(i) * 60., 320.))
            .collect(),
    };
    let ps = [
        Placement {
            profile: "ALICE".into(),
            faction,
            bot: false,
            at: Vec2::new(200., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "BOB".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(260., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut s = Sim::reset_active(
        SimConfig {
            pvp_rules: false,
            faction_mode: if signatures {
                crate::FactionMode::EngagementHolyPlagueFireFrostSentenced
            } else {
                crate::FactionMode::Off
            },
            ..Default::default()
        },
        arena,
        Secrets {
            reward_salt: [1, 2, 3, 4],
            ..Secrets::from_seed(12)
        },
        &ps,
    );
    s.w.players[0].vitals.immune_until = 0.;
    s.w.players[1].vitals.immune_until = 0.;
    s
}
fn fixture() -> Value {
    let bytes = include_bytes!("../../../../parity/cards/cards.json");
    let j = admit_fixture(bytes).expect("bound source fixture");
    assert_eq!(j["format"], "rh-cards-mvp/1");
    let rows = j["cases"].as_array().unwrap();
    assert_eq!(rows.len(), 20);
    let mut names = std::collections::BTreeSet::new();
    for r in rows {
        assert!(names.insert(r["name"].as_str().unwrap()));
    }
    j
}
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |a, b| {
        (a ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}
const FIXTURE_FNV: u64 = 15717370982595805037;
fn faction(v: &Value) -> FactionId {
    match v.as_str().unwrap() {
        "fire" => FactionId::Fire,
        "frost" => FactionId::Frost,
        "holy" => FactionId::Holy,
        "plague" => FactionId::Plague,
        "sentenced" => FactionId::Sentenced,
        _ => panic!("unknown faction"),
    }
}
fn weapon(v: &Value) -> WeaponId {
    match v.as_str().unwrap() {
        "sword" => WeaponId::Sword,
        "bow" => WeaponId::Bow,
        "wand" => WeaponId::Wand,
        "shield" => WeaponId::Shield,
        "axe" => WeaponId::Axe,
        "fists" => WeaponId::Fists,
        _ => panic!("unknown weapon"),
    }
}
fn close(a: f64, b: &Value) {
    let b = b.as_f64().unwrap();
    assert!(
        (a - b).abs() <= 1e-11 * a.abs().max(b.abs()).max(1.),
        "{a:?} != {b:?}"
    );
}
fn stage(s: &Sim, j: &Value) {
    let p = &s.w.players[0];
    close(p.vitals.hp, &j["hp"]);
    close(p.vitals.max_hp, &j["maxHp"]);
    let builds = p
        .build
        .cards()
        .map(|id| json!([id.as_str(), 1]))
        .collect::<Vec<_>>();
    assert_eq!(builds, j["build"].as_array().unwrap().clone());
    let boosts = BoostId::ALL
        .into_iter()
        .filter_map(|id| {
            let n = p.build.boosts[id.index()];
            (n > 0).then(|| json!([&id.as_str()[6..], n]))
        })
        .collect::<Vec<_>>();
    assert_eq!(boosts, j["boosts"].as_array().unwrap().clone());
    let farms = crate::modifiers::farm::DEFINITION
        .rows
        .iter()
        .filter_map(|r| {
            let n = p.farm.count(r.mob);
            (n > 0).then(|| json!([r.mob.as_str(), n]))
        })
        .collect::<Vec<_>>();
    assert_eq!(json!(farms), j["farmCounts"]);
    let encoded = serde_json::to_value(&p.modifiers).unwrap();
    let names = [
        "maxHp",
        "attackSpeed",
        "moveSpeed",
        "damage",
        "windup",
        "lifesteal",
        "markRate",
        "healTaken",
        "damageTaken",
        "cooldown",
        "executeBand",
        "slowResist",
        "lifestealMult",
        "lifestealDot",
        "critChance",
        "healBarrier",
        "armor",
        "shield",
        "ad",
        "ap",
    ];
    for (i, key) in names.into_iter().enumerate() {
        close(encoded["sums"][i].as_f64().unwrap(), &j["sums"][key]);
        close(encoded["farm"][i].as_f64().unwrap(), &j["farm"][key]);
    }
    for (v, key) in p.modifiers.mirrors().source_values().into_iter().zip([
        "asMult",
        "windupMult",
        "speedMult",
        "armorBonus",
        "shieldBonus",
        "adBonus",
        "apBonus",
    ]) {
        close(v, &j["mirrors"][key]);
    }
    close(p.modifiers.dot_mult(), &j["dot"]);
    close(p.modifiers.linger_mult(), &j["linger"]);
    for expected in j["packets"].as_array().unwrap() {
        let id: WeaponId = weapon(&expected["id"]);
        let actual = crate::modifiers::packet(p, id);
        for (v, key) in [
            (actual.raw, "raw"),
            (actual.phys, "phys"),
            (actual.magic, "magic"),
            (actual.true_, "true"),
        ] {
            close(v, &expected[key]);
        }
    }
}
#[test]
fn source_grants_and_all_boost_consumers() {
    let j = fixture();
    for row in j["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["name"].as_str().unwrap().starts_with("fold-"))
    {
        let faction = faction(&row["input"]["faction"]);
        let mut s = sim(faction);
        s.w.players[0].vitals.hp = row["input"]["damagedHp"].as_f64().unwrap();
        let expected = row["result"]["stages"].as_array().unwrap();
        let mut n = 0;
        stage(&s, &expected[n]);
        n += 1;
        for card in row["input"]["cards"].as_array().unwrap() {
            let id = serde_json::from_value(card.clone()).unwrap();
            assert!(crate::cards::grant(&s.k, &mut s.w, PlayerId(1), id));
            stage(&s, &expected[n]);
            n += 1;
        }
        for boost in row["input"]["boosts"].as_array().unwrap() {
            let id = BoostId::ALL
                .into_iter()
                .find(|id| &id.as_str()[6..] == boost["id"].as_str().unwrap())
                .unwrap();
            for _ in 0..boost["count"].as_u64().unwrap() {
                assert!(grant_boost(&s.k, &mut s.w, PlayerId(1), id));
                stage(&s, &expected[n]);
                n += 1;
            }
        }
        assert_eq!(n, expected.len());
        let restored: Sim = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert_eq!(s.state_hash(), restored.state_hash());
    }
}
#[test]
fn source_restricted_pool_and_rng_continuation() {
    let j = fixture();
    for row in j["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["name"].as_str().unwrap().starts_with("options-"))
    {
        let mut s = sim(FactionId::Fire);
        for id in row["input"]["held"].as_array().unwrap() {
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(1),
                serde_json::from_value(id.clone()).unwrap()
            ));
        }
        drop_augment(
            &mut s.w,
            Vec2::new(200., 320.),
            None,
            faction(&row["input"]["zone"]),
            row["input"]["elite"].as_bool().unwrap(),
            &[PlayerId(1)],
        );
        let mut rng = crate::private_rng::Sfc32::from_words([1, 2, 3, 4]);
        for _ in 0..row["result"]["draws"].as_u64().unwrap() {
            rng.next_f64();
        }
        assert_eq!(rng.words(), s.w.reward_rng.words());
        let actual = s.w.reward_chests[0]
            .options
            .iter()
            .flatten()
            .map(|o| match o {
                OptionId::Card(c) => c.as_str(),
                _ => panic!(),
            })
            .collect::<Vec<_>>();
        assert_eq!(json!(actual), row["result"]["options"]);
        for expected in row["result"]["next"].as_array().unwrap() {
            assert_eq!(s.w.reward_rng.next_f64(), expected.as_f64().unwrap());
        }
    }
}
#[test]
fn real_choose_intake_restore_and_staged_handle() {
    let mut s = sim(FactionId::Fire);
    let at = s.w.players[0].pos();
    let id = drop_stat(&mut s.w, at);
    let mut observer = RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    let prepared = observer.prepare_into(&s, &mut rows, &mut build).unwrap();
    assert!(prepared.changed());
    let handle = rows[0].handle;
    drop(prepared);
    let absent = observer.resolve(&s, handle, 0).unwrap();
    s.submit(PlayerId(1), absent).unwrap();
    let ev = s.step();
    assert!(ev.iter().any(|e| matches!(
        e,
        Event::ChestRefused {
            reason: Refusal::Gone,
            ..
        }
    )));
    observer
        .prepare_into(&s, &mut rows, &mut build)
        .unwrap()
        .commit();
    let handle = rows[0].handle;
    s.step();
    let command = observer.resolve(&s, handle, 0).unwrap();
    s.submit(PlayerId(1), command).unwrap();
    s.step();
    assert_eq!(s.w.reward_chests[0].taken[0], Some(PlayerId(1)));
    assert_eq!(s.w.players[0].build.boosts.iter().sum::<u8>(), 1);
    let mut restored: Sim = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
    for _ in 0..5 {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
    assert_eq!(s.w.reward_chests[0].id, id);
    observer.reconnect();
    let cmd = observer.resolve(&s, handle, 1).unwrap();
    assert!(
        cmd == crate::validate(crate::RawCommand::Choose {
            chest_id: None,
            pick: 1
        })
        .unwrap()
    );
}

#[test]
fn source_real_block_and_faction_dot_benefits() {
    let j = fixture();
    for row in j["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| ["block", "fire-dot", "plague-dot"].contains(&r["name"].as_str().unwrap()))
    {
        let block = row["name"] == "block";
        let mut s = sim_mode(faction(&row["input"]["faction"]), !block);
        s.w.players[0].vitals.hp = 400.;
        s.w.players[0].weapon.weapon0 = Some(WeaponId::Sword);
        s.w.players[1].weapon.weapon0 = block.then_some(WeaponId::Shield);
        s.w.players[1].body.x = 256.;
        for id in row["input"]["cards"].as_array().unwrap() {
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(if block { 2 } else { 1 }),
                serde_json::from_value(id.clone()).unwrap()
            ));
        }
        s.submit(
            PlayerId(2),
            crate::validate(crate::RawCommand::Aim {
                a: std::f64::consts::PI,
            })
            .unwrap(),
        )
        .unwrap();
        s.submit(
            PlayerId(1),
            crate::validate(crate::RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        for expected in row["result"]["states"].as_array().unwrap() {
            let events = s.step();
            assert_eq!(s.tick(), expected["tick"].as_u64().unwrap() as u32);
            for (i, p) in s.w.players.iter().enumerate() {
                close(p.vitals.hp, &expected["hp"][i]);
                let actual=p.statuses.instances.iter().map(|st|json!({"kind":st.kind,"tag":st.tag.as_ref().map(|t|t.as_str()),"value":st.value,"startedAt":st.started_at,"until":st.until,"source":match st.source.id.unwrap().0{1=>"alice",2=>"bob",_=>panic!()}})).collect::<Vec<_>>();
                equal(&json!(actual), &expected["statuses"][i]);
            }
            assert_eq!(
                events
                    .iter()
                    .filter(|e| matches!(e, Event::Block { .. }))
                    .count(),
                expected["blocks"].as_u64().unwrap() as usize
            );
            let heals = events
                .iter()
                .filter_map(|e| {
                    if let Event::Heal { id, amount } = e {
                        Some((*id, *amount))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            let exp = expected["heals"].as_array().unwrap();
            assert_eq!(heals.len(), exp.len());
            for ((id, amount), e) in heals.iter().zip(exp) {
                assert_eq!(if id.0 == 1 { "alice" } else { "bob" }, e["id"]);
                close(*amount, &e["amount"]);
            }
        }
    }
}

#[test]
fn source_normal_farm_rows_grants_and_restore() {
    let j = fixture();
    let row = j["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == "normal-farm-grants")
        .unwrap();
    let mut s = sim(FactionId::Fire);
    s.w.players[0].vitals.hp = 100.;
    let stages = row["result"]["stages"].as_array().unwrap();
    stage(&s, &stages[0]);
    let actual = crate::modifiers::farm::DEFINITION
        .rows
        .iter()
        .map(|r| {
            let (k, stat) = match r.stat {
                crate::modifiers::farm::RewardStat::Stat(v) => ("stat", format!("{v:?}")),
                crate::modifiers::farm::RewardStat::Flat(v) => ("flat", format!("{v:?}")),
            };
            let stat = stat[..1].to_lowercase() + &stat[1..];
            json!({"id":r.mob.as_str(),"effect":{"k":k,"stat":stat,"v":r.value}})
        })
        .collect::<Vec<_>>();
    equal(&json!(actual), &row["result"]["table"]);
    for (i, id) in row["input"]["types"].as_array().unwrap().iter().enumerate() {
        let id = crate::mob_catalog::MobTypeId::parse(id.as_str().unwrap()).unwrap();
        let n = row["input"]["amount"].as_u64().unwrap();
        assert_eq!(
            crate::modifiers::grant_mob_stat(&s.k, &mut s.w, PlayerId(1), id, n),
            n
        );
        stage(&s, &stages[i + 1]);
    }
    let restored: Sim = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
    assert_eq!(s.state_hash(), restored.state_hash());
    let before = s.state_hash();
    assert_eq!(
        crate::modifiers::grant_mob_stat(
            &s.k,
            &mut s.w,
            PlayerId(1),
            crate::mob_catalog::MobTypeId::AshDrake,
            3
        ),
        0
    );
    assert_eq!(s.state_hash(), before);
    assert_eq!(
        crate::modifiers::grant_mob_stat(
            &s.k,
            &mut s.w,
            PlayerId(1),
            crate::mob_catalog::MobTypeId::EmberImp,
            crate::modifiers::farm::DEFINITION.max_count
        ),
        0
    );
    assert_eq!(s.state_hash(), before);
}
#[test]
fn private_offer_identity_and_malformed_state_boundaries() {
    let mut a = sim(FactionId::Fire);
    let id = drop_stat(&mut a.w, Vec2::new(200., 320.));
    let mut b = a.clone();
    b.w.entity_counter += 7;
    b.w.reward_chests[0].id += 7;
    let mut oa = RewardChestObserver::new(PlayerId(1));
    let mut ob = RewardChestObserver::new(PlayerId(1));
    let (mut va, mut vb) = (Vec::new(), Vec::new());
    let (mut ba, mut bb) = (None, None);
    oa.prepare_into(&a, &mut va, &mut ba).unwrap().commit();
    ob.prepare_into(&b, &mut vb, &mut bb).unwrap().commit();
    assert_eq!(va, vb);
    assert_eq!(ba, bb);
    let before = a.state_hash();
    let checkpoint = serde_json::to_value(&a).unwrap();
    for (path, value) in [
        ("/world/reward_chests/0/id", json!(0)),
        ("/world/reward_chests/0/pickers", json!([99])),
        ("/world/reward_chests/0/taken/0", json!(1)),
        ("/world/players/0/build/boosts/0", json!(4)),
        ("/world/players/0/core/modifiers/sums/0", json!(123.)),
        ("/world/players/0/farm/counts/0", json!(9007199254740992u64)),
    ] {
        let mut bad = checkpoint.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(serde_json::from_value::<Sim>(bad).is_err(), "{path}");
    }
    assert_eq!(before, a.state_hash());
    assert!(crate::validate(crate::RawCommand::Choose {
        chest_id: Some(id),
        pick: 3
    })
    .is_err());
    assert!(RewardChestHandle::from_wire(0).is_none());
    let mut raw = include_bytes!("../../../../parity/cards/cards.json").to_vec();
    raw.extend_from_slice(b" ");
    assert_ne!(fnv(&raw), FIXTURE_FNV); // byte admission rejects hidden duplicate/unknown edits before interpretation.
}

fn equal(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(a), Value::Number(_)) => close(a.as_f64().unwrap(), b),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                equal(a, b)
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
            for (k, a) in a {
                equal(a, &b[k])
            }
        }
        _ => assert_eq!(a, b),
    }
}

fn admit_fixture(bytes: &[u8]) -> Result<Value, &'static str> {
    if fnv(bytes) != FIXTURE_FNV {
        return Err("fixture bytes/provenance differ");
    }
    serde_json::from_slice(bytes).map_err(|_| "invalid source fixture")
}
#[test]
fn source_fixture_changes_refuse_before_replay() {
    let raw = include_str!("../../../../parity/cards/cards.json");
    for changed in [
        raw.replacen("\"format\":", "\"unknown\":", 1),
        raw.replacen(
            "\"format\":\"rh-cards-mvp/1\"",
            "\"format\":\"rh-cards-mvp/1\",\"format\":\"rh-cards-mvp/1\"",
            1,
        ),
        raw.replacen("\"count\":3", "\"count\":4294967299", 1),
    ] {
        assert_ne!(changed, raw);
        assert!(admit_fixture(changed.as_bytes()).is_err())
    }
}

#[test]
fn the_refusal_sequence_matches_the_source_toast_tape() {
    let mut s = sim(FactionId::Holy);
    let p0 = s.players()[0].id;
    let p1 = s.players()[1].id;
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        p0,
        crate::cards::CardId::Gambler
    ));
    let at = s.players()[0].pos();
    let id = s.w.next_entity_id();
    s.w.reward_chests.push(Chest {
        id,
        at,
        expires_at: s.w.server_time + DEFINITION.lifetime_ms,
        held_until_tick: s.w.tick + DEFINITION.birth_hold_ticks,
        options: [
            Some(OptionId::Card(crate::cards::CardId::Gambler)),
            Some(OptionId::Card(crate::cards::CardId::Overkill)),
            None,
        ],
        taken: [None; 3],
        pickers: Vec::new(),
        camp: None,
        owner: None,
    });
    let mut ev = Vec::new();
    // Born this tick: "Chest gone".
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 0),
        Err(Refusal::Gone)
    );
    s.step();
    // Near, but the option is a card the picker already holds: "Already yours".
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 0),
        Err(Refusal::Owned)
    );
    // Out of range: "Too far away".
    s.w.players[0].core.body.x = 1000.;
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 0),
        Err(Refusal::Far)
    );
    s.w.players[0].core.body.x = at.x;
    // Stunned: "Can't do that now".
    let stun = crate::status_runtime::StatusApply {
        kind: crate::status_runtime::StatusKind::Stun,
        source: crate::status_runtime::StatusSource {
            id: None,
            name: "stun".into(),
            owner_id: None,
        },
        ms: 100.,
        ability: None,
        tag: None,
        value: None,
        add: None,
        data: None,
    };
    let stats = crate::status_runtime::stats::Inputs::default();
    crate::systems::status::operations::apply_with(&s.k, &mut s.w, &mut ev, p0, stun, true, stats);
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 0),
        Err(Refusal::Busy)
    );
    // The stun lapses; pick 1: success.
    s.w.server_time += 200.;
    assert_eq!(choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 1), Ok(()));
    // Another player on the taken option: "Already taken".
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p1, Some(id), 1),
        Err(Refusal::Taken)
    );
    // Another player on the untaken option: success.
    assert_eq!(choose(&s.k, &mut s.w, &mut ev, p1, Some(id), 0), Ok(()));
    // Expired: "Chest gone".
    s.w.server_time += DEFINITION.lifetime_ms;
    assert_eq!(
        choose(&s.k, &mut s.w, &mut ev, p0, Some(id), 1),
        Err(Refusal::Gone)
    );
}
