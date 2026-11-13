//! Ordered stage-four execution and the generator's post-callback breach gate.
//! Protection/box rules reuse the existing spawn-stage definition; the main RNG is never borrowed mutably.
use super::recipe_support::{RecipeInputs, RecipeSupportDefinition};
use super::runtime::{LandmarkDefinition, LandmarkRuntime, Stage4State, ZoneGeometry};
use crate::content::FactionId;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureKind, Zone};
use crate::mapgen::attempt::{AttemptFrame, AttemptInputError};
use crate::mapgen::coliseum::{FixedDefinition, FixedLayout, TileRect, H, W};
use crate::mapgen::spawns::{LandmarkMasks, SpawnContext, SpawnDefinition};
use crate::mapgen::zones::camps::CampDefinition;
use crate::mapgen::zones::ZoneDefinition;

/// Existing live definitions, grouped only to keep corresponding geometry/protection inputs together.
#[derive(Clone, Copy, Debug)]
pub struct Definitions<'a> {
    pub fixed: FixedDefinition<'a>,
    pub zones: ZoneDefinition,
    pub camps: CampDefinition,
    pub spawns: SpawnDefinition,
    pub runtime: LandmarkDefinition,
    pub support: RecipeSupportDefinition,
}
impl Default for Definitions<'static> {
    fn default() -> Self {
        Self {
            fixed: crate::mapgen::coliseum::default_definition(),
            zones: crate::mapgen::zones::default_definition(),
            camps: crate::mapgen::zones::camps::default_definition(),
            spawns: crate::mapgen::spawns::default_definition(),
            runtime: super::runtime::default_definition(),
            support: super::recipe_support::default_definition(),
        }
    }
}

pub struct StageContext<'f> {
    fixed: &'f FixedLayout,
    fixed_rules: FixedDefinition<'f>,
    support: RecipeSupportDefinition,
    runtime: LandmarkDefinition,
    protection: SpawnContext<'f>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZoneResult {
    pub index: u8,
    pub faction: Zone,
    pub landmarks: usize,
    pub walls: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LandmarkStage {
    pub state: Stage4State,
    pub protect: Vec<u8>,
    pub buildings: Vec<TileRect>,
    pub masks: LandmarkMasks,
    pub zones: Vec<ZoneResult>,
}

