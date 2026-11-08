//! The tick as data: the legacy `updateActive` phases, the registration lists its phases run, the action handlers and the
//! world hook chains, each as a table of rows `{legacy name, config gate, run}`.
//!
//! In legacy the tick order is emergent: `step.ts updateActive` is 23 fixed phases, but what runs inside `hooks:systems`
//! or in a hook chain depends on module install order, `push`/`unshift` and `chainHook`. `parity/legacy-capture/schedule.ts`
//! records that order from the real `createGameWorld` (`parity/schedule/legacy_schedule.json`, `rh-legacy-schedule/2`)
//! for three worlds (production, capture, training), and `crates/rh-parity/tests/schedule.rs` fails when a table here
//! stops matching the record (names, order and every hook chain), when a row is swapped, dropped or moved, and when a
//! tick executes its ported rows in another order than the table (C-TICK, executable).
//!
//! Rules (docs/adr/0009-core-layout.md):
//! * a row is [`Run::Ported`], [`Run::Partial`] (an executed subresponsibility plus pending remainder), or [`Run::Pending`] (a real id in
//!   `docs/backlog/README.md`); a pending row is skipped, exactly as the legacy mechanic does not exist yet;
//! * a mechanic packet adds `systems/<mechanic>.rs` and flips its rows from `Pending` to `Ported`; it never reorders a
//!   table and never calls a system from anywhere else (the loops in [`run_steps`] and `run_list` are the only callers);
//! * a row's [`Gate`] is the legacy condition that decides whether the world has it (`signatures`, `walkHints`,
//!   `quests`, training...); the slice plays the capture world ([`Gates::of`]);
//! * a phase returns [`Flow`]: `EndTick` ends the tick as a legacy `return` in `updateActive` does (`guard:voided`).
//!
//! The tables are `pub(crate)` (their rows hold `fn(&mut Cx)`); [`tables`] projects them as plain data for the
//! conformance test.

use crate::fighter::{FighterCore, FighterIx};
use crate::hooks::LinkFn;
use crate::input::ActionCmd;
use crate::state::World;
use crate::statics::MatchStatic;
use crate::systems::{
    credit, inputs, items, ledger, loot, melee, movement, projectiles, settle, weapons, Cx,
};

// ---------------------------------------------------------------------------------------------------------------------
// Gates: which rows a world has
// ---------------------------------------------------------------------------------------------------------------------

/// The legacy condition a row exists under (what the three recorded worlds differ by).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gate {
    Always,
    /// `config.signatures`: factions, fire roam, bruiser passives, plague corpses and zombies, the Sentenced hunt.
    Signatures,
    /// `config.walkHints`.
    WalkHints,
    /// `config.mobs`.
    Mobs,
    /// `config.quests && !config.training` (quests' install guard).
    Quests,
    /// `config.dummies`.
    Dummies,
    /// `config.training`.
    Training,
    /// `!config.training`.
    NotTraining,
}

/// The configuration switches the gates read: one value per recorded world.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Gates {
    pub signatures: bool,
    pub walk_hints: bool,
    pub mobs: bool,
    pub quests: bool,
    pub dummies: bool,
    pub training: bool,
}

impl Gates {
    /// `createGameWorld` with the live server's defaults.
    pub const PRODUCTION: Gates = Gates {
        signatures: true,
        walk_hints: true,
        mobs: true,
        quests: true,
        dummies: false,
        training: false,
    };
    /// The parity fixtures' module set and config: signatures and walk hints off, no mobs, quests or dummies.
    pub const CAPTURE: Gates = Gates {
        signatures: false,
        walk_hints: false,
        mobs: false,
        quests: false,
        dummies: false,
        training: false,
    };
    /// The practice room: the training config, then `installTraining`.
    pub const TRAINING: Gates = Gates {
        signatures: true,
        walk_hints: true,
        mobs: true,
        quests: false,
        dummies: true,
        training: true,
    };

    /// The match uses the baseline capture plan or the explicitly partial Holy foundation.
    /// Other signature producers remain Pending even in the latter plan.
    pub(crate) const fn of(k: &MatchStatic) -> Gates {
        if k.config.training {
            return Gates::TRAINING;
        }
        if matches!(
            k.config.mob_mode,
            crate::mob_runtime::MobMode::SpawnFoundation | crate::mob_runtime::MobMode::Pve
        ) {
            if k.config.faction_mode.engagement() {
                Gates::MOB_BASIC_FACTIONS
            } else {
                Gates::MOB_FOUNDATION
            }
        } else if k.config.faction_mode.engagement() {
            Gates::HOLY_FOUNDATION
        } else {
            Gates::CAPTURE
        }
    }
    /// Partial explicit-module plan: only engagement and Holy sustain are implemented.
    pub const MOB_BASIC_FACTIONS: Gates = Gates {
        signatures: true,
        ..Self::MOB_FOUNDATION
    };
    pub const MOB_FOUNDATION: Gates = Gates {
        mobs: true,
        ..Gates::CAPTURE
    };
    pub const HOLY_FOUNDATION: Gates = Gates {
        signatures: true,
        ..Gates::CAPTURE
    };
}

