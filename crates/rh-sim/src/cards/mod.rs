//! The supported interactive subset; source eligibility remains interactive + unique.
mod rules;
use crate::stat_fold::{EffectKind, EffectRow};
pub use rules::{visit_content, Definition, DEFINITION};

/// The three cards the current native build/chest path supports (the catalog is all 80).
pub const SUPPORTED: [CardId; 3] = [CardId::SlowBurn, CardId::PocketSand, CardId::Siphon];
mod after_damage;
mod catalog;
mod catalog_data;
pub(crate) mod fight_clock;
pub mod native;
pub(crate) use after_damage::after_damage;
pub(crate) mod on_hit;
pub(crate) mod on_hurt;
pub(crate) mod on_overkilled;
pub use catalog::*;
#[cfg(test)]
mod rework_guard_tests;
mod rework_overrides;
mod tuning;
pub use tuning::{check_override, map_numbers, CardNumbers, ShapeError, Tuning};

/// The source build's card count map (one byte per card in wire order). A newtype so the 80-byte array has Default and a
/// strict 80-element serde form (serde arrays stop at 32).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counts(pub [u8; 80]);

impl Default for Counts {
    fn default() -> Self {
        Self([0; 80])
    }
}

impl serde::Serialize for Counts {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.as_slice().serialize(s)
    }
}

impl<'de> serde::Deserialize<'de> for Counts {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = <Vec<u8>>::deserialize(d)?;
        let arr: [u8; 80] = v
            .try_into()
            .map_err(|_| serde::de::Error::custom("card counts must have 80 entries"))?;
        Ok(Self(arr))
    }
}

/// Source card-state streak memory: consecutive weapon hits on one target, read at the pass start and written after it.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Streak {
    pub target: crate::PlayerId,
    pub count: u16,
    pub last: f64,
}

/// One pending heal-over-time step run (source `PlayerRuntime.hots`).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hot {
    pub next: f64,
    pub left: u32,
    pub amount: f64,
    pub ignore_lockout: bool,
}

/// Source `healOverTimeSteps`: at least one round step per HEAL_OVER_TIME_STEP_MS.
pub fn heal_over_time_steps(ms: f64) -> u32 {
    ((ms / crate::constants::HEAL_OVER_TIME_STEP_MS).round() as u32).max(1)
}

/// One Overkill splash waiting for the pass to settle (the source's payLater closure data).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SplashReq {
    pub holder: crate::PlayerId,
    pub victim: crate::PlayerId,
    pub at: crate::math::Vec2,
    pub radius: f64,
    pub entry: crate::systems::ledger::Entry,
    pub raw: f64,
}

/// Adrenaline's runtime boost (source `cards.boostAs/boostMove/boostUntil`): factors applied while `until` is in the future.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Boost {
    pub as_mult: f64,
    pub move_mult: f64,
    pub until: f64,
}

impl Default for Boost {
    fn default() -> Self {
        Self {
            as_mult: 1.,
            move_mult: 1.,
            until: 0.,
        }
    }
}

/// Source `rollAttackCrit`: a player's deterministic critical accumulator takes its crit chance (the `critChance` sum,
/// zero under the noCrit flag, never above CRIT_CHANCE_MAX) and fires at 1.
/// Source `gamblerFactor`: the salted coin for one ledger entry of a Gambler — up with GAMBLER_CHANCE, down with the same,
/// else 1. The hash covers the secret salt, the tick, the attacker and victim ids and the entry's place among the attacker's
/// entries on that victim, so no processing order changes it.
pub(crate) fn gambler_factor(
    k: &crate::statics::MatchStatic,
    w: &crate::state::World,
    by: crate::PlayerId,
    victim: crate::PlayerId,
    index: u32,
) -> f64 {
    let salt = crate::private_rng::mixed_salt(
        k.secrets.reward_salt,
        crate::initial_world::DEFINITION.gamble_tag,
    );
    let by_label = w.roster.label(by).cloned().unwrap_or_default();
    let victim_label = w.roster.label(victim).cloned().unwrap_or_default();
    let roll = crate::private_rng::salted_unit(
        salt,
        &[
            crate::private_rng::SaltPart::Num(w.tick),
            crate::private_rng::SaltPart::Text(by_label.as_ref()),
            crate::private_rng::SaltPart::Text(victim_label.as_ref()),
            crate::private_rng::SaltPart::Num(index),
        ],
    );
    // Legacy `roll < CHANCE` up, `roll < 2 * CHANCE` down: `CHANCE + CHANCE == 2 * CHANCE` exactly in f64, so the
    // legacy table draws the same coin; the rework splits the two chances (plan decision 4).
    let n = k.cards.numbers();
    if roll < n.gambler_up_chance {
        n.gambler_up
    } else if roll < n.gambler_up_chance + n.gambler_down_chance {
        n.gambler_down
    } else {
        1.
    }
}

