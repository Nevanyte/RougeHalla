//! The planning feature module (P-BOTS-3 remainder, source brain/modules/planning.ts): the bot uses the planning screen
//! as a person does. It reads the private deal, waits out the tier's reading time, picks the better of the two spawns by
//! the shared planning maths, answers a start boon, and presses Ready a moment after its last choice and before the timer;
//! an unanswered pick is re-sent a few times at most. With no deal it presses Ready and takes what the server gives.
//!
//! The spawn maths is the shared pair the source imports: the reference duel (shared/factions.ts), mobFaction
//! (shared/mobs.ts), campMatchup/nearestCamps (shared/planning.ts) and planSpawnScore/planPick (bots/mobHunt.ts). This file
//! is that pure layer plus the module state machine, so the pinned-container corpus can compare it value for value through
//! declared inputs. It reads no server state; the seat turns its intents into PublicCommand::Plan on the validated path.
use crate::bots::random::{pick_option, uniform, Rng};
use crate::bots::types::{TierId, TierParams};
use rh_sim::constants::{
    ELITE_DMG_MULT, ELITE_HP_MULT, ELITE_K, FIRE_BACKLASH, FIRE_BURN_DPS, FROST_SLOW,
    HOLY_LEECH_BASE, HOLY_LEECH_CAP, HOLY_LEECH_MISSING, MARK_BASE_PCT, MARK_KILL_PCT,
    MARK_TIER_HITS, MARK_TOP_TIER, MOB_DMG_MULT, MOB_HP_MULT, MOB_K, PLAGUE_DPS,
    PLAGUE_EXECUTE_DPS,
};
use rh_sim::mapdata::Zone;
use rh_sim::{Arena, FactionId, WeaponId};

/// The live planning window the module scales its reading/settling times against (shared constants PLAN_SECONDS).
pub const PLAN_SECONDS_MS: f64 = 45_000.;
/// How many of the camps nearest a spawn the planning weighs (mobHunt.ts).
pub const PLAN_CAMPS: usize = 2;
/// A camp whose weapon makes the bot's useless counts this much of its matchup (mobHunt.ts).
pub const PLAN_USELESS_WEIGHT: f64 = 0.25;
/// The stats file weight/cap for a learned choice bias (types.ts LEARN.weight / LEARN.cap).
const LEARN_WEIGHT: f64 = 0.3;
const LEARN_CAP: f64 = 0.25;
/// Source FACTIONS params that are the identity in the shipped sheet; mirrored so the reference duel is the code.
const MARK_AMP: f64 = 1.;
const MARK_TAX_KEEP: f64 = 1.;
const MARK_TAX_CAP: f64 = 99.;
const MARK_SUPPRESS: f64 = 1.;
/// shared mark.ts MARK_TAX_THRESHOLD.
const MARK_TAX_THRESHOLD: f64 = 2.;

/// The module's timing numbers: milliseconds of a PLAN_SECONDS window per tier, plus the shared fractions.
pub struct PlanRules {
    pub read: [(f64, f64); 3],
    pub settle: [(f64, f64); 3],
    pub read_share: f64,
    pub ready_before_ms: f64,
    pub ready_before_share: f64,
    pub no_deal_ms: f64,
    pub resend_ms: f64,
    pub max_asks: u32,
}
pub const PLAN_RULES: PlanRules = PlanRules {
    read: [(4000., 8000.), (3000., 6000.), (2000., 4000.)],
    settle: [(800., 2200.), (500., 1400.), (300., 800.)],
    read_share: 0.55,
    ready_before_ms: 2500.,
    ready_before_share: 0.3,
    no_deal_ms: 1000.,
    resend_ms: 400.,
    max_asks: 3,
};
fn tier_index(tier: TierId) -> usize {
    match tier {
        TierId::Easy => 0,
        TierId::Normal => 1,
        TierId::Hard => 2,
    }
}
/// The region's default mob weapon (shared/map.ts REGION_WEAPONS): what a camp's mobs carry without a type.
pub fn region_weapon(zone: Zone) -> WeaponId {
    match zone {
        Zone::Fire => WeaponId::Axe,
        Zone::Sentenced => WeaponId::Sword,
        Zone::Plague => WeaponId::Bow,
        Zone::Frost => WeaponId::Shield,
        Zone::Holy => WeaponId::Wand,
    }
}
pub fn zone_faction(zone: Zone) -> FactionId {
    match zone {
        Zone::Fire => FactionId::Fire,
        Zone::Sentenced => FactionId::Sentenced,
        Zone::Plague => FactionId::Plague,
        Zone::Frost => FactionId::Frost,
        Zone::Holy => FactionId::Holy,
    }
}

