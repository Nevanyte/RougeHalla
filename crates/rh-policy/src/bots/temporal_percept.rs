//! Complete private source FrameRing method component. No accepted-scene adapter,
//! observation constructor, World access, RNG, live dispatch or identity authority.
//! Records are owned declared public-method inputs; IDs retain source string equality.
//! Source loss/retention rules are modeled, NOT approved as safe public intake bounds.
#![allow(dead_code)] // Deliberately inactive until the separate publication/acceptance contract.

mod data;
mod input;
mod memory;
mod modules;
mod strategy;
mod tactics;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod protection_cues_tests;

use crate::bots::view::{field_in_view, in_view, FieldInView};
use data::{nullable, num, object, text, MethodValue, Object};
use input::{Actor, Compose, Event, EventKind, Frame, MethodId, Owner, Percept};
use rh_sim::mapgen::certify::source_hypot as hypot;
use rh_sim::Vec2;
use std::collections::VecDeque;
use std::sync::Arc;

const VELOCITY_MS: f64 = 100.;
const KEEP_EXTRA_MS: f64 = 200.;
const DEFAULT_KEEP_MS: f64 = 1000.;
const MAX_FRAMES: usize = 128;
const MAX_QUEUED: usize = 4096;
const MOB_FADE_MS: f64 = 450.;
const BODY_MATCH: f64 = 1.;
const RANGE_SLACK: f64 = 40.;
const DONE_MAX: usize = 256;
const TELEPORT_DISTANCE: f64 = 200.;
const LAUNCH_NEAR: f64 = 56.;
const MATCHUP_RANGE: f64 = 450.;
const MATCHUP_FULL_RANGE: f64 = 150.;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    Missing(&'static str),
    Shape(&'static str),
    Nonfinite,
}
#[derive(Clone, Debug, PartialEq)]
struct Queued {
    event: Event,
    frame: Arc<Frame>,
}
#[derive(Clone, Debug, PartialEq)]
struct End {
    at: Vec2,
    time: f64,
    reason: String,
}
#[derive(Clone, Debug, PartialEq)]
struct Flight {
    id: MethodId,
    kind: String,
    origin: Vec2,
    velocity: Vec2,
    started: f64,
    range: f64,
    end: Option<End>,
    // None: not credited yet; Some(None): actual source attribution was null.
    from: Option<Option<MethodId>>,
}
#[derive(Clone, Copy)]
struct Bracket {
    a: usize,
    b: Option<usize>,
    k: f64,
    cut: bool,
}
struct View {
    at: Vec2,
    visible: Vec<MethodId>,
}

/// Source-method diagnostics only. A future public adapter must preflight its own
/// complete history requirements and refuse before any lossy source overflow.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PushReport {
    pub(crate) late_ignored: bool,
    pub(crate) replaced: bool,
    pub(crate) world_evicted: usize,
    pub(crate) immediate_evicted: usize,
    pub(crate) frames_pruned: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Ring {
    frames: VecDeque<Arc<Frame>>,
    world: VecDeque<Queued>,
    immediate: VecDeque<Event>,
    flights: Vec<Flight>, // JS Map insertion order, never sorted by identity.
    done: VecDeque<MethodId>, // JS Set insertion order, including negative/repeat handling.
    death_at: Vec<(MethodId, f64)>,
    keep_ms: f64,
}
impl Default for Ring {
    fn default() -> Self {
        Self {
            frames: VecDeque::new(),
            world: VecDeque::new(),
            immediate: VecDeque::new(),
            flights: Vec::new(),
            done: VecDeque::new(),
            death_at: Vec::new(),
            keep_ms: DEFAULT_KEEP_MS,
        }
    }
}
impl Ring {
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }
    pub(crate) fn size(&self) -> usize {
        self.frames.len()
    }

    pub(crate) fn push(&mut self, frame: Frame) -> PushReport {
        let mut report = PushReport::default();
        if self
            .frames
            .back()
            .is_some_and(|last| frame.time < last.time)
        {
            report.late_ignored = true;
            return report;
        }
        let frame = Arc::new(frame);
        if self
            .frames
            .back()
            .is_some_and(|last| frame.time == last.time)
        {
            self.frames.pop_back();
            report.replaced = true;
        }
        self.frames.push_back(Arc::clone(&frame));
        for event in &frame.events {
            self.world.push_back(Queued {
                event: event.clone(),
                frame: Arc::clone(&frame),
            });
            if let EventKind::Death { id, .. } = &event.kind {
                if let Some((_, time)) = self.death_at.iter_mut().find(|(key, _)| key == id) {
                    *time = event.time;
                } else {
                    self.death_at.push((id.clone(), event.time));
                }
            }
        }
        self.immediate.extend(frame.immediate.iter().cloned());
        report.world_evicted = self.world.len().saturating_sub(MAX_QUEUED);
        self.world.drain(..report.world_evicted);
        report.immediate_evicted = self.immediate.len().saturating_sub(MAX_QUEUED);
        self.immediate.drain(..report.immediate_evicted);
        for p in &frame.projectiles {
            if self.flights.iter().any(|f| f.id == p.id) || self.done.contains(&p.id) {
                continue;
            }
            self.flights.push(Flight {
                id: p.id.clone(),
                kind: p.kind.clone(),
                origin: p.origin,
                velocity: p.velocity,
                started: p.started,
                range: p.range,
                end: None,
                from: None,
            });
        }
        for event in &frame.events {
            if let (EventKind::End { id, reason }, Some(at)) = (&event.kind, event.at) {
                if let Some(flight) = self.flights.iter_mut().find(|f| &f.id == id) {
                    flight.end = Some(End {
                        at,
                        time: event.time,
                        reason: reason.clone(),
                    });
                }
            }
        }
        let before = self.frames.len();
        let cutoff = frame.time - self.keep_ms;
        while self.frames.len() > 2 && self.frames[1].time <= cutoff {
            self.frames.pop_front();
        }
        while self.frames.len() > MAX_FRAMES {
            self.frames.pop_front();
        }
        self.death_at.retain(|(_, time)| {
            (*time + MOB_FADE_MS).partial_cmp(&(cutoff - 2000.)) != Some(std::cmp::Ordering::Less)
        });
        report.frames_pruned = before - self.frames.len();
        report
    }

    /// Cold/private method staging preserves state on nonfinite derived output.
    /// This is not a zero-allocation, accepted-scene or public-input performance claim.
    pub(crate) fn compose(&mut self, cfg: &Compose<'_>) -> Result<Option<Percept>, Error> {
        if !cfg.self_delay_ms.is_finite()
            || !cfg.world_delay_ms.is_finite()
            || !cfg.attention_central.is_finite()
        {
            return Err(Error::Nonfinite);
        }
        let mut staged = self.clone();
        let result = staged.compose_inner(cfg)?;
        if let Some(percept) = &result {
            percept.validate()?;
        }
        *self = staged;
        Ok(result)
    }
    fn compose_inner(&mut self, cfg: &Compose<'_>) -> Result<Option<Percept>, Error> {
        let Some(last) = self.frames.back() else {
            return Ok(None);
        };
        self.keep_ms = cfg.world_delay_ms + KEEP_EXTRA_MS;
        let now = last.time;
        let view_time = now - cfg.world_delay_ms;
        if !view_time.is_finite() || !self.keep_ms.is_finite() {
            return Err(Error::Nonfinite);
        }
        if self.frames[0].time > view_time {
            return Ok(None);
        }
        let self_time = now - cfg.self_delay_ms;
        if !self_time.is_finite() {
            return Err(Error::Nonfinite);
        }
        let latest_index = self.frame_at(self_time).unwrap_or(0);
        let latest = Arc::clone(&self.frames[latest_index]);
        let owner = &latest.owner;
        let before = self
            .teleport_between(view_time, latest.time)
            .then(|| self.frame_at(view_time))
            .flatten();
        let eye = if before.is_some() {
            self.self_at(view_time).unwrap_or(owner.at)
        } else {
            owner.at
        };
        let scene = Arc::clone(&self.frames[before.unwrap_or(latest_index)]);
        let sight = if latest.hud.locked {
            &cfg.maps.locked
        } else {
            &cfg.maps.open
        };
        let due = take_due(&mut self.world, view_time, |q| q.event.time);
        let mut pending_deaths = Vec::new();
        let mut pending_bodies = Vec::new();
        for q in &self.world {
            if let EventKind::Death { id, .. } = &q.event.kind {
                pending_deaths.push(id.clone());
                if let Some(at) = q.event.at {
                    pending_bodies.push(at);
                }
            }
        }
        let bracket = self
            .bracket(view_time)
            .ok_or(Error::Shape("view bracket"))?;
        let prev_time = view_time - VELOCITY_MS;
        let prev = self.bracket(prev_time);
        let prev_owner = self
            .frame_at(latest.time - VELOCITY_MS)
            .map(|i| self.frames[i].owner.at);
        let cut = self.teleport_between(prev_time, view_time);
        let los = |at| rh_sim::geometry::has_line_of_sight(sight, eye, at, rh_sim::map::MASK_SIGHT);
        let mut fighters = Vec::new();
        for actor in &scene.fighters {
            if actor.status != "alive"
                && actor.status != "lobby"
                && !pending_deaths.contains(&actor.id)
            {
                continue;
            }
            let at = self
                .sample(Some(bracket), false, &actor.id)
                .unwrap_or(actor.at);
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let velocity = self.velocity(prev, prev_owner, false, &actor.id, at, cut);
            fighters.push(drawn(
                actor,
                at,
                velocity,
                eye,
                los(at),
                cfg.attention_central,
                true,
            ));
        }
        let mut mobs = Vec::new();
        for actor in &scene.mobs {
            if actor.status != "alive" {
                let died = self
                    .death_at
                    .iter()
                    .find(|(id, _)| id == &actor.id)
                    .map(|(_, t)| *t);
                if !died.is_some_and(|died| view_time < died + MOB_FADE_MS) {
                    continue;
                }
            }
            let at = self
                .sample(Some(bracket), true, &actor.id)
                .unwrap_or(actor.at);
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let velocity = self.velocity(prev, prev_owner, true, &actor.id, at, cut);
            mobs.push(drawn(
                actor,
                at,
                velocity,
                eye,
                los(at),
                cfg.attention_central,
                false,
            ));
        }
        tint(&latest, owner, &mut fighters, &mobs)?;
        let mut visible = vec![owner.id.clone()];
        for row in fighters.iter().chain(&mobs) {
            let id = MethodId(row.string("id")?.to_owned());
            if !visible.contains(&id) {
                visible.push(id);
            }
        }
        let view = View { at: eye, visible };
        let mut containers = Vec::new();
        for c in &scene.containers {
            if !in_view(eye.x, eye.y, c.at.x, c.at.y, 0.) {
                continue;
            }
            if c.kind == "body"
                && pending_bodies
                    .iter()
                    .any(|p| (c.at.x - p.x).abs() < BODY_MATCH && (c.at.y - p.y).abs() < BODY_MATCH)
            {
                continue;
            }
            let mut row = c.record.clone();
            row.put("dist", num(distance(c.at, eye)));
            containers.push(row);
        }
        let projectiles = self.fly(view_time, &view, owner, eye, &fighters, &mobs)?;
        let mut events = Vec::new();
        for queued in &due {
            if let Some(event) = deliver(queued, &view)? {
                events.push(event);
            }
        }
        events.extend(
            take_due(&mut self.immediate, self_time, |e| e.time)
                .into_iter()
                .map(|e| e.record),
        );
        Ok(Some(Percept {
            now,
            view_time,
            owner: owner.record.clone(),
            hud: latest.hud.record.clone(),
            fighters,
            mobs,
            containers,
            projectiles,
            minimap: latest.minimap.clone(),
            events,
            extras: window_extras(&scene.extras, &view)?,
            features: cfg.features.clone(),
        }))
    }

    fn frame_at(&self, time: f64) -> Option<usize> {
        self.frames.iter().rposition(|frame| frame.time <= time)
    }
    fn teleport_between(&self, from: f64, to: f64) -> bool {
        self.frames.iter().any(|frame| {
            frame
                .events
                .iter()
                .any(|e| matches!(e.kind, EventKind::Teleport) && e.time > from && e.time <= to)
        })
    }
    fn bracket(&self, time: f64) -> Option<Bracket> {
        let a = self.frame_at(time)?;
        let b = (a + 1 < self.frames.len()).then_some(a + 1);
        let Some(b) = b else {
            return Some(Bracket {
                a,
                b: None,
                k: 0.,
                cut: false,
            });
        };
        Some(Bracket {
            a,
            b: Some(b),
            k: (time - self.frames[a].time) / (self.frames[b].time - self.frames[a].time),
            cut: self.frames[b]
                .events
                .iter()
                .any(|e| matches!(e.kind, EventKind::Teleport)),
        })
    }
    fn self_at(&self, time: f64) -> Option<Vec2> {
        let br = self.bracket(time)?;
        let a = self.frames[br.a].owner.at;
        Some(if let Some(b) = br.b.filter(|_| !br.cut) {
            interpolate(a, self.frames[b].owner.at, br.k)
        } else {
            a
        })
    }
    fn sample(&self, br: Option<Bracket>, mob: bool, id: &MethodId) -> Option<Vec2> {
        let br = br?;
        let find = |i| {
            let rows = if mob {
                &self.frames[i].mobs
            } else {
                &self.frames[i].fighters
            };
            find_actor(rows, id).map(|row| row.at)
        };
        let a = find(br.a);
        let b = br.b.and_then(find);
        match (a, b) {
            (Some(a), Some(b)) => Some(if br.cut || distance(b, a) > TELEPORT_DISTANCE {
                a
            } else {
                interpolate(a, b, br.k)
            }),
            _ => a.or(b),
        }
    }
    fn velocity(
        &self,
        br: Option<Bracket>,
        prev_owner: Option<Vec2>,
        mob: bool,
        id: &MethodId,
        at: Vec2,
        cut: bool,
    ) -> Vec2 {
        let Some(owner) = prev_owner.filter(|_| !cut) else {
            return Vec2::new(0., 0.);
        };
        let Some(prior) = self.sample(br, mob, id) else {
            return Vec2::new(0., 0.);
        };
        if !in_view(owner.x, owner.y, prior.x, prior.y, 0.)
            || distance(at, prior) > TELEPORT_DISTANCE
        {
            return Vec2::new(0., 0.);
        }
        Vec2::new(
            ((at.x - prior.x) * 1000.) / VELOCITY_MS,
            ((at.y - prior.y) * 1000.) / VELOCITY_MS,
        )
    }
    fn fly(
        &mut self,
        time: f64,
        view: &View,
        owner: &Owner,
        eye: Vec2,
        fighters: &[Object],
        mobs: &[Object],
    ) -> Result<Vec<MethodValue>, Error> {
        let mut out = Vec::new();
        let mut index = 0;
        while index < self.flights.len() {
            let flight = &self.flights[index];
            let speed = hypot(flight.velocity.x, flight.velocity.y);
            let travelled = speed * ((time - flight.started) / 1000.);
            if !speed.is_finite() || !travelled.is_finite() {
                return Err(Error::Nonfinite);
            }
            if flight
                .end
                .as_ref()
                .map_or(travelled > flight.range + RANGE_SLACK, |end| {
                    time >= end.time
                })
            {
                self.finish(index);
                continue;
            }
            if travelled < 0. || speed == 0. {
                index += 1;
                continue;
            }
            let limit = flight
                .end
                .as_ref()
                .map_or(flight.range, |end| distance(end.at, flight.origin));
            if !limit.is_finite() {
                return Err(Error::Nonfinite);
            }
            if flight
                .end
                .as_ref()
                .is_some_and(|e| matches!(e.reason.as_str(), "reflected" | "deleted" | "destroyed"))
                && travelled >= limit
            {
                self.finish(index);
                continue;
            }
            if self.flights[index].from.is_none() {
                self.flights[index].from = Some(launcher(
                    self.flights[index].origin,
                    owner,
                    eye,
                    fighters,
                    mobs,
                )?);
            }
            let flight = &self.flights[index];
            let d = travelled.min(limit) / speed;
            let at = Vec2::new(
                flight.origin.x + flight.velocity.x * d,
                flight.origin.y + flight.velocity.y * d,
            );
            if !at.x.is_finite() || !at.y.is_finite() {
                return Err(Error::Nonfinite);
            }
            if in_view(view.at.x, view.at.y, at.x, at.y, 0.) {
                out.push(object([
                    ("id", text(&flight.id.0)),
                    ("kind", text(&flight.kind)),
                    ("x", num(at.x)),
                    ("y", num(at.y)),
                    ("vx", num(flight.velocity.x)),
                    ("vy", num(flight.velocity.y)),
                    ("x0", num(flight.origin.x)),
                    ("y0", num(flight.origin.y)),
                    ("t0", num(flight.started)),
                    ("range", num(flight.range)),
                    (
                        "from",
                        nullable(
                            flight
                                .from
                                .as_ref()
                                .and_then(Option::as_ref)
                                .map(|id| id.0.as_str()),
                        ),
                    ),
                ]));
            }
            index += 1;
        }
        Ok(out)
    }
    fn finish(&mut self, index: usize) {
        let id = self.flights.remove(index).id;
        if !self.done.contains(&id) {
            self.done.push_back(id);
        }
        while self.done.len() > DONE_MAX {
            self.done.pop_front();
        }
    }
}