/// Source `plantArmed`: stood still long enough (the flag and PLANT_FEET_MS since last seen moving) for its next attack.
pub(crate) fn plant_armed(p: &crate::state::Player, now: f64) -> bool {
    p.build.has_flag(crate::stat_fold::EffectFlag::PlantFeet)
        && now - p.card_still_since >= crate::constants::PLANT_FEET_MS
}

/// Source `spendPlant`: the armed attack was spent; stand still for PLANT_FEET_MS again. Called once per attack, when
/// it starts (`systems::weapons::step_weapon`, legacy `startAttack`), whether or not the attack later meets anyone.
pub(crate) fn spend_plant(p: &mut crate::state::Player, now: f64) {
    p.card_still_since = now;
}

/// Plant Your Feet's restore rule for a pending action's or a flight's `range_mult`: 1 (unplanted) up to the table's
/// planted factor `1 + plant_feet_bonus`, finite. A range, not the two exact values, so any factor the world's table
/// can produce restores (a `Rework` table's larger bonus too). A factor above 1 on a fighter without the card (or a
/// mob) is admitted: it is bounded like a planted attack's and changes the state hash.
pub(crate) fn valid_range_mult(tuning: &Tuning, range_mult: f64) -> bool {
    (1.0..=1. + tuning.numbers().plant_feet_bonus).contains(&range_mult)
}

/// Source `stillness`: a player that moved (or is not standing) was last seen moving now.
pub(crate) fn stillness(w: &mut crate::state::World, now: f64) {
    for i in 0..w.players.len() {
        if !w.players[i]
            .build
            .has_flag(crate::stat_fold::EffectFlag::PlantFeet)
        {
            continue;
        }
        let pos = w.players[i].core.pos();
        let moved = (pos.x - w.players[i].card_still_x).abs() > 0.01
            || (pos.y - w.players[i].card_still_y).abs() > 0.01;
        let standing =
            w.players[i].core.vitals.hp > 0. && w.players[i].status == crate::Status::Alive;
        if moved || !standing {
            w.players[i].card_still_since = now;
            w.players[i].card_still_x = pos.x;
            w.players[i].card_still_y = pos.y;
        }
    }
}

pub(crate) fn roll_attack_crit(p: &mut crate::state::Player) -> bool {
    let sum = p.modifiers.crit_chance();
    let no_crit = p.build.has_flag(crate::stat_fold::EffectFlag::NoCrit);
    let chance = if no_crit || !(sum > 0.) {
        0.
    } else {
        sum.min(crate::status_runtime::stats::CRIT_CHANCE_MAX)
    };
    if !(chance > 0.) {
        return false;
    }
    let next = p.card_crit_acc + chance;
    if next >= 1. - crate::status_runtime::stats::CRIT_EPSILON {
        p.card_crit_acc = next - 1.;
        true
    } else {
        p.card_crit_acc = next;
        false
    }
}

/// Source `startBoost`: a running boost keeps its stronger factors, a lapsed one starts over; the end moves to the later time.
pub fn start_boost(p: &mut crate::state::Player, now: f64, as_: f64, move_: f64, ms: f64) {
    let b = &mut p.card_boost;
    let running = b.until > now;
    b.as_mult = if running {
        b.as_mult.max(1. + as_)
    } else {
        1. + as_
    };
    b.move_mult = if running {
        b.move_mult.max(1. + move_)
    } else {
        1. + move_
    };
    b.until = b.until.max(now + ms);
}

