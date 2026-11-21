//! P-AUG-NATIVE-1a: the native augments (`CardId::NATIVE`, ids 80..=93): their hand-written definitions
//! (`table.rs`), the generic capped per-player state (`NativeCards`, the `native` field of `Build`) and the
//! `check_world` rules for it. Live world only (`SimConfig::augments = Rework`): a `Legacy` world holds none.
//!
//! The hooks (P-AUG-NATIVE-1b) and the batch tables read and write the slots. Since P-WIRE19-A (protocol 19) a reward
//! option carries native ids 80..=93, and since P-AUG-NATIVE-4 a Rework chest pool offers the tables' `POOL` rows.
//!
//! Serialized form (brief section 1.5): only the held cards, in native order, as
//! `[{"card","count","counter","meters","marks"}]`; `Build` writes it first and only when one is held, so a world holding
//! none writes and hashes exactly as before the field existed (`hash.rs`, fourth World exception).
use super::{CardDef, CardId, CardRow};
use crate::reward_chests::OptionId;
use crate::state::World;
use crate::statics::MatchStatic;

mod table;
use table::{NATIVE_DEFINITIONS, NATIVE_RULES};

// P-AUG-NATIVE-1b: the hook points, the own-only readouts and the three batch tables.
mod faction;
pub(crate) mod hooks;
mod readout;
mod weapon;
mod zone;
pub use readout::{readouts, Readout, ReadoutKind, Readouts, MAX_READOUTS};

#[cfg(test)]
mod exemplars_tests;
#[cfg(test)]
mod faction_tests;
#[cfg(test)]
mod hooks_tests;
#[cfg(test)]
mod walk_mirror_tests;
#[cfg(test)]
mod weapon_batch_tests;
#[cfg(test)]
mod wish_engine_tests;
#[cfg(test)]
mod wish_engine_view_tests;
#[cfg(test)]
mod zone_tests;

/// P-AUG-NATIVE-1b: every native card's chest pool membership and offer rule, from the three batch tables (weapon,
/// zone, faction), in native order. P-AUG-NATIVE-4: a `Rework` world's chest pool reads it (`Tuning::in_pool`).
pub fn pool_members() -> impl Iterator<Item = (CardId, crate::reward_chests::Offer)> {
    weapon::POOL
        .iter()
        .chain(zone::POOL)
        .chain(faction::POOL)
        .copied()
}

/// The readout sources of a native card, from the batch table that holds it (`None` when no table declares rows).
fn readout_sources(card: CardId) -> Option<&'static [readout::Source]> {
    weapon::readouts(card)
        .or_else(|| zone::readouts(card))
        .or_else(|| faction::readouts(card))
}

/// The native cards' share of a holder's outgoing damage sum (`modifiers::outgoing_damage`, under the same G1 ceiling as
/// the card rows): Marksman's Tally's and Trophy Hunter's counters. 0 for a build holding none (every build in a
/// non-`Rework` world).
pub(crate) fn outgoing_share(build: &super::Build) -> f64 {
    if build.native.is_empty() {
        return 0.;
    }
    weapon::outgoing_share(&build.native) + faction::outgoing_share(&build.native)
}

/// The flat stats the native counters add to a holder's stat fold, as farm rows (outside the card caps): armor
/// (Calluses, Glacier), AD (Executioner's Ledger) and AP (Stoked). All 0 for a build holding none.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct FoldStats {
    pub(crate) armor: f64,
    pub(crate) ad: f64,
    pub(crate) ap: f64,
}

/// The native counters' [`FoldStats`] of a build (the one seam per stat `modifiers::combined_farm_rows` reads).
pub(crate) fn fold_stats(build: &super::Build) -> FoldStats {
    if build.native.is_empty() {
        return FoldStats::default();
    }
    let (calluses, ad) = weapon::fold_stats(&build.native);
    let (glacier, ap) = faction::fold_stats(&build.native);
    FoldStats {
        armor: calluses + glacier,
        ad,
        ap,
    }
}

