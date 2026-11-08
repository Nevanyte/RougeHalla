//! The legacy bots' mob-hunt rules (packages/server/src/bots/mobHunt.ts and brain/huntAdapter.ts), pure:
//! the MOB_HUNT tunables and their per-tier/persona derivation, the weapon-vs-mob edge rules, the retreat point and the
//! "no mob in reach" answer. The stateful MobHunter (engagement, bans, retreat timers, tracker) and createHuntAdapter
//! are the P-BOTS-4 remainder: they need the brain's memory/percept frames this slice does not port.
//!
//! This module reads only static shared content (the weapon loop and the region default weapons through rh-sim's public
//! content/mob catalog) and has no clock, I/O or entropy: every answer is a pure function of its arguments, so bot seats
//! stay deterministic and live/headless agree (C-DET, C-POLICY).
use crate::bots::types::{PersonaParams, TierParams};
use rh_sim::content::{FactionId, WeaponId};
use rh_sim::mob_catalog;
use rh_sim::{math, Vec2};

/// The source designed weapon loop (shared/weapons.ts WEAPON_BEATS): each loop weapon beats exactly two others, the
/// base for the bots' edge rules. It is decision data only (no simulation outcome reads it), so it stays out of rh-sim's
/// content hash; the policy parity corpus pins every pair.
const WEAPON_BEATS: [(WeaponId, WeaponId); 10] = [
    (WeaponId::Sword, WeaponId::Axe),
    (WeaponId::Sword, WeaponId::Wand),
    (WeaponId::Bow, WeaponId::Sword),
    (WeaponId::Bow, WeaponId::Axe),
    (WeaponId::Wand, WeaponId::Bow),
    (WeaponId::Wand, WeaponId::Shield),
    (WeaponId::Shield, WeaponId::Sword),
    (WeaponId::Shield, WeaponId::Bow),
    (WeaponId::Axe, WeaponId::Wand),
    (WeaponId::Axe, WeaponId::Shield),
];

/// +1 when a beats b in the weapon loop, -1 when b beats a, 0 for a mirror or for fists (shared/weapons.ts
/// weaponEdge).
pub fn weapon_edge(a: WeaponId, b: WeaponId) -> i8 {
    for (wins, loses) in WEAPON_BEATS {
        if wins == a && loses == b {
            return 1;
        }
        if wins == b && loses == a {
            return -1;
        }
    }
    0
}

/// A weapon that fights with a projectile (shared/weapons.ts isRanged), which the bots' kiter rules read.
pub fn is_ranged(weapon: WeaponId) -> bool {
    matches!(
        rh_sim::content::weapon(weapon).shape,
        rh_sim::content::Shape::Projectile { .. }
    )
}

/// The legacy tile size the retreat headings step by (shared/constants.ts TILE).
const TILE: f64 = rh_sim::constants::TILE;

/// The part of the source MobLike the hunt's weapon rules read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MobLike<'a> {
    /// The mob's in-hand weapon definition string (empty when unknown).
    pub weapon0: &'a str,
    /// The mob's faction id string (sometimes empty or unknown).
    pub faction: &'a str,
}

/// The weapon a mob fights with: its own, else its region's (mobHunt.ts mobWeapon).
pub fn mob_weapon(mob: MobLike<'_>) -> Option<WeaponId> {
    WeaponId::parse(mob.weapon0)
        .or_else(|| FactionId::parse(mob.faction).map(mob_catalog::mob_weapon))
}

/// Does mine do nothing against a mob that carries theirs? Either the mob's guard stops it or it stops the mob
/// (mobHunt.ts useless): such fights run out the clock, so the hunt never starts them.
pub fn useless(mine: WeaponId, theirs: WeaponId) -> bool {
    if theirs == WeaponId::Shield {
        return matches!(mine, WeaponId::Sword | WeaponId::Bow | WeaponId::Shield);
    }
    if mine == WeaponId::Shield {
        return matches!(theirs, WeaponId::Sword | WeaponId::Bow);
    }
    if theirs == WeaponId::Wand {
        return mine == WeaponId::Bow;
    }
    if theirs == WeaponId::Axe {
        return mine == WeaponId::Wand;
    }
    false
}

