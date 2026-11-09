//! Source Mark tax: a retained pass index and a separately timed public scalar cache.
//! Neither cache is an observation identity/capability; source actor labels are used only for private tie ordering.
use crate::{
    constants::{MARK_TAX_KEEP, MARK_TAX_RATE_CAP, MARK_TAX_THRESHOLD, SIG_TAXED},
    factions::{TaxBinding, TaxPercent},
    fighter::{FighterCore, FighterIx},
    state::World,
    statics::MatchStatic,
    PlayerId,
};

/// Own cached rows, before sources, AS_MULT_CAP or asPost. Ordinary recompute reads the old cache; the end-mods
/// conditional prepass can supply the newly folded rows. This borrowed value is not another canonical modifier owner.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct OwnAsRows {
    pub(crate) regular: f64,
    pub(crate) farm: f64,
}
impl OwnAsRows {
    fn adjusted(self, efficiency: f64) -> (f64, f64) {
        (
            if self.regular > 0. {
                self.regular * efficiency
            } else {
                self.regular
            },
            if self.farm > 0. {
                self.farm * efficiency
            } else {
                self.farm
            },
        )
    }
    pub(crate) fn uncapped(self, efficiency: f64) -> f64 {
        let (regular, farm) = self.adjusted(efficiency);
        (1. + regular + farm).max(0.)
    }
}

/// Growth/restore/clone preparation. Retained historical phase rows may outlive a currently present actor.
pub(crate) fn prepare(w: &mut World, next: &mut Vec<TaxBinding>, edge_budget: usize) {
    assert!(
        next.is_empty(),
        "Mark tax next bank is settled before preparation"
    );
    let count = edge_budget
        .max(w.factions.taxed.len())
        .max(w.factions.public_tax.len());
    if w.factions.taxed.capacity() < count {
        w.factions
            .taxed
            .reserve_exact(count.saturating_sub(w.factions.taxed.len()));
    }
    if w.factions.public_tax.capacity() < count {
        w.factions
            .public_tax
            .reserve_exact(count.saturating_sub(w.factions.public_tax.len()));
    }
    if next.capacity() < count {
        next.reserve_exact(count.saturating_sub(next.len()));
    }
}

fn source_key(w: &World, id: PlayerId) -> ([u8; 11], usize) {
    use crate::mob_runtime::ActorOrigin;
    let (prefix, mut value, radix): (&[u8], u32, u32) =
        match w.actor_origin(id).expect("known Mark source") {
            ActorOrigin::Player { join_ordinal } => (b"p", *join_ordinal, 10),
            ActorOrigin::Mob { birth_serial, .. } | ActorOrigin::Practice { birth_serial, .. } => {
                (b"mob", *birth_serial, 36)
            }
            _ => unreachable!("neutral/dummy/zombie never produces Mark"),
        };
    // A u32 has at most ten decimal digits; adding the player prefix needs eleven bytes. Mob base36 needs seven.
    let mut key = [0; 11];
    let mut start = key.len();
    loop {
        start -= 1;
        let d = (value % radix) as u8;
        key[start] = if d < 10 { b'0' + d } else { b'a' + d - 10 };
        value /= radix;
        if value == 0 {
            break;
        }
    }
    start -= prefix.len();
    key[start..start + prefix.len()].copy_from_slice(prefix);
    (key, start)
}
fn lexical(w: &World, a: PlayerId, b: PlayerId) -> std::cmp::Ordering {
    let (aa, start_a) = source_key(w, a);
    let (bb, start_b) = source_key(w, b);
    aa[start_a..].cmp(&bb[start_b..])
}

