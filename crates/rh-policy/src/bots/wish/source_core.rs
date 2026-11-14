//! The one source-shaped Wish core shared by the old public adapter and the private source module
//! (P-BOT-MODULES-1, Root-corrected `wish.rs` lease).
//!
//! Two layers live here, each with exactly one implementation:
//!
//! 1. **The cast policy** (`abilityPolicy.ts`): source rank selection (`rankOf` over an f64 rank:
//!    `floor(finite ? rank : 1)` clamped to `1..=ranks.length`), the casting/`blockedBy` gates, the ordered
//!    `ai` intents (escape/sustain/engage/control/peel; burst/zone/buff are no-ops) and their exact
//!    self/unit/point results, including the sim's own fixed-distance blink landing under the finite profile.
//!    `decide_cast` is generic over a borrowed source-shaped ability/rank view; the old public
//!    `wish::decide_cast_with`/`decide_cast` are thin adapters over the static `WISHES` rows, and the private
//!    source module adapts the declared opaque `AbilityDef` directly.
//!
//! 2. **The availability/retry/slip state machine** (`brain/modules/wishes.ts`): the availability edge with
//!    the Easy remember draw, the retry gap, the armed slip (`armedAt/castMs/from/leg`), the `slipping`
//!    predicate and the slip step (nearest-enemy `from`, leg keep/arrival, the clear-only `awayPoint` search).
//!    `WishStateCore` is the only implementation. The old public `WishModule` differs in two documented fields
//!    and selects them with the `Legacy`/`Source` entry points below; it does not re-implement the machine.
//!
//! The finite profile is explicit: only the five actual built-in Wish definitions' declared shapes are
//! decided on. `admit_ranks` refuses (before any state mutation) a rank whose targeting is `dir`, whose
//! declared blink distances are not exactly `(300, 64)`, or whose consumed rank members are absent; unknown
//! `ai`/`blockedBy` tags are refused by `admit_ai_tag`/`admit_blocked_by`. A refusal is not a decision and not
//! a state change: the source adapter turns it into "nothing this think", exactly as an unsupported custom
//! future shape is outside what this finite reader claims.
use super::{
    AiIntent, BlockedBy, CastChoice, FoeView, MeView, TargetRule, ThreatView, WishRules,
    EFFECT_CASTING, ENGAGE_BLINK_MIN_DISTANCE, ENGAGE_BLINK_STOP_SHORT, ENGAGE_RANGE_MARGIN,
    ESCAPE_GAIN, ESCAPE_HP_HIT, ESCAPE_HP_THREATENED, ESCAPE_THREAT_DISTANCE, PEEL_DISTANCE,
    SUSTAIN_HP, WALL_PEEL_DISTANCE, WALL_PEEL_MIN, WALL_PEEL_SHARE,
};
use rh_sim::abilities::blink;
use rh_sim::{TileMap, Vec2};

/// The only exact-distance blink shape this finite profile admits (the five actual Wishes all declare it and
/// the shipped sim leaf hard-codes it); any other declared distances are refused before a decision.
pub(crate) const PROFILE_BLINK_MAX_DIST: f64 = blink::MAX_DIST;
pub(crate) const PROFILE_BLINK_MIN_DIST: f64 = blink::MIN_DIST;

/// `WISH_RULES.slipUtility`: strategy scores the slip above a flee (1.1) and every persona goal.
pub(crate) const SLIP_UTILITY: f64 = 1.4;
/// The module goal identity the source literal declares.
pub(crate) const SLIP_GOAL_MODULE: &str = "wishes";
pub(crate) const SLIP_GOAL_MODE: &str = "slip";
/// The source's exact `why` strings.
pub(crate) const SLIP_GOAL_WHY: &str =
    "hidden behind a Swarm, or about to be: slip away, lock nobody";
pub(crate) const SLIP_STEP_WHY: &str = "slip away: hidden or about to be";
pub(crate) const FAILED_UNKNOWN_GOAL: &str = "unknown wishes goal";
pub(crate) const DONE_NOT_SLIPPING: &str = "no longer hidden or about to be";
pub(crate) const DONE_NOBODY: &str = "hidden with nobody to slip from";
pub(crate) const DONE_CORNERED: &str = "cornered";
pub(crate) const RUNNING_SLIPPING: &str = "slipping away";

/// Which two-argument hypotenuse evaluation a caller gets. The source runs JavaScript `Math.hypot`
/// (V8's scaled compensated sum, exposed as `rh_sim::mapgen::certify::source_hypot`); the old public adapter
/// used the simulation's `rh_sim::math::hypot` before this refactor and keeps it bit-for-bit through its
/// compatibility entry (`HypotMode::Legacy`). New source paths use `HypotMode::Js`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HypotMode {
    Js,
    Legacy,
}
impl HypotMode {
    #[inline]
    pub(crate) fn hypot(self, x: f64, y: f64) -> f64 {
        match self {
            Self::Js => rh_sim::mapgen::certify::source_hypot(x, y),
            Self::Legacy => rh_sim::math::hypot(x, y),
        }
    }
}

// ------------------------------------------------------------------------------------------------ source-shaped views

/// One declared rank as the cast policy consumes it (`AbilityRank` + source `rankOf`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SourceRank {
    pub(crate) cast_ms: f64,
    pub(crate) targeting: TargetRule,
    /// An effect that puts `hidden` on the caster (`hidesCaster`).
    pub(crate) hides_caster: bool,
    /// The first `do: "blink"` effect's `(maxDist, minDist)`.
    pub(crate) blink: Option<(f64, f64)>,
    /// The rank has a `do: "wall"` effect (legacy 78dd8bd4 `abilityPolicy.ts` `wallOf`): `peel` and `escape` drop it
    /// between the caster and the enemy ([`wall_between`]).
    pub(crate) wall: bool,
}

/// A source-opaque declared ability, borrowed. No catalog row is substituted for a declared def.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SourceAbility<'a> {
    pub(crate) name: &'a str,
    pub(crate) ai: &'a [AiIntent],
    pub(crate) blocked_by: &'a [BlockedBy],
    pub(crate) ranks: &'a [SourceRank],
}

/// The source `CastSituation` with both real maps and the real gate flag: `map` is the open map (region/ring
/// identity), `collision` is the declared collision view the path service is on right now (the open map, or
/// the gated copy while the gates are locked). The old public adapter passes `collision = map`, `gates_locked =
/// false` and `HypotMode::Legacy` (its documented open/unlocked behavior); the source adapter passes the real
/// collision map, the real flag and `HypotMode::Js`.
pub(crate) struct SourceCastSituation<'a> {
    pub(crate) me: MeView,
    pub(crate) foe: Option<FoeView>,
    pub(crate) threat: Option<ThreatView>,
    pub(crate) map: &'a TileMap,
    pub(crate) collision: &'a TileMap,
    pub(crate) ring: &'a blink::Ring,
    pub(crate) gates_locked: bool,
    pub(crate) hypot: HypotMode,
}

