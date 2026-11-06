//! Real constructor allocation and retained provenance for the MVP initial-loot profile.
use crate::{
    initial_world::{InitialContainer, InitialSink, Input, Kind},
    rng::Mulberry32,
    state::{Container, ContainerKind, World},
    statics::MatchStatic,
};
struct Sink<'a>(&'a mut World);
impl InitialSink for Sink<'_> {
    fn next_entity_id(&mut self) -> u32 {
        self.0.next_entity_id()
    }
    fn next_item_uid(&mut self) -> u64 {
        self.0.item_counter = self
            .0
            .item_counter
            .checked_add(1)
            .expect("item identity exhausted");
        self.0.item_counter
    }
    fn insert(&mut self, o: InitialContainer) {
        self.0.containers.push(Container {
            id: o.id,
            kind: match o.kind {
                Kind::Chest => ContainerKind::Chest,
                Kind::Ground => ContainerKind::Ground,
                Kind::Cannon => unreachable!("MVP excludes travel"),
            },
            at: o.at,
            opened: o.opened,
            items: o.items,
            born_tick: 0,
            stat_offer: o.stat_offer,
        });
    }
}
#[derive(Default)]
pub(crate) struct Replay {
    pub serial: u32,
    pub uid: u64,
    pub objects: Vec<InitialContainer>,
}
impl InitialSink for Replay {
    fn next_entity_id(&mut self) -> u32 {
        self.serial += 1;
        self.serial
    }
    fn next_item_uid(&mut self) -> u64 {
        self.uid += 1;
        self.uid
    }
    fn insert(&mut self, o: InitialContainer) {
        self.objects.push(o)
    }
}
fn input(k: &MatchStatic) -> Input<'_> {
    k.arena.map.layers().map_or_else(
        || Input::empty(&k.arena.map),
        |d| Input::from_layers(&k.arena.map, d.data()),
    )
}
pub(crate) fn initialize(k: &mut MatchStatic, w: &mut World) -> Result<(), &'static str> {
    if !k.config.initial_loot && k.config.mob_mode == crate::mob_runtime::MobMode::Off {
        return Ok(());
    }
    k.secrets.order_salt = w.spawn_rng.next_u32();
    if !k.config.initial_loot {
        let mut probe = Replay::default();
        crate::initial_world::build_initial(
            &input(k),
            false,
            &mut w.spawn_rng,
            k.secrets.reward_salt,
            &mut probe,
        )
        .map_err(|_| "invalid initial input")?;
        if !probe.objects.is_empty() {
            return Err("initial loot requires explicit MVP storage mode");
        }
    } else {
        let mut main = w.spawn_rng.clone();
        crate::initial_world::build_loot(
            &input(k),
            false,
            &mut main,
            k.secrets.reward_salt,
            &mut Sink(w),
        )
        .map_err(|_| "invalid initial loot input")?;
        w.spawn_rng = main;
        w.initial_birth_serial = w.entity_counter;
    }
    Ok(())
}
pub(crate) fn replay(k: &MatchStatic) -> Result<Replay, String> {
    let mut result = Replay::default();
    if k.config.initial_loot {
        let mut main = Mulberry32::new(k.secrets.spawn_seed);
        main.next_u32();
        crate::initial_world::build_loot(
            &input(k),
            false,
            &mut main,
            k.secrets.reward_salt,
            &mut result,
        )
        .map_err(|_| "initial loot replay refused")?;
    } else if k.config.mob_mode != crate::mob_runtime::MobMode::Off {
        let mut main = Mulberry32::new(k.secrets.spawn_seed);
        main.next_u32();
        crate::initial_world::build_initial(
            &input(k),
            false,
            &mut main,
            k.secrets.reward_salt,
            &mut result,
        )
        .map_err(|_| "initial constructor replay refused")?;
        if !result.objects.is_empty() {
            return Err("initial loot requires explicit MVP storage mode".into());
        }
    }
    Ok(result)
}
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    let expected = replay(k)?;
    if w.initial_birth_serial != expected.serial
        || w.entity_counter < w.initial_birth_serial
        || w.item_counter < expected.uid
    {
        return Err("initial constructor provenance mismatch".into());
    }
    if expected
        .objects
        .iter()
        .filter(|o| o.kind == Kind::Chest)
        .any(|o| w.containers.binary_search_by_key(&o.id, |c| c.id).is_err())
    {
        return Err("initial crate cannot disappear".into());
    }
    if w.reward_chests.iter().any(|c| c.id <= expected.serial)
        || w.projectiles.iter().any(|p| p.launch.id <= expected.serial)
        || w.abilities
            .as_ref()
            .is_some_and(|a| a.fields.iter().any(|f| f.id <= expected.serial))
    {
        return Err("later entity reuses initial allocation".into());
    }
    for c in &w.containers {
        if c.id == 0 {
            return Err("invalid initial entity id".into());
        }
        if c.id <= expected.serial {
            let original = &expected.objects[c.id as usize - 1];
            if c.at != original.at
                || c.stat_offer != original.stat_offer
                || c.born_tick != 0
                || (c.kind == ContainerKind::Chest && !c.opened && c.items != original.items)
                || c.items.iter().any(|item| !original.items.contains(item))
                || !matches!(
                    (c.kind, original.kind),
                    (ContainerKind::Chest, Kind::Chest) | (ContainerKind::Ground, Kind::Ground)
                )
            {
                return Err("initial object provenance mismatch".into());
            }
        } else if c.stat_offer {
            return Err("unallocated stat crate".into());
        }
    }
    Ok(())
}
