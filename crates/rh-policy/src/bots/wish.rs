//! The Wish module: the bots' ability policy (docs/backlog P-BOTS-2: server/src/bots/abilityPolicy.ts and
//! server/src/bots/brain/modules/wishes.ts).
//!
//! Two layers, both decided from Observation-only perception plus public static content:
//! - the pure cast policy: when and where a bot casts an ability, by the INTENT TAGS its public definition lists (never by
//!   ability id, D29). Escape/sustain/engage/control/peel are tried in the definition's order; escape blinks try a few headings
//!   and keep the first landing that is both valid and further from the threat; unit casts start inside their range; a blink to
//!   engage stops short of the foe. The numbers and the ordering are the legacy ones.
//! - the module: the Wish slot as the weapon bar shows it, its usable/availability frame, the Easy tier's remember draw, the
//!   retry gap, the situation it describes (own hp share, own EFFECT_* bits, being hit, the front-end foe, the nearest enemy and
//!   whether it is chasing) and the cast intent it emits through the ported humanizer (which supplies reaction time, hesitation
//!   and a unit cast that can miss like a lock click).
//!
//! P-BOT-MODULES-1 share (Root-corrected lease): the cast policy and the availability/retry/armed-slip transition machine now
//! have exactly one implementation in [`source_core`]; this file's public functions and `WishModule` are thin compatibility
//! adapters over it. The private source module (`temporal_percept::modules::wishes`) enters the same core with the declared
//! f64 rank, the declared opaque `AbilityDef`, the real collision map/gate flag and the real `Memory.lastCast`/hit facts.
//!
//! Deliberately narrowed for this public adapter (documented in docs/evidence/stage2-bots-2/README.md): the Swarm slip goal
//! itself belongs to the private module/goal layer (this front end only walks away through `slip_intent`); line of sight and
//! mob targetability are approximated from the fair view (visible means in sight; a visible mob is targetable), since the
//! bounded view does not carry the client's los flags; and the gate-locked collision variant is not available to the policy's
//! static view (the open map is used; the declared corpus keeps gates unlocked, and the sim's blink landing rule is already
//! parity-pinned in P-ABIL-1). Those three are exactly the inputs the source module supplies for real.
use crate::bots::paths::RoomPathService;
use crate::bots::random::Rng;
use crate::bots::types::{
    Intent, IntentBody, IntentTiming, Percept, Stimulus, StimulusKind, TierId, PRIORITY_COMBAT,
    PRIORITY_REFLEX,
};
use rh_sim::abilities::blink;
use rh_sim::status_runtime::AbilityId;
use rh_sim::{TileMap, Vec2};

mod source_core;

// The one shared source implementation, re-exported for the private source module adapter
// (`temporal_percept::modules::wishes`). The public surface of this file stays what it was.
#[allow(unused_imports)]
// the tag-refusal entries are exposed for the private replay intake/tests
pub(crate) use source_core::{
    admit_ai_tag, admit_blocked_by, admit_ranks, cast_why as source_cast_why,
    decide_cast as source_decide_cast, hides_caster as source_hides_caster,
    rank_of as source_rank_of, DeclaredRank, DeclaredTargeting, HypotMode, SourceAbility,
    SourceCastSituation, SourceRank, WishRefusal, WishStateCore, DONE_CORNERED, DONE_NOBODY,
    DONE_NOT_SLIPPING, FAILED_UNKNOWN_GOAL, RUNNING_SLIPPING, SLIP_GOAL_MODE, SLIP_GOAL_MODULE,
    SLIP_GOAL_WHY, SLIP_STEP_WHY, SLIP_UTILITY,
};

/// The own EFFECT_* bits the module reads (shared/status.ts): crowd control, and the casting bit the sim uses.
pub const EFFECT_STUNNED: u16 = 1;
pub const EFFECT_ROOTED: u16 = 2;
pub const EFFECT_SILENCED: u16 = 4;
/// The hidden status bit (shared/status.ts EFFECT_HIDDEN): a hiding Wish puts it on its caster.
pub const EFFECT_HIDDEN: u16 = 256;
pub const EFFECT_CASTING: u16 = rh_sim::status_runtime::EFFECT_CASTING;
/// shared/constants.ts TARGET_SNAP_RADIUS.
pub const TARGET_SNAP_RADIUS: f64 = 64.;