/// Source `rankOf`: `Math.min(Math.max(Math.floor(finite ? rank : 1), 1), ranks.length)` indexes `ranks[i-1]`.
/// The rank stays a finite f64 source number (never narrowed to an integer type here); a missing rank list has
/// no rank to read.
pub(crate) fn rank_of(ranks: &[SourceRank], rank: f64) -> Option<&SourceRank> {
    if ranks.is_empty() {
        return None;
    }
    let bare = if rank.is_finite() { rank } else { 1. };
    let index = bare.floor().max(1.).min(ranks.len() as f64) as usize;
    ranks.get(index - 1)
}

/// Source `hidesCaster(def, rank)` over the declared rank.
pub(crate) fn hides_caster(ranks: &[SourceRank], rank: f64) -> bool {
    rank_of(ranks, rank).is_some_and(|r| r.hides_caster)
}

/// Source `` `cast ${def.name}` ``: the cast intent's why.
pub(crate) fn cast_why(def: &SourceAbility<'_>) -> String {
    format!("cast {}", def.name)
}

// ------------------------------------------------------------------------------------------------ the cast policy

/// The cast to send for `def` at `rank` in this situation, or null (source `decideCast`).
pub(crate) fn decide_cast(
    def: &SourceAbility<'_>,
    rank: f64,
    s: &SourceCastSituation<'_>,
) -> Option<CastChoice> {
    if s.me.effects & EFFECT_CASTING != 0 {
        return None;
    }
    for blocked in def.blocked_by {
        if s.me.effects & super::block_bit(*blocked) != 0 {
            return None;
        }
    }
    let r = rank_of(def.ranks, rank)?;
    for intent in def.ai {
        let choice = match intent {
            AiIntent::Escape => escape(r.targeting, r.blink, r.wall, s),
            AiIntent::Sustain => sustain(r.targeting, s),
            AiIntent::Engage | AiIntent::Control => engage(r.targeting, r.blink, s),
            AiIntent::Peel => peel(r.targeting, r.wall, s),
            AiIntent::Burst | AiIntent::Zone | AiIntent::Buff => None,
        };
        if choice.is_some() {
            return choice;
        }
    }
    None
}

fn self_choice(s: &SourceCastSituation<'_>) -> CastChoice {
    CastChoice {
        x: s.me.x,
        y: s.me.y,
        id: None,
    }
}

/// The source's valid blink landing. The caller has been through `admit_ranks`, so the declared distances are
/// exactly the sim leaf's fixed `(MAX_DIST, MIN_DIST)`; the ring comes from the open map and the collision test
/// (and the locked-side rule) from the actual collision map, never a conflation of the two.
fn landing(s: &SourceCastSituation<'_>, to: Vec2, max_dist: f64, min_dist: f64) -> Option<Vec2> {
    debug_assert_eq!(max_dist, PROFILE_BLINK_MAX_DIST);
    debug_assert_eq!(min_dist, PROFILE_BLINK_MIN_DIST);
    blink::landing(
        s.map,
        s.collision,
        s.ring,
        s.gates_locked,
        Vec2::new(s.me.x, s.me.y),
        to,
    )
}

/// Legacy 78dd8bd4 `wallBetween`: a wall between us and an enemy at `(tx, ty)`, `d` away, most of the way to it,
/// inside the wall's range: `me + (t - me) * min(range, d * 0.7) / d`, a point with no unit id. Only a point rule,
/// and only from `WALL_PEEL_MIN` to `WALL_PEEL_DISTANCE` inclusive. No line of sight, no map, no draw; the aim is
/// not clamped to the rule's minimum range (the sim clamps it, as legacy's server does).
fn wall_between(
    rule: TargetRule,
    s: &SourceCastSituation<'_>,
    tx: f64,
    ty: f64,
    d: f64,
) -> Option<CastChoice> {
    let TargetRule::Point { range, .. } = rule else {
        return None;
    };
    // Source `t.d < WALL_PEEL_MIN || t.d > WALL_PEEL_DISTANCE`: a NaN distance passes, as it does there (a
    // `RangeInclusive::contains` would refuse it).
    #[allow(clippy::manual_range_contains)]
    if d < WALL_PEEL_MIN || d > WALL_PEEL_DISTANCE {
        return None;
    }
    // `Math.min` would keep a NaN that `f64::min` drops, but the quotient by a NaN `d` is NaN either way.
    let k = range.min(d * WALL_PEEL_SHARE) / d;
    Some(CastChoice {
        x: s.me.x + (tx - s.me.x) * k,
        y: s.me.y + (ty - s.me.y) * k,
        id: None,
    })
}

/// Source `escape`: in trouble (low hp with a threat close, or low hp while being hit). A self cast goes as it
/// is; a wall goes between us and the threat (else the foe) at the measured distance; a point cast (blink) goes
/// away from the threat at the first heading that has a valid landing and gets no closer; a unit cast is not an
/// escape.
fn escape(
    rule: TargetRule,
    blink: Option<(f64, f64)>,
    wall: bool,
    s: &SourceCastSituation<'_>,
) -> Option<CastChoice> {
    let m = s.me;
    let trouble = (m.hp_frac < ESCAPE_HP_THREATENED
        && s.threat
            .as_ref()
            .is_some_and(|t| t.d < ESCAPE_THREAT_DISTANCE))
        || (m.hp_frac < ESCAPE_HP_HIT && m.recently_hit);
    if !trouble {
        return None;
    }
    if rule == TargetRule::Self_ {
        return Some(self_choice(s));
    }
    if matches!(rule, TargetRule::Unit { .. }) {
        return None;
    }
    // Away from the enemy that is on us; failing that, away from what we are fighting.
    let (fx, fy) = match (s.threat.as_ref(), s.foe.as_ref()) {
        (Some(t), _) => (t.x, t.y),
        (None, Some(f)) => (f.x, f.y),
        (None, None) => return None,
    };
    if wall {
        // Source: `wallBetween(rule, s, { x, y, d: Math.hypot(from.x - me.x, from.y - me.y) })`: the distance is
        // measured here (not the threat's `d`), and the wall never reaches the blink headings.
        let d = s.hypot.hypot(fx - m.x, fy - m.y);
        return wall_between(rule, s, fx, fy, d);
    }
    let dx = m.x - fx;
    let dy = m.y - fy;
    let len = s.hypot.hypot(dx, dy);
    // Source `if (!(len > 0.5)) return null`: NaN/incomparable also refuses (exact source semantics).
    if len.partial_cmp(&0.5) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    let range = match rule {
        TargetRule::Point { range, .. } => range,
        _ => super::ESCAPE_DIR_RANGE,
    };
    let base = rh_sim::math::atan2(dy, dx);
    for turn in super::ESCAPE_HEADINGS {
        let to = Vec2::new(
            m.x + rh_sim::math::cos(base + turn) * range,
            m.y + rh_sim::math::sin(base + turn) * range,
        );
        if let Some((max_dist, min_dist)) = blink {
            if let Some(at) = landing(s, to, max_dist, min_dist) {
                // A landing that does not get further from the enemy is no escape.
                let gain = s.hypot.hypot(at.x - fx, at.y - fy);
                if gain > len + ESCAPE_GAIN {
                    return Some(CastChoice {
                        x: to.x,
                        y: to.y,
                        id: None,
                    });
                }
            }
        } else if turn == 0. {
            return Some(CastChoice {
                x: to.x,
                y: to.y,
                id: None,
            });
        }
    }
    None
}

