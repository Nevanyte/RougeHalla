//! ID-free, current authoritative flight for public rendering. No client flight rules or launch history.
use crate::{Observation, OfferError, PlayerId, ProjectileKind, Sim};

/// Complete-scene representation limits. Exceeding a bound refuses delivery; it never truncates.
pub const MAX_VISIBLE_PROJECTILES: usize = 512;
/// Conservative bound for kind + three u16 codes + optional owner in the public wire row.
pub const PROJECTILE_ROW_BYTES_MAX: usize = 16;
pub const PROJECTILE_VIEW_BYTES_MAX: usize = 3 + MAX_VISIBLE_PROJECTILES * PROJECTILE_ROW_BYTES_MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectileView {
    pub kind: ProjectileKind,
    /// Position codes in eighths of a world unit, matching remote actor/prop precision.
    pub x: u16,
    pub y: u16,
    /// Signed-turn u16 code: `(code as i16) * (TAU / 65536)` radians.
    pub facing: u16,
    /// Original launch owner only when currently visible; reflected arrows omit it.
    /// NPC owners are projected through the same delivered actor-reference map as the scene.
    pub owner: Option<PlayerId>,
}
impl ProjectileView {
    fn key(&self) -> (u8, u16, u16, u16, Option<PlayerId>) {
        (
            match self.kind {
                ProjectileKind::Arrow => 0,
                ProjectileKind::Ball => 1,
            },
            self.x,
            self.y,
            self.facing,
            self.owner,
        )
    }
}
pub(crate) fn sort(rows: &mut [ProjectileView]) {
    rows.sort_unstable_by_key(ProjectileView::key);
}

pub(crate) fn project(
    sim: &Sim,
    viewer: PlayerId,
    out: &mut Observation,
) -> Result<(), OfferError> {
    out.projectiles.clear();
    let Some(me) = sim.player(viewer) else {
        return Ok(());
    };
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
        let owner = (!flight.launch.reflected
            && (flight.launch.owner == viewer
                || out.visible.iter().any(|a| a.id == flight.launch.owner)))
        .then_some(flight.launch.owner);
        out.projectiles.push(ProjectileView {
            kind: flight.launch.kind,
            x,
            y,
            facing,
            owner,
        });
    }
    // Final ordering runs in actor_refs::project AFTER NPC owner references are mapped.
    // No raw actor ID, launch ID, time, target, packet or private float residue orders output.
    Ok(())
}

#[cfg(test)]
mod tests;