/// Does the build's native state change its stat fold (so a change to it needs a refold)?
pub(crate) fn feeds_fold(build: &super::Build) -> bool {
    fold_stats(build) != FoldStats::default()
}

/// The multiplier Eighth Strike gives a landed weapon hit of `by` that has `earlier` landed weapon hits of `by` before it
/// in the same victim pass (1 for a non-holder; one guard).
pub(crate) fn strike_mult(k: &MatchStatic, w: &World, by: crate::PlayerId, earlier: u32) -> f64 {
    if !hooks::holds_native(k, w, by) {
        return 1.;
    }
    w.player(by).map_or(1., |p| weapon::strike_mult(p, earlier))
}

/// Pathfinder's move speed share of a build (`modifiers::movement`); 0 for a build holding no native card.
pub(crate) fn move_speed_share(build: &super::Build) -> f64 {
    if build.native.is_empty() {
        return 0.;
    }
    zone::move_speed_share(&build.native)
}

/// Hazard Walker's `(resistance, immune)` to a hazard (0 ember, 1 bog, 2 ice); `(0, false)` for a non-holder.
pub(crate) fn hazard_guard(build: &super::Build, hazard: usize) -> (f64, bool) {
    if build.native.is_empty() {
        return (0., false);
    }
    zone::hazard_guard(&build.native, hazard)
}

/// P-AUG-NATIVE-3c: how a fighter meets the ice's slip acceleration (`terrain::effect(..).accel`). `Copy`, so the walk
/// reads it once and maps every substep's acceleration without borrowing the build.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum IceGrip {
    /// Not a Hazard Walker holder (every mob, every build in a non-`Rework` world): the raw acceleration, untouched.
    Raw,
    /// A Hazard Walker holder not immune to the ice: the slip time is scaled by this `1 - resist` (>= 0.4: the stack
    /// cap is 15), so the acceleration is divided by it.
    Resisted(f64),
    /// Ice-immune (mark bit 2): the ice is ground.
    Immune,
}

impl IceGrip {
    /// The acceleration this fighter meets where the raw slip acceleration is `accel` (0 stays 0).
    pub(crate) fn accel(self, accel: f64) -> f64 {
        match self {
            IceGrip::Raw => accel,
            _ if accel == 0. => accel,
            IceGrip::Resisted(slip) => accel / slip,
            IceGrip::Immune => 0.,
        }
    }
}

/// The [`IceGrip`] of a build: `Raw` for a build holding no native card (one guard).
pub(crate) fn ice_grip(build: &super::Build) -> IceGrip {
    if build.native.is_empty() {
        return IceGrip::Raw;
    }
    zone::ice_grip(&build.native)
}

/// The native cards' flat max hp term over `base_hp` (`modifiers::sync_max_hp`): Hazard Walker's stacks and Corpse
/// Hoarder's share.
pub(crate) fn flat_max_hp(build: &super::Build, base_hp: f64) -> f64 {
    if build.native.is_empty() {
        return 0.;
    }
    zone::flat_max_hp(&build.native, base_hp) + faction::flat_max_hp(&build.native, base_hp)
}

/// P-AUG-NATIVE-3b: Wish Engine's earned share of the Wish cooldown (its counter; 0 for a build not holding it). The
/// Wish multiplier every reader uses (the cast producer, the restore validator, the owner view) is the folded
/// `wish_cooldown_mult()` times `1 - share`.
pub(crate) fn wish_engine_share(build: &super::Build) -> f64 {
    if build.native.is_empty() {
        0.
    } else {
        zone::wish_engine_share(&build.native)
    }
}

/// Does the build hold Overflow (its barriers fade over `REWORK_OVERFLOW_FADE_MS`)?
pub(crate) fn holds_overflow(build: &super::Build) -> bool {
    !build.native.is_empty() && zone::holds_overflow(&build.native)
}

