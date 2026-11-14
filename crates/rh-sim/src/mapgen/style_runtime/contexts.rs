//! Phase-specific views: the surface/decor callbacks cannot place blockers through their contexts.
use super::*;
use crate::mapgen::landmarks::runtime::{CampInfo, ZoneInfo};
/// Borrowed source BaseCtx. Arrays are immutable; writes remain on the phase-specific context.
pub struct BaseContext<'a> {
    pub w: usize,
    pub h: usize,
    pub seed: i64,
    pub attempt: u64,
    pub zone: &'a ZoneInfo,
    pub mask: &'a [u8],
    pub hard: &'a [u8],
    pub no_block: &'a [u8],
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub edge_dist: &'a [i32],
    pub territory: Option<&'a [u8]>,
    pub camps: &'a [CampInfo],
    pub spawns: &'a [i32],
    pub centre_walk: Option<&'a [i32]>,
    /// P-MAPGEN-LANDMARK-FRAME-1: the zone's signature landmark as the Landmarks phase placed it; `None` with the option
    /// off or without one. The one branch point for signature mode: stylers read the landmark here, never from features.
    pub landmark: Option<&'a crate::mapgen::landmarks::signature::frame::LandmarkFrame>,
    features: &'a [MapFeature],
    owner: &'a [u16],
}
impl BaseContext<'_> {
    pub fn at(&self, x: i32, y: i32) -> i32 {
        at(self.w, self.h, x, y).map_or(-1, |i| i as i32)
    }
    pub fn is_owned(&self, i: i32) -> bool {
        usize::try_from(i)
            .ok()
            .and_then(|i| self.owner.get(i))
            .is_some_and(|&o| o != 0)
    }
    pub fn zone_features(&self) -> impl Iterator<Item = &MapFeature> {
        self.features.iter().filter(|f| f.zone == self.zone.faction)
    }
}
impl<'a> Runtime<'a> {
    pub fn base(&self) -> BaseContext<'_> {
        BaseContext {
            w: self.state.w,
            h: self.state.h,
            seed: self.input.seed,
            attempt: self.input.attempt,
            zone: &self.input.geometry.info,
            mask: &self.input.geometry.mask,
            hard: self.input.hard,
            no_block: self.input.no_block,
            tiles: &self.state.tiles,
            terrain: &self.state.terrain,
            edge_dist: &self.input.geometry.edge_dist,
            territory: self.input.territory,
            camps: &self.input.geometry.camps,
            spawns: self.input.spawns,
            centre_walk: self.input.centre_walk,
            landmark: self.input.landmark,
            features: &self.state.features,
            owner: &self.state.feature_owner,
        }
    }
    pub fn shape_context(&mut self) -> ShapeContext<'_, 'a> {
        let streams = self.streams(Phase::Shape);
        ShapeContext {
            runtime: self,
            streams,
        }
    }
    pub fn surface_context(&mut self) -> SurfaceContext<'_, 'a> {
        let streams = self.streams(Phase::Surface);
        SurfaceContext {
            runtime: self,
            streams,
        }
    }
    pub fn prop_context(&mut self) -> PropContext<'_, 'a> {
        let streams = self.streams(Phase::Decor);
        PropContext {
            runtime: self,
            streams,
        }
    }
}
pub struct ShapeContext<'r, 'a> {
    runtime: &'r mut Runtime<'a>,
    pub streams: Streams,
}
impl ShapeContext<'_, '_> {
    pub fn base(&self) -> BaseContext<'_> {
        self.runtime.base()
    }
    pub fn caps(&self) -> &Definition {
        self.runtime.definition()
    }
    pub fn can_block(&mut self, i: i32, kind: BlockKind) -> bool {
        self.runtime.can_block(i, kind)
    }
    pub fn block(&mut self, i: i32, kind: BlockKind) -> bool {
        self.runtime.block(i, kind)
    }
    pub fn release(&mut self, i: i32) -> bool {
        self.runtime.release(i)
    }
    pub fn open(&self, i: i32) -> bool {
        self.runtime.open(i)
    }
    pub fn fence_detour_ok(&mut self, i: i32) -> bool {
        self.runtime.fence_detour_ok(i)
    }
    pub fn reserve(&mut self, i: i32) {
        self.runtime.reserve(i)
    }
    pub fn is_reserved(&self, i: i32) -> bool {
        self.runtime.is_reserved(i)
    }
    pub fn place_feature(&mut self, spec: &FeatureSpec) -> Result<Option<PlacedFeature>, Error> {
        self.runtime.place_feature(spec)
    }
    pub fn route_guard(&mut self) -> &RouteGuard {
        self.runtime.route_guard()
    }
    pub fn worst_stretch(&mut self, extra: &[i32]) -> i64 {
        self.runtime.worst_stretch(extra)
    }
    pub fn set_hall_pier_count(&mut self, id: usize, count: u32) -> Result<(), Error> {
        self.runtime.set_hall_pier_count(id, count)
    }
}
pub struct SurfaceContext<'r, 'a> {
    runtime: &'r mut Runtime<'a>,
    pub streams: Streams,
}
impl SurfaceContext<'_, '_> {
    pub fn base(&self) -> BaseContext<'_> {
        self.runtime.base()
    }
    pub fn can_surface(&self, i: i32, kind: SurfaceKind) -> bool {
        self.runtime.can_surface(i, kind)
    }
    pub fn surface(&mut self, i: i32, kind: SurfaceKind) -> bool {
        self.runtime.surface(i, kind)
    }
}
pub struct PropContext<'r, 'a> {
    runtime: &'r mut Runtime<'a>,
    pub streams: Streams,
}
impl PropContext<'_, '_> {
    pub fn base(&self) -> BaseContext<'_> {
        self.runtime.base()
    }
    pub fn prop(&mut self, kind: i32, x: i32, y: i32, variant: u8) -> bool {
        self.runtime.prop(kind, x, y, variant)
    }
}
