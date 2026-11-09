// Included in frost::tests::sources. These are explicitly declared helper diagnostics from the new actual-source
// corpus: direct engagement/mode edits, constructors, lifecycle calls and clock jumps are not ordinary runtime or
// checkpoint/restore witnesses. In particular no captured post-state is ever installed into the native world.

fn source_helper_cx(sim: &mut Sim, f: impl FnOnce(&mut Cx)) {
    let mut events = Vec::new();
    f(&mut Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &sim.k,
        w: &mut sim.w,
        s: &mut sim.s,
        ev: &mut events,
        pf: &mut sim.pf,
    });
}

fn source_helper_ref(map: &BTreeMap<String, PlayerId>, value: &Value) -> PlayerId {
    fr_npc_ref(
        map,
        value.as_str().expect("declared source actor"),
        "helper input",
    )
    .expect("declared helper actor is bound")
}

fn source_helper_bind(map: &mut BTreeMap<String, PlayerId>, command: &Value, id: PlayerId) {
    let key = command["resultId"]
        .as_str()
        .expect("constructor result binding");
    assert!(
        !map.values().any(|held| *held == id),
        "constructor reused a bound native identity"
    );
    assert!(
        map.insert(key.to_owned(), id).is_none(),
        "duplicate source constructor binding"
    );
}

