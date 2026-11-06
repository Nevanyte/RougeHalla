//! Reliable collection replacements built only from the already-filtered observation.
use rh_protocol::{
    EncodeError, PickupHandle, ServerMsg, StateItem, WireField, WireFocus, WireInventory, WireProp,
    WirePropKind, WireProps,
};
use rh_sim::{Inventory, Observation, PropKind};

#[derive(Default)]
pub struct CollectionPublisher {
    sent: bool,
    inventory: Option<WireInventory>,
    fields: Vec<WireField>,
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
        // The current core has no potion acquisition. The minimal consumable owner supplies
        // these self-only facts when its actual storage/producer is integrated.
        potion_small: 0,
        potions_healing: 0,
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

impl CollectionPublisher {
    pub fn reconnect(&mut self) {
        *self = Self::default();
    }

    /// No public counters or committed collection baselines change until enqueue succeeds.
    pub fn prepare(
        &self,
        observation: &Observation,
        props_changed: bool,
        resync_requested: bool,
    ) -> Result<PendingState, EncodeError> {
        let forced = resync_requested
            && self.last_forced.is_none_or(|tick| {
                observation.tick.saturating_sub(tick) >= rh_protocol::delta::MIN_FORCED_FULL_TICKS
            });
        let full = !self.sent || forced;
        let next_inventory = observation.inventory.map(inventory);
        let next_fields = fields(observation);
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
        if full {
            // Explicit empty replacements until the actual card/chest observer is integrated.
            items.push(StateItem::RewardChests(Vec::new()));
            items.push(StateItem::Build(None));
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
                StateItem::Props(_) | StateItem::RewardChests(_) | StateItem::Build(_) => {}
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

    #[test]
    fn collection_baselines_commit_after_enqueue_and_defer_flooded_resyncs() {
        let mut publisher = CollectionPublisher::default();
        let mut obs = Observation::default();
        let first = publisher.prepare(&obs, false, false).unwrap();
        assert!(first.frame.is_some());
        drop(first); // Failed enqueue must leave the first complete replacement pending.
        let first = publisher.prepare(&obs, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(first.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(items.len(), 5);
        first.commit(&mut publisher);
        assert!(publisher
            .prepare(&obs, false, false)
            .unwrap()
            .frame
            .is_none());
        obs.tick = 1;
        assert!(publisher
            .prepare(&obs, false, true)
            .unwrap()
            .commit(&mut publisher));
        obs.tick = 2;
        assert!(publisher
            .prepare(&obs, false, true)
            .unwrap()
            .frame
            .is_none());
        obs.tick = 21;
        assert!(publisher
            .prepare(&obs, false, true)
            .unwrap()
            .frame
            .is_some());
        publisher.reconnect();
        assert!(publisher
            .prepare(&obs, false, false)
            .unwrap()
            .frame
            .is_some());
    }
}
