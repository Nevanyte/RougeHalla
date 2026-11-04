//! The lobby and the raid start (legacy step.ts `updateLobby`, arena.ts `startRaid`).

use crate::constants::*;
use crate::sim::{Event, Phase, Sample, Sim, Status, WeaponRt};

impl Sim {
    pub(crate) fn update_lobby(&mut self) {
        for p in &mut self.w.players {
            p.inputs.drain();
        }
        if self.w.players.is_empty() {
            return;
        }
        let humans = self.w.players.iter().filter(|p| !p.bot).count();
        if humans >= self.k.config.min_players {
            self.w.lobby_ends_at = self
                .w
                .lobby_ends_at
                .min(self.w.server_time + self.k.config.fill_seconds * 1000.0);
        }
        if humans >= MAX_PLAYERS || self.w.server_time >= self.w.lobby_ends_at {
            self.start_raid();
        }
    }

    pub(crate) fn start_raid(&mut self) {
        self.w.phase = Phase::Active;
        self.w.raid_started_at = self.w.server_time;
        let mut spawns = self.k.arena.spawns.clone();
        let mut i = spawns.len();
        while i > 1 {
            i -= 1;
            let j = (self.w.spawn_rng.next_f64() * (i + 1) as f64).floor() as usize;
            spawns.swap(i, j);
        }
        let now = self.w.server_time;
        for (k, p) in self.w.players.iter_mut().enumerate() {
            if !spawns.is_empty() {
                let s = spawns[k % spawns.len()];
                p.x = s.x;
                p.y = s.y;
            }
            p.status = Status::Alive;
            p.inputs.drain();
            p.history = vec![Sample {
                t: now,
                x: p.x,
                y: p.y,
            }];
            p.weapon = WeaponRt::default();
            p.ready_at = 0.0;
            p.draw_started_at = 0.0;
        }
        self.w.rt.started_with = self.w.players.len() as u32;
        self.w.rt.started_humans = self.w.players.iter().filter(|p| !p.bot).count();
        self.s.downed_this_tick.clear();
        self.w.rt.downs_between_ticks = 0;
        self.w.winner = None;
        self.emit(Event::RaidStarted);
    }
}
