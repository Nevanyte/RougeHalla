//! Private Brain configuration, caller-owned service handles and exported statistics (P-BOT-BRAIN-NATIVE-1).
//!
//! These are the declared private method inputs of the source `createBrain` composition: a resolved tier/persona
//! profile, the caller-declared map metadata, the caller-owned module object list, the caller-bound path service handle
//! (the room driver owns the borrowed allowance), the caller log/learned sinks and the caller feature verdicts. Nothing
//! here reads World/Sim, a clock, global entropy or a public observation. The Brain never allocates or replaces the
//! caller's path service/budget/cache and never copies or reseeds a provider.

use super::host::ModuleHandle;
use super::trace::Recorder;
use crate::bots::humanizer::HumanizerStats;
use crate::bots::paths::{PathBudget, PathStats, WalkAnswer};
use crate::bots::planning::PlanMap;
use crate::bots::temporal_percept::memory::MemoryMap;
use crate::bots::temporal_percept::modules::types::CfgToken;
use crate::bots::temporal_percept::strategy::types::{GoalKind, StrategyMap};
use crate::bots::temporal_percept::tactics::types::TacticsMap;
use crate::bots::types::{PersonaParams, ServerMs, Stimulus, TierParams};
use crate::bots::view::Features;
use rh_sim::{FactionId, TileMap};
use std::sync::Arc;

/// Source `BRAIN_RULES` (brain.ts): the brain's own timings/thresholds.
pub(crate) const STILL_GRACE_MS: f64 = 600.;
pub(crate) const STILL_EPS: f64 = 1.;
pub(crate) const ACT_MAX_GAP_MS: f64 = 2000.;
pub(crate) const GRAB_WINDOW_MS: f64 = 2000.;

/// The caller-declared map metadata one Brain reads (source `GameMap`, already validated by the caller adapter).
/// Construction of this record is caller work (source maps come from `generateMap`/`mapFromTiles`); no Brain instance
/// derives or rewrites it. `open`/`locked` are the source `withGates` collision views, `terrain` is the declared row-major
/// terrain layer, and the strategy/tactics/module/memory/planning projections are the same declared map's typed views.
pub(crate) struct BrainMap {
    /// The complete declared source `GameMap` record (own-key order preserved): the exact object the source path service
    /// returns from `collisionMap` and passes as camp/chest callback arguments.
    pub(crate) raw: super::trace::BVal,
    pub(crate) open: TileMap,
    pub(crate) locked: TileMap,
    pub(crate) terrain: Vec<u8>,
    pub(crate) strategy: StrategyMap,
    pub(crate) tactics: TacticsMap,
    pub(crate) memory: MemoryMap,
    pub(crate) plan: PlanMap,
}

impl BrainMap {
    /// Source `withGates(map)` for the frame's gate state: the locked collision view when the percept says the gates
    /// are locked, else the open view. LOS/clear/collision reads stay budget-free.
    pub(crate) fn collision(&self, gates_locked: bool) -> &TileMap {
        if gates_locked {
            &self.locked
        } else {
            &self.open
        }
    }
}

/// The caller-owned room path service handle the Brain drives. The caller keeps the original `RoomPathService` and its
/// cache; this handle only borrows it for the calls of one Brain. `walk`/`path` take the caller's shared allowance (the
/// room driver calls `start_tick()` once per room frame); the Brain never allocates, resets or replaces the service or
/// allowance and `set_frame` never replenishes it. `module_paths_capable` is the pre-mutation capability probe: a Brain
/// whose handle cannot provide the rich module path surface refuses composition before constructing any component.
pub(crate) trait BrainPathService: Send {
    fn set_frame(&mut self, now: ServerMs, gates_locked: bool);
    fn walk(
        &mut self,
        from: rh_sim::Vec2,
        to: rh_sim::Vec2,
        budget: &mut PathBudget,
    ) -> Option<WalkAnswer>;
    fn path(
        &mut self,
        from: rh_sim::Vec2,
        to: rh_sim::Vec2,
        budget: &mut PathBudget,
    ) -> Option<Vec<rh_sim::Vec2>>;
    fn los(&self, a: rh_sim::Vec2, b: rh_sim::Vec2) -> bool;
    fn clear(&self, a: rh_sim::Vec2, b: rh_sim::Vec2) -> bool;
    fn collision_map(&self) -> &TileMap;
    fn stats(&self) -> PathStats;
    /// The strategy `PathApi::module_paths` capability probe. The Brain path adapter implements both private path
    /// traits; a caller handle that does not expose the rich surface refuses composition.
    fn module_paths_capable(&self) -> bool;
}

