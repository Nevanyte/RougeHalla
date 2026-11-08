//! The humanizer (docs/BOTS.md 2.1-2.5, 4): intents in, the commands a person would have clicked out, each at the time
//! they would have clicked it (packages/server/src/bots/brain/humanizer.ts). It owns when anything happens: reaction
//! delays with the attention multipliers, the refractory gap, hesitation, channels (one pending intent each), the APM
//! bucket, dedupe and the lock re-send rule; clicks.rs owns where.
//!
//! It is the only layer that draws from the motor (delays, scatter) and lapse (hesitation, slips) streams. A decision is
//! what one stimulus (or one planned step) asks for: its intents share its click time, so a swap and a lock answering one
//! newThreat go out together, one minGap apart; two different stimuli are two decisions, kept refractoryMs apart.
use crate::bots::clicks::{ground_click, lock_click, move_click, BotMap};
use crate::bots::random::{chance, ex_gaussian, gaussian, uniform, Rng};
use crate::bots::types::{
    ClickMiss, Command, CommandType, FighterId, Intent, IntentBody, IntentChannel, IntentKind,
    IntentTiming, LockTarget, Percept, Stimulus, StimulusKind, TierParams, TimedCommand,
    CHANNEL_ORDER, COMMAND_TYPES, HUMANIZER_RULES, TARGET_SNAP_RADIUS,
};
use std::collections::BTreeMap;

/// The bot's own HUD is this far behind its orders (downlink, uplink, a tick): an order this recent may not show yet.
const SELF_LAG_MS: f64 = 250.;
/// Decisions are remembered this long, for the siblings of one stimulus.
const DECISION_KEEP_MS: f64 = 5000.;
/// Misses nobody drained are not kept forever.
const MAX_MISSES: usize = 16;

/// The humanizer's counters, as the source writes them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HumanizerStats {
    pub commands: [u64; 10],
    pub reactions: BTreeMap<StimulusKind, Vec<f64>>,
    pub target_clicks: u64,
    pub click_missed: u64,
    pub click_wrong: u64,
    pub hesitations: u64,
    pub lapses: u64,
    pub throttled: u64,
    pub superseded: u64,
    pub apm_peak: u64,
}
impl HumanizerStats {
    pub fn command(&self, t: CommandType) -> u64 {
        self.commands[COMMAND_TYPES.iter().position(|c| *c == t).unwrap()]
    }
}

#[derive(Clone)]
struct Pending {
    intent: Intent,
    priority: u8,
    submitted_at: f64,
    key: String,
    due: f64,
    independent: bool,
}

#[derive(Clone)]
struct LastSent {
    intent: Intent,
    at: f64,
}

struct Converted {
    cmd: Option<Command>,
    spent: bool,
}
const NOT_SENT: Converted = Converted {
    cmd: None,
    spent: false,
};

/// What the hand reads and draws from in one think/one release.
pub struct Context<'a> {
    pub p: &'a Percept,
    pub engaged: bool,
    pub motor: &'a mut Rng,
    pub lapse: &'a mut Rng,
}

const CH_INDEX: [usize; 5] = [0, 1, 2, 3, 4];

pub struct Humanizer {
    tier: &'static TierParams,
    map: BotMap,
    pending: [Option<Pending>; 5],
    decision_due: Vec<(String, f64)>,
    last_sent: [Option<LastSent>; 5],
    last_lock: Option<(FighterId, f64)>,
    last_react: Option<(String, f64)>,
    last_send_at: f64,
    tokens: f64,
    tokens_at: f64,
    sent_times: Vec<f64>,
    misses: Vec<ClickMiss>,
    stats: HumanizerStats,
}

