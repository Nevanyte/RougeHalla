//! Complete private source tactics layer (P-BOT-TACTICS-1): the unchanged legacy `createTactics` decision-to-intent
//! closure with its real Fight, WorldTactics, OrbWalk, Reflexes and Retreat components.
//!
//! Private seam only: no public Brain/HumanBot wiring, no World/Sim handle, no observation/protocol change and no live
//! seat. Inputs are declared source facts (private typed percept / admitted Memory / Knowledge / path service / RNG);
//! outputs are ordered source intents, a source GoalStatus and the source's own lifetime stats. Source-derived from
//! `packages/server/src/bots/brain/tactics.ts` and `tactics/{fight,world,kite}.ts` plus their unchanged imports.

pub(crate) mod fight;
pub(crate) mod kite;
pub(crate) mod types;
pub(crate) mod world;

#[cfg(test)]
mod compat_tests;
#[cfg(test)]
mod private_tactics_tests;
#[cfg(test)]
mod source_decode;
#[cfg(test)]
mod source_reader;
#[cfg(test)]
mod source_strict;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod source_trace;

use crate::bots::types::{IntentTiming, StimulusKind, PRIORITY_REFLEX};
use types::{
    FightKind, FightRef, Goal, GoalKind, GoalState, GoalStatus, Intent, IntentBody, IntentChannel,
    TacticsContext, TacticsError, TacticsOutput, TacticsStats, WorldGoal,
};

/// Complete source `createTactics` closure: one shared OrbWalk/Reflexes/Retreat per instance (owned by its Fight), the
/// sudden-death knowledge draw, flee retention/counter and all lifetime stats.
pub(crate) struct Tactics {
    fight: fight::Fight,
    /// Drawn once on the first act: does the bot know that sudden death burns every pool at the same share?
    knows_sudden_death: Option<bool>,
    fleeing: bool,
    retreats: u64,
    world: world::WorldTactics,
}

impl Default for Tactics {
    fn default() -> Self {
        Self::new()
    }
}

impl Tactics {
    pub(crate) fn new() -> Self {
        Self {
            fight: fight::Fight::new(
                kite::OrbWalk::new(),
                kite::Reflexes::new(),
                kite::Retreat::new(),
            ),
            knows_sudden_death: None,
            fleeing: false,
            retreats: 0,
            world: world::WorldTactics::new(),
        }
    }

    /// Source `Tactics.act`: one knowledge draw once, flee reset, fight.leave for non-combat, then the goal branch.
    pub(crate) fn act(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        goal: &Goal,
    ) -> Result<TacticsOutput, TacticsError> {
        let knows = match self.knows_sudden_death {
            Some(knows) => knows,
            None => {
                let knows = ctx.decide.draw() < ctx.cfg.tier.knowledge;
                self.knows_sudden_death = Some(knows);
                knows
            }
        };
        if goal.kind() != GoalKind::Flee && self.fleeing {
            self.fleeing = false;
            self.fight.retreat_mut().reset();
        }
        if !matches!(
            goal,
            Goal::Farm { .. } | Goal::Hunt { .. } | Goal::Fight { .. }
        ) {
            self.fight.leave();
        }
        Ok(match goal {
            Goal::Farm { mob, .. } => self.fight.act(
                ctx,
                &FightRef {
                    id: mob.clone(),
                    kind: FightKind::Farm,
                },
                knows,
            ),
            Goal::Hunt { target } => self.fight.act(
                ctx,
                &FightRef {
                    id: target.clone(),
                    kind: FightKind::Hunt,
                },
                knows,
            ),
            Goal::Fight { target } => self.fight.act(
                ctx,
                &FightRef {
                    id: target.clone(),
                    kind: FightKind::Fight,
                },
                knows,
            ),
            Goal::Flee { from, until } => self.flee(ctx, from, *until)?,
            Goal::Module { module, .. } => TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::failed(format!(
                    "module goal \"{module}\" is run by its module"
                )),
                attacking: false,
            },
            goal => {
                let world_goal =
                    WorldGoal::from_goal(goal).expect("non-combat goal is a world goal");
                dispatch_world(ctx, &mut self.fight, &mut self.world, &world_goal)?
            }
        })
    }

    /// Source `flee`: explicit or visible/awake-Memory threats, retained destination, first successful flight blocked.
    fn flee(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        from: &[rh_sim::Vec2],
        until: f64,
    ) -> Result<TacticsOutput, TacticsError> {
        if ctx.p.now >= until {
            self.fleeing = false;
            self.fight.retreat_mut().reset();
            return Ok(TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::done("the flight is over"),
                attacking: false,
            });
        }
        let threats: Vec<rh_sim::Vec2> = if from.is_empty() {
            threats_in(ctx)
        } else {
            from.to_vec()
        };
        let to = self.fight.retreat_mut().point(ctx, &threats);
        let Some(to) = to else {
            // Cornered: no heading is clear. Fight whatever is nearest on screen.
            let Some(nearest) = nearest_corner_target(ctx) else {
                return Ok(TacticsOutput {
                    intents: Vec::new(),
                    status: GoalStatus::failed("cornered with nobody in sight"),
                    attacking: false,
                });
            };
            let knows = self.knows_sudden_death.unwrap_or(false);
            let out = self.fight.act(ctx, &nearest, knows);
            return Ok(if out.status.state == GoalState::Running {
                TacticsOutput {
                    intents: out.intents,
                    status: GoalStatus::running("cornered: fighting on"),
                    attacking: out.attacking,
                }
            } else {
                out
            });
        };
        let first = !self.fleeing;
        self.fleeing = true;
        if first {
            self.retreats += 1;
        }
        let stimulus = ctx
            .mem
            .stimuli()
            .into_iter()
            .find(|s| matches!(s.kind, StimulusKind::LowHp | StimulusKind::HpLoss));
        let timing = match stimulus {
            Some(stimulus) => IntentTiming::React { stimulus },
            None => IntentTiming::Step {},
        };
        let intent = Intent {
            body: IntentBody::Move {
                to: types::RouteElement::Point(to),
            },
            priority: PRIORITY_REFLEX,
            timing,
            why: "flee".into(),
        };
        Ok(TacticsOutput {
            intents: vec![intent],
            status: if first {
                GoalStatus::blocked("fleeing: strategy re-decides")
            } else {
                GoalStatus::running("fleeing")
            },
            attacking: false,
        })
    }

    /// Source `Tactics.stats` / `getStats`: both aliases return the same lifetime counters.
    pub(crate) fn stats(&self) -> TacticsStats {
        TacticsStats {
            dodges: self.fight.reflexes().dodges(),
            jukes: self.fight.reflexes().jukes(),
            kite_cycles: self.fight.orb().cycles(),
            retreats: self.retreats,
            mob_targets: self.fight.mob_targets(),
        }
    }

    pub(crate) fn get_stats(&self) -> TacticsStats {
        self.stats()
    }
}