fn take_due<T>(queue: &mut VecDeque<T>, time: f64, stamp: impl Fn(&T) -> f64) -> Vec<T> {
    let mut due = Vec::new();
    let mut later = VecDeque::new();
    while let Some(item) = queue.pop_front() {
        if stamp(&item) <= time {
            due.push(item);
        } else {
            later.push_back(item);
        }
    }
    *queue = later;
    due
}
fn interpolate(a: Vec2, b: Vec2, k: f64) -> Vec2 {
    Vec2::new(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
}
fn distance(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
fn drawn(
    actor: &Actor,
    at: Vec2,
    velocity: Vec2,
    eye: Vec2,
    los: bool,
    central: f64,
    fighter: bool,
) -> Object {
    let mut row = actor.record.clone();
    for (key, value) in [
        ("x", at.x),
        ("y", at.y),
        ("vx", velocity.x),
        ("vy", velocity.y),
        ("dist", distance(at, eye)),
    ] {
        row.put(key, num(value));
    }
    row.put("los", MethodValue::Bool(los));
    if fighter {
        row.put("tint", num(0.));
    }
    row.put(
        "central",
        MethodValue::Bool(
            (at.x - eye.x).abs() <= central * crate::bots::types::BOT_VIEW_HALF_W
                && (at.y - eye.y).abs() <= central * crate::bots::types::BOT_VIEW_HALF_H,
        ),
    );
    row
}
fn tint(
    latest: &Frame,
    owner: &Owner,
    fighters: &mut [Object],
    mobs: &[Object],
) -> Result<(), Error> {
    if latest.hud.phase != "active" || owner.status != "alive" || owner.faction.is_none() {
        return Ok(());
    }
    let mut best = None;
    let mut best_distance = MATCHUP_RANGE;
    for (index, row) in fighters.iter().enumerate() {
        if row.string("status")? != "alive"
            || data::faction(row.get("faction")?)?.is_none()
            || row.number("dist")? >= best_distance
            || !row.boolean("los")?
        {
            continue;
        }
        best = Some(index);
        best_distance = row.number("dist")?;
    }
    for row in mobs {
        if row.string("status")? != "alive"
            || data::faction(row.get("faction")?)?.is_none()
            || row.number("dist")? >= best_distance
            || !row.boolean("los")?
        {
            continue;
        }
        best = None;
        best_distance = row.number("dist")?;
    }
    if let Some(index) = best {
        // shared/signatures factionEdge is exactly0; an actual empty hand has no edge.
        let theirs = data::weapon(fighters[index].get("inHand")?)?;
        let score = owner.weapons[owner.slot]
            .zip(theirs)
            .map_or(0., |(mine, theirs)| {
                f64::from(crate::bots::mob_hunt::weapon_edge(mine, theirs))
            });
        let value = if best_distance >= MATCHUP_RANGE || score == 0. {
            0.
        } else {
            let fade = if best_distance <= MATCHUP_FULL_RANGE {
                1.
            } else {
                (MATCHUP_RANGE - best_distance) / (MATCHUP_RANGE - MATCHUP_FULL_RANGE)
            };
            (score.clamp(-2., 2.) / 2.) * fade
        };
        fighters[index].put("tint", num(value));
    }
    Ok(())
}
fn launcher(
    at: Vec2,
    owner: &Owner,
    eye: Vec2,
    fighters: &[Object],
    mobs: &[Object],
) -> Result<Option<MethodId>, Error> {
    let mut best = None;
    let mut best_sq = LAUNCH_NEAR * LAUNCH_NEAR;
    let mut consider = |id: MethodId, p: Vec2| {
        let sq = (p.x - at.x).powi(2) + (p.y - at.y).powi(2);
        if sq < best_sq {
            best = Some(id);
            best_sq = sq;
        }
    };
    if owner.status == "alive" {
        consider(owner.id.clone(), eye);
    }
    for row in fighters.iter().chain(mobs) {
        consider(MethodId(row.string("id")?.to_owned()), row.at()?);
    }
    Ok(best)
}
fn mask(id: Option<&str>, view: &View) -> Option<String> {
    id.filter(|id| view.visible.iter().any(|key| key.0 == *id))
        .map(str::to_owned)
}
fn deliver(q: &Queued, view: &View) -> Result<Option<Object>, Error> {
    let event = &q.event;
    let Some(at) = event.at else {
        return Ok(Some(event.record.clone()));
    };
    let on = in_view(view.at.x, view.at.y, at.x, at.y, 0.);
    let mut row = event.record.clone();
    match &event.kind {
        EventKind::Death { id, by, mob } => {
            if on {
                row.put("by", nullable(mask(by.as_deref(), view).as_deref()));
            } else {
                let kind = if *mob {
                    find_actor(&q.frame.mobs, id)
                        .map(|m| m.record.string("kind"))
                        .transpose()?
                } else {
                    None
                };
                if kind == Some("mob") {
                    return Ok(None);
                }
                row.put("at", MethodValue::Null);
                if kind != Some("elite") {
                    row.put("by", MethodValue::Null);
                }
            }
        }
        EventKind::Impact { by } => {
            if !on {
                return Ok(None);
            }
            row.put("by", nullable(mask(by.as_deref(), view).as_deref()));
        }
        EventKind::Ext { data } => {
            if !on {
                return Ok(None);
            }
            let mut data = data.clone();
            for (_, value) in &mut data.0 {
                let MethodValue::Str(id) = value else {
                    continue;
                };
                if view.visible.iter().any(|key| &key.0 == id) {
                    continue;
                }
                let key = MethodId(id.clone());
                if find_actor(&q.frame.fighters, &key).is_some()
                    || find_actor(&q.frame.mobs, &key).is_some()
                {
                    *value = MethodValue::Null;
                }
            }
            row.put("data", data.data());
        }
        _ => {
            if !on {
                return Ok(None);
            }
        }
    }
    Ok(Some(row))
}
fn window_extras(extras: &Object, view: &View) -> Result<Object, Error> {
    let mut out = extras.clone();
    if let Some(effects) = extras.optional("effects") {
        let effects = Object::read(effects.clone())?;
        let mut bits = Vec::new();
        // Source puts self, fighters, mobs exactly in this order; visible already has it.
        for id in &view.visible {
            if let Some(value) = effects.optional(&id.0) {
                bits.push((id.0.clone(), value.clone()));
            }
        }
        out.put("effects", MethodValue::Obj(bits));
    }
    if let Some(MethodValue::Arr(fields)) = extras.optional("fields") {
        let mut kept = Vec::new();
        for field in fields {
            let mut row = Object::read(field.clone())?;
            let shape = FieldInView {
                kind: row.string("kind")?.to_owned(),
                x: row.number("x")?,
                y: row.number("y")?,
                x2: row.number("x2")?,
                y2: row.number("y2")?,
                r: row.number("r")?,
            };
            if !field_in_view(view.at.x, view.at.y, &shape, 0.) {
                continue;
            }
            let id = row.nullable_string("owner")?;
            if id
                .as_ref()
                .is_some_and(|id| !view.visible.iter().any(|key| &key.0 == id))
            {
                row.put("owner", MethodValue::Null);
            }
            kept.push(row.data());
        }
        out.put("fields", MethodValue::Arr(kept));
    }
    Ok(out)
}

/// Source findById assumes perception's sorted lists and uses binary search.
/// Preserve even duplicate/unsorted method semantics; never sort or stitch IDs here.
fn find_actor<'a>(rows: &'a [Actor], id: &MethodId) -> Option<&'a Actor> {
    let mut lo = 0;
    let mut hi = rows.len();
    while lo < hi {
        let mid = (lo + hi - 1) / 2;
        match rows[mid].id.0.encode_utf16().cmp(id.0.encode_utf16()) {
            std::cmp::Ordering::Equal => return Some(&rows[mid]),
            std::cmp::Ordering::Less => lo = mid + 1,
            std::cmp::Ordering::Greater => hi = mid,
        }
    }
    None
}
