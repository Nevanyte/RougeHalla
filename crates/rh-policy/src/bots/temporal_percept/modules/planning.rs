//! Complete source planning feature module (`brain/modules/planning.ts`).
//!
//! The private source facts arrive through `ModuleContext` (ordered percept events, the full declared tier and map
//! views, the per-cfg learned callback, the independent decide/lapse lanes); the schedule/read/last-call/ask/resend/
//! settle/ready transitions are the leased shared core in `bots/planning.rs`, not a second planner. The raw deal is
//! read from the actual private `plan` event record with the source `readDeal` coercions (binary64 `spawns`/`pick`/
//! `boon`, literal-true `taken`, string-only boons, absent/invalid → `-1`); nothing is narrowed or defaulted silently.

use super::super::data::MethodValue;
use super::types::{Features, Goal, Intent, ModuleContext, SourceModule};
use crate::bots::planning::{
    source_intents, source_observe, LearnedBiasView, PlanDirective, PlanState, ReadyWhy,
    SourcePlanDeal,
};
use crate::bots::types::{IntentBody, IntentTiming, PlanMsg, PRIORITY_GOAL};

/// Source `readDeal` coercions: null for a message that is not shaped like a private deal.
fn read_deal(msg: &MethodValue) -> Option<SourcePlanDeal> {
    let MethodValue::Obj(_) = msg else {
        return None;
    };
    let spawns = field(msg, "spawns")?;
    let MethodValue::Arr(spawns) = spawns else {
        return None;
    };
    if spawns.len() != 2 {
        return None;
    }
    let taken = field(msg, "taken")?;
    let MethodValue::Arr(taken) = taken else {
        return None;
    };
    let ends_at = field(msg, "endsAt")?;
    let MethodValue::Num(ends_at) = ends_at else {
        return None;
    };
    let num = |v: Option<&MethodValue>| match v {
        Some(MethodValue::Num(value)) => *value,
        _ => -1.,
    };
    let boons = match field(msg, "boons") {
        Some(MethodValue::Arr(rows)) => rows
            .iter()
            .filter_map(|row| match row {
                MethodValue::Str(id) => Some(id.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    Some(SourcePlanDeal {
        ends_at: *ends_at,
        spawns: [num(Some(&spawns[0])), num(Some(&spawns[1]))],
        taken: [
            matches!(taken.first(), Some(MethodValue::Bool(true))),
            matches!(taken.get(1), Some(MethodValue::Bool(true))),
        ],
        pick: num(field(msg, "pick")),
        boons,
        boon: num(field(msg, "boon")),
    })
}

fn field<'a>(value: &'a MethodValue, key: &str) -> Option<&'a MethodValue> {
    match value {
        MethodValue::Obj(fields) => fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value),
        _ => None,
    }
}

/// Per-cfg source state: the raw deal record plus the shared transition state (the source WeakMap entry).
#[derive(Default)]
struct PlanSourceState {
    deal: Option<SourcePlanDeal>,
    transition: PlanState,
}

/// Source `planningModule`.
#[derive(Default)]
pub(crate) struct PlanningModule {
    states: Vec<(super::types::CfgToken, PlanSourceState)>,
}

impl PlanningModule {
    fn state(&mut self, token: super::types::CfgToken) -> &mut PlanSourceState {
        if let Some(index) = self.states.iter().position(|(key, _)| *key == token) {
            return &mut self.states[index].1;
        }
        self.states.push((token, PlanSourceState::default()));
        &mut self.states.last_mut().expect("just pushed").1
    }

    /// Source `plan(msg, why)`: the plan intent at goal priority, timed as the next step.
    fn plan(msg: PlanMsg, why: String) -> Intent {
        Intent {
            body: IntentBody::Plan { msg },
            priority: PRIORITY_GOAL,
            timing: IntentTiming::Step {},
            why,
        }
    }
}

impl SourceModule for PlanningModule {
    fn id(&self) -> &'static str {
        "planning"
    }
    fn enabled(&self, features: &Features) -> bool {
        features.planning
    }
    fn hooks(&self) -> &'static [&'static str] {
        super::types::ModuleId::Planning.hooks()
    }

    fn observe(&mut self, ctx: &mut ModuleContext<'_>) {
        for event in &ctx.p.events {
            if event.kind != "private" || event.type_.as_deref() != Some("plan") {
                continue;
            }
            let Some(msg) = &event.msg else {
                continue;
            };
            let Some(deal) = read_deal(msg) else {
                continue;
            };
            let first = {
                let state = self.state(ctx.cfg.token);
                state.deal.is_none()
            };
            let decide_lane = &mut *ctx.rng.decide;
            let mut decide = || decide_lane.draw();
            let tier_id = ctx.cfg.tier.id;
            let state = self.state(ctx.cfg.token);
            source_observe(
                &mut state.transition,
                event.t,
                first,
                deal.ends_at,
                tier_id,
                &mut decide,
            );
            let state = self.state(ctx.cfg.token);
            state.deal = Some(deal);
        }
    }

    fn intents(&mut self, ctx: &mut ModuleContext<'_>, _goal: &Goal) -> Vec<Intent> {
        if ctx.p.hud.phase != "planning" {
            return Vec::new();
        }
        let learned = ctx.cfg.learned;
        let learned_view = LearnedBiasView {
            enabled: learned.enabled(),
            bias: &|key| learned.bias(key),
        };
        let decide_lane = &mut *ctx.rng.decide;
        let lapse_lane = &mut *ctx.rng.lapse;
        let mut decide = || decide_lane.draw();
        let mut lapse = || lapse_lane.draw();
        let state = self.state(ctx.cfg.token);
        let directive = source_intents(
            &mut state.transition,
            ctx.p.now,
            true,
            ctx.cfg.tier,
            ctx.cfg.plan_map,
            ctx.p.self_.faction,
            ctx.p.self_.weapons[usize::from(ctx.p.self_.slot.min(1))],
            &learned_view,
            state.deal.as_ref(),
            &mut decide,
            &mut lapse,
        );
        let Some(directive) = directive else {
            return Vec::new();
        };
        match directive {
            PlanDirective::Spawn { option, .. } => {
                let state = self.state(ctx.cfg.token);
                let deal = state
                    .deal
                    .as_ref()
                    .expect("a spawn directive requires a deal");
                let index = deal.spawns[option];
                vec![Self::plan(
                    PlanMsg {
                        spawn: Some(option as u8),
                        boon: None,
                        ready: None,
                    },
                    format!(
                        "spawn {} (option {})",
                        super::super::strategy::types::js_number(index),
                        option
                    ),
                )]
            }
            PlanDirective::Boon { option, id } => vec![Self::plan(
                PlanMsg {
                    spawn: None,
                    boon: Some(option as u8),
                    ready: None,
                },
                format!("boon {id}"),
            )],
            PlanDirective::Ready { why } => vec![Self::plan(
                PlanMsg {
                    spawn: None,
                    boon: None,
                    ready: Some(true),
                },
                match why {
                    ReadyWhy::NoDeal => "no deal came: ready, the server picks".to_string(),
                    ReadyWhy::Timer => "the timer is nearly out".to_string(),
                    ReadyWhy::Choices => "choices made".to_string(),
                },
            )],
        }
    }
}
