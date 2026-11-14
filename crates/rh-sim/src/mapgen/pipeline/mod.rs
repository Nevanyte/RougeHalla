//! The actual thirteen-stage attempt, with plain and five-faction styled entry points.
//! Default faction landmarks and elite bushes remain enabled. No I/O, clock, entropy or global cache.
use super::{
    attempt, bushes,
    coliseum::{FixedLayout, CX, CY, H, W},
    landmarks::{recipes, signature, stage},
    records, repair, spawns, spots, style_runtime, style_zones, tail, terrain_gate, zones,
};
use crate::constants::{PLAYER_RADIUS, TILE};
use crate::map::TileMap;
use crate::mapdata::{GameMapData, MapProp, WorldPt, Zone};
use crate::math::Vec2;
use crate::pathfind::Pathfinder;
use crate::rng::Mulberry32;
mod rules;
mod style_contract;
#[cfg(test)]
mod style_contract_tests;
pub use rules::{default_definition, visit_content, Definition, DEFAULT_DEFINITION};
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub decor: bool,
    pub shape_gates: bool,
    pub bushes: bool,
    /// Signature landmarks (P-MAPGEN-SIGNATURE-CORE-1, owner rules G1-G8): the Landmarks phase also places each zone's
    /// signature landmark and the finished map carries the zone anchors. Styled attempts only. Off by default and
    /// absent from stored options, so every legacy-mode map is byte-identical (G8).
    #[serde(default)]
    pub signature: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            decor: true,
            shape_gates: true,
            bushes: true,
            signature: false,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Phase {
    Prefix,
    Landmarks,
    Spawns,
    Styler,
    Nets,
    Crates,
    Post,
    Terrain,
    Ground,
    Bushes,
    SpawnGate,
    Records,
    Gates,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trace {
    pub phase: Phase,
    pub continuation: [u32; 4],
    pub pool: Vec<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Refusal {
    Prefix,
    Landmarks,
    SpawnPool,
    StyleBreach(String),
    Repair(repair::Refusal),
    Crates,
    Ground,
    SpawnWalk,
    SpawnRatio,
    Features,
    Shape(String),
    Terrain,
    /// The signature step found no legal landmark site for a zone, refused in the Landmarks phase before spawns and
    /// stylers (only with `Options::signature`). A finished map discarded later is `SignatureDiscarded`.
    Signature,
    /// A signature map discarded by the end-of-attempt check, after records: a landmark no longer whole, a styler
    /// feature in an apron, a landmark in another landmark's apron, the Frost lake away from the cave's mouth, or a
    /// strict certifier failure (only with `Options::signature`).
    SignatureDiscarded,
    /// A styler could not build round a signature landmark in its zone (`style_runtime::Error::Landmark`), refused in
    /// the Styler phase before the Styler trace and the style contract; the next attempt is tried. Only with
    /// `Options::signature`. Every other styler error still fails the call (`Error::Style`).
    StyleLandmark,
}
#[derive(Debug)]
pub enum Error {
    Input(attempt::AttemptInputError),
    Definition,
    Style(style_runtime::Error),
    Leaf(&'static str),
    AttemptRefused(Refusal),
    Exhausted,
}
#[derive(Debug)]
pub struct AttemptReport {
    pub map: Option<GameMapData>,
    pub refusal: Option<Refusal>,
}
impl AttemptReport {
    fn refused(why: Refusal) -> Self {
        Self {
            map: None,
            refusal: Some(why),
        }
    }
}
/// Immutable derived contexts and parsed recipes are reused by every attempt. The fixed layout is caller-owned.
pub struct Pipeline<'f> {
    fixed: &'f FixedLayout,
    prefix: attempt::AttemptContext<'f>,
    landmarks: stage::StageContext<'f>,
    signature: signature::SignatureContext<'f>,
    spawns: spawns::SpawnContext<'f>,
    zones: zones::ZoneContext<'f>,
    recipes: recipes::Recipes<'static>,
    shared: stage::Definitions<'static>,
    limits: Definition,
    spots: spots::Definition,
    bushes: bushes::BushDefinition,
    tail: tail::Definition,
    terrain: terrain_gate::TerrainGateDefinition<'static>,
    records: records::Definition<'static>,
    terrain_on: Vec<Option<u8>>,
    styles: style_zones::Registry<'f>,
    /// Test seam (P-MAPGEN-STYLE-REFUSE-1): the styler pass of attempt `.0` returns `.1` instead of its own result.
    #[cfg(test)]
    style_fault: Option<(u64, style_runtime::Error)>,
}
impl<'f> Pipeline<'f> {
    /// Test seam (P-MAPGEN-STYLE-REFUSE-1): every attempt runs as usual, but the styler pass of attempt `attempt`
    /// returns `error` after it has run, as a styler returning that error would.
    #[cfg(test)]
    pub(crate) fn with_style_fault(mut self, attempt: u64, error: style_runtime::Error) -> Self {
        self.style_fault = Some((attempt, error));
        self
    }
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definition(fixed, &default_definition()).expect("default orchestration bounds")
    }
    pub fn from_definition(fixed: &'f FixedLayout, d: &Definition) -> Result<Self, Error> {
        if d.certified_attempts == 0
            || d.certified_attempts > d.generate_attempts
            || d.generate_attempts > 64
            || d.features_max > u16::MAX as usize
        {
            return Err(Error::Definition);
        }
        let shared = stage::Definitions::default();
        let terrain = terrain_gate::default_definition();
        // P-MAPGEN-SIG-RESERVE-1: one signature definition for the Prefix's site reservation and the Landmarks phase.
        let sites = signature::DEFAULT_DEFINITION;
        Ok(Self {
            fixed,
            prefix: attempt::AttemptContext::from_definitions(
                fixed,
                &attempt::default_definition(),
                &shared.zones,
                &shared.camps,
            )
            .with_signature(&sites),
            landmarks: stage::StageContext::from_definitions(fixed, &shared),
            signature: signature::SignatureContext::from_definition(fixed, &sites),
            spawns: spawns::SpawnContext::from_definitions(
                fixed,
                &shared.spawns,
                &shared.fixed,
                &shared.zones,
                &shared.camps,
            ),
            zones: zones::ZoneContext::from_definition(fixed, &shared.zones),
            recipes: recipes::Recipes::default(),
            shared,
            limits: *d,
            spots: spots::default_definition(),
            bushes: bushes::default_definition(),
            tail: tail::default_definition(),
            terrain,
            records: records::default_definition(),
            terrain_on: terrain.kinds.iter().map(|k| k.tile).collect(),
            styles: style_zones::Registry::new(fixed).map_err(Error::Style)?,
            #[cfg(test)]
            style_fault: None,
        })
    }
    pub fn plain_attempt(
        &self,
        seed: i64,
        number: u64,
        options: Options,
    ) -> Result<Option<GameMapData>, Error> {
        Ok(self
            .build_attempt(seed, number, options, false, &mut |_, _, _| {})?
            .map)
    }
    pub fn plain_attempt_with_trace(
        &self,
        seed: i64,
        number: u64,
        options: Options,
    ) -> Result<(AttemptReport, Vec<Trace>), Error> {
        let mut trace = Vec::new();
        let report =
            self.build_attempt(seed, number, options, false, &mut |phase, rng, pool| {
                let mut next = rng.clone();
                trace.push(Trace {
                    phase,
                    continuation: core::array::from_fn(|_| next.next_u32()),
                    pool: pool.to_vec(),
                });
            })?;
        Ok((report, trace))
    }
    pub fn certified_plain(
        &self,
        seed: i64,
        options: Options,
    ) -> Result<Option<GameMapData>, Error> {
        self.first_plain(seed, self.limits.certified_attempts, options)
    }
    pub fn generate_plain(
        &self,
        seed: i64,
        number: Option<u64>,
        options: Options,
    ) -> Result<GameMapData, Error> {
        if let Some(n) = number {
            let report = self.build_attempt(seed, n, options, false, &mut |_, _, _| {})?;
            return report
                .map
                .ok_or_else(|| Error::AttemptRefused(report.refusal.expect("refused attempt")));
        }
        self.first_plain(seed, self.limits.generate_attempts, options)?
            .ok_or(Error::Exhausted)
    }
    /// Complete source styling; the main map stream is shared with the plain orchestrator.
    pub fn styled_attempt(
        &self,
        seed: i64,
        number: u64,
        options: Options,
    ) -> Result<Option<GameMapData>, Error> {
        Ok(self
            .build_attempt(seed, number, options, true, &mut |_, _, _| {})?
            .map)
    }
    pub fn styled_attempt_with_trace(
        &self,
        seed: i64,
        number: u64,
        options: Options,
    ) -> Result<(AttemptReport, Vec<Trace>), Error> {
        let mut trace = Vec::new();
        let report = self.build_attempt(seed, number, options, true, &mut |phase, rng, pool| {
            let mut next = rng.clone();
            trace.push(Trace {
                phase,
                continuation: core::array::from_fn(|_| next.next_u32()),
                pool: pool.to_vec(),
            });
        })?;
        Ok((report, trace))
    }
    pub fn certified_styled(
        &self,
        seed: i64,
        options: Options,
    ) -> Result<Option<GameMapData>, Error> {
        first_attempt(self.limits.certified_attempts, |n| {
            self.styled_attempt(seed, n, options)
        })
    }
    pub fn generate_styled(
        &self,
        seed: i64,
        number: Option<u64>,
        options: Options,
    ) -> Result<GameMapData, Error> {
        if let Some(n) = number {
            let report = self.build_attempt(seed, n, options, true, &mut |_, _, _| {})?;
            return report
                .map
                .ok_or_else(|| Error::AttemptRefused(report.refusal.expect("refused attempt")));
        }
        first_attempt(self.limits.generate_attempts, |n| {
            self.styled_attempt(seed, n, options)
        })?
        .ok_or(Error::Exhausted)
    }
    fn first_plain(
        &self,
        seed: i64,
        limit: u64,
        options: Options,
    ) -> Result<Option<GameMapData>, Error> {
        first_attempt(limit, |n| self.plain_attempt(seed, n, options))
    }
    // One orchestrator owns both modes, including the same main RNG, original pool masks and tail.
    fn build_attempt(
        &self,
        seed: i64,
        number: u64,
        options: Options,
        styled: bool,
        observe: &mut impl FnMut(Phase, &Mulberry32, &[usize]),
    ) -> Result<AttemptReport, Error> {
        // P-MAPGEN-SIG-RESERVE-1: with the signature option on a styled attempt, the Prefix reserves each styled zone's
        // landmark site before its camps; otherwise this is exactly `begin_attempt`.
        let Some(mut frame) = attempt::begin_attempt_signature(
            &self.prefix,
            seed,
            number,
            options.signature && styled,
        )
        .map_err(Error::Input)?
        else {
            return Ok(AttemptReport::refused(Refusal::Prefix));
        };
        observe(Phase::Prefix, &frame.rng, &[]);
        let Some(mut landmark) = self
            .landmarks
            .apply(&frame, &self.recipes)
            .map_err(Error::Input)?
        else {
            return Ok(AttemptReport::refused(Refusal::Landmarks));
        };
        // G1/G2: the signature landmarks join the Landmarks phase before spawns and stylers; own stream only (G6).
        let placed = if options.signature && styled {
            // The sites were reserved with the definition this phase builds with (`AttemptContext::with_signature`).
            assert_eq!(
                self.prefix.signature_definition(),
                self.signature.definition(),
                "the Prefix and the Landmarks phase read one signature definition"
            );
            match self
                .signature
                .apply(&frame, &mut landmark)
                .map_err(Error::Input)?
            {
                Some(p) => Some(p),
                None => return Ok(AttemptReport::refused(Refusal::Signature)),
            }
        } else {
            None
        };
        observe(Phase::Landmarks, &frame.rng, &[]);
        let prefix = &frame.state;
        let mut camps = prefix.layout.camps.clone();
        let order: Vec<Zone> = prefix
            .order
            .iter()
            .map(|f| match f {
                crate::content::FactionId::Fire => Zone::Fire,
                crate::content::FactionId::Sentenced => Zone::Sentenced,
                crate::content::FactionId::Plague => Zone::Plague,
                crate::content::FactionId::Frost => Zone::Frost,
                crate::content::FactionId::Holy => Zone::Holy,
            })
            .collect();
        let mut state = repair::State {
            tiles: landmark.state.tiles,
            terrain: placed
                .as_ref()
                .map_or_else(|| vec![0; W * H], |p| p.terrain.clone()),
            zone: prefix.partition.zone.clone(),
            territory_grid: prefix.layout.territory_grid.clone(),
            region_grid: vec![0; W * H],
            feature_owner: landmark.state.feature_owner,
            features: landmark.state.features,
        };
        // P-MAPGEN-SIG-SCALE-1: a reserved site with an inside camp is that camp's territory before the stylers and
        // repair read the grid. Option-on attempts only (`placed`); no draw.
        if placed.is_some() {
            crate::mapgen::landmarks::signature::relabel_sites(
                &prefix.reserved,
                &prefix.layout.camps,
                &mut state.territory_grid,
            );
        }
        let picked = spawns::prepare_and_pick(
            &self.spawns,
            &spawns::PoolInput {
                tiles: &state.tiles,
                zone: &state.zone,
                landmark_near1: &landmark.masks.near1,
                camps: &camps,
            },
            &mut || frame.rng.next_f64(),
        );
        let Some(picked) = picked else {
            return Ok(AttemptReport::refused(Refusal::SpawnPool));
        };
        let pool = picked.pool;
        observe(Phase::Spawns, &frame.rng, &pool);
        let protect = self.spawns.style_protect(
            &camps,
            &landmark.masks.near1,
            &state.feature_owner,
            &picked.protection.halo,
        );
        // Stage six: callbacks use private map streams; the attempt's main stream is untouched.
        let mut props: Vec<MapProp> = Vec::new();
        if styled {
            let before = state.tiles.clone();
            let mut style = style_runtime::State::new(
                W,
                H,
                core::mem::take(&mut state.tiles),
                core::mem::take(&mut state.terrain),
                props,
                core::mem::take(&mut state.features),
                core::mem::take(&mut state.feature_owner),
            )
            .map_err(Error::Style)?;
            let members: Vec<i32> = pool.iter().map(|&t| t as i32).collect();
            let result = self.styles.apply(
                &style_zones::Input {
                    w: W,
                    h: H,
                    seed,
                    attempt: number,
                    order: &order,
                    zone: &state.zone,
                    territory: Some(&state.territory_grid),
                    camps: &prefix.style_camps,
                    protect: &protect,
                    spawns: &members,
                    centre_walk: Some(&picked.preparation.centre_walk),
                    decor: options.decor,
                    no_block: None,
                    no_prop: None,
                    caps: None,
                },
                &mut style,
            );
            #[cfg(test)]
            let result = match self.style_fault {
                Some((n, e)) if n == number => Err(e),
                _ => result,
            };
            let layers = style.into_layers();
            state.tiles = layers.tiles;
            state.terrain = layers.terrain;
            state.features = layers.features;
            state.feature_owner = layers.feature_owner;
            props = layers.props;
            // A styler that cannot build round a signature landmark refuses the attempt (no later draw on this
            // attempt; the next re-seeds); any other styler error is a fault and fails the call.
            match result {
                Ok(_) => {}
                Err(style_runtime::Error::Landmark) => {
                    return Ok(AttemptReport::refused(Refusal::StyleLandmark));
                }
                Err(e) => return Err(Error::Style(e)),
            }
            if !options.decor {
                props.clear();
            }
            // The source observes this lap before refusing a breach and before T8 (which uses no RNG).
            observe(Phase::Styler, &frame.rng, &pool);
            if let Some(breach) = style_contract::check(
                &style_contract::Input {
                    before: &before,
                    tiles: &state.tiles,
                    terrain: &state.terrain,
                    zone: &state.zone,
                    protect: &protect,
                    order: &order,
                    features: &state.features,
                    feature_owner: &state.feature_owner,
                    gates: options.shape_gates,
                },
                &self.terrain,
            )? {
                return Ok(AttemptReport::refused(Refusal::StyleBreach(breach)));
            }
            style_contract::clear_pool_hazards(
                &mut state.terrain,
                &picked.protection.pool5,
                &self.terrain,
            )?;
        }
        let empty = vec![Vec::new(); zones::ZONES];
        let input = repair::Input {
            styled,
            order: &order,
            camps: &camps,
            clearing: &prefix.clearing,
            pool: &pool,
            protect: &protect,
            landmark_box: &landmark.masks.boxes,
            crates_by_zone: &empty,
            buildings: &landmark.buildings,
        };
        let rd = repair::default_definition(&terrain_gate::GENERATOR_TILE_CLASSES);
        let nets = match repair::safety_nets(&rd, self.fixed, &mut state, &input)
            .map_err(|_| Error::Leaf("safety nets admission"))?
        {
            Ok(v) => v,
            Err(r) => return Ok(AttemptReport::refused(Refusal::Repair(r))),
        };
        observe(Phase::Nets, &frame.rng, &pool);
        spots::camp_spots(
            &self.zones,
            &mut camps,
            &mut || frame.rng.next_f64(),
            &self.spots,
        )
        .map_err(|_| Error::Leaf("camp spots admission"))?;
        let crates = spots::weapon_crates(
            spots::CrateInput {
                fixed: self.fixed,
                tiles: &state.tiles,
                terrain: &state.terrain,
                zone: &state.zone,
                feature_owner: &state.feature_owner,
                features: &state.features,
                pool: &pool,
                camps: &camps,
                styled,
            },
            &mut || frame.rng.next_f64(),
            &self.spots,
        )
        .map_err(|_| Error::Leaf("crates admission"))?;
        if crates.refusal.is_some() {
            return Ok(AttemptReport::refused(Refusal::Crates));
        }
        let crates_by_zone: Vec<_> = crates.zones.into_iter().map(|z| z.chosen).collect();
        let all_crates: Vec<_> = crates_by_zone.iter().flatten().copied().collect();
        observe(Phase::Crates, &frame.rng, &pool);
        let input = repair::Input {
            styled,
            order: &order,
            camps: &camps,
            clearing: &prefix.clearing,
            pool: &pool,
            protect: &protect,
            landmark_box: &landmark.masks.boxes,
            crates_by_zone: &crates_by_zone,
            buildings: &landmark.buildings,
        };
        let post = match repair::post_repair(
            &rd,
            &repair::SharedDefinitions {
                zones: &self.shared.zones,
                camps: &self.shared.camps,
                spawns: &self.shared.spawns,
            },
            self.fixed,
            &mut state,
            &input,
            &nets,
        )
        .map_err(|_| Error::Leaf("post repair admission"))?
        {
            Ok(v) => v,
            Err(r) => return Ok(AttemptReport::refused(Refusal::Repair(r))),
        };
        observe(Phase::Post, &frame.rng, &pool);
        tail::clear_terrain(
            &self.terrain,
            styled,
            &state.tiles,
            &mut state.terrain,
            &mut props,
        )
        .map_err(|_| Error::Leaf("terrain cleanup admission"))?;
        observe(Phase::Terrain, &frame.rng, &pool);
        let ground = spots::ground_spots(
            spots::GroundInput {
                fixed: self.fixed,
                tiles: &state.tiles,
                terrain: &state.terrain,
                terrain_on: &self.terrain_on,
                landmark_box: &landmark.masks.boxes,
                clearing: &prefix.clearing,
                crates: &all_crates,
                pool: &pool,
            },
            &mut || frame.rng.next_f64(),
            &self.spots,
        )
        .map_err(|_| Error::Leaf("ground admission"))?;
        if ground.refusal.is_some() {
            return Ok(AttemptReport::refused(Refusal::Ground));
        }
        let ground_spots: Vec<_> = ground.chosen.into_iter().map(world).collect();
        observe(Phase::Ground, &frame.rng, &pool);
        let avoid =
            tail::clear_loot_decor(&self.tail, &pool, &all_crates, &ground_spots, &mut props)
                .map_err(|_| Error::Leaf("loot decor admission"))?;
        if options.bushes {
            bushes::place_elite_bushes(
                &self.bushes,
                &bushes::BushInput {
                    w: W,
                    h: H,
                    seed,
                    attempt: number,
                    tiles: &state.tiles,
                    terrain: &state.terrain,
                    zone: &state.zone,
                    territory_grid: &state.territory_grid,
                    protect: &protect,
                    pool5: &picked.protection.pool5,
                    avoid: Some(&avoid),
                    camps: &camps,
                    order: &order,
                    terrain_none: 0,
                },
                &mut state.features,
                &mut state.feature_owner,
            );
        }
        observe(Phase::Bushes, &frame.rng, &pool);
        let gate = spawn_gate(
            &state.tiles,
            &state.terrain,
            &state.zone,
            &pool,
            &self.shared.spawns,
            &self.terrain,
        )?;
        let kept = match gate {
            Ok(v) => v,
            Err(r) => return Ok(AttemptReport::refused(r)),
        };
        observe(Phase::SpawnGate, &frame.rng, &kept);
        if state.features.len() > self.limits.features_max {
            return Ok(AttemptReport::refused(Refusal::Features));
        }
        let record_buildings: Vec<crate::mapdata::TileRect> = landmark
            .buildings
            .iter()
            .map(|b| {
                Ok(crate::mapdata::TileRect {
                    x: b.x,
                    y: b.y,
                    w: u32::try_from(b.w).map_err(|_| Error::Leaf("building width"))?,
                    h: u32::try_from(b.h).map_err(|_| Error::Leaf("building height"))?,
                })
            })
            .collect::<Result<_, Error>>()?;
        let mut map = records::finalize(
            &self.records,
            &self.shared.zones,
            self.fixed,
            &records::Input {
                seed,
                attempt: number,
                tiles: &state.tiles,
                terrain: &state.terrain,
                props: &props,
                region_grid: &state.region_grid,
                zone: &state.zone,
                order: &order,
                camps: &camps,
                reach2: &post.reach2,
                pool: &kept,
                crates_by_zone: &crates_by_zone,
                landmark_box: &landmark.masks.boxes,
                buildings: &record_buildings,
                ground_spots: &ground_spots,
                drafts: &state.features,
                feature_owner: &state.feature_owner,
            },
            &mut state.territory_grid,
        )
        .map_err(|_| Error::Leaf("records admission"))?;
        let placed_any = placed.is_some();
        if let Some(p) = placed {
            self.signature.finish(&mut map, p.anchors);
        }
        observe(Phase::Records, &frame.rng, &kept);
        if options.shape_gates {
            if let Some(r) =
                tail::shape_gate(&self.tail, &map.tiles, &map.feature_grid, &state.zone)
                    .map_err(|_| Error::Leaf("shape admission"))?
            {
                return Ok(AttemptReport::refused(Refusal::Shape(
                    r.source_reason().into(),
                )));
            }
        }
        if !terrain_gate::validate(
            &map,
            &terrain_gate::Options {
                styled,
                prop_kinds: None,
            },
        )
        .map_err(|_| Error::Leaf("terrain gate admission"))?
        .is_empty()
        {
            return Ok(AttemptReport::refused(Refusal::Terrain));
        }
        // G5: a signature map is kept only whole and certified clean; otherwise the next attempt is tried.
        if placed_any && (!self.signature.intact(&map) || !certifies(&map)) {
            return Ok(AttemptReport::refused(Refusal::SignatureDiscarded));
        }
        observe(Phase::Gates, &frame.rng, &kept);
        Ok(AttemptReport {
            map: Some(map),
            refusal: None,
        })
    }
}
fn world(t: usize) -> WorldPt {
    WorldPt {
        x: (t % W) as f64 * TILE + TILE / 2.0,
        y: (t / W) as f64 * TILE + TILE / 2.0,
    }
}
/// Zero failures under the strictest certification (every zone strict).
fn certifies(map: &GameMapData) -> bool {
    super::certify::certify(
        map,
        &super::certify::Options {
            styled: true,
            zone: true,
            strict: super::certify::Strict::All,
        },
    )
    .is_ok_and(|c| c.failures.is_empty())
}
fn first_attempt<T, E>(
    limit: u64,
    mut attempt: impl FnMut(u64) -> Result<Option<T>, E>,
) -> Result<Option<T>, E> {
    for n in 0..limit {
        if let Some(map) = attempt(n)? {
            return Ok(Some(map));
        }
    }
    Ok(None)
}
fn spawn_gate(
    tiles: &[u8],
    terrain: &[u8],
    zone: &[u8],
    pool: &[usize],
    d: &spawns::SpawnDefinition,
    kinds: &terrain_gate::TerrainGateDefinition<'_>,
) -> Result<Result<Vec<usize>, Refusal>, Error> {
    let view =
        TileMap::new(W as u32, H as u32, tiles.to_vec()).map_err(|_| Error::Leaf("spawn view"))?;
    let centre = Vec2 {
        x: f64::from(CX) * TILE + TILE / 2.0,
        y: f64::from(CY) * TILE + TILE / 2.0,
    };
    let mut pf = Pathfinder::default();
    let mut walks = Vec::new();
    let mut hazards = Vec::new();
    for &t in pool {
        let w = world(t);
        let from = Vec2 { x: w.x, y: w.y };
        let path = pf.find_path(&view, from, centre, PLAYER_RADIUS);
        if path.is_empty() {
            return Ok(Err(Refusal::SpawnWalk));
        }
        let mut prior = from;
        let mut length = 0.0;
        let mut seen = vec![false; W * H];
        let mut hz = 0;
        let mut a = t;
        for p in path {
            let dx = p.x - prior.x;
            let dy = p.y - prior.y;
            length += (dx * dx + dy * dy).sqrt();
            let b = (p.y / TILE).floor() as usize * W + (p.x / TILE).floor() as usize;
            spawns::walk_segment(
                (a % W) as i32,
                (a / W) as i32,
                (b % W) as i32,
                (b / W) as i32,
                |x, y| {
                    let i = y as usize * W + x as usize;
                    if !seen[i] {
                        seen[i] = true;
                        if matches!(
                            kinds.kinds[terrain[i] as usize].key,
                            "ember" | "bog" | "ice"
                        ) {
                            hz += 1;
                        }
                    }
                    false
                },
            );
            a = b;
            prior = p;
        }
        walks.push(length);
        hazards.push(hz);
    }
    Ok(
        spawns::gate_spawn_walks(d, pool, &walks, &hazards, |t| zone[t])
            .map(|indices| indices.into_iter().map(|i| pool[i]).collect())
            .ok_or(Refusal::SpawnRatio),
    )
}
#[cfg(test)]
mod style_refusal_tests;
#[cfg(test)]
mod tests;
