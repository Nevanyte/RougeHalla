use super::*;
pub(super) fn compare_value(actual: &V, expected: &V, path: &str) {
    match (actual, expected) {
        (V::Number(a), V::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!((a - b).abs() <= 2e-6, "{path}: {a} != {b}");
        }
        (V::Array(a), V::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path} length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare_value(a, b, &format!("{path}/{i}"));
            }
        }
        (V::Object(a), V::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path} keys"
            );
            for (k, a) in a {
                compare_value(a, &b[k], &format!("{path}/{k}"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

pub(super) fn cast(c: crate::status_runtime::CastFact) -> V {
    let d = c.producer.unwrap();
    json!({"ability":c.ability,"rank":d.rank,"slot":d.slot,"startedAt":c.started_at,"landsAt":c.lands_at,"target":d.target.map(label),"point":d.point,"landing":null,"prevReadyAt":d.previous_ready_at,"prevFullAt":d.previous_full_at,"lagMs":d.lag_ms})
}

pub(super) fn statuses(p: &crate::fighter::FighterCore) -> V {
    if !p.statuses.initialized {
        return V::Null;
    }
    V::Array(p.statuses.instances.iter().map(|st|{let mut v=json!({"kind":st.kind,"source":{"id":st.source.id.map(label).unwrap_or_default(),"name":st.source.name},"startedAt":st.started_at,"until":st.until,"value":st.value});
 let o=v.as_object_mut().unwrap();if let Some(a)=st.ability{o.insert("ability".into(),json!(a));}
 if let Some(t)=&st.tag{o.insert("tag".into(),json!(t));}
 for (k,v) in [("revealFrom",st.reveal_from),("taken",st.taken),("revealUntil",st.data.reveal_until),("dealtMult",st.data.dealt_mult),("takenFromSourceMult",st.data.taken_from_source_mult),("moveMult",st.data.move_mult),("floorHp",st.data.floor_hp),("healShare",st.data.heal_share)]{if let Some(v)=v{o.insert(k.into(),json!(v));}}
 if let Some(id)=st.data.field_id{o.insert("fieldId".into(),json!(format!("fld{id}")));}
 if let Some(sh)=st.data.shares{o.insert("shares".into(),json!({"phys":sh.phys,"magic":sh.magic,"true":sh.true_}));}v}).collect())
}

pub(super) fn compare(s: &Sim, frame: &V, name: &str, input: &V) {
    if input["lifecycleWitness"] == true {
        super::player_lifecycle::compare_factions(s, frame, name);
    }
    let mut expected_main =
        crate::rng::Mulberry32::new(input["mainSeed"].as_u64().unwrap_or(12) as u32);
    for _ in 0..frame["rng"]["main"].as_u64().unwrap() {
        expected_main.next_u32();
    }
    assert_eq!(
        serde_json::to_value(expected_main).unwrap(),
        serde_json::to_value(&s.w.spawn_rng).unwrap(),
        "{name}/tick{}/main RNG",
        s.tick()
    );
    let mut expected_reward = crate::private_rng::Sfc32::from_words(
        serde_json::from_value(input["rewardSalt"].clone()).unwrap(),
    );
    for _ in 0..frame["rng"]["reward"].as_u64().unwrap() {
        expected_reward.next_f64();
    }
    assert_eq!(
        expected_reward.words(),
        s.w.reward_rng.words(),
        "{name}/tick{}/reward RNG",
        s.tick()
    );
    assert_eq!(frame["rng"]["quest"], 0, "unconsumed quest source stream");
    assert_eq!(
        u64::from(s.w.entity_counter),
        frame["private"]["idCounter"].as_u64().unwrap(),
        "{name}/entity counter"
    );
    assert_eq!(
        s.w.item_counter,
        frame["private"]["uidCounter"].as_u64().unwrap(),
        "{name}/item counter"
    );
    assert_eq!(
        s.tick(),
        frame["tick"].as_u64().unwrap() as u32,
        "{name} tick"
    );
    assert_eq!(s.server_time(), num(&frame["time"]), "{name}/clock");
    assert_eq!(
        format!("{:?}", s.phase()).to_lowercase(),
        frame["phase"].as_str().unwrap(),
        "{name}/phase"
    );
    assert_eq!(
        s.w.rt.voided,
        frame["private"]["arena"]["voided"]
            .as_bool()
            .unwrap_or(false),
        "{name}/voided"
    );
    compare_value(
        &json!({"raidStartedAt":s.w.raid_started_at,"patienceEndsAt":s.w.rt.patience_ends_at.unwrap_or(0.),"inColiseum":s.w.rt.in_coliseum,"gatesLocked":s.w.rt.gates_locked,"suddenDeathAt":s.w.rt.sudden_death_at}),
        &json!({"raidStartedAt":frame["public"]["raidStartedAt"],"patienceEndsAt":frame["public"]["patienceEndsAt"],"inColiseum":frame["public"]["inColiseum"],"gatesLocked":frame["public"]["gatesLocked"],"suddenDeathAt":frame["public"]["suddenDeathAt"]}),
        &format!("{name}/arena clocks"),
    );
    let states = frame["public"]["players"].as_array().unwrap();
    let private = frame["private"]["players"].as_array().unwrap();
    assert_eq!(s.players().len(), states.len(), "{name} players");
    for (p, expected) in s.players().iter().zip(states) {
        let e = &expected["state"];
        let r = private.iter().find(|r| r["id"] == expected["id"]).unwrap();
        super::motion::compare_motion(p, r, e, &format!("{name}/tick{}/{}", s.tick(), label(p.id)));
        compare_value(
            &json!({"kills":p.credit.kills,"bounty":p.credit.bounty,"gv":p.credit.gv,"mobKills":p.credit.mob_kills,"status":format!("{:?}",p.status).to_lowercase(),"immuneUntil":p.vitals.immune_until,"weapon0":p.weapon.weapon0.map_or("",|w|w.as_str()),"weapon1":p.weapon.weapon1.map_or("",|w|w.as_str()),"readyAt":p.weapon.ready_at,"slot":p.weapon.slot}),
            &json!({"kills":e["kills"],"bounty":e["bounty"],"gv":e["gv"],"mobKills":e["mobKills"],"status":e["status"],"immuneUntil":e["immuneUntil"],"weapon0":e["weapon0"],"weapon1":e["weapon1"],"readyAt":e["readyAt"],"slot":e["slot"]}),
            &format!("{name}/tick{}/credit+weapon", s.tick()),
        );
        let killer = p
            .fate
            .killed_by_name
            .as_deref()
            .map(str::to_owned)
            .or_else(|| {
                p.fate
                    .killed_by
                    .and_then(|id| s.player_name(id).map(str::to_owned))
            });
        compare_value(
            &json!({"killedBy":killer,"lastHit":p.credit.last_hit.map(|(id,at)|json!({"by":label(id),"at":at})),"gv":{"kills":p.credit.gv_parts.kills,"mobs":p.credit.gv_parts.mobs,"bounty":p.credit.gv_parts.bounty,"quest":p.credit.gv_parts.quest},"resolved":p.resolved}),
            &json!({"killedBy":r["killedBy"],"lastHit":r["lastHit"],"gv":r["gv"],"resolved":r["resolved"]}),
            &format!("{name}/tick{}/attribution", s.tick()),
        );
        let actual = json!({"x":p.body.x,"y":p.body.y,"facing":p.body.facing,"hp":p.vitals.hp,"maxHp":p.vitals.max_hp,"effects":p.statuses.effects,"wishReadyAt":p.stocks.wish_ready_at,"qReadyAt":p.stocks.q_ready_at,"eReadyAt":p.stocks.e_ready_at,"wishFullAt":p.stocks.wish_full_at,"moveSeq":p.motion.move_seq,"displaceSeq":p.motion.displace_seq,"cast":p.statuses.cast.map(cast),"statuses":statuses(p),"wishCast":p.card_runtime.and_then(|c|c.wish_cast).map(|c|json!({"at":c.at,"cooldownMs":c.cooldown_ms}))});
        let mut expected = json!({});
        for k in [
            "x",
            "y",
            "facing",
            "hp",
            "maxHp",
            "effects",
            "wishReadyAt",
            "qReadyAt",
            "eReadyAt",
            "moveSeq",
            "displaceSeq",
        ] {
            expected[k] = e[k].clone();
        }
        expected["wishFullAt"] = e["extra"]["wishFullAt"].clone();
        expected["cast"] = r["cast"].clone();
        expected["statuses"] = r["statuses"].clone();
        expected["wishCast"] = r["cards"]["wishCast"].clone();
        compare_value(
            &actual,
            &expected,
            &format!("{name}/tick{}/{}", s.tick(), p.id.0),
        );
    }
    let mobs = frame["public"]["mobs"].as_array().unwrap();
    assert_eq!(s.w.mobs.len(), mobs.len(), "{name}/born roster size");
    for (m, expected) in s.w.mobs.iter().zip(mobs) {
        let p = &m.core;
        let e = &expected["state"];
        let r = frame["private"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == expected["id"])
            .unwrap();
        super::motion::compare_motion(p, r, e, &format!("{name}/tick{}/{}", s.tick(), label(p.id)));
        assert_eq!(
            label(p.id),
            expected["id"].as_str().unwrap(),
            "source-born identity"
        );
        let dummy = m.kind == crate::mob_runtime::MobKind::Dummy;
        let actual = json!({"x":p.body.x,"y":p.body.y,"facing":p.body.facing,"hp":p.vitals.hp,"maxHp":p.vitals.max_hp,"effects":p.statuses.effects,"displaceSeq":p.motion.displace_seq,"status":format!("{:?}",m.status).to_lowercase(),"faction":if dummy { "" } else { p.vitals.faction.as_str() },"type":m.mob_type.map_or("", |t|t.as_str()),"camp":if dummy { 0 } else { m.camp+1 },"home":if dummy { V::Null } else { json!(m.home) },"homeFacing":if dummy { V::Null } else { json!(m.home_facing) },"cast":p.statuses.cast.map(cast),"statuses":statuses(p)});
        let mut expected = json!({});
        for key in [
            "x",
            "y",
            "facing",
            "hp",
            "maxHp",
            "effects",
            "displaceSeq",
            "status",
            "faction",
            "type",
            "camp",
        ] {
            expected[key] = e[key].clone();
        }
        expected["cast"] = r["cast"].clone();
        expected["statuses"] = r["statuses"].clone();
        expected["home"] = r["brain"]["home"].clone();
        expected["homeFacing"] = r["brain"]["homeFacing"].clone();
        compare_value(
            &actual,
            &expected,
            &format!("{name}/tick{}/{}", s.tick(), label(p.id)),
        );
    }
    let actual = match &s.w.abilities {
        None => V::Null,
        Some(a) => {
            let fields:Vec<_>=a.fields.iter().map(|f|{let key=format!("fld{}",f.id);let mut v=json!({"id":key,"kind":f.kind,"ability":f.ability,"owner":{"id":f.owner.id.map(label).unwrap_or_default(),"name":f.owner.name},"subject":f.subject.map(label),"x":f.x,"y":f.y,"x2":f.x2,"y2":f.y2,"r":f.r,"vx":f.vx,"vy":f.vy,"startedAt":f.started_at,"endsAt":f.ends_at});if let Some(ms)=f.exit_stun_ms{v["exitStunMs"]=json!(ms);}json!([key,v])}).collect();
            let dot:Vec<_>=a.dot.iter().map(|d|{let victim=label(d.victim);let by=d.by.map(label).unwrap_or_default();json!([format!("{victim}|{by}|{}",d.ability.as_str()),{"victim":victim,"by":by,"ability":d.ability,"amount":d.amount}])}).collect();
            let mut value = json!({"fields":fields,"dot":dot,"dotSince":a.dot_since});
            if let Some(at) = a.teleported_at {
                value["teleportedAt"] = json!(at);
            }
            value
        }
    };
    compare_value(
        &actual,
        &frame["private"]["abilities"],
        &format!("{name}/tick{}/abilities", s.tick()),
    );
}

pub(super) fn compare_events(s: &Sim, events: &[Event], case: &V) {
    let actual:Vec<V>=events.iter().filter_map(|event|match *event {
 Event::CastStarted{id,ability,ms,target,x,y,..}=>Some(json!({"kind":"cast","by":label(id),"ability":ability,"ms":ms,"target":target.map(label),"x":x,"y":y})),
 Event::CastEnded{id,ability,reason,..}=>Some(json!({"kind":"castEnd","by":label(id),"ability":ability,"reason":reason})),
 Event::CastLanded{id,ability,target,x,y,to,..}=>{let mut v=json!({"kind":"castLand","by":label(id),"ability":ability,"target":target.map(label),"x":x,"y":y});if let Some(to)=to{v["x2"]=json!(to.x);v["y2"]=json!(to.y);}Some(v)},
 Event::StatusApplied{id,kind,ms,by}=>Some(json!({"kind":"status","id":label(id),"status":kind,"ms":ms,"by":by.map(label).unwrap_or_default()})),
 Event::Death{id,x,y,by}=>Some(json!({"kind":"death","id":label(id),"x":x,"y":y,"by":by.map(label)})),
 Event::Heal{id,amount}=>Some(json!({"kind":"heal","id":label(id),"amount":amount})),
 Event::AbilityHit{victim,by,ability,amount}=>Some(json!({"kind":"hit","id":label(victim),"by":by.map(label),"amount":amount,"weapon":null,"ability":ability})),
 _=>None}).collect();
    let expected: Vec<_> = case["completeNonemptyEventTape"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["tick"] == s.tick() && t["betweenSteps"] != true)
        .flat_map(|t| t["events"].as_array().unwrap())
        .filter_map(|e| {
            let fx = &e["fx"];
            (matches!(
                fx["kind"].as_str(),
                Some("cast" | "castEnd" | "castLand" | "status" | "death" | "heal")
            ) || (fx["kind"] == "hit" && fx.get("ability").is_some()))
            .then(|| fx.clone())
        })
        .collect();
    compare_value(
        &json!(actual),
        &json!(expected),
        &format!("{}/tick{}/events", case["name"], s.tick()),
    );
}

pub(super) fn source_step(s: &mut Sim, case: &V) {
    #[cfg(feature = "trusted-status-probes")]
    {
        s.w.trace.1.records.clear();
        s.w.trace.1.invocations.clear();
        s.w.trace.1.after_weapons.clear();
    }
    let events = s.step();
    compare_events(s, &events, case);
    if case["input"]["profile"] == "rosterSignatures" {
        super::full_profile::complete_events(s, &events, case);
        #[cfg(feature = "trusted-status-probes")]
        super::full_profile::complete_hooks(s, case);
    }
    if case["input"]["lifecycleWitness"] == true || case["input"]["profile"] == "rosterSignatures" {
        super::player_lifecycle::compare_signature_events(s, &events, case);
    }
    #[cfg(feature = "trusted-status-probes")]
    {
        use crate::status_runtime::probe::HookRecord;
        let actual:Vec<_>=s.w.trace.1.records.iter().filter_map(|h|{
            let (p,ability,hook,reason)=match h {
                HookRecord::CastAccepted{actor,ability}=>(actor,*ability,"castAccepted",json!({"$undefined":true})),
                HookRecord::CastLanded{actor,ability}=>(actor,*ability,"castEnded",json!("landed")),
                HookRecord::CastEnded{actor,ability,reason}=>(actor,*ability,"castEnded",json!(reason)),
                _=>return None,
            };
            Some(json!({"hook":hook,"kind":"arguments","time":s.w.server_time,"tick":s.tick(),"actor":label(p.id),"ability":ability,"reason":reason,"wishReadyAt":p.stocks.wish_ready_at,"wishFullAt":p.stocks.wish_full_at,"cast":p.statuses.cast.map(cast)}))
        }).collect();
        let expected: Vec<_> = case["completeOrdinaryHookTape"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["tick"] == s.tick())
            .flat_map(|t| t["hooks"].as_array().unwrap())
            .filter(|h| {
                h["kind"] == "arguments"
                    && matches!(h["hook"].as_str(), Some("castAccepted" | "castEnded"))
            })
            .cloned()
            .collect();
        compare_value(
            &json!(actual),
            &json!(expected),
            &format!("{}/tick{}/cast hooks", case["name"], s.tick()),
        );
        // The staggered arguments tape: the abilities chain fires on the weapon stagger at the legacy position.
        let stagger_actual: Vec<_> =
            s.w.trace
                .1
                .records
                .iter()
                .filter_map(|h| match h {
                    HookRecord::Staggered { .. } => Some(json!({
                        "hook": "staggered",
                        "installer": "abilities",
                        "time": s.w.server_time,
                        "tick": s.tick(),
                    })),
                    _ => None,
                })
                .collect();
        let stagger_expected: Vec<_> = case["completeOrdinaryHookTape"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["tick"] == s.tick())
            .flat_map(|t| t["hooks"].as_array().unwrap())
            .filter(|h| h["hook"] == "staggered")
            .cloned()
            .collect();
        compare_value(
            &json!(stagger_actual),
            &json!(stagger_expected),
            &format!("{}/tick{}/stagger hooks", case["name"], s.tick()),
        );
    }
}
