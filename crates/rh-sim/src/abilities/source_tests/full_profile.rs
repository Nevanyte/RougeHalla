//! Exact original full-profile comparison through production construction, joins and canonical restore.
use super::*;

fn clock(value: Option<f64>) -> V {
    value.map_or_else(|| json!({"$float":"-Infinity"}), |v| json!(v))
}
fn group(value: Option<crate::fighter::MarkGroup>) -> V {
    match value {
        None => V::Null,
        Some(crate::fighter::MarkGroup::Fighter(id)) => json!(format!("fighter:{}", label(id))),
        Some(crate::fighter::MarkGroup::Camp(c)) => json!(format!("camp:{}", c + 1)),
    }
}
fn factions(s: &Sim, frame: &V, name: &str) {
    let rt = &frame["private"]["factions"];
    let rows = rt["fighters"].as_array().unwrap();
    for slot in 0..s.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let c = s.w.core(ix);
        let key = label(c.id);
        let f = &c.signature;
        let Some(e) = rows.iter().find(|r| r[0] == key).map(|r| &r[1]) else {
            assert_eq!(
                *f,
                crate::fighter::Signature::default(),
                "{name}/{} absent signature {key}",
                s.tick()
            );
            continue;
        };
        let hits = serde_json::to_value(&f.ap_hits).unwrap();
        let actual = json!({"target":f.target.map(label),"inReach":f.in_reach,"engaged":f.engaged,"reachAt":clock(f.reach_at),"contactAt":clock(f.contact_at),"combatAt":clock(f.combat_at),"hpFrac":f.hp_frac,
            "tier":f.mark.tier,"markGroup":group(f.mark.group),"markGroupSize":f.mark.group_size,"markHits":f.mark.hits,"markProgress":f.mark.progress,"markSwaps":f.mark.swaps,"markDenied":f.mark.denied,"farSince":clock(f.mark.far_since),"ampUntil":f.mark.amp_until,
            "chill":f.chill,"chillers":f.chillers.iter().map(|id|label(*id)).collect::<Vec<_>>(),"chillExposureStartedAt":clock(f.exposure_started_at),"chillLastNearAt":clock(f.last_near_at),"rangedChillUntil":clock(f.ranged_chill_until),"frostMoveMult":f.frost_move_mult,"dotPausedUntil":f.dot_paused_until,"engagedOn":f.engaged_on.map(label)});
        let expected: serde_json::Map<_, _> = actual
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), e[k].clone()))
            .collect();
        compare_value(
            &actual,
            &V::Object(expected),
            &format!("{name}/tick{}/{key}/full-signature", s.tick()),
        );
        compare_value(
            &json!({"apHitsOn":f.ap_hits.target.map(label),"apHits":hits["hits"]}),
            &json!({"apHitsOn":e.get("apHitsOn").unwrap_or(&V::Null),"apHits":e.get("apHits").unwrap_or(&json!([]))}),
            &format!("{name}/tick{}/{key}/AP-history", s.tick()),
        );

        #[cfg(feature = "trusted-status-probes")]
        {
            use crate::status_runtime::probe::HookRecord;
            let phase =
                s.w.trace
                    .1
                    .after_weapons
                    .iter()
                    .find(|p| p.core.id == c.id)
                    .expect("real afterWeapons phase actor");
            assert_eq!(&phase.origin, s.w.actor_origin(c.id).unwrap());
            let phase_action = phase.core.weapon.action;
            let late_start = s.w.trace.1.records[s.w.trace.1.after_weapons_hook_count..]
                .iter()
                .any(|r| match r {
                    HookRecord::AttackStarted { actor } => actor.id == c.id,
                    HookRecord::NpcAttackStarted { snapshot } => snapshot.actor.core.id == c.id,
                    _ => false,
                });
            // The source reference sees later mutations of the same action, but not a later replacement/start.
            let seen = if phase_action.is_some() && !late_start {
                c.weapon.action.or(phase_action)
            } else {
                phase_action
            };
            compare_value(
                &super::motion::action(seen),
                &e["seenAction"],
                &format!("{name}/tick{}/{key}/phase-action-reference", s.tick()),
            );
        }
        let states = if s.w.is_player(ix) {
            &frame["public"]["players"]
        } else {
            &frame["public"]["mobs"]
        };
        let public = &states
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == key)
            .unwrap()["state"];
        let tier = crate::systems::sentenced::public_mark_tier(&s.w, c.id);
        let owner = crate::systems::sentenced::public_mark_by(&s.w, c.id, tier, |_| true)
            .map(label)
            .unwrap_or_default();
        let actual =
            json!({"sig":f.bits,"markTier":tier,"brand":tier*25,"markBy":owner,"markTax":0});
        let expected: serde_json::Map<_, _> = actual
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), public[k].clone()))
            .collect();
        compare_value(
            &actual,
            &V::Object(expected),
            &format!("{name}/tick{}/{key}/public-faction", s.tick()),
        );
    }
    for row in rows {
        assert!(
            s.w.players.iter().any(|p| label(p.id) == row[0])
                || s.mobs().iter().any(|m| label(m.core.id) == row[0]),
            "source runtime references an unbound actor"
        );
    }
    let dot:Vec<_>=s.w.factions.dot.iter().map(|d|json!([format!("{}|{}|{}",label(d.victim),label(d.by),d.sig.as_str()),{"victim":label(d.victim),"by":label(d.by),"sig":d.sig.as_str(),"weapon":d.weapon.map(|w|w.as_str()),"amount":d.amount}])).collect();
    compare_value(&json!(dot), &rt["dot"], &format!("{name}/dot"));
    compare_value(
        &json!(s.w.factions.dot_since),
        &rt["dotSince"],
        &format!("{name}/dotSince"),
    );
    for m in s.mobs() {
        let key = label(m.core.id);
        let row = frame["private"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == key)
            .unwrap();
        let b = m.regional_brain();
        let mode = match b.mode {
            crate::mob_runtime::BrainMode::Idle => "idle",
            crate::mob_runtime::BrainMode::Fight => "fight",
            crate::mob_runtime::BrainMode::Return => "return",
        };
        let actual = json!({"region":m.core.faction_id().expect("actual source regional mob").as_str(),"elite":m.elite,"home":m.home,"homeFacing":m.home_facing,"mode":mode,"target":b.target.map(label),"threat":b.threat.iter().map(|(id,n)|json!([label(*id),n])).collect::<Vec<_>>(),"lastCombatAt":b.last_combat_at,"lastMoveAt":b.last_move_at,"goal":b.goal,"moving":b.moving,"holding":b.holding,"phase":m.repath_phase,"diedAt":b.died_at,"lastAim":b.last_aim.map_or_else(||json!({"$float":"NaN"}),|v|json!(v))});
        compare_value(
            &actual,
            &row["brain"],
            &format!("{name}/tick{}/{key}/brain", s.tick()),
        );
        compare_value(
            &json!(m.last_hit_at),
            &row["lastHitAt"],
            &format!("{name}/tick{}/{key}/lastHit", s.tick()),
        );
        let public = &frame["public"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == key)
            .unwrap()["state"];
        let actual = json!({"weapon0":m.core.weapon.weapon0.map_or("",|w|w.as_str()),"weapon1":m.core.weapon.weapon1.map_or("",|w|w.as_str()),"slot":m.core.weapon.slot,"readyAt":m.core.weapon.ready_at});
        let expected: serde_json::Map<_, _> = actual
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), public[k].clone()))
            .collect();
        compare_value(
            &actual,
            &V::Object(expected),
            &format!("{name}/tick{}/{key}/gear", s.tick()),
        );
        let crate::mob_runtime::ActorOrigin::Mob {
            birth_serial,
            camp,
            spot,
            mob_type,
            elite,
            ..
        } = s.w.actor_origin(m.core.id).unwrap()
        else {
            panic!("genuine source camp provenance required")
        };
        assert_eq!(
            (*camp, Some(*mob_type), *elite),
            (m.camp, m.mob_type, m.elite)
        );
        assert_eq!(*birth_serial, m.core.id.0 - s.players().len() as u32);
        let site =
            s.k.arena.map.layers().unwrap().data().camps[*camp as usize].spots[*spot as usize];
        assert_eq!((site.x, site.y), (m.home.x, m.home.y));
    }
}