/// Build the *next* Map in actual fighter/member insertion order. Replacing a best owner never moves the member's row.
fn build_next(w: &World, next: &mut Vec<TaxBinding>) {
    assert!(next.is_empty(), "Mark tax next bank must be settled");
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        let owner = w.core(ix);
        let tier = owner.signature.mark.tier;
        if !w.standing(ix)
            || !super::source(w, ix)
            || tier < 2
            || owner
                .signature
                .target
                .and_then(|id| w.fighter_idx(id))
                .is_none_or(|t| !w.standing(t))
        {
            continue;
        }
        for member_slot in 0..w.fighter_count() {
            let victim = w.core(FighterIx::of_slot(member_slot)).id;
            if super::mark_tier_on(w, owner.id, victim) < 2 || !super::near(w, owner.id, victim) {
                continue;
            }
            if let Some(row) = next.iter_mut().find(|row| row.victim == victim) {
                let previous_tier = w
                    .actor(row.by)
                    .expect("next index owner is current")
                    .signature
                    .mark
                    .tier;
                if tier > previous_tier
                    || (tier == previous_tier && lexical(w, owner.id, row.by).is_lt())
                {
                    row.by = owner.id;
                }
            } else {
                assert!(
                    next.len() < next.capacity(),
                    "Mark tax birth preparation missing"
                );
                next.push(TaxBinding {
                    victim,
                    by: owner.id,
                });
            }
        }
    }
}

/// Install the complete map before refolds. Source changed-set order is old removals, then new additions; an owner
/// replacement with continued membership alone is deliberately not a recompute trigger.
pub(crate) fn rebuild(
    k: &MatchStatic,
    w: &mut World,
    next: &mut Vec<TaxBinding>,
    inputs: crate::status_runtime::stats::Inputs,
) {
    build_next(w, next);
    std::mem::swap(&mut w.factions.taxed, next);
    for old in next.iter() {
        if !w.factions.taxed.iter().any(|row| row.victim == old.victim) {
            if let Some(ix) = w.fighter_idx(old.victim) {
                crate::modifiers::recompute_with(k, w, ix, inputs);
            }
        }
    }
    for i in 0..w.factions.taxed.len() {
        let victim = w.factions.taxed[i].victim;
        if !next.iter().any(|row| row.victim == victim) {
            if let Some(ix) = w.fighter_idx(victim) {
                crate::modifiers::recompute_with(k, w, ix, inputs);
            }
        }
    }
    next.clear();
}

/// resetAll removes the index first, then immediately refolds every former member. The caller owns signature/DoT reset.
pub(crate) fn reset(k: &MatchStatic, w: &mut World, inputs: crate::status_runtime::stats::Inputs) {
    let mut next = std::mem::take(&mut w.factions.taxed);
    w.factions.public_tax.clear();
    for row in next.iter() {
        if let Some(ix) = w.fighter_idx(row.victim) {
            crate::modifiers::recompute_with(k, w, ix, inputs);
        }
    }
    for slot in 0..w.fighter_count() {
        w.core_mut(FighterIx::of_slot(slot)).signature.bits &= !SIG_TAXED;
    }
    next.clear();
    w.factions.taxed = next;
}

fn efficiency(w: &World, core: &FighterCore) -> f64 {
    if w.idx(core.id).is_some() && core.faction_id() == Some(crate::FactionId::Sentenced) {
        crate::modifiers::DEFINITION.mark_as_efficiency
    } else {
        1.
    }
}
fn sheet(w: &World, id: PlayerId) -> Option<crate::content::FactionSpec> {
    w.fighter_idx(id).and_then(|ix| w.faction_spec(ix))
}
pub(crate) fn taxed_rate(rate: f64) -> f64 {
    if rate <= MARK_TAX_THRESHOLD {
        rate
    } else {
        MARK_TAX_RATE_CAP.min(MARK_TAX_THRESHOLD + (rate - MARK_TAX_THRESHOLD) * MARK_TAX_KEEP)
    }
}
pub(crate) fn factor(w: &World, core: &FighterCore, rows: OwnAsRows) -> f64 {
    let Some(row) = w.factions.taxed.iter().find(|row| row.victim == core.id) else {
        return 1.;
    };
    let Some(marker) = w.actor(row.by) else {
        return 1.;
    };
    if marker.faction_id() != Some(crate::FactionId::Sentenced) || sheet(w, marker.id).is_none() {
        return 1.;
    }
    let Some(spec) = sheet(w, core.id) else {
        return 1.;
    };
    let raw = spec.rate * rows.uncapped(efficiency(w, core));
    if !(raw > 0.) {
        return 1.;
    }
    let taxed = taxed_rate(raw);
    if taxed < raw {
        taxed / raw
    } else {
        1.
    }
}
pub(crate) fn mod_source(
    w: &World,
    core: &FighterCore,
    inputs: crate::schedule::ModSourceInputs,
) -> Option<crate::schedule::ModContribution> {
    let factor = factor(w, core, inputs.own_as_rows);
    (factor < 1.).then_some(crate::schedule::ModContribution {
        as_mult: Some(factor),
        ..Default::default()
    })
}
pub(crate) fn cut(rows: OwnAsRows, efficiency: f64, factor: f64) -> f64 {
    if !(factor < 1.) {
        return 0.;
    }
    let (regular, farm) = rows.adjusted(efficiency);
    let regular = (1. + regular).max(0.);
    let before = crate::stat_fold::cap_as_mult(regular) + farm;
    let after = crate::stat_fold::cap_as_mult(regular * factor) + farm * factor;
    if before > 0. {
        (1. - after / before).max(0.)
    } else {
        0.
    }
}

