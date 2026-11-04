//! Applying a seat's queued inputs in the secret action order (legacy step.ts `applyInputs`).

use crate::input::{ActionCmd, MoveCmd};
use crate::math::Vec2;
use crate::pathfind::plan_path;
use crate::sim::{Sim, Status};

impl Sim {
    pub(crate) fn apply_inputs(&mut self, i: usize) {
        let d = self.players[i].inputs.drain();
        let n = d.actions.len();
        for k in 0..=n {
            if self.players[i].status != Status::Alive {
                return;
            }
            if k == d.move_before.min(n) {
                if let Some(mv) = d.mv {
                    self.apply_move(i, mv);
                }
            }
            if k == d.aim_before.min(n) {
                if let Some(a) = d.aim {
                    self.set_aim(i, a);
                }
            }
            if let Some(cmd) = d.actions.get(k) {
                match *cmd {
                    ActionCmd::Attack { a, t } => self.handle_press(i, a, t),
                    ActionCmd::Release { a, t } => self.handle_release(i, a, t),
                }
            }
        }
    }

    pub(crate) fn apply_move(&mut self, i: usize, mv: MoveCmd) {
        // cancelLockedWindup / dropLock: no target lock in the slice.
        let from = self.players[i].pos();
        let (path, stop, seq) = match mv {
            MoveCmd::Stop { seq } => (Vec::new(), true, seq),
            MoveCmd::Move { x, y, seq } => (
                plan_path(&mut self.pathfinder, &self.arena.map, from, Vec2::new(x, y)),
                false,
                seq,
            ),
        };
        let p = &mut self.players[i];
        if stop || !path.is_empty() {
            p.path = path;
        }
        if let Some(s) = seq {
            p.move_seq = s;
        }
    }
}