/// One Wishful Thinking trim inside the source window (source `cards.trims`).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trim {
    pub at: f64,
    pub ms: f64,
}

/// Source `wishfulThinking`: `n` hits shorten a cast Wish's cooldown by the owned hit-trigger's `ms` each, capped by the
/// window budget and never below the cast-cooldown floor. Mutates the stock clocks and records the trim. The cut, window,
/// budget and floor are the world's table's (`numbers`, from `k.cards`): under a share rule (Rework) the cut and the
/// budget are shares of the cast's full cooldown (`cast.cooldown_ms`) and `ms` only says the card is owned. The restore
/// bound on the trims (`abilities/checkpoint.rs`) reads the same `CardNumbers` methods.
pub fn wishful_thinking(
    numbers: &CardNumbers,
    n: u32,
    ms: f64,
    now: f64,
    stocks: &mut crate::abilities::Stocks,
    cast: Option<crate::cards::runtime::WishSpend>,
    trims: &mut Vec<Trim>,
) {
    if n == 0 || !(ms > 0.) {
        return;
    }
    let Some(cast) = cast else { return };
    let on_cooldown = stocks.wish_ready_at > now;
    let clock_end = if on_cooldown {
        stocks.wish_ready_at
    } else {
        stocks.wish_full_at.unwrap_or(0.)
    };
    if !(clock_end > now) {
        return;
    }
    trims.retain(|t| now - t.at < numbers.wishful_window_ms);
    let used: f64 = trims.iter().map(|t| t.ms).sum();
    let floor_at = (cast.at + numbers.wishful_floor_share * cast.cooldown_ms).max(now);
    let cut = numbers
        .wishful_hit_cut(n, ms, cast.cooldown_ms)
        .min(numbers.wishful_budget(cast.cooldown_ms) - used)
        .min(clock_end - floor_at);
    if !(cut > 0.) {
        return;
    }
    if on_cooldown {
        stocks.wish_ready_at -= cut;
    }
    stocks.wish_full_at = stocks.wish_full_at.map(|v| (v - cut).max(0.));
    trims.push(Trim { at: now, ms: cut });
}

/// Source `streakBefore`: hits landed in a row on `victim` before this tick's pass (0 without a live same-target streak).
pub fn streak_before(
    streak: Option<&Streak>,
    now: f64,
    victim: crate::PlayerId,
    gap_ms: f64,
) -> u16 {
    match streak {
        Some(s) if s.target == victim && now - s.last < gap_ms => s.count,
        _ => 0,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Build {
    /// P-AUG-NATIVE-1a: the native cards' counts and capped state (live world only). Absent in JSON = none held; see the
    /// hand-written `Serialize` below.
    #[serde(default)]
    pub(crate) native: native::NativeCards,
    /// Source count map in wire order: base cards stack; unique cards have one.
    pub(crate) counts: Counts,
    pub(crate) boosts: [u8; 8],
}

/// `native` is written first and only when a native card is held, so a build holding none writes (and hashes) exactly
/// as before the field existed: `{"counts":[80],"boosts":[8]}`. Sound for the state hash (`hash.rs`, fourth World
/// exception): a sequence hashes its length first, so a held-native build starts with its row count (1..=14) and a
/// native-free one with `Counts`' length 80. Not `skip_serializing_if`: `Sim::check_layout` refuses a skipped field.
impl serde::Serialize for Build {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let held = !self.native.is_empty();
        let mut st = s.serialize_struct("Build", if held { 3 } else { 2 })?;
        if held {
            st.serialize_field("native", &self.native)?;
        }
        st.serialize_field("counts", &self.counts)?;
        st.serialize_field("boosts", &self.boosts)?;
        st.end()
    }
}
/// The most fold rows one copy of every card can give (catalog and native, under either card table and any faction's
/// own row selection, `Tuning::rows`): a Plague player's selection, 80. A fixed scratch bound, not a game rule:
/// `Build::rows` stops when it is full, so `native::hooks_tests::max_fold_rows_covers_every_card_of_both_tables`
/// guards it, and a packet that adds fold rows raises it. (Not computed: the tables are statics, which a const cannot
/// read.)
pub(crate) const MAX_FOLD_ROWS: usize = 80;

/// [`Build::cards`]: one cursor over the 80 catalog slots, then the 14 native ones (the same cards in the same order as
/// a filtered catalog walk chained to `NativeCards::held`). Hand-written because it runs every step for every player
/// (`after_damage`, the stat fold's rows, `invested_scores`): the chained adapter cost ~6.7k instructions per step in
/// the legacy-rule benches (P-AUG-PERF-1).
struct HeldCards<'a> {
    build: &'a Build,
    at: usize,
}