/// A caller-owned path service handle: one actual service/cache identity, borrowed for one Brain tick. `Send`-owned so
/// the persistent private Brain graph keeps the `Policy: Send` contract; the room driver may hold the Arc across bots.
pub(crate) type PathHandle = Arc<std::sync::Mutex<Box<dyn BrainPathService>>>;

/// Source `cfg.services` (services.ts): the caller's path service handle, log sink and learned-bias callback surface.
#[derive(Clone)]
pub(crate) struct CallerServices {
    pub(crate) paths: PathHandle,
    /// Source `services.log(message)`; the Brain prefixes its own log lines with `cfg.name` exactly as source does.
    pub(crate) log: Arc<dyn Fn(&str) + Send + Sync>,
    /// Source `cfg.learned`: enabled flag plus the caller's bounded key-bias lookup.
    pub(crate) learned: Arc<dyn super::super::strategy::types::LearnedBias + Send + Sync>,
}

/// Source `BrainConfig` (types.ts): the private method inputs of one Brain. `tier`/`persona` are the caller's actual
/// canonical static profiles (or finite test-only fixture-owned static storage for custom declared values); the Brain
/// borrows them unchanged and never replaces a supplied full profile with a `TierParams::by_id` lookup.
///
/// For a nonempty module list the Brain mints one new stable `bcfg` identity token (source `{...cfg, modules: guarded}`)
/// used for module per-cfg state; for a truly empty list the source keeps the original cfg identity. The token is
/// assigned by [`super::host::ModuleHost`] from actual construction, never from an actor id, seed or value equality.
pub(crate) struct BrainConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) seed: u32,
    pub(crate) tier: &'static TierParams,
    pub(crate) persona: &'static PersonaParams,
    pub(crate) map: Arc<BrainMap>,
    pub(crate) features: Features,
    /// The caller's ordered module object handles (source `cfg.modules`): actual shared objects in original order,
    /// duplicates preserved. The Brain wraps this list for guarding; it never recreates or reorders the objects.
    pub(crate) modules: Vec<ModuleHandle>,
    pub(crate) services: CallerServices,
    /// The original caller cfg identity token (the source `cfg` object identity). A Brain with an empty module list
    /// keeps this token as its `bcfg`; otherwise it receives a fresh per-Brain token.
    pub(crate) original_cfg: CfgToken,
    /// The caller's original path-service handle label (the frozen runner's service key). Debug/trace use only; the Brain
    /// never derives identity from it.
    pub(crate) service_label: String,
    /// The caller's own debug label for this Brain instance (the frozen runner's `active` handle). Only the test trace
    /// recorder reads it; production callers pass `None`.
    pub(crate) trace_actor: Option<String>,
    /// Test-only recording sink for the frozen-source component trace; production callers pass `None`.
    pub(crate) recorder: Option<Recorder>,
    /// Test-only hook allowing the composition-refusal control to probe a handle that lacks the module-path capability.
    #[cfg(test)]
    pub(crate) force_missing_module_paths: bool,
}

/// Source `RunResult` (types.ts): the caller's result when the run ended, or `None` (`end(null)`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RunResult {
    pub(crate) outcome: String,
    pub(crate) place: f64,
    pub(crate) players: f64,
}

/// Source `RunSummary` (types.ts `end`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RunSummary {
    pub(crate) tier: String,
    pub(crate) persona: String,
    pub(crate) faction: Option<FactionId>,
    pub(crate) outcome: String,
    pub(crate) place: f64,
    pub(crate) players: f64,
    pub(crate) choices: Vec<String>,
}