impl Gate {
    pub const fn on(self, g: &Gates) -> bool {
        match self {
            Gate::Always => true,
            Gate::Signatures => g.signatures,
            Gate::WalkHints => g.walk_hints,
            Gate::Mobs => g.mobs,
            Gate::Quests => g.quests && !g.training,
            Gate::Dummies => g.dummies,
            Gate::Training => g.training,
            Gate::NotTraining => !g.training,
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

/// What a phase tells the loop (legacy `updateActive` can `return` mid-tick).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Flow {
    Continue,
    /// The tick ends here: no later phase runs.
    EndTick,
}

/// A row's code: ported, or the backlog packet that ports it.
#[derive(Clone, Copy)]
pub(crate) enum Run<F> {
    Ported(F),
    Partial {
        callback: F,
        completed: &'static str,
        pending: &'static str,
    },
    Pending(&'static str),
}

/// One row of a registration list or of [`PHASES`].
pub(crate) struct Item<F> {
    pub(crate) legacy: &'static str,
    pub(crate) gate: Gate,
    pub(crate) run: Run<F>,
}

const fn ported<F>(legacy: &'static str, gate: Gate, f: F) -> Item<F> {
    Item {
        legacy,
        gate,
        run: Run::Ported(f),
    }
}

const fn partial<F>(
    legacy: &'static str,
    gate: Gate,
    completed: &'static str,
    pending: &'static str,
    callback: F,
) -> Item<F> {
    Item {
        legacy,
        gate,
        run: Run::Partial {
            callback,
            completed,
            pending,
        },
    }
}

const fn pending<F>(legacy: &'static str, gate: Gate, packet: &'static str) -> Item<F> {
    Item {
        legacy,
        gate,
        run: Run::Pending(packet),
    }
}

/// A phase of `updateActive`.
pub(crate) type PhaseFn = fn(&mut Cx) -> Flow;
/// A system of a registration list (legacy `SimSystem`; the step is the fixed `TICK_MS`).
pub(crate) type SystemFn = fn(&mut Cx);
/// A factor on one fighter's move speed (legacy `MoveModifier`); the product is folded in table order.
pub(crate) type MoveFn = fn(
    &crate::statics::MatchStatic,
    &mut World,
    crate::fighter::FighterIx,
    f64,
    crate::status_runtime::StatView,
) -> f64;
/// What one mod source adds to a fighter's stat mirrors (legacy `ModContribution`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct ModContribution {
    pub(crate) as_mult: Option<f64>,
    pub(crate) speed_mult: Option<f64>,
    pub(crate) windup_mult: Option<f64>,
    pub(crate) armor: Option<f64>,
    pub(crate) shield: Option<f64>,
}
/// A source the stat mirrors fold in besides the fighter's own rows (legacy `ModSource`).
pub(crate) type SourceFn =
    fn(&World, &FighterCore, crate::status_runtime::StatView) -> Option<ModContribution>;
/// An action handler (legacy `ActionHandler`): the queued command of the fighter at `ix`.
pub(crate) type ActionFn = fn(&mut Cx, FighterIx, &ActionCmd);

/// A hook link's mode (the record's `mode`): how it joined the chain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The world's own hook (createWorld).
    Default,
    /// `chainHook`: runs after the existing chain.
    Append,
    /// A wrapper that calls the previous chain first (so it runs after it, as an append does).
    Wrap,
    /// An assignment that drops the chain: every earlier link is dropped.
    Replace,
}

/// One link of a hook chain.
pub(crate) struct Link {
    pub(crate) legacy: &'static str,
    pub(crate) mode: Mode,
    pub(crate) gate: Gate,
    pub(crate) run: Run<LinkFn>,
}

const fn ported_link(legacy: &'static str, mode: Mode, gate: Gate, f: LinkFn) -> Link {
    Link {
        legacy,
        mode,
        gate,
        run: Run::Ported(f),
    }
}

const fn partial_link(
    legacy: &'static str,
    mode: Mode,
    gate: Gate,
    completed: &'static str,
    pending: &'static str,
    callback: LinkFn,
) -> Link {
    Link {
        legacy,
        mode,
        gate,
        run: Run::Partial {
            callback,
            completed,
            pending,
        },
    }
}

const fn pending_link(legacy: &'static str, mode: Mode, gate: Gate, packet: &'static str) -> Link {
    Link {
        legacy,
        mode,
        gate,
        run: Run::Pending(packet),
    }
}

/// The index of the first link of a chain that runs: the last live `replace` link drops everything before it. The one
/// function dispatch ([`crate::hooks::fire`]) and the conformance projection ([`hook_chain`]) share, so the test checks
/// what runs.
pub fn chain_from(len: usize, at: impl Fn(usize) -> (Gate, Mode), g: &Gates) -> usize {
    (0..len)
        .rev()
        .find(|&i| {
            let (gate, mode) = at(i);
            mode == Mode::Replace && gate.on(g)
        })
        .unwrap_or(0)
}

/// A world hook (a key of legacy `world.hooks` that the gameplay modules chain onto).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Hook {
    DropBody,
    Teleported,
    AttackStarted,
    WeaponSwapped,
    Hurt,
    PlayerKilled,
    ExecuteDenied,
    RaidStarted,
    RunEnded,
    MobKilled,
    ArenaHurt,
    FighterOut,
    StatusApplied,
    Staggered,
    PlanningStarted,
    CampCleared,
    HitLanded,
    Blocked,
    Overkilled,
}

impl Hook {
    /// Every hook, in table order ([`HOOKS`] is indexed by `Hook as usize`).
    pub const ALL: [Hook; 19] = [
        Hook::DropBody,
        Hook::Teleported,
        Hook::AttackStarted,
        Hook::WeaponSwapped,
        Hook::Hurt,
        Hook::PlayerKilled,
        Hook::ExecuteDenied,
        Hook::RaidStarted,
        Hook::RunEnded,
        Hook::MobKilled,
        Hook::ArenaHurt,
        Hook::FighterOut,
        Hook::StatusApplied,
        Hook::Staggered,
        Hook::PlanningStarted,
        Hook::CampCleared,
        Hook::HitLanded,
        Hook::Blocked,
        Hook::Overkilled,
    ];

    /// The key in legacy `world.hooks` and in the record.
    pub const fn key(self) -> &'static str {
        match self {
            Hook::DropBody => "dropBody",
            Hook::Teleported => "teleported",
            Hook::AttackStarted => "attackStarted",
            Hook::WeaponSwapped => "weaponSwapped",
            Hook::Hurt => "hurt",
            Hook::PlayerKilled => "playerKilled",
            Hook::ExecuteDenied => "executeDenied",
            Hook::RaidStarted => "raidStarted",
            Hook::RunEnded => "runEnded",
            Hook::MobKilled => "mobKilled",
            Hook::ArenaHurt => "arenaHurt",
            Hook::FighterOut => "fighterOut",
            Hook::StatusApplied => "statusApplied",
            Hook::Staggered => "staggered",
            Hook::PlanningStarted => "planningStarted",
            Hook::CampCleared => "campCleared",
            Hook::HitLanded => "hitLanded",
            Hook::Blocked => "blocked",
            Hook::Overkilled => "overkilled",
        }
    }
}

pub(crate) struct HookRow {
    pub(crate) hook: Hook,
    pub(crate) links: &'static [Link],
}

/// The chain of a hook (the row of [`HOOKS`]).
pub(crate) fn hook_row(h: Hook) -> &'static HookRow {
    &HOOKS[h as usize]
}

/// An action kind (a key of legacy `world.actions`), in registration order ([`ACTIONS`] is indexed by `ActionId as usize`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum ActionId {
    Pickup,
    Attack,
    Release,
    Swap,
    Target,
    Choose,
    Cast,
    QuestAccept,
    UseConsumable,
    Trade,
    ConsumeCorpse,
    HuntTarget,
    Train,
}

pub(crate) struct ActionRow {
    pub(crate) id: ActionId,
    pub(crate) name: &'static str,
    pub(crate) module: &'static str,
    pub(crate) gate: Gate,
    pub(crate) run: Run<ActionFn>,
}

