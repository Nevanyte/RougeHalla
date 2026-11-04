//! The authoritative state hash (determinism and live/headless equivalence checks).

use crate::events::Event;
use crate::sim::Sim;

impl Sim {
    /// FNV-1a 64 over the authoritative state (every field that can affect a later tick), for determinism and
    /// live/headless equivalence checks. Not a security hash.
    pub fn state_hash(&self) -> u64 {
        let mut h = Fnv64::new();
        h.u64(self.tick as u64);
        h.f64(self.server_time);
        h.u64(self.phase as u64);
        h.f64(self.lobby_ends_at);
        h.f64(self.raid_started_at);
        h.u64(self.spawn_rng.clone().next_u32() as u64);
        for p in &self.players {
            h.u64(p.id.0 as u64);
            h.u64(p.faction as u64);
            for v in [
                p.x,
                p.y,
                p.facing,
                p.hp,
                p.max_hp,
                p.barrier,
                p.ready_at,
                p.draw_started_at,
                p.hp_frac_at_tick_start,
            ] {
                h.f64(v);
            }
            h.u64(p.status as u64);
            h.u64(((p.kills as u64) << 32) | p.bounty as u64);
            h.u64(((p.gv as u64) << 32) | p.move_seq as u64);
            h.u64(p.resolved as u64 | (p.down.map(|o| o as u64 + 1).unwrap_or(0) << 1));
            for w in &p.path {
                h.f64(w.x);
                h.f64(w.y);
            }
            for s in &p.history {
                h.f64(s.t);
                h.f64(s.x);
                h.f64(s.y);
            }
            let w = &p.weapon;
            for v in [
                w.root_until,
                w.stagger_immune_until,
                w.pressed_at,
                w.buffered_until,
                w.aim,
                w.aim_at,
                w.lag_ms,
            ] {
                h.f64(v);
            }
            h.u64(w.held as u64);
            if let Some(a) = w.action {
                h.u64(a.kind as u64 + 1);
                h.u64(a.weapon as u64);
                for v in [
                    a.started_at,
                    a.lands_at,
                    a.a,
                    a.packet.raw,
                    a.packet.phys,
                    a.packet.magic,
                    a.packet.true_,
                ] {
                    h.f64(v);
                }
            }
            // Everything else that can decide a later outcome or a result.
            h.u64(
                p.bot as u64
                    | (p.slot as u64) << 1
                    | (p.weapon0.map(|w| w as u64 + 1).unwrap_or(0)) << 8
                    | (p.weapon1.map(|w| w as u64 + 1).unwrap_or(0)) << 16,
            );
            h.f64(p.immune_until);
            let g = p.gv_parts;
            h.u64(((g.kills as u64) << 32) | g.bounty as u64);
            h.u64(((g.mobs as u64) << 32) | g.quest as u64);
            h.u64(p.bot_kills as u64);
            match p.last_hit {
                Some((by, at)) => {
                    h.u64(by.0 as u64 + 1);
                    h.f64(at);
                }
                None => h.u64(0),
            }
            h.u64(p.damaged.len() as u64);
            for d in &p.damaged {
                h.u64(d.0 as u64);
            }
            h.u64(p.damaged_humans.len() as u64);
            for d in &p.damaged_humans {
                h.u64(d.0 as u64);
            }
            h.f64(p.dropped_at.unwrap_or(-1.0));
            h.str(p.killed_by.as_deref().unwrap_or(""));
            h.u64(p.killed_by_bot as u64);
            match p.announce {
                Some((at, sent)) => {
                    h.f64(at);
                    h.u64(sent as u64);
                }
                None => h.u64(u64::MAX),
            }
            let (tokens, at) = p.budget.state();
            h.f64(tokens);
            h.f64(at);
            h.u64(
                p.inputs.actions.len() as u64
                    | (p.inputs.mv.is_some() as u64) << 8
                    | (p.inputs.aim.is_some() as u64) << 9,
            );
            h.str(&p.profile);
        }
        h.u64(self.rt.started_with as u64);
        h.u64(self.rt.started_humans as u64);
        h.u64(self.rt.downs_between_ticks as u64);
        for d in &self.rt.downed_this_tick {
            h.u64(d.0 as u64);
        }
        h.u64(self.next_id as u64);
        h.u64(self.joined as u64);
        h.str(self.winner.as_deref().unwrap_or(""));
        // Results waiting between steps (a leave's MIA) are outcomes too.
        h.u64(self.events.len() as u64);
        for e in &self.events {
            if let Event::Resolved { id, result, .. } = e {
                h.u64(id.0 as u64);
                h.u64(result.outcome as u64);
                h.u64(result.place as u64);
                h.u64(result.gv.total as u64);
            }
        }
        h.finish()
    }
}

pub(crate) struct Fnv64(u64);
impl Fnv64 {
    pub(crate) fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
    pub(crate) fn u64(&mut self, v: u64) {
        for b in v.to_le_bytes() {
            self.0 ^= b as u64;
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    pub(crate) fn f64(&mut self, v: f64) {
        self.u64(v.to_bits());
    }
    pub(crate) fn str(&mut self, s: &str) {
        self.u64(s.len() as u64);
        for b in s.bytes() {
            self.u64(b as u64);
        }
    }
    pub(crate) fn finish(&self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use crate::arenas::practice_arena;
    use crate::content::FactionId;
    use crate::input::Command;
    use crate::math::Vec2;
    use crate::sim::{Placement, PlayerId, Secrets, Sim, SimConfig};

    fn sim() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(200.0, 200.0),
                hp: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(600.0, 600.0),
                hp: None,
            },
            Placement {
                profile: "c".into(),
                faction: FactionId::Frost,
                bot: false,
                at: Vec2::new(900.0, 300.0),
                hp: None,
            },
        ];
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &ps,
        )
    }

    #[test]
    fn the_state_hash_sees_every_outcome_field() {
        let base = sim();
        let h0 = base.state_hash();
        type Mutation = (&'static str, Box<dyn Fn(&mut Sim)>);
        let mutations: Vec<Mutation> = vec![
            ("gv parts", Box::new(|s| s.players[0].gv_parts.bounty = 7)),
            (
                "killed by",
                Box::new(|s| s.players[0].killed_by = Some("X".into())),
            ),
            (
                "damaged humans",
                Box::new(|s| s.players[0].damaged_humans.push(PlayerId(2))),
            ),
            (
                "last hit",
                Box::new(|s| s.players[0].last_hit = Some((PlayerId(2), 50.0))),
            ),
            (
                "dropped at",
                Box::new(|s| s.players[0].dropped_at = Some(50.0)),
            ),
            ("bot kills", Box::new(|s| s.players[0].bot_kills = 1)),
            (
                "budget",
                Box::new(|s| {
                    let _ = s.players[0]
                        .budget
                        .allow(&Command::Stop { seq: None }, 50.0);
                }),
            ),
            ("started humans", Box::new(|s| s.rt.started_humans = 1)),
            ("winner", Box::new(|s| s.winner = Some("A".into()))),
        ];
        for (name, m) in mutations {
            let mut s = base.clone();
            m(&mut s);
            assert_ne!(s.state_hash(), h0, "{name} must change the state hash");
        }
    }
}