/// The cursor's position is a card's index: `ALL` and `NATIVE` list the ids in index order, and the catalog is whole
/// 8-byte words ([`Build::cards`] checks this at compile time).
const fn cursor_is_index() -> bool {
    let mut i = 0;
    while i < CardId::ALL.len() {
        if CardId::ALL[i].index() != i {
            return false;
        }
        i += 1;
    }
    let mut j = 0;
    while j < CardId::NATIVE.len() {
        if CardId::NATIVE[j].index() != CardId::ALL.len() + j {
            return false;
        }
        j += 1;
    }
    CardId::ALL.len() % 8 == 0
}

impl Iterator for HeldCards<'_> {
    type Item = CardId;
    #[inline]
    fn next(&mut self) -> Option<CardId> {
        let counts = &self.build.counts.0;
        while let Some(&id) = CardId::ALL.get(self.at) {
            // Eight unheld catalog cards at once (a build holds few of the 80): an all-zero word is skipped.
            if self.at % 8 == 0 {
                let mut word = [0u8; 8];
                word.copy_from_slice(&counts[self.at..self.at + 8]);
                if u64::from_ne_bytes(word) == 0 {
                    self.at += 8;
                    continue;
                }
            }
            self.at += 1;
            if counts[self.at - 1] > 0 {
                return Some(id);
            }
        }
        while let Some(&id) = CardId::NATIVE.get(self.at - CardId::ALL.len()) {
            self.at += 1;
            if self.build.native.held_at(self.at - 1 - CardId::ALL.len()) {
                return Some(id);
            }
        }
        None
    }
}

impl Build {
    pub fn owns(&self, id: CardId) -> bool {
        self.count(id) > 0
    }
    pub fn count(&self, id: CardId) -> u8 {
        match self.native.slot(id) {
            Some(slot) => slot.count,
            None => self.counts.0[id.index()],
        }
    }
    /// P-AUG-NATIVE-1a: every native card's slot (held or not).
    pub fn native(&self) -> &native::NativeCards {
        &self.native
    }

