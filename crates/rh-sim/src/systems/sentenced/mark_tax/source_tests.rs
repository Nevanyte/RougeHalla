//! Actual released Training World consumer. Constructor/startRaid are explicit producer setup; every subsequent input
//! is validated/submitted and every frame advances through the ordinary50ms kernel. No outcomes or clocks are installed.
use super::*;
use crate::{
    events::Event,
    mob_runtime::{ActorOrigin, BrainMode},
    validate, RawCommand, Secrets, Sim, SimConfig,
};
use serde_json::{json, Value};
use std::cell::RefCell;
thread_local! {
    static PHASES: RefCell<Option<Vec<(Value,crate::rng::Mulberry32)>>> = const { RefCell::new(None) };
    // Inline native Signature exists at birth; the source creates its equivalent lazily in afterWeapons.
    // This records actual native pass visitation, not a copied source snapshot or gameplay state.
    static PUBLIC_MARKS: RefCell<std::collections::BTreeMap<PlayerId,(u8,String)>> = const { RefCell::new(std::collections::BTreeMap::new()) };
    static SEEN_SIGNATURE: RefCell<std::collections::BTreeSet<PlayerId>> = const { RefCell::new(std::collections::BTreeSet::new()) };
}
fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../../parity/mark-tax-uncapped/source.json"
    ))
    .unwrap()
}
fn label(w: &World, id: PlayerId) -> String {
    match w.actor_origin(id).expect("real actor provenance") {
        ActorOrigin::Player { join_ordinal } => format!("p{join_ordinal}"),
        ActorOrigin::Mob { birth_serial, .. }
        | ActorOrigin::Practice { birth_serial, .. }
        | ActorOrigin::Dummy { birth_serial, .. }
        | ActorOrigin::QuestGiver { birth_serial, .. } => {
            let mut n = *birth_serial;
            let mut bytes = [0; 7];
            let mut at = bytes.len();
            loop {
                at -= 1;
                let d = (n % 36) as u8;
                bytes[at] = if d < 10 { b'0' + d } else { b'a' + d - 10 };
                n /= 36;
                if n == 0 {
                    break;
                }
            }
            format!("mob{}", std::str::from_utf8(&bytes[at..]).unwrap())
        }
        ActorOrigin::Zombie { owner } => format!("zombie{}", owner.0),
    }
}
fn status(s: crate::Status) -> &'static str {
    match s {
        crate::Status::Lobby => "lobby",
        crate::Status::Alive => "alive",
        crate::Status::Dead => "dead",
        crate::Status::Mia => "mia",
    }
}
fn item(w: Option<crate::WeaponId>) -> &'static str {
    w.map_or("", crate::WeaponId::as_str)
}
fn mark_by(w: &World, id: PlayerId, tier: u8) -> String {
    super::super::public_mark_by(w, id, tier, |_| true)
        .map(|id| label(w, id))
        .unwrap_or_default()
}
fn common(w: &World, c: &FighterCore, state: crate::Status) -> Value {
    let (tier, by) =
        PUBLIC_MARKS.with(|marks| marks.borrow().get(&c.id).cloned().unwrap_or_default());
    json!({"x":c.body.x,"y":c.body.y,"facing":c.body.facing,"hp":c.vitals.hp,"maxHp":c.vitals.max_hp,
        "status":status(state),"faction":c.faction_id().unwrap().as_str(),"weapon0":item(c.weapon.weapon0),
        "weapon1":item(c.weapon.weapon1),"slot":c.weapon.slot,"drawStartedAt":c.weapon.draw_started_at,
        "readyAt":c.weapon.ready_at,"sig":c.signature.bits,"brand":tier*25,"effects":c.statuses.effects,
        "displaceSeq":c.motion.displace_seq,"markTier":tier,"markBy":by,"markTax":public_percent(w,c.id)})
}
fn player(w: &World) -> Value {
    let p = &w.players[0];
    let m = p.modifiers.owner_combat_mirrors();
    let wire = serde_json::to_value(&p.modifiers).unwrap();
    let a = wire["wire"].as_array().unwrap();
    let mut out = common(w, &p.core, p.status);
    let farm: serde_json::Map<String, Value> = crate::modifiers::farm::DEFINITION
        .rows
        .iter()
        .filter_map(|r| {
            let n = p.farm.count(r.mob);
            (n > 0).then(|| (r.mob.as_str().into(), json!(n)))
        })
        .collect();
    let boost_keys = [
        "ad",
        "ap",
        "armor",
        "shield",
        "maxHp",
        "attackSpeed",
        "moveSpeed",
        "lifesteal",
    ];
    let boosts: serde_json::Map<String, Value> = boost_keys
        .into_iter()
        .zip(p.build.boosts())
        .filter(|(_, n)| *n > 0)
        .map(|(k, n)| (k.into(), json!(n)))
        .collect();
    let kill_stats: serde_json::Map<String, Value> = crate::kill_augments::KillStatKey::ALL
        .into_iter()
        .filter_map(|k| {
            let v = p.kill_stats.get(k);
            (v != 0.).then(|| (k.as_str().into(), json!(v)))
        })
        .collect();
    let bush = serde_json::to_value(p.bush).unwrap();
    let extra = json!({"name":p.seat.name,"bot":p.seat.bot,"moveSeq":p.motion.move_seq,
    "attackTarget":p.weapon.targeting.target.map(|id|label(w,id)).unwrap_or_default(),
    "kills":p.credit.kills,"gv":p.credit.gv,"bounty":p.credit.bounty,"mobKills":p.credit.mob_kills,
    "immuneUntil":p.vitals.immune_until,"asMult":m[0],"windupMult":m[1],"speedMult":m[2],
    "armorBonus":a[3],"shieldBonus":a[4],"adBonus":a[5],"apBonus":a[6],
    "barrier":p.vitals.barrier,"planReady":p.plan_ready,"wishReadyAt":p.stocks.wish_ready_at,"qReadyAt":p.stocks.q_ready_at,"eReadyAt":p.stocks.e_ready_at,"sentence":p.credit.sentence,"mobStats":farm,
    "frostMoveMult":p.signature.frost_move_mult*1000.,"huntTarget":p.hunt_target().map(|id|label(w,id)).unwrap_or_default(),
    "huntStacks":p.hunt_stacks,"campClears":p.camps_cleared,"frostEliteGuard":p.frost_guard.active,
    });
    out.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let extra = json!({"corpseStacks":p.farm.corpse_stacks(),"potionLarge":p.potion_large,"potionSmall":p.potion_small,
        "healingUntil":p.healing_until,"potionsHealing":p.potions_healing,"speedBoostUntil":p.speed_boost_until,
        "roamCharge":if p.faction()==crate::FactionId::Fire {p.roam.last_combat_at.map_or(0.,|t|crate::systems::fire_roam::charge(w.server_time-t))} else {0.},"roamReady":p.roam.ready,
        "extra":{"wishFullAt":p.stocks.wish_full_at.unwrap_or(0.),"chestBoosts":boosts,"killStats":kill_stats,"bushRevealUntil":bush["until"]},
        "tradeUsed":p.trade_used,"tradeOffers":p.trade_offers,"tradeStats":p.trade_stats.iter().map(|(k,v)|(k.as_str().to_string(),json!(v))).collect::<serde_json::Map<String,Value>>(),"build":p.build.cards().map(|id|(id.as_str().to_string(),json!(p.build.count(id)))).collect::<serde_json::Map<String,Value>>(),"plagueZombieId":w.mobs.iter().find(|m|m.owner==Some(p.id)&&m.zombie.is_some()).map(|m|label(w,m.core.id)).unwrap_or_default()});
    out.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    out
}
fn snapshot(w: &World) -> Value {
    let p = &w.players[0];
    let rows = p.modifiers.own_as_rows();
    let own_as = rows.uncapped(efficiency(w, &p.core));
    let f = factor(w, &p.core, rows);
    let tm = crate::content::player_timings(
        p.active_weapon(),
        crate::content::attack_interval(
            &crate::content::paced(p.faction()),
            p.active_weapon(),
            p.modifiers.mirrors().as_mult,
        ),
    );
    let sources:Vec<_>=w.mobs.iter().filter(|m|m.mob_type==Some(crate::mob_catalog::MobTypeId::Bailiff)).map(|m| {
        let mut public=common(w,&m.core,m.status);public.as_object_mut().unwrap().extend(json!({"kind":"mob","name":crate::mob_catalog::mob_type_by_id("bailiff").unwrap().name,"type":"bailiff","camp":m.camp,"ownerId":m.owner.map(|id|label(w,id)).unwrap_or_default()}).as_object().unwrap().clone());
        let mark=&m.core.signature.mark; let brain=m.brain.as_ref().unwrap();
        json!({"id":label(w,m.core.id),"public":public,"brain":{"mode":match brain.mode {BrainMode::Idle=>"idle",BrainMode::Fight=>"fight",BrainMode::Return=>"return"},"target":brain.target.map(|id|label(w,id))},
        "mark":if SEEN_SIGNATURE.with(|seen|seen.borrow().contains(&m.core.id)) {json!({"target":m.core.signature.target.map(|id|label(w,id)),"group":mark.group.map(|g|match g {crate::fighter::MarkGroup::Fighter(id)=>format!("fighter:{}",label(w,id)),crate::fighter::MarkGroup::Camp(c)=>format!("camp:{c}")}),"originalSize":mark.group_size,"hits":mark.hits,"progress":mark.progress,"swaps":mark.swaps,"tier":mark.tier})} else {Value::Null},
        "tierOnSubject":super::super::mark_tier_on(w,m.core.id,p.id),"distanceToSubject":crate::math::hypot(p.body.x-m.core.body.x,p.body.y-m.core.body.y)})
    }).collect();
    json!({"tick":w.tick,"time":w.server_time,"phase":match w.phase {crate::Phase::Lobby=>"lobby",crate::Phase::Planning=>"planning",crate::Phase::Active=>"active",crate::Phase::Ended=>"ended"},
        "player":player(w),"sources":sources,"taxedOwner":w.factions.taxed.iter().find(|r|r.victim==p.id).map(|r|label(w,r.by)),
        "actualModSource":if f<1. {json!({"asMult":f})} else {Value::Null},"uncappedOwnRowAS":own_as,
        "rawSheetRate":crate::content::faction(p.faction()).rate*own_as,
        "sheetRateTimesDecodedMirror":crate::content::faction(p.faction()).rate*p.modifiers.mirrors().as_mult,
        "actualCurrentWeaponTimings":{"interval":tm.interval,"windup":tm.windup,"root":tm.root,"ranged":tm.ranged}})
}
pub(super) fn record(w: &World, phase: &'static str) {
    PHASES.with(|rows| {
        let mut rows = rows.borrow_mut();
        if let Some(rows) = rows.as_mut() {
            if phase == "after-factions-after-weapons" || phase == "after-signature-damage" {
                SEEN_SIGNATURE.with(|seen| {
                    let mut seen = seen.borrow_mut();
                    if phase == "after-signature-damage" {
                        seen.retain(|id| w.fighter_idx(*id).is_some_and(|ix| w.standing(ix)));
                    }
                    seen.extend(
                        (0..w.fighter_count())
                            .map(FighterIx::of_slot)
                            .filter(|ix| w.standing(*ix))
                            .map(|ix| w.core(ix).id),
                    );
                });
            }
            if phase == "after-factions-after-damage" {
                PUBLIC_MARKS.with(|marks| {
                    let mut marks = marks.borrow_mut();
                    marks.clear();
                    for slot in 0..w.fighter_count() {
                        let id = w.core(FighterIx::of_slot(slot)).id;
                        let tier = super::super::public_mark_tier(w, id);
                        marks.insert(id, (tier, mark_by(w, id, tier)));
                    }
                });
            }
            rows.push((
                json!({"phase":phase,"value":snapshot(w)}),
                w.spawn_rng.clone(),
            ));
        }
    });
}
/// Only source cosmetic look (not native gameplay state) and the separately owned unported walk-hint presentation
/// fields lack native representations. Keep original corpus bytes/values intact and name these exclusions explicitly.
/// mainDrawCount is checked against actual native stream state separately, at every phase and completed frame.
fn project_source(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(value) = v.get_mut("value") {
        *value = project_source(value);
    }
    if let Some(obj) = v.as_object_mut() {
        obj.remove("mainDrawCount");
    }
    if let Some(p) = v.get_mut("player").and_then(Value::as_object_mut) {
        p.remove("look");
        if let Some(e) = p.get_mut("extra").and_then(Value::as_object_mut) {
            e.remove("walkDir");
            e.remove("walkTicks");
        }
    }
    v
}
fn equal(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            let discrete = matches!(
                path.rsplit('/').next().unwrap(),
                "tick"
                    | "sig"
                    | "brand"
                    | "markTier"
                    | "markTax"
                    | "hits"
                    | "swaps"
                    | "tier"
                    | "originalSize"
                    | "camp"
                    | "effects"
                    | "slot"
                    | "moveSeq"
                    | "displaceSeq"
                    | "huntStacks"
                    | "campClears"
                    | "corpseStacks"
                    | "potionSmall"
                    | "potionLarge"
                    | "potionsHealing"
                    | "kills"
                    | "gv"
                    | "bounty"
                    | "mobKills"
            );
            if discrete {
                assert_eq!(a.as_u64(), b.as_u64(), "{path}");
                assert!(a.as_u64().is_some(), "{path} integer");
            } else {
                assert!(
                    (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() <= 1e-6,
                    "{path}: {a} != {b}"
                );
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                equal(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path} complete keys"
            );
            for (k, v) in a {
                equal(
                    v,
                    b.get(k)
                        .unwrap_or_else(|| panic!("{path}/{k} source field")),
                    &format!("{path}/{k}"),
                );
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}
fn events(w: &World, events: &[Event]) -> Vec<Value> {
    events.iter().map(|e| match e {
        Event::RaidStarted=>json!({"type":"raidStarted"}),
        Event::Toast{to,text}=>json!({"type":"toast","to":to.map(|id|label(w,id)),"text":text}),
        Event::MarkNotice{recipient,notice}=>json!({"type":"toast","to":label(w,*recipient),"text":notice.message()}),
        Event::Windup{by,weapon,a,ms}=>json!({"type":"fx","fx":{"kind":"windup","by":label(w,*by),"weapon":weapon.as_str(),"a":a,"ms":ms}}),
        Event::Swing{by,weapon,x,y,a}=>json!({"type":"fx","fx":{"kind":"swing","by":label(w,*by),"weapon":weapon.as_str(),"x":x,"y":y,"a":a}}),
        Event::Hit{victim,by,amount,weapon,passive}=>{let mut fx=json!({"kind":"hit","id":label(w,*victim),"by":by.map(|id|label(w,id)),"amount":amount,"weapon":weapon.map(|w|w.as_str())});if *passive{fx["passive"]=json!(true);}json!({"type":"fx","fx":fx})},
        Event::SignatureHit{victim,by,sig,weapon,amount}=>json!({"type":"fx","fx":{"kind":"hit","id":label(w,*victim),"by":label(w,*by),"sig":sig.as_str(),"weapon":weapon.map(|w|w.as_str()),"amount":amount}}),
        _=>panic!("unexpected native event; do not thin actual tape: {e:?}"),
    }).collect()
}
fn construct_at(c: &Value, source_start: bool) -> Sim {
    SEEN_SIGNATURE.with(|seen| seen.borrow_mut().clear());
    PUBLIC_MARKS.with(|marks| marks.borrow_mut().clear());
    use crate::mapgen::{coliseum, map_hash, pipeline};
    assert_eq!(
        c["input"]["map"],
        json!({"seed":1,"attempt":0,"decor":false})
    );
    let map = pipeline::Pipeline::new(&coliseum::fixed_layout())
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .unwrap();
    let arena = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap(),
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let input = &c["input"]["config"];
    let mut config = SimConfig {
        training: true,
        dummies: true,
        quests: true,
        initial_loot: true,
        regen: true,
        consumables: true,
        mob_mode: crate::mob_runtime::MobMode::Pve,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        hazards: crate::terrain::Mode::All,
        abilities: crate::abilities::Mode::Full,
        min_players: input["minPlayers"].as_u64().unwrap() as usize,
        lobby_seconds: input["lobbySeconds"].as_f64().unwrap(),
        fill_seconds: input["fillSeconds"].as_f64().unwrap(),
        wish_lock_ms: input["wishLockSeconds"].as_f64().unwrap() * 1000.,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: input["firstPatienceSeconds"].as_f64(),
            patience_seconds: input["patienceSeconds"].as_f64().unwrap(),
            patience_min_seconds: input["patienceMinSeconds"].as_f64().unwrap(),
            sudden_death_seconds: input["suddenDeathSeconds"].as_f64().unwrap(),
            coliseum_schedule: Some(crate::ColiseumSchedule {
                first_seconds: 600.,
                second_seconds: 900.,
                repeat_seconds: 120.,
                min_gap_seconds: 30.,
            }),
        }),
        ..Default::default()
    };
    if !source_start {
        // Actual native Training profile has no Source arena timer/settlement. The source component witness above
        // deliberately retains its declared World config; these controls claim native lifecycle, not another capture.
        config.lifecycle = crate::ArenaMode::Off;
        config.lobby_seconds = 0.;
        config.regen = false;
    }
    let mut s = Sim::try_new(
        config,
        arena,
        Secrets {
            spawn_seed: 12,
            order_salt: 0,
            reward_salt: [1, 2, 3, 4],
        },
    )
    .unwrap();
    s.add_player("tax-subject", Some(crate::FactionId::Holy), false)
        .unwrap();
    // Same explicit actual startRaid producer at0 as the captured World; not reset_active's changed config/clock.
    if source_start {
        let mut events = Vec::new();
        crate::systems::lobby::start_raid(&s.k, &mut s.w, &mut s.s, &mut events, &[]);
        s.w.pending_events.extend(events);
    } else {
        // Native-only lifecycle proof: ordinary lobby expiry, no clock/outcome installation.
        while s.phase() != crate::Phase::Active {
            s.step();
        }
    }
    s
}
fn construct(c: &Value) -> Sim {
    construct_at(c, true)
}
fn apply(s: &mut Sim, input: &Value) {
    let p = &input["payload"];
    let raw = match input["type"].as_str().unwrap() {
        "train" => RawCommand::Train(crate::input::TrainRaw {
            command: if p["cmd"] == "stat" {
                2
            } else {
                assert_eq!(p["cmd"], "camp");
                3
            },
            id: crate::mob_catalog::MobTypeId::ALL
                .iter()
                .position(|id| id.as_str() == p["id"].as_str().unwrap())
                .unwrap() as u32,
            count: p["count"].as_u64().unwrap_or(0),
            options: [0; 3],
            option_count: 0,
        }),
        "move" => RawCommand::Move {
            x: p["x"].as_f64().unwrap(),
            y: p["y"].as_f64().unwrap(),
            seq: Some(p["seq"].as_u64().unwrap() as u8),
        },
        "attack" => RawCommand::Attack {
            a: p["a"].as_f64().unwrap(),
            t: None,
        },
        "release" => RawCommand::Release {
            a: p["a"].as_f64().unwrap(),
            t: None,
        },
        _ => panic!("unsupported captured input"),
    };
    s.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
}
fn rng_state(actual: &crate::rng::Mulberry32, c: &Value, v: &Value) {
    let mut rng = crate::rng::Mulberry32::new(12);
    let n = v["mainDrawCount"].as_u64().unwrap() as usize;
    for want in &c["rng"]["mainDraws"].as_array().unwrap()[..n] {
        assert_eq!(rng.next_f64().to_bits(), want.as_f64().unwrap().to_bits());
    }
    assert_eq!(
        *actual, rng,
        "actual native main stream boundary at tick{}",
        v["tick"]
    );
    if n == c["rng"]["mainDraws"].as_array().unwrap().len() {
        assert_eq!(
            rng.next_f64().to_bits(),
            c["rng"]["mainNextFromIndependentReplay"]
                .as_f64()
                .unwrap()
                .to_bits()
        );
    }
}
#[test]
fn earned_training_two_cases_every_frame_phase_event_and_rng() {
    let f = corpus();
    assert_eq!(f["format"], "rh-mark-tax-uncapped-source/1");
    let mut frames = 0;
    for c in f["cases"].as_array().unwrap() {
        let mut s = construct(c);
        let mut emitted = s.take_events();
        for (i, r) in c["frames"].as_array().unwrap().iter().enumerate() {
            if i > 0 {
                if let Some(input) = c["input"]["inputs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|a| a["beforeTick"] == json!(s.tick()))
                {
                    apply(&mut s, input);
                }
                PHASES.with(|rows| *rows.borrow_mut() = Some(Vec::new()));
                emitted = s.step();
                let phases = PHASES.with(|rows| rows.borrow_mut().take().unwrap());
                assert_eq!(phases.len(), r["phases"].as_array().unwrap().len());
                for ((got, state), want) in phases.iter().zip(r["phases"].as_array().unwrap()) {
                    equal(
                        got,
                        &project_source(want),
                        &format!("case{}/frame{i}/{}", c["name"], got["phase"]),
                    );
                    rng_state(state, c, &want["value"]);
                }
            }
            let public = crate::try_public_snapshot(&s).unwrap();
            let me = &public.players[0];
            equal(
                &json!({"markTier":me.mark_tier,"brand":me.brand,"markTax":me.mark_tax}),
                &json!({"markTier":r["value"]["player"]["markTier"],"brand":r["value"]["player"]["brand"],"markTax":r["value"]["player"]["markTax"]}),
                "actual completed native public fields",
            );
            equal(
                &snapshot(&s.w),
                &project_source(&r["value"]),
                &format!("case{}/frame{i}", c["name"]),
            );
            equal(
                &json!(events(&s.w, &emitted)),
                &r["events"],
                &format!("frame{i}/events"),
            );
            rng_state(&s.w.spawn_rng, c, &r["value"]);
            frames += 1;
        }
    }
    assert_eq!(frames, 124);
}

fn play_to(c: &Value, tick: u32) -> Sim {
    let mut s = construct_at(c, false);
    s.take_events();
    let start = s.tick();
    while s.tick() - start < tick {
        if let Some(input) = c["input"]["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["beforeTick"] == json!(s.tick() - start))
        {
            apply(&mut s, input);
        }
        s.step();
    }
    s
}
fn roundtrip(s: &Sim) {
    let mut restored =
        Sim::restore(serde_json::to_value(s).unwrap()).expect("real live-tax canonical restore");
    let mut cloned = s.clone();
    assert_eq!(s.state_hash(), restored.state_hash());
    assert_eq!(s.state_hash(), cloned.state_hash());
    assert_eq!(cloned.step(), restored.step(), "no-submit next step");
    assert_eq!(cloned.state_hash(), restored.state_hash());
    for sim in [&mut cloned, &mut restored] {
        sim.submit(PlayerId(1), validate(RawCommand::Aim { a: 0.25 }).unwrap())
            .unwrap();
    }
    assert_eq!(
        cloned.step(),
        restored.step(),
        "subsequent validated input continuation"
    );
    assert_eq!(cloned.state_hash(), restored.state_hash());
}
#[test]
fn genuine_live_tax_restore_clone_projection_and_hash_leaves() {
    let f = corpus();
    let c = &f["cases"][0];
    for tick in [47, 48, 60, 61] {
        let s = play_to(c, tick);
        roundtrip(&s);
        let mut observer = crate::ItemObserver::new(PlayerId(1));
        let mut out = crate::Observation::default();
        let offered = observer.prepare_into(&s, &[], &mut out, None).unwrap();
        assert_eq!(
            out.me.as_ref().unwrap().mark_tax,
            c["frames"][tick as usize]["value"]["player"]["markTax"]
                .as_u64()
                .unwrap() as u8
        );
        drop(offered); // No delivery commit is needed to inspect the prepared native view.
        if tick == 48 {
            let original = s.state_hash();
            let mut changed = s.clone();
            changed.w.factions.public_tax[0].percent -= 1;
            assert_ne!(original, changed.state_hash());
            let mut changed = s.clone();
            let other = changed
                .w
                .mobs
                .iter()
                .find(|m| {
                    m.mob_type == Some(crate::mob_catalog::MobTypeId::Bailiff)
                        && m.core.id != changed.w.factions.taxed[0].by
                })
                .unwrap()
                .core
                .id;
            changed.w.factions.taxed[0].by = other;
            assert_ne!(
                original,
                changed.state_hash(),
                "private selected source is canonical even when the sheet factor is equal"
            );
            let state = serde_json::to_value(&s).unwrap();
            for kind in [
                "unknown",
                "duplicate",
                "percent",
                "bit",
                "missing-index",
                "missing-percent",
                "dummy-marker",
            ] {
                let mut bad = state.clone();
                match kind {
                    "unknown" => bad["world"]["factions"]["taxed"][0]["by"] = json!(u32::MAX),
                    "dummy-marker" => {
                        let id =
                            s.w.mobs
                                .iter()
                                .find(|m| m.kind == crate::mob_runtime::MobKind::Dummy)
                                .unwrap()
                                .core
                                .id;
                        bad["world"]["factions"]["taxed"][0]["by"] = json!(id);
                    }
                    "duplicate" => {
                        let r = bad["world"]["factions"]["taxed"][0].clone();
                        bad["world"]["factions"]["taxed"]
                            .as_array_mut()
                            .unwrap()
                            .push(r);
                    }
                    "percent" => bad["world"]["factions"]["public_tax"][0]["percent"] = json!(101),
                    "bit" => bad["world"]["players"][0]["core"]["signature"]["bits"] = json!(0),
                    "missing-index" => {
                        bad["world"]["factions"]
                            .as_object_mut()
                            .unwrap()
                            .remove("taxed");
                    }
                    "missing-percent" => {
                        bad["world"]["factions"]
                            .as_object_mut()
                            .unwrap()
                            .remove("public_tax");
                    }
                    _ => unreachable!(),
                }
                assert!(Sim::restore(bad).is_err(), "malformed {kind}");
            }
        }
    }
}
#[test]
fn genuine_card_grant_and_hp_conditional_query_distinguish_fold_stages() {
    let f = corpus();
    let mut s = play_to(&f["cases"][0], 48);
    // Native producer diagnostic: passive Last Rites is not in the existing Training interactive-card subset.
    // Invoke the real grant/refold producer, then let ordinary NPC hits earn the conditional HP crossing.
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        crate::cards::CardId::LastRites
    ));
    assert_eq!(
        s.w.players[0].build.count(crate::cards::CardId::LastRites),
        1
    );
    s.step();
    let mut witnessed = false;
    let mut minimum_hp = f64::INFINITY;
    for _ in 0..2000 {
        minimum_hp = minimum_hp.min(s.w.players[0].vitals.hp);
        let before = s.w.players[0].modifiers.own_as_rows();
        PHASES.with(|rows| *rows.borrow_mut() = Some(Vec::new()));
        s.step();
        let phases = PHASES.with(|rows| rows.borrow_mut().take().unwrap());
        let after = s.w.players[0].modifiers.own_as_rows();
        if before.regular == 0. && after.regular > 0. {
            assert!(s.w.players[0].vitals.hp / s.w.players[0].vitals.max_hp < 0.3);
            assert!(factor(&s.w, &s.w.players[0].core, after) < 1.);
            let old_factor = crate::constants::MARK_TAX_RATE_CAP / (0.95 * before.uncapped(1.));
            let wrong =
                crate::stat_fold::encode_mult((1. + after.regular + after.farm) * old_factor);
            assert_ne!(
                wrong, 104211.,
                "control: stale tax factor would pay a different mirror"
            );
            let actual = phases
                .iter()
                .find(|(v, _)| v["phase"] == "after-mods")
                .unwrap()
                .0["value"]["player"]["asMult"]
                .as_f64()
                .unwrap();
            assert_eq!(
                actual, 104211.,
                "conditional rows precede the end-mods tax query"
            );
            witnessed = true;
            break;
        }
    }
    assert!(witnessed,"real card grant and ordinary landed NPC hits must reach the HP condition flip: minHP={minimum_hp}, player={:?}, rows={:?}, card={} NPC={:?}",s.w.players[0].vitals,s.w.players[0].modifiers.own_as_rows(),s.w.players[0].build.count(crate::cards::CardId::LastRites),s.w.mobs.iter().filter(|m|m.mob_type==Some(crate::mob_catalog::MobTypeId::Bailiff)).map(|m|(&m.brain,&m.core.signature.mark,m.core.body.x,m.core.body.y)).collect::<Vec<_>>());
}
#[test]
fn genuine_walk_away_retains_late_return_cache_for_restore() {
    let f = corpus();
    let mut s = play_to(&f["cases"][0], 48);
    let from = s.players()[0].core.pos();
    s.submit(
        PlayerId(1),
        validate(RawCommand::Move {
            x: from.x + 800.,
            y: from.y + 800.,
            seq: Some(2),
        })
        .unwrap(),
    )
    .unwrap();
    let mut witnessed = false;
    for _ in 0..300 {
        s.step();
        if s.w
            .factions
            .taxed
            .iter()
            .any(|r| s.w.mobs.get(r.by).is_some_and(|m| m.returning()))
        {
            roundtrip(&s);
            witnessed = true;
            break;
        }
    }
    assert!(witnessed,"ordinary movement should witness a post-public-sync mobAI Return with a retained phase index");
}
#[test]
#[ignore = "dhat must run alone: cargo test -p rh-sim --lib mark_tax_warm_alloc -- --ignored --test-threads=1"]
fn mark_tax_warm_alloc() {
    let f = corpus();
    let mut s = play_to(&f["cases"][0], 48);
    let mut out = Vec::new();
    for _ in 0..120 {
        out.clear();
        s.step_into(&mut out);
    }
    for stage in ["original", "clone", "restore"] {
        s = match stage {
            "clone" => s.clone(),
            "restore" => Sim::restore(serde_json::to_value(&s).unwrap()).unwrap(),
            _ => s,
        };
        let budget = super::super::edge_budget(&s.k, s.w.players.len())
            .unwrap()
            .max(s.w.factions.taxed.len())
            .max(s.w.factions.public_tax.len());
        assert!(
            s.w.factions.taxed.capacity() >= budget
                && s.w.factions.public_tax.capacity() >= budget
                && s.s.mark_tax_next.capacity() >= budget,
            "banks prepared before any step/submit after {stage}"
        );
        // No submit grows the restored scratch/banks. Existing output/other subsystems warm independently of the new banks.
        for _ in 0..30 {
            out.clear();
            s.step_into(&mut out);
        }
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(std::env::temp_dir().join(format!("rh-mark-tax-{stage}.json")))
            .build();
        for _ in 0..240 {
            out.clear();
            #[cfg(feature = "schedule-trace")]
            s.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            s.step_into(&mut out);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}

#[test]
fn actual_phase_read_probe_does_not_change_events_state_or_rng() {
    let f = corpus();
    let mut with = play_to(&f["cases"][0], 47);
    let mut without = with.clone();
    PHASES.with(|rows| *rows.borrow_mut() = Some(Vec::new()));
    let a = with.step();
    let phases = PHASES.with(|rows| rows.borrow_mut().take().unwrap());
    assert_eq!(phases.len(), 8);
    let b = without.step();
    assert_eq!(a, b);
    assert_eq!(with.state_hash(), without.state_hash());
    assert_eq!(with.w.spawn_rng, without.w.spawn_rng);
}

#[test]
fn accepted_training_clear_removes_real_tax_sources_and_public_cut() {
    let f = corpus();
    let mut s = play_to(&f["cases"][0], 48);
    assert!(!s.w.factions.taxed.is_empty());
    assert_eq!(public_percent(&s.w, PlayerId(1)), 48);
    s.submit(
        PlayerId(1),
        validate(RawCommand::Train(crate::input::TrainCommand::Clear.raw())).unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s.w.factions.taxed.is_empty());
    assert!(s.w.factions.public_tax.is_empty());
    assert_eq!(s.w.players[0].signature.bits & SIG_TAXED, 0);
    assert_eq!(s.w.players[0].modifiers.attack_rate_wire(), 1000.);
    roundtrip(&s);
}

#[test]
fn ordinary_training_npc_death_revives_without_a_plague_corpse_and_restores() {
    let f = corpus();
    let mut s = play_to(&f["cases"][0], 48);
    let mut witnessed = false;
    for _ in 0..1200 {
        let events = s.step();
        assert!(
            s.w.plague_corpses.is_empty(),
            "Training death never leaves source-excluded remains"
        );
        if events.iter().any(|e| {
            matches!(
                e,
                Event::Death {
                    id: PlayerId(1),
                    ..
                }
            )
        }) {
            assert_eq!(s.w.players[0].status, crate::Status::Alive);
            assert_eq!(s.w.players[0].vitals.hp, s.w.players[0].vitals.max_hp);
            roundtrip(&s);
            witnessed = true;
            break;
        }
    }
    assert!(
        witnessed,
        "actual practice NPC damage must earn a Training death/revival"
    );
}