fn complete_runtime(s: &Sim, frame: &V, name: &str) {
    let landed: Vec<_> = s.landed_hits().iter().map(|h| {
        let mut row = json!({"victim":label(h.victim),"by":h.by.map(label),"amount":h.amount,"weapon":h.weapon.map(|w|w.as_str()),"sig":h.sig.map_or_else(||json!({"$undefined":true}), |v|json!(v.as_str()))});
        if let Some(a) = h.ability { row["ability"] = json!(a); }
        if h.dot { row["dot"] = json!(true); }
        if h.critical { row["crit"] = json!(true); }
        if h.race != 1. { row["race"] = json!(h.race); }
        if h.cut != 1. { row["cut"] = json!(h.cut); }
        row
    }).collect();
    compare_value(
        &json!(landed),
        &frame["private"]["landed"],
        &format!("{name}/tick{}/complete-landed", s.tick()),
    );
    assert!(
        s.w.containers.is_empty(),
        "strict born map has no native container"
    );
    assert_eq!(
        frame["private"]["containers"],
        json!({}),
        "strict source has no container"
    );
    let rt = s.w.mob_runtime.as_ref().unwrap();
    let camps:Vec<_>=rt.camps.iter().zip(&rt.life).map(|(c,l)|json!({"type":c.mob_type.as_str(),"elite":c.elite.map_or("",|v|v.as_str()),"alive":c.alive,"state":c.state,"clearedAt":c.cleared_at,"respawnAt":c.respawn_at,"reward":"","wardOwner":l.ward_owner.map(label).unwrap_or_default(),"wardExpiresAt":l.ward_expires_at})).collect();
    compare_value(
        &json!(camps),
        &frame["private"]["camps"],
        &format!("{name}/tick{}/camps", s.tick()),
    );
    let expected = frame["private"]["projectiles"].as_array().unwrap();
    assert_eq!(
        s.w.projectiles.len(),
        expected.len(),
        "{name}/tick{}/live-projectile-count",
        s.tick()
    );
    for (p, e) in s.w.projectiles.iter().zip(expected) {
        let l = p.launch;
        let pid = format!("p{}", base36(l.id));
        assert_eq!(e[0], pid);
        let launch = json!({"id":pid,"kind":format!("{:?}",l.kind).to_lowercase(),"x":l.origin.x,"y":l.origin.y,"vx":l.velocity.x,"vy":l.velocity.y,"t":l.time,"range":l.range,"ownerId":label(l.owner)});
        compare_value(&launch, &e[1]["launch"], &format!("{name}/{pid}/launch"));
        let actual = json!({"id":pid,"kind":format!("{:?}",l.kind).to_lowercase(),"weapon":p.weapon().as_str(),"owner":label(l.owner),"x":p.pos.x,"y":p.pos.y,"vx":p.velocity.x,"vy":p.velocity.y,"simT":p.time,"traveled":p.traveled,"packet":{"raw":p.packet.raw,"phys":p.packet.phys,"magic":p.packet.magic,"true":p.packet.true_},"halved":p.halved,"ended":false,"reflections":p.reflections});
        let expected: serde_json::Map<_, _> = actual
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), e[1][k].clone()))
            .collect();
        compare_value(
            &actual,
            &V::Object(expected),
            &format!("{name}/{pid}/live-flight"),
        );
        // Source tickX/Y are a sweep-phase scratch origin, not retained native projectile state. The actual launch/end
        // tape checks the sweep's effects; no source scratch coordinate is installed into native state.
    }
}