    /// Sets a card's copy count (the practice console's build.set; production picks go through add). Clearing a native
    /// card zeroes its whole slot (a slot not held is all zero: it is not written).
    pub(crate) fn set(&mut self, id: CardId, count: u8) {
        match self.native.slot_mut(id) {
            Some(slot) if count == 0 => *slot = native::NativeSlot::default(),
            Some(slot) => slot.count = count,
            None => self.counts.0[id.index()] = count,
        }
    }
    /// Any owned card's fold row carries this flag (source `hasFlag`).
    pub fn has_flag(&self, flag: crate::stat_fold::EffectFlag) -> bool {
        self.cards().any(|id| {
            id.definition().rows.iter().any(|row| {
                matches!(
                    row,
                    CardRow::Fold(EffectKind::Flag { flag: f }) if *f == flag
                )
            })
        })
    }
    pub fn power(&self) -> f64 {
        self.cards()
            .map(|id| f64::from(id.tier()) * f64::from(self.count(id)))
            .sum()
    }
    /// The held cards: the 80 catalog cards in catalog order, then the held native cards in native order.
    pub fn cards(&self) -> impl Iterator<Item = CardId> + '_ {
        const { assert!(cursor_is_index()) };
        HeldCards { build: self, at: 0 }
    }
    /// Build a count map from (card, count) pairs (tests and trusted producers).
    pub fn from_counts(pairs: impl IntoIterator<Item = (CardId, u8)>) -> Self {
        let mut build = Self::default();
        for (id, count) in pairs {
            build.set(id, count);
        }
        build
    }
    pub fn counts(&self) -> [u8; 80] {
        self.counts.0
    }
    pub fn boosts(&self) -> [u8; 8] {
        self.boosts
    }
    pub(crate) fn add(&mut self, id: CardId) -> bool {
        if id.definition().unique && self.owns(id) {
            return false;
        }
        let c = self.count(id);
        if c == u8::MAX {
            return false;
        }
        self.set(id, c + 1);
        true
    }
    pub(crate) fn valid(&self) -> bool {
        CardId::ALL
            .into_iter()
            .chain(CardId::NATIVE)
            .all(|id| !(id.definition().unique && self.count(id) > 1))
            && self.boosts.iter().all(|n| {
                u32::from(*n) <= crate::stat_fold::default_definition().chest_boost_max_picks
            })
    }
    /// The build's fold rows under the world's card table (an override row's numbers, never the catalog's, once a
    /// table has one): the input of the stat fold and of its restore re-fold.
    pub(crate) fn rows(
        &self,
        tuning: &Tuning,
        faction: crate::FactionId,
    ) -> ([EffectRow<'static>; MAX_FOLD_ROWS], usize) {
        let empty = EffectRow {
            kind: EffectKind::Trigger,
            requires: &[],
            needs_status: false,
        };
        let mut rows = [empty; MAX_FOLD_ROWS];
        let mut n = 0;
        for id in self.cards() {
            let def_rows = tuning.rows(id, faction);
            // A base card stacks: its rows apply once per copy (source countIn); a unique card is held once.
            for _ in 0..self.count(id) {
                for row in def_rows {
                    if let CardRow::Fold(kind) = row {
                        if n == rows.len() {
                            return (rows, n);
                        }
                        rows[n] = EffectRow::new(*kind);
                        n += 1;
                    }
                }
            }
        }
        (rows, n)
    }
}
pub(crate) fn grant(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    card: CardId,
) -> bool {
    let Some(i) = w.idx(id) else { return false };
    if !w.players[i].build.add(card) {
        return false;
    }
    crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut w.players[i]);
    true
}

/// Source `cardHooks.onBlocked`: Tank Engine, the `block` status triggers (Pocket Sand) and Best Offense's on-hit effects.
/// Quiet status application is immediate outside the ledger.
pub(crate) fn on_blocked(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::Blocked {
        holder,
        attacker,
        prevented,
        ..
    } = *args
    else {
        return;
    };
    let Some(holder_ix) = hx.w.idx(holder) else {
        return;
    };
    let (faction, mirrors, rows, n) = {
        let Some(p) = hx.w.player(holder) else { return };
        let mut rows = [(TriggerAction::Cooldown { ms: 0. }, 0.); 4];
        let mut n = 0;
        for card in p.build.cards() {
            for row in hx.k.cards.def(card).rows {
                if let CardRow::Trigger(t) = row {
                    if t.on == TriggerOn::Block && n < rows.len() {
                        rows[n] = (t.action, t.arg);
                        n += 1;
                    }
                }
            }
        }
        (
            crate::content::faction(p.faction()),
            p.modifiers.mirrors(),
            rows,
            n,
        )
    };
    let Some(name) = hx.w.roster.label(holder).cloned() else {
        return;
    };
    for &(action, _arg) in &rows[..n] {
        match action {
            TriggerAction::Status {
                to,
                status,
                ms,
                value,
            } => {
                let target = match to {
                    Side::Self_ => holder,
                    Side::Target => attacker,
                };
                crate::systems::status::operations::apply_with(
                    hx.k,
                    hx.w,
                    hx.ev,
                    target,
                    crate::status_runtime::StatusApply {
                        kind: status,
                        source: crate::status_runtime::StatusSource {
                            id: Some(holder),
                            name: name.clone(),
                            owner_id: None,
                        },
                        ms,
                        ability: None,
                        tag: Some(crate::status_runtime::StatusTag::Block),
                        value,
                        add: None,
                        data: None,
                    },
                    true,
                    hx.stats,
                );
            }
            TriggerAction::Fortify { per, cap } => {
                let shares = crate::content::DamageShares {
                    phys: prevented.phys,
                    magic: prevented.magic,
                    true_: prevented.true_,
                };
                let armor = (faction.armor + mirrors.armor_bonus).max(0.);
                let shield = faction.shield + mirrors.shield_bonus;
                let kept = crate::content::mitigate_shares(prevented.raw, &shares, armor, shield);
                let p = &mut hx.w.players[holder_ix];
                p.card_prevented += kept;
                let earned = (p.card_prevented * per).min(cap);
                if earned > p.card_tank_hp + 1e-9 {
                    p.card_tank_hp = earned;
                    crate::modifiers::sync_max_hp(p);
                }
            }
            _ => {}
        }
    }
    // P-AUG-NATIVE-1b: the native block hook, once per `HookArgs::Blocked` (melee and projectile blocks both reach this
    // link), after Tank Engine so Bastion fills with what Tank Engine counted.
    native::hooks::fire(
        hx.k,
        hx.w,
        holder,
        native::hooks::NativeEvent::Block { prevented },
    );
    // Source Best Offense (`cardHooks.ts:206-214`): `if (hasFlag(holder.s, "blockHits") && standing(holder))` and a weapon
    // in hand, the block is a hit: the on-hit effects apply to the blocked attacker now. (The streak / Wishful Thinking
    // note of the block is P-MECHANICS-SALVAGE-2.)
    let weapon = {
        let p = &hx.w.players[holder_ix];
        let w = &p.core.weapon;
        let in_hand = if w.slot == 0 { w.weapon0 } else { w.weapon1 };
        in_hand
            .filter(|_| p.build.has_flag(crate::stat_fold::EffectFlag::BlockHits) && p.standing())
    };
    if let Some(weapon) = weapon {
        on_hit::block_hit(hx, holder, attacker, weapon);
    }
}