fn source_helper_command(sim: &mut Sim, command: &Value, map: &mut BTreeMap<String, PlayerId>) {
    match command["kind"].as_str().unwrap() {
        "helper-engagement" => {
            // This diagnostic producer clears old edges before declaring the next set, just like the recorder's
            // eleven-source helper. The other helpers start from neutral edges, so clearing is equivalent there.
            for slot in 0..sim.w.fighter_count() {
                let f = &mut sim
                    .w
                    .core_mut(crate::fighter::FighterIx::of_slot(slot))
                    .signature;
                f.target = None;
                f.engaged = false;
            }
            for pair in command["pairs"].as_array().unwrap() {
                let actor = source_helper_ref(map, &pair[0]);
                let target = source_helper_ref(map, &pair[1]);
                let ix = sim.w.fighter_idx(actor).expect("retained engagement actor");
                let f = &mut sim.w.core_mut(ix).signature;
                f.target = Some(target);
                f.engaged = true;
            }
        }
        "helper-return-mode" => {
            assert_eq!(command["mode"], "return");
            let id = source_helper_ref(map, &command["id"]);
            sim.w.mobs.get_mut(id).unwrap().regional_brain_mut().mode = crate::mob_runtime::BrainMode::Return;
        }
        "helper-npc-bonus-mirrors" => {
            let id = source_helper_ref(map, &command["id"]);
            assert!(
                sim.w.mobs.get(id).is_some(),
                "bonus diagnostic must apply to an NPC"
            );
            let ix = sim.w.fighter_idx(id).unwrap();
            // Source owns NPC mirrors in its private mod cache and populates them through recomputeMods. Native has
            // no corresponding arbitrary modifier-source producer; this declared encoded-mirror diagnostic uses the
            // Runtime serde seam solely to test that NPC source chill ignores positive player-only bonus mirrors.
            // This state is deliberately not offered to restore/admission and is not a normal gameplay/card claim.
            let mut runtime = serde_json::to_value(&sim.w.core(ix).modifiers).unwrap();
            runtime["wire"][0] = command["asMult"].clone();
            runtime["wire"][4] = command["shieldBonus"].clone();
            sim.w.core_mut(ix).modifiers = serde_json::from_value(runtime).unwrap();
        }
        "helper-killMob" => {
            assert!(command["entries"].as_array().unwrap().is_empty());
            assert!(command["amounts"].as_array().unwrap().is_empty());
            for actor in command["ids"].as_array().unwrap() {
                let id = source_helper_ref(map, actor);
                let ix = sim.w.fighter_idx(id).unwrap();
                let amount = sim.w.core(ix).vitals.hp;
                // Native exposes the regional death producer through hurt, not direct killMob. A source-less lethal
                // amount reaches the same no-killer death/camp lifecycle; lastHit/events/reward settlement are not
                // claimed equal to the source's direct empty-entry kill diagnostic.
                let mut events = Vec::new();
                crate::systems::mob_life::hurt(
                    &sim.k,
                    &mut sim.w,
                    &mut events,
                    ix,
                    &[crate::systems::ledger::Hit {
                        terrain: false,
                        amount,
                        by: None,
                        name: None,
                    }],
                );
            }
        }
        "helper-advance-clock-and-reap" => {
            sim.w.server_time += command["ms"].as_f64().unwrap();
            source_helper_cx(sim, crate::systems::mob_life::reap);
        }
        "helper-advance-clock-and-respawn" => {
            sim.w.server_time += command["ms"].as_f64().unwrap();
            source_helper_cx(sim, crate::systems::mob_life::respawn);
        }
        "helper-teleported-hook" => {
            let mut events = Vec::new();
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: Default::default(),
                    fx: None,
                    k: &sim.k,
                    w: &mut sim.w,
                    ev: &mut events,
                },
                crate::hooks::HookArgs::Teleported,
            );
        }
        "helper-addMob" => {
            let spec = &command["spec"];
            assert_eq!(spec["kind"], "dummy");
            let at = Vec2::new(
                spec["at"]["x"].as_f64().unwrap(),
                spec["at"]["y"].as_f64().unwrap(),
            );
            let id = crate::systems::mobs::place_dummy(&mut sim.w, at, 0., false);
            source_helper_bind(map, command, id);
        }
        "helper-placeMob" => {
            let spec = &command["spec"];
            let faction = FactionId::parse(spec["region"].as_str().unwrap()).unwrap();
            let ty = crate::mob_catalog::normal_types_of(faction)
                .next()
                .unwrap()
                .id;
            let at = Vec2::new(
                spec["at"]["x"].as_f64().unwrap(),
                spec["at"]["y"].as_f64().unwrap(),
            );
            // Unmapped constructor semantics are explicit: TS placeMob without a catalog type uses the regional grunt
            // defaults; native's available catalog constructor has practice provenance and its role HP. This adapter
            // proves only that the same faction/recipient kind participates in Frost. It does not compare HP, catalog,
            // camp provenance, weapon, runtime AI or restore admission for these three synthetic recipient births.
            let id = crate::systems::mobs::place_practice_mob(&mut sim.w, ty, false, 101, at, 0.);
            source_helper_bind(map, command, id);
        }
        "helper-raiseOrGrowZombie" => {
            let owner = source_helper_ref(map, &command["owner"]);
            crate::systems::plague_zombies::raise_or_grow(&sim.k, &mut sim.w, owner);
            let id = crate::systems::plague_zombies::zombie_of(&sim.w, owner).unwrap();
            source_helper_bind(map, command, id);
        }
        other => panic!("unsupported declared source helper input {other}"),
    }
}

fn source_helper_frost_rows(sim: &Sim, output: &Value, map: &BTreeMap<String, PlayerId>) {
    // Source retains historical signature rows after corpse reaping. Keep the bindings as provenance, but compare only
    // rows whose actor is currently retained; do not invent an actor or reconstruct historical cached membership.
    let mut retained = output.clone();
    retained["signatures"]
        .as_array_mut()
        .unwrap()
        .retain(|row| {
            let id = source_helper_ref(map, &row[0]);
            sim.w.actor(id).is_some()
        });
    frost_rows(sim, &retained, map);
}

fn source_helper_camps(sim: &Sim, output: &Value) {
    let actual = &sim.w.mob_runtime.as_ref().unwrap().camps;
    let expected = output["camps"].as_array().unwrap();
    assert_eq!(actual.len(), expected.len());
    for (a, e) in actual.iter().zip(expected) {
        assert_eq!(u64::from(a.state), e["state"].as_u64().unwrap());
        assert_eq!(u64::from(a.alive), e["alive"].as_u64().unwrap());
        fr_npc_close(
            a.cleared_at,
            e["clearedAt"].as_f64().unwrap(),
            "helper camp clearedAt",
        )
        .unwrap();
        fr_npc_close(
            a.respawn_at,
            e["respawnAt"].as_f64().unwrap(),
            "helper camp respawnAt",
        )
        .unwrap();
    }
}