/// Source syncVisuals phase only. The row accessor reads the current cached sums; observation never refolds or
/// re-derives this scalar after the later conditional/end-mods pass.
pub(crate) fn sync_public(w: &mut World, rows_of: impl Fn(&FighterCore) -> OwnAsRows) {
    w.factions.public_tax.clear();
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        let core = w.core(ix);
        let percent = if w.standing(ix) {
            let rows = rows_of(core);
            crate::math::js_round(cut(rows, efficiency(w, core), factor(w, core, rows)) * 100.)
                as u8
        } else {
            0
        };
        let victim = core.id;
        if percent > 0 {
            assert!(
                w.factions.public_tax.len() < w.factions.public_tax.capacity(),
                "Mark public-tax birth preparation missing"
            );
            w.factions.public_tax.push(TaxPercent { victim, percent });
            w.core_mut(ix).signature.bits |= SIG_TAXED;
        } else {
            w.core_mut(ix).signature.bits &= !SIG_TAXED;
        }
    }
}
pub(crate) fn public_percent(w: &World, id: PlayerId) -> u8 {
    w.factions
        .public_tax
        .iter()
        .find(|row| row.victim == id)
        .map_or(0, |row| row.percent)
}

fn historical_marker(w: &World, id: PlayerId) -> bool {
    use crate::mob_runtime::ActorOrigin;
    match w.actor_origin(id) {
        Some(ActorOrigin::Player { .. }) => true, // Retained player namespace; no invented historical faction field.
        Some(ActorOrigin::Mob { mob_type, .. } | ActorOrigin::Practice { mob_type, .. }) => {
            crate::mob_catalog::mob_type_by_id(mob_type.as_str())
                .is_some_and(|ty| ty.zone == crate::FactionId::Sentenced)
        }
        _ => false,
    }
}
/// Validate historical phase state, not an invented reconstruction of last pass's near/standing/Return graph.
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    let taxed = &w.factions.taxed;
    let public = &w.factions.public_tax;
    if (!k.config.faction_mode.sentenced() && (!taxed.is_empty() || !public.is_empty()))
        || taxed.len() > w.actor_history.len()
        || public.len() > w.actor_history.len()
    {
        return Err("invalid Mark tax cache domain".into());
    }
    for (i, row) in taxed.iter().enumerate() {
        if row.victim == row.by
            || !w.known_actor(row.victim)
            || !historical_marker(w, row.by)
            || taxed[..i].iter().any(|prior| prior.victim == row.victim)
        {
            return Err("invalid Mark tax binding".into());
        }
    }
    for (i, row) in public.iter().enumerate() {
        if !(1..=100).contains(&row.percent)
            || !w.known_actor(row.victim)
            || !taxed.iter().any(|binding| binding.victim == row.victim)
            || public[..i].iter().any(|prior| prior.victim == row.victim)
        {
            return Err("invalid Mark public tax".into());
        }
    }
    for slot in 0..w.fighter_count() {
        let core = w.core(FighterIx::of_slot(slot));
        if (core.signature.bits & SIG_TAXED != 0) != (public_percent(w, core.id) > 0) {
            return Err("Mark tax bit/public cache mismatch".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) fn record_phase(w: &World, phase: &'static str) {
    source_tests::record(w, phase);
}