/// Source \`cardHooks.resetFight\`: a teleport starts a fresh fight — no streak and no running boost survive it, and the
/// pending heal-over-time runs are dropped.
pub(crate) fn reset_fight(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if *args != crate::hooks::HookArgs::Teleported {
        return;
    }
    for i in 0..hx.w.players.len() {
        let had_boost = hx.w.players[i].card_boost.until > 0.;
        hx.w.players[i].card_streak = None;
        hx.w.players[i].card_boost = Boost::default();
        hx.w.players[i].card_hots.clear();
        if had_boost {
            crate::modifiers::recompute(hx.k, hx.w, crate::fighter::FighterIx::of_slot(i));
        }
    }
}

/// Source \`cardHooks.dropDeferred\`: hits a pass queued for the next tick answer a fight that is over.
pub(crate) fn drop_deferred(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if matches!(
        *args,
        crate::hooks::HookArgs::Teleported | crate::hooks::HookArgs::RunEnded
    ) {
        hx.w.deferred.hits.clear();
    }
}

pub mod runtime;

#[cfg(test)]
mod on_hit_salvage_tests;

#[cfg(test)]
mod on_hit_salvage2_tests;

#[cfg(test)]
mod on_hit_salvage2_review_tests;

#[cfg(test)]
mod plant_feet_tests;

#[cfg(test)]
mod wishful_rework_tests;

#[cfg(test)]
mod wishful_tests {
    use super::{wishful_thinking, Trim};
    use crate::abilities::Stocks;
    use crate::cards::runtime::WishSpend;

    fn stocks(now: f64) -> Stocks {
        Stocks {
            wish_ready_at: now + 3000.,
            wish_full_at: None,
            ..Default::default()
        }
    }