/// Source `BrainStats` (types.ts): the humanizer's own counters plus the Brain/Hunt/Tactics/goal diagnostics. The
/// strategy HuntStats are exported (mobTargets/mobDrops/retreats/mobFocusMs/build/routeContests), not the tactics
/// analogues.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BrainStats {
    pub(crate) humanizer: HumanizerStats,
    pub(crate) mob_targets: f64,
    pub(crate) mob_drops: f64,
    pub(crate) retreats: f64,
    pub(crate) mob_focus_ms: f64,
    pub(crate) grabs: u64,
    pub(crate) max_stall_ms: f64,
    pub(crate) dodges: u64,
    pub(crate) jukes: u64,
    pub(crate) kite_cycles: u64,
    pub(crate) goals: Vec<(GoalKind, u64)>,
    pub(crate) build: String,
    pub(crate) route_contests: u64,
}

/// The three source runtime lanes one Brain owns (source `BrainRngs`): one actual Mulberry32 stream per lane, derived
/// from the Brain seed with the source tag derivation. The command-construction Knowledge tag-3 constructor stream is
/// separate and never part of this tuple.
pub(crate) struct BrainRngs {
    pub(crate) decide: crate::bots::random::Rng,
    pub(crate) motor: crate::bots::random::Rng,
    pub(crate) lapse: crate::bots::random::Rng,
}

impl BrainRngs {
    /// Source `derive(seed, tag)` + `mulberry32` for the three runtime lanes.
    pub(crate) fn derive(seed: u32) -> Self {
        Self {
            decide: crate::bots::random::Rng::new(derive(seed, 0)),
            motor: crate::bots::random::Rng::new(derive(seed, 1)),
            lapse: crate::bots::random::Rng::new(derive(seed, 2)),
        }
    }
    /// Knowledge's separate source tag-3 constructor stream.
    pub(crate) fn knowledge(seed: u32) -> crate::bots::random::Rng {
        crate::bots::random::Rng::new(derive(seed, 3))
    }
}

/// Source `derive(seed, tag)` (brain.ts): the bot seed mixed with a tag so no two streams march in step.
pub(crate) fn derive(seed: u32, tag: u32) -> u32 {
    let mut h = (seed.wrapping_mul(0x9e37_79b1)) ^ ((tag + 1).wrapping_mul(0x85eb_ca6b));
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}

/// A typed Brain failure. Native invariant/input failures are kept distinct from represented source hook faults: the
/// latter are caught inside the per-module guard and reported through the source fallback/log path; a `BrainError` is a
/// native/composition failure with no source fallback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BrainError {
    /// The caller's path handle cannot compose the full module-goal path surface: refused before any component exists.
    MissingModulePathsCapability,
    /// A declared input leaf is absent/shape-invalid at a native access boundary (the checked intake rejects first).
    Shape(&'static str),
    /// A source contract leaf is absent at a native access boundary.
    Missing(&'static str),
    /// The caller supplied non-finite geometry/clock where the source contract requires a finite number.
    Nonfinite(&'static str),
}

impl std::fmt::Display for BrainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BrainError::MissingModulePathsCapability => {
                f.write_str("caller path service lacks the module-path capability")
            }
            BrainError::Shape(key) => write!(f, "wrong shape for {key}"),
            BrainError::Missing(key) => write!(f, "missing {key}"),
            BrainError::Nonfinite(key) => write!(f, "non-finite {key}"),
        }
    }
}
impl std::error::Error for BrainError {}

/// A per-tick caller package: the borrowed room allowance the caller started once for this room frame. The Brain never
/// holds it across ticks and never resets it.
pub(crate) struct RoomFrame<'a> {
    pub(crate) budget: &'a mut PathBudget,
}

/// One released source command as the caller receives it. The source order/carrying fact is `TimedCommand`, plus the
/// stamped move/stop sequence number the Brain applies before `Memory.note_sent` (only move/stop are stamped; the other
/// command types carry `None` and stay unstamped).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ReleasedCommand {
    pub(crate) at: f64,
    pub(crate) cmd: crate::bots::types::Command,
    pub(crate) intent: crate::bots::types::IntentKind,
    pub(crate) priority: u8,
    pub(crate) stimulus: Option<Stimulus>,
    /// Source `cmd.msg.seq` for a stamped move/stop (1..=255 wrapping); `None` for every other command.
    pub(crate) seq: Option<f64>,
}

/// The commands one tick released (source `readonly TimedCommand[]`).
pub(crate) type ReleasedCommands = Vec<ReleasedCommand>;
