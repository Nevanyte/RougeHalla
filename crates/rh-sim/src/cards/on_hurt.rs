//! factions.onHurt: the owned cards' hpBelow trigger rows (Second Wind), fired from the Hurt hook.
//!
//! Source: `packages/server/src/sim/factions.ts` (`onHurt`) and the trigger runner. A `once` row fires the first time a
//! hurt leaves the fighter below its threshold this run and never again; any other row fires when the hurt crosses the
//! threshold. `Heal` actions with `ms` start a heal-over-time run; without `ms` they heal at once through the ordinary
//! funnel. The other trigger actions remain unported (no reachable hpBelow row uses them).
use crate::cards::{CardId, CardRow, TriggerAction, TriggerOn};
use crate::hooks::{HookArgs, Hx};
use crate::systems::heal::{self, Kind};

/// Fixed capacity for the owned hpBelow rows; a hurt takes no allocation.
const MAX_ROWS: usize = 8;

pub(crate) fn on_hurt(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Hurt { id, before, .. } = *args else {
        return;
    };
    let Some(i) = hx.w.idx(id) else { return };
    let Some(max_hp) = hx.w.player(id).map(|p| p.vitals.max_hp) else {
        return;
    };
    if !(max_hp > 0.) {
        return;
    }
    let hp = hx.w.player(id).unwrap().vitals.hp;
    let frac = hp / max_hp;
    let before_frac = before / max_hp;
    let mut rows = [(
        CardId::SlowBurn,
        0.,
        false,
        TriggerAction::Heal {
            share: 0.,
            ms: None,
            ignore_lockout: false,
        },
    ); MAX_ROWS];
    let mut n = 0;
    for card in hx.w.player(id).unwrap().build.cards() {
        for row in card.definition().rows {
            if let CardRow::Trigger(t) = row {
                if t.on == TriggerOn::HpBelow {
                    if let TriggerAction::Heal { .. } = t.action {
                        if n < rows.len() {
                            rows[n] = (card, t.arg, t.once, t.action);
                            n += 1;
                        }
                    }
                }
            }
        }
    }
    for &(card, arg, once, action) in &rows[..n] {
        if !(frac < arg) {
            continue;
        }
        if once {
            if hx.w.players[i].card_fired.contains(&card) {
                continue;
            }
            hx.w.players[i].card_fired.push(card);
        } else if before_frac < arg {
            continue;
        }
        if let TriggerAction::Heal {
            share,
            ms,
            ignore_lockout,
        } = action
        {
            let amount = share * max_hp;
            match ms {
                Some(ms) if ms > 0. => {
                    heal::start_over_time(hx.w, hx.ev, i, amount, ms, ignore_lockout)
                }
                _ => {
                    let kind = if ignore_lockout {
                        Kind::IgnoreLockout
                    } else {
                        Kind::Ordinary
                    };
                    heal::apply(hx.w, hx.ev, i, amount, kind);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    fn setup() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            CardId::SecondWind
        ));
        sim
    }

    #[test]
    fn second_wind_fires_once_below_its_threshold() {
        let mut sim = setup();
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let max_hp = sim.w.players[i].vitals.max_hp;
        sim.w.players[i].vitals.hp = max_hp * 0.2;
        let mut ev = Vec::new();
        let before = max_hp * 0.3;
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        on_hurt(
            &mut hx,
            &HookArgs::Hurt {
                id: PlayerId(1),
                amount: 10.,
                before,
            },
        );
        assert_eq!(hx.w.players[i].card_hots.len(), 1, "one heal-over-time run");
        assert!(hx.w.players[i].card_fired.contains(&CardId::SecondWind));
        // A later hurt below the threshold does not fire the once row again.
        hx.w.players[i].vitals.hp = max_hp * 0.2;
        on_hurt(
            &mut hx,
            &HookArgs::Hurt {
                id: PlayerId(1),
                amount: 10.,
                before: max_hp * 0.3,
            },
        );
        assert_eq!(hx.w.players[i].card_hots.len(), 1);
    }
}