fn check(s: &Sim, f: &V, name: &str, input: &V) {
    compare(s, f, name, input);
    factions(s, f, name);
    complete_runtime(s, f, name);
}

fn base36(mut id: u32) -> String {
    let mut buf = [0; 7];
    let mut start = buf.len();
    loop {
        start -= 1;
        let n = (id % 36) as u8;
        buf[start] = if n < 10 { b'0' + n } else { b'a' + n - 10 };
        id /= 36;
        if id == 0 {
            break;
        }
    }
    std::str::from_utf8(&buf[start..]).unwrap().into()
}
/// Native launch/end metadata is one source projEnd envelope. A launch must remain live or have its actual end here.
pub(super) fn complete_events(s: &Sim, events: &[Event], case: &V) {
    let actual:Vec<V>=events.iter().filter_map(|e|Some(match e {
        Event::RaidStarted=>json!({"type":"raidStarted"}),
        Event::Toast{to,text}=>json!({"type":"toast","to":to.map(label),"text":text}),
        Event::MobArmed{id,weapon}=>json!({"type":"toast","to":label(*id),"text":format!("Armed: {weapon:?}")}),
        Event::MarkNotice{recipient,notice}=>json!({"type":"toast","to":label(*recipient),"text":notice.message()}),
        Event::Gv{id,amount,reason}=>json!({"type":"gv","id":label(*id),"amount":amount,"reason":format!("{reason:?}").to_lowercase()}),
        Event::CastStarted{event_time,id,ability,ms,target,x,y}=>{assert_eq!(*event_time,s.server_time());json!({"type":"fx","fx":{"kind":"cast","by":label(*id),"ability":ability,"ms":ms,"target":target.map(label),"x":x,"y":y}})},
        Event::CastLanded{event_time,id,ability,target,x,y,to}=>{assert_eq!(*event_time,s.server_time());let mut fx=json!({"kind":"castLand","by":label(*id),"ability":ability,"target":target.map(label),"x":x,"y":y});if let Some(to)=to {fx["x2"]=json!(to.x);fx["y2"]=json!(to.y);}json!({"type":"fx","fx":fx})},
        Event::CastEnded{event_time,id,ability,reason}=>{assert_eq!(*event_time,s.server_time());json!({"type":"fx","fx":{"kind":"castEnd","by":label(*id),"ability":ability,"reason":reason}})},
        Event::StatusApplied{id,kind,ms,by}=>json!({"type":"fx","fx":{"kind":"status","id":label(*id),"status":kind,"ms":ms,"by":by.map(label).unwrap_or_default()}}),
        Event::Death{id,x,y,by}=>json!({"type":"fx","fx":{"kind":"death","id":label(*id),"x":x,"y":y,"by":by.map(label)}}),
        Event::Heal{id,amount}=>json!({"type":"fx","fx":{"kind":"heal","id":label(*id),"amount":amount}}),
        Event::Windup{by,weapon,a,ms}=>json!({"type":"fx","fx":{"kind":"windup","by":label(*by),"weapon":weapon.as_str(),"a":a,"ms":ms}}),
        Event::Swing{by,weapon,x,y,a}=>json!({"type":"fx","fx":{"kind":"swing","by":label(*by),"weapon":weapon.as_str(),"x":x,"y":y,"a":a}}),
        Event::Hit{victim,by,amount,weapon,passive}=>{let mut fx=json!({"kind":"hit","id":label(*victim),"by":by.map(label),"amount":amount,"weapon":weapon.map(|w|w.as_str())});if *passive{fx["passive"]=json!(true);}json!({"type":"fx","fx":fx})},
        Event::SignatureHit{victim,by,sig,weapon,amount}=>json!({"type":"fx","fx":{"kind":"hit","id":label(*victim),"by":label(*by),"sig":sig.as_str(),"weapon":weapon.map(|w|w.as_str()),"amount":amount}}),
        Event::AbilityHit{victim,by,ability,amount}=>json!({"type":"fx","fx":{"kind":"hit","id":label(*victim),"by":by.map(label),"amount":amount,"weapon":null,"ability":ability}}),
        Event::ProjectileLaunched(p)=>{assert!(events.iter().any(|e|matches!(e,Event::ProjectileEnded{launch,..}if launch==p))||s.w.projectiles.iter().any(|live|live.launch==*p),"every real launch has an actual live/end owner");return None;},
        Event::ProjectileEnded{launch,at,reason}=>json!({"type":"fx","fx":{"kind":"projEnd","id":format!("p{}",base36(launch.id)),"proj":format!("{:?}",launch.kind).to_lowercase(),"x0":launch.origin.x,"y0":launch.origin.y,"t0":launch.time,"x":at.x,"y":at.y,"reason":format!("{reason:?}").to_lowercase(),"ownerId":label(launch.owner)}}),
        other=>panic!("unmapped actual Full source event: {other:?}"),
    })).collect();
    let expected: Vec<_> = case["completeNonemptyEventTape"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["tick"] == s.tick() && t["betweenSteps"] != true)
        .flat_map(|t| t["events"].as_array().unwrap())
        .cloned()
        .collect();
    compare_value(
        &json!(actual),
        &json!(expected),
        &format!("{}/tick{}/complete-events", case["name"], s.tick()),
    );
}