// The pure cast policy's numbers (abilityPolicy.ts).
pub const ESCAPE_THREAT_DISTANCE: f64 = 260.;
pub const ESCAPE_HP_THREATENED: f64 = 0.5;
pub const ESCAPE_HP_HIT: f64 = 0.55;
pub const SUSTAIN_HP: f64 = 0.35;
pub const ENGAGE_RANGE_MARGIN: f64 = 16.;
pub const PEEL_DISTANCE: f64 = 150.;
pub const ENGAGE_BLINK_MIN_DISTANCE: f64 = 120.;
pub const ENGAGE_BLINK_STOP_SHORT: f64 = 40.;
/// Headings tried for an escaping blink, as angles off straight away from the threat.
pub const ESCAPE_HEADINGS: [f64; 7] = [
    0.,
    std::f64::consts::FRAC_PI_4,
    -std::f64::consts::FRAC_PI_4,
    std::f64::consts::FRAC_PI_2,
    -std::f64::consts::FRAC_PI_2,
    3. * std::f64::consts::FRAC_PI_4,
    -3. * std::f64::consts::FRAC_PI_4,
];
/// The escape fallback reach of a directional cast (abilityPolicy.ts uses 300 when the rule has no range).
const ESCAPE_DIR_RANGE: f64 = 300.;
/// A landing must be at least this much further from the threat than the caster to count as an escape.
const ESCAPE_GAIN: f64 = 24.;
/// The policy's block bits, keyed by the source's names.
fn block_bit(name: BlockedBy) -> u16 {
    match name {
        BlockedBy::Stun => EFFECT_STUNNED,
        BlockedBy::Silence => EFFECT_SILENCED,
        BlockedBy::Root => EFFECT_ROOTED,
    }
}

/// The source's AiIntent tags (shared/abilities.ts).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiIntent {
    Escape,
    Sustain,
    Engage,
    Control,
    Peel,
    Burst,
    Zone,
    Buff,
}
/// The source's blockedBy tags.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockedBy {
    Stun,
    Silence,
    Root,
}
/// The source's TargetRule subset the five Wishes use.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TargetRule {
    Self_,
    Unit {
        range: f64,
        los: bool,
        snap_radius: f64,
    },
    Point {
        range: f64,
        min_range: f64,
    },
}
/// The source effect steps the cast policy reads: whether the rank hides its caster and whether it blinks (and how far).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PolicyEffect {
    HidesCaster,
    Blink { max_dist: f64, min_dist: f64 },
}
/// One rank of a Wish (Wishes have one).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WishRank {
    pub cast_ms: f64,
    pub targeting: TargetRule,
    pub effects: &'static [PolicyEffect],
}
/// A Wish's public static definition, as the policy consumes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WishDef {
    pub id: AbilityId,
    pub name: &'static str,
    pub ai: &'static [AiIntent],
    pub blocked_by: &'static [BlockedBy],
    /// The hiding Wish drops the caster's own lock (module goal territory; kept for the later slip port).
    pub drops_lock: bool,
    pub rank: WishRank,
}
const WISH_AI: &[BlockedBy] = &[BlockedBy::Stun, BlockedBy::Silence];
/// The five Wish rows, at the numbers the legacy shared definitions list. The parity test cross-checks each row against the
/// sim's own public Definition (cast time, charges, target kind and the hidden/blink effects) so the two tables cannot drift.
pub const WISHES: [WishDef; 5] = [
    WishDef {
        id: AbilityId::Freeze,
        name: "Freeze",
        ai: &[AiIntent::Control, AiIntent::Peel, AiIntent::Engage],
        blocked_by: WISH_AI,
        drops_lock: false,
        rank: WishRank {
            cast_ms: 250.,
            targeting: TargetRule::Unit {
                range: 450.,
                los: true,
                snap_radius: TARGET_SNAP_RADIUS,
            },
            effects: &[],
        },
    },
    WishDef {
        id: AbilityId::Swarm,
        name: "Swarm",
        ai: &[AiIntent::Escape],
        blocked_by: WISH_AI,
        drops_lock: true,
        rank: WishRank {
            cast_ms: 250.,
            targeting: TargetRule::Self_,
            effects: &[PolicyEffect::HidesCaster],
        },
    },
    WishDef {
        id: AbilityId::Trial,
        name: "Trial",
        ai: &[AiIntent::Engage, AiIntent::Control],
        blocked_by: WISH_AI,
        drops_lock: false,
        rank: WishRank {
            cast_ms: 350.,
            targeting: TargetRule::Unit {
                range: 400.,
                los: true,
                snap_radius: TARGET_SNAP_RADIUS,
            },
            effects: &[],
        },
    },
    WishDef {
        id: AbilityId::Blaze,
        name: "Blaze Step",
        ai: &[AiIntent::Escape, AiIntent::Engage],
        blocked_by: WISH_AI,
        drops_lock: false,
        rank: WishRank {
            cast_ms: 0.,
            targeting: TargetRule::Point {
                range: 300.,
                min_range: 64.,
            },
            effects: &[PolicyEffect::Blink {
                max_dist: 300.,
                min_dist: 64.,
            }],
        },
    },
    WishDef {
        id: AbilityId::LastStand,
        name: "Last Stand",
        ai: &[AiIntent::Sustain, AiIntent::Escape],
        blocked_by: WISH_AI,
        drops_lock: false,
        rank: WishRank {
            cast_ms: 0.,
            targeting: TargetRule::Self_,
            effects: &[],
        },
    },
];

