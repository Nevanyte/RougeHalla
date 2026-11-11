//! Source `shared/killAugments.ts` and `sim/killAugments.ts`: a credited player (or bot) kill, never a mob, drops a
//! private "Trophy" reward container at the killer's feet. Its options are the victim's top three stat investments; the
//! owner's pick adds `KILL_AUG_SHARE` of that bonus to `PlayerState.killStats` (farm rows, outside card power and the PvP
//! factor). The trophy rides the chest `choose` action (`sim/chests.ts` delegates the owner check here).
//!
//! Two source-only inputs remain explicitly out of this slice and are recorded in
//! `docs/evidence/stage2-cards-3/README.md`: Holy's camp-lifesteal term of the readability leech score (the sim counts
//! camp clears but has no such passive, so the term is 0; ADR0026 records the deviation) and the public transport of
//! trophy/kill-stat facts (coordinator-owned; the wire projection filters kill-augment options).
use crate::cards::CardRow;
use crate::stat_fold::{EffectKind, EffectRow, EffectStat, FlatStat};

/// Source `KILL_AUG_PREFIX`.
pub const KILL_AUG_PREFIX: &str = "kill:";
/// Source `KILL_AUG_LABEL`.
pub const KILL_AUG_LABEL: &str = "Trophy";

/// The nine readable investments, in the source `UNIT` object's insertion order.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum KillStatKey {
    Ad,
    Ap,
    Damage,
    Health,
    AttackSpeed,
    Armor,
    Mr,
    Speed,
    Leech,
}
impl KillStatKey {
    pub const ALL: [Self; 9] = [
        Self::Ad,
        Self::Ap,
        Self::Damage,
        Self::Health,
        Self::AttackSpeed,
        Self::Armor,
        Self::Mr,
        Self::Speed,
        Self::Leech,
    ];
    pub const fn index(self) -> usize {
        self as usize
    }
    /// The source `UNIT` key spelling (the durable option-id segment).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ad => "ad",
            Self::Ap => "ap",
            Self::Damage => "damage",
            Self::Health => "health",
            Self::AttackSpeed => "attackSpeed",
            Self::Armor => "armor",
            Self::Mr => "mr",
            Self::Speed => "speed",
            Self::Leech => "leech",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }
    /// Source `FLAT`: the stats whose gain and text are absolute (one decimal), not a percentage (four decimals).
    pub const fn flat(self) -> bool {
        matches!(self, Self::Ad | Self::Ap | Self::Armor | Self::Mr)
    }
    pub const fn label(self) -> &'static str {
        match self {
            Self::Ad => "Offense",
            Self::Ap => "Soul Offence",
            Self::Damage => "damage",
            Self::Health => "max health",
            Self::AttackSpeed => "attack speed",
            Self::Armor => "Defense",
            Self::Mr => "Soul Defense",
            Self::Speed => "movement speed",
            Self::Leech => "leech",
        }
    }
}

/// Source `UNIT`: one tier-I-sized unit of each readable stat, used to score a victim's investment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub unit: [f64; 9],
}
pub const DEFINITION: Definition = Definition {
    unit: [12., 12., 0.01, 0.09, 0.09, 15., 15., 0.06, 0.05],
};
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.unit.len() as u64);
    for v in d.unit {
        word(v.to_bits());
    }
}

/// One trophy option: a stat investment and the amount a pick grants.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct KillAugment {
    pub key: KillStatKey,
    pub gain: f64,
}