#[cfg(feature = "trusted-status-probes")]
pub(super) fn complete_hooks(s: &Sim, case: &V) {
    use crate::status_runtime::probe::{HealSource, HookRecord};
    // Source Proxy records each returned wrapper. Native dispatch records the completed invocation once. Check every
    // declared wrapper in order before collapsing its final return to that invocation boundary; no unknown row is skipped.
    let chain = |name: &str| -> &[&str] {
        match name {
            "raidStarted" => &[
                "factions",
                "mobLife",
                "terrainEffects",
                "abilities",
                "vision",
                "cardHooks",
            ],
            "attackStarted" => &["factions", "abilities"],
            "fighterOut" => &["abilities", "vision"],
            "statusApplied" | "staggered" => &["abilities"],
            "hurt" | "weaponSwapped" => &["factions"],
            "hitLanded" | "overkilled" => &["cardHooks"],
            "mobKilled" => &["chests"],
            "castAccepted" | "castEnded" | "healed" | "arenaHurt" => &["observational-tap"],
            other => panic!("unmapped declared source hook {other}"),
        }
    };
    let mut progress = std::collections::BTreeMap::<String, usize>::new();
    let mut expected = Vec::new();
    let mut arguments = Vec::new();
    for h in case["completeOrdinaryHookTape"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["tick"] == s.tick())
        .flat_map(|t| t["hooks"].as_array().unwrap())
    {
        let name = h["hook"].as_str().unwrap();
        if h["kind"] == "arguments" {
            assert!(matches!(
                name,
                "castAccepted" | "castEnded" | "healed" | "arenaHurt"
            ));
            arguments.push(h.clone());
            continue;
        }
        let layers = chain(name);
        let i = progress.entry(name.into()).or_default();
        assert_eq!(
            h["installer"], layers[*i],
            "literal source wrapper chain {name}"
        );
        *i += 1;
        if *i == layers.len() {
            *i = 0;
            expected.push(json!({"hook":name,"time":h["time"],"tick":h["tick"]}));
        }
    }
    assert!(
        progress.values().all(|n| *n == 0),
        "unfinished source wrapper chain"
    );
    let actual: Vec<_> =
        s.w.trace
            .1
            .invocations
            .iter()
            .map(|i| json!({"hook":i.name,"time":i.time,"tick":i.tick}))
            .collect();
    compare_value(
        &json!(actual),
        &json!(expected),
        &format!(
            "{}/tick{}/complete-hook-invocations",
            case["name"],
            s.tick()
        ),
    );
    let heal_source = |s: HealSource| match s {
        HealSource::Lifesteal => "lifesteal",
        HealSource::DeathFloor => "lastStand",
        _ => "other",
    };
    let actual:Vec<_>=s.w.trace.1.records.iter().filter_map(|r|Some(match r {
        HookRecord::Healed{actor,amount,source}=>json!({"hook":"healed","kind":"arguments","time":s.server_time(),"tick":s.tick(),"args":[{"actor":label(actor.id)},amount,heal_source(*source)]}),
        HookRecord::NpcHealed{snapshot,amount,source}=>{assert_eq!(&snapshot.origin,s.w.actor_origin(snapshot.actor.core.id).unwrap());json!({"hook":"healed","kind":"arguments","time":s.server_time(),"tick":s.tick(),"args":[{"actor":label(snapshot.actor.core.id)},amount,heal_source(*source)]})},
        HookRecord::CastAccepted{actor,ability}=>json!({"hook":"castAccepted","kind":"arguments","time":s.server_time(),"tick":s.tick(),"actor":label(actor.id),"ability":ability,"reason":{"$undefined":true},"wishReadyAt":actor.stocks.wish_ready_at,"wishFullAt":actor.stocks.wish_full_at,"cast":actor.statuses.cast.map(super::compare::cast)}),
        HookRecord::CastLanded{actor,ability}=>json!({"hook":"castEnded","kind":"arguments","time":s.server_time(),"tick":s.tick(),"actor":label(actor.id),"ability":ability,"reason":"landed","wishReadyAt":actor.stocks.wish_ready_at,"wishFullAt":actor.stocks.wish_full_at,"cast":actor.statuses.cast.map(super::compare::cast)}),
        HookRecord::CastEnded{actor,ability,reason}=>json!({"hook":"castEnded","kind":"arguments","time":s.server_time(),"tick":s.tick(),"actor":label(actor.id),"ability":ability,"reason":reason,"wishReadyAt":actor.stocks.wish_ready_at,"wishFullAt":actor.stocks.wish_full_at,"cast":actor.statuses.cast.map(super::compare::cast)}),
        _=>return None,
    })).collect();
    compare_value(
        &json!(actual),
        &json!(arguments),
        &format!(
            "{}/tick{}/all-captured-hook-arguments",
            case["name"],
            s.tick()
        ),
    );
}