/// Source `threatsIn`: every alive visible player, and every alive visible mob its real Memory says is awake.
fn threats_in(ctx: &mut TacticsContext<'_>) -> Vec<rh_sim::Vec2> {
    let mut out: Vec<rh_sim::Vec2> = ctx
        .p
        .fighters
        .iter()
        .filter(|f| f.status == "alive")
        .map(|f| rh_sim::Vec2::new(f.x, f.y))
        .collect();
    let mobs: Vec<(String, rh_sim::Vec2)> = ctx
        .p
        .mobs
        .iter()
        .filter(|m| m.status == "alive")
        .map(|m| (m.id.clone(), rh_sim::Vec2::new(m.x, m.y)))
        .collect();
    for (id, at) in mobs {
        if ctx.mem.mob(&id).is_some_and(|known| known.awake) {
            out.push(at);
        }
    }
    out
}

/// Source corner fallback: nearest alive visible player else regional alive mob, ties by percept order (players first).
fn nearest_corner_target(ctx: &mut TacticsContext<'_>) -> Option<FightRef> {
    let mut best: Option<(f64, FightRef)> = None;
    for f in &ctx.p.fighters {
        if f.status == "alive" && best.as_ref().is_none_or(|(d, _)| f.dist < *d) {
            best = Some((
                f.dist,
                FightRef {
                    id: f.id.clone(),
                    kind: FightKind::Fight,
                },
            ));
        }
    }
    for m in &ctx.p.mobs {
        if m.status == "alive"
            && types::is_regional_kind(&m.kind)
            && best.as_ref().is_none_or(|(d, _)| m.dist < *d)
        {
            best = Some((
                m.dist,
                FightRef {
                    id: m.id.clone(),
                    kind: FightKind::Farm,
                },
            ));
        }
    }
    best.map(|(_, fight)| fight)
}

/// Source `dispatchWorld`: world orders first, then the shared real Reflexes; a pending hold suppresses every order.
fn dispatch_world(
    ctx: &mut TacticsContext<'_>,
    fight: &mut fight::Fight,
    world: &mut world::WorldTactics,
    goal: &WorldGoal,
) -> Result<TacticsOutput, TacticsError> {
    let out = world.act(ctx, goal)?;
    let reflex = fight.reflexes_mut().check(ctx);
    if reflex.is_none() && ctx.p.now >= fight.reflexes().hold_until() {
        return Ok(out);
    }
    let rest: Vec<Intent> = out
        .intents
        .into_iter()
        .filter(|i| i.body.channel() != IntentChannel::Order)
        .collect();
    let Some(reflex) = reflex else {
        return Ok(TacticsOutput {
            intents: rest,
            status: out.status,
            attacking: out.attacking,
        });
    };
    let why = format!("{}: {}", reflex.kind.as_str(), reflex.intent.why);
    let mut intents = rest;
    intents.push(reflex.intent);
    Ok(TacticsOutput {
        intents,
        status: GoalStatus::blocked(why),
        attacking: false,
    })
}

// Names the declared-method test harness reads for its direct-suite constructors.
pub(crate) type SourceGoal = Goal;
pub(crate) type SourceFoe = types::Foe;