/// The best weapon edge any carried weapon that is not useless has against theirs: 1 beats, 0 mirror or neutral, -1
/// loses, -2 when every carried weapon is useless. Carrying nothing fights on fists: neutral and never useless
/// (mobHunt.ts bestEdge).
pub fn best_edge(weapons: &[Option<WeaponId>], theirs: WeaponId) -> i8 {
    if weapons.iter().all(Option::is_none) {
        return weapon_edge(WeaponId::Fists, theirs);
    }
    let mut best = -2;
    for weapon in weapons.iter().flatten() {
        if useless(*weapon, theirs) {
            continue;
        }
        best = best.max(weapon_edge(*weapon, theirs));
    }
    best
}

/// Which of two slots to hold against a mob carrying theirs: the better edge, a useless weapon last; the current slot
/// on a tie; an empty slot never (mobHunt.ts bestSlotVsMob).
pub fn best_slot_vs_mob(slots: [Option<WeaponId>; 2], current: u8, theirs: Option<WeaponId>) -> u8 {
    let score = |weapon: Option<WeaponId>| -> f64 {
        match weapon {
            None => f64::NEG_INFINITY,
            Some(weapon) => match theirs {
                None => 0.,
                Some(theirs) if useless(weapon, theirs) => -2.,
                Some(theirs) => f64::from(weapon_edge(weapon, theirs)),
            },
        }
    };
    let current = current.min(1);
    let other = 1 - current;
    if score(slots[usize::from(other)]) > score(slots[usize::from(current)]) {
        other
    } else {
        current
    }
}

/// Where to run to get away from threats (awake mobs, standing players): the walkable point among sixteen headings at
/// two distances that ends farthest from the nearest threat; none when nothing is walkable (mobHunt.ts retreatPoint).
/// walkable is the caller's movement predicate (the path service's clear check, or the shared segment sweep).
pub fn retreat_point(
    self_pos: Vec2,
    threats: &[Vec2],
    walkable: impl Fn(Vec2, Vec2) -> bool,
) -> Option<Vec2> {
    let mut best = None;
    let mut best_score = f64::NEG_INFINITY;
    for step in [7. * TILE, 4. * TILE] {
        for i in 0..16 {
            let angle = (i as f64) * math::PI / 8.;
            let at = Vec2::new(
                self_pos.x + math::cos(angle) * step,
                self_pos.y + math::sin(angle) * step,
            );
            if !walkable(self_pos, at) {
                continue;
            }
            let mut nearest = f64::INFINITY;
            for threat in threats {
                nearest = nearest.min(distance(at, *threat));
            }
            let score = nearest.min(1e6) + step * 0.25;
            if score > best_score {
                best_score = score;
                best = Some(at);
            }
        }
    }
    best
}

fn distance(a: Vec2, b: Vec2) -> f64 {
    math::hypot(a.x - b.x, a.y - b.y)
}

/// One bot's mob-hunt tunables (mobHunt.ts MobHuntConfig, in the source field order).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MobHuntConfig {
    /// A standing player this close (u) is hunted instead of mobs...
    pub player_threat: f64,
    /// ...until it is this far, and one that hit us is a threat inside this range (a bow's reach).
    pub player_release: f64,
    pub under_fire_range: f64,
    /// A hit by a player within this long (ms) counts as "being shot".
    pub under_fire_ms: f64,
    /// Mobs farther than this in a straight line are not considered...
    pub reach: f64,
    /// ...except for a bot that has not killed a mob yet, which will walk this far (u) for its first.
    pub first_reach: f64,
    pub walk_slack: f64,
    /// Walking distances are computed for this many of the nearest candidates only.
    pub max_candidates: u32,
    /// No new mob fight below this hp share.
    pub start_min_hp: f64,
    /// Elites need this much card power or per-type normal mob kills, unless at this hp share.
    pub elite_min_power: f64,
    pub elite_full_hp: f64,
    /// The share of its hp the bot's faction keeps in a straight duel with the mob must reach the normal/elite bar.
    pub mob_min_share: f64,
    pub elite_min_share: f64,
    pub elite_sure_share: f64,
    pub elite_sure_power: f64,
    /// Below this hp share, on a mob with an awake one within retreat_clear, the bot retreats.
    pub retreat_hp: f64,
    pub retreat_clear: f64,
    pub retreat_min_ms: f64,
    pub retreat_max_ms: f64,
    pub retreat_ban_ms: f64,
    /// Mob kills after which the bot stops farming, and the most time a run may spend with a mob focus.
    pub kill_goal: f64,
    pub focus_budget_ms: f64,
    /// A target is dropped after: this long since picked; this long attacking without hurting it; this long not
    /// attacking without hurting it.
    pub target_budget_ms: f64,
    pub stall_attack_ms: f64,
    pub approach_ms: f64,
    /// How long a dropped target is left alone: one that went home / one that never got hurt.
    pub return_ban_ms: f64,
    pub stall_ban_ms: f64,
    /// A mob this far (u) from where it was first seen is awake (it left its camp).
    pub awake_moved: f64,
    /// Leave mobs that fight from range alone.
    pub skip_ranged: bool,
    /// After a pick found nothing, look again no sooner than this.
    pub repick_ms: f64,
}