// -------------------------------------------------------------------------------------------- reference duel and matchup
// shared/factions.ts, shared/mobs.ts, shared/mark.ts and shared/signatureShares.ts: the subset matchupShare reads.

#[derive(Clone, Copy, Debug, PartialEq)]
enum Mechanic {
    Dragonslayer,
    Marked,
    RatKing,
    Plain,
}
#[derive(Clone, Copy, Debug, Default)]
struct Params {
    burn: f64,
    backlash: f64,
    plague: f64,
    execute: f64,
    mark_pct: f64,
    mark_kill: f64,
    mark_amp: f64,
    tier_hits: f64,
    tax_keep: f64,
    tax_cap: f64,
    suppress: f64,
}
#[derive(Clone, Copy, Debug)]
struct DuelSpec {
    hp: f64,
    rate: f64,
    hit: f64,
    phys: f64,
    true_share: f64,
    armor: f64,
    shield: f64,
    mechanic: Mechanic,
    /// wall_of_ice slow share (0 = no aura).
    slow: f64,
    /// radiant (ls0, ls1, cap) or zeroes.
    sustain: (f64, f64, f64),
    params: Params,
}
fn player_spec(f: FactionId) -> DuelSpec {
    let base = rh_sim::content::faction(f);
    let mut spec = DuelSpec {
        hp: base.hp,
        rate: base.rate,
        hit: base.hit,
        phys: base.phys,
        true_share: base.true_share,
        armor: base.armor,
        shield: base.shield,
        mechanic: Mechanic::Plain,
        slow: 0.,
        sustain: (0., 0., 0.),
        params: Params::default(),
    };
    match f {
        FactionId::Fire => {
            spec.mechanic = Mechanic::Dragonslayer;
            spec.params.burn = FIRE_BURN_DPS;
            spec.params.backlash = FIRE_BACKLASH;
        }
        FactionId::Sentenced => {
            spec.mechanic = Mechanic::Marked;
            spec.params.mark_pct = MARK_BASE_PCT;
            spec.params.mark_kill = MARK_KILL_PCT;
            spec.params.mark_amp = MARK_AMP;
            spec.params.tier_hits = MARK_TIER_HITS;
            spec.params.tax_keep = MARK_TAX_KEEP;
            spec.params.tax_cap = MARK_TAX_CAP;
            spec.params.suppress = MARK_SUPPRESS;
        }
        FactionId::Plague => {
            spec.mechanic = Mechanic::RatKing;
            spec.params.plague = PLAGUE_DPS;
            spec.params.execute = PLAGUE_EXECUTE_DPS;
        }
        FactionId::Frost => spec.slow = FROST_SLOW,
        FactionId::Holy => spec.sustain = (HOLY_LEECH_BASE, HOLY_LEECH_MISSING, HOLY_LEECH_CAP),
    }
    spec
}
/// shared/factions.ts scaledFaction: multiplies hp, hit and every point-damage param by k.
fn scaled(spec: &DuelSpec, k: f64) -> DuelSpec {
    let mut out = *spec;
    out.hp = spec.hp * k;
    out.hit = spec.hit * k;
    out.params.burn = spec.params.burn * k;
    out.params.backlash = spec.params.backlash * k;
    out.params.plague = spec.params.plague * k;
    out.params.execute = spec.params.execute * k;
    out
}
/// shared/mobs.ts mobFaction: the region's faction as a regional mob fights it.
fn mob_faction(region: FactionId, elite: bool) -> DuelSpec {
    let k = if elite { ELITE_K } else { MOB_K };
    let base = scaled(&player_spec(region), k);
    let hp_mult = MOB_HP_MULT * if elite { ELITE_HP_MULT } else { 1. };
    let d = MOB_DMG_MULT * if elite { ELITE_DMG_MULT } else { 1. };
    let mut out = scaled(&base, d);
    out.hp = base.hp * hp_mult;
    // The mob owner's hand scaling on top (shared/mobs.ts mobFaction tail): an execute scales by k again, and the mark's
    // shares of the PLAYER's hp scale by k x d because they are not the mob's own hp shares.
    out.params.execute *= k;
    let base_spec = player_spec(region);
    out.params.mark_pct = base_spec.params.mark_pct * k * d;
    out.params.mark_kill = base_spec.params.mark_kill * k * d;
    out
}
fn mark_tier_of(progress: f64, swap_steps: f64, tier_hits: f64) -> u8 {
    if progress <= 0. && swap_steps <= 0. {
        return 0;
    }
    let by_hits = (f64::max(0., progress) / tier_hits + 1e-9).floor();
    let tier = 1. + f64::max(by_hits, swap_steps.floor());
    tier.min(f64::from(MARK_TOP_TIER)) as u8
}
fn taxed_rate(rate: f64, keep: f64, cap: f64) -> f64 {
    if rate <= MARK_TAX_THRESHOLD {
        return rate;
    }
    cap.min(MARK_TAX_THRESHOLD + (rate - MARK_TAX_THRESHOLD) * keep)
}
#[derive(Clone, Copy)]
struct CombatState {
    own_hp_frac: f64,
    foe_hp_frac: f64,
    foe_max_hp: f64,
    own_hits: f64,
    own_stacks: f64,
    own_base_rate: f64,
    foe_rate: f64,
}
#[derive(Clone, Copy, PartialEq)]
enum PartKind {
    Burn,
    Backlash,
    Disease,
    Mark,
}
struct Part {
    kind: PartKind,
    v: f64,
    execute: bool,
}
fn bonus_parts(spec: &DuelSpec, s: &CombatState) -> Vec<Part> {
    match spec.mechanic {
        Mechanic::Dragonslayer => vec![
            Part {
                kind: PartKind::Burn,
                v: spec.params.burn,
                execute: false,
            },
            Part {
                kind: PartKind::Backlash,
                v: spec.params.backlash,
                execute: false,
            },
        ],
        Mechanic::RatKing => vec![
            Part {
                kind: PartKind::Disease,
                v: spec.params.plague,
                execute: false,
            },
            Part {
                kind: PartKind::Disease,
                v: spec.params.execute * f64::max(0., 0.5 - s.foe_hp_frac),
                execute: true,
            },
        ],
        Mechanic::Marked => {
            let p = &spec.params;
            let tier = mark_tier_of(s.own_hits, 0., p.tier_hits);
            if tier == 0 {
                return Vec::new();
            }
            let pct = p.mark_pct + p.mark_kill * s.own_stacks;
            let amp = if tier >= MARK_TOP_TIER {
                p.mark_amp
            } else {
                1.
            };
            vec![Part {
                kind: PartKind::Mark,
                v: s.own_base_rate * pct * s.foe_max_hp * amp,
                execute: false,
            }]
        }
        Mechanic::Plain => Vec::new(),
    }
}
fn magic_share(spec: &DuelSpec) -> f64 {
    f64::max(0., 1. - spec.phys - spec.true_share)
}
fn mitigate(raw: f64, atk: &DuelSpec, dfn: &DuelSpec) -> f64 {
    raw * (atk.phys / (1. + dfn.armor / 100.)
        + magic_share(atk) / (1. + dfn.shield / 100.)
        + atk.true_share)
}
fn mitigate_part(raw: f64, kind: PartKind, dfn: &DuelSpec) -> f64 {
    let (phys, magic, true_) = match kind {
        PartKind::Burn | PartKind::Disease => (0., 1., 0.),
        PartKind::Backlash => (1., 0., 0.),
        PartKind::Mark => (0.4, 0.6, 0.),
    };
    raw * (phys / (1. + dfn.armor / 100.) + magic / (1. + dfn.shield / 100.) + true_)
}
fn lifesteal_fraction(spec: &DuelSpec, own_hp_frac: f64) -> f64 {
    let (ls0, ls1, cap) = spec.sustain;
    if ls0 == 0. {
        return 0.;
    }
    cap.min(ls0 + ls1 * (1. - own_hp_frac))
}
fn pressure(spec: &DuelSpec, s: &CombatState) -> (f64, f64, bool) {
    if spec.mechanic != Mechanic::Marked {
        return (s.foe_rate, 1., false);
    }
    let p = &spec.params;
    let tier = mark_tier_of(s.own_hits, 0., p.tier_hits);
    (
        if tier >= 2 {
            taxed_rate(s.foe_rate, p.tax_keep, p.tax_cap)
        } else {
            s.foe_rate
        },
        if tier >= 3 { p.suppress } else { 1. },
        tier >= MARK_TOP_TIER,
    )
}
fn state_of(
    f: &[DuelSpec; 2],
    hp: &[f64; 2],
    hits: &[f64; 2],
    stacks: &[f64; 2],
    rate: &[f64; 2],
    i: usize,
) -> CombatState {
    let o = 1 - i;
    CombatState {
        own_hp_frac: f64::max(hp[i], 0.) / f[i].hp,
        foe_hp_frac: f64::max(hp[o], 0.) / f[o].hp,
        foe_max_hp: f[o].hp,
        own_hits: hits[i],
        own_stacks: stacks[i],
        own_base_rate: f[i].rate,
        foe_rate: rate[o],
    }
}
#[derive(Clone, Copy, Debug)]
pub struct DuelResult {
    /// 0 = a wins, 1 = b wins, None = draw or the tMax cap.
    pub winner: Option<usize>,
    pub t: f64,
    pub hp_a: f64,
    pub hp_b: f64,
}
fn duel(a: &DuelSpec, b: &DuelSpec, dt: f64, t_max: f64) -> DuelResult {
    let f = [*a, *b];
    let mut hp = [a.hp, b.hp];
    let mut hits = [0., 0.];
    let mut stacks = [0., 0.];
    let mut t = 0.;
    while t < t_max {
        let mut rate = [f[0].rate, f[1].rate];
        let mut chill = [1., 1.];
        for i in 0..2 {
            chill[1 - i] = if f[i].slow > 0. { 1. - f[i].slow } else { 1. };
            rate[1 - i] *= chill[1 - i];
        }
        let press = [
            pressure(&f[0], &state_of(&f, &hp, &hits, &stacks, &rate, 0)),
            pressure(&f[1], &state_of(&f, &hp, &hits, &stacks, &rate, 1)),
        ];
        for i in 0..2 {
            rate[1 - i] = press[i].0;
        }
        let mut out = [0., 0.];
        let mut heal = [0., 0.];
        let mut denied = [false, false];
        for i in 0..2 {
            let o = 1 - i;
            let st = state_of(&f, &hp, &hits, &stacks, &rate, i);
            let cut = press[o].1;
            let mut plain = mitigate(rate[i] * f[i].hit * dt, &f[i], &f[o]) * cut;
            let mut exe = 0.;
            for part in bonus_parts(&f[i], &st) {
                let d = mitigate_part(part.v * chill[i] * dt, part.kind, &f[o]) * cut;
                if part.execute {
                    exe += d
                } else {
                    plain += d
                }
            }
            if exe > 0. && press[o].2 {
                let allowed = f64::max(0., f64::min(exe, hp[o] - 1. - plain));
                denied[o] = exe - allowed > 1e-12;
                exe = allowed;
            }
            let dealt = plain + exe;
            out[i] = dealt;
            heal[i] = (dealt / cut) * lifesteal_fraction(&f[i], st.own_hp_frac);
        }
        hp[0] = f64::min(f[0].hp, hp[0] - out[1] + heal[0]);
        hp[1] = f64::min(f[1].hp, hp[1] - out[0] + heal[1]);
        for i in 0..2 {
            hits[i] += f[i].rate * dt;
            if denied[i] && stacks[i] < 1. {
                stacks[i] = 1.;
            }
        }
        t += dt;
        if hp[0] <= 0. || hp[1] <= 0. {
            if hp[0] <= 0. && hp[1] <= 0. {
                return DuelResult {
                    winner: None,
                    t,
                    hp_a: 0.,
                    hp_b: 0.,
                };
            }
            let winner = if hp[1] <= 0. { Some(0) } else { Some(1) };
            return DuelResult {
                winner,
                t,
                hp_a: f64::max(hp[0], 0.),
                hp_b: f64::max(hp[1], 0.),
            };
        }
    }
    DuelResult {
        winner: None,
        t,
        hp_a: hp[0],
        hp_b: hp[1],
    }
}
/// shared/planning.ts matchupShare: the share of its own hp a player of me keeps after a straight duel with a regional
/// mob (0 for a loss or a draw), over the reference duel at dt 0.01.
pub fn matchup_share(me: FactionId, region: FactionId, elite: bool) -> f64 {
    let a = player_spec(me);
    let b = mob_faction(region, elite);
    let d = duel(&a, &b, 0.01, 120.);
    if d.winner == Some(0) {
        d.hp_a / a.hp
    } else {
        0.
    }
}
/// shared/planning.ts campMatchup: the matchup against one camp (an elite camp counts as its elite).
pub fn camp_matchup(me: FactionId, camp: &PlanCamp) -> f64 {
    matchup_share(me, zone_faction(camp.zone), camp.elite_spot >= 0)
}

