//! Applying a seat's queued inputs in the secret action order (legacy step.ts `applyInputs`).

use crate::input::{ActionCmd, MoveCmd};
use crate::math::Vec2;
use crate::pathfind::plan_path;
use crate::sim::{Sim, Status};
use crate::systems::weapons;

impl Sim {
    pub(crate) fn apply_inputs(&mut self, i: usize) {
        let d = self.w.players[i].inputs.drain();
        let n = d.actions.len();
        for k in 0..=n {
            if self.w.players[i].status != Status::Alive {
                return;
            }
            if k == d.move_before.min(n) {
                if let Some(mv) = d.mv {
                    self.apply_move(i, mv);
                }
            }
            if k == d.aim_before.min(n) {
                if let Some(a) = d.aim {
                    let now = self.w.server_time;
                    weapons::set_aim(&mut self.w.players[i], now, a);
                }
            }
            if let Some(cmd) = d.actions.get(k) {
                match *cmd {
                    ActionCmd::Attack { a, t } => {
                        let now = self.w.server_time;
                        weapons::handle_press(&mut self.w.players[i], now, a, t)
                    }
                    ActionCmd::Release { a, t } => {
                        let now = self.w.server_time;
                        weapons::handle_release(&mut self.w.players[i], now, a, t)
                    }
                }
            }
        }
    }

    pub(crate) fn apply_move(&mut self, i: usize, mv: MoveCmd) {
        // cancelLockedWindup / dropLock: no target lock in the slice.
        let from = self.w.players[i].pos();
        let (path, stop, seq) = match mv {
            MoveCmd::Stop { seq } => (Vec::new(), true, seq),
            MoveCmd::Move { x, y, seq } => (
                plan_path(&mut self.pf, &self.k.arena.map, from, Vec2::new(x, y)),
                false,
                seq,
            ),
        };
        let p = &mut self.w.players[i];
        if stop || !path.is_empty() {
            p.path = path;
        }
        if let Some(s) = seq {
            p.move_seq = s;
        }
    }
}