fn bootstrap_rng(s: &Sim, frame: &V) {
    let mut main = crate::rng::Mulberry32::new(12);
    for _ in 0..frame["rng"]["main"].as_u64().unwrap() {
        main.next_u32();
    }
    assert_eq!(
        serde_json::to_value(main).unwrap(),
        serde_json::to_value(&s.w.spawn_rng).unwrap()
    );
    let mut reward = crate::private_rng::Sfc32::from_words([1, 2, 3, 4]);
    for _ in 0..frame["rng"]["reward"].as_u64().unwrap() {
        reward.next_u32();
    }
    assert_eq!(reward.words(), s.w.reward_rng.words());
    assert_eq!(frame["rng"]["quest"], 0);
    assert_eq!(frame["private"]["idCounter"], s.w.entity_counter);
    assert_eq!(frame["private"]["uidCounter"], s.w.item_counter);
}
fn random_tape(case: &V) {
    let mut main = crate::rng::Mulberry32::new(12);
    let mut reward = crate::private_rng::Sfc32::from_words([1, 2, 3, 4]);
    let tape = case["randomTape"].as_array().unwrap();
    assert_eq!(tape.len(), 13, "strict source stream inventory");
    for (i, row) in tape.iter().enumerate() {
        let (stream, tick, time, phase, value) = match i {
            0 => ("main", 0, 0, "constructor", main.next_f64()),
            1..=9 => ("reward", 0, 0, "lobby", reward.next_f64()),
            10..=12 => ("main", 1, 50, "active", main.next_f64()),
            _ => unreachable!(),
        };
        assert_eq!(
            *row,
            json!({"stream":stream,"value":value,"tick":tick,"time":time,"phase":phase})
        );
    }
    // Native checkpoints at constructed/joined/birth/every ordinary step separately prove stream state/draw-count
    // boundaries. This validates every source draw value and its declared order, without inventing native draw events.
}