/// JS `Number.prototype.toFixed` as a string: round the exact binary value to `digits` decimals, ties away from zero
/// (the source builds the option ids and their text with it, so the bytes are part of the parity).
pub fn js_to_fixed(value: f64, digits: u32) -> String {
    assert!(digits <= 20);
    if !value.is_finite() {
        return if value.is_nan() {
            "NaN".into()
        } else if value > 0. {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    let negative = value.is_sign_negative() && value != 0.;
    let abs = value.abs();
    if abs >= 1e21 {
        return value.to_string();
    }
    let pow10: u128 = 10u128.pow(digits);
    let bits = abs.to_bits();
    let exp = ((bits >> 52) & 0x7ff) as i32;
    let frac = bits & ((1u64 << 52) - 1);
    let (mant, e2) = if exp == 0 {
        (u128::from(frac), -1074i32)
    } else {
        (u128::from(frac | (1u64 << 52)), exp - 1075)
    };
    let num = mant * pow10;
    let scaled: u128 = if e2 >= 0 {
        num.checked_shl(e2 as u32).unwrap_or(u128::MAX)
    } else {
        let shift = (-e2) as u32;
        if shift > 127 {
            0
        } else {
            let den = 1u128 << shift;
            let q = num / den;
            let r = num % den;
            if r.saturating_mul(2) >= den {
                q + 1
            } else {
                q
            }
        }
    };
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    let whole = scaled / pow10;
    let remaining = scaled % pow10;
    out.push_str(&whole.to_string());
    if digits > 0 {
        out.push('.');
        let text = remaining.to_string();
        for _ in text.len()..digits as usize {
            out.push('0');
        }
        out.push_str(&text);
    }
    out
}

/// Source `Number(raw)` on the string [`js_to_fixed`] produced: the value a pick and the option id carry.
pub fn js_to_fixed_value(value: f64, digits: u32) -> f64 {
    js_to_fixed(value, digits).parse().unwrap_or(f64::NAN)
}

/// Source `encodeKillAugment`.
pub fn encode(a: KillAugment) -> String {
    format!(
        "{}{}:{}",
        KILL_AUG_PREFIX,
        a.key.as_str(),
        js_to_fixed(a.gain, if a.key.flat() { 1 } else { 4 })
    )
}

/// Source `parseKillAugment` (the first two colon-separated segments after the prefix; a positive finite gain).
pub fn parse(id: &str) -> Option<KillAugment> {
    let rest = id.strip_prefix(KILL_AUG_PREFIX)?;
    let mut parts = rest.split(':');
    let key = KillStatKey::parse(parts.next()?)?;
    let raw = parts.next()?;
    let gain: f64 = raw.parse().ok()?;
    (gain.is_finite() && gain > 0.).then_some(KillAugment { key, gain })
}

/// Source `killAugmentText` (title, body).
pub fn text(a: KillAugment) -> (String, String) {
    let name = a.key.label();
    let amount = if a.key.flat() {
        format!("+{}", js_to_fixed(a.gain, 1))
    } else {
        format!("+{}%", js_to_fixed(a.gain * 100., 1))
    };
    (
        format!("{amount} {name}"),
        format!(
            "Take {}% of your victim's {name}: {amount} for the rest of the run.",
            js_to_fixed(crate::constants::KILL_AUG_SHARE * 100., 0)
        ),
    )
}

/// The victim's readable investment scores (source `combatReadability(...).investedStats` with `lasting: true`, the
/// one scoring mode the trophy roll reads). Legacy's leech term also adds Holy's camp lifesteal
/// (`holyCampLifestealOf(campClears)`); the Rust sim counts camp clears (`Player.camps_cleared`) but has no Holy
/// camp-lifesteal passive, so that term is 0 here and in [`build_marks`] (a known deviation, pinned by
/// `build_marks_tests`).
pub fn invested_stats(p: &crate::state::Player) -> Vec<(KillStatKey, f64)> {
    let (farm_rows, farm_len) = p.farm.rows();
    let scores = invested_scores(&Readable::of(p, &farm_rows[..farm_len]), true);
    let mut out: Vec<(KillStatKey, f64)> = KillStatKey::ALL
        .into_iter()
        .map(|k| (k, scores[k.index()]))
        .filter(|(_, score)| *score > 0.01)
        .collect();
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// The overhead build marks a player shows to anyone who sees it (legacy `PlayerView.drawBuildMarks`: the first two of
/// `combatReadability(p).investedStats` in display mode, i.e. not `lasting`). Keys only, in descending score order with
/// the source's stable tie-break (the earlier key in [`KillStatKey::ALL`] wins a tie); `None` where fewer than two scores
/// pass the source's `> 0.01` threshold. Computed from the sim's own folds; allocation-free (observation hot path).
pub fn build_marks(p: &crate::state::Player) -> [Option<KillStatKey>; 2] {
    let (farm_rows, farm_len) = p.farm.rows();
    top_two(&invested_scores(
        &Readable::of(p, &farm_rows[..farm_len]),
        false,
    ))
}

/// The two best scores above the source threshold; strict comparisons keep the earlier key on a tie (a stable sort).
fn top_two(scores: &[f64; 9]) -> [Option<KillStatKey>; 2] {
    let mut best: [Option<(KillStatKey, f64)>; 2] = [None, None];
    for key in KillStatKey::ALL {
        let score = scores[key.index()];
        if !(score > 0.01) {
            continue;
        }
        match best {
            [None, _] => best[0] = Some((key, score)),
            [Some((_, first)), _] if score > first => {
                best[1] = best[0];
                best[0] = Some((key, score));
            }
            [_, None] => best[1] = Some((key, score)),
            [_, Some((_, second))] if score > second => best[1] = Some((key, score)),
            _ => {}
        }
    }
    best.map(|b| b.map(|(key, _)| key))
}

/// The public inputs of the source `combatReadability` scores (a `ReadableFighter`): the build, the decoded stat
/// mirrors, max hp, the farm rows (mob stats and kill stats as folded) and the stored kill stats.
pub(crate) struct Readable<'a> {
    pub(crate) build: &'a crate::cards::Build,
    pub(crate) faction: crate::FactionId,
    pub(crate) mirrors: crate::stat_fold::StatMirrors,
    pub(crate) max_hp: f64,
    pub(crate) farm_rows: &'a [EffectRow<'static>],
    pub(crate) kill: &'a KillStats,
    /// Legacy `ReadableFighter.campClears` (`Player.camps_cleared`): feeds Holy's camp lifesteal in the leech score
    /// (combatReadability.ts:133). Stub input added by the P-HOLY-DEMON-BLOOD-1 oracle; not yet read by [`invested_scores`].
    #[allow(dead_code)]
    pub(crate) camp_clears: u16,
}
impl<'a> Readable<'a> {
    pub(crate) fn of(p: &'a crate::state::Player, farm_rows: &'a [EffectRow<'static>]) -> Self {
        Self {
            build: &p.build,
            faction: p.faction(),
            mirrors: p.modifiers.mirrors(),
            max_hp: p.vitals.max_hp,
            farm_rows,
            kill: &p.kill_stats,
            camp_clears: p.camps_cleared,
        }
    }
}

/// Source `combatReadability` scores, indexed by [`KillStatKey::index`]; `lasting` is the source option of that name.
pub(crate) fn invested_scores(r: &Readable, lasting: bool) -> [f64; 9] {
    use crate::stat_fold::{ChestBoostStat, StatKey};
    let build = r.build;
    let faction = r.faction;
    let m = r.mirrors;
    let base_hp = crate::content::faction(faction).hp;
    let farm_rows = r.farm_rows;
    let farm_len = farm_rows.len();
    let kill = r.kill;
    let mut card_lifesteal = 0.;
    let mut generic_damage = kill.get(KillStatKey::Damage);
    let mut cards_as = 0.;
    let mut cards_move = 0.;
    for id in build.cards() {
        let count = f64::from(build.count(id));
        let (_, def_rows) = id.definition().selection(faction);
        for row in def_rows {
            if let CardRow::Fold(kind) = row {
                match kind {
                    EffectKind::Stat { stat, v } => {
                        let key = StatKey::from(*stat);
                        if key == StatKey::Lifesteal {
                            card_lifesteal += v * count;
                        }
                        if key == StatKey::Damage {
                            generic_damage += v * count;
                        }
                        if key == StatKey::AttackSpeed {
                            cards_as += v * count;
                        }
                        if key == StatKey::MoveSpeed {
                            cards_move += v * count;
                        }
                    }
                    EffectKind::While(w) => {
                        if w.stat == StatKey::AttackSpeed {
                            cards_as += w.v * count;
                        }
                        if w.stat == StatKey::MoveSpeed {
                            cards_move += w.v * count;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let mut farm_lifesteal = 0.;
    let mut farm_damage = 0.;
    let mut farm_as = 0.;
    let mut farm_move = 0.;
    for row in &farm_rows[..farm_len] {
        let key = match row.kind {
            EffectKind::Stat { stat, .. } => StatKey::from(stat),
            EffectKind::Flat { stat, .. } => StatKey::from(stat),
            _ => continue,
        };
        let v = match row.kind {
            EffectKind::Stat { v, .. } | EffectKind::Flat { v, .. } => v,
            _ => continue,
        };
        if key == StatKey::Lifesteal {
            farm_lifesteal += v;
        }
        if key == StatKey::Damage {
            farm_damage += v;
        }
        if key == StatKey::AttackSpeed {
            farm_as += v;
        }
        if key == StatKey::MoveSpeed {
            farm_move += v;
        }
    }
    generic_damage += farm_damage;
    let card_cap = crate::stat_fold::default_definition().lifesteal_cap;
    let leech = card_lifesteal.max(0.).min(card_cap)
        + (farm_lifesteal + kill.get(KillStatKey::Leech)).max(0.);
    let definition = crate::stat_fold::default_definition();
    let boost_index = |stat: ChestBoostStat| match stat {
        ChestBoostStat::AttackSpeed => crate::reward_chests::BoostId::AttackSpeed.index(),
        ChestBoostStat::MoveSpeed => crate::reward_chests::BoostId::MoveSpeed.index(),
        _ => unreachable!(),
    };
    let permanent = |cards: f64, earned: f64, stat: ChestBoostStat, cap: f64| {
        let base = cards.max(0.).min(cap) + earned.max(0.);
        let picks = f64::from(build.boosts()[boost_index(stat)]);
        base + if picks > 0. {
            crate::stat_fold::chest_boost_gain(stat, picks, base)
        } else {
            0.
        }
    };
    let earned_as = farm_as + kill.get(KillStatKey::AttackSpeed);
    let earned_move = farm_move + kill.get(KillStatKey::Speed);
    let permanent_as = permanent(
        cards_as,
        earned_as,
        ChestBoostStat::AttackSpeed,
        definition.as_mult_cap - 1.,
    );
    let permanent_move = permanent(
        cards_move,
        earned_move,
        ChestBoostStat::MoveSpeed,
        definition.move_bonus_cap,
    );
    let mut scores = [0f64; 9];
    scores[KillStatKey::Ad.index()] = m.ad_bonus / 12.;
    scores[KillStatKey::Ap.index()] = m.ap_bonus / 12.;
    scores[KillStatKey::Damage.index()] = generic_damage / 0.01;
    scores[KillStatKey::Health.index()] = if base_hp > 0. {
        (r.max_hp / base_hp - 1.).max(0.) / 0.09
    } else {
        0.
    };
    // Source: `lasting` caps the live mirror by the lasting investments; the display reads the mirror alone.
    let (as_cap, move_cap) = if lasting {
        (permanent_as, permanent_move)
    } else {
        (f64::INFINITY, f64::INFINITY)
    };
    scores[KillStatKey::AttackSpeed.index()] = (m.as_mult - 1.).max(0.).min(as_cap) / 0.09;
    scores[KillStatKey::Speed.index()] = (m.speed_mult - 1.).max(0.).min(move_cap) / 0.06;
    scores[KillStatKey::Armor.index()] = m.armor_bonus.max(0.) / 15.;
    scores[KillStatKey::Mr.index()] = m.shield_bonus.max(0.) / 15.;
    scores[KillStatKey::Leech.index()] = leech / 0.05;
    scores
}

/// Source `rollKillAugments`: the victim's top three investments as trophy options (fewer when it had fewer).
pub fn roll(p: &crate::state::Player) -> Vec<KillAugment> {
    let mut out = Vec::with_capacity(3);
    let cap = usize::try_from(crate::constants::KILL_AUG_OPTIONS).unwrap_or(3);
    for (key, score) in invested_stats(p) {
        let gain = js_to_fixed_value(
            score * DEFINITION.unit[key.index()] * crate::constants::KILL_AUG_SHARE,
            if key.flat() { 1 } else { 4 },
        );
        if !(gain > 0.) {
            continue;
        }
        out.push(KillAugment { key, gain });
        if out.len() >= cap {
            break;
        }
    }
    out
}

/// The source `killStats` map: one running total per stored stat, folded as farm rows (outside the card caps).
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KillStats {
    values: [f64; 9],
}
impl KillStats {
    pub fn get(&self, key: KillStatKey) -> f64 {
        self.values[key.index()]
    }
    pub fn is_empty(&self) -> bool {
        self.values.iter().all(|v| *v == 0.)
    }
    pub(crate) fn add(&mut self, key: KillStatKey, v: f64) {
        self.values[key.index()] += v;
    }
    pub(crate) fn valid(&self) -> bool {
        self.values.iter().all(|v| v.is_finite() && *v >= 0.)
    }
    /// Source `killStatEffects`: one farm row per nonzero stored stat.
    pub(crate) fn rows(&self) -> ([EffectRow<'static>; 9], usize) {
        let mut out = [EffectRow::new(EffectKind::Trigger); 9];
        let mut n = 0;
        for key in KillStatKey::ALL {
            let v = self.get(key);
            if !v.is_finite() || v == 0. {
                continue;
            }
            out[n].kind = match key {
                KillStatKey::Ad => EffectKind::Flat {
                    stat: FlatStat::Ad,
                    v,
                },
                KillStatKey::Ap => EffectKind::Flat {
                    stat: FlatStat::Ap,
                    v,
                },
                KillStatKey::Armor => EffectKind::Flat {
                    stat: FlatStat::Armor,
                    v,
                },
                KillStatKey::Mr => EffectKind::Flat {
                    stat: FlatStat::Shield,
                    v,
                },
                KillStatKey::Damage => EffectKind::Stat {
                    stat: EffectStat::Damage,
                    v,
                },
                KillStatKey::Health => EffectKind::Stat {
                    stat: EffectStat::MaxHp,
                    v,
                },
                KillStatKey::AttackSpeed => EffectKind::Stat {
                    stat: EffectStat::AttackSpeed,
                    v,
                },
                KillStatKey::Speed => EffectKind::Stat {
                    stat: EffectStat::MoveSpeed,
                    v,
                },
                KillStatKey::Leech => EffectKind::Stat {
                    stat: EffectStat::Lifesteal,
                    v,
                },
            };
            n += 1;
        }
        (out, n)
    }
}

/// Source `grantKillAugment`: add the pick to `killStats`, refold the mirrors and sync max hp.
pub(crate) fn grant(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    a: KillAugment,
) -> bool {
    let Some(i) = w.idx(id) else { return false };
    w.players[i].kill_stats.add(a.key, a.gain);
    crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut w.players[i]);
    true
}

#[cfg(test)]
mod build_marks_tests;
#[cfg(test)]
mod format_consumer;
#[cfg(test)]
mod helper_consumer;
#[cfg(test)]
mod lifecycle_consumer;
#[cfg(test)]
mod tests;

/// The source `playerKilled` hook link (`sim/killAugments.ts install`): a credited player death drops the killer's private
/// Trophy. Ordinary camp/stat chests stay with `reward_chests`; this link only produces the owner-bound reward container.
pub(crate) fn on_player_killed(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::PlayerKilled {
        by,
        victim,
        outcome,
    } = args
    else {
        return;
    };
    if *outcome != crate::results::Outcome::Died
        || hx.w.phase != crate::Phase::Active
        || crate::schedule::Gates::of(hx.k).training
    {
        return;
    }
    if by == victim {
        return;
    }
    let Some(ki) = hx.w.idx(*by).filter(|&i| hx.w.players[i].standing()) else {
        return;
    };
    let Some(v) = hx.w.player(*victim) else {
        return;
    };
    let options = roll(v);
    if options.is_empty() {
        return;
    }
    let at = hx.w.players[ki].pos();
    crate::reward_chests::drop_trophy(&mut *hx.w, at, *by, &options);
}
