//! Read-only consumer of the admitted eight-case source corpus. Fixture actions are setup/inputs, never outcomes.
use super::*;
use crate::{FactionId, Phase, Secrets, SimConfig, WeaponId};
use serde_json::{json, Value as V};
fn number(v: &V) -> f64 {
    v.as_f64().expect("source number")
}
fn b36(mut n: u32) -> String {
    let mut bytes = Vec::new();
    loop {
        let d = (n % 36) as u8;
        bytes.push(if d < 10 { b'0' + d } else { b'a' + d - 10 });
        n /= 36;
        if n == 0 {
            break;
        }
    }
    bytes.reverse();
    String::from_utf8(bytes).unwrap()
}
fn actor(s: &Sim, id: PlayerId) -> String {
    match s.w.actor_origin(id).expect("real retained actor identity") {
        ActorOrigin::Player { join_ordinal } => format!("p{join_ordinal}"),
        origin => format!(
            "mob{}",
            b36(origin.birth_serial().expect("source8 has no zombies"))
        ),
    }
}
fn bind(s: &Sim, value: &str) -> PlayerId {
    s.w.actor_history
        .iter()
        .find(|a| actor(s, a.id) == value)
        .map(|a| a.id)
        .expect("captured source actor resolves by typed birth identity")
}
fn compare(actual: &V, expected: &V, at: &str) {
    match (actual, expected) {
        (V::Number(a), V::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!(
                (a - b).abs() <= 0.0000011 + 1e-12 * a.abs().max(b.abs()),
                "{at}: native {a} source {b}"
            );
        }
        (V::Array(a), V::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{at}: array length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{at}/{i}"));
            }
        }
        (V::Object(a), V::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{at}: keys"
            );
            for (k, a) in a {
                compare(a, &b[k], &format!("{at}/{k}"));
            }
        }
        _ => assert_eq!(actual, expected, "{at}"),
    }
}
fn construct(c: &V) -> Sim {
    let input = &c["input"];
    let cfg = &input["config"];
    assert_eq!(input["mapSeed"], 1);
    assert_eq!(input["mapAttempt"], 0);
    assert_eq!(input["decor"], false);
    assert_eq!(
        input["modules"],
        json!({"signatures":true,"walkHints":false})
    );
    let seed = input["seeds"]["random"].as_u64().unwrap() as u32;
    let config = SimConfig {
        min_players: cfg["minPlayers"].as_u64().unwrap() as usize,
        lobby_seconds: number(&cfg["lobbySeconds"]),
        fill_seconds: number(&cfg["fillSeconds"]),
        quests: true,
        initial_loot: true,
        consumables: true,
        // Source regen module is installed, but its omitted config switch defaults Off.
        regen: cfg["regen"].as_bool().unwrap_or(false),
        mob_mode: crate::mob_runtime::MobMode::Pve,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        abilities: crate::abilities::Mode::Full,
        hazards: crate::terrain::Mode::Map,
        wish_lock_ms: number(&cfg["wishLockSeconds"]) * 1000.,
        pvp_rules: cfg["pvpRules"].as_bool().unwrap(),
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: number(&cfg["planSeconds"]),
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: number(&cfg["patienceSeconds"]),
            patience_min_seconds: number(&cfg["patienceMinSeconds"]),
            sudden_death_seconds: number(&cfg["suddenDeathSeconds"]),
        }),
        ..Default::default()
    };
    let secrets = Secrets {
        order_salt: crate::rng::Mulberry32::new(seed).next_u32(),
        spawn_seed: seed,
        reward_salt: serde_json::from_value(input["seeds"]["rewardSalt"].clone()).unwrap(),
    };
    let mut s = Sim::try_new(config, live_tests::arena(), secrets)
        .expect("ordinary native Full constructor");
    for p in input["players"].as_array().unwrap() {
        s.add_player(
            p["name"].as_str().unwrap(),
            Some(FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            false,
        )
        .unwrap();
    }
    s
}
struct Run {
    sim: Sim,
    ledger: Vec<V>,
    events: Vec<crate::Event>,
    noncanonical: bool,
    steps: u32,
    helper: bool,
}
impl Run {
    fn advance(&mut self, tick: u32) {
        assert!(tick >= self.sim.tick());
        while self.sim.tick() < tick {
            let active = self.sim.phase() == Phase::Active;
            self.events.extend(self.sim.step());
            self.steps += 1;
            if active {
                for row in self.sim.damage_entries() {
                    if matches!(
                        self.sim.w.actor_origin(row.victim),
                        Some(ActorOrigin::QuestGiver { .. })
                    ) {
                        self.ledger.push(json!({"victim":actor(&self.sim,row.victim),
                            "by": row.by.map(|id| actor(&self.sim,id)).or_else(|| {
                                // The native typed environmental source stores its display name (Lava),
                                // while the source tap records its stable ID terrain:ember.
                                if row.source.as_ref() == Some(&self.sim.k.terrain_source) { Some("terrain:ember".to_owned()) }
                                else { row.source.as_ref().map(|s| s.name.to_string()) }
                            }),
                            "raw":row.raw,"weapon":row.weapon.map(|w| w.as_str()),"arena":row.arena,"sig":row.sig.map(|s| s.as_str())}));
                    }
                }
            }
            #[cfg(feature = "schedule-trace")]
            self.sim.clear_schedule_trace();
        }
    }
    fn action(&mut self, a: &V) {
        self.advance(a["tick"].as_u64().unwrap() as u32);
        match a["kind"].as_str().unwrap() {
            "place" => place(
                &mut self.sim,
                PlayerId(a["actor"].as_u64().unwrap() as u32 + 1),
                Vec2::new(number(&a["x"]), number(&a["y"])),
            ),
            "weapon" => {
                let p = self
                    .sim
                    .w
                    .players
                    .get_mut(PlayerId(a["actor"].as_u64().unwrap() as u32 + 1))
                    .unwrap();
                p.weapon.weapon0 = Some(WeaponId::parse(a["weapon"].as_str().unwrap()).unwrap());
                p.weapon.weapon1 = None;
                p.weapon.slot = 0;
            }
            "placeGiverOnEmber" => {
                // Exactly the labelled source setup: alter live x/y, not offer, home, facing or previous history.
                let id = bind(&self.sim, a["giverId"].as_str().unwrap());
                let m = self.sim.w.mobs.get_mut(id).unwrap();
                m.core.body.x = number(&a["x"]);
                m.core.body.y = number(&a["y"]);
                self.noncanonical = true;
            }
            "diagnosticAddStatusOnGiver" => {
                let id = bind(&self.sim, a["giverId"].as_str().unwrap());
                let before = self.sim.state_hash();
                let result = crate::systems::status::operations::apply(
                    &self.sim.k,
                    &mut self.sim.w,
                    &mut self.events,
                    id,
                    crate::status_runtime::StatusApply {
                        kind: crate::status_runtime::StatusKind::Stun,
                        source: crate::status_runtime::StatusSource {
                            id: Some(PlayerId(2)),
                            name: std::sync::Arc::from("name1"),
                            owner_id: None,
                        },
                        ms: 500.,
                        ability: None,
                        tag: None,
                        value: None,
                        add: None,
                        data: None,
                    },
                    false,
                );
                assert!(result.is_none());
                assert_eq!(a["returned"], "null");
                assert_eq!(self.sim.state_hash(), before);
                self.helper = true;
            }
            "input" => {
                let p = &a["payload"];
                let command = match a["type"].as_str().unwrap() {
                    "move" => RawCommand::Move {
                        x: number(&p["x"]),
                        y: number(&p["y"]),
                        seq: None,
                    },
                    "target" => RawCommand::Target {
                        id: bind(&self.sim, p["id"].as_str().unwrap()),
                    },
                    "attack" => RawCommand::Attack {
                        a: number(&p["a"]),
                        t: None,
                    },
                    "release" => RawCommand::Release {
                        a: number(&p["a"]),
                        t: None,
                    },
                    "cast" => RawCommand::Cast {
                        slot: crate::abilities::Slot::Wish,
                        x: number(&p["x"]),
                        y: number(&p["y"]),
                        id: Some(bind(&self.sim, p["id"].as_str().unwrap())),
                        t: None,
                        seq: None,
                    },
                    "questAccept" => RawCommand::QuestAccept {
                        quest_id: Some(
                            u32::from_str_radix(
                                p["quest"].as_str().unwrap().strip_prefix("quest").unwrap(),
                                36,
                            )
                            .unwrap(),
                        ),
                    },
                    "pickup" => RawCommand::Pickup {
                        container_id: u32::from_str_radix(
                            p["containerId"]
                                .as_str()
                                .unwrap()
                                .strip_prefix('c')
                                .unwrap(),
                            36,
                        )
                        .unwrap(),
                    },
                    kind => panic!("unconsumed source input {kind}"),
                };
                self.sim
                    .submit(
                        PlayerId(a["actor"].as_u64().unwrap() as u32 + 1),
                        validate(command).unwrap(),
                    )
                    .expect("source queued input admitted");
            }
            kind => panic!("unconsumed source action {kind}"),
        }
    }
    fn frame(&mut self, f: &V, name: &str) {
        self.advance(f["tick"].as_u64().unwrap() as u32);
        let s = &self.sim;
        let at = format!("{name}/{}", f["label"].as_str().unwrap());
        compare(&json!(s.w.server_time), &f["time"], &format!("{at}/time"));
        compare(
            &json!(format!("{:?}", s.phase()).to_lowercase()),
            &f["phase"],
            &format!("{at}/phase"),
        );
        compare(
            &json!(s.w.entity_counter),
            &f["idCounter"],
            &format!("{at}/idCounter"),
        );
        let givers=s.w.mobs.iter().filter(|m|m.kind==MobKind::QuestGiver).map(|m| {
            let c=&m.core; let sig=&c.signature; let hist=c.body.history.as_slice();
            json!({"id":actor(s,c.id),"kind":"quest","name":s.w.actor_label(c.id).unwrap(),"faction":c.faction_id().map_or("",|f|f.as_str()),
                "x":c.body.x,"y":c.body.y,"facing":c.body.facing,"hp":c.vitals.hp,"maxHp":c.vitals.max_hp,"status":format!("{:?}",m.status).to_lowercase(),
                "weapon0":c.weapon.weapon0.map_or("",|w|w.as_str()),"type":m.mob_type.map_or("",|t|t.as_str()),"camp":m.camp,
                "isQuestGiver":giver::is_giver(&s.w,c.id),"hostileFromP0":crate::systems::plague_zombies::hostile(&s.w,PlayerId(1),c.id),
                "runtime":{"historyLen":hist.len(),"historyLast":hist.last().map(|h|json!({"t":h.t,"x":h.x,"y":h.y})),"path":c.motion.path.len(),
                    "brain":m.brain.as_ref().map(|_| -> V { panic!("giver has a brain") }),"statuses":c.statuses.instances.iter().map(|st|json!({"kind":st.kind,"until":st.until,"source":st.source.id.map(|id|actor(s,id))})).collect::<Vec<_>>()},
                "signature":{"target":sig.target.map(|id|actor(s,id)),"tier":sig.mark.tier,"hpFrac":sig.hp_frac,"chill":sig.chill}})
        }).collect::<Vec<_>>();
        let source_givers = f["givers"].as_array().unwrap();
        assert_eq!(givers.len(), source_givers.len(), "{at}/giver count");
        for (actual, expected) in givers.iter().zip(source_givers) {
            // Source has a lazy rt.fighters map; native owns inline default Signature from birth.
            // Compare values when source has a row, and state the null-birth representation boundary explicitly.
            if expected["signature"].is_null() {
                let id = bind(s, actual["id"].as_str().unwrap());
                assert_eq!(
                    s.w.mobs.get(id).unwrap().core.signature,
                    crate::fighter::Signature::default()
                );
            } else {
                compare(
                    &actual["signature"],
                    &expected["signature"],
                    &format!("{at}/signature-values"),
                );
            }
            let mut actual_body = actual.clone();
            actual_body.as_object_mut().unwrap().remove("signature");
            let mut expected_body = expected.clone();
            expected_body.as_object_mut().unwrap().remove("signature");
            compare(
                &actual_body,
                &expected_body,
                &format!("{at}/giver-body-runtime"),
            );
        }
        let player_rows = s.w.players.iter().enumerate().map(|(i,p)| json!({
            "id":i,"faction":p.faction().as_str(),"x":p.body.x,"y":p.body.y,"facing":p.body.facing,
            "hp":p.vitals.hp,"maxHp":p.vitals.max_hp,"status":format!("{:?}",p.status).to_lowercase(),
            "weapon0":p.weapon.weapon0.map_or("",|w|w.as_str()),"slot":p.weapon.slot,"wishReadyAt":p.stocks.wish_ready_at,
            "done":p.down.is_some(),"resolved":p.resolved,
            "history":p.body.history.as_slice().iter().map(|h|json!({"t":h.t,"x":h.x,"y":h.y})).collect::<Vec<_>>(),
            "statuses":p.statuses.instances.iter().map(|st|json!({"kind":st.kind,"until":st.until,"source":st.source.id.map(|id|actor(s,id))})).collect::<Vec<_>>(),
            "cast":p.statuses.cast.map(|c|json!({"ability":c.ability.as_str(),"landsAt":c.lands_at})),
        })).collect::<Vec<_>>();
        compare(
            &json!(player_rows),
            &f["players"],
            &format!("{at}/actual-players-and-positive-recipients"),
        );
        let mut kinds = std::collections::BTreeMap::<&str, u32>::new();
        let mut players = Vec::new();
        let mut standing_givers = Vec::new();
        let mut count = 0;
        for i in 0..s.w.fighter_count() {
            let ix = crate::fighter::FighterIx::of_slot(i);
            if !s.w.standing(ix) {
                continue;
            }
            count += 1;
            let key = if s.w.is_player(ix) {
                players.push(actor(s, s.w.core(ix).id));
                "player"
            } else {
                let m = s.w.mobs.get(s.w.core(ix).id).unwrap();
                match m.kind {
                    MobKind::QuestGiver => {
                        standing_givers.push(actor(s, m.core.id));
                        "mob:quest"
                    }
                    MobKind::Regional if m.elite => "mob:elite",
                    MobKind::Regional => "mob:mob",
                    _ => panic!("source8 unexpected actor class"),
                }
            };
            *kinds.entry(key).or_default() += 1;
        }
        players.sort();
        standing_givers.sort();
        compare(
            &json!({"count":count,"kinds":kinds,"players":players,"givers":standing_givers}),
            &f["standing"],
            &format!("{at}/standing"),
        );
        let mut quests=s.w.quests.as_ref().map_or(Vec::new(),|q|q.offers.iter().map(|o| {let d=&catalog::DEFINITION[o.def as usize];json!({"id":format!("quest{}",b36(o.id)),"def":d.id,"kind":d.kind.as_str(),"name":d.name,"giver":d.giver,"status":format!("{:?}",o.status).to_lowercase(),"x":o.at.x,"y":o.at.y,"expiresAt":o.expires_at,"published":o.published,"npcId":o.giver.map(|id|actor(s,id)),"containers":o.containers.iter().map(|id|format!("c{}",b36(*id))).collect::<Vec<_>>()})}).collect::<Vec<_>>());
        quests.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        compare(&json!(quests), &f["quests"], &format!("{at}/quests"));
        compare(
            &json!(quests.iter().filter(|q| q["published"] == true).count()),
            &f["knownQuests"],
            &format!("{at}/known"),
        );
        compare(
            &json!(quests.iter().filter(|q| q["published"] == false).count()),
            &f["unknownQuests"],
            &format!("{at}/unknown"),
        );
        let source_giver_entry = |r: &&V| {
            r["victim"].as_str().is_some_and(|id| {
                s.w.actor_history.iter().any(|a| {
                    matches!(a.origin, ActorOrigin::QuestGiver { .. }) && actor(s, a.id) == id
                })
            })
        };
        let expected_ledger = f["diagnosticLedger"]
            .as_array()
            .unwrap()
            .iter()
            .filter(source_giver_entry)
            .cloned()
            .collect::<Vec<_>>();
        compare(
            &json!(self.ledger),
            &json!(expected_ledger),
            &format!("{at}/real-giver-preapply-ledger"),
        );
        self.ledger.clear();
        assert!(s.landed_hits().iter().all(|h| !matches!(
            s.w.actor_origin(h.victim),
            Some(ActorOrigin::QuestGiver { .. })
        )));
        for g in
            s.w.actor_history
                .iter()
                .filter(|a| matches!(a.origin, ActorOrigin::QuestGiver { .. }))
        {
            assert!(
                !s.w.terrain.damage.iter().any(|(id, _)| *id == g.id),
                "giver recorded applied arena damage"
            );
            assert!(!self.events.iter().any(|e|matches!(e,crate::Event::Death{id,..}|crate::Event::Hit{victim:id,..} if *id==g.id)),"giver emitted applied hit/death event");
        }
        compare(
            &json!({"ember":s.w.terrain.seconds[0],"bog":s.w.terrain.seconds[1],"ice":s.w.terrain.seconds[2],"light":s.w.terrain.seconds[3]}),
            &f["terrain"]["hazards"]["seconds"],
            &format!("{at}/actual-exposure"),
        );
        self.events.clear();
        if self.noncanonical {
            assert!(
                Sim::restore(serde_json::to_value(s).unwrap()).is_err(),
                "declared moved stationary giver must not acquire canonical provenance"
            );
        } else if s.w.quests.is_some() {
            let restored = restore(s);
            assert_eq!(restored.state_hash(), s.state_hash());
        }
    }
}
#[test]
fn all_eight_captured_source_giver_cases_use_real_inputs_and_runtime() {
    let corpus: V = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/quest-giver/source.json"
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(corpus["format"], "rh-quest-giver-source/1");
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 8);
    let mut names = std::collections::BTreeSet::new();
    for case in cases {
        let name = case["input"]["name"].as_str().unwrap();
        assert!(names.insert(name));
        let mut r = Run {
            sim: construct(case),
            ledger: Vec::new(),
            events: Vec::new(),
            noncanonical: false,
            steps: 0,
            helper: false,
        };
        let actions = case["actions"].as_array().unwrap();
        let mut ai = 0;
        for f in case["frames"].as_array().unwrap() {
            let n = f["actionCount"].as_u64().unwrap() as usize;
            assert!(n >= ai && n <= actions.len());
            while ai < n {
                assert_eq!(actions[ai]["seq"], ai);
                r.action(&actions[ai]);
                ai += 1;
            }
            r.frame(f, name);
        }
        while ai < actions.len() {
            assert_eq!(actions[ai]["seq"], ai);
            r.action(&actions[ai]);
            ai += 1;
        }
        assert_eq!(ai, actions.len());
        if name == "status-wish-on-giver" {
            assert!(r.helper);
        }
        if name == "expiry-retirement" {
            assert!(r.steps >= 6000);
        }
        eprintln!("source giver case passed: {name}, actual steps {}", r.steps);
    }
}

#[test]
#[ignore = "dhat runs alone: neutral_giver_warm_alloc --ignored --test-threads=1"]
fn neutral_giver_warm_alloc_uses_real_full_quest_constructor_and_restore() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/quest-giver/source.json"
    ))
    .unwrap();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "movement-through-giver")
        .unwrap();
    let mut s = construct(case);
    let mut events = Vec::with_capacity(4096);
    for _ in 0..80 {
        events.clear();
        s.step_into(&mut events);
    }
    assert!(s.mobs().iter().any(|m| m.kind == MobKind::QuestGiver));
    s = restore(&s);
    for _ in 0..40 {
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
