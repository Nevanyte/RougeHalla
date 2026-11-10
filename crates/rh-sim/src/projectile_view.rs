//! Current authoritative flight for public rendering, as viewer-scoped tracks (protocol 15). No global launch identity,
//! launch history or client flight rules leave this module: a track is the viewing seat's own alias, issued when a flight
//! enters that viewer's sight and dropped when it leaves it, and its anchor is never older than that entry.
use crate::{Observation, OfferError, PlayerId, ProjectileKind, Sim};

/// Complete-scene representation limits. Exceeding a bound refuses delivery; it never truncates.
pub const MAX_VISIBLE_PROJECTILES: usize = 512;
/// Conservative bound for the public wire row: track varint, kind, four u16 codes, anchor tick varint, optional owner.
pub const PROJECTILE_ROW_BYTES_MAX: usize = 32;
pub const PROJECTILE_VIEW_BYTES_MAX: usize = 3 + MAX_VISIBLE_PROJECTILES * PROJECTILE_ROW_BYTES_MAX;
/// How far (u) a flight may drift from its anchored straight line before the anchor is re-sent. Wire codes are 1/8 u.
pub const TRACK_TOLERANCE: f64 = 0.5;

/// A straight-line anchor in wire codes: the flight was at (`x`, `y`) / 8 u at `tick` and moves at `speed` / 8 u/s along
/// `facing` (signed-turn code), so at tick `t` it is [`ProjectileAnchor::at`]`(t)`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProjectileAnchor {
    pub tick: u32,
    pub x: u16,
    pub y: u16,
    pub facing: u16,
    pub speed: u16,
}

