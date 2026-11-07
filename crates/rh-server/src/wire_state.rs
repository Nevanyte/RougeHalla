//! Reliable collection replacements built only from the already-filtered observation.
use rh_protocol::{
    EncodeError, PickupHandle, RewardChestHandle, ServerMsg, StateItem, WireArena, WireBuild,
    WireCamp, WireField, WireFocus, WireInventory, WirePlan, WirePlanOption, WireProjectile,
    WireProp, WirePropKind, WireProps, WireRewardChest, WireRewardId, WireRewardOption,
};
use rh_sim::{Inventory, Observation, PropKind};

#[derive(Default)]
pub struct CollectionPublisher {
    sent: bool,
    inventory: Option<WireInventory>,
    fields: Vec<WireField>,
    build: Option<WireBuild>,
    camps: Vec<WireCamp>,
    projectiles: Vec<WireProjectile>,
    plan: Option<WirePlan>,
    arena: Option<WireArena>,
    last_forced: Option<u32>,
}

pub struct PendingState {
    pub frame: Option<Vec<u8>>,
    items: Vec<StateItem>,
    tick: u32,
    forced: bool,
}

fn inventory(value: Inventory) -> WireInventory {
    WireInventory {
        active_slot: value.active_slot,
        slots: value.slots.map(|v| v.map(|w| w.code())),
        potion_small: value.potion_small,
        potions_healing: value.potions_healing,
    }
}

fn props(observation: &Observation) -> WireProps {
    let mut focus = None;
    let rows = observation
        .props
        .iter()
        .map(|row| {
            let handle = PickupHandle::new(row.handle.get()).expect("core nonzero handle");
            if row.cue.focused {
                focus = Some(WireFocus {
                    handle,
                    body_hint: row.cue.body_hint.map(|w| w.code()),
                });
            }
            WireProp {
                handle,
                x: row.cue.x,
                y: row.cue.y,
                kind: match &row.cue.kind {
                    PropKind::Ground(weapon) => WirePropKind::Ground(weapon.code()),
                    PropKind::Chest { open } => WirePropKind::Chest { open: *open },
                    PropKind::Body { label } => WirePropKind::Body {
                        label: label.to_string(),
                    },
                    PropKind::Cannon { ready_at } => WirePropKind::Cannon {
                        ready_at: *ready_at,
                    },
                },
            }
        })
        .collect();
    WireProps { rows, focus }
}

fn fields(observation: &Observation) -> Vec<WireField> {
    observation
        .fields
        .iter()
        .map(|f| WireField {
            kind: f.kind as u8,
            ability: f.ability as u8,
            owner: f.owner.map(|id| id.0),
            subject: f.subject.map(|id| id.0),
            x: f.x as f32,
            y: f.y as f32,
            x2: f.x2 as f32,
            y2: f.y2 as f32,
            r: f.r as f32,
            vx: f.vx as f32,
            vy: f.vy as f32,
            started_at: f.started_at,
            ends_at: f.ends_at,
        })
        .collect()
}

fn rewards(observation: &Observation) -> Result<Vec<WireRewardChest>, EncodeError> {
    observation
        .reward_chests
        .iter()
        .map(|c| {
            let x = c.at.x as f32;
            let y = c.at.y as f32;
            if !rh_protocol::quant::pos_in_range(x) || !rh_protocol::quant::pos_in_range(y) {
                return Err(EncodeError::BadValue("reward position"));
            }
            Ok(WireRewardChest {
                handle: RewardChestHandle::new(c.handle.wire())
                    .expect("core nonzero reward handle"),
                x: rh_protocol::quant::quantize_pos(x),
                y: rh_protocol::quant::quantize_pos(y),
                expires_at: c.expires_at,
                options: c
                    .options
                    .iter()
                    .map(|o| WireRewardOption {
                        id: match o.id {
                            rh_sim::reward_chests::OptionId::Card(id) => {
                                WireRewardId::Card(id.index() as u8)
                            }
                            rh_sim::reward_chests::OptionId::Boost(id) => {
                                WireRewardId::Boost(id.index() as u8)
                            }
                        },
                        taken: o.taken,
                        taken_by: o.taken_by.map(|id| id.0),
                    })
                    .collect(),
                picked: c.picked,
                can_choose: c.can_choose,
            })
        })
        .collect()
}