// ----------------------------------------------------------------------------------------------------------- plan scoring

/// One camp of the declared planning map (the fields nearestCamps/campMatchup read).
#[derive(Clone, Debug, PartialEq)]
pub struct PlanCamp {
    pub id: String,
    pub zone: Zone,
    pub x: f64,
    pub y: f64,
    pub elite_spot: i32,
}
/// One spawn-pool entry of the declared planning map.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanSpawn {
    pub x: f64,
    pub y: f64,
    pub zone: Zone,
}
/// The planning screen's map view: the camps and the spawn pool the shared maths reads.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlanMap {
    pub camps: Vec<PlanCamp>,
    pub spawn_pool: Vec<PlanSpawn>,
}
impl PlanMap {
    /// Read the camps and spawn pool off the admitted map layers (public static data).
    pub fn from_arena(arena: &Arena) -> Self {
        let Some(layers) = arena.map.layers() else {
            return Self::default();
        };
        let data = layers.data();
        Self {
            camps: data
                .camps
                .iter()
                .map(|c| PlanCamp {
                    id: c.id.clone(),
                    zone: c.zone,
                    x: c.x,
                    y: c.y,
                    elite_spot: c.elite_spot,
                })
                .collect(),
            spawn_pool: data
                .spawn_pool
                .iter()
                .map(|s| PlanSpawn {
                    x: s.x,
                    y: s.y,
                    zone: s.zone,
                })
                .collect(),
        }
    }
}
/// shared/planning.ts nearestCamps: the camps nearest at, nearest first, at most n, ties by id.
pub fn nearest_camps(map: &PlanMap, at: (f64, f64), n: usize) -> Vec<&PlanCamp> {
    let mut camped: Vec<(&PlanCamp, f64)> = map
        .camps
        .iter()
        .map(|c| {
            (
                c,
                f64::sqrt((c.x - at.0) * (c.x - at.0) + (c.y - at.1) * (c.y - at.1)),
            )
        })
        .collect();
    camped.sort_by(|p, q| p.1.total_cmp(&q.1).then_with(|| p.0.id.cmp(&q.0.id)));
    camped.into_iter().take(n).map(|e| e.0).collect()
}
/// bots/mobHunt.ts planSpawnScore: the matchup of the PLAN_CAMPS camps nearest the spawn, each cut to
/// PLAN_USELESS_WEIGHT when the camp's weapon makes the bot's useless. -Infinity for an unknown pool index.
pub fn plan_spawn_score(
    map: &PlanMap,
    pool_index: i32,
    faction: FactionId,
    weapon: Option<WeaponId>,
) -> f64 {
    let Ok(index) = usize::try_from(pool_index) else {
        return f64::NEG_INFINITY;
    };
    let Some(at) = map.spawn_pool.get(index) else {
        return f64::NEG_INFINITY;
    };
    let mut score = 0.;
    for camp in nearest_camps(map, (at.x, at.y), PLAN_CAMPS) {
        let share = camp_matchup(faction, camp);
        let useless =
            weapon.is_some_and(|w| crate::bots::mob_hunt::useless(w, region_weapon(camp.zone)));
        score += if useless {
            share * PLAN_USELESS_WEIGHT
        } else {
            share
        };
    }
    score
}
/// bots/mobHunt.ts planPick: the better free spawn of the two (0 on a tie), or -1 when both are taken/dealt none.
pub fn plan_pick(
    map: &PlanMap,
    spawns: [i32; 2],
    taken: [bool; 2],
    faction: FactionId,
    weapon: Option<WeaponId>,
) -> i8 {
    let mut best: i8 = -1;
    let mut best_score = f64::NEG_INFINITY;
    for k in 0..2 {
        if spawns[k] < 0 || taken[k] {
            continue;
        }
        let score = plan_spawn_score(map, spawns[k], faction, weapon);
        if best < 0 || score > best_score {
            best = k as i8;
            best_score = score;
        }
    }
    best
}