/// P-AUG-NATIVE-5: Marked Man's normal-kill stacks: `(kill_stacks x 1.5 with the carry, Some(next carry))` for a
/// holder, `(kill_stacks, None)` for a build not holding it (no slot is read). The caller (`mob_life::pay`) writes the
/// carry only when the grant pays.
pub(crate) fn marked_man_stacks(build: &super::Build, kill_stacks: u64) -> (u64, Option<f64>) {
    if build.native.is_empty() {
        (kill_stacks, None)
    } else {
        zone::marked_man_stacks(&build.native, kill_stacks)
    }
}

/// P-AUG-NATIVE-5: does the build hold Marked Man (its `Alive` holder is public on every minimap)?
pub(crate) fn holds_marked_man(build: &super::Build) -> bool {
    !build.native.is_empty() && zone::holds_marked_man(&build.native)
}

/// The bursts the ledger added to one victim's entries (`landed_burst`): at most one per holder, at most one holder per
/// seat. Fixed size, so the pass allocates nothing; a burst that does not fit is not added (and not spent).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Bursts {
    rows: [(crate::PlayerId, usize, f64); crate::constants::MAX_PLAYERS],
    len: usize,
}

impl Default for Bursts {
    fn default() -> Self {
        Self {
            rows: [(crate::PlayerId(0), 0, 0.); crate::constants::MAX_PLAYERS],
            len: 0,
        }
    }
}

impl Bursts {
    /// Has `by` already a burst on this victim?
    pub(crate) fn has_holder(&self, by: crate::PlayerId) -> bool {
        self.rows[..self.len].iter().any(|r| r.0 == by)
    }
    /// Records `by`'s burst on entry `j`; false when full (the burst is then not added).
    pub(crate) fn push(&mut self, by: crate::PlayerId, j: usize, extra: f64) -> bool {
        if self.len == self.rows.len() {
            return false;
        }
        self.rows[self.len] = (by, j, extra);
        self.len += 1;
        true
    }
    /// The burst added to entry `j` (0 for none).
    pub(crate) fn of(&self, j: usize) -> f64 {
        self.rows[..self.len]
            .iter()
            .find(|r| r.1 == j)
            .map_or(0., |r| r.2)
    }
}

/// What the native cards of `by` add to its next landed weapon hit after the victim's mitigation (Bastion's burst), read
/// by the ledger; the hit that carries it reports it in `NativeEvent::HitCount { burst }`, which spends it. 0 for a
/// non-holder (one guard).
pub(crate) fn landed_burst(k: &MatchStatic, w: &World, by: crate::PlayerId) -> f64 {
    if !hooks::holds_native(k, w, by) {
        return 0.;
    }
    w.player(by).map_or(0., weapon::landed_burst)
}

/// Working meters per native card (stored damage, per-hazard seconds, a shield, a per-cast record).
pub const NATIVE_METERS: usize = 3;

/// A native card's caps: its counter, each meter (0 = unused, the value must be 0) and the bits its marks may hold.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NativeRule {
    pub counter_cap: f64,
    pub meter_caps: [f64; NATIVE_METERS],
    pub marks: u32,
}

/// One native card's per-player state. `counter` is its stacks in the card's own units, `meters` its working meters,
/// `marks` a bit set. A slot whose `count` is 0 is all zero (never written; whoever clears a card zeroes the slot).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NativeSlot {
    pub count: u8,
    pub counter: f64,
    pub meters: [f64; NATIVE_METERS],
    pub marks: u32,
}

/// Every native card's slot, in `CardId::NATIVE` order (fixed size: no allocation).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NativeCards([NativeSlot; 14]);

/// The position of a native id in `CardId::NATIVE` (`None` for the 80 catalog cards).
pub(crate) fn position(id: CardId) -> Option<usize> {
    id.index()
        .checked_sub(CardId::ALL.len())
        .filter(|i| *i < CardId::NATIVE.len())
}

/// Is this one of the native ids?
pub fn is_native(id: CardId) -> bool {
    position(id).is_some()
}