fn camps(observation: &Observation) -> Vec<WireCamp> {
    observation
        .camps
        .iter()
        .map(|c| WireCamp {
            mob_type: c.mob_type as u8,
            elite: c.elite.map(|id| id as u8),
            alive: c.alive,
            state: c.state,
            cleared_at: c.cleared_at,
            respawn_at: c.respawn_at,
        })
        .collect()
}

fn projectiles(observation: &Observation) -> Vec<WireProjectile> {
    observation
        .projectiles
        .iter()
        .map(|p| WireProjectile {
            kind: match p.kind {
                rh_sim::ProjectileKind::Arrow => 0,
                rh_sim::ProjectileKind::Ball => 1,
            },
            x: p.x,
            y: p.y,
            facing: p.facing,
            owner: p.owner.map(|id| id.0),
        })
        .collect()
}

/// The viewer's own source planning deal. The observation already resolved every option fact against the admitted map;
/// the wire only quantizes the two spawn positions like remote actors (never a private stream, index or path).
fn plan(observation: &Observation) -> Result<Option<WirePlan>, EncodeError> {
    let Some(view) = observation.plan.as_ref() else {
        return Ok(None);
    };
    let pick = |v: i8| (v >= 0).then_some(v as u8);
    let index = |v: i32| (v >= 0).then_some(v as u32);
    let mut options: [Option<WirePlanOption>; 2] = [None, None];
    for (slot, option) in view.options.iter().enumerate() {
        let Some(option) = option else { continue };
        let (x, y) = (option.at.x as f32, option.at.y as f32);
        if !rh_protocol::quant::pos_in_range(x) || !rh_protocol::quant::pos_in_range(y) {
            return Err(EncodeError::BadValue("plan position"));
        }
        let walk_seconds = option
            .walk_seconds
            .map(|v| v as f32)
            .filter(|v| v.is_finite() && *v >= 0.);
        options[slot] = Some(WirePlanOption {
            index: option.index,
            x: rh_protocol::quant::quantize_pos(x),
            y: rh_protocol::quant::quantize_pos(y),
            zone: option.zone.code(),
            walk_seconds,
        });
    }
    Ok(Some(WirePlan {
        ends_at: view.plan.ends_at,
        spawns: [index(view.plan.spawns[0]), index(view.plan.spawns[1])],
        taken: view.plan.taken,
        pick: pick(view.plan.pick),
        boons: view.plan.boons.clone(),
        boon: pick(view.plan.boon),
        ready: view.ready,
        options,
    }))
}

/// The public source arena lifecycle view (None for the Off profile, so the key is cleared after a lifecycle change).
fn arena(observation: &Observation) -> Option<WireArena> {
    observation.arena.as_ref().map(|a| WireArena {
        lobby_ends_at: a.lobby_ends_at,
        plan_ends_at: a.plan_ends_at,
        raid_started_at: a.raid_started_at,
        patience_ends_at: a.patience_ends_at,
        in_coliseum: a.in_coliseum,
        gates_locked: a.gates_locked,
        sudden_death_at: a.sudden_death_at,
        started_with: a.started_with,
    })
}

impl CollectionPublisher {
    pub fn reconnect(&mut self) {
        *self = Self::default();
    }