impl Humanizer {
    pub fn new(tier: &'static TierParams, map: BotMap) -> Self {
        Self {
            tier,
            map,
            pending: [None, None, None, None, None],
            decision_due: Vec::new(),
            last_sent: [None, None, None, None, None],
            last_lock: None,
            last_react: None,
            last_send_at: f64::NEG_INFINITY,
            tokens: tier.burst,
            tokens_at: 0.,
            sent_times: Vec::new(),
            misses: Vec::new(),
            stats: HumanizerStats::default(),
        }
    }
    pub fn stats(&self) -> &HumanizerStats {
        &self.stats
    }
    pub fn tier(&self) -> &'static TierParams {
        self.tier
    }
    pub fn map(&self) -> &BotMap {
        &self.map
    }
    fn idx(ch: IntentChannel) -> usize {
        match ch {
            IntentChannel::Order => 0,
            IntentChannel::Swap => 1,
            IntentChannel::Pickup => 2,
            IntentChannel::Cast => 3,
            IntentChannel::Menu => 4,
        }
    }

    // ----------------------------------------------------------------------------------------------------- scheduling
    fn reaction_delay(&mut self, stim: &Stimulus, ctx: &mut Context) -> f64 {
        if stim.kind == StimulusKind::Teleport {
            return ex_gaussian(ctx.motor, &self.tier.daze);
        }
        let mut mult = if stim.central {
            1.
        } else {
            self.tier.attention.periphery_mult
        };
        if stim.kind == StimulusKind::NewThreat && ctx.engaged {
            mult *= self.tier.attention.engaged_mult;
        }
        if stim.kind.is_reading() {
            mult *= HUMANIZER_RULES.reading_mult;
        }
        ex_gaussian(ctx.motor, &self.tier.reaction) * mult
    }

    /// At most one pause per decision.
    fn hesitation(&mut self, ctx: &mut Context) -> f64 {
        let h = self.tier.hesitation;
        if !chance(ctx.lapse, h.p) {
            return 0.;
        }
        self.stats.hesitations += 1;
        uniform(ctx.lapse, h.min_ms, h.max_ms)
    }

    /// Moves due after every other decision it falls within refractoryMs of.
    fn after_refractory(&self, mut due: f64, key: &str, replaced: Option<&Pending>) -> f64 {
        let mut taken: Vec<f64> = Vec::new();
        for q in self.pending.iter().flatten() {
            let same_replaced = replaced.is_some_and(|r| {
                q.submitted_at == r.submitted_at && q.key == r.key && q.due == r.due
            });
            if q.independent && q.key != key && !same_replaced {
                taken.push(q.due);
            }
        }
        if let Some((key_last, at)) = &self.last_react {
            if key_last != key {
                taken.push(*at);
            }
        }
        if taken.is_empty() {
            return due;
        }
        taken.sort_by(f64::total_cmp);
        for _pass in 0..=taken.len() {
            let mut moved = false;
            for c in &taken {
                if (due - c).abs() < self.tier.refractory_ms {
                    due = c + self.tier.refractory_ms;
                    moved = true;
                }
            }
            if !moved {
                break;
            }
        }
        due
    }

    fn new_decision_due(
        &mut self,
        intent: &Intent,
        key: &str,
        replaced: Option<&Pending>,
        ctx: &mut Context,
    ) -> f64 {
        let now = ctx.p.now;
        match &intent.timing {
            IntentTiming::React { stimulus } => {
                if let Some(known) = self
                    .decision_due
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, d)| *d)
                {
                    return now.max(known);
                }
                let delay = self.reaction_delay(stimulus, ctx);
                let pause = self.hesitation(ctx);
                let due = now.max(stimulus.at + delay) + pause;
                let due = self.after_refractory(due, key, replaced);
                self.decision_due.push((key.to_string(), due));
                due
            }
            IntentTiming::Step {} => {
                let d = ex_gaussian(ctx.motor, &self.tier.step);
                let pause = self.hesitation(ctx);
                now + d + pause
            }
            IntentTiming::Timed { due } => {
                now.max(due + gaussian(ctx.motor, 0., self.tier.timing_sigma_ms))
            }
        }
    }

    /// The server's lock is already on it. Not trusted for a moment after an order of ours, which the HUD has yet to show.
    fn already_locked(&self, target: &str, p: &Percept, now: f64) -> bool {
        if p.self_view.attack_target.as_deref() != Some(target) {
            return false;
        }
        match self.last_sent[Self::idx(IntentChannel::Order)].as_ref() {
            None => true,
            Some(order) => {
                !(now - order.at < SELF_LAG_MS
                    && !matches!(&order.intent.body, IntentBody::Lock { target: t, .. } if t == target))
            }
        }
    }

    fn repeats_last(&self, intent: &Intent, ch: IntentChannel, now: f64) -> bool {
        let Some(last) = self.last_sent[Self::idx(ch)].as_ref() else {
            return false;
        };
        if !same_intent(&last.intent, intent) {
            return false;
        }
        let window = if intent.kind() == IntentKind::Lock {
            HUMANIZER_RULES.lock_resend_ms
        } else {
            HUMANIZER_RULES.repeat_ms
        };
        if now - last.at >= window {
            return false;
        }
        !matches!(&intent.timing, IntentTiming::React { stimulus } if stimulus.at > last.at)
    }

    pub fn submit(&mut self, intents: &[Intent], ctx: &mut Context) {
        let now = ctx.p.now;
        self.decision_due
            .retain(|(_, due)| !(*due < now - DECISION_KEEP_MS));
        let mut ordered: Vec<Intent> = intents.to_vec();
        if ordered.len() > 1 {
            ordered.sort_by_key(|i| i.priority);
        }
        for intent in ordered {
            self.offer(intent, ctx);
        }
    }

    fn offer(&mut self, intent: Intent, ctx: &mut Context) {
        let now = ctx.p.now;
        let ch = intent.kind().channel();
        let ci = Self::idx(ch);
        if intent.kind() == IntentKind::Lock {
            if let IntentBody::Lock { target, .. } = &intent.body {
                if self.already_locked(target, ctx.p, now) {
                    return;
                }
            }
        }
        let prev = self.pending[ci].clone();
        if let Some(prev) = &prev {
            if same_intent(&prev.intent, &intent) {
                if intent.priority < prev.priority {
                    self.pending[ci].as_mut().unwrap().priority = intent.priority;
                }
                return;
            }
            if intent.priority > prev.priority
                && now - prev.submitted_at <= HUMANIZER_RULES.replace_after_ms
            {
                return;
            }
        }
        if self.repeats_last(&intent, ch, now) {
            if prev.is_some() {
                self.pending[ci] = None;
                self.stats.superseded += 1;
            }
            return;
        }
        let key = decision_key(&intent);
        let amends = prev.as_ref().is_some_and(|p| p.key == key);
        let mut due = if amends {
            prev.as_ref().unwrap().due
        } else {
            self.new_decision_due(&intent, &key, prev.as_ref(), ctx)
        };
        if intent.kind() == IntentKind::Lock {
            if let IntentBody::Lock { target, .. } = &intent.body {
                if let Some((last_target, at)) = &self.last_lock {
                    if last_target == target {
                        due = due.max(at + HUMANIZER_RULES.lock_resend_ms);
                    }
                }
            }
        }
        if prev.is_some() && !amends {
            self.stats.superseded += 1;
        }
        let priority = intent.priority;
        let independent = matches!(intent.timing, IntentTiming::React { .. });
        self.pending[ci] = Some(Pending {
            intent,
            priority,
            submitted_at: if amends {
                prev.as_ref().unwrap().submitted_at
            } else {
                now
            },
            key,
            due,
            independent,
        });
    }

    // -------------------------------------------------------------------------------------------------------- clicks
    fn convert(&mut self, q: &Pending, t: f64, ctx: &mut Context) -> Converted {
        let p = ctx.p;
        match &q.intent.body {
            IntentBody::Lock { target, at } => {
                let weapon = p.weapon_in_hand();
                if weapon == crate::bots::types::BotWeapon::Wand
                    && self.already_locked(target, p, t)
                {
                    return NOT_SENT;
                }
                if weapon != crate::bots::types::BotWeapon::Wand && p.now < p.self_view.ready_at {
                    return NOT_SENT;
                }
                let click = lock_click(
                    ctx.motor,
                    ctx.lapse,
                    self.tier,
                    p,
                    &LockTarget {
                        id: target.clone(),
                        at: *at,
                    },
                    TARGET_SNAP_RADIUS,
                );
                self.stats.target_clicks += 1;
                if click.slipped {
                    self.stats.lapses += 1;
                }
                self.last_lock = Some((target.clone(), t));
                if weapon != crate::bots::types::BotWeapon::Wand {
                    let a = rh_sim::math::atan2(
                        click.cursor.y - p.self_view.y,
                        click.cursor.x - p.self_view.x,
                    );
                    return Converted {
                        cmd: Some(Command::Attack { a }),
                        spent: true,
                    };
                }
                let Some(picked) = click.picked else {
                    self.stats.click_missed += 1;
                    self.misses.push(ClickMiss {
                        target: target.clone(),
                        at: t,
                    });
                    if self.misses.len() > MAX_MISSES {
                        self.misses.remove(0);
                    }
                    return Converted {
                        cmd: None,
                        spent: true,
                    };
                };
                if picked != *target {
                    self.stats.click_wrong += 1;
                }
                Converted {
                    cmd: Some(Command::Target { id: picked }),
                    spent: true,
                }
            }
            IntentBody::Move { to } => {
                if !to.x.is_finite() || !to.y.is_finite() {
                    return NOT_SENT;
                }
                let click = move_click(
                    ctx.motor,
                    self.tier,
                    &self.map,
                    Vec2::new(p.self_view.x, p.self_view.y),
                    *to,
                );
                Converted {
                    cmd: Some(Command::Move {
                        x: click.to.x,
                        y: click.to.y,
                    }),
                    spent: true,
                }
            }
            IntentBody::Stop {} => Converted {
                cmd: Some(Command::Stop {}),
                spent: true,
            },
            IntentBody::Swap { slot } => Converted {
                cmd: Some(Command::Swap { slot: *slot }),
                spent: true,
            },
            IntentBody::Pickup { container } => {
                let Some(c) = p.containers.iter().find(|c| c.id == *container) else {
                    return NOT_SENT;
                };
                if !c.interactable {
                    return NOT_SENT;
                }
                Converted {
                    cmd: Some(Command::Pickup {
                        container_id: container.clone(),
                    }),
                    spent: true,
                }
            }
            IntentBody::Cast {
                slot,
                x,
                y,
                target,
                at,
                snap_radius,
            } => {
                let Some(target) = target else {
                    let at = ground_click(
                        ctx.motor,
                        self.tier,
                        &self.map,
                        Vec2::new(p.self_view.x, p.self_view.y),
                        Vec2::new(*x, *y),
                    );
                    return Converted {
                        cmd: Some(Command::Cast {
                            slot: slot.clone(),
                            x: at.x,
                            y: at.y,
                            id: None,
                        }),
                        spent: true,
                    };
                };
                let click = lock_click(
                    ctx.motor,
                    ctx.lapse,
                    self.tier,
                    p,
                    &LockTarget {
                        id: target.clone(),
                        at: at.unwrap_or(Vec2::new(*x, *y)),
                    },
                    snap_radius.unwrap_or(TARGET_SNAP_RADIUS),
                );
                if click.slipped {
                    self.stats.lapses += 1;
                }
                let hit = click.picked.as_ref().and_then(|id| {
                    p.fighters
                        .iter()
                        .find(|f| f.id == *id)
                        .map(|f| (f.x, f.y, f.id.clone()))
                        .or_else(|| {
                            p.mobs
                                .iter()
                                .find(|m| m.id == *id)
                                .map(|m| (m.x, m.y, m.id.clone()))
                        })
                });
                let cmd = match hit {
                    Some((x, y, id)) => Command::Cast {
                        slot: slot.clone(),
                        x,
                        y,
                        id: Some(id),
                    },
                    None => Command::Cast {
                        slot: slot.clone(),
                        x: click.cursor.x,
                        y: click.cursor.y,
                        id: None,
                    },
                };
                Converted {
                    cmd: Some(cmd),
                    spent: true,
                }
            }
            IntentBody::Plan { msg } => Converted {
                cmd: Some(Command::Plan {
                    spawn: msg.spawn,
                    boon: msg.boon,
                    ready: msg.ready,
                }),
                spent: true,
            },
            IntentBody::Choose { msg } => {
                if let Some(chests) = &p.extras.chests {
                    let opened = chests
                        .iter()
                        .find(|c| c.id == msg.chest)
                        .is_some_and(|c| c.options.is_some());
                    if !opened {
                        return NOT_SENT;
                    }
                }
                Converted {
                    cmd: Some(Command::Choose {
                        chest: msg.chest.clone(),
                        pick: msg.pick,
                        replace: msg.replace,
                    }),
                    spent: true,
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------------------- bucket
    /// The earliest time the next command may go: a token and minGapMs after the last one.
    fn next_slot(&self) -> f64 {
        let refill_per_ms = self.tier.apm / 60_000.;
        let token_at = if self.tokens >= 1. {
            self.tokens_at
        } else {
            self.tokens_at + (1. - self.tokens) / refill_per_ms
        };
        (self.last_send_at + self.tier.min_gap_ms).max(token_at)
    }

    fn spend(&mut self, t: f64) {
        let refill_per_ms = self.tier.apm / 60_000.;
        self.tokens =
            (self.tier.burst).min(self.tokens + (t - self.tokens_at) * refill_per_ms) - 1.;
        self.tokens_at = t;
        self.last_send_at = t;
    }

    fn note(&mut self, cmd: &Command, t: f64) {
        let idx = COMMAND_TYPES
            .iter()
            .position(|c| *c == cmd.command_type())
            .unwrap();
        self.stats.commands[idx] += 1;
        self.sent_times.push(t);
        while self
            .sent_times
            .first()
            .is_some_and(|first| *first <= t - HUMANIZER_RULES.apm_window_ms)
        {
            self.sent_times.remove(0);
        }
        if self.sent_times.len() as u64 > self.stats.apm_peak {
            self.stats.apm_peak = self.sent_times.len() as u64;
        }
    }

    fn record_reaction(&mut self, stim: &Stimulus, t: f64) {
        let list = self.stats.reactions.entry(stim.kind).or_default();
        list.push(t - stim.at);
        if list.len() > HUMANIZER_RULES.reaction_samples {
            list.remove(0);
        }
    }

    // --------------------------------------------------------------------------------------------------------- release
    pub fn release(&mut self, ctx: &mut Context) -> Vec<TimedCommand> {
        let now = ctx.p.now;
        // A person who is down clicks nothing, and what they meant to do is moot by the time they are up. (On the planning
        // screen the player is still in the lobby's status, and clicks.)
        if ctx.p.self_view.status != "alive" && ctx.p.hud.phase != "planning" {
            self.pending = [None, None, None, None, None];
            return Vec::new();
        }
        let mut out = Vec::new();
        for _guard in 0..64 {
            if self.pending.iter().all(Option::is_none) {
                break;
            }
            let mut first = f64::INFINITY;
            for q in self.pending.iter().flatten() {
                if q.due < first {
                    first = q.due;
                }
            }
            let t = self.next_slot().max(first);
            if t > now {
                break;
            }
            let mut starved = false;
            for ci in CH_INDEX {
                if let Some(q) = &self.pending[ci] {
                    if q.due <= t && t - q.due > HUMANIZER_RULES.starve_ms {
                        self.pending[ci] = None;
                        self.stats.throttled += 1;
                        starved = true;
                    }
                }
            }
            if starved {
                continue;
            }
            let mut best: Option<usize> = None;
            for ch in CHANNEL_ORDER {
                let ci = Self::idx(ch);
                let Some(q) = &self.pending[ci] else { continue };
                if q.due > t {
                    continue;
                }
                let better = match best {
                    None => true,
                    Some(b) => {
                        let bq = self.pending[b].as_ref().unwrap();
                        q.priority < bq.priority || (q.priority == bq.priority && q.due < bq.due)
                    }
                };
                if better {
                    best = Some(ci);
                }
            }
            let Some(best) = best else { break };
            let q = self.pending[best].take().unwrap();
            let res = self.convert(&q, t, ctx);
            if !res.spent {
                continue;
            }
            self.spend(t);
            let stim = match &q.intent.timing {
                IntentTiming::React { stimulus } => Some(stimulus.clone()),
                _ => None,
            };
            if q.independent {
                self.last_react = Some((q.key.clone(), t));
            }
            if let Some(stim) = &stim {
                self.record_reaction(stim, t);
            }
            self.last_sent[best] = Some(LastSent {
                intent: q.intent.clone(),
                at: t,
            });
            if let Some(cmd) = res.cmd {
                self.note(&cmd, t);
                let release_click = match &cmd {
                    Command::Attack { a } => Some(Command::Release { a: *a }),
                    _ => None,
                };
                let intent = q.intent.kind();
                let priority = q.priority;
                out.push(TimedCommand {
                    at: t,
                    cmd,
                    intent,
                    priority,
                    stimulus: stim.clone(),
                });
                // Button-up belongs to the same physical click and does not spend another action budget token.
                if let Some(cmd) = release_click {
                    let idx = COMMAND_TYPES
                        .iter()
                        .position(|c| *c == CommandType::Release)
                        .unwrap();
                    self.stats.commands[idx] += 1;
                    out.push(TimedCommand {
                        at: t,
                        cmd,
                        intent,
                        priority,
                        stimulus: stim,
                    });
                }
            }
        }
        for ci in CH_INDEX {
            if let Some(q) = &self.pending[ci] {
                if now - q.due > HUMANIZER_RULES.starve_ms {
                    self.pending[ci] = None;
                    self.stats.throttled += 1;
                }
            }
        }
        out
    }

    pub fn drain_misses(&mut self) -> Vec<ClickMiss> {
        std::mem::take(&mut self.misses)
    }
}

use rh_sim::Vec2;

fn near(a: Vec2, b: Vec2) -> bool {
    rh_sim::math::hypot(a.x - b.x, a.y - b.y) <= HUMANIZER_RULES.same_point_u
}

/// The same click: the same kind aimed at the same fighter, container or point (within samePointU).
pub fn same_intent(a: &Intent, b: &Intent) -> bool {
    match (&a.body, &b.body) {
        (IntentBody::Lock { target, .. }, IntentBody::Lock { target: t2, .. }) => target == t2,
        (IntentBody::Move { to }, IntentBody::Move { to: t2 }) => near(*to, *t2),
        (IntentBody::Stop {}, IntentBody::Stop {}) => true,
        (IntentBody::Swap { slot }, IntentBody::Swap { slot: s2 }) => slot == s2,
        (IntentBody::Pickup { container }, IntentBody::Pickup { container: c2 }) => container == c2,
        (
            IntentBody::Cast {
                slot, target, x, y, ..
            },
            IntentBody::Cast {
                slot: s2,
                target: t2,
                x: x2,
                y: y2,
                ..
            },
        ) => {
            if slot != s2 {
                return false;
            }
            if target.is_some() || t2.is_some() {
                target == t2
            } else {
                near(Vec2::new(*x, *y), Vec2::new(*x2, *y2))
            }
        }
        (IntentBody::Plan { msg }, IntentBody::Plan { msg: m2 }) => msg == m2,
        (IntentBody::Choose { msg }, IntentBody::Choose { msg: m2 }) => msg == m2,
        _ => false,
    }
}

pub fn decision_key(i: &Intent) -> String {
    match &i.timing {
        IntentTiming::React { stimulus } => format!(
            "r|{}|{}|{}",
            stimulus.kind.as_str(),
            stimulus.subject.as_deref().unwrap_or(""),
            stimulus.at
        ),
        IntentTiming::Step {} => format!("s|{:?}|{}", i.kind().channel(), i.kind().as_str()),
        IntentTiming::Timed { due } => format!("t|{}|{}", i.kind().as_str(), due),
    }
}