// ------------------------------------------------------------------------------------------------------------ the module

/// The declared stats-file bias the module reads (types.ts LearnedBias): disabled is the shipped default, and an enabled
/// bias is capped and weighted by LEARN below.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlanLearned {
    pub enabled: bool,
    pub bias: Vec<(String, f64)>,
}
impl PlanLearned {
    fn of(&self, key: &str) -> f64 {
        if !self.enabled {
            return 0.;
        }
        let b = self
            .bias
            .iter()
            .find(|(k, _)| k == key)
            .map_or(0., |(_, v)| if v.is_finite() { *v } else { 0. });
        LEARN_WEIGHT * b.clamp(-LEARN_CAP, LEARN_CAP)
    }
}
/// The private plan deal as the module reads it (shared PlanMessage): the server-resolved owner facts.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlanDeal {
    pub ends_at: f64,
    pub spawns: [i32; 2],
    pub taken: [bool; 2],
    pub pick: i8,
    pub boons: Vec<String>,
    pub boon: i8,
}
impl PlanDeal {
    /// The view the observation carries for this owner this tick.
    pub fn from_view(view: &rh_sim::PlanningView) -> Self {
        Self {
            ends_at: view.plan.ends_at,
            spawns: view.plan.spawns,
            taken: view.plan.taken,
            pick: view.plan.pick,
            boons: view.plan.boons.clone(),
            boon: view.plan.boon,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlanAsk {
    pub at: f64,
    pub n: u32,
}
/// One module intent (source Intent): a plan message at the decision step, goal priority, with its human-readable why.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanIntent {
    pub spawn: Option<u8>,
    pub boon: Option<u8>,
    pub ready: Option<bool>,
    pub why: String,
}
/// The module's per-bot state (source PlanState, one module instance serves every bot of a room in the legacy code; the
/// port keeps one instance per seat).
#[derive(Clone, Debug, Default)]
pub struct PlanState {
    pub deal: Option<PlanDeal>,
    pub phase_at: Option<f64>,
    pub read_until: f64,
    pub settle_ms: f64,
    pub last_call: f64,
    pub spawn_ask: Option<PlanAsk>,
    pub boon_ask: Option<PlanAsk>,
    pub done_at: Option<f64>,
    pub ready_sent: bool,
}
/// The planning module: the state machine of brain/modules/planning.ts.
#[derive(Default)]
pub struct PlanModule {
    pub state: PlanState,
}
impl PlanModule {
    pub fn new() -> Self {
        Self::default()
    }
    /// A new run forgets the previous one's plan.
    pub fn reset(&mut self) {
        self.state = PlanState::default();
    }
    fn schedule(&mut self, now: f64, deal: &PlanDeal, tier: TierId, decide: &mut Rng) {
        let window = f64::max(1., deal.ends_at - now);
        let scale = f64::min(1., window / PLAN_SECONDS_MS);
        let ti = tier_index(tier);
        let (rlo, rhi) = PLAN_RULES.read[ti];
        let (slo, shi) = PLAN_RULES.settle[ti];
        self.state.read_until = now
            + f64::min(
                uniform(decide, rlo, rhi) * scale,
                PLAN_RULES.read_share * window,
            );
        self.state.settle_ms = uniform(decide, slo, shi) * scale;
        self.state.last_call = deal.ends_at
            - f64::min(
                PLAN_RULES.ready_before_ms,
                PLAN_RULES.ready_before_share * window,
            );
    }
    /// Source observe(ctx): read the private plan message. The seat calls it once per decision tick with the current
    /// observation view (the server sends one when the deal is first dealt and whenever the owner facts change).
    pub fn observe(&mut self, now: f64, deal: Option<&PlanDeal>, tier: TierId, decide: &mut Rng) {
        let Some(deal) = deal else {
            return;
        };
        if self.state.deal.is_none() {
            self.schedule(now, deal, tier, decide);
        }
        self.state.deal = Some(deal.clone());
    }
    /// Source intents(ctx): the plan message to send this decision, or None.
    #[allow(clippy::too_many_arguments)]
    pub fn intents(
        &mut self,
        now: f64,
        phase_planning: bool,
        tier: TierId,
        map: &PlanMap,
        faction: Option<FactionId>,
        weapon: Option<WeaponId>,
        learned: &PlanLearned,
        decide: &mut Rng,
        lapse: &mut Rng,
    ) -> Option<PlanIntent> {
        if !phase_planning {
            return None;
        }
        let params = TierParams::by_id(tier);
        let st = &mut self.state;
        st.phase_at.get_or_insert(now);
        if st.ready_sent {
            return None;
        }
        let ready = |st: &mut PlanState, why: &str| {
            st.ready_sent = true;
            Some(PlanIntent {
                spawn: None,
                boon: None,
                ready: Some(true),
                why: why.to_string(),
            })
        };
        let phase_at = st.phase_at.unwrap_or(now);
        let Some(deal) = st.deal.as_ref().cloned() else {
            return if now - phase_at >= PLAN_RULES.no_deal_ms {
                ready(st, "no deal came: ready, the server picks")
            } else {
                None
            };
        };
        if now >= st.last_call {
            return ready(st, "the timer is nearly out");
        }
        if now < st.read_until {
            return None;
        }
        let free: Vec<usize> = (0..2)
            .filter(|&k| deal.spawns[k] >= 0 && !deal.taken[k])
            .collect();
        let may_ask = |a: Option<PlanAsk>| match a {
            None => true,
            Some(a) => {
                a.n < PLAN_RULES.max_asks && now - a.at >= PLAN_RULES.resend_ms + params.reaction.mu
            }
        };
        let spent_asks = |a: Option<PlanAsk>| match a {
            None => false,
            Some(a) => {
                a.n >= PLAN_RULES.max_asks
                    && now - a.at >= PLAN_RULES.resend_ms + params.reaction.mu
            }
        };
        if deal.pick < 0 && !free.is_empty() && !spent_asks(st.spawn_ask) {
            if !may_ask(st.spawn_ask) {
                return None;
            }
            let k = choose_spawn(
                &deal, &free, map, faction, weapon, learned, params, decide, lapse,
            );
            let n = st.spawn_ask.map_or(0, |a| a.n) + 1;
            st.spawn_ask = Some(PlanAsk { at: now, n });
            let why = format!("spawn {} (option {})", deal.spawns[k], k);
            return Some(PlanIntent {
                spawn: Some(k as u8),
                boon: None,
                ready: None,
                why,
            });
        }
        if !deal.boons.is_empty() && deal.boon < 0 && !spent_asks(st.boon_ask) {
            if !may_ask(st.boon_ask) {
                return None;
            }
            let b = choose_boon(&deal, faction, learned, params, decide, lapse);
            let n = st.boon_ask.map_or(0, |a| a.n) + 1;
            st.boon_ask = Some(PlanAsk { at: now, n });
            let why = format!("boon {}", deal.boons[b]);
            return Some(PlanIntent {
                spawn: None,
                boon: Some(b as u8),
                ready: None,
                why,
            });
        }
        let done_at = *st.done_at.get_or_insert(now);
        if now >= done_at + st.settle_ms {
            return ready(st, "choices made");
        }
        None
    }
}
/// Source chooseSpawn: the better of the free spawns by planSpawnScore over PLAN_CAMPS (plus the learned state bias),
/// softened by the tier like any other choice. 0 on a tie.
#[allow(clippy::too_many_arguments)]
fn choose_spawn(
    deal: &PlanDeal,
    free: &[usize],
    map: &PlanMap,
    faction: Option<FactionId>,
    weapon: Option<WeaponId>,
    learned: &PlanLearned,
    params: &TierParams,
    decide: &mut Rng,
    lapse: &mut Rng,
) -> usize {
    let Some(faction) = faction else {
        return free[0];
    };
    if free.len() == 1 {
        return free[0];
    }
    let utilities: Vec<f64> = free
        .iter()
        .map(|&k| {
            let index = deal.spawns[k];
            let at = usize::try_from(index)
                .ok()
                .and_then(|i| map.spawn_pool.get(i));
            let zone = at.map(|s| s.zone);
            let bias = zone.map_or(0., |z| {
                learned.of(&format!("spawn|{}|{}", faction.as_str(), z.as_str()))
            });
            plan_spawn_score(map, index, faction, weapon) / PLAN_CAMPS as f64 + bias
        })
        .collect();
    let (pick, _) = pick_option(decide, lapse, &utilities, params.softmax_t, params.lapse_p);
    free[pick as usize]
}
/// Source chooseBoon: with nothing to go by but the bias a boon is the bot's whim (the stats file's favourite, else any).
fn choose_boon(
    deal: &PlanDeal,
    faction: Option<FactionId>,
    learned: &PlanLearned,
    params: &TierParams,
    decide: &mut Rng,
    lapse: &mut Rng,
) -> usize {
    let dealt = deal.boons.iter().take(2);
    let utilities: Vec<f64> = dealt
        .map(|id| faction.map_or(0., |f| learned.of(&format!("boon|{}|{}", f.as_str(), id))))
        .collect();
    let (pick, _) = pick_option(decide, lapse, &utilities, params.softmax_t, params.lapse_p);
    if pick == 1 {
        1
    } else {
        0
    }
}
