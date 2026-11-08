//! The brain's Knowledge layer (source brain/knowledge.ts): the counter wheels as one bot knows them, the mob matchup
//! share with its fixed per-bot error, and the fight odds the strategy and tactics share. Everything is drawn once at
//! creation from the bot's decide stream (ten faction masks, ten weapon masks, then one share error per me/region/elite
//! triple), so a replay of the same seed knows the same wheels; nothing here reads a clock or the world.
use crate::bots::mob_hunt::weapon_edge as true_weapon_edge;
use crate::bots::planning::matchup_share;
use crate::bots::random::Rng;
use crate::bots::types::{BotWeapon, FightOdds, OpponentSnapshot, SelfView, TierParams};
use rh_sim::FactionId;

/// The clamp of the odds' score and lead terms (knowledge.ts MAX_EDGE).
const MAX_EDGE: f64 = 2.;

/// The ten unordered faction pairs, in the source FACTION_PAIRS order (shared/factions.ts). The faction rework removed
/// the counter cycle (every true faction edge is 0), so the table only names the wheels the masks are drawn for.
const FACTION_PAIRS: [(FactionId, FactionId); 10] = [
    (FactionId::Fire, FactionId::Sentenced),
    (FactionId::Fire, FactionId::Plague),
    (FactionId::Sentenced, FactionId::Plague),
    (FactionId::Sentenced, FactionId::Frost),
    (FactionId::Plague, FactionId::Frost),
    (FactionId::Plague, FactionId::Holy),
    (FactionId::Frost, FactionId::Holy),
    (FactionId::Frost, FactionId::Fire),
    (FactionId::Holy, FactionId::Fire),
    (FactionId::Holy, FactionId::Sentenced),
];

/// The ten weapon loop pairs, in the source WEAPON_BEATS order (shared/weapons.ts); the true edge comes from the ported
/// mob_hunt wheel, so the pair is listed here exactly once for the mask.
const WEAPON_PAIRS: [(BotWeapon, BotWeapon); 10] = [
    (BotWeapon::Sword, BotWeapon::Axe),
    (BotWeapon::Sword, BotWeapon::Wand),
    (BotWeapon::Bow, BotWeapon::Sword),
    (BotWeapon::Bow, BotWeapon::Axe),
    (BotWeapon::Wand, BotWeapon::Bow),
    (BotWeapon::Wand, BotWeapon::Shield),
    (BotWeapon::Shield, BotWeapon::Sword),
    (BotWeapon::Shield, BotWeapon::Bow),
    (BotWeapon::Axe, BotWeapon::Wand),
    (BotWeapon::Axe, BotWeapon::Shield),
];

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    f64::min(hi, f64::max(lo, v))
}

/// The wheel index a pair belongs to, either way round (a mirror is in no row).
fn pair_index<T: PartialEq + Copy>(pairs: &[(T, T)], a: T, b: T) -> Option<usize> {
    pairs
        .iter()
        .position(|(w, l)| (*w == a && *l == b) || (*w == b && *l == a))
}

fn weapon_id(w: BotWeapon) -> rh_sim::WeaponId {
    match w {
        BotWeapon::Sword => rh_sim::WeaponId::Sword,
        BotWeapon::Bow => rh_sim::WeaponId::Bow,
        BotWeapon::Wand => rh_sim::WeaponId::Wand,
        BotWeapon::Axe => rh_sim::WeaponId::Axe,
        BotWeapon::Shield => rh_sim::WeaponId::Shield,
        BotWeapon::Fists => rh_sim::WeaponId::Fists,
    }
}

/// The faction wheel's true edge: 0 for every pair since the faction rework (shared/signatures.ts factionEdge).
fn true_faction_edge(_a: FactionId, _b: FactionId) -> i8 {
    0
}

fn share_key(me: FactionId, region: FactionId, elite: bool) -> usize {
    (me as usize) * 10 + (region as usize) * 2 + usize::from(elite)
}

/// One bot's Knowledge (types.ts Knowledge): immutable after creation.
#[derive(Clone, Debug, PartialEq)]
pub struct Knowledge {
    faction_known: [bool; 10],
    weapon_known: [bool; 10],
    share_error: [f64; 50],
}

impl Knowledge {
    /// Source createKnowledge(tier, rng): ten faction draws, ten weapon draws, then 50 fixed share errors, in that order.
    pub fn create(tier: &TierParams, rng: &mut Rng) -> Self {
        Self::create_with(tier.knowledge, tier.mob_share_noise, rng)
    }