    #[test]
    fn wishful_thinking_trims_with_the_source_caps() {
        let cast = Some(WishSpend {
            at: 0.,
            cooldown_ms: 10_000.,
        });
        let now = 5000.;
        let mut st = stocks(now);
        let mut trims = Vec::new();
        wishful_thinking(
            crate::cards::Tuning::legacy().numbers(),
            1,
            1000.,
            now,
            &mut st,
            cast,
            &mut trims,
        );
        // floorAt = max(now, cast.at + 0.5 * cooldown) = 5000, clockEnd 8000: cut 1000.
        assert_eq!(st.wish_ready_at, now + 2000.);
        assert_eq!(trims.len(), 1);
        // Budget: 30 s already used in the window leaves nothing.
        let mut st2 = stocks(now);
        let mut trims2 = vec![Trim {
            at: now,
            ms: crate::constants::WISHFUL_BUDGET_MS,
        }];
        wishful_thinking(
            crate::cards::Tuning::legacy().numbers(),
            1,
            1000.,
            now,
            &mut st2,
            cast,
            &mut trims2,
        );
        assert_eq!(st2.wish_ready_at, now + 3000.);
        // Floor: only 200 ms above the floor can be cut.
        let cast_late = Some(WishSpend {
            at: 0.,
            cooldown_ms: 10_000.,
        });
        let mut st3 = Stocks {
            wish_ready_at: now + 200.,
            wish_full_at: None,
            ..Default::default()
        };
        let mut trims3 = Vec::new();
        wishful_thinking(
            crate::cards::Tuning::legacy().numbers(),
            5,
            1000.,
            now,
            &mut st3,
            cast_late,
            &mut trims3,
        );
        assert_eq!(st3.wish_ready_at, now);
        // An expired trim leaves the window.
        let mut st4 = stocks(now);
        let mut trims4 = vec![Trim {
            at: now - crate::constants::WISHFUL_WINDOW_MS,
            ms: crate::constants::WISHFUL_BUDGET_MS,
        }];
        wishful_thinking(
            crate::cards::Tuning::legacy().numbers(),
            1,
            1000.,
            now,
            &mut st4,
            cast,
            &mut trims4,
        );
        assert_eq!(st4.wish_ready_at, now + 2000.);
        assert_eq!(trims4.len(), 1);
    }
}

#[cfg(test)]
mod tank_tests {
    use super::*;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn tank_engine_earns_flat_max_hp_from_prevented_damage() {
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
            PlayerId(2),
            CardId::TankEngine
        ));
        let i = sim.w.idx(PlayerId(2)).unwrap();
        let base_max = sim.w.players[i].vitals.max_hp;
        let mut ev = Vec::new();
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        on_blocked(
            &mut hx,
            &crate::hooks::HookArgs::Blocked {
                holder: PlayerId(2),
                attacker: PlayerId(1),
                prevented: crate::state::Packet {
                    raw: 100.,
                    phys: 1.,
                    magic: 0.,
                    true_: 0.,
                },
                melee: true,
            },
        );
        let p = hx.w.player(PlayerId(2)).unwrap();
        assert!(p.card_prevented > 0., "tally {}", p.card_prevented);
        assert!(
            p.card_tank_hp > 0. && p.card_tank_hp <= 250.,
            "earned {}",
            p.card_tank_hp
        );
        assert_eq!(p.vitals.max_hp, base_max + p.card_tank_hp);
    }
}

#[cfg(test)]
mod teleport_tests {
    use super::*;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn a_teleport_clears_the_streak_boost_hots_and_deferred_hits() {
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
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let now = sim.w.server_time;
        sim.w.players[i].card_streak = Some(crate::cards::Streak {
            target: PlayerId(2),
            count: 2,
            last: now,
        });
        sim.w.players[i].card_boost = crate::cards::Boost {
            as_mult: 1.4,
            move_mult: 1.4,
            until: now + 1000.,
        };
        sim.w.players[i].card_hots.push(crate::cards::Hot {
            next: now + 500.,
            left: 2,
            amount: 10.,
            ignore_lockout: true,
        });
        sim.w.deferred.hits.push(crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: crate::state::Packet {
                raw: 10.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: None,
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: true,
        });
        let mut ev = Vec::new();
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        reset_fight(&mut hx, &crate::hooks::HookArgs::Teleported);
        drop_deferred(&mut hx, &crate::hooks::HookArgs::Teleported);
        let p = hx.w.player(PlayerId(1)).unwrap();
        assert!(p.card_streak.is_none());
        assert_eq!(p.card_boost.until, 0.);
        assert!(p.card_hots.is_empty());
        assert!(hx.w.deferred.hits.is_empty());
    }
}