/// The source defaults (mobHunt.ts MOB_HUNT), unchanged.
pub const MOB_HUNT: MobHuntConfig = MobHuntConfig {
    player_threat: 250.,
    player_release: 450.,
    under_fire_range: 520.,
    under_fire_ms: 1500.,
    reach: 700.,
    first_reach: 1100.,
    walk_slack: 1.25,
    max_candidates: 6,
    start_min_hp: 0.5,
    elite_min_power: 4.,
    elite_full_hp: 0.9,
    mob_min_share: 0.5,
    elite_min_share: 0.3,
    elite_sure_share: 0.2,
    elite_sure_power: 6.,
    retreat_hp: 0.35,
    retreat_clear: 320.,
    retreat_min_ms: 1500.,
    retreat_max_ms: 5000.,
    retreat_ban_ms: 15_000.,
    kill_goal: 5.,
    focus_budget_ms: 900_000.,
    target_budget_ms: 60_000.,
    stall_attack_ms: 3000.,
    approach_ms: 12_000.,
    return_ban_ms: 8000.,
    stall_ban_ms: 30_000.,
    awake_moved: 40.,
    skip_ranged: true,
    repick_ms: 400.,
};

/// A farmer puts up with more attrition than a hunter: the hp share it needs to start a mob fight is lower by this x
/// persona.pve (huntAdapter.ts PVE_RELIEF).
pub const PVE_RELIEF: f64 = 0.25;

/// mobHunt's why when it looked and found no mob worth taking: the only "player" answer that says go and find one.
pub const NO_MOB_IN_REACH: &str = "no mob in reach";

/// The hunt's answer for one think (mobHunt.ts HuntDecision).
#[derive(Clone, Debug, PartialEq)]
pub enum HuntDecision {
    Player { why: String },
    Mob { id: String, why: String },
    Retreat { from: Vec<Vec2>, why: String },
}

/// True when the answer says "no mob in reach": the bot may look for camps farther away (huntAdapter.ts wantsMobs).
pub fn wants_mobs(decision: &HuntDecision) -> bool {
    matches!(decision, HuntDecision::Player { why } if why == NO_MOB_IN_REACH)
}

/// The hunt's tunables for one bot: mobHunt's defaults, with the persona's thresholds and the tier's route quality
/// (huntAdapter.ts huntConfigFor).
pub fn hunt_config_for(tier: &TierParams, persona: &PersonaParams) -> MobHuntConfig {
    MobHuntConfig {
        kill_goal: persona.mob_kill_goal,
        retreat_hp: persona.flee_hp,
        player_threat: persona.player_threat,
        // A threat radius past the default release distance would never let go of the player lock.
        player_release: MOB_HUNT.player_release.max(persona.player_threat + 50.),
        // Starting a mob fight at an hp that would retreat from it at once only costs the 40 s ban.
        start_min_hp: (persona.flee_hp + 0.05)
            .max(tier.caution.start_hp - PVE_RELIEF * persona.pve),
        mob_min_share: tier.caution.mob_share,
        elite_min_share: tier.caution.elite_share,
        reach: tier.route.reach,
        first_reach: 1.6 * tier.route.reach,
        max_candidates: tier.route.horizon,
        ..MOB_HUNT
    }
}