    /// The same creation over explicit tier numbers (the parity corpus declares the overrides it captures).
    pub fn create_with(knowledge: f64, mob_share_noise: f64, rng: &mut Rng) -> Self {
        let mut faction_known = [false; 10];
        for known in &mut faction_known {
            *known = rng.next_f64() < knowledge;
        }
        let mut weapon_known = [false; 10];
        for known in &mut weapon_known {
            *known = rng.next_f64() < knowledge;
        }
        let mut share_error = [0.; 50];
        for me in FactionId::ALL {
            for region in FactionId::ALL {
                for elite in [false, true] {
                    let error = (rng.next_f64() * 2. - 1.) * mob_share_noise;
                    share_error[share_key(me, region, elite)] = error;
                }
            }
        }
        Self {
            faction_known,
            weapon_known,
            share_error,
        }
    }

    fn faction_is_known(&self, a: FactionId, b: FactionId) -> bool {
        match pair_index(&FACTION_PAIRS, a, b) {
            None => true, // a mirror has nothing to learn
            Some(i) => self.faction_known[i],
        }
    }

    fn weapon_is_known(&self, a: BotWeapon, b: BotWeapon) -> bool {
        match pair_index(&WEAPON_PAIRS, a, b) {
            None => true,
            Some(i) => self.weapon_known[i],
        }
    }

    /// The faction edge as far as this bot knows it (always 0: every true faction edge is 0 after the rework).
    pub fn faction_edge(&self, a: FactionId, b: FactionId) -> i8 {
        if self.faction_is_known(a, b) {
            true_faction_edge(a, b)
        } else {
            0
        }
    }

    /// The weapon edge as far as this bot knows it.
    pub fn weapon_edge(&self, a: BotWeapon, b: BotWeapon) -> i8 {
        if self.weapon_is_known(a, b) {
            true_weapon_edge(weapon_id(a), weapon_id(b))
        } else {
            0
        }
    }

    /// Source mobShare: the shared planning matchupShare plus this bot's fixed error, clamped into 0..1.
    pub fn mob_share(&self, me: FactionId, region: FactionId, elite: bool) -> f64 {
        clamp(
            matchup_share(me, region, elite) + self.share_error[share_key(me, region, elite)],
            0.,
            1.,
        )
    }

    /// Source odds(me, them): the known wheels' score (or the tint's sign x 2 x |tint| when the wheels are partial),
    /// plus twice the hp-share lead, clamped to -2..+2, with the source debug line.
    pub fn odds(&self, me: &SelfView, them: &OpponentSnapshot) -> FightOdds {
        let mine = me.weapons[usize::from(me.slot.min(1))];
        let mut score = 0.;
        let mut faction_ok = false;
        let mut weapon_ok = false;
        if let (Some(mf), Some(tf)) = (me.faction, them.faction) {
            score += f64::from(self.faction_edge(mf, tf));
            faction_ok = self.faction_is_known(mf, tf);
        }
        if let (Some(mw), Some(tw)) = (mine, them.in_hand) {
            score += f64::from(self.weapon_edge(mw, tw));
            weapon_ok = self.weapon_is_known(mw, tw);
        }
        let known = faction_ok && weapon_ok;
        let mut source = if known { "known" } else { "partial" };
        if !known && them.tint != 0. {
            score = them.tint.signum() * MAX_EDGE * them.tint.abs();
            source = "tint";
        }
        let lead = if me.max_hp > 0. {
            me.hp / me.max_hp - them.hp_frac
        } else {
            0.
        };
        let lead_term = clamp(2. * lead, -MAX_EDGE, MAX_EDGE);
        FightOdds {
            edge: clamp(score + lead_term, -MAX_EDGE, MAX_EDGE),
            score: clamp(score, -MAX_EDGE, MAX_EDGE),
            known,
            // Source knowledge.ts uses Number.toFixed(2): JavaScript's decimal ties round away from zero, which
            // Rust's formatter does not reproduce (0.125 formats as 0.12 there and 0.13 in JavaScript).
            why: format!(
                "{source} {}, hp lead {}",
                rh_sim::kill_augments::js_to_fixed(score, 2),
                rh_sim::kill_augments::js_to_fixed(lead_term, 2)
            ),
        }
    }
}