#[test]
fn frost_sources_declared_helpers_order_return_bonus_and_lifecycle() {
    let doc = corpus();
    let mut covered = BTreeSet::new();
    for case in doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["input"]["kind"] != "runtime")
    {
        let name = case["input"]["name"].as_str().unwrap();
        assert!(covered.insert(name.to_owned()));
        let mut sim = scene(case);
        let seats = sim.players().len();
        let mut map = fr_npc_bind_initial(&sim, case, seats).unwrap();
        let original_ids: BTreeSet<_> = sim.w.mobs.iter().map(|m| m.core.id).collect();
        let mut observed_wide = false;
        let mut observed_reaped = false;
        let mut observed_new_births = false;
        for frame in case["frames"].as_array().unwrap() {
            for command in frame["commands"].as_array().unwrap() {
                source_helper_command(&mut sim, command, &mut map);
            }
            prepare(&sim.k, &mut sim.w).unwrap();
            sim.s.reserve_actors(sim.w.fighter_count());
            // dt=0 source observations have no future cooldown/action work in these helpers. Native's fixed-50ms
            // kernel therefore has the same Frost tuples; no tick is advanced and no runtime/restore claim is made.
            after_damage(&mut sim.w);
            let output = &frame["output"];
            if name == "helper-eleven-ordered-sources-lifecycle" {
                fr_npc_bind_missing_mobs(&sim, output, seats, &mut map).unwrap();
            }
            source_helper_frost_rows(&sim, output, &map);
            if name == "helper-eleven-ordered-sources-lifecycle" {
                assert_eq!(sim.w.mobs.len(), output["mobs"].as_array().unwrap().len());
                source_helper_camps(&sim, output);
                for mob in output["mobs"].as_array().unwrap() {
                    let id = source_helper_ref(&map, &mob["id"]);
                    let actual = sim.w.mobs.get(id).unwrap();
                    fr_npc_close(
                        actual.core.vitals.hp,
                        mob["state"]["hp"].as_f64().unwrap(),
                        "helper lifecycle hp",
                    )
                    .unwrap();
                    assert_eq!(
                        actual.status == crate::state::Status::Alive,
                        mob["state"]["status"] == "alive"
                    );
                }
                observed_wide |= sim.w.players[0].signature.chillers.len() == 11;
                observed_reaped |= sim.w.mobs.is_empty();
                observed_new_births |= !sim.w.mobs.is_empty()
                    && sim
                        .w
                        .mobs
                        .iter()
                        .all(|m| !original_ids.contains(&m.core.id));
            }
            if name == "helper-npc-bonus-mirrors-stay-base" {
                let npc = source_helper_ref(&map, &output["diagnosticNpcMirrors"]["id"]);
                let ix = sim.w.fighter_idx(npc).unwrap();
                let encoded = serde_json::to_value(&sim.w.core(ix).modifiers).unwrap();
                assert_eq!(
                    encoded["wire"][0].as_f64(),
                    output["diagnosticNpcMirrors"]["raw"]["asMult"].as_f64()
                );
                assert_eq!(
                    encoded["wire"][4].as_f64(),
                    output["diagnosticNpcMirrors"]["raw"]["shieldBonus"].as_f64()
                );
            }
        }
        if name == "helper-eleven-ordered-sources-lifecycle" {
            assert!(observed_wide && observed_reaped && observed_new_births);
            assert!(sim
                .w
                .players
                .iter()
                .all(|p| p.signature.chillers.is_empty()));
        }
    }
    assert_eq!(
        covered,
        BTreeSet::from([
            "helper-npc-bonus-mirrors-stay-base".to_owned(),
            "helper-source-recipient-kinds".to_owned(),
            "helper-eleven-ordered-sources-lifecycle".to_owned(),
        ])
    );
}