impl ProjectileAnchor {
    /// Where a client that extrapolates this anchor draws the flight at tick `t` (world units; `t >= tick`).
    pub fn at(&self, t: f64) -> (f64, f64) {
        let angle = f64::from(self.facing as i16) * (std::f64::consts::TAU / 65536.);
        let speed = f64::from(self.speed) / 8.;
        let dt = (t - f64::from(self.tick)) * crate::constants::TICK_MS / 1000.;
        (
            f64::from(self.x) / 8. + crate::math::cos(angle) * speed * dt,
            f64::from(self.y) / 8. + crate::math::sin(angle) * speed * dt,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectileView {
    /// This viewer's alias for the flight (nonzero). Unique among the rows; never another viewer's or a launch id.
    #[serde(default)]
    pub track: u32,
    pub kind: ProjectileKind,
    /// Current position codes in eighths of a world unit, matching remote actor/prop precision.
    pub x: u16,
    pub y: u16,
    /// Signed-turn u16 code: `(code as i16) * (TAU / 65536)` radians.
    pub facing: u16,
    /// Current speed in eighths of a world unit per second.
    #[serde(default)]
    pub speed: u16,
    /// The line the wire row carries; equal to the current codes except while a straight flight stays on it.
    #[serde(default)]
    pub anchor: ProjectileAnchor,
    /// Original launch owner only when currently visible; reflected arrows omit it.
    /// NPC owners are projected through the same delivered actor-reference map as the scene.
    pub owner: Option<PlayerId>,
}
impl ProjectileView {
    fn key(&self) -> u32 {
        self.track
    }
}
pub(crate) fn sort(rows: &mut [ProjectileView]) {
    rows.sort_unstable_by_key(ProjectileView::key);
}

/// One seat's flight tracks: presentation state of the delivering observer, never simulation state (not hashed, not
/// checkpointed, rebuilt from nothing on a reconnect). A prepared scene stages into `staged`; only a committed delivery
/// makes it live, so an undelivered frame never consumes an alias the client did not see bound.
#[derive(Clone, Debug, Default)]
pub struct ProjectileTracks {
    /// The last alias issued (0 = none yet). Aliases are never reused while the seat's observer lives.
    issued: u32,
    /// Sorted by private flight id (the binary-search key; never an output order).
    live: Vec<Track>,
    staged_issued: u32,
    staged: Vec<Track>,
    fresh: Vec<usize>,
}

#[derive(Clone, Copy, Debug)]
struct Track {
    /// Private launch identity, the match key only; it never leaves this module.
    flight: u32,
    track: u32,
    anchor: ProjectileAnchor,
}

impl ProjectileTracks {
    /// A replacement epoch (forced resync): every flight gets a fresh track, but no alias is reused.
    pub(crate) fn renewed(&self) -> Self {
        Self {
            issued: self.issued,
            ..Self::default()
        }
    }
    /// Reconnect: invalidate every binding, keep the alias counter.
    pub(crate) fn reconnect(&mut self) {
        *self = self.renewed();
    }
    /// The staged scene was delivered.
    pub(crate) fn commit(&mut self) {
        std::mem::swap(&mut self.live, &mut self.staged);
        self.issued = self.staged_issued;
    }
}

fn speed_code(v: crate::Vec2) -> Result<u16, OfferError> {
    let speed = (crate::math::hypot(v.x, v.y) * 8.).round();
    if (0.0..=f64::from(u16::MAX)).contains(&speed) {
        Ok(speed as u16)
    } else {
        Err(OfferError::ProjectileGeometryOutOfRange)
    }
}

/// The visible flights of `viewer`'s scene as tracks staged in `tracks` (commit them only after delivery).
pub(crate) fn project(
    sim: &Sim,
    viewer: PlayerId,
    out: &mut Observation,
    tracks: &mut ProjectileTracks,
) -> Result<(), OfferError> {
    out.projectiles.clear();
    tracks.staged.clear();
    tracks.fresh.clear();
    tracks.staged_issued = tracks.issued;
    let Some(me) = sim.player(viewer) else {
        return Ok(());
    };
    let tick = sim.tick();
    let wards = crate::vision::WardSight::of_sim(sim);
    for flight in &sim.w.projectiles {
        // Source ProjectileView.update and bot vision.filter both test the current flight point.
        if !crate::vision::point_visible(sim.collision_view(), me, flight.pos, sim.tick(), wards) {
            continue;
        }
        if out.projectiles.len() == MAX_VISIBLE_PROJECTILES {
            return Err(OfferError::TooManyProjectiles);
        }
        if !flight.velocity.x.is_finite() || !flight.velocity.y.is_finite() {
            return Err(OfferError::ProjectileGeometryOutOfRange);
        }
        let x = crate::item_view::position(flight.pos.x)
            .map_err(|_| OfferError::ProjectileGeometryOutOfRange)?;
        let y = crate::item_view::position(flight.pos.y)
            .map_err(|_| OfferError::ProjectileGeometryOutOfRange)?;
        let angle = crate::math::atan2(flight.velocity.y, flight.velocity.x) as f32;
        let facing =
            ((f64::from(angle) / (std::f64::consts::TAU / 65536.)).round() as i64 & 0xffff) as u16;
        let speed = speed_code(flight.velocity)?;
        let owner = (!flight.launch.reflected
            && (flight.launch.owner == viewer
                || out.visible.iter().any(|a| a.id == flight.launch.owner)))
        .then_some(flight.launch.owner);
        let current = ProjectileAnchor {
            tick,
            x,
            y,
            facing,
            speed,
        };
        // A flight keeps its track while it stays in sight; its anchor while it stays on the anchored line.
        // `live` is sorted by flight (see `number`): a binary search, not a scan per visible flight.
        let live = tracks
            .live
            .binary_search_by_key(&flight.launch.id, |t| t.flight)
            .map(|i| &tracks.live[i]);
        let (track, anchor) = match live {
            Ok(t) => {
                let (px, py) = t.anchor.at(f64::from(tick));
                let on_line = t.anchor.tick <= tick
                    && crate::math::hypot(px - flight.pos.x, py - flight.pos.y) <= TRACK_TOLERANCE;
                (t.track, if on_line { t.anchor } else { current })
            }
            Err(_) => {
                tracks.fresh.push(out.projectiles.len());
                (0, current)
            }
        };
        tracks.staged.push(Track {
            flight: flight.launch.id,
            track,
            anchor,
        });
        out.projectiles.push(ProjectileView {
            track,
            kind: flight.launch.kind,
            x,
            y,
            facing,
            speed,
            anchor,
            owner,
        });
    }
    // Fresh rows keep track 0 here: they are numbered by `number` once owners are presented.
    Ok(())
}

/// Number the fresh rows staged by [`project`], after `actor_refs::project` has mapped every owner to its presented
/// reference, then order the rows by track. New tracks follow public row order (never launch id or flight order),
/// tie-broken by the presented owner the viewer sees, after every alias issued before.
pub(crate) fn number(
    rows: &mut [ProjectileView],
    tracks: &mut ProjectileTracks,
) -> Result<(), OfferError> {
    let fresh = &mut tracks.fresh;
    fresh.sort_unstable_by_key(|&i| {
        let r = &rows[i];
        (
            r.kind == ProjectileKind::Ball,
            r.x,
            r.y,
            r.facing,
            r.speed,
            r.owner,
        )
    });
    if u64::from(tracks.issued) + fresh.len() as u64 > u64::from(u32::MAX) {
        return Err(OfferError::HandlesExhausted);
    }
    for (n, &i) in fresh.iter().enumerate() {
        let track = tracks.issued + 1 + n as u32;
        rows[i].track = track;
        tracks.staged[i].track = track;
    }
    tracks.staged_issued = tracks.issued + fresh.len() as u32;
    tracks.staged.sort_unstable_by_key(|t| t.flight);
    sort(rows);
    Ok(())
}

#[cfg(test)]
mod tests;