const fn action(
    id: ActionId,
    name: &'static str,
    module: &'static str,
    gate: Gate,
    run: Run<ActionFn>,
) -> ActionRow {
    ActionRow {
        id,
        name,
        module,
        gate,
        run,
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------------------------------------------------

/// What a tick ran, in order (feature `schedule-trace`, tests only).
#[cfg(feature = "schedule-trace")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TraceEntry {
    /// A ported row of [`PHASES`] started.
    Phase(&'static str),
    /// A ported entry of a registration list ran: (list key, `module.fn`).
    Link(&'static str, &'static str),
    /// A ported action handler ran: the action name.
    Action(&'static str),
    /// A ported hook link ran: (hook key, `module.fn`).
    Hook(&'static str, &'static str),
}

/// The trace buffer: bounded, ignored by equality (a World with and without a trace is the same state). A clone starts
/// empty: the trace belongs to the run being observed, and copying up to `CAP` entries with every `World` clone would
/// only cost memory in a test build.
#[cfg(feature = "schedule-trace")]
#[derive(Debug, Default)]
pub(crate) struct TraceLog(
    Vec<TraceEntry>,
    #[cfg(feature = "trusted-status-probes")] pub(crate) crate::status_runtime::probe::ProbeLog,
);

#[cfg(feature = "schedule-trace")]
impl Clone for TraceLog {
    fn clone(&self) -> Self {
        Self::default()
    }
}

#[cfg(feature = "schedule-trace")]
impl PartialEq for TraceLog {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

#[cfg(feature = "schedule-trace")]
impl TraceLog {
    const CAP: usize = 1 << 16;

    pub(crate) fn push(&mut self, e: TraceEntry) {
        if self.0.len() < Self::CAP {
            self.0.push(e);
        }
    }

    pub(crate) fn take(&mut self) -> Vec<TraceEntry> {
        std::mem::take(&mut self.0)
    }

    /// Forgets the entries and keeps the buffer, so a long run that reads nothing can bound the trace without a
    /// reallocation per step.
    pub(crate) fn clear(&mut self) {
        self.0.clear();
        // Room for any one tick's entries (a few dozen), so the next step's pushes never grow the buffer.
        self.0.reserve(256);
    }
}

/// The rows of a table that are live (their gate is on) and ported under one gate set, resolved at compile time: the
/// per-tick loop never tests a gate or skips a pending row, it walks `live()`. Table order is kept.
#[derive(Clone, Copy)]
pub(crate) struct Compiled<F: Copy, const N: usize> {
    items: [(&'static str, F); N],
    len: usize,
}

impl<F: Copy, const N: usize> Compiled<F, N> {
    const fn compile(rows: &[Item<F>; N], g: &Gates, filler: F) -> Self {
        let mut items = [("", filler); N];
        let mut len = 0;
        let mut i = 0;
        while i < N {
            if let Run::Ported(f) | Run::Partial { callback: f, .. } = rows[i].run {
                if rows[i].gate.on(g) {
                    items[len] = (rows[i].legacy, f);
                    len += 1;
                }
            }
            i += 1;
        }
        Self { items, len }
    }

    pub(crate) fn live(&self) -> &[(&'static str, F)] {
        &self.items[..self.len]
    }
}

/// The tables resolved for one gate set (see [`Compiled`]): what a tick of a world with those gates runs. Built in a
/// `const` context, so the three recorded worlds are three statics and a tick picks one ([`Plan::of`]).
pub(crate) struct Plan {
    pub(crate) phases: Compiled<PhaseFn, 23>,
    pub(crate) after_weapons: Compiled<SystemFn, 3>,
    pub(crate) before_damage: Compiled<SystemFn, 3>,
    pub(crate) systems: Compiled<SystemFn, 24>,
    pub(crate) move_modifiers: Compiled<MoveFn, 7>,
    pub(crate) mod_sources: Compiled<SourceFn, 6>,
    /// Indexed by [`ActionId`]; `None` is pending or gated off (the command is dropped).
    actions: [Option<ActionFn>; 13],
}

fn no_phase(_: &mut Cx) -> Flow {
    Flow::Continue
}
fn no_system(_: &mut Cx) {}
fn no_source(
    _: &World,
    _: &FighterCore,
    _: crate::status_runtime::StatView,
) -> Option<ModContribution> {
    None
}
fn no_modifier(
    _: &crate::statics::MatchStatic,
    _: &mut World,
    _: crate::fighter::FighterIx,
    _: f64,
    _: crate::status_runtime::StatView,
) -> f64 {
    1.0
}

impl Plan {
    const fn compile(g: &Gates) -> Plan {
        let mut actions: [Option<ActionFn>; 13] = [None; 13];
        let mut i = 0;
        while i < ACTIONS.len() {
            if let Run::Ported(f) | Run::Partial { callback: f, .. } = ACTIONS[i].run {
                if ACTIONS[i].gate.on(g) {
                    actions[ACTIONS[i].id as usize] = Some(f);
                }
            }
            i += 1;
        }
        Plan {
            phases: Compiled::compile(&PHASES, g, no_phase),
            after_weapons: Compiled::compile(&AFTER_WEAPONS, g, no_system),
            before_damage: Compiled::compile(&BEFORE_DAMAGE, g, no_system),
            systems: Compiled::compile(&SYSTEMS, g, no_system),
            move_modifiers: Compiled::compile(&MOVE_MODIFIERS, g, no_modifier),
            mod_sources: Compiled::compile(&MOD_SOURCES, g, no_source),
            actions,
        }
    }

    /// The plan of a match's world.
    pub(crate) fn of(k: &MatchStatic) -> &'static Plan {
        let g = Gates::of(k);
        if g == Gates::PRODUCTION {
            &PRODUCTION_PLAN
        } else if g == Gates::HOLY_FOUNDATION {
            &HOLY_FOUNDATION_PLAN
        } else if g == Gates::MOB_BASIC_FACTIONS {
            &MOB_BASIC_FACTIONS_PLAN
        } else if g == Gates::MOB_FOUNDATION {
            &MOB_FOUNDATION_PLAN
        } else if g == Gates::TRAINING {
            &TRAINING_PLAN
        } else {
            // A config switch that makes another combination
            // must add its plan (and its record) here: it never silently plays the capture world.
            assert!(
                g == Gates::CAPTURE,
                "no compiled plan for gate set {g:?}: add one with the config switch that made it"
            );
            &CAPTURE_PLAN
        }
    }
}

static MOB_BASIC_FACTIONS_PLAN: Plan = Plan::compile(&Gates::MOB_BASIC_FACTIONS);
static MOB_FOUNDATION_PLAN: Plan = Plan::compile(&Gates::MOB_FOUNDATION);
static PRODUCTION_PLAN: Plan = Plan::compile(&Gates::PRODUCTION);
static CAPTURE_PLAN: Plan = Plan::compile(&Gates::CAPTURE);
static HOLY_FOUNDATION_PLAN: Plan = Plan::compile(&Gates::HOLY_FOUNDATION);
static TRAINING_PLAN: Plan = Plan::compile(&Gates::TRAINING);

/// Runs compiled phases in order: the one place `updateActive`'s systems are called from.
pub(crate) fn run_steps(cx: &mut Cx, steps: &[(&'static str, PhaseFn)]) -> Flow {
    for &(_name, f) in steps {
        #[cfg(feature = "schedule-trace")]
        cx.w.trace.push(TraceEntry::Phase(_name));
        if f(cx) == Flow::EndTick {
            return Flow::EndTick;
        }
    }
    Flow::Continue
}

/// Runs a compiled registration list (`hooks:<list>` phases): every live ported system, in registration order.
fn run_list(cx: &mut Cx, _list: &'static str, items: &[(&'static str, SystemFn)]) {
    for &(_name, f) in items {
        #[cfg(feature = "schedule-trace")]
        cx.w.trace.push(TraceEntry::Link(_list, _name));
        f(cx);
    }
}

fn list_after_weapons(cx: &mut Cx) -> Flow {
    run_list(cx, "afterWeapons", Plan::of(cx.k).after_weapons.live());
    Flow::Continue
}

fn list_before_damage(cx: &mut Cx) -> Flow {
    run_list(cx, "beforeDamage", Plan::of(cx.k).before_damage.live());
    Flow::Continue
}

fn list_systems(cx: &mut Cx) -> Flow {
    run_list(cx, "systems", Plan::of(cx.k).systems.live());
    Flow::Continue
}

/// Runs the handler of a queued action for the fighter at `ix` (legacy `world.actions[cmd.kind]?.(...)`): a
/// command whose handler is pending or gated off is dropped, as legacy drops a kind nobody registered.
pub(crate) fn run_action(cx: &mut Cx, id: ActionId, ix: FighterIx, cmd: &ActionCmd) {
    if let Some(f) = Plan::of(cx.k).actions[id as usize] {
        #[cfg(feature = "schedule-trace")]
        cx.w.trace
            .push(TraceEntry::Action(ACTIONS[id as usize].name));
        f(cx, ix, cmd);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// PHASES: legacy `updateActive`
// ---------------------------------------------------------------------------------------------------------------------

/// Legacy `updateActive` (packages/server/src/sim/step.ts), phase for phase (the record's `updateActive`, 23 rows).
pub(crate) static PHASES: [Item<PhaseFn>; 23] = [
    // `if (world.arena.voided) return;`: a void run (a shutdown) is frozen.
    ported("guard:voided", Gate::Always, |cx| {
        if cx.w.rt.voided {
            Flow::EndTick
        } else {
            Flow::Continue
        }
    }),
    ported("markTickStart", Gate::Always, |cx| {
        settle::mark_tick_start(cx);
        Flow::Continue
    }),
    // The entries cards queued last tick open this tick's ledger.
    ported("ledger:openWithDeferred", Gate::Always, |cx| {
        ledger::open(cx);
        Flow::Continue
    }),
    ported("actionOrder", Gate::Always, |cx| {
        inputs::action_order(cx);
        Flow::Continue
    }),
    ported("inputs:players(actionOrder)", Gate::Always, |cx| {
        inputs::apply_players(cx);
        Flow::Continue
    }),
    ported("inputs:mobs(insertionOrder)", Gate::Always, |cx| {
        inputs::apply_mobs(cx);
        Flow::Continue
    }),
    // The complete abilities phase (P-ABIL-1): expire statuses/fields, land the due casts atomically, end the zones
    // that left their ring and refresh the bits/reveals — the four legacy steps in their recorded order.
    ported("abilities", Gate::Always, |cx| {
        crate::vision::apply_exposures(cx);
        crate::systems::status::expire(cx);
        crate::systems::abilities::land(cx);
        crate::systems::status::finish(cx);
        Flow::Continue
    }),
    ported("targets", Gate::Always, |cx| {
        crate::systems::targeting::update(cx);
        Flow::Continue
    }),
    ported("weapons", Gate::Always, |cx| {
        weapons::update(cx);
        Flow::Continue
    }),
    ported("hooks:afterWeapons", Gate::Always, list_after_weapons),
    ported("movement:multipliers(moveModifiers)", Gate::Always, |cx| {
        movement::multipliers(cx);
        Flow::Continue
    }),
    ported("movement:walk", Gate::Always, |cx| {
        movement::walk(cx);
        Flow::Continue
    }),
    ported("movement:recordHistory", Gate::Always, |cx| {
        movement::record_history(cx);
        Flow::Continue
    }),
    ported("projectiles:sweep", Gate::Always, |cx| {
        projectiles::sweep(cx);
        Flow::Continue
    }),
    ported("projectiles:spawn", Gate::Always, |cx| {
        projectiles::spawn(cx);
        Flow::Continue
    }),
    ported("melee", Gate::Always, |cx| {
        melee::resolve(cx);
        Flow::Continue
    }),
    ported("hooks:beforeDamage", Gate::Always, list_before_damage),
    // After the signatures, which read the ledger for this tick's contacts: the burn is no one's hit.
    ported("suddenDeath(notTraining)", Gate::NotTraining, |cx| {
        crate::systems::arena_rules::sudden_death(cx);
        Flow::Continue
    }),
    ported("ledger:apply", Gate::Always, |cx| {
        ledger::apply(cx);
        cx.s.fx
            .ops
            .push(crate::fx_report::Op::InstantFlush(cx.ev.len()));
        Flow::Continue
    }),
    ported("hooks:systems", Gate::Always, list_systems),
    ported("settle:training", Gate::Training, |cx| {
        crate::systems::training::settle(cx);
        Flow::Continue
    }),
    ported("settle", Gate::NotTraining, |cx| {
        settle::settle(cx);
        Flow::Continue
    }),
    // Nothing flies once the run is over.
    ported("projectiles:clearIfEnded", Gate::Always, |cx| {
        projectiles::finish(cx);
        Flow::Continue
    }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Registration lists and actions (legacy registration order)
// ---------------------------------------------------------------------------------------------------------------------

static AFTER_WEAPONS: [Item<SystemFn>; 3] = [
    ported(
        "factions.afterWeapons",
        Gate::Signatures,
        crate::systems::signatures::after_weapons,
    ),
    pending("bruiserPassives.update", Gate::Signatures, "P-FACTION-5"),
    pending("plagueZombies.<anonymous>", Gate::Signatures, "P-FACTION-3"),
];
static BEFORE_DAMAGE: [Item<SystemFn>; 3] = [
    // Shared player engagement only. Other factions' damage remains pending.
    ported(
        "factions.signatureDamage",
        Gate::Signatures,
        crate::systems::signatures::before_damage,
    ),
    partial(
        "terrainEffects.burnPass",
        Gate::Always,
        "native player and admitted PvE terrain",
        "P-TERRAIN-1",
        crate::systems::terrain::burn,
    ),
    ported(
        "abilities.statusDamage",
        Gate::Always,
        crate::systems::status::dot::damage,
    ),
];
static SYSTEMS: [Item<SystemFn>; 24] = [
    pending("fireRoam.update", Gate::Signatures, "P-FACTION-2"),
    // Combat clocks and Holy sustain only. Chill/marks/DoT remain pending.
    ported(
        "factions.afterDamage",
        Gate::Signatures,
        crate::systems::signatures::after_damage,
    ),
    ported(
        "factions.healOverTime",
        Gate::Signatures,
        crate::systems::heal::over_time,
    ),
    ported(
        "mobs.resetDummies",
        Gate::Always,
        crate::systems::training::reset_dummies,
    ),
    pending("buffs.expireBoosts", Gate::Always, "P-CARDS-2"),
    ported(
        "feed.flushAnnouncements",
        Gate::Always,
        credit::flush_announcements,
    ),
    ported(
        "chests.expireChests",
        Gate::Always,
        crate::reward_chests::expire,
    ),
    ported(
        "mobLife.reapMobs",
        Gate::Always,
        crate::systems::mob_life::reap,
    ),
    ported(
        "mobLife.respawnCamps",
        Gate::Always,
        crate::systems::mob_life::respawn,
    ),
    ported(
        "mobAI.thinkMobs",
        Gate::Always,
        crate::systems::mob_ai::think,
    ),
    partial(
        "terrainEffects.lightPass",
        Gate::Always,
        "native player and admitted PvE terrain",
        "P-TERRAIN-1",
        crate::systems::terrain::light,
    ),
    pending("regen.regenPass", Gate::Always, "P-MOBS-2"),
    ported(
        "abilities.abilityDotFx",
        Gate::Always,
        crate::systems::status::dot::report,
    ),
    pending("quests.questSystem", Gate::Quests, "P-QUEST-1"),
    ported("vision.refreshVision", Gate::Always, crate::vision::refresh),
    partial(
        "consumables.updateConsumables",
        Gate::Always,
        "Small potion Hot",
        "P-CONS-1",
        crate::systems::potions::update,
    ),
    pending("traders.updateTraders", Gate::NotTraining, "P-TRADE-1"),
    ported(
        "cardHooks.afterDamage",
        Gate::Always,
        crate::cards::after_damage,
    ),
    pending("plagueCorpses.<anonymous>", Gate::Signatures, "P-FACTION-3"),
    pending("bruiserPassives.update", Gate::Signatures, "P-FACTION-5"),
    // Current status sources are axe shred and attack slow. P-CARDS-1 extends this fold with cards.
    ported("mods.updateMods", Gate::Always, items::fold_armor),
    pending(
        "plagueZombies.updateZombies",
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending(
        "plagueZombies.regenZombies",
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending("walkHint.updateWalkHints", Gate::WalkHints, "P-NET-2"),
];
/// Legacy `moveModifiers` (`world.moveModifiers`, folded `acc * modifier(c)` in registration order, then floored).
/// `movement::multipliers` folds fighter by fighter, each fighter's whole chain before the next fighter's, as legacy does.
/// A [`MoveFn`] takes `&World` and the fighter's `&FighterCore` (any fighter's, not only a player's) today because no modifier is ported: the first one that has a side effect
/// (`terrainEffects.applyBog` counts hazard seconds) or that also runs for mobs (`mobLife.mobRoleMove`, P-MOBS-1) widens
/// the signature to a mutable context and a combatant reference in the packet that ports it, with the loop unchanged.
static MOVE_MODIFIERS: [Item<MoveFn>; 7] = [
    ported(
        "factions.frostMovementModifier",
        Gate::Signatures,
        |_, w, ix, dt, stats| crate::systems::frost::movement_modifier(w, w.core(ix), dt, stats),
    ),
    ported(
        "buffs.moveSpeedMult",
        Gate::Always,
        |_, w, ix, dt, stats| crate::modifiers::movement(w, w.core(ix), dt, stats),
    ),
    ported(
        "mobLife.mobRoleMove",
        Gate::Always,
        |_, w, ix, dt, stats| crate::systems::mobs::role_move(w, w.core(ix), dt, stats),
    ),
    partial(
        "terrainEffects.applyBog",
        Gate::Always,
        "native player and admitted PvE terrain",
        "P-TERRAIN-1",
        crate::systems::terrain::bog,
    ),
    ported(
        "abilities.statusMoveMultiplier",
        Gate::Always,
        |_, w, ix, dt, stats| crate::systems::status::movement(w, w.core(ix), dt, stats),
    ),
    pending(
        "sentencedHunt.huntMoveMultiplier",
        Gate::Signatures,
        "P-FACTION-4",
    ),
    pending("plagueZombies.<anonymous>", Gate::Signatures, "P-FACTION-3"),
];
/// Legacy stat modifier sources, folded after damage in registration order.
static MOD_SOURCES: [Item<SourceFn>; 6] = [
    pending("factions.markTaxSource", Gate::Signatures, "P-FACTION-1"),
    ported(
        "abilities.attackSlowSource",
        Gate::Always,
        crate::systems::status::attack_source,
    ),
    pending("consumables.<anonymous>", Gate::Always, "P-CONS-1"),
    ported("cardHooks.cardSource", Gate::Always, items::shred_source),
    pending("fireRoam.roamingSpeed", Gate::Signatures, "P-FACTION-2"),
    pending(
        "bruiserPassives.frozenJustice",
        Gate::Signatures,
        "P-FACTION-5",
    ),
];

/// Every action kind the gameplay modules register, in registration order (the record's `actions`, union of the worlds).
pub(crate) static ACTIONS: [ActionRow; 13] = [
    action(
        ActionId::Pickup,
        "pickup",
        "loot",
        Gate::Always,
        Run::Ported(items::pickup),
    ),
    action(
        ActionId::Attack,
        "attack",
        "weapons",
        Gate::Always,
        Run::Ported(weapons::on_attack),
    ),
    action(
        ActionId::Release,
        "release",
        "weapons",
        Gate::Always,
        Run::Ported(weapons::on_release),
    ),
    action(
        ActionId::Swap,
        "swap",
        "weapons",
        Gate::Always,
        Run::Ported(items::swap),
    ),
    action(
        ActionId::Target,
        "target",
        "targeting",
        Gate::Always,
        Run::Ported(crate::systems::targeting::target),
    ),
    action(
        ActionId::Choose,
        "choose",
        "chests",
        Gate::Always,
        Run::Ported(crate::reward_chests::on_choose),
    ),
    action(
        ActionId::Cast,
        "cast",
        "abilities",
        Gate::Always,
        Run::Ported(crate::systems::abilities::handle),
    ),
    action(
        ActionId::QuestAccept,
        "questAccept",
        "quests",
        Gate::Quests,
        Run::Pending("P-QUEST-1"),
    ),
    action(
        ActionId::UseConsumable,
        "useConsumable",
        "consumables",
        Gate::Always,
        Run::Partial {
            callback: crate::systems::potions::use_potion,
            completed: "Small potion",
            pending: "P-CONS-1",
        },
    ),
    action(
        ActionId::Trade,
        "trade",
        "traders",
        Gate::NotTraining,
        Run::Pending("P-TRADE-1"),
    ),
    action(
        ActionId::ConsumeCorpse,
        "consumeCorpse",
        "plagueCorpses",
        Gate::Signatures,
        Run::Pending("P-FACTION-3"),
    ),
    action(
        ActionId::HuntTarget,
        "huntTarget",
        "sentencedHunt",
        Gate::Signatures,
        Run::Pending("P-FACTION-4"),
    ),
    action(
        ActionId::Train,
        "train",
        "training",
        Gate::Training,
        Run::Pending("P-ARENA-2"),
    ),
];

// ---------------------------------------------------------------------------------------------------------------------
// World hook chains (legacy install order; a link's mode and gate as the record has them)
// ---------------------------------------------------------------------------------------------------------------------

static DROP_BODY: [Link; 4] = [
    ported_link(
        "world.dropBody",
        Mode::Default,
        Gate::Always,
        loot::clear_slots,
    ),
    ported_link(
        "loot.dropBody",
        Mode::Replace,
        Gate::Always,
        items::drop_body,
    ),
    ported_link(
        "training.<arrow>",
        Mode::Replace,
        Gate::Training,
        crate::systems::training::drop_body,
    ),
    pending_link("quests.<arrow>", Mode::Wrap, Gate::Quests, "P-QUEST-1"),
];
static TELEPORTED: [Link; 13] = [
    ported_link(
        "weapons.<arrow>",
        Mode::Append,
        Gate::Always,
        weapons::teleported,
    ),
    ported_link(
        "projectiles.<arrow>",
        Mode::Append,
        Gate::Always,
        projectiles::teleported,
    ),
    ported_link(
        "factions.<arrow>",
        Mode::Append,
        Gate::Signatures,
        crate::systems::signatures::teleported,
    ),
    ported_link(
        "chests.clearChests",
        Mode::Append,
        Gate::Always,
        crate::reward_chests::clear,
    ),
    ported_link(
        "mobLife.resetAllMobs",
        Mode::Append,
        Gate::Always,
        crate::systems::mob_life::teleported,
    ),
    ported_link(
        "terrainEffects.clearSlips",
        Mode::Append,
        Gate::Always,
        crate::systems::terrain::clear_slips,
    ),
    ported_link(
        "abilities.<arrow>",
        Mode::Append,
        Gate::Always,
        crate::systems::status::teleported,
    ),
    pending_link("quests.<arrow>", Mode::Append, Gate::Quests, "P-QUEST-1"),
    ported_link(
        "vision.refreshAllVision",
        Mode::Append,
        Gate::Always,
        crate::vision::raid_started,
    ),
    ported_link(
        "cardHooks.resetFight",
        Mode::Append,
        Gate::Always,
        crate::cards::reset_fight,
    ),
    ported_link(
        "cardHooks.dropDeferred",
        Mode::Append,
        Gate::Always,
        crate::cards::drop_deferred,
    ),
    pending_link(
        "plagueZombies.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending_link("walkHint.zeroAll", Mode::Append, Gate::WalkHints, "P-NET-2"),
];
static ATTACK_STARTED: [Link; 3] = [
    ported_link(
        "factions.<arrow>",
        Mode::Append,
        Gate::Signatures,
        crate::systems::frost::attack_started,
    ),
    ported_link(
        "abilities.onAttackStarted",
        Mode::Append,
        Gate::Always,
        crate::systems::status::attack_started,
    ),
    pending_link(
        "fireRoam.onAttackStarted",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
];
static WEAPON_SWAPPED: [Link; 1] = [ported_link(
    "factions.onWeaponSwapped",
    Mode::Append,
    Gate::Signatures,
    crate::systems::sentenced::weapon_swapped,
)];
static HURT: [Link; 2] = [
    ported_link(
        "factions.onHurt",
        Mode::Append,
        Gate::Signatures,
        crate::cards::on_hurt::on_hurt,
    ),
    pending_link(
        "fireRoam.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
];
static PLAYER_KILLED: [Link; 3] = [
    ported_link(
        "factions.onPlayerKilled",
        Mode::Append,
        Gate::Signatures,
        crate::systems::sentenced::player_killed,
    ),
    pending_link(
        "killAugments.onPlayerKilled",
        Mode::Append,
        Gate::Always,
        "P-CARDS-3",
    ),
    pending_link(
        "quests.onPlayerKilled",
        Mode::Append,
        Gate::Quests,
        "P-QUEST-1",
    ),
];
static EXECUTE_DENIED: [Link; 1] = [ported_link(
    "factions.onExecuteDenied",
    Mode::Append,
    Gate::Signatures,
    crate::systems::sentenced::execute_denied,
)];
static RAID_STARTED: [Link; 14] = [
    ported_link(
        "factions.<arrow>",
        Mode::Append,
        Gate::Signatures,
        crate::systems::signatures::raid_started,
    ),
    ported_link(
        "mobs.spawnTraining",
        Mode::Append,
        Gate::Dummies,
        crate::systems::training::spawn_training,
    ),
    ported_link(
        "mobLife.spawnRegionalMobs",
        Mode::Append,
        Gate::Mobs,
        crate::systems::mobs::raid_started,
    ),
    ported_link(
        "terrainEffects.onRaidStarted",
        Mode::Append,
        Gate::Always,
        crate::systems::terrain::raid_started,
    ),
    pending_link("regen.<arrow>", Mode::Append, Gate::Always, "P-MOBS-2"),
    // Status/field reset only; Wish charges/cooldown/landing remain P-ABIL-1.
    partial_link(
        "abilities.armWishes",
        Mode::Append,
        Gate::Always,
        "status and field reset",
        "P-ABIL-1",
        crate::systems::status::raid_started,
    ),
    pending_link(
        "quests.raidStarted",
        Mode::Append,
        Gate::Quests,
        "P-QUEST-1",
    ),
    ported_link(
        "vision.refreshAllVision",
        Mode::Append,
        Gate::Always,
        crate::vision::raid_started,
    ),
    pending_link(
        "consumables.<arrow>",
        Mode::Append,
        Gate::Always,
        "P-CONS-1",
    ),
    pending_link(
        "traders.spawnTraders",
        Mode::Append,
        Gate::NotTraining,
        "P-TRADE-1",
    ),
    partial_link(
        "cardHooks.resetAll",
        Mode::Append,
        Gate::Always,
        "canonical lazy Wish spend memory",
        "P-CARDS-1",
        crate::cards::runtime::reset_all,
    ),
    pending_link(
        "fireRoam.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
    pending_link(
        "bruiserPassives.resetRun",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
    ported_link(
        "training.<arrow>",
        Mode::Append,
        Gate::Training,
        crate::systems::training::raid_started,
    ),
];
static RUN_ENDED: [Link; 12] = [
    ported_link(
        "factions.flushDotFx",
        Mode::Append,
        Gate::Signatures,
        crate::systems::plague::run_ended,
    ),
    ported_link(
        "chests.clearChests",
        Mode::Append,
        Gate::Always,
        crate::reward_chests::clear,
    ),
    ported_link(
        "abilities.<arrow>",
        Mode::Append,
        Gate::Always,
        crate::systems::status::run_ended,
    ),
    pending_link("quests.<arrow>", Mode::Append, Gate::Quests, "P-QUEST-1"),
    ported_link(
        "cardHooks.dropDeferred",
        Mode::Append,
        Gate::Always,
        crate::cards::drop_deferred,
    ),
    pending_link(
        "cardHooks.flushBleeds",
        Mode::Append,
        Gate::Always,
        "P-CARDS-1",
    ),
    pending_link(
        "plagueCorpses.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending_link(
        "fireRoam.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
    pending_link(
        "bruiserPassives.resetRun",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
    pending_link(
        "sentencedHunt.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-4",
    ),
    pending_link(
        "plagueZombies.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending_link("walkHint.zeroAll", Mode::Append, Gate::WalkHints, "P-NET-2"),
];
static MOB_KILLED: [Link; 2] = [
    ported_link(
        "chests.<arrow>",
        Mode::Append,
        Gate::Always,
        crate::reward_chests::on_mob_killed,
    ),
    pending_link(
        "quests.onMobKilled",
        Mode::Append,
        Gate::Quests,
        "P-QUEST-1",
    ),
];
static ARENA_HURT: [Link; 1] = [ported_link(
    "terrainEffects.terrainHurt",
    Mode::Append,
    Gate::Always,
    crate::systems::terrain::hurt,
)];
static FIGHTER_OUT: [Link; 8] = [
    ported_link(
        "abilities.<arrow>",
        Mode::Append,
        Gate::Always,
        crate::systems::status::fighter_out,
    ),
    ported_link(
        "vision.<arrow>",
        Mode::Append,
        Gate::Always,
        crate::vision::fighter_out,
    ),
    partial_link(
        "consumables.<arrow>",
        Mode::Append,
        Gate::Always,
        "Small potion cleanup",
        "P-CONS-1",
        crate::systems::potions::fighter_out,
    ),
    pending_link(
        "plagueCorpses.leaveCorpse",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
    pending_link(
        "fireRoam.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
    pending_link(
        "bruiserPassives.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
    pending_link(
        "sentencedHunt.fighterOut",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-4",
    ),
    pending_link(
        "plagueZombies.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
];
static STATUS_APPLIED: [Link; 1] = [ported_link(
    "abilities.onStatusApplied",
    Mode::Append,
    Gate::Always,
    crate::systems::status::on_applied,
)];
static STAGGERED: [Link; 1] = [ported_link(
    "abilities.<arrow>",
    Mode::Append,
    Gate::Always,
    crate::systems::status::staggered,
)];
static PLANNING_STARTED: [Link; 1] = [pending_link(
    "quests.spawnQuests",
    Mode::Append,
    Gate::Quests,
    "P-QUEST-1",
)];
static CAMP_CLEARED: [Link; 3] = [
    pending_link(
        "quests.onCampCleared",
        Mode::Append,
        Gate::Quests,
        "P-QUEST-1",
    ),
    pending_link(
        "campHeal.payCampHeal",
        Mode::Append,
        Gate::Always,
        "P-MOBS-2",
    ),
    pending_link(
        "bruiserPassives.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
];
static HIT_LANDED: [Link; 4] = [
    ported_link(
        "cardHooks.onHitLanded",
        Mode::Append,
        Gate::Always,
        items::hit_landed,
    ),
    pending_link(
        "fireRoam.onHitLanded",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-2",
    ),
    pending_link(
        "bruiserPassives.noteLedgerContact",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
    pending_link(
        "plagueZombies.<arrow>",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-3",
    ),
];
static BLOCKED: [Link; 2] = [
    partial_link(
        "cardHooks.onBlocked",
        Mode::Append,
        Gate::Always,
        "Pocket Sand block status",
        "P-CARDS-1",
        crate::cards::on_blocked,
    ),
    pending_link(
        "bruiserPassives.noteBlockedContact",
        Mode::Append,
        Gate::Signatures,
        "P-FACTION-5",
    ),
];
static OVERKILLED: [Link; 1] = [ported_link(
    "cardHooks.onOverkilled",
    Mode::Append,
    Gate::Always,
    crate::cards::on_overkilled::on_overkilled,
)];
static HOOKS: [HookRow; 19] = [
    HookRow {
        hook: Hook::DropBody,
        links: &DROP_BODY,
    },
    HookRow {
        hook: Hook::Teleported,
        links: &TELEPORTED,
    },
    HookRow {
        hook: Hook::AttackStarted,
        links: &ATTACK_STARTED,
    },
    HookRow {
        hook: Hook::WeaponSwapped,
        links: &WEAPON_SWAPPED,
    },
    HookRow {
        hook: Hook::Hurt,
        links: &HURT,
    },
    HookRow {
        hook: Hook::PlayerKilled,
        links: &PLAYER_KILLED,
    },
    HookRow {
        hook: Hook::ExecuteDenied,
        links: &EXECUTE_DENIED,
    },
    HookRow {
        hook: Hook::RaidStarted,
        links: &RAID_STARTED,
    },
    HookRow {
        hook: Hook::RunEnded,
        links: &RUN_ENDED,
    },
    HookRow {
        hook: Hook::MobKilled,
        links: &MOB_KILLED,
    },
    HookRow {
        hook: Hook::ArenaHurt,
        links: &ARENA_HURT,
    },
    HookRow {
        hook: Hook::FighterOut,
        links: &FIGHTER_OUT,
    },
    HookRow {
        hook: Hook::StatusApplied,
        links: &STATUS_APPLIED,
    },
    HookRow {
        hook: Hook::Staggered,
        links: &STAGGERED,
    },
    HookRow {
        hook: Hook::PlanningStarted,
        links: &PLANNING_STARTED,
    },
    HookRow {
        hook: Hook::CampCleared,
        links: &CAMP_CLEARED,
    },
    HookRow {
        hook: Hook::HitLanded,
        links: &HIT_LANDED,
    },
    HookRow {
        hook: Hook::Blocked,
        links: &BLOCKED,
    },
    HookRow {
        hook: Hook::Overkilled,
        links: &OVERKILLED,
    },
];

// ---------------------------------------------------------------------------------------------------------------------
// The tables as plain data (the conformance test's view)
// ---------------------------------------------------------------------------------------------------------------------

/// A row of a phase table or registration list, as data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// The legacy name: a phase of `updateActive`, or `module.fn` for a registered system.
    pub legacy: &'static str,
    pub gate: Gate,
    /// The backlog packet for unported work; partial rows retain this even though their callback executes.
    pub pending: Option<&'static str>,
    /// Executed subresponsibility while `pending` retains the unported remainder.
    pub completed: Option<&'static str>,
}

/// A hook link, as data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkEntry {
    pub legacy: &'static str,
    pub mode: Mode,
    pub gate: Gate,
    pub pending: Option<&'static str>,
    /// Executed subresponsibility while `pending` retains the unported remainder.
    pub completed: Option<&'static str>,
}

/// An action handler, as data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActionEntry {
    pub name: &'static str,
    /// The module that registers the handler.
    pub module: &'static str,
    pub gate: Gate,
    pub pending: Option<&'static str>,
    /// Executed subresponsibility while `pending` retains the unported remainder.
    pub completed: Option<&'static str>,
}

/// The whole schedule as data: what `crates/rh-parity/tests/schedule.rs` projects under each gate set and compares with
/// the legacy record. Fields are public so a test can mutate a copy and check that the same checks reject it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tables {
    pub phases: Vec<Entry>,
    pub after_weapons: Vec<Entry>,
    pub before_damage: Vec<Entry>,
    pub systems: Vec<Entry>,
    /// In fold order: a fighter's speed is the base times each live modifier, left to right.
    pub move_modifiers: Vec<Entry>,
    pub mod_sources: Vec<Entry>,
    pub actions: Vec<ActionEntry>,
    pub hooks: Vec<(Hook, Vec<LinkEntry>)>,
}

impl<F> Item<F> {
    fn view(&self) -> Entry {
        Entry {
            legacy: self.legacy,
            gate: self.gate,
            pending: pending_of(&self.run),
            completed: completed_of(&self.run),
        }
    }
}

fn pending_of<F>(run: &Run<F>) -> Option<&'static str> {
    match run {
        Run::Ported(_) => None,
        Run::Pending(p) | Run::Partial { pending: p, .. } => Some(p),
    }
}

fn completed_of<F>(run: &Run<F>) -> Option<&'static str> {
    match run {
        Run::Partial { completed, .. } => Some(completed),
        _ => None,
    }
}

/// The tables of this build, as data.
pub fn tables() -> Tables {
    fn view<F>(items: &[Item<F>]) -> Vec<Entry> {
        items.iter().map(Item::view).collect()
    }
    Tables {
        phases: view(&PHASES),
        after_weapons: view(&AFTER_WEAPONS),
        before_damage: view(&BEFORE_DAMAGE),
        systems: view(&SYSTEMS),
        move_modifiers: view(&MOVE_MODIFIERS),
        mod_sources: view(&MOD_SOURCES),
        actions: ACTIONS
            .iter()
            .map(|a| ActionEntry {
                name: a.name,
                module: a.module,
                gate: a.gate,
                pending: pending_of(&a.run),
                completed: completed_of(&a.run),
            })
            .collect(),
        hooks: HOOKS
            .iter()
            .map(|row| {
                (
                    row.hook,
                    row.links
                        .iter()
                        .map(|l| LinkEntry {
                            legacy: l.legacy,
                            mode: l.mode,
                            gate: l.gate,
                            pending: pending_of(&l.run),
                            completed: completed_of(&l.run),
                        })
                        .collect(),
                )
            })
            .collect(),
    }
}

/// The rows a world has, in order: `entries` filtered by their gates.
pub fn live<'a>(entries: &'a [Entry], g: &Gates) -> Vec<&'a Entry> {
    entries.iter().filter(|e| e.gate.on(g)).collect()
}

/// A hook's chain in a world: its live links in install order, each with whether a later live `replace` dropped it (the
/// record's `dropped`). The links that are not dropped are what runs ([`chain_from`]).
pub fn hook_chain<'a>(links: &'a [LinkEntry], g: &Gates) -> Vec<(&'a LinkEntry, bool)> {
    let from = chain_from(links.len(), |i| (links[i].gate, links[i].mode), g);
    links
        .iter()
        .enumerate()
        .filter(|(_, l)| l.gate.on(g))
        .map(|(i, l)| (l, i < from))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::HookArgs;

    #[test]
    fn tables_are_indexed_by_their_ids() {
        for (i, a) in ACTIONS.iter().enumerate() {
            assert_eq!(
                a.id as usize, i,
                "ACTIONS row {} is out of id order",
                a.name
            );
        }
        for (i, h) in HOOKS.iter().enumerate() {
            assert_eq!(
                h.hook as usize,
                i,
                "HOOKS row {} is out of id order",
                h.hook.key()
            );
            assert_eq!(Hook::ALL[i], h.hook);
        }
        assert_eq!(HookArgs::RunEnded.hook(), Hook::RunEnded);
    }

    #[test]
    fn a_replace_link_drops_what_precedes_it() {
        let links = [
            (Gate::Always, Mode::Default),
            (Gate::Always, Mode::Replace),
            (Gate::Training, Mode::Replace),
            (Gate::Quests, Mode::Wrap),
        ];
        let from = |g: &Gates| chain_from(links.len(), |i| links[i], g);
        assert_eq!(from(&Gates::CAPTURE), 1, "loot replaces the default");
        assert_eq!(from(&Gates::PRODUCTION), 1, "quests wraps loot's");
        assert_eq!(from(&Gates::TRAINING), 2, "training replaces loot's too");
    }

    fn rows(g: &Gates) -> Vec<&'static str> {
        tables()
            .phases
            .iter()
            .filter(|e| e.gate.on(g))
            .map(|e| e.legacy)
            .collect()
    }

    #[test]
    fn a_plan_is_the_tables_resolved_for_its_gates() {
        let t = tables();
        for (plan, g) in [
            (&PRODUCTION_PLAN, Gates::PRODUCTION),
            (&CAPTURE_PLAN, Gates::CAPTURE),
            (&TRAINING_PLAN, Gates::TRAINING),
            (&MOB_FOUNDATION_PLAN, Gates::MOB_FOUNDATION),
            (&MOB_BASIC_FACTIONS_PLAN, Gates::MOB_BASIC_FACTIONS),
        ] {
            let ported_live = |es: &[Entry]| -> Vec<&'static str> {
                es.iter()
                    .filter(|e| e.gate.on(&g) && (e.pending.is_none() || e.completed.is_some()))
                    .map(|e| e.legacy)
                    .collect()
            };
            let names = |c: &[(&'static str, SystemFn)]| -> Vec<&'static str> {
                c.iter().map(|(n, _)| *n).collect()
            };
            let phases: Vec<&str> = plan.phases.live().iter().map(|(n, _)| *n).collect();
            assert_eq!(phases, ported_live(&t.phases));
            assert_eq!(names(plan.systems.live()), ported_live(&t.systems));
            assert_eq!(
                names(plan.after_weapons.live()),
                ported_live(&t.after_weapons)
            );
            assert_eq!(
                names(plan.before_damage.live()),
                ported_live(&t.before_damage)
            );
            assert_eq!(
                plan.move_modifiers
                    .live()
                    .iter()
                    .map(|(n, _)| *n)
                    .collect::<Vec<_>>(),
                ported_live(&t.move_modifiers)
            );
            for a in &ACTIONS {
                let live = a.gate.on(&g) && matches!(a.run, Run::Ported(_) | Run::Partial { .. });
                assert_eq!(plan.actions[a.id as usize].is_some(), live, "{}", a.name);
            }
        }
        // Source void guard and sudden death now run at their original ordered phase slots.
        assert_eq!(CAPTURE_PLAN.phases.live().len(), 22);
        assert_eq!(
            CAPTURE_PLAN
                .systems
                .live()
                .iter()
                .map(|(n, _)| *n)
                .collect::<Vec<_>>(),
            [
                "mobs.resetDummies",
                "feed.flushAnnouncements",
                "chests.expireChests",
                "mobLife.reapMobs",
                "mobLife.respawnCamps",
                "mobAI.thinkMobs",
                "terrainEffects.lightPass",
                "abilities.abilityDotFx",
                "vision.refreshVision",
                "consumables.updateConsumables",
                "cardHooks.afterDamage",
                "mods.updateMods"
            ]
        );
        // Training swaps the arena settle for `settle:training` at the settle slot (trainingSettle).
        assert!(!TRAINING_PLAN
            .phases
            .live()
            .iter()
            .any(|(n, _)| *n == "settle"));
        assert!(TRAINING_PLAN
            .phases
            .live()
            .iter()
            .any(|(n, _)| *n == "settle:training"));
    }

    #[test]
    fn training_swaps_the_settle_and_drops_sudden_death() {
        assert!(rows(&Gates::PRODUCTION).contains(&"suddenDeath(notTraining)"));
        assert!(rows(&Gates::PRODUCTION).contains(&"settle"));
        assert!(!rows(&Gates::PRODUCTION).contains(&"settle:training"));
        assert!(!rows(&Gates::TRAINING).contains(&"suddenDeath(notTraining)"));
        assert!(!rows(&Gates::TRAINING).contains(&"settle"));
        assert!(rows(&Gates::TRAINING).contains(&"settle:training"));
    }

    fn sim() -> crate::Sim {
        use crate::{FactionId, Placement, Secrets, SimConfig, Vec2};
        let ps: Vec<Placement> = (0..2)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(300.0 + 40.0 * i as f64, 300.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        crate::Sim::reset_active(
            SimConfig::default(),
            crate::arenas::practice_arena(),
            Secrets::from_seed(3),
            &ps,
        )
    }

    fn marker_a(cx: &mut Cx) -> Flow {
        cx.w.joined += 1;
        Flow::Continue
    }
    fn marker_end(cx: &mut Cx) -> Flow {
        cx.w.joined += 10;
        Flow::EndTick
    }
    fn marker_never(cx: &mut Cx) -> Flow {
        cx.w.joined += 100;
        Flow::Continue
    }

    #[test]
    fn a_phase_can_end_the_tick_like_a_legacy_return() {
        let mut sim = sim();
        let before = sim.w.joined;
        let rows: [Item<PhaseFn>; 5] = [
            ported("a", Gate::Always, marker_a),
            pending("gated-off", Gate::Training, "P-ARENA-2"),
            ported("end", Gate::Always, marker_end),
            ported("never", Gate::Always, marker_never),
            ported("a2", Gate::Always, marker_a),
        ];
        let plan = Compiled::compile(&rows, &Gates::CAPTURE, no_phase);
        assert_eq!(plan.live().len(), 4, "the gated-off row is not compiled in");
        let mut ev = Vec::new();
        let flow = run_steps(
            &mut Cx {
                stats: crate::status_runtime::stats::Inputs::default(),
                #[cfg(feature = "trusted-status-probes")]
                probe: None,
                k: &sim.k,
                w: &mut sim.w,
                s: &mut sim.s,
                ev: &mut ev,
                pf: &mut sim.pf,
            },
            plan.live(),
        );
        assert_eq!(flow, Flow::EndTick);
        assert_eq!(sim.w.joined, before + 11, "rows after EndTick must not run");
    }
}