    /// No public counters or committed collection baselines change until enqueue succeeds.
    pub fn prepare(
        &self,
        observation: &Observation,
        props_changed: bool,
        rewards_changed: bool,
        resync_requested: bool,
    ) -> Result<PendingState, EncodeError> {
        let forced = resync_requested
            && self.last_forced.is_none_or(|tick| {
                observation.tick.saturating_sub(tick) >= rh_protocol::delta::MIN_FORCED_FULL_TICKS
            });
        let full = !self.sent || forced;
        let next_inventory = observation.inventory.map(inventory);
        let next_fields = fields(observation);
        let next_camps = camps(observation);
        let next_projectiles = projectiles(observation);
        let next_build = observation.build.map(|v| WireBuild {
            cards: v.cards.0,
            boosts: v.boosts,
        });
        let next_plan = plan(observation)?;
        let next_arena = arena(observation);
        let mut items = Vec::new();
        if full || next_inventory != self.inventory {
            items.push(StateItem::Inventory(next_inventory));
        }
        if full || props_changed {
            items.push(StateItem::Props(props(observation)));
        }
        if full || next_fields != self.fields {
            items.push(StateItem::Fields(next_fields));
        }
        if full || rewards_changed {
            items.push(StateItem::RewardChests(rewards(observation)?));
        }
        if full || next_build != self.build {
            items.push(StateItem::Build(next_build));
        }
        if full || next_camps != self.camps {
            items.push(StateItem::Camps(next_camps));
        }
        if full || next_projectiles != self.projectiles {
            items.push(StateItem::Projectiles(next_projectiles));
        }
        if full || next_plan != self.plan {
            items.push(StateItem::Plan(next_plan));
        }
        if full || next_arena != self.arena {
            items.push(StateItem::Arena(next_arena));
        }
        let (frame, items) = if items.is_empty() {
            (None, items)
        } else {
            let message = ServerMsg::State {
                tick: observation.tick,
                items,
            };
            let frame = message.try_encode()?;
            let ServerMsg::State { items, .. } = message else {
                unreachable!()
            };
            (Some(frame), items)
        };
        Ok(PendingState {
            frame,
            items,
            tick: observation.tick,
            forced,
        })
    }
}