pub fn wish_by_id(id: AbilityId) -> Option<&'static WishDef> {
    WISHES.iter().find(|d| d.id == id)
}
/// The rank numbers, clamped to 1..ranks.length (rankOf): a Wish has one rank, so any rank is rank 1.
pub fn wish_rank(def: &WishDef, rank: u8) -> &WishRank {
    let _ = rank;
    &def.rank
}
/// The Easy tier's tag filter, per Wish row (only the defensive tags keep the panic button).
const EASY_AI: [&[AiIntent]; 5] = [
    &[],
    &[AiIntent::Escape],
    &[],
    &[AiIntent::Escape],
    &[AiIntent::Sustain, AiIntent::Escape],
];
/// The tags this tier plays the Wish with (legacy playedDef: Easy filters to escape/sustain, null when none remains).
pub(crate) fn played_ai(def: &WishDef, tier: TierId) -> Option<&'static [AiIntent]> {
    if tier != TierId::Easy {
        return Some(def.ai);
    }
    let index = WISHES.iter().position(|d| d.id == def.id)?;
    let ai = EASY_AI[index];
    if ai.is_empty() {
        None
    } else {
        Some(ai)
    }
}
/// The single static-row rank view over `WishRank` (the one rank a Wish has).
fn static_rank(def: &WishDef) -> SourceRank {
    SourceRank {
        cast_ms: def.rank.cast_ms,
        targeting: def.rank.targeting,
        hides_caster: def
            .rank
            .effects
            .iter()
            .any(|e| matches!(e, PolicyEffect::HidesCaster)),
        blink: blink_of(def.rank.effects),
    }
}
/// The static `WISHES` row as the source-shaped borrowed ability the shared core consumes.
fn static_ability<'a>(
    def: &'a WishDef,
    ai: &'a [AiIntent],
    ranks: &'a [SourceRank],
) -> SourceAbility<'a> {
    SourceAbility {
        name: def.name,
        ai,
        blocked_by: def.blocked_by,
        ranks,
    }
}
/// The cast to send for this Wish with this tag list (the Easy filter passes a narrowed list), or null.
///
/// Compatibility adapter: the static row becomes the source-shaped view and the one shared core decides. Its
/// documented legacy inputs are kept exactly: the open map is both maps, the landing is unlocked even when the
/// public `CastSituation.gates_locked` says otherwise, and its distances are the old `rh_sim::math::hypot`.
pub fn decide_cast_with(
    def: &WishDef,
    ai: &[AiIntent],
    rank: u8,
    s: &CastSituation,
) -> Option<CastChoice> {
    let ranks = [static_rank(def)];
    let ability = static_ability(def, ai, &ranks);
    let situation = SourceCastSituation {
        me: s.me,
        foe: s.foe.clone(),
        threat: s.threat.clone(),
        map: s.map,
        collision: s.map,
        ring: s.ring,
        gates_locked: false,
        hypot: HypotMode::Legacy,
    };
    source_core::decide_cast(&ability, f64::from(rank), &situation)
}
/// Does casting this rank hide its caster from enemies (an effect that puts a hidden status on itself)?
pub fn hides_caster(def: &WishDef, rank: u8) -> bool {
    let ranks = [static_rank(def)];
    source_core::hides_caster(&ranks, f64::from(rank))
}
fn blink_of(effects: &[PolicyEffect]) -> Option<(f64, f64)> {
    effects.iter().find_map(|e| match e {
        PolicyEffect::Blink { max_dist, min_dist } => Some((*max_dist, *min_dist)),
        PolicyEffect::HidesCaster => None,
    })
}