impl<'f> StageContext<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definitions(fixed, &Definitions::default())
    }

    /// The fixed layout and definitions must correspond, as for the existing attempt/spawn contexts.
    pub fn from_definitions(fixed: &'f FixedLayout, d: &Definitions<'f>) -> Self {
        Self {
            fixed,
            fixed_rules: d.fixed,
            support: d.support,
            runtime: d.runtime,
            protection: SpawnContext::from_definitions(
                fixed, &d.spawns, &d.fixed, &d.zones, &d.camps,
            ),
        }
    }

    /// Execute all five actual callbacks, sharing state in internal zone order.
    pub fn apply(
        &self,
        frame: &AttemptFrame,
        recipes: &super::recipes::Recipes<'_>,
    ) -> Result<Option<LandmarkStage>, AttemptInputError> {
        self.apply_with(frame, |_, rt, inputs| recipes.apply(rt, inputs))
    }

    /// Run the supplied callbacks in the attempt's shuffled, one-based zone order.
    /// A callback can only write through the accepted runtime. Default recipe dispatch is a separate registry.
    /// `None` is the source's A:styleBreach refusal; invalid safe-integer metadata remains a typed input error.
    pub fn apply_with(
        &self,
        frame: &AttemptFrame,
        mut callback: impl FnMut(Zone, &mut LandmarkRuntime<'_>, &RecipeInputs<'_>),
    ) -> Result<Option<LandmarkStage>, AttemptInputError> {
        let prefix = &frame.state;
        let inputs = RecipeInputs::new(
            prefix.seed,
            prefix.attempt,
            self.fixed,
            &self.fixed_rules,
            &self.support,
        )?;
        let protect = self.protection.landmark_protect(&prefix.layout.camps);
        // P-MAPGEN-SIG-RESERVE-1: the legacy recipes keep out of every reserved landmark site. Only the recipes (and
        // their admission) read the sites; `LandmarkStage::protect` stays the camp protection the signature step reads.
        let recipe_protect: std::borrow::Cow<'_, [u8]> = if prefix.reserved.is_empty() {
            std::borrow::Cow::Borrowed(&protect)
        } else {
            let mut p = protect.clone();
            for r in &prefix.reserved {
                for y in r.rect.y..r.rect.y + r.rect.h as i32 {
                    for x in r.rect.x..r.rect.x + r.rect.w as i32 {
                        if x >= 0 && y >= 0 && (x as usize) < W && (y as usize) < H {
                            p[y as usize * W + x as usize] = 1;
                        }
                    }
                }
            }
            std::borrow::Cow::Owned(p)
        };
        let mut state = Stage4State::new(W, H, prefix.tiles.clone(), Vec::new(), vec![0; W * H]);
        let mut zones = Vec::with_capacity(prefix.order.len());
        for (slot, &faction) in prefix.order.iter().enumerate() {
            let index = u8::try_from(slot + 1).expect("one-based zone index");
            let faction = zone_of(faction);
            let geometry = ZoneGeometry::new(
                index,
                faction,
                &prefix.partition.zone,
                &state.tiles,
                W,
                H,
                &prefix.style_camps,
            );
            let mut result = ZoneResult {
                index,
                faction,
                landmarks: 0,
                walls: 0,
            };
            if geometry.info.painted != 0 {
                let before = state.features.len();
                let mut rt = LandmarkRuntime::new(
                    &mut state,
                    &geometry,
                    &recipe_protect,
                    Some(&prefix.layout.territory_grid),
                    &self.runtime,
                );
                callback(faction, &mut rt, &inputs);
                result.walls = rt.counters().walls;
                result.landmarks = rt.state().features[before..]
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Landmark)
                    .count();
            }
            zones.push(result);
        }
        if !admit_changes(
            &prefix.tiles,
            &prefix.partition.zone,
            &prefix.order,
            &recipe_protect,
            &state,
        ) {
            return Ok(None);
        }
        let buildings: Vec<_> = state
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::Landmark)
            .map(|f| TileRect {
                x: f.bbox.x,
                y: f.bbox.y,
                w: f.bbox.w as i32,
                h: f.bbox.h as i32,
            })
            .collect();
        let masks = self.protection.landmark_masks(&buildings);
        Ok(Some(LandmarkStage {
            state,
            protect,
            buildings,
            masks,
            zones,
        }))
    }
}

fn zone_of(faction: FactionId) -> Zone {
    match faction {
        FactionId::Fire => Zone::Fire,
        FactionId::Sentenced => Zone::Sentenced,
        FactionId::Plague => Zone::Plague,
        FactionId::Frost => Zone::Frost,
        FactionId::Holy => Zone::Holy,
    }
}

/// Precisely the source generator's changed-cell admission, not an independent certifier.
fn admit_changes(
    before: &[u8],
    zone: &[u8],
    order: &[FactionId],
    protect: &[u8],
    state: &Stage4State,
) -> bool {
    let n = before.len();
    if state.tiles.len() != n
        || zone.len() != n
        || protect.len() != n
        || state.feature_owner.len() != n
    {
        return false;
    }
    for i in 0..n {
        if state.tiles[i] == before[i] {
            continue;
        }
        if before[i] != TILE_FLOOR || state.tiles[i] != TILE_WALL || zone[i] == 0 || protect[i] != 0
        {
            return false;
        }
        let Some(&faction) = order.get(usize::from(zone[i] - 1)) else {
            return false;
        };
        let Some(owner) = state.feature_owner[i]
            .checked_sub(1)
            .and_then(|o| state.features.get(usize::from(o)))
        else {
            return false;
        };
        if owner.kind != FeatureKind::Landmark || owner.zone != zone_of(faction) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests;