/// Source `sustain`: low hp and being hit, a self cast.
fn sustain(rule: TargetRule, s: &SourceCastSituation<'_>) -> Option<CastChoice> {
    if s.me.hp_frac < SUSTAIN_HP && s.me.recently_hit && rule == TargetRule::Self_ {
        Some(self_choice(s))
    } else {
        None
    }
}

/// Source `engage`/`control`: a targetable player foe. A unit cast must be in line of sight and start inside
/// its range; a point cast (a blink) closes a gap that is worth it, landing short of the foe. (The source's
/// `dir` branch is outside this finite profile and refused by `admit_ranks` before a decision.)
fn engage(
    rule: TargetRule,
    blink: Option<(f64, f64)>,
    s: &SourceCastSituation<'_>,
) -> Option<CastChoice> {
    let f = s.foe.as_ref()?;
    if !f.targetable || f.mob {
        return None;
    }
    match rule {
        // Source `engage` reads the foe's own `los`, not the rule's declared `los` field.
        TargetRule::Unit { range, .. } => {
            if !f.los || f.d > range - ENGAGE_RANGE_MARGIN {
                return None;
            }
            Some(CastChoice {
                x: f.x,
                y: f.y,
                id: Some(f.id.clone()),
            })
        }
        TargetRule::Point { range, .. } => {
            if f.d < ENGAGE_BLINK_MIN_DISTANCE || f.d > range - ENGAGE_RANGE_MARGIN {
                return None;
            }
            let k = (f.d - ENGAGE_BLINK_STOP_SHORT).max(0.) / f.d;
            let to = Vec2::new(s.me.x + (f.x - s.me.x) * k, s.me.y + (f.y - s.me.y) * k);
            if let Some((max_dist, min_dist)) = blink {
                landing(s, to, max_dist, min_dist)?;
            }
            Some(CastChoice {
                x: to.x,
                y: to.y,
                id: None,
            })
        }
        TargetRule::Self_ => None,
    }
}

/// Source `peel`: a targetable enemy chasing us. A wall goes between us and it (its own 56..=260 window, the
/// threat's carried `d`, before the unit cap); otherwise a unit cast on an enemy right on us.
fn peel(rule: TargetRule, wall: bool, s: &SourceCastSituation<'_>) -> Option<CastChoice> {
    let t = s.threat.as_ref()?;
    if !t.chasing || t.targetable == Some(false) {
        return None;
    }
    if wall {
        return wall_between(rule, s, t.x, t.y, t.d);
    }
    if t.d > PEEL_DISTANCE {
        return None;
    }
    if let TargetRule::Unit { range, .. } = rule {
        if t.id.is_none() || t.los == Some(false) || t.d > range - ENGAGE_RANGE_MARGIN {
            return None;
        }
        return Some(CastChoice {
            x: t.x,
            y: t.y,
            id: t.id.clone(),
        });
    }
    None
}

// -------------------------------------------------------------------------------------------- finite-profile admission

/// Why a declared ability is outside the finite five-Wish profile. The path is the source field path (e.g.
/// `ranks[0].targeting.kind`) so a refusal names the exact member that could not be supported; nothing is
/// coerced and no state has been touched when this is returned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WishRefusal {
    pub(crate) path: String,
    pub(crate) detail: String,
}
impl WishRefusal {
    pub(crate) fn new(path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            detail: detail.into(),
        }
    }
}
impl std::fmt::Display for WishRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.path, self.detail)
    }
}

/// One declared rank's consumed shape, with absence kept absent (`AbilityRank`'s `Option`s).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DeclaredRank {
    pub(crate) cast_ms: Option<f64>,
    pub(crate) targeting: Option<DeclaredTargeting>,
    pub(crate) hides_caster: bool,
    pub(crate) blink: Option<(f64, f64)>,
    /// A declared `do: "wall"` effect.
    pub(crate) wall: bool,
}

/// The source targeting union as the finite reader can name it; anything that is not one of the five actual
/// built-in self/unit/point shapes is `Unsupported` (the source's `dir` rule exists but is outside this profile).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum DeclaredTargeting {
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
    Unsupported,
}

