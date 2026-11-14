//! Public immutable area facts. Runtime IDs/source snapshots never enter this projection.
//! A snapshot renderer needs no global field serial: sorting uses only already-redacted public facts.
use super::{AbilityId, Field, FieldKind};
use crate::{PlayerId, Sim, Vec2};
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldView {
    pub kind: FieldKind,
    pub ability: AbilityId,
    pub owner: Option<PlayerId>,
    pub subject: Option<PlayerId>,
    pub x: f64,
    pub y: f64,
    pub x2: f64,
    pub y2: f64,
    pub r: f64,
    pub vx: f64,
    pub vy: f64,
    pub started_at: f64,
    pub ends_at: f64,
    /// P-FROST-WALL-2: a standing wall's tiles (row-major indices into the arena map, ascending: the barrier row the
    /// sim blocks on); empty for every other kind, and then absent from the serialized form.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tiles: Vec<u32>,
}
impl FieldView {
    /// `barriers`: the standing walls' tile rows; a `Wall` field takes its own row's tiles (P-FROST-WALL-2). Every
    /// other kind gets an empty list, which allocates nothing.
    fn from_field(
        f: &Field,
        barriers: &crate::barriers::Barriers,
        seen: impl Fn(PlayerId) -> bool,
    ) -> Self {
        Self {
            kind: f.kind,
            ability: f.ability,
            owner: f.owner.id.filter(|id| seen(*id)),
            subject: f.subject.filter(|id| seen(*id)),
            x: f.x,
            y: f.y,
            x2: f.x2,
            y2: f.y2,
            r: f.r,
            vx: f.vx,
            vy: f.vy,
            started_at: f.started_at,
            ends_at: f.ends_at,
            tiles: if f.kind == FieldKind::Wall {
                barriers
                    .0
                    .iter()
                    .find(|b| b.field == f.id)
                    .map(|b| b.cells.clone())
                    .unwrap_or_default()
            } else {
                Vec::new()
            },
        }
    }
    pub(crate) fn cmp(&self, b: &Self) -> std::cmp::Ordering {
        (self.kind, self.ability, self.owner, self.subject)
            .cmp(&(b.kind, b.ability, b.owner, b.subject))
            .then_with(|| {
                let a = [
                    self.x,
                    self.y,
                    self.x2,
                    self.y2,
                    self.r,
                    self.vx,
                    self.vy,
                    self.started_at,
                    self.ends_at,
                ];
                let b = [
                    b.x,
                    b.y,
                    b.x2,
                    b.y2,
                    b.r,
                    b.vx,
                    b.vy,
                    b.started_at,
                    b.ends_at,
                ];
                a.into_iter()
                    .zip(b)
                    .map(|(a, b)| a.total_cmp(&b))
                    .find(|c| !c.is_eq())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    }
}
pub(crate) fn project(
    sim: &Sim,
    viewer: PlayerId,
    actors: &[crate::observe::ActorView],
    out: &mut Vec<FieldView>,
) {
    let Some(me) = sim.player(viewer) else {
        out.clear();
        return;
    };
    let Some(a) = &sim.w.abilities else {
        out.clear();
        return;
    };
    let no_rows = crate::barriers::Barriers::default();
    let mut n = 0;
    let map = sim.collision_view();
    let wards = crate::vision::WardSight::of_sim(sim);
    let visible = |p: Vec2| crate::vision::point_visible(map, me, p, sim.w.tick, wards);
    let w = sim.k.arena.map.w;
    let tile_centre = |i: u32| {
        let c = |t: u32| f64::from(t) * crate::constants::TILE + crate::constants::TILE / 2.;
        Vec2::new(c(i % w), c(i / w))
    };
    for f in &a.fields {
        let cells: &[u32] = if f.kind == FieldKind::Wall {
            a.barriers
                .0
                .iter()
                .find(|b| b.field == f.id)
                .map_or(&[], |b| &b.cells)
        } else {
            &[]
        };
        let shown = match f.kind {
            // P-FROST-WALL-NOWALL-1 (proposed DEV-036): a standing wall reaches its owner always, and any other viewer
            // who sees its first end `(x, y)` (the P-FROST-WALL-2 rule, legacy 78dd8bd4 FieldView.ts `update`) or any
            // one of its tiles; that viewer gets the whole wall. A viewer who sees neither gets nothing (C-OBS).
            FieldKind::Wall => {
                f.owner.id == Some(viewer)
                    || visible(Vec2::new(f.x, f.y))
                    || cells.iter().any(|&i| visible(tile_centre(i)))
            }
            FieldKind::Trail => visible(Vec2::new(f.x, f.y)) && visible(Vec2::new(f.x2, f.y2)),
            FieldKind::Zone | FieldKind::Cloud => visible(Vec2::new(f.x, f.y)),
        };
        if !shown {
            continue;
        }
        // The row is written over slot `n` of the caller's reusable list, keeping that slot's tile buffer, so a warmed
        // observation with a wall standing copies the tiles without allocating. `from_field` gets no barrier rows and so
        // builds an empty, unallocated tile list; the tiles are then copied into the kept buffer.
        let mut tiles = out
            .get_mut(n)
            .map(|v| std::mem::take(&mut v.tiles))
            .unwrap_or_default();
        tiles.clear();
        tiles.extend_from_slice(cells);
        let mut view = FieldView::from_field(f, &no_rows, |id| {
            id == viewer || actors.binary_search_by_key(&id, |a| a.id).is_ok()
        });
        view.tiles = tiles;
        match out.get_mut(n) {
            Some(slot) => *slot = view,
            None => out.push(view),
        }
        n += 1;
    }
    out.truncate(n);
    out.sort_unstable_by(FieldView::cmp);
}
pub(crate) fn public(sim: &Sim) -> Vec<FieldView> {
    let mut out: Vec<_> = sim
        .w
        .abilities
        .as_ref()
        .map(|a| {
            a.fields
                .iter()
                .map(|f| FieldView::from_field(f, &a.barriers, |id| sim.player(id).is_some()))
                .collect()
        })
        .unwrap_or_default();
    out.sort_unstable_by(FieldView::cmp);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        status_runtime::{AbilityRuntime, StatusSource},
        FactionId, Placement, Secrets, SimConfig,
    };
    fn world() -> Sim {
        let ps = [(100., 176.), (300., 176.), (330., 176.), (100., 500.)]
            .into_iter()
            .enumerate()
            .map(|(i, (x, y))| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(x, y),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>();
        let mut arena = crate::arenas::practice_arena();
        arena.spawns = vec![ps[0].at];
        Sim::reset_active(SimConfig::default(), arena, Secrets::from_seed(7), &ps)
    }
    fn field(id: u32, owner: Option<PlayerId>, subject: Option<PlayerId>) -> Field {
        Field {
            id,
            kind: FieldKind::Cloud,
            ability: AbilityId::Swarm,
            owner: StatusSource {
                id: owner,
                name: "private source label".into(),
                owner_id: Some(PlayerId(2)),
            },
            subject,
            x: 120.,
            y: 176.,
            x2: 140.,
            y2: 176.,
            r: 10.,
            vx: 0.,
            vy: 0.,
            started_at: 0.,
            ends_at: 5000.,
            exit_stun_ms: None,
        }
    }
    fn install(s: &mut Sim, fields: Vec<Field>) {
        let mut a = AbilityRuntime::new(s.w.server_time);
        a.fields = fields;
        s.w.abilities = Some(a)
    }
    #[test]
    fn hidden_allocations_and_identity_tie_order_cannot_change_public_fields() {
        let mut a = world();
        let mut b = world();
        let x = field(1, Some(PlayerId(2)), Some(PlayerId(3)));
        let y = field(2, Some(PlayerId(3)), Some(PlayerId(2)));
        install(&mut a, vec![x.clone(), y.clone()]);
        let mut hidden = field(700, Some(PlayerId(2)), None);
        hidden.x = 300.;
        hidden.y = 176.;
        let mut bx = y;
        bx.id = 901;
        let mut by = x;
        by.id = 1301;
        install(&mut b, vec![hidden, bx, by]);
        a.w.entity_counter = 2;
        b.w.entity_counter = 1301;
        let oa = crate::observe(&a, PlayerId(1), &[]);
        let ob = crate::observe(&b, PlayerId(1), &[]);
        assert_eq!(oa, ob);
        assert_eq!(oa.fields.len(), 2);
        assert_eq!(oa.fields[0], oa.fields[1]);
        assert!(oa
            .fields
            .iter()
            .all(|f| f.owner.is_none() && f.subject.is_none()));
        let encoded = serde_json::to_value(&oa.fields).unwrap();
        assert!(encoded
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f.get("id").is_none() && f.get("source").is_none()));
    }
    #[test]
    fn hidden_status_mirror_matches_absence_and_reveal_keeps_gameplay_clock_separate() {
        let mut hidden = world();
        hidden.w.players[1].body.x = 150.;
        hidden.w.players[1].body.y = 176.;
        let now = hidden.server_time();
        let apply = crate::status_runtime::StatusApply {
            kind: crate::status_runtime::StatusKind::Hidden,
            source: StatusSource {
                id: Some(PlayerId(2)),
                name: "private hidden source".into(),
                owner_id: None,
            },
            ms: 1000.,
            ability: None,
            tag: None,
            value: None,
            add: None,
            data: None,
        };
        crate::status_runtime::apply(&mut hidden.w.players[1].statuses, now, apply);
        let mut absent = hidden.clone();
        absent.w.players.remove(PlayerId(2));
        // A hidden player stays seated (the match-wide roster, ADR0026, names it); everything else equals its absence.
        let scene = |s: &crate::Sim| crate::Observation {
            roster: Vec::new(),
            ..crate::observe(s, PlayerId(1), &[])
        };
        assert_eq!(scene(&hidden), scene(&absent));
        crate::status_runtime::reveal(&mut hidden.w.players[1].statuses, now, now + 500.);
        hidden.w.server_time += crate::constants::TICK_MS;
        hidden.w.tick += 1;
        let viewer = hidden.player(PlayerId(1)).unwrap();
        let target = hidden.player(PlayerId(2)).unwrap();
        assert!(!crate::status_runtime::hidden(
            &target.statuses.instances,
            hidden.server_time()
        ));
        assert!(
            !crate::vision::actor_visible(
                &hidden.k.arena.map,
                viewer,
                target,
                hidden.tick(),
                crate::vision::WardSight::none(),
            ),
            "presentation still has the previous effects mirror"
        );
        assert!(
            crate::vision::gameplay_actor_visible(
                &hidden.k.arena.map,
                viewer,
                target,
                hidden.tick(),
                crate::vision::WardSight::none(),
            ),
            "terrain visibility does not override current targetability readers"
        );
        let now = hidden.server_time();
        hidden.w.players[1].statuses.refresh_effects(now);
        assert!(crate::observe(&hidden, PlayerId(1), &[])
            .visible
            .iter()
            .any(|p| p.id == PlayerId(2)));
    }
    #[test]
    fn actual_hidden_prop_and_projectile_allocations_do_not_renumber_visible_fields() {
        let mut a = world();
        let mut b = world();
        b.seed_weapon_container(
            crate::ContainerKind::Ground,
            Vec2::new(300., 176.),
            &[crate::WeaponId::Axe],
        )
        .unwrap();
        b.w.players[1].weapon.weapon0 = Some(crate::WeaponId::Bow);
        b.submit(
            PlayerId(2),
            crate::validate(crate::RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        for _ in 0..12 {
            a.step();
            b.step();
        }
        b.submit(
            PlayerId(2),
            crate::validate(crate::RawCommand::Release { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        a.step();
        b.step();
        assert!(
            b.w.entity_counter >= 2,
            "actual hidden container and shot allocate shared IDs"
        );
        let mut f = field(0, Some(PlayerId(2)), None);
        f.started_at = a.server_time();
        crate::systems::fields::add(&mut a.w, f.clone());
        crate::systems::fields::add(&mut b.w, f);
        assert_ne!(
            a.w.abilities.as_ref().unwrap().fields[0].id,
            b.w.abilities.as_ref().unwrap().fields[0].id
        );
        assert_eq!(
            crate::observe(&a, PlayerId(1), &[]),
            crate::observe(&b, PlayerId(1), &[])
        );
    }
    #[test]
    fn trail_requires_both_endpoints_and_hidden_fields_equal_absence() {
        let mut a = world();
        let b = world();
        let mut f = field(1, Some(PlayerId(2)), None);
        f.kind = FieldKind::Trail;
        f.ability = AbilityId::Blaze;
        f.x2 = 300.;
        f.y2 = 176.;
        install(&mut a, vec![f.clone()]);
        assert_eq!(
            crate::observe(&a, PlayerId(1), &[]),
            crate::observe(&b, PlayerId(1), &[])
        );
        f.x = 300.;
        f.x2 = 120.;
        install(&mut a, vec![f.clone()]);
        assert!(crate::observe(&a, PlayerId(1), &[]).fields.is_empty());
        f.x = 120.;
        install(&mut a, vec![f]);
        assert_eq!(crate::observe(&a, PlayerId(1), &[]).fields.len(), 1);
    }
    #[test]
    fn source_departure_keeps_trail_geometry_but_redacts_owner() {
        let mut s = world();
        let mut f = field(1, Some(PlayerId(4)), None);
        f.kind = FieldKind::Trail;
        f.ability = AbilityId::Blaze;
        install(&mut s, vec![f]);
        s.w.entity_counter = 1;
        let before = crate::observe(&s, PlayerId(1), &[]);
        assert_eq!(before.fields[0].owner, Some(PlayerId(4)));
        s.remove_player(PlayerId(4));
        let after = crate::observe(&s, PlayerId(1), &[]);
        assert_eq!(after.fields.len(), 1);
        assert_eq!(after.fields[0].owner, None);
        let mut expected = before.fields[0].clone();
        expected.owner = None;
        assert_eq!(expected, after.fields[0]);
    }
    #[test]
    fn only_visible_actor_effects_and_displacement_counters_are_exposed() {
        let a = world();
        let mut b = world();
        b.w.players[1].statuses.effects = 4095;
        b.w.players[1].motion.displace_seq = 255;
        assert_eq!(
            crate::observe(&a, PlayerId(1), &[]),
            crate::observe(&b, PlayerId(1), &[])
        );
        b.w.players[0].statuses.effects = 8;
        b.w.players[0].motion.displace_seq = 3;
        let seen = crate::observe(&b, PlayerId(1), &[]);
        assert_eq!(seen.me.unwrap().effects, 8);
        b.w.players[3].statuses.effects = 16;
        b.w.players[3].motion.displace_seq = 7;
        let seen = crate::observe(&b, PlayerId(1), &[]);
        let visible = seen.visible.iter().find(|p| p.id == PlayerId(4)).unwrap();
        assert_eq!((visible.effects, visible.displace_seq), (16, 7));
    }
}