fn roundtrip_and_next_step(s: &Sim) {
    // Source seenAction is a JS object reference captured at afterWeapons. Its native read-only phase witness is
    // intentionally noncanonical; retain the original diagnostic collector while exercising the REAL canonical restore
    // and a no-submit next step beside an ordinary Clone. The all-63 driver separately replaces its Sim on restore.
    let mut restored =
        Sim::restore(serde_json::to_value(s).unwrap()).expect("real Full PvE canonical restore");
    let mut original = s.clone();
    assert_eq!(restored.state_hash(), original.state_hash());
    assert_eq!(
        restored.step(),
        original.step(),
        "real no-submit post-restore next step"
    );
    assert_eq!(restored.state_hash(), original.state_hash());
}

#[test]
fn exact_five_roster_signatures_production_comparator() {
    let doc = corpus();
    let mut count = 0;
    let mut failures = Vec::new();
    for c in doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["input"]["profile"] == "rosterSignatures")
    {
        let result = std::panic::catch_unwind(|| {
            let input = &c["input"];
            let name = c["name"].as_str().unwrap();
            random_tape(c);
            let mut s = super::setup::construct_with_stages(
                input,
                &mut |sim, stage| bootstrap_rng(sim, &c[stage]),
                &mut |sim, events| {
                    check(sim, &c["birth"], name, input);
                    complete_events(sim, events, c);
                    #[cfg(feature = "trusted-status-probes")]
                    complete_hooks(sim, c);
                },
            );
            check(&s, &c["initial"], name, input);
            roundtrip_and_next_step(&s);
            assert_eq!(input["actions"].as_array().unwrap().len(), 4);
            for (a, t) in input["actions"]
                .as_array()
                .unwrap()
                .iter()
                .zip(c["timeline"].as_array().unwrap())
            {
                match a["kind"].as_str().unwrap() {
                    "place" => {
                        let id = id(&a["actor"]).unwrap();
                        let ix = s.w.fighter_idx(id).unwrap();
                        if let Some(at) = a.get("at") {
                            let at = point(&s.k.arena.map, at);
                            let now = s.w.server_time;
                            let p = s.w.core_mut(ix);
                            p.body.x = at.x;
                            p.body.y = at.y;
                            p.body.history.reset(crate::state::Sample {
                                t: now,
                                x: at.x,
                                y: at.y,
                            });
                        }
                        if let Some(hp) = a["hp"].as_f64() {
                            s.w.core_mut(ix).vitals.hp = hp;
                        }
                        if let Some(mode) = a["mode"].as_str() {
                            assert_eq!(mode, "return");
                            s.w.mobs.get_mut(id).unwrap().regional_brain_mut().mode =
                                crate::mob_runtime::BrainMode::Return;
                        }
                        check(&s, t, name, input);
                        roundtrip_and_next_step(&s);
                    }
                    "step" => {
                        for i in a["inputs"].as_array().unwrap() {
                            enqueue(&mut s, i);
                        }
                        source_step(&mut s, c);
                        check(&s, t, name, input);
                        roundtrip_and_next_step(&s);
                    }
                    "span" => {
                        for n in 1..=a["count"].as_u64().unwrap() {
                            source_step(&mut s, c);
                            let frames = t["frames"].as_array().unwrap();
                            assert_eq!(
                                frames.len() as u64,
                                a["count"].as_u64().unwrap(),
                                "strict source supplies every ordinary step"
                            );
                            let f = &frames[n as usize - 1];
                            assert_eq!(f["relativeStep"], n);
                            check(&s, f, name, input);
                            roundtrip_and_next_step(&s);
                        }
                    }
                    other => panic!("unexpected strict source action {other}"),
                }
            }
            check(&s, &c["final"], name, input);
        });
        if result.is_err() {
            failures.push(c["name"].as_str().unwrap());
        }
        count += 1;
    }
    assert_eq!(count, 5);
    assert!(
        failures.is_empty(),
        "core comparison failures: {failures:?}"
    );
}