// ------------------------------------------------------------------------------------------------------- the cast policy

/// The bot's own moment, as the source's CastSituation.me.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeView {
    pub x: f64,
    pub y: f64,
    pub hp_frac: f64,
    pub effects: u16,
    pub recently_hit: bool,
}
/// What the bot fights now (a player, or a mob when the goal is a farm), when it is on screen.
#[derive(Clone, Debug, PartialEq)]
pub struct FoeView {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub d: f64,
    pub los: bool,
    pub targetable: bool,
    pub mob: bool,
}
/// The nearest enemy player.
#[derive(Clone, Debug, PartialEq)]
pub struct ThreatView {
    pub x: f64,
    pub y: f64,
    pub d: f64,
    pub chasing: bool,
    pub id: Option<String>,
    pub los: Option<bool>,
    pub targetable: Option<bool>,
}
/// The moment the policy describes, plus the public static map its blink landing search reads.
pub struct CastSituation<'a> {
    pub me: MeView,
    pub foe: Option<FoeView>,
    pub threat: Option<ThreatView>,
    pub map: &'a TileMap,
    pub ring: &'a blink::Ring,
    /// The hud's gate-locked fact. The static fair view only carries the open map, so a locked gate is not reflected in the
    /// landing collision (documented; the declared corpus keeps gates unlocked).
    pub gates_locked: bool,
}
/// The cast to send (the cursor point, and a unit target's rendered id).
#[derive(Clone, Debug, PartialEq)]
pub struct CastChoice {
    pub x: f64,
    pub y: f64,
    pub id: Option<String>,
}
/// The cast to send for this Wish at this rank in this situation, or null. Intents are tried in the definition's order; the
/// first that fires decides.
pub fn decide_cast(def: &WishDef, rank: u8, s: &CastSituation) -> Option<CastChoice> {
    decide_cast_with(def, def.ai, rank, s)
}

// --------------------------------------------------------------------------------------------------------------- the module

/// The module's numbers, from the legacy WISH_RULES (the slip fields are pinned for the later slip port; only the cast half
/// reads the first six today).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WishRules {
    pub retry_ms: f64,
    pub recent_hit_ms: f64,
    pub chase_closing: f64,
    pub chase_cos: f64,
    pub on_it_distance: f64,
    pub easy_remembers: f64,
    pub slip_pending_ms: f64,
    pub slip_grace_ms: f64,
    pub slip_utility: f64,
    pub slip_step_u: f64,
    pub slip_keep_ms: f64,
    pub slip_arrived_u: f64,
}
pub const WISH_RULES: WishRules = WishRules {
    retry_ms: 1000.,
    recent_hit_ms: 1500.,
    chase_closing: 20.,
    chase_cos: 0.7,
    on_it_distance: PEEL_DISTANCE,
    easy_remembers: 0.6,
    slip_pending_ms: 2500.,
    slip_grace_ms: 700.,
    slip_utility: 1.4,
    slip_step_u: 300.,
    slip_keep_ms: 1200.,
    slip_arrived_u: 60.,
};
/// The stimuli that make a cast sensible, most telling first.
pub const CAST_STIMULI: [StimulusKind; 6] = [
    StimulusKind::LowHp,
    StimulusKind::HpLoss,
    StimulusKind::WindupAtMe,
    StimulusKind::DrawAtMe,
    StimulusKind::NewThreat,
    StimulusKind::Incoming,
];

