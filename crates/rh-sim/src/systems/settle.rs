//! Downs, settlement, the end of the run and the results (legacy arena.ts `downPlayer`, `settle`, `endRun`).

use crate::constants::*;
use crate::math::js_round;
use crate::sim::{
    Event, GvBreakdown, Outcome, Phase, PlayerId, RunResult, Sim, Status, WinBonusWhy,
};
use crate::systems::weapons::release_trigger;

impl Sim {
    pub(crate) fn down_player(&mut self, vi: usize, outcome: Outcome) {
        if !self.w.players[vi].standing() {
            return;
        }
        let now = self.w.server_time;
        let credited = if outcome == Outcome::Mia {
            let at = self.w.players[vi].dropped_at.unwrap_or(now);
            self.recent_rival(vi, at)
        } else {
            None
        };
        let v = &mut self.w.players[vi];
        v.down = Some(outcome);
        v.path.clear();
        release_trigger(v, now);
        v.status = if outcome == Outcome::Died {
            Status::Dead
        } else {
            Status::Mia
        };
        let victim_bot = v.bot;
        let id = v.id;
        if let Some(c) = credited {
            let bounty = self.w.players[vi].bounty;
            self.credit_kill(c, victim_bot, bounty);
        }
        if self.s.stepping {
            self.s.downed_this_tick.push(id);
            return;
        }
        self.w.rt.downs_between_ticks += 1;
        let alive = self.w.players.iter().filter(|p| p.standing()).count() as u32;
        let vi = self.idx(id).expect("still present");
        self.resolve(vi, outcome, alive + 1, 0, None);
    }

    pub(crate) fn settle(&mut self) {
        let downed = std::mem::take(&mut self.s.downed_this_tick);
        self.w.rt.downs_between_ticks = 0;
        let alive: Vec<PlayerId> = self
            .w
            .players
            .iter()
            .filter(|p| p.standing())
            .map(|p| p.id)
            .collect();
        let contested = self.w.rt.started_with >= 2;
        if alive.is_empty() || (contested && alive.len() == 1) {
            self.end_run(&alive, &downed, contested);
            return;
        }
        for id in downed {
            if let Some(i) = self.idx(id) {
                let outcome = self.w.players[i].down.expect("downed");
                self.resolve(i, outcome, alive.len() as u32 + 1, 0, None);
            }
        }
        // [patience timer, coliseum teleport, sudden death] -- not in the slice (docs/backlog P-ARENA-1)
    }

    pub(crate) fn end_run(&mut self, alive: &[PlayerId], downed: &[PlayerId], contested: bool) {
        let mut winners: Vec<PlayerId> = Vec::new();
        if alive.len() == 1 {
            winners = alive.to_vec();
        } else if contested && !downed.is_empty() {
            let best = downed
                .iter()
                .filter_map(|id| self.player(*id))
                .map(|p| p.hp_frac_at_tick_start)
                .fold(f64::NEG_INFINITY, f64::max);
            winners = downed
                .iter()
                .copied()
                .filter(|id| {
                    self.player(*id)
                        .is_some_and(|p| p.hp_frac_at_tick_start == best)
                })
                .collect();
        }
        let draw = winners.len() > 1;
        for id in downed {
            if !winners.contains(id) {
                if let Some(i) = self.idx(*id) {
                    let outcome = self.w.players[i].down.expect("downed");
                    self.resolve(i, outcome, winners.len() as u32 + 1, 0, None);
                }
            }
        }
        for id in &winners {
            let Some(i) = self.idx(*id) else { continue };
            if draw {
                self.resolve(i, Outcome::Draw, 1, 0, None);
                continue;
            }
            let why = if contested {
                self.withheld_why(i)
            } else {
                Some(WinBonusWhy::Starters)
            };
            self.resolve(
                i,
                Outcome::Won,
                1,
                if why.is_some() { 0 } else { GV_WIN },
                why,
            );
        }
        let winner = if !draw && winners.len() == 1 {
            Some(winners[0])
        } else {
            None
        };
        self.w.winner = winner
            .and_then(|id| self.player(id))
            .map(|p| p.name.clone());
        self.w.phase = Phase::Ended;
        self.emit(Event::Victory { id: winner, draw });
        self.emit(Event::RaidEnded);
    }

    pub(crate) fn withheld_why(&self, i: usize) -> Option<WinBonusWhy> {
        if self.w.rt.started_humans < WIN_BONUS_MIN_PLAYERS {
            return Some(WinBonusWhy::Starters);
        }
        if self.w.players[i].damaged_humans.len() < WIN_BONUS_MIN_OPPONENTS {
            return Some(WinBonusWhy::Opponents);
        }
        None
    }

    pub(crate) fn resolve(
        &mut self,
        i: usize,
        outcome: Outcome,
        place: u32,
        win: u32,
        why: Option<WinBonusWhy>,
    ) {
        let now = self.w.server_time;
        let started = self.w.raid_started_at;
        let players = self.w.rt.started_with;
        let p = &mut self.w.players[i];
        if p.resolved {
            return;
        }
        p.resolved = true;
        p.path.clear();
        let g = p.gv_parts;
        let gv = GvBreakdown {
            win,
            total: g.kills + g.mobs + g.bounty + g.quest + win,
            ..g
        };
        let result = RunResult {
            outcome,
            profile: p.profile.clone(),
            duration_sec: if started > 0.0 {
                js_round((now - started) / 1000.0) as u32
            } else {
                0
            },
            kills: p.kills - p.bot_kills,
            killed_by: if outcome == Outcome::Died {
                p.killed_by.clone()
            } else {
                None
            },
            killed_by_bot: outcome == Outcome::Died && p.killed_by_bot,
            place,
            players,
            gv,
            win_bonus_withheld: why.is_some(),
            win_bonus_why: why,
        };
        let (id, bot) = (p.id, p.bot);
        self.emit(Event::Resolved { id, result, bot });
    }
}