impl PendingState {
    pub fn commit(self, publisher: &mut CollectionPublisher) -> bool {
        for item in self.items {
            match item {
                StateItem::Inventory(v) => publisher.inventory = v,
                StateItem::Fields(v) => publisher.fields = v,
                StateItem::Build(v) => publisher.build = v,
                StateItem::Camps(v) => publisher.camps = v,
                StateItem::Projectiles(v) => publisher.projectiles = v,
                StateItem::Plan(v) => publisher.plan = v,
                StateItem::Arena(v) => publisher.arena = v,
                StateItem::Props(_) | StateItem::RewardChests(_) => {}
            }
        }
        publisher.sent = true;
        if self.forced {
            publisher.last_forced = Some(self.tick);
        }
        self.forced
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_sim::{PlanView, PlanningView, SpawnOptionView, Vec2};

    #[test]
    fn collection_baselines_commit_after_enqueue_and_defer_flooded_resyncs() {
        let mut publisher = CollectionPublisher::default();
        let mut obs = Observation::default();
        let first = publisher.prepare(&obs, false, false, false).unwrap();
        assert!(first.frame.is_some());
        drop(first); // Failed enqueue must leave the first complete replacement pending.
        let first = publisher.prepare(&obs, false, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(first.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            items.iter().map(StateItem::key).collect::<Vec<_>>(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
        first.commit(&mut publisher);
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none());
        obs.tick = 1;
        assert!(publisher
            .prepare(&obs, false, false, true)
            .unwrap()
            .commit(&mut publisher));
        obs.tick = 2;
        assert!(publisher
            .prepare(&obs, false, false, true)
            .unwrap()
            .frame
            .is_none());
        obs.tick = 21;
        assert!(publisher
            .prepare(&obs, false, false, true)
            .unwrap()
            .frame
            .is_some());
        publisher.reconnect();
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_some());
    }
    #[test]
    fn actual_potions_camps_and_projectiles_commit_retain_clear_and_reconnect() {
        let mut publisher = CollectionPublisher::default();
        let mut obs = Observation {
            inventory: Some(Inventory {
                active_slot: 0,
                slots: [None, None],
                potion_small: 5,
                potions_healing: 3,
            }),
            ..Observation::default()
        };
        obs.camps.push(rh_sim::mob_runtime::CampRoster {
            mob_type: rh_sim::mob_catalog::MobTypeId::EmberImp,
            elite: Some(rh_sim::mob_catalog::MobTypeId::Archon),
            alive: 2,
            state: 0,
            cleared_at: 0.,
            respawn_at: 0.,
        });
        let flight = rh_sim::ProjectileView {
            kind: rh_sim::ProjectileKind::Ball,
            x: 800,
            y: 900,
            facing: 12345,
            owner: Some(rh_sim::PlayerId(0x8000_0201)),
        };
        obs.projectiles.extend([flight, flight]);
        let pending = publisher.prepare(&obs, false, false, false).unwrap();
        let first = pending.frame.clone().unwrap();
        let ServerMsg::State { items, .. } = ServerMsg::decode(&first).unwrap() else {
            panic!()
        };
        assert_eq!(
            items.iter().map(StateItem::key).collect::<Vec<_>>(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
        assert!(matches!(
            items[0],
            StateItem::Inventory(Some(WireInventory {
                potion_small: 5,
                potions_healing: 3,
                ..
            }))
        ));
        assert!(
            matches!(&items[5],StateItem::Camps(v) if v[0].mob_type==0 && v[0].elite==Some(29) && v[0].alive==2)
        );
        assert!(
            matches!(&items[6],StateItem::Projectiles(v) if v.len()==2 && v[0]==v[1] && v[0].kind==1 && v[0].owner==Some(0x8000_0201))
        );
        drop(pending);
        assert_eq!(
            publisher.prepare(&obs, false, false, false).unwrap().frame,
            Some(first)
        );
        publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .commit(&mut publisher);
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none());
        obs.tick = 1;
        obs.camps.clear();
        obs.projectiles.clear();
        let clear = publisher.prepare(&obs, false, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(clear.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            items,
            vec![StateItem::Camps(vec![]), StateItem::Projectiles(vec![])]
        );
        clear.commit(&mut publisher);
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none());
        publisher.reconnect();
        let full = publisher.prepare(&obs, false, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(full.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            items.iter().map(StateItem::key).collect::<Vec<_>>(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
    }

    #[test]
    fn malformed_authoritative_collections_refuse_before_baseline_changes() {
        let publisher = CollectionPublisher::default();
        let good = Observation::default();
        let expected = publisher.prepare(&good, false, false, false).unwrap().frame;
        let mut invalid = Observation::default();
        invalid.projectiles.push(rh_sim::ProjectileView {
            kind: rh_sim::ProjectileKind::Arrow,
            x: 0,
            y: 0,
            facing: 0,
            owner: Some(rh_sim::PlayerId(0)),
        });
        assert!(publisher.prepare(&invalid, false, false, false).is_err());
        assert_eq!(
            publisher.prepare(&good, false, false, false).unwrap().frame,
            expected
        );
    }

    /// The pinned-container capture's actual owner plan messages project field for field into wire State key 8. The deal
    /// values come from `parity/arena/source.json` (a captured legacy corpus, never regenerated from Rust); the resolved
    /// option facts cross-check the captured seed-1 spawn pool and the captured `spawnWalks` helper vectors.
    #[test]
    fn captured_plan_messages_project_field_for_field_into_state_key_8() {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/arena/source.json"
        ))
        .expect("arena capture");
        let source: serde_json::Value = serde_json::from_str(&text).unwrap();
        let pool = source["map"]["export"]["map"]["spawnPool"]
            .as_array()
            .unwrap();
        let walks = source["maths"]["spawnWalks"].as_array().unwrap();
        assert_eq!(pool.len(), walks.len());
        let mut checked = 0;
        let mut cleared = 0;
        let mut projected_first = None;
        for case in source["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            if !name.starts_with("planning-")
                || case["input"]["map"] == "no-pool"
                || case["input"].get("poolIndices").is_some()
            {
                continue;
            }
            for frame in case["frames"].as_array().unwrap() {
                let Some(owner_plans) = frame["ownerPlans"].as_array() else {
                    continue;
                };
                for owner in owner_plans {
                    let legacy = &owner["plan"];
                    if legacy.is_null() {
                        // Past planning the owner's key is cleared (the observation carries no plan).
                        assert!(plan(&Observation::default()).unwrap().is_none());
                        cleared += 1;
                        continue;
                    }
                    let ends_at = legacy["endsAt"].as_f64().unwrap();
                    let spawns: [i32; 2] =
                        std::array::from_fn(|i| legacy["spawns"][i].as_i64().unwrap() as i32);
                    let taken: [bool; 2] =
                        std::array::from_fn(|i| legacy["taken"][i].as_bool().unwrap());
                    let boons: Vec<String> = legacy["boons"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|b| b.as_str().unwrap().to_owned())
                        .collect();
                    let pick = legacy["pick"].as_i64().unwrap() as i8;
                    let boon = legacy["boon"].as_i64().unwrap() as i8;
                    let options: [Option<SpawnOptionView>; 2] = std::array::from_fn(|i| {
                        let index = spawns[i];
                        (index >= 0).then(|| {
                            let point = &pool[index as usize];
                            let distance = walks[index as usize].as_f64().unwrap();
                            SpawnOptionView {
                                index: index as u32,
                                at: Vec2::new(
                                    point["x"].as_f64().unwrap(),
                                    point["y"].as_f64().unwrap(),
                                ),
                                zone: serde_json::from_value(point["zone"].clone()).unwrap(),
                                walk_distance: Some(distance),
                                walk_seconds: Some(distance / rh_sim::constants::PLAYER_SPEED),
                            }
                        })
                    });
                    let observation = Observation {
                        plan: Some(PlanningView {
                            plan: PlanView {
                                ends_at,
                                spawns,
                                taken,
                                pick,
                                boons: boons.clone(),
                                boon,
                            },
                            options,
                            ready: false,
                        }),
                        ..Default::default()
                    };
                    let expected = WirePlan {
                        ends_at,
                        spawns: std::array::from_fn(|i| {
                            (spawns[i] >= 0).then_some(spawns[i] as u32)
                        }),
                        taken,
                        pick: (pick >= 0).then_some(pick as u8),
                        boons: boons.clone(),
                        boon: (boon >= 0).then_some(boon as u8),
                        ready: false,
                        options: std::array::from_fn(|i| {
                            let index = spawns[i];
                            (index >= 0).then(|| {
                                let index = index as usize;
                                let point = &pool[index];
                                let (x, y) = (
                                    point["x"].as_f64().unwrap() as f32,
                                    point["y"].as_f64().unwrap() as f32,
                                );
                                let zone: rh_sim::mapdata::Zone =
                                    serde_json::from_value(point["zone"].clone()).unwrap();
                                WirePlanOption {
                                    index: index as u32,
                                    x: rh_protocol::quant::quantize_pos(x),
                                    y: rh_protocol::quant::quantize_pos(y),
                                    zone: zone.code(),
                                    walk_seconds: Some(
                                        (walks[index].as_f64().unwrap()
                                            / rh_sim::constants::PLAYER_SPEED)
                                            as f32,
                                    ),
                                }
                            })
                        }),
                    };
                    let wire = plan(&observation)
                        .expect("the projection encodes")
                        .expect("the observation carries an owner plan");
                    assert_eq!(wire, expected, "{name}/{}", owner["id"]);
                    if projected_first.is_none() {
                        projected_first = Some(wire.clone());
                    }
                    // The complete-replacement State frame carries the same facts on the wire and round-trips strictly.
                    let message = ServerMsg::State {
                        tick: 5,
                        items: vec![StateItem::Plan(Some(wire.clone())), StateItem::Arena(None)],
                    };
                    let bytes = message.try_encode().unwrap();
                    assert_eq!(ServerMsg::decode(&bytes).unwrap(), message);
                    checked += 1;
                    if checked >= 30 {
                        break;
                    }
                }
                if checked >= 30 {
                    break;
                }
            }
            if checked >= 30 {
                break;
            }
        }
        assert!(
            checked >= 30,
            "captured owner plan messages project exactly"
        );
        assert!(cleared > 0, "a captured post-planning frame clears the key");
        // Mutation guard: the capture comparison is not vacuous. A changed pick or a shifted spawn must not compare equal.
        let first = projected_first.expect("a captured owner plan");
        let mut tampered = first.clone();
        tampered.pick = Some(u8::from(tampered.pick == Some(0)));
        assert_ne!(tampered, first);
        let mut shifted = first.clone();
        shifted.spawns[0] = Some(shifted.spawns[0].map_or(0, |v| v + 1));
        assert_ne!(shifted, first);
    }
}