/// The front-end goal's target, as the module needs it (the bounded front end's fight/farm choice).
#[derive(Clone, Debug, PartialEq)]
pub struct WishFoe {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub mob: bool,
    pub targetable: bool,
    pub los: bool,
}
impl WishFoe {
    pub fn distance_to(&self, at: Vec2) -> f64 {
        rh_sim::math::hypot(self.x - at.x, self.y - at.y)
    }
}

/// Per-bot Wish state (the legacy WeakMap entry): the one shared availability/retry/slip transition machine plus the
/// legacy wrapper's own observation-memory inputs. The shared machine's state lives in [`WishStateCore`]; this wrapper's
/// compatibility inputs (the inferred sent-cast clock, the observed-hit map, the public static map) stay here.
pub struct WishModule {
    state: WishStateCore,
    /// The time of the last hit taken, from observation events only (the legacy memory's mem.self.lastHitAt).
    last_hit_at: Option<f64>,
    /// Player hits on the bot, per rendered attacker key, newest last (bounded; the legacy mem.fighters hitMeAt).
    fighter_hits: Vec<(String, f64)>,
    map: Option<TileMap>,
    ring: Option<blink::Ring>,
}
impl Default for WishModule {
    fn default() -> Self {
        Self::new()
    }
}
impl WishModule {
    pub fn new() -> Self {
        Self {
            state: WishStateCore::new(),
            last_hit_at: None,
            fighter_hits: Vec::new(),
            map: None,
            ring: None,
        }
    }
    /// Match start: independent state, and the public static map the landing search reads.
    pub fn reset(&mut self, map: &TileMap) {
        *self = Self::new();
        self.map = Some(map.clone());
        self.ring = Some(blink::Ring::new(map));
    }
    /// One observation's own-hit facts (the perception frame passes the player hits it saw).
    pub fn absorb_hits(&mut self, hit_at: Option<f64>, fighter_hits: &[(String, f64)]) {
        if let Some(at) = hit_at {
            self.last_hit_at = Some(at);
        }
        for (key, at) in fighter_hits {
            match self.fighter_hits.iter_mut().find(|(k, _)| k == key) {
                Some(slot) => slot.1 = *at,
                None => {
                    self.fighter_hits.push((key.clone(), *at));
                    if self.fighter_hits.len() > 16 {
                        self.fighter_hits.remove(0);
                    }
                }
            }
        }
    }
    fn fighter_hit_at(&self, key: &str) -> Option<f64> {
        self.fighter_hits
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, at)| *at)
    }
    /// The availability edge and the Easy tier's remember draw (the legacy observe()).
    pub fn observe(&mut self, p: &Percept, tier: TierId, decide: &mut Rng) {
        let usable = p.extras.wish.as_ref().is_some_and(|w| usable(p, w));
        self.state
            .observe(usable, tier == TierId::Easy, &mut || decide.next_f64());
    }
    pub fn remembers(&self) -> bool {
        self.state.remembers()
    }
    pub fn available(&self) -> bool {
        self.state.available()
    }
    /// The cast intent for this think, if the module decides one. The front end's chosen foe is passed in; the threat is the
    /// nearest enemy player in the fair view.
    pub fn intents(
        &mut self,
        p: &Percept,
        stimuli: &[Stimulus],
        foe: Option<&WishFoe>,
        tier: TierId,
        decide: &mut Rng,
        paths: &mut RoomPathService,
    ) -> Vec<Intent> {
        let _ = decide;
        let mut out = Vec::new();
        if let Some(intent) = self.cast_intent(p, stimuli, foe, tier) {
            out.push(intent);
        }
        if self.slipping(p) {
            if let Some(step) = self.slip_intent(p, stimuli, paths) {
                out.push(step);
            }
        }
        out
    }

    /// The cast intent for this think, or None (the legacy castIntent: readiness, casting, the retry gap, the tier filter, the
    /// situation, the decision; arming the slip when the Wish hides its caster).
    fn cast_intent(
        &mut self,
        p: &Percept,
        stimuli: &[Stimulus],
        foe: Option<&WishFoe>,
        tier: TierId,
    ) -> Option<Intent> {
        let view = p.extras.wish.as_ref()?;
        let def = wish_by_id(view.ability)?;
        if !self.state.remembers()
            || !usable(p, view)
            || view.casting
            || !self.state.retry_ready(p.now, &WISH_RULES)
        {
            return None;
        }
        let ai = played_ai(def, tier)?;
        let (map, ring) = self.map.as_ref().zip(self.ring.as_ref())?;
        let s = cast_situation(p, self, foe, map, ring);
        let choice = decide_cast_with(def, ai, view.rank, &s)?;
        // The old public wrapper's rank is its public `u8` observation domain; the shared core is entered with that
        // exact value (the source adapter, by contrast, keeps the declared f64 rank).
        self.state.note_try(p.now);
        let rank_view = wish_rank(def, view.rank);
        if hides_caster(def, view.rank) {
            let from = s
                .threat
                .as_ref()
                .map(|t| Vec2::new(t.x, t.y))
                .or_else(|| s.foe.as_ref().map(|f| Vec2::new(f.x, f.y)));
            // Compatibility arm: the old wrapper's inferred cast clock is cleared and its slip origin is overwritten
            // even by a null enemy (the source module keeps both rules through `arm_source`).
            self.state.arm_legacy(p.now, rank_view.cast_ms, from);
        }
        let priority = if s.me.hp_frac < ESCAPE_HP_HIT {
            PRIORITY_REFLEX
        } else {
            PRIORITY_COMBAT
        };
        let snap_radius = match rank_view.targeting {
            TargetRule::Unit { snap_radius, .. } => snap_radius,
            _ => TARGET_SNAP_RADIUS,
        };
        let (x, y) = (choice.x, choice.y);
        Some(Intent {
            body: IntentBody::Cast {
                slot: "wish".into(),
                x,
                y,
                target: choice.id,
                at: Some(Vec2::new(x, y)),
                snap_radius: Some(snap_radius),
            },
            priority,
            timing: timing_of(stimuli),
            why: format!("cast {}", def.name),
        })
    }

    /// Hidden, casting a hiding Wish, or having just decided to (the legacy slipping predicate, through the shared
    /// state machine): its inferred cast clock starts at the first observed casting bit, and expiry clears the inferred
    /// clock and the slip origin/leg (the documented legacy behavior; source keeps the origin through `slip_source`).
    pub fn slipping(&mut self, p: &Percept) -> bool {
        let hidden = p.self_view.effects & EFFECT_HIDDEN != 0;
        let casting = p.self_view.effects & EFFECT_CASTING != 0;
        self.state
            .slipping_legacy(p.now, hidden, casting, &WISH_RULES)
    }

    /// The module goal holds while slipping with somebody to slip from (the legacy goals() condition).
    pub fn goal_active(&mut self, p: &Percept) -> bool {
        self.slipping(p)
            && self
                .state
                .slip_goal_holds(p.fighters.iter().any(|f| f.status == "alive"))
    }

    /// The walk away from the nearest enemy (or from where it last stood), re-chosen from where that is now once its leg has run
    /// its time or been walked; offered again at every think, so a lock cannot take the order channel.
    fn slip_intent(
        &mut self,
        p: &Percept,
        stimuli: &[Stimulus],
        paths: &mut RoomPathService,
    ) -> Option<Intent> {
        let self_at = Vec2::new(p.self_view.x, p.self_view.y);
        if let Some((x, y)) = p
            .fighters
            .iter()
            .filter(|f| f.status == "alive")
            .map(|f| {
                (
                    f.x,
                    f.y,
                    rh_sim::math::hypot(f.x - self_at.x, f.y - self_at.y),
                )
            })
            .min_by(|a, b| a.2.total_cmp(&b.2))
            .map(|(x, y, _)| (x, y))
        {
            self.state.from = Some(Vec2::new(x, y));
        }
        let to = {
            let mut clear = |a: Vec2, b: Vec2| paths.clear(a, b);
            self.state
                .slip_leg(p.now, self_at, &mut clear, &WISH_RULES, HypotMode::Legacy)?
        };
        Some(Intent {
            body: IntentBody::Move { to },
            priority: PRIORITY_REFLEX,
            timing: timing_of(stimuli),
            why: SLIP_STEP_WHY.into(),
        })
    }
}