/// Admit every declared rank of a guard-passing def into the finite policy profile, or refuse with the exact
/// field path before any decision/state mutation. Rejected: an absent rank member the policy would consume, a
/// `dir`/unknown targeting, a non-finite consumed number, and any declared blink distance other than the sim
/// leaf's proved `(300, 64)`.
pub(crate) fn admit_ranks(ranks: &[DeclaredRank]) -> Result<Vec<SourceRank>, WishRefusal> {
    if ranks.is_empty() {
        return Err(WishRefusal::new(
            "ranks",
            "empty ranks array: source rankOf reads ranks[i - 1], so there is no rank to decide with",
        ));
    }
    let mut out = Vec::with_capacity(ranks.len());
    for (index, rank) in ranks.iter().enumerate() {
        let path = |field: &str| format!("ranks[{index}].{field}");
        let cast_ms = rank.cast_ms.ok_or_else(|| {
            WishRefusal::new(
                path("castMs"),
                "absent rank castMs outside the finite profile",
            )
        })?;
        if !cast_ms.is_finite() {
            return Err(WishRefusal::new(
                path("castMs"),
                "non-finite castMs outside the finite profile",
            ));
        }
        let declared = rank.targeting.ok_or_else(|| {
            WishRefusal::new(
                path("targeting"),
                "absent rank targeting outside the finite profile",
            )
        })?;
        let targeting = match declared {
            DeclaredTargeting::Self_ => TargetRule::Self_,
            DeclaredTargeting::Unit {
                range,
                los,
                snap_radius,
            } => {
                if !range.is_finite() {
                    return Err(WishRefusal::new(
                        path("targeting.range"),
                        "non-finite unit range outside the finite profile",
                    ));
                }
                if !snap_radius.is_finite() {
                    return Err(WishRefusal::new(
                        path("targeting.snapRadius"),
                        "non-finite snapRadius outside the finite profile",
                    ));
                }
                TargetRule::Unit {
                    range,
                    los,
                    snap_radius,
                }
            }
            DeclaredTargeting::Point { range, min_range } => {
                if !range.is_finite() {
                    return Err(WishRefusal::new(
                        path("targeting.range"),
                        "non-finite point range outside the finite profile",
                    ));
                }
                if !min_range.is_finite() {
                    return Err(WishRefusal::new(
                        path("targeting.minRange"),
                        "non-finite point minRange outside the finite profile",
                    ));
                }
                TargetRule::Point { range, min_range }
            }
            DeclaredTargeting::Unsupported => {
                return Err(WishRefusal::new(
                    path("targeting.kind"),
                    "dir/unknown targeting outside the finite five-Wish profile",
                ));
            }
        };
        if let Some((max_dist, min_dist)) = rank.blink {
            if max_dist != PROFILE_BLINK_MAX_DIST || min_dist != PROFILE_BLINK_MIN_DIST {
                return Err(WishRefusal::new(
                    path("effects.blink"),
                    format!(
                        "declared blink distances ({max_dist:?}, {min_dist:?}) are outside the proved ({:?}, {:?}) profile",
                        PROFILE_BLINK_MAX_DIST, PROFILE_BLINK_MIN_DIST
                    ),
                ));
            }
        }
        out.push(SourceRank {
            cast_ms,
            targeting,
            hides_caster: rank.hides_caster,
            blink: rank.blink,
            wall: rank.wall,
        });
    }
    Ok(out)
}

/// Admit a declared `ai` tag. Unknown tags are outside the finite profile and refused at the exact path.
/// (The private replay intake/tests use this finite-profile entry; production source input is already typed.)
#[allow(dead_code)]
pub(crate) fn admit_ai_tag(path: &str, tag: &str) -> Result<AiIntent, WishRefusal> {
    Ok(match tag {
        "escape" => AiIntent::Escape,
        "sustain" => AiIntent::Sustain,
        "engage" => AiIntent::Engage,
        "control" => AiIntent::Control,
        "peel" => AiIntent::Peel,
        "burst" => AiIntent::Burst,
        "zone" => AiIntent::Zone,
        "buff" => AiIntent::Buff,
        other => {
            return Err(WishRefusal::new(
                path,
                format!("unknown ai tag {other:?} outside the finite profile"),
            ));
        }
    })
}

/// Admit a declared `blockedBy` tag. Unknown tags are outside the finite profile and refused at the exact path.
/// (The private replay intake/tests use this finite-profile entry; production source input is already typed.)
#[allow(dead_code)]
pub(crate) fn admit_blocked_by(path: &str, tag: &str) -> Result<BlockedBy, WishRefusal> {
    Ok(match tag {
        "stun" => BlockedBy::Stun,
        "silence" => BlockedBy::Silence,
        "root" => BlockedBy::Root,
        other => {
            return Err(WishRefusal::new(
                path,
                format!("unknown blockedBy tag {other:?} outside the finite profile"),
            ));
        }
    })
}

// ----------------------------------------------------------------------------------- shared availability/slip state

/// The one source `WishState` transition machine (`brain/modules/wishes.ts` `WishState` + `slipping` +
/// `slipStep`), shared by the private source module and the old public `WishModule` adapter.
///
/// The only legacy differences are two caller-selected fields, each documented at its entry point:
/// - the **sent-cast clock**: source derives it from the declared `Memory.self.lastCast` filtered by
///   `at >= armedAt`; the old wrapper infers it from the first observed casting bit and keeps it in
///   `sent_at` (`slipping_legacy`). Source states never set `sent_at`.
/// - the **expiry retention**: source clears only `armedAt` and keeps `from`/`leg` (a later hidden frame uses
///   the retained slip origin); the old wrapper also clears its inferred clock and `from`/`leg`
///   (`slipping_legacy`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct WishStateCore {
    /// The Wish was usable at the last observation: a new availability edge draws the Easy gate again.
    pub(crate) available: bool,
    /// This availability is remembered (always, except for Easy's draw).
    pub(crate) remembers: bool,
    pub(crate) last_try_at: f64,
    /// A hiding Wish was decided at this time (`None`: none outstanding), with its declared cast time.
    pub(crate) armed_at: Option<f64>,
    pub(crate) cast_ms: f64,
    /// The old public wrapper's inferred cast clock (see the type docs). The source module leaves this `None`.
    pub(crate) sent_at: Option<f64>,
    /// Where the enemy the bot slips from last stood.
    pub(crate) from: Option<Vec2>,
    /// The slip's current leg: `(to, at)`.
    pub(crate) leg: Option<(Vec2, f64)>,
}
impl WishStateCore {
    /// Source `stateOf`'s fresh entry: `lastTryAt: Number.NEGATIVE_INFINITY` so the first think may ask.
    pub(crate) fn new() -> Self {
        Self {
            available: false,
            remembers: true,
            last_try_at: f64::NEG_INFINITY,
            armed_at: None,
            cast_ms: 0.,
            sent_at: None,
            from: None,
            leg: None,
        }
    }
    pub(crate) fn remembers(&self) -> bool {
        self.remembers
    }
    pub(crate) fn available(&self) -> bool {
        self.available
    }

    /// Source `observe`: the availability edge, and the Easy tier's remember draw exactly once per rising edge
    /// (drawn from the declared decide lane; the source short-circuits so other tiers never draw).
    pub(crate) fn observe(&mut self, usable: bool, easy: bool, decide: &mut dyn FnMut() -> f64) {
        let now = usable;
        if now && !self.available {
            self.remembers = !easy || decide() < super::WISH_RULES.easy_remembers;
        }
        self.available = now;
    }

    /// The retry gate: a Wish is asked for at most once per `WISH_RULES.retryMs` (`now - lastTryAt < retry` blocks).
    pub(crate) fn retry_ready(&self, now: f64, rules: &WishRules) -> bool {
        // Source blocks only while `now - lastTryAt < retryMs`; NaN/incomparable is ready, as in JS.
        (now - self.last_try_at).partial_cmp(&rules.retry_ms) != Some(std::cmp::Ordering::Less)
    }
    /// Mark the attempt (source `st.lastTryAt = p.now`), after a decision.
    pub(crate) fn note_try(&mut self, now: f64) {
        self.last_try_at = now;
    }