#[cfg(feature = "trusted-status-probes")]
#[test]
fn typed_npc_phase_and_hook_observers_do_not_change_ordinary_execution() {
    use crate::status_runtime::probe::HookRecord;
    let doc = corpus();
    let mut saw_npc = false;
    for case in doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["input"]["profile"] == "rosterSignatures")
    {
        let mut enabled = construct(&case["input"]);
        let mut disabled = enabled.clone();
        enabled.w.trace.1.enabled = true;
        disabled.w.trace.1.enabled = false;
        disabled.w.trace.1.records.clear();
        disabled.w.trace.1.invocations.clear();
        disabled.w.trace.1.after_weapons.clear();
        for command in case["input"]["actions"][2]["inputs"].as_array().unwrap() {
            enqueue(&mut enabled, command);
            enqueue(&mut disabled, command);
        }
        for _ in 0..45 {
            assert_eq!(enabled.step(), disabled.step());
            saw_npc |= enabled.w.trace.1.records.iter().any(|r| {
                matches!(
                    r,
                    HookRecord::NpcAttackStarted { .. }
                        | HookRecord::NpcHurt { .. }
                        | HookRecord::NpcHealed { .. }
                        | HookRecord::NpcStatusApplied { .. }
                )
            });
            assert_eq!(enabled.state_hash(), disabled.state_hash());
            assert_eq!(
                serde_json::to_value(&enabled).unwrap(),
                serde_json::to_value(&disabled).unwrap()
            );
        }
        saw_npc |= enabled.w.trace.1.records.iter().any(|r| {
            matches!(
                r,
                HookRecord::NpcAttackStarted { .. }
                    | HookRecord::NpcHurt { .. }
                    | HookRecord::NpcHealed { .. }
            )
        });
        assert!(!enabled.w.trace.1.after_weapons.is_empty());
        assert!(disabled.w.trace.1.records.is_empty());
        assert!(disabled.w.trace.1.invocations.is_empty());
        assert!(disabled.w.trace.1.after_weapons.is_empty());
    }
    assert!(saw_npc, "actual NPC hook sites must be exercised");
}

