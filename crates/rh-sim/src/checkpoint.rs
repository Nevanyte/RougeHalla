//! Checkpoints: Clone + serde of the whole [`Sim`]; the derived tables are rebuilt on restore.

use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::sim::Sim;
use std::sync::Arc;

impl Sim {
    /// Restores the derived tables after deserializing a checkpoint.
    pub fn after_restore(&mut self) {
        // A freshly deserialized arena is not shared, so this rebuilds in place (it clones only a shared one).
        Arc::make_mut(&mut self.k.arena).map.rebuild();
        self.s = TickScratch::default();
        self.pf = Pathfinder::default();
    }
}

#[cfg(test)]
mod tests {
    use crate::arenas::practice_arena;
    use crate::content::FactionId;
    use crate::math::Vec2;
    use crate::sim::{Event, Placement, PlayerId, Secrets, Sim, SimConfig};

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
    fn a_checkpoint_keeps_results_emitted_between_steps() {
        let mut a = sim();
        a.step();
        a.remove_player(PlayerId(3)); // a leave between steps: its MIA result waits for the next step
        let mut b: Sim = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        b.after_restore();
        assert_eq!(a.state_hash(), b.state_hash());
        let (ea, eb) = (a.step(), b.step());
        let resolved = |e: &Vec<Event>| {
            e.iter()
                .filter(|e| matches!(e, Event::Resolved { .. }))
                .count()
        };
        assert_eq!(resolved(&ea), 1);
        assert_eq!(
            resolved(&eb),
            1,
            "the restored sim still delivers the leave's result"
        );
        assert_eq!(a.state_hash(), b.state_hash());
    }
}