impl NativeCards {
    /// The slot of a native card (`None` for a catalog card).
    pub fn slot(&self, id: CardId) -> Option<&NativeSlot> {
        position(id).map(|i| &self.0[i])
    }
    pub(crate) fn slot_mut(&mut self, id: CardId) -> Option<&mut NativeSlot> {
        position(id).map(|i| &mut self.0[i])
    }
    /// The held native cards (count > 0), in native order.
    pub fn held(&self) -> impl Iterator<Item = (CardId, &NativeSlot)> + '_ {
        CardId::NATIVE
            .iter()
            .zip(&self.0)
            .filter(|(_, s)| s.count > 0)
            .map(|(id, s)| (*id, s))
    }
    /// Is the `j`th native card (`CardId::NATIVE[j]`) held? (`Build::cards`' cursor.)
    #[inline]
    pub(crate) fn held_at(&self, j: usize) -> bool {
        self.0[j].count > 0
    }
    /// Holds no native card (the serialized `Build` then has no `native` field).
    pub fn is_empty(&self) -> bool {
        self.0.iter().all(|s| s.count == 0)
    }
}

/// The serialized row of one held native card.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Row {
    card: CardId,
    count: u8,
    counter: f64,
    meters: [f64; NATIVE_METERS],
    marks: u32,
}

impl serde::Serialize for NativeCards {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = s.serialize_seq(Some(self.held().count()))?;
        for (card, slot) in self.held() {
            seq.serialize_element(&Row {
                card,
                count: slot.count,
                counter: slot.counter,
                meters: slot.meters,
                marks: slot.marks,
            })?;
        }
        seq.end()
    }
}

impl<'de> serde::Deserialize<'de> for NativeCards {
    /// Refuses the second spellings of a state: an empty list (none held is no field), a row with `count` 0 (not held is
    /// not written), a catalog card, and a card repeated or out of native order.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let rows = <Vec<Row>>::deserialize(d)?;
        if rows.is_empty() {
            return Err(D::Error::custom(
                "native rows: an empty list (no native card held is no field)",
            ));
        }
        let mut out = Self::default();
        let mut last: Option<usize> = None;
        for row in rows {
            let i = position(row.card).ok_or_else(|| {
                D::Error::custom(format!(
                    "native rows: {} is not a native card",
                    row.card.as_str()
                ))
            })?;
            if last.is_some_and(|l| i <= l) {
                return Err(D::Error::custom(
                    "native rows: a card repeated or out of native order",
                ));
            }
            if row.count == 0 {
                return Err(D::Error::custom(
                    "native rows: count 0 (a card not held is not written)",
                ));
            }
            last = Some(i);
            out.0[i] = NativeSlot {
                count: row.count,
                counter: row.counter,
                meters: row.meters,
                marks: row.marks,
            };
        }
        Ok(out)
    }
}

/// The caps of a native card (`None` for the 80 catalog cards).
pub fn rule(id: CardId) -> Option<&'static NativeRule> {
    position(id).map(|i| &NATIVE_RULES[i])
}

/// The definition of a native card (`CardId::definition` answers native ids from here).
pub(crate) fn definition(id: CardId) -> &'static CardDef {
    let i = position(id).expect("a native card id");
    &NATIVE_DEFINITIONS[i]
}

/// The largest Tank Engine (`TriggerAction::Fortify`) cap of a world's card table, every faction selection included:
/// the bound of `card_tank_hp` (legacy `cardHooks.ts:190-197`: `tankHp` only rises to `min(cap, ...)`).
fn tank_hp_cap(tuning: &crate::cards::Tuning) -> f64 {
    let mut cap = 0f64;
    for id in CardId::ALL {
        let def = tuning.def(id);
        for rows in std::iter::once(def.rows).chain(def.selections.iter().map(|s| s.rows)) {
            for row in rows {
                if let CardRow::Trigger(t) = row {
                    if let crate::cards::TriggerAction::Fortify { cap: c, .. } = t.action {
                        cap = cap.max(c);
                    }
                }
            }
        }
    }
    cap
}

