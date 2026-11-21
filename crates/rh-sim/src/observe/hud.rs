//! The HUD-side views of an observation: the gained-stat strip, camp rewards and camp HUD, the run summary and the
//! roster, with the functions that fill them.

use super::*;

/// The nine GAINED stats in the legacy strip order (`buildModel.ts` `buildGains`); also the stat a camp reward grants.
/// The wire code is the variant index (0..=8).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HudStat {
    Offense,
    SoulOffense,
    Damage,
    AttackSpeed,
    LifeSteal,
    Health,
    Defense,
    SoulDefense,
    MoveSpeed,
}

/// A camp ward as one viewer sees it (C-OBS: a verdict, never the owner's id).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WardVerdict {
    #[default]
    None,
    Yours,
    Other,
}

/// A camp's per-kill reward (public content): the stat and the farm table's per-stack value (a fraction for a
/// percent stat, points for a flat one).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CampReward {
    pub stat: HudStat,
    pub amount: f64,
}

/// P-WIRE17-HUD-1: the HUD facts of one camp for one viewer.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CampHudView {
    pub reward: Option<CampReward>,
    pub ward: WardVerdict,
    /// The ward's expiry (server ms) when `ward` is not None; 0 otherwise.
    pub ward_expires_at: f64,
}

/// One "Mob bonuses" row of the viewer's summary (catalog order).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SummaryMobRow {
    pub mob: crate::mob_catalog::MobTypeId,
    pub stacks: u64,
    pub stat: HudStat,
    pub total: f64,
}

/// P-WIRE17-HUD-1: the viewer's GAINED strip: `gains` indexed by [`HudStat`] (unrounded, units as
/// [`crate::build_summary::BuildSummary`]), owned mob rows in catalog order.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SummaryView {
    pub gains: [f64; 9],
    pub mob_rows: Vec<SummaryMobRow>,
}

/// The HUD stat a farm reward stat is shown as (legacy `rewardIconFor`, `packages/client/src/ui/planning.ts:161-174`);
/// `None` for a stat no farm row uses.
fn hud_stat(stat: crate::modifiers::farm::RewardStat) -> Option<HudStat> {
    use crate::modifiers::farm::RewardStat::{Flat, Stat};
    use crate::stat_fold::{EffectStat as S, FlatStat as F};
    Some(match stat {
        Flat(F::Ad) => HudStat::Offense,
        Flat(F::Ap) => HudStat::SoulOffense,
        Stat(S::Damage) => HudStat::Damage,
        Stat(S::AttackSpeed) => HudStat::AttackSpeed,
        Stat(S::Lifesteal) => HudStat::LifeSteal,
        Stat(S::MaxHp) => HudStat::Health,
        Flat(F::Armor) => HudStat::Defense,
        Flat(F::Shield) => HudStat::SoulDefense,
        Stat(S::MoveSpeed) => HudStat::MoveSpeed,
        _ => return None,
    })
}

/// Refreshes `out` to one HUD row per camp roster row (same order): the camp's normal-mob reward (public content,
/// legacy `planning.ts:176-187`; the camp's buff where it has one, P-CAMP-BUFF-THEMES-1) and its ward as a verdict for
/// `viewer` (legacy `CampWards.ts:39-54`: live only while an owner exists and `now < wardExpiresAt`; never the owner's
/// id, C-OBS). Reuses `out`'s capacity.
pub(super) fn camp_hud_into(sim: &Sim, viewer: PlayerId, now: f64, out: &mut Vec<CampHudView>) {
    out.clear();
    let life = sim
        .w
        .mob_runtime
        .as_ref()
        .map_or(&[][..], |rt| &rt.life[..]);
    let buffs = sim.camp_buffs();
    for (i, camp) in sim.camp_rosters().iter().enumerate() {
        // a7b5c4ce `campRewardId`: the camp's buff (`SimConfig::camp_buffs = Themed`), else its own type.
        let pays = buffs.get(i).copied().flatten().unwrap_or(camp.mob_type);
        let reward = crate::modifiers::farm::Farm::reward_of(pays).and_then(|r| {
            hud_stat(r.stat).map(|stat| CampReward {
                stat,
                amount: r.value,
            })
        });
        let (ward, ward_expires_at) = match life.get(i) {
            Some(l) if now < l.ward_expires_at => match l.ward_owner {
                Some(owner) if owner == viewer => (WardVerdict::Yours, l.ward_expires_at),
                Some(_) => (WardVerdict::Other, l.ward_expires_at),
                None => (WardVerdict::None, 0.),
            },
            _ => (WardVerdict::None, 0.),
        };
        out.push(CampHudView {
            reward,
            ward,
            ward_expires_at,
        });
    }
}

/// Refreshes `out` to the viewer's own GAINED strip ([`crate::build_summary::build_summary`] of `viewer` only, C-OBS),
/// reusing the previous mob-row buffer; `None` when the viewer is not seated.
pub(super) fn summary_into(sim: &Sim, viewer: PlayerId, out: &mut Option<SummaryView>) {
    let Some(s) = crate::build_summary::build_summary(sim, viewer) else {
        *out = None;
        return;
    };
    let view = out.get_or_insert_with(SummaryView::default);
    view.gains = [
        s.offense,
        s.soul_offense,
        s.damage,
        s.attack_speed,
        s.life_steal,
        s.health,
        s.defense,
        s.soul_defense,
        s.move_speed,
    ];
    view.mob_rows.clear();
    view.mob_rows
        .extend(s.mob_rows.iter().flatten().filter_map(|r| {
            hud_stat(r.stat).map(|stat| SummaryMobRow {
                mob: r.mob,
                stacks: r.stacks,
                stat,
                total: r.total,
            })
        }));
}

/// One seated player of the match roster (ADR0026).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RosterRow {
    pub id: PlayerId,
    pub name: String,
    pub bot: bool,
}

/// Refreshes `out` to the seated players, reusing its rows and name buffers (no allocation while the roster is steady).
pub(super) fn roster_into(sim: &Sim, out: &mut Vec<RosterRow>) {
    let players = sim.players();
    out.truncate(players.len());
    for (i, p) in players.iter().enumerate() {
        if let Some(row) = out.get_mut(i) {
            row.id = p.id;
            row.bot = p.seat.bot;
            if row.name != p.seat.name {
                row.name.clone_from(&p.seat.name);
            }
        } else {
            out.push(RosterRow {
                id: p.id,
                name: p.seat.name.clone(),
                bot: p.seat.bot,
            });
        }
    }
    if !out.is_sorted_by_key(|r| r.id) {
        out.sort_unstable_by_key(|r| r.id);
    }
}

/// P-AUG-NATIVE-5: refreshes `out` to every `Alive` Marked Man holder's body position, by ascending id, the same for
/// every viewer and whatever its vision (the minimap marker, deliberately public). Reuses `out` (no allocation once warm).
pub(super) fn marked_into(sim: &Sim, out: &mut Vec<MarkedView>) {
    out.clear();
    for p in sim.players() {
        if p.status == Status::Alive && crate::cards::native::holds_marked_man(&p.build) {
            out.push(MarkedView {
                id: p.id,
                x: p.body.x,
                y: p.body.y,
            });
        }
    }
    if !out.is_sorted_by_key(|r| r.id) {
        out.sort_unstable_by_key(|r| r.id);
    }
}