#[cfg(test)]
mod crit_tests {
    use super::roll_attack_crit;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn the_attack_crit_accumulator_fires_at_one() {
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
            crate::cards::CardId::CruelWounds
        ));
        let i = sim.w.idx(PlayerId(1)).unwrap();
        assert!((sim.w.players[i].modifiers.crit_chance() - 0.2).abs() < 1e-9);
        let p = &mut sim.w.players[i];
        let mut fires = 0;
        for _ in 0..5 {
            if roll_attack_crit(p) {
                fires += 1;
            }
        }
        assert_eq!(fires, 1, "the fifth 20% step fires");
        assert!(p.card_crit_acc.abs() < 1e-9, "acc {}", p.card_crit_acc);
    }
}

#[cfg(test)]
mod dot_crit_tests {
    use super::{plant_armed, spend_plant};
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
        Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        )
    }

    #[test]
    fn plant_your_feet_arms_after_a_second_still() {
        let mut sim = setup();
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::PlantYourFeet
        ));
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let now = sim.w.server_time;
        sim.w.players[i].card_still_since = now - 999.;
        assert!(!plant_armed(&sim.w.players[i], now));
        sim.w.players[i].card_still_since = now - 1000.;
        assert!(plant_armed(&sim.w.players[i], now));
        spend_plant(&mut sim.w.players[i], now);
        assert!(!plant_armed(&sim.w.players[i], now));
    }

    /// `check_world` admits a pending action's `range_mult` from 1 up to the table's planted factor, and refuses
    /// anything outside it (P-AUG-PLANT-1; the oracle covers a planted flight and cast restoring).
    #[test]
    fn restore_bounds_a_pending_attacks_plant_factor() {
        fn set_factor(v: &mut serde_json::Value, m: f64) -> bool {
            match v {
                serde_json::Value::Object(o) if o.contains_key("lands_at") => {
                    o.insert("range_mult".into(), serde_json::json!(m));
                    true
                }
                serde_json::Value::Object(o) => o.values_mut().any(|c| set_factor(c, m)),
                serde_json::Value::Array(a) => a.iter_mut().any(|c| set_factor(c, m)),
                _ => false,
            }
        }
        let mut sim = setup();
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let now = sim.w.server_time;
        let weapon = sim.w.players[i].core.active_weapon();
        sim.w.players[i].core.weapon.action = Some(crate::state::PendingAction {
            kind: match weapon {
                crate::WeaponId::Bow => crate::state::ActionKind::Draw,
                crate::WeaponId::Wand => crate::state::ActionKind::Cast,
                _ => crate::state::ActionKind::Swing,
            },
            weapon,
            target: None,
            started_at: now,
            lands_at: now + 200.,
            a: 0.,
            packet: crate::state::Packet {
                raw: 1.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            roam_armed: false,
            range_mult: 1.,
        });
        let cp = serde_json::to_value(&sim).unwrap();
        let top = 1. + crate::constants::PLANT_FEET_BONUS;
        for (m, ok) in [
            (1., true),
            (top, true),
            (1. - 1e-9, false),
            (top + 1e-9, false),
        ] {
            let mut doctored = cp.clone();
            assert!(
                set_factor(&mut doctored["world"], m),
                "the pending action is in the checkpoint"
            );
            assert_eq!(Sim::restore(&doctored).is_ok(), ok, "range_mult {m}");
        }
        let legacy = crate::cards::Tuning::legacy();
        assert!(!super::valid_range_mult(legacy, f64::NAN));
        assert!(!super::valid_range_mult(legacy, f64::INFINITY));
    }
}

#[cfg(test)]
mod gambler_tests {
    use super::gambler_factor;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn the_gambler_coin_is_deterministic_and_salted() {
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
            crate::cards::CardId::Gambler
        ));
        let a = gambler_factor(&sim.k, &sim.w, PlayerId(1), PlayerId(2), 0);
        let b = gambler_factor(&sim.k, &sim.w, PlayerId(1), PlayerId(2), 0);
        assert_eq!(a, b, "the same coin twice");
        assert!(a == 2. || a == 0.5 || a == 1.);
        let mut seen: Vec<f64> = Vec::new();
        for i in 0..16 {
            let v = gambler_factor(&sim.k, &sim.w, PlayerId(1), PlayerId(2), i);
            if !seen.iter().any(|x| x.to_bits() == v.to_bits()) {
                seen.push(v);
            }
        }
        assert!(seen.len() > 1, "the index changes the coin: {seen:?}");
    }
}
