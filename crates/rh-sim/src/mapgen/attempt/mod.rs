//! The real attempt prefix through fixed ground (stages 1–3). This is not a finished map.
mod rules;
use crate::content::FactionId;
use crate::mapgen::coliseum::{FixedLayout, H, W};
use crate::mapgen::zones::camps::{CampContext, CampDefinition, CampLayout};
use crate::mapgen::zones::{ZoneContext, ZoneDefinition, ZonePartition};
use crate::rng::Mulberry32;
pub use rules::{default_definition, visit_content, AttemptDefinition, DEFAULT_DEFINITION};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StyleCamp {
    pub site: usize,
    pub r: f64,
    pub territory: u8,
    pub elite: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AttemptState {
    pub seed: i64,
    pub attempt: u64,
    pub pillar_variant: usize,
    pub order: Vec<FactionId>,
    pub partition: ZonePartition,
    pub layout: CampLayout,
    pub tiles: Vec<u8>,
    pub clearing: Vec<usize>,
    pub style_camps: Vec<StyleCamp>,
    pub layout_rounds: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AttemptFrame {
    pub state: AttemptState,
    pub rng: Mulberry32,
}
/// Contexts own derived geometry and borrow one immutable fixed layout. No self-referential or process-global cache.
pub struct AttemptContext<'f> {
    fixed: &'f FixedLayout,
    zones: ZoneContext<'f>,
    camps: CampDefinition,
    rules: AttemptDefinition,
}
impl<'f> AttemptContext<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definitions(
            fixed,
            &default_definition(),
            &crate::mapgen::zones::default_definition(),
            &crate::mapgen::zones::camps::default_definition(),
        )
    }
    pub fn from_definitions(
        fixed: &'f FixedLayout,
        attempt: &AttemptDefinition,
        zones: &ZoneDefinition,
        camps: &CampDefinition,
    ) -> Self {
        assert!(attempt.retry_seed_stride.is_finite());
        Self {
            fixed,
            zones: ZoneContext::from_definition(fixed, zones),
            camps: *camps,
            rules: *attempt,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttemptInputError {
    SeedNotSafeInteger,
    AttemptNotSafeInteger,
}
impl core::fmt::Display for AttemptInputError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::SeedNotSafeInteger => "seed must be a JavaScript safe integer",
            Self::AttemptNotSafeInteger => "attempt must be a nonnegative JavaScript safe integer",
        })
    }
}
impl std::error::Error for AttemptInputError {}
pub(crate) fn validate_input(seed: i64, attempt: u64) -> Result<(), AttemptInputError> {
    if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&seed) {
        return Err(AttemptInputError::SeedNotSafeInteger);
    }
    if attempt > 9_007_199_254_740_991 {
        return Err(AttemptInputError::AttemptNotSafeInteger);
    }
    Ok(())
}
fn initial_number(seed: i64, attempt: u64, definition: &AttemptDefinition) -> f64 {
    if attempt == 0 {
        seed as f64
    } else {
        seed as f64 + attempt as f64 * definition.retry_seed_stride
    }
}
/// ECMA ToUint32: truncate first, then positive modulo, with nonfinite/zero mapped to zero.
pub(crate) fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    let remainder = value.trunc() % 4294967296.0;
    if remainder < 0.0 {
        (remainder + 4294967296.0) as u32
    } else {
        remainder as u32
    }
}
/// The safe-integer metadata domain matches the canonical full-map DTO. Wide
/// attempt arithmetic is performed in binary64 before coercion, just like JS.
pub fn begin_attempt(
    context: &AttemptContext<'_>,
    seed: i64,
    attempt: u64,
) -> Result<Option<AttemptFrame>, AttemptInputError> {
    validate_input(seed, attempt)?;
    let mut rng = Mulberry32::new(to_uint32(initial_number(seed, attempt, &context.rules)));
    let state = assemble(
        context,
        seed,
        attempt,
        &mut || rng.next_f64(),
        &mut |_, _, _, _| {},
    );
    Ok(state.map(|state| AttemptFrame { state, rng }))
}
/// One implementation is shared by production and tests that observe the injected stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PrefixStage {
    Partition,
    Camps,
}
fn assemble(
    context: &AttemptContext<'_>,
    seed: i64,
    attempt: u64,
    rng: &mut impl FnMut() -> f64,
    observe: &mut impl FnMut(PrefixStage, usize, Option<&ZonePartition>, Option<&CampLayout>),
) -> Option<AttemptState> {
    let f = context.fixed;
    let pillar_variant = (rng() * f.pillars.len() as f64).floor() as usize;
    let mut order = FactionId::ALL.to_vec();
    for i in (1..order.len()).rev() {
        let j = (rng() * (i + 1) as f64).floor() as usize;
        order.swap(i, j);
    }
    let camps = CampContext::from_definition(&context.zones, &context.camps);
    for round in 0..context.rules.layout_tries {
        // Source returns immediately on partition failure; camp failure alone redraws a partition.
        let partition = crate::mapgen::zones::partition_zones(&context.zones, rng);
        observe(PrefixStage::Partition, round + 1, partition.as_ref(), None);
        let partition = partition?;
        let layout = crate::mapgen::zones::camps::place_camps(&camps, rng, &partition);
        observe(PrefixStage::Camps, round + 1, None, layout.as_ref());
        let Some(layout) = layout else {
            continue;
        };
        let mut tiles = vec![crate::map::TILE_FLOOR; W * H];
        for (i, tile) in tiles.iter_mut().enumerate() {
            if f.border[i] != 0 || f.pillars[pillar_variant][i] != 0 || f.wall_ring[i] != 0 {
                *tile = crate::map::TILE_WALL;
            }
        }
        for gate in &f.gates {
            for point in &gate.tiles {
                tiles[point.y as usize * W + point.x as usize] = crate::map::TILE_FLOOR;
            }
        }
        let mut clearing = Vec::new();
        for camp in &layout.camps {
            for &offset in context.zones.clearing_offsets() {
                clearing.push((camp.site as i32 + offset) as usize);
            }
        }
        let style_camps = layout
            .camps
            .iter()
            .enumerate()
            .map(|(index, camp)| StyleCamp {
                site: camp.site,
                r: context.zones.camp_radius(),
                territory: (index + 1) as u8,
                elite: camp.elite,
            })
            .collect();
        return Some(AttemptState {
            seed,
            attempt,
            pillar_variant,
            order,
            partition,
            layout,
            tiles,
            clearing,
            style_camps,
            layout_rounds: round + 1,
        });
    }
    None
}
#[cfg(test)]
mod tests;
