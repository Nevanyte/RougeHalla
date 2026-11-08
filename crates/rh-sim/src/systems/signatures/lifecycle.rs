//! Source base-player signature lifecycle and its strict checkpoint boundary.
use crate::constants::SIG_EXEC_BLOCKED;
use crate::hooks::{HookArgs, Hx};
use crate::state::World;

/// Source resetAll: private fight state resets, but teleport retains the heal lockout.
fn reset_all(hx: &mut Hx, keep_combat: bool) {
    hx.w.factions.dot.clear();
    hx.w.factions.dot_since = hx.w.server_time;
    if let Some(fx) = hx.fx.as_deref_mut() {
        fx.ops.push(crate::fx_report::Op::Reset(hx.ev.len()));
    }
    for p in hx.w.players.iter_mut() {
        let combat_at = if keep_combat {
            p.signature.combat_at
        } else {
            None
        };
        // Source clears only Mark-related public flags here; afterDamage replaces the others.
        let bits = p.signature.bits & !SIG_EXEC_BLOCKED;
        let mut ap_hits = std::mem::take(&mut p.signature.ap_hits);
        ap_hits.reset();
        p.signature = crate::fighter::Signature {
            ap_hits,
            combat_at,
            bits,
            ..Default::default()
        };
        if !keep_combat {
            p.credit.sentence = 0;
        }
    }
}
pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::RaidStarted {
        reset_all(hx, false);
    }
}
pub(crate) fn teleported(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::Teleported {
        reset_all(hx, true);
        // Base players have no trigger rows, fired keys or pending HoT producer. P-CARDS
        // must extend this ordered hook before those domains can be admitted.
    }
}

/// Bounded Source admission: only actual base-player owners, with exact known reset boundaries.
pub(crate) fn validate_source_lifecycle(
    k: &crate::statics::MatchStatic,
    w: &World,
) -> Result<(), String> {
    if k.config.faction_mode == crate::FactionMode::Off {
        return Ok(());
    }
    // Cached mirrors also have real base-weapon producers (Axe Shred), and quiet
    // status removal can leave them stale. The canonical modifier owner's
    // Runtime::valid checks folds and source cache bounds during checkpoint restore.
    if w.players
        .iter()
        .any(|p| p.build != Default::default() || p.farm != Default::default())
    {
        return Err("source faction lifecycle has no admitted card/farm producer".into());
    }
    let teleport_now = w.abilities.as_ref().and_then(|a| a.teleported_at) == Some(w.server_time);
    let raid_now = w.raid_started_at == w.server_time;
    for p in w.players.iter() {
        let f = &p.signature;
        if [f.combat_at, f.contact_at, f.reach_at]
            .into_iter()
            .flatten()
            .any(|t| t % crate::constants::TICK_MS != 0. || t <= w.raid_started_at)
        {
            return Err("source faction contact/combat clocks require actual active steps".into());
        }
        if teleport_now || raid_now {
            let mut expected = crate::fighter::Signature::default();
            if teleport_now {
                expected.combat_at = f.combat_at;
                expected.bits = f.bits & !SIG_EXEC_BLOCKED;
            }
            if *f != expected || (!teleport_now && p.credit.sentence != 0) {
                return Err("source faction reset boundary retained non-reset state".into());
            }
        }
    }
    if (teleport_now || raid_now)
        && (!w.factions.dot.is_empty() || w.factions.dot_since != w.server_time)
    {
        return Err("source faction reset boundary retained old damage window".into());
    }
    Ok(())
}