    /// Source arm: `armedAt = now`, `castMs = rank.castMs`, `from = s.threat ?? s.foe` only when there is an
    /// enemy to slip from (a null enemy retains the previous origin), and `leg = null`.
    pub(crate) fn arm_source(&mut self, now: f64, cast_ms: f64, from: Option<Vec2>) {
        self.arm_inner(now, cast_ms, from, false);
    }
    /// The old public wrapper's arm: the same transitions plus clearing its inferred sent clock and
    /// overwriting `from` with `null` when there is no enemy (documented legacy deviation).
    pub(crate) fn arm_legacy(&mut self, now: f64, cast_ms: f64, from: Option<Vec2>) {
        self.arm_inner(now, cast_ms, from, true);
    }
    fn arm_inner(&mut self, now: f64, cast_ms: f64, from: Option<Vec2>, legacy: bool) {
        self.armed_at = Some(now);
        self.cast_ms = cast_ms;
        if let Some(from) = from {
            self.from = Some(from);
        } else if legacy {
            self.from = None;
        }
        self.leg = None;
        if legacy {
            self.sent_at = None;
        }
    }

    /// Source `slipping`: hidden short-circuits; once armed, the sent cast's own time plus the grace (or the
    /// casting bit) keeps it slipping, else the pending window from `armedAt`. `sent` is the declared
    /// `Memory.self.lastCast` time filtered by `at >= armedAt` (or `None`). On expiry only `armedAt` is cleared:
    /// `from`/`leg` are retained (source partial retention).
    pub(crate) fn slipping_source(
        &mut self,
        now: f64,
        hidden: bool,
        casting: bool,
        sent: Option<f64>,
        rules: &WishRules,
    ) -> bool {
        self.slipping_inner(now, hidden, casting, sent, rules, false)
    }

    /// The old public wrapper's `slipping`: its sent clock is inferred from the first observed casting bit and
    /// kept in `sent_at`; expiry also clears the inferred clock and `from`/`leg` (documented legacy behavior).
    pub(crate) fn slipping_legacy(
        &mut self,
        now: f64,
        hidden: bool,
        casting: bool,
        rules: &WishRules,
    ) -> bool {
        if !hidden && self.sent_at.is_none() && casting {
            self.sent_at = Some(now);
        }
        let sent = self.sent_at;
        self.slipping_inner(now, hidden, casting, sent, rules, true)
    }

    fn slipping_inner(
        &mut self,
        now: f64,
        hidden: bool,
        casting: bool,
        sent: Option<f64>,
        rules: &WishRules,
        legacy: bool,
    ) -> bool {
        if hidden {
            return true;
        }
        let Some(armed) = self.armed_at else {
            return false;
        };
        let keep = match sent {
            // The server's cast bit only appears once the cast is accepted; the sent record covers the time
            // before it, and a cast the server refused frees the slip after the cast time and the grace.
            Some(sent) => casting || now < sent + self.cast_ms + rules.slip_grace_ms,
            None => now < armed + rules.slip_pending_ms,
        };
        if !keep {
            self.armed_at = None;
            if legacy {
                self.sent_at = None;
                self.from = None;
                self.leg = None;
            }
        }
        keep
    }

    /// The module goal holds while there is somebody to slip from: a retained origin, or a nearest enemy on
    /// screen (source `st.from === null && nearestEnemy(ctx) === null`).
    pub(crate) fn slip_goal_holds(&self, has_enemy: bool) -> bool {
        self.from.is_some() || has_enemy
    }

    /// Source `slipStep`'s decision half, after the caller has updated `from` from its nearest-enemy fact: keep
    /// the current leg while it is younger than `slipKeepMs` and still more than `slipArrivedU` away, else
    /// choose a fresh clear-only `awayPoint` and record it. `None`: no origin, or cornered.
    pub(crate) fn slip_leg(
        &mut self,
        now: f64,
        self_at: Vec2,
        clear: &mut dyn FnMut(Vec2, Vec2) -> bool,
        rules: &WishRules,
        hypot: HypotMode,
    ) -> Option<Vec2> {
        let from = self.from?;
        let mut to = self.leg.and_then(|(leg_to, leg_at)| {
            let kept = now - leg_at < rules.slip_keep_ms
                && hypot.hypot(leg_to.x - self_at.x, leg_to.y - self_at.y) > rules.slip_arrived_u;
            kept.then_some(leg_to)
        });
        if to.is_none() {
            let point = away_point(clear, self_at, from, rules.slip_step_u, 0.)?;
            self.leg = Some((point, now));
            to = Some(point);
        }
        to
    }
}

