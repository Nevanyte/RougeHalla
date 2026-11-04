//! The lobby and the raid start (legacy step.ts `updateLobby`, arena.ts `startRaid`).

use crate::constants::*;
use crate::sim::{Event, Phase, Sample, Sim, Status, WeaponRt};

impl Sim {
    pub(crate) fn update_lobby(&mut self) {
        for p in &mut self.players {
            p.inputs.drain();
        }
        if self.players.is_empty() {
            return;
        }
        let humans = self.players.iter().filter(|p| !p.bot).count();
        if humans >= self.config.min_players {
            self.lobby_ends_at = self
                .lobby_ends_at
                .min(self.server_time + self.config.fill_seconds * 1000.0);
        }
        if humans >= MAX_PLAYERS || self.server_time >= self.lobby_ends_at {
            self.start_raid();
        }
    }

    pub(crate) fn start_raid(&mut self) {
        self.phase = Phase::Active;
        self.raid_started_at = self.server_time;
        let mut spawns = self.arena.spawns.clone();
        let mut i = spawns.len();
        while i > 1 {
            i -= 1;
            let j = (self.spawn_rng.next_f64() * (i + 1) as f64).floor() as usize;
            spawns.swap(i, j);
        }
        let now = self.server_time;
        for (k, p) in self.players.iter_mut().enumerate() {
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
        self.rt.started_with = self.players.len() as u32;
        self.rt.started_humans = self.players.iter().filter(|p| !p.bot).count();
        self.rt.downed_this_tick.clear();
        self.rt.downs_between_ticks = 0;
        self.winner = None;
        self.emit(Event::RaidStarted);
    }
}