/// The Wish is usable now: the run is on, the bot stands, and the slot's ready time has come (legacy usable()).
fn usable(p: &Percept, view: &crate::bots::types::WishView) -> bool {
    p.hud.phase == "active" && p.self_view.status == "alive" && p.now >= view.ready_at
}
/// A reaction to the stimulus that made the moment, else the next step.
fn timing_of(stimuli: &[Stimulus]) -> IntentTiming {
    for kind in CAST_STIMULI {
        if let Some(stimulus) = stimuli.iter().find(|s| s.kind == kind) {
            return IntentTiming::React {
                stimulus: stimulus.clone(),
            };
        }
    }
    IntentTiming::Step {}
}
fn cast_situation<'a>(
    p: &Percept,
    module: &WishModule,
    foe: Option<&WishFoe>,
    map: &'a TileMap,
    ring: &'a blink::Ring,
) -> CastSituation<'a> {
    let me = &p.self_view;
    let me_at = Vec2::new(me.x, me.y);
    let now = p.now;
    let recently_hit = module
        .last_hit_at
        .is_some_and(|at| now - at <= WISH_RULES.recent_hit_ms);
    let foe = foe.map(|f| FoeView {
        id: f.id.clone(),
        x: f.x,
        y: f.y,
        d: f.distance_to(me_at),
        los: f.los,
        targetable: f.targetable,
        mob: f.mob,
    });
    let threat = p
        .fighters
        .iter()
        .filter(|f| f.status == "alive")
        .min_by(|a, b| dist2(a, &me_at).total_cmp(&dist2(b, &me_at)))
        .map(|f| {
            let d = dist2(f, &me_at);
            let speed = rh_sim::math::hypot(f.vx, f.vy);
            let mut chasing = false;
            if speed > 0. && d > 1. {
                let toward = (f.vx * (me.x - f.x) + f.vy * (me.y - f.y)) / d;
                if toward >= WISH_RULES.chase_closing && toward / speed > WISH_RULES.chase_cos {
                    chasing = true;
                }
            }
            if !chasing {
                let hit = module.fighter_hit_at(&f.id);
                chasing = hit.is_some_and(|at| {
                    now - at <= WISH_RULES.recent_hit_ms && d <= WISH_RULES.on_it_distance
                });
            }
            ThreatView {
                x: f.x,
                y: f.y,
                d,
                chasing,
                id: Some(f.id.clone()),
                los: None,
                targetable: Some(f.targetable),
            }
        });
    CastSituation {
        me: MeView {
            x: me.x,
            y: me.y,
            hp_frac: if me.max_hp > 0. {
                me.hp / me.max_hp
            } else {
                1.
            },
            effects: me.effects,
            recently_hit,
        },
        foe,
        threat,
        map,
        ring,
        gates_locked: p.hud.gates_locked,
    }
}
fn dist2(f: &crate::bots::types::FighterView, at: &Vec2) -> f64 {
    rh_sim::math::hypot(f.x - at.x, f.y - at.y)
}
/// The sim's own public definition, for tests that pin the two tables together (the policy table above against
/// rh_sim::abilities::definition).
#[cfg(test)]
pub(crate) fn sim_definition(id: AbilityId) -> rh_sim::abilities::Definition {
    rh_sim::abilities::definition(id)
}
/// The sim's status bits the module's constants claim (stun/silence), for the same cross-check.
#[cfg(test)]
pub(crate) fn sim_status_bit(kind: rh_sim::status_runtime::StatusKind) -> u16 {
    kind.rule().bit
}