/// Source `awayPoint` with the real clear callback: headings tried when a wall is in the way, in order, never
/// more than 60 degrees off, and a shortened step when the full one is not clear. Null: cornered.
pub(crate) fn away_point(
    clear: &mut dyn FnMut(Vec2, Vec2) -> bool,
    self_at: Vec2,
    threat: Vec2,
    step_u: f64,
    jitter: f64,
) -> Option<Vec2> {
    let base = rh_sim::math::atan2(self_at.y - threat.y, self_at.x - threat.x) + jitter;
    for turn in crate::bots::kite::TURNS {
        for share in crate::bots::kite::LENGTHS {
            let a = base + turn;
            let p = Vec2::new(
                self_at.x + rh_sim::math::cos(a) * step_u * share,
                self_at.y + rh_sim::math::sin(a) * step_u * share,
            );
            if clear(self_at, p) {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    //! Focused bridge witnesses for the one shared Wish core (P-BOT-MODULES-1): the static `WISHES` rows through the
    //! source-shaped adapter are bit-identical to the old public `decide_cast` on every captured `bot-wish.json` case and
    //! tag list; `rankOf` keeps the source f64 contract; the finite profile refuses unsupported declared shapes and tags;
    //! and the shared availability/retry/slip machine reproduces both the source transitions and the documented legacy
    //! pins. These are native witnesses only — the frozen module corpus is replayed by the separate replay harness.
    use super::{
        admit_ai_tag, admit_blocked_by, admit_ranks, away_point, decide_cast, hides_caster,
        rank_of, DeclaredRank, DeclaredTargeting, HypotMode, SourceAbility, SourceCastSituation,
        SourceRank, WishRules, WishStateCore,
    };
    use crate::bots::wish::{
        decide_cast_with, played_ai, wish_by_id, AiIntent, CastSituation, FoeView, MeView,
        TargetRule, ThreatView, TierId, WishDef, WISHES,
    };
    use rh_sim::abilities::blink;
    use rh_sim::{TileMap, Vec2};
    use serde_json::Value;

    const FIXTURE: &str = include_str!("../../../../../parity/policy/bot-wish.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).expect("the captured wish corpus parses")
    }
    fn text(v: &Value) -> &str {
        v.as_str().expect("a string")
    }
    fn num(v: &Value) -> f64 {
        v.as_f64().expect("a number")
    }
    fn ability(v: &Value) -> rh_sim::status_runtime::AbilityId {
        use rh_sim::status_runtime::AbilityId;
        match text(v) {
            "freeze" => AbilityId::Freeze,
            "swarm" => AbilityId::Swarm,
            "trial" => AbilityId::Trial,
            "blaze" => AbilityId::Blaze,
            "lastStand" => AbilityId::LastStand,
            other => panic!("unknown ability {other}"),
        }
    }
    fn legacy_situation<'a>(
        row: &Value,
        map: &'a TileMap,
        ring: &'a blink::Ring,
    ) -> CastSituation<'a> {
        let me = &row["me"];
        let me_view = MeView {
            x: num(&me["x"]),
            y: num(&me["y"]),
            hp_frac: num(&me["hpFrac"]),
            effects: me["effects"].as_u64().unwrap() as u16,
            recently_hit: me["recentlyHit"].as_bool().unwrap(),
        };
        let foe = if row["foe"].is_null() {
            None
        } else {
            let f = &row["foe"];
            Some(FoeView {
                id: text(&f["id"]).into(),
                x: num(&f["x"]),
                y: num(&f["y"]),
                d: num(&f["d"]),
                los: f["los"].as_bool().unwrap_or(true),
                targetable: f["targetable"].as_bool().unwrap_or(true),
                mob: f["mob"].as_bool().unwrap_or(false),
            })
        };
        let threat = if row["threat"].is_null() {
            None
        } else {
            let t = &row["threat"];
            Some(ThreatView {
                x: num(&t["x"]),
                y: num(&t["y"]),
                d: num(&t["d"]),
                chasing: t["chasing"].as_bool().unwrap_or(false),
                id: t["id"].as_str().map(str::to_owned),
                los: t["los"].as_bool(),
                targetable: t["targetable"].as_bool(),
            })
        };
        CastSituation {
            me: me_view,
            foe,
            threat,
            map,
            ring,
            gates_locked: row["gatesLocked"].as_bool().unwrap_or(false),
        }
    }
    fn source_situation<'a>(s: &CastSituation<'a>) -> SourceCastSituation<'a> {
        SourceCastSituation {
            me: s.me,
            foe: s.foe.clone(),
            threat: s.threat.clone(),
            map: s.map,
            // The old public adapter's documented open/unlocked landing behavior: both maps are the open map and the flag
            // is false; the source module passes the real collision map and p.hud.gates_locked instead.
            collision: s.map,
            ring: s.ring,
            gates_locked: false,
            hypot: HypotMode::Legacy,
        }
    }
    /// The static `WISHES` row as the shared source view (exactly what `decide_cast_with` builds internally).
    fn static_view<'a>(
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
    fn static_ranks(def: &WishDef) -> [SourceRank; 1] {
        [SourceRank {
            cast_ms: def.rank.cast_ms,
            targeting: def.rank.targeting,
            hides_caster: def
                .rank
                .effects
                .iter()
                .any(|e| matches!(e, super::super::PolicyEffect::HidesCaster)),
            blink: def.rank.effects.iter().find_map(|e| match e {
                super::super::PolicyEffect::Blink { max_dist, min_dist } => {
                    Some((*max_dist, *min_dist))
                }
                super::super::PolicyEffect::HidesCaster
                | super::super::PolicyEffect::Wall { .. } => None,
            }),
            wall: false,
        }]
    }

    #[test]
    fn source_rank_of_follows_the_f64_source_rankof_contract() {
        let ranks = [
            SourceRank {
                cast_ms: 1.,
                targeting: TargetRule::Self_,
                hides_caster: false,
                blink: None,
                wall: false,
            },
            SourceRank {
                cast_ms: 2.,
                targeting: TargetRule::Self_,
                hides_caster: true,
                blink: None,
                wall: false,
            },
        ];
        // floor, clamp to 1..=len; nonfinite becomes 1; a rank is never narrowed/rejected.
        for (rank, want) in [
            (-10.0, 0usize),
            (-0.25, 0),
            (0.0, 0),
            (0.9, 0),
            (1.0, 0),
            (1.5, 0),
            (2.0, 1),
            (2.9, 1),
            (999.0, 1),
            (f64::NAN, 0),
            (f64::INFINITY, 0),
            (f64::NEG_INFINITY, 0),
        ] {
            assert_eq!(
                rank_of(&ranks, rank).map(|r| r.cast_ms),
                Some(want as f64 + 1.),
                "rank {rank}"
            );
            assert_eq!(
                hides_caster(&ranks, rank),
                want == 1,
                "hides at rank {rank}"
            );
        }
        // The five static rows have one rank: every source rank number selects it.
        for def in &WISHES {
            let ranks = static_ranks(def);
            for rank in [-10.0, 0.0, 1.0, 1.5, 999.0, f64::NAN] {
                assert_eq!(
                    rank_of(&ranks, rank),
                    Some(&ranks[0]),
                    "{} rank {rank}",
                    def.name
                );
            }
        }
    }

    #[test]
    fn the_static_rows_through_the_source_core_equal_the_old_public_decision() {
        let f = fixture();
        let map_value = &f["profile"]["map"];
        let w = map_value["w"].as_u64().unwrap() as u32;
        let h = map_value["h"].as_u64().unwrap() as u32;
        let tiles: Vec<u8> = map_value["tiles"]
            .as_array()
            .expect("map tiles")
            .iter()
            .map(|t| t.as_u64().unwrap() as u8)
            .collect();
        let map = TileMap::new(w, h, tiles).expect("the declared map is admitted");
        let ring = blink::Ring::new(&map);
        let cases = f["cases"].as_array().expect("cases");
        assert!(cases.len() >= 100, "the declared case set: {}", cases.len());

        // Both tag lists the source module can play: the full declared order, and Easy's escape/sustain filter (null means
        // no tags at all, so no decision is asked for).
        for tier in [TierId::Easy, TierId::Normal, TierId::Hard] {
            let mut checked = 0usize;
            for row in cases {
                let def = wish_by_id(ability(&row["def"])).expect("the policy has every Wish");
                let rank = row["rank"].as_f64().unwrap_or(1.);
                let legacy_ai = played_ai(def, tier).unwrap_or(&[]);
                let s = legacy_situation(row, &map, &ring);
                let old = decide_cast_with(def, legacy_ai, rank.clamp(1., 255.) as u8, &s);

                let ranks = static_ranks(def);
                let view = static_view(def, legacy_ai, &ranks);
                let source_s = source_situation(&s);
                let new = decide_cast(&view, rank, &source_s);
                assert_eq!(
                    old, new,
                    "{tier:?} {} rank {rank}: old {old:?} != source core {new:?}",
                    def.name
                );
                checked += 1;
            }
            assert_eq!(
                checked,
                cases.len(),
                "{tier:?}: every captured case checked"
            );
        }
    }

    fn rank(
        cast_ms: Option<f64>,
        targeting: Option<DeclaredTargeting>,
        blink: Option<(f64, f64)>,
    ) -> DeclaredRank {
        DeclaredRank {
            cast_ms,
            targeting,
            hides_caster: false,
            blink,
            wall: false,
        }
    }

    #[test]
    fn the_finite_profile_refuses_before_any_decision() {
        let self_ = Some(DeclaredTargeting::Self_);
        // Admitted: the five actual shapes.
        let ok = admit_ranks(&[rank(
            Some(250.),
            Some(DeclaredTargeting::Unit {
                range: 450.,
                los: true,
                snap_radius: 64.,
            }),
            None,
        )])
        .expect("the actual Freeze rank is admitted");
        assert_eq!(
            ok[0].targeting,
            TargetRule::Unit {
                range: 450.,
                los: true,
                snap_radius: 64.
            }
        );
        let blaze = admit_ranks(&[rank(
            Some(0.),
            Some(DeclaredTargeting::Point {
                range: 300.,
                min_range: 64.,
            }),
            Some((300., 64.)),
        )])
        .expect("the actual Blaze rank is admitted");
        assert_eq!(blaze[0].blink, Some((300., 64.)));

        // dir / unknown targeting.
        let refused = admit_ranks(&[rank(Some(0.), Some(DeclaredTargeting::Unsupported), None)])
            .expect_err("dir targeting is outside the finite profile");
        assert_eq!(refused.path, "ranks[0].targeting.kind");
        assert!(refused.detail.contains("dir/unknown"), "{refused}");

        // A declared blink whose distances are not the proved sim-leaf (300, 64) is refused, never silently replaced.
        let refused = admit_ranks(&[rank(
            Some(0.),
            Some(DeclaredTargeting::Point {
                range: 300.,
                min_range: 64.,
            }),
            Some((400., 64.)),
        )])
        .expect_err("different max distance refused");
        assert_eq!(refused.path, "ranks[0].effects.blink");
        assert!(refused.detail.contains("400"), "{refused}");
        let refused = admit_ranks(&[rank(
            Some(0.),
            Some(DeclaredTargeting::Point {
                range: 300.,
                min_range: 64.,
            }),
            Some((300., 32.)),
        )])
        .expect_err("different min distance refused");
        assert!(refused.detail.contains("32"), "{refused}");
        assert!(
            admit_ranks(&[rank(
                Some(0.),
                Some(DeclaredTargeting::Point {
                    range: 300.,
                    min_range: 64.
                }),
                Some((f64::INFINITY, 64.))
            )])
            .is_err(),
            "non-finite blink distances refused"
        );

        // Absent consumed members (`ranks: [{}]`) are refused when a decision would consume them, and never coerced.
        let refused = admit_ranks(&[rank(None, self_, None)]).expect_err("absent castMs refused");
        assert_eq!(refused.path, "ranks[0].castMs");
        let refused =
            admit_ranks(&[rank(Some(250.), None, None)]).expect_err("absent targeting refused");
        assert_eq!(refused.path, "ranks[0].targeting");
        // Non-finite consumed numbers.
        assert!(admit_ranks(&[rank(Some(f64::NAN), self_, None)]).is_err());
        assert!(admit_ranks(&[rank(
            Some(250.),
            Some(DeclaredTargeting::Unit {
                range: f64::INFINITY,
                los: true,
                snap_radius: 64.
            }),
            None
        )])
        .is_err());

        // Unknown ai / blockedBy tags are refused at their declared path (the typed reader uses these entries).
        let refused = admit_ai_tag("ai[2]", "teleport").expect_err("unknown ai tag refused");
        assert_eq!(refused.path, "ai[2]");
        let refused =
            admit_blocked_by("blockedBy[0]", "displace").expect_err("unknown blockedBy tag");
        assert_eq!(refused.path, "blockedBy[0]");
        // Every captured tag still parses.
        for tag in [
            "escape", "sustain", "engage", "control", "peel", "burst", "zone", "buff",
        ] {
            assert!(admit_ai_tag("ai", tag).is_ok(), "ai {tag}");
        }
        for tag in ["stun", "silence", "root"] {
            assert!(
                admit_blocked_by("blockedBy", tag).is_ok(),
                "blockedBy {tag}"
            );
        }
    }

    fn rules() -> WishRules {
        crate::bots::wish::WISH_RULES
    }

    #[test]
    fn observe_draws_the_easy_gate_once_per_usable_edge_only() {
        let mut state = WishStateCore::new();
        assert!(state.remembers());
        // Non-Easy tiers never draw (the source short-circuits its `||`), even on a rising edge.
        state.observe(true, false, &mut || panic!("non-Easy must not draw"));
        state.observe(true, true, &mut || panic!("no draw without a new edge"));
        // A usable -> unusable -> usable sequence is an Easy edge and draws once.
        state.observe(false, true, &mut || panic!("no draw on the falling edge"));
        let mut draws = 0usize;
        state.observe(true, true, &mut {
            let draws = &mut draws;
            move || {
                *draws += 1;
                0.5
            }
        });
        assert_eq!(draws, 1);
        state.observe(true, true, &mut || {
            panic!("no draw while the slot stays usable")
        });
        // The next rising edge draws again.
        state.observe(false, true, &mut || panic!("no draw on the falling edge"));
        state.observe(true, true, &mut {
            let draws = &mut draws;
            move || {
                *draws += 1;
                0.75
            }
        });
        assert_eq!(draws, 2);
        assert!(!state.remembers(), "0.75 is above the 0.6 Easy threshold");

        // The first draw keeps the Wish only below easyRemembers.
        let mut state = WishStateCore::new();
        state.observe(true, true, &mut || 0.599_999);
        assert!(state.remembers());
    }

    #[test]
    fn retry_gate_is_exact_at_the_source_boundary() {
        let rules = rules();
        let mut state = WishStateCore::new();
        assert!(
            state.retry_ready(0., &rules),
            "-infinity first try is ready"
        );
        state.note_try(1_000.);
        assert!(!state.retry_ready(1_999., &rules));
        assert!(
            state.retry_ready(2_000., &rules),
            "exactly retryMs later is ready"
        );
    }

    fn armed(now: f64) -> WishStateCore {
        let mut state = WishStateCore::new();
        state.arm_source(now, 250., Some(Vec2::new(7., 8.)));
        state
    }

    #[test]
    fn source_slipping_keeps_from_and_leg_on_expiry() {
        let rules = rules();
        // Pending window: armedAt + slipPendingMs.
        let mut state = armed(1_000.);
        assert!(state.slipping_source(1_000. + 2_499., false, false, None, &rules));
        assert!(!state.slipping_source(1_000. + 2_500., false, false, None, &rules));
        assert!(state.armed_at.is_none());
        assert_eq!(
            state.from,
            Some(Vec2::new(7., 8.)),
            "source retains the slip origin"
        );
        state.leg = Some((Vec2::new(300., 0.), 1_000.));
        assert!(
            state.leg.is_some(),
            "and the leg (no source reset of derived slip state)"
        );

        // Sent clock: sent + castMs + slipGraceMs.
        let mut state = armed(1_000.);
        state.sent_at = Some(1_100.);
        assert!(state.slipping_source(1_100. + 250. + 699., false, false, Some(1_100.), &rules));
        assert!(!state.slipping_source(1_100. + 250. + 700., false, false, Some(1_100.), &rules));
        // Hidden short-circuits without expiring anything.
        let mut state = armed(1_000.);
        assert!(state.slipping_source(9_999., true, false, None, &rules));
        assert_eq!(state.armed_at, Some(1_000.));
        // The casting bit alone does not extend the window when there is no declared sent cast (source exact; the old
        // wrapper's inference is the documented legacy pin).
        let mut state = armed(1_000.);
        assert!(!state.slipping_source(1_000. + 2_500., false, true, None, &rules));
    }

    #[test]
    fn legacy_slipping_keeps_its_inferred_clock_and_expiry_reset() {
        let rules = rules();
        let mut state = armed(1_000.);
        // First observed casting bit infers the sent clock (the legacy behavior the source adapter does not use).
        assert!(state.slipping_legacy(1_200., false, true, &rules));
        assert_eq!(state.sent_at, Some(1_200.));
        // sent + castMs + grace: 1200 + 250 + 700 = 2150.
        assert!(state.slipping_legacy(2_149., false, false, &rules));
        assert!(!state.slipping_legacy(2_150., false, false, &rules));
        assert!(state.armed_at.is_none());
        assert!(state.sent_at.is_none());
        assert!(state.from.is_none());
        assert!(state.leg.is_none());
    }

    #[test]
    fn arming_keeps_the_documented_legacy_fields_distinct() {
        // Source: a null enemy retains the previous origin; never touches the legacy inferred clock.
        let mut state = armed(1_000.);
        state.sent_at = Some(900.);
        state.arm_source(1_100., 0., None);
        assert_eq!(state.from, Some(Vec2::new(7., 8.)));
        assert_eq!(state.sent_at, Some(900.));
        state.arm_source(1_200., 0., Some(Vec2::new(1., 2.)));
        assert_eq!(state.from, Some(Vec2::new(1., 2.)));
        assert!(state.leg.is_none(), "arming always clears the leg");
        // Legacy: a null enemy overwrites the origin and its inferred clock is cleared.
        let mut state = armed(1_000.);
        state.sent_at = Some(900.);
        state.leg = Some((Vec2::new(5., 5.), 1_000.));
        state.arm_legacy(1_100., 0., None);
        assert!(state.from.is_none());
        assert!(state.sent_at.is_none());
        assert!(state.leg.is_none());
    }

    #[test]
    fn slip_leg_keeps_a_young_unarrived_leg_and_rechooses_otherwise() {
        let rules = rules();
        let mut state = WishStateCore::new();
        state.from = Some(Vec2::new(0., 0.));
        let calls = std::cell::Cell::new(0usize);
        let mut clear = |_a: Vec2, _b: Vec2| {
            calls.set(calls.get() + 1);
            true
        };
        // Fresh leg: away from (0,0) at origin -> the straight clear heading full step (stepU 300, share 1).
        let to = state
            .slip_leg(1_000., Vec2::new(0., 0.), &mut clear, &rules, HypotMode::Js)
            .expect("a clear heading");
        assert_eq!(to, Vec2::new(300., 0.));
        assert_eq!(state.leg, Some((Vec2::new(300., 0.), 1_000.)));
        let calls_after_first = calls.get();
        // Young (now - at < 1200) and more than 60 away: the same leg is offered without a new clear search.
        let to = state
            .slip_leg(2_199., Vec2::new(0., 0.), &mut clear, &rules, HypotMode::Js)
            .expect("kept leg");
        assert_eq!(to, Vec2::new(300., 0.));
        assert_eq!(calls.get(), calls_after_first);
        // Leg age 1200 no longer keeps it: a new search happens.
        let _ = state
            .slip_leg(2_200., Vec2::new(0., 0.), &mut clear, &rules, HypotMode::Js)
            .expect("re-chosen");
        assert!(calls.get() > calls_after_first);
        // Arrived (distance exactly slipArrivedU is not more than it): re-choose; all headings denied is cornered.
        state.leg = Some((Vec2::new(300., 0.), 2_200.));
        assert_eq!(
            state.slip_leg(
                2_300.,
                Vec2::new(240., 0.),
                &mut |_, _| true,
                &rules,
                HypotMode::Js
            ),
            Some(Vec2::new(540., 0.)),
            "distance 60 is not > 60, so the heading is chosen again from the new position"
        );
        state.leg = Some((Vec2::new(300., 0.), 2_200.));
        assert_eq!(
            state.slip_leg(
                2_300.,
                Vec2::new(240., 0.),
                &mut |_, _| false,
                &rules,
                HypotMode::Js
            ),
            None
        );
    }

    #[test]
    fn the_away_search_tries_the_source_turns_and_lengths_in_order() {
        let mut seen = Vec::new();
        let mut clear = |a: Vec2, b: Vec2| {
            seen.push((a, b));
            seen.len() == 3
        };
        let point = away_point(&mut clear, Vec2::new(0., 0.), Vec2::new(0., 0.), 300., 0.)
            .expect("the third candidate is clear");
        assert_eq!(seen.len(), 3);
        // turn 0 share 1, then turn 0 share 0.6, then turn +0.5 share 1.
        assert_eq!(seen[0].1, Vec2::new(300., 0.));
        assert_eq!(seen[1].1, Vec2::new(180., 0.));
        assert_eq!(point, seen[2].1);
        assert!(point.x < 300. && point.y > 100., "{point:?}");
    }

    #[test]
    fn two_state_entries_are_independent() {
        let mut a = WishStateCore::new();
        let b = WishStateCore::new();
        a.observe(true, true, &mut || 0.1);
        assert!(a.available() && a.remembers());
        assert!(!b.available() && b.remembers(), "a second cfg starts fresh");
        assert_eq!(a.last_try_at, f64::NEG_INFINITY);
        assert_eq!(b.last_try_at, f64::NEG_INFINITY);
    }
}