/// P-AUG-NATIVE-2: the exact counter rules of the weapon batch (after the cap test): Eighth Strike an integer, the
/// Ledger a whole multiple of its per-kill AD, Calluses the cap or a multiple of its per-hit armor (within 1e-9, as
/// repeated addition drifts). Other cards: no extra rule here. A non-finite counter passes to the cap test.
fn exact_counter(id: CardId, c: f64, cap: f64) -> bool {
    use crate::constants::{REWORK_CALLUSES_PER, REWORK_EXECUTIONERS_LEDGER_PER};
    let on_grid = |per: f64| {
        let n = c / per;
        (n - n.round()).abs() * per <= 1e-9
    };
    match id {
        CardId::EighthStrike => c.fract() == 0.,
        CardId::ExecutionersLedger => on_grid(REWORK_EXECUTIONERS_LEDGER_PER),
        CardId::Calluses => c == cap || on_grid(REWORK_CALLUSES_PER),
        _ => true,
    }
}

/// `check_world` rules for the native state (brief section 1.6), and the `card_tank_hp` bound.
pub(crate) fn check(k: &MatchStatic, w: &World) -> Result<(), String> {
    let rework = k.cards.rule() == crate::AugmentRule::Rework;
    let tank_cap = tank_hp_cap(k.cards);
    for p in &w.players {
        let who = p.id.0;
        if !(0.0..=tank_cap).contains(&p.card_tank_hp) {
            return Err(format!(
                "player {who}: card_tank_hp {} outside 0..={tank_cap}",
                p.card_tank_hp
            ));
        }
        for (i, slot) in p.build.native.0.iter().enumerate() {
            let id = CardId::NATIVE[i];
            if slot.count == 0 {
                if slot.counter != 0. || slot.meters.iter().any(|m| *m != 0.) || slot.marks != 0 {
                    return Err(format!(
                        "player {who}: {} not held but its slot is not zero",
                        id.as_str()
                    ));
                }
                continue;
            }
            if !rework {
                return Err(format!(
                    "player {who}: native card {} outside the Rework card table",
                    id.as_str()
                ));
            }
            if slot.count > 1 {
                return Err(format!(
                    "player {who}: unique native card {} held {} times",
                    id.as_str(),
                    slot.count
                ));
            }
            let r = &NATIVE_RULES[i];
            if !exact_counter(id, slot.counter, r.counter_cap) {
                return Err(format!(
                    "player {who}: native card {} counter {} off its grid",
                    id.as_str(),
                    slot.counter
                ));
            }
            // P-AUG-NATIVE-3: the zone cards tie their counter to what they hold.
            match id {
                CardId::Pathfinder => {
                    let want = crate::constants::REWORK_PATHFINDER_CAP.min(
                        crate::constants::REWORK_PATHFINDER_PER
                            * f64::from(slot.marks.count_ones()),
                    );
                    if (slot.counter - want).abs() >= 1e-9 {
                        return Err(format!(
                            "player {who}: pathfinder counter {} is not its marks' {want}",
                            slot.counter
                        ));
                    }
                }
                CardId::HazardWalker => {
                    let most = crate::constants::REWORK_HAZARD_WALKER_CAP.min(
                        (slot.meters.iter().sum::<f64>()
                            / crate::constants::REWORK_HAZARD_WALKER_STACK_MS)
                            .floor(),
                    );
                    if slot.counter.fract() != 0. || slot.counter > most {
                        return Err(format!(
                            "player {who}: hazard walker stacks {} outside whole 0..={most}",
                            slot.counter
                        ));
                    }
                }
                // P-AUG-NATIVE-3b: the share is a point of its faction's Wish row lattice, bit-exact.
                CardId::WishEngine => {
                    let row = crate::abilities::definition_for(
                        &k.config,
                        crate::abilities::wish(p.faction()),
                    )
                    .cooldown_ms;
                    if crate::abilities::WishEngineGrid::of(row)
                        .and_then(|g| g.index_of(slot.counter))
                        .is_none()
                    {
                        return Err(format!(
                            "player {who}: wish engine share {} off its Wish row's lattice",
                            slot.counter
                        ));
                    }
                }
                // P-AUG-NATIVE-5: the carry is what whole kills at 1.5 leave over: exactly 0 or the half stack.
                CardId::MarkedMan if slot.counter != 0. && slot.counter != r.counter_cap => {
                    return Err(format!(
                        "player {who}: marked man carry {} is neither 0 nor {}",
                        slot.counter, r.counter_cap
                    ));
                }
                _ => {}
            }
            if !(0.0..=r.counter_cap).contains(&slot.counter)
                || slot
                    .meters
                    .iter()
                    .zip(r.meter_caps)
                    .any(|(m, cap)| !(0.0..=cap).contains(m))
                || slot.marks & !r.marks != 0
            {
                return Err(format!(
                    "player {who}: native card {} state outside its caps",
                    id.as_str()
                ));
            }
        }
    }
    // P-WIRE19-A: native ids are on the wire (`WireRewardId::Card(80..=93)`), so only a Legacy world, whose card table
    // holds no native card, refuses a chest offering one.
    if !rework
        && w.reward_chests.iter().any(|c| {
            c.options
                .iter()
                .flatten()
                .any(|o| matches!(o, OptionId::Card(id) if is_native(*id)))
        })
    {
        return Err("a reward chest offers a native card outside the Rework card table".into());
    }
    Ok(())
}