#[cfg(test)]
fn native_full_pve(mode: crate::FactionMode) -> Sim {
    let input = json!({"zone":"sentenced"});
    let arena = super::setup::born_arena(&input);
    let placements = native_full_placements();
    Sim::reset_active(
        SimConfig {
            faction_mode: mode,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            quests: false,
            consumables: false,
            regen: false,
            abilities: Mode::Full,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(12),
        &placements,
    )
}
fn native_full_placements() -> Vec<Placement> {
    (0..8)
        .map(|i| crate::Placement {
            profile: format!("native-full-{i}"),
            faction: if i == 0 {
                crate::FactionId::Sentenced
            } else if i == 1 {
                crate::FactionId::Frost
            } else {
                crate::FactionId::Holy
            },
            bot: false,
            at: if i < 2 {
                Vec2::new(112. + 64. * i as f64, 200.)
            } else {
                Vec2::new(624., 500. + 8. * i as f64)
            },
            hp: None,
            weapon0: Some(crate::WeaponId::Bow),
            weapon1: None,
        })
        .collect::<Vec<_>>()
}

#[test]
#[ignore = "dhat runs alone: full_pve_mark_frost_warm_alloc --ignored --test-threads=1"]
fn full_pve_mark_frost_warm_alloc_uses_real_constructor_restore_and_both_modes() {
    for mode in [
        crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
        crate::FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
    ] {
        let mut s = native_full_pve(mode);
        let target = s.mobs()[0].core.id;
        for id in [PlayerId(1), PlayerId(2)] {
            s.submit(
                id,
                crate::validate(RawCommand::Target { id: target }).unwrap(),
            )
            .unwrap();
            s.submit(
                id,
                crate::validate(RawCommand::Attack { a: -1., t: None }).unwrap(),
            )
            .unwrap();
        }
        let mut events = Vec::with_capacity(2048);
        for _ in 0..40 {
            events.clear();
            s.step_into(&mut events);
        }
        assert!(
            s.players().iter().any(|p| p.signature.mark.tier > 0)
                || s.mobs().iter().any(|m| m.core.signature.mark.tier > 0),
            "actual Mark activity"
        );
        assert!(
            s.players().iter().any(|p| p.signature.chill < 1.)
                || s.mobs().iter().any(|m| m.core.signature.chill < 1.),
            "actual Frost activity"
        );
        s = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        for _ in 0..20 {
            events.clear();
            s.step_into(&mut events);
        }
        let _profiler = dhat::Profiler::builder().testing().build();
        for _ in 0..20 {
            events.clear();
            #[cfg(feature = "schedule-trace")]
            s.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            s.step_into(&mut events);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}

#[test]
fn full_pve_real_replay_and_live_mark_frost_restore_clone_continue() {
    use crate::replay::{run_replay, Recorder, ReplayInput, ReplayStart};
    for mode in [
        crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
        crate::FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
    ] {
        let mut s = native_full_pve(mode);
        let mut recorder = Recorder::new(
            &s,
            s.config().clone(),
            ReplayStart::Active {
                placements: native_full_placements(),
            },
        );
        let target = s.mobs()[0].core.id;
        let mut continuation = None::<(Sim, Sim)>;
        let mut witnessed = false;
        for n in 0..100 {
            let commands = if n % 10 == 0 {
                [PlayerId(1), PlayerId(2)]
                    .into_iter()
                    .flat_map(|id| {
                        [
                            (id, RawCommand::Target { id: target }),
                            (id, RawCommand::Attack { a: -1., t: None }),
                        ]
                    })
                    .collect::<Vec<_>>()
            } else {
                vec![]
            };
            for (id, raw) in commands {
                let cmd = crate::validate(raw).unwrap();
                s.submit(id, cmd).unwrap();
                recorder.record(ReplayInput::Command { player: id, cmd });
                if let Some((restored, cloned)) = continuation.as_mut() {
                    restored.submit(id, cmd).unwrap();
                    cloned.submit(id, cmd).unwrap();
                }
            }
            let events = s.step();
            recorder.stepped(&s);
            if let Some((restored, cloned)) = continuation.as_mut() {
                assert_eq!(restored.step(), events);
                assert_eq!(cloned.step(), events);
                assert_eq!(restored.state_hash(), s.state_hash());
                assert_eq!(cloned.state_hash(), s.state_hash());
            }
            if !witnessed
                && n >= 20
                && (s.players().iter().any(|p| p.signature.mark.tier > 0)
                    || s.mobs().iter().any(|m| m.core.signature.mark.tier > 0))
                && (s.players().iter().any(|p| p.signature.chill < 1.)
                    || s.mobs().iter().any(|m| m.core.signature.chill < 1.))
            {
                continuation = Some((
                    Sim::restore(serde_json::to_value(&s).unwrap()).unwrap(),
                    s.clone(),
                ));
                witnessed = true;
            }
        }
        assert!(
            witnessed,
            "coupled actual live Mark/Frost checkpoint: {mode:?}"
        );
        let (replayed, _) = run_replay(&recorder.replay).unwrap();
        assert_eq!(replayed.state_hash(), s.state_hash());
    }
}
#[test]
fn full_pve_capability_does_not_relax_canonical_or_numeric_restore_checks() {
    let s = native_full_pve(crate::FactionMode::EngagementHolyPlagueFireFrostSentenced);
    let cp = serde_json::to_value(&s).unwrap();
    Sim::restore(cp.clone()).unwrap();
    for (path, bad) in [
        ("/world/mobs/0/core/signature/mark/group_size", json!(0)),
        ("/world/mobs/0/camp", json!(255)),
        ("/world/mobs/0/core/vitals/faction", json!("unknown")),
        ("/world/mob_runtime/combat", json!(false)),
    ] {
        let mut bad_state = cp.clone();
        *bad_state.pointer_mut(path).expect("actual canonical leaf") = bad;
        assert!(
            Sim::restore(bad_state).is_err(),
            "malformed Full state {path}"
        );
    }
    let mut lower = s.config().clone();
    lower.faction_mode = crate::FactionMode::EngagementHolyPlagueFireFrost;
    assert!(Sim::try_new(lower, s.arena().clone(), Secrets::from_seed(12)).is_err());
    let mut unsupported = s.config().clone();
    unsupported.mob_mode = crate::mob_runtime::MobMode::SpawnFoundation;
    assert!(Sim::try_new(unsupported, s.arena().clone(), Secrets::from_seed(12)).is_err());
}
