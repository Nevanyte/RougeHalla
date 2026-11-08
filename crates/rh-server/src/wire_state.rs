//! Reliable collection replacements built only from the already-filtered observation.
use rh_protocol::{
    EncodeError, PickupHandle, RewardChestHandle, ServerMsg, StateItem, WireBuild, WireCamp,
    WireField, WireFocus, WireInventory, WireProjectile, WireProp, WirePropKind, WireProps,
    WireRewardChest, WireRewardId, WireRewardOption,
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
                    // Kill-augment Trophy options are sim-complete but not yet on the wire: the protocol has no
                    // WireRewardId variant for them, and its bump/decoder work is coordinator-owned (the protocol-9
                    // spine). This is the single projection site a transport packet flips.
                    .filter(|o| !matches!(o.id, rh_sim::reward_chests::OptionId::Kill(_)))
                    .map(|o| WireRewardOption {
                        id: match o.id {
                            rh_sim::reward_chests::OptionId::Card(id) => {
                                WireRewardId::Card(id.index() as u8)
                            }
                            rh_sim::reward_chests::OptionId::Boost(id) => {
                                WireRewardId::Boost(id.index() as u8)
                            }
                            rh_sim::reward_chests::OptionId::Kill(_) => {
                                unreachable!("kill-augment options are filtered above")
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

    /// Lead decision (2026-11-07): kill-augment Trophy options are sim-complete (the headless/policy Choose path picks
    /// them by index; see kill_augments::tests::trophy_owner_refusal_and_pick_reproduce_the_source_witness) but are not
    /// yet on the wire. The projection omits them HERE, and only here, until the transport packet adds a WireRewardId
    /// variant and its protocol bump on the protocol-9 spine.
    #[test]
    fn kill_augment_trophy_options_stay_off_the_wire_until_the_transport_packet() {
        let mut obs = Observation::default();
        obs.reward_chests
            .push(rh_sim::reward_chests::RewardChestView {
                handle: rh_sim::reward_chests::RewardChestHandle::from_wire(7).unwrap(),
                at: rh_sim::Vec2::new(100., 100.),
                expires_at: 1000.,
                options: vec![
                    rh_sim::reward_chests::RewardOptionView {
                        id: rh_sim::reward_chests::OptionId::Kill(
                            rh_sim::kill_augments::KillAugment {
                                key: rh_sim::kill_augments::KillStatKey::Ad,
                                gain: 6.,
                            },
                        ),
                        taken: false,
                        taken_by: None,
                    },
                    rh_sim::reward_chests::RewardOptionView {
                        id: rh_sim::reward_chests::OptionId::Card(rh_sim::cards::CardId::ALL[0]),
                        taken: false,
                        taken_by: None,
                    },
                ],
                picked: false,
                can_choose: true,
            });
        let rows = rewards(&obs).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].options.len(),
            1,
            "the kill-augment id is filtered off the wire"
        );
        assert!(matches!(rows[0].options[0].id, WireRewardId::Card(0)));
    }
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
            [1, 2, 3, 4, 5, 6, 7]
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
            [1, 2, 3, 4, 5, 6, 7]
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
            [1, 2, 3, 4, 5, 6, 7]
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
}