/// The native ids, names, definitions and caps as content words (`content::visit_progression_content`, after the
/// catalog's `CardId::ALL`): per card its index, name length and bytes, then kind, tier, flags, rows (each row's number
/// count and numbers, `cards::map_numbers`), selections, and its rule's caps and marks; then the chest pool membership
/// (`pool_members`).
pub(crate) fn visit_content(word: &mut impl FnMut(u64)) {
    fn rows(word: &mut impl FnMut(u64), rows: &[CardRow]) {
        word(rows.len() as u64);
        for row in rows {
            let mut count = 0u64;
            crate::cards::map_numbers(row, &mut |x| {
                count += 1;
                x
            });
            word(count);
            crate::cards::map_numbers(row, &mut |x| {
                word(x.to_bits());
                x
            });
        }
    }
    word(CardId::NATIVE.len() as u64);
    for (i, id) in CardId::NATIVE.into_iter().enumerate() {
        word(id.index() as u64);
        word(id.as_str().len() as u64);
        for b in id.as_str().bytes() {
            word(u64::from(b));
        }
        let def = &NATIVE_DEFINITIONS[i];
        word(def.kind as u64);
        word(u64::from(def.tier));
        word(u64::from(def.unique));
        word(u64::from(def.ready));
        word(def.base.map_or(0, |b| b as u64 + 1));
        word(def.requires.map_or(0, |b| b as u64 + 1));
        rows(word, def.rows);
        word(def.selections.len() as u64);
        for s in def.selections {
            word(u64::from(s.faction.code()));
            rows(word, s.rows);
        }
        let r = &NATIVE_RULES[i];
        word(r.counter_cap.to_bits());
        word(NATIVE_METERS as u64);
        for cap in r.meter_caps {
            word(cap.to_bits());
        }
        word(u64::from(r.marks));
    }
    // P-AUG-NATIVE-4: the chest pool membership (a Rework chest's draws read it): count, then per row its id and offer
    // (0 for `Any`, else 1 + the faction code).
    word(pool_members().count() as u64);
    for (id, offer) in pool_members() {
        word(id.index() as u64);
        word(match offer {
            crate::reward_chests::Offer::Any => 0,
            crate::reward_chests::Offer::Faction(f) => 1 + u64::from(f.code()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tables_are_in_native_order() {
        for (i, id) in CardId::NATIVE.into_iter().enumerate() {
            assert_eq!(position(id), Some(i));
            assert_eq!(NATIVE_DEFINITIONS[i].id, id);
        }
        for id in CardId::ALL {
            assert_eq!(position(id), None);
        }
    }
}
