//! Exact five-faction stage-six driver. Full map generation, hook contracts and certification stay outside.
use crate::mapdata::Zone;
use crate::mapgen::landmarks::signature::frame::LandmarkFrame;
use crate::mapgen::{
    attempt::{validate_input, StyleCamp},
    coliseum::{FixedDefinition, FixedLayout},
    landmarks::{
        recipe_support,
        recipes::{direct_family, search_family},
    },
    style_features, style_gallows, style_rime,
    style_runtime::{self, Error, Geometry, Inputs, Metadata, State},
    style_sanctum, style_scorch, style_warren, terrain_gate,
};
/// Only the four source StyleOptions.caps overrides. Other runtime defaults keep their existing owner.
#[derive(Clone, Copy, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Caps {
    #[serde(default, deserialize_with = "present")]
    pub join_checks: Option<u32>,
    #[serde(default, deserialize_with = "present", rename = "footprintPct")]
    pub footprint_percent: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    pub rim_tiles: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    pub fence_detour: Option<u16>,
}
fn present<'de, D: serde::Deserializer<'de>, T: serde::Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
/// Immutable attempt/zone inputs. Durable mutable layers are owned by the one shared State.
pub struct Input<'a> {
    pub w: usize,
    pub h: usize,
    pub seed: i64,
    pub attempt: u64,
    pub order: &'a [Zone],
    pub zone: &'a [u8],
    pub territory: Option<&'a [u8]>,
    pub camps: &'a [StyleCamp],
    pub protect: &'a [u8],
    pub spawns: &'a [i32],
    pub centre_walk: Option<&'a [i32]>,
    pub decor: bool,
    pub no_block: Option<&'a [u8]>,
    pub no_prop: Option<&'a [u8]>,
    pub caps: Option<&'a Caps>,
    /// P-MAPGEN-LANDMARK-FRAME-1: the signature landmarks the Landmarks phase placed (`Placed::frames`, one per zone it
    /// built); `None` with the option off. Each zone's styler sees its own frame as `BaseContext::landmark`.
    pub landmarks: Option<&'a [LandmarkFrame]>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Entry {
    pub faction: Zone,
    pub id: &'static str,
    pub version: u32,
    pub surface: bool,
    pub props: bool,
}
pub const ENTRIES: [Entry; 5] = [
    Entry {
        faction: Zone::Fire,
        id: "scorch",
        version: 400,
        surface: true,
        props: true,
    },
    Entry {
        faction: Zone::Sentenced,
        id: "gallows",
        version: 400,
        surface: false,
        props: true,
    },
    Entry {
        faction: Zone::Plague,
        id: "warren",
        version: 400,
        surface: true,
        props: true,
    },
    Entry {
        faction: Zone::Frost,
        id: "rime",
        version: 400,
        surface: true,
        props: true,
    },
    Entry {
        faction: Zone::Holy,
        id: "sanctum",
        version: 400,
        surface: true,
        props: true,
    },
];
pub fn entry(faction: Zone) -> &'static Entry {
    ENTRIES
        .iter()
        .find(|e| e.faction == faction)
        .expect("complete registry")
}
/// Registry identity only; leaf/default tuning is folded by its existing definition owner.
pub fn visit_entries(entries: &[Entry], mut word: impl FnMut(u64)) {
    word(entries.len() as u64);
    for e in entries {
        word(e.faction.code().into());
        word(e.id.len() as u64);
        for b in e.id.bytes() {
            word(b.into())
        }
        word(e.version.into());
        word(u64::from(e.surface));
        word(u64::from(e.props));
    }
}
pub fn visit_content(word: impl FnMut(u64)) {
    visit_entries(&ENTRIES, word)
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum Plan {
    Fire(style_scorch::Plan),
    Sentenced(style_gallows::Plan),
    Plague(style_warren::Plan),
    Frost(style_rime::Plan),
    Holy(style_sanctum::Plan),
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub index: usize,
    pub faction: Zone,
    pub blocked: i64,
    pub walls: i64,
    pub low: i64,
    pub kept: u32,
    pub refused: u64,
    pub join_checks: u32,
    pub surfaced: u64,
    pub props: u64,
    pub repaired: usize,
    pub features: u64,
    pub plan: Option<Plan>,
}
impl Report {
    fn empty(index: usize, faction: Zone) -> Self {
        Self {
            index,
            faction,
            blocked: 0,
            walls: 0,
            low: 0,
            kept: 0,
            refused: 0,
            join_checks: 0,
            surfaced: 0,
            props: 0,
            repaired: 0,
            features: 0,
            plan: None,
        }
    }
}
/// Default definitions are owned once. Only immutable fixed geometry is borrowed from the caller.
pub struct Registry<'f> {
    fixed: &'f FixedLayout,
    fixed_rules: FixedDefinition<'static>,
    runtime: style_runtime::Definition,
    catalog: terrain_gate::TerrainGateDefinition<'static>,
    scale: recipe_support::RecipeSupportDefinition,
    kit: style_features::Definition,
    fire: style_scorch::Definition,
    forge: search_family::scorch::Definition<'static>,
    sentenced: style_gallows::Definition<'static>,
    dials: style_gallows::Dials,
    house: search_family::gallows::Definition<'static>,
    plague: style_warren::Definition<'static>,
    burrow: direct_family::warren::Definition<'static>,
    frost: style_rime::Definition,
    frost_shared: direct_family::rime::Definition<'static>,
    holy: style_sanctum::Definition,
    hall: direct_family::sanctum::Definition<'static>,
}
struct Bundle<'a> {
    fire: style_scorch::Callbacks<'a>,
    sentenced: style_gallows::Callbacks<'a>,
    plague: style_warren::Callbacks<'a>,
    frost: style_rime::Callbacks<'a>,
    holy: style_sanctum::Callbacks<'a>,
}
impl<'f> Registry<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Result<Self, Error> {
        let out = Self {
            fixed,
            fixed_rules: crate::mapgen::coliseum::default_definition(),
            runtime: style_runtime::default_definition(),
            catalog: terrain_gate::default_definition(),
            scale: recipe_support::default_definition(),
            kit: style_features::default_definition(),
            fire: style_scorch::default_definition(),
            forge: search_family::scorch::default_definition(),
            sentenced: style_gallows::default_definition(),
            dials: style_gallows::default_dials(),
            house: search_family::gallows::default_definition(),
            plague: style_warren::default_definition(),
            burrow: direct_family::warren::default_definition(),
            frost: style_rime::default_definition(),
            frost_shared: direct_family::rime::default_definition(),
            holy: style_sanctum::default_definition(),
            hall: direct_family::sanctum::default_definition(),
        };
        out.bundle()?;
        Ok(out)
    }
    fn bundle(&self) -> Result<Bundle<'_>, Error> {
        Ok(Bundle {
            fire: style_scorch::Callbacks::new(
                &self.fire,
                &self.forge,
                &self.scale,
                &self.kit,
                self.fixed,
                &self.fixed_rules,
                &self.catalog,
            )?,
            sentenced: style_gallows::Callbacks::new(
                &self.sentenced,
                &self.dials,
                &self.house,
                self.catalog.props,
            )?,
            plague: style_warren::Callbacks::new(
                &self.plague,
                &self.scale,
                self.fixed,
                &self.fixed_rules,
                &self.burrow,
                self.catalog.props,
            )?,
            frost: style_rime::Callbacks::new(
                &self.frost,
                &self.frost_shared,
                self.fixed,
                &self.fixed_rules,
                self.catalog.props,
                self.catalog.kinds,
            )?,
            holy: style_sanctum::Callbacks::new(
                &self.holy,
                &self.hall,
                &self.scale,
                self.catalog.props,
            )?,
        })
    }
    pub fn apply(&self, input: &Input<'_>, state: &mut State) -> Result<Vec<Report>, Error> {
        self.apply_inner(input, state, |_| {})
    }
    #[cfg(test)]
    pub(crate) fn apply_observed(
        &self,
        input: &Input<'_>,
        state: &mut State,
        observe: impl FnMut(Observation<'_, '_>),
    ) -> Result<Vec<Report>, Error> {
        self.apply_inner(input, state, observe)
    }
    fn apply_inner(
        &self,
        input: &Input<'_>,
        state: &mut State,
        mut observe: impl FnMut(Observation<'_, '_>),
    ) -> Result<Vec<Report>, Error> {
        let (w, h) = (input.w, input.h);
        let n = w.checked_mul(h).ok_or(Error::Dimensions)?;
        if w != state.w() || h != state.h() || w == 0 || h == 0 {
            return Err(Error::Dimensions);
        }
        if input.zone.len() != n
            || input.protect.len() != n
            || [input.territory, input.no_block, input.no_prop]
                .into_iter()
                .flatten()
                .any(|a| a.len() != n)
            || input.centre_walk.is_some_and(|a| a.len() != n)
            || input.order.len() > u8::MAX as usize
            || input.camps.iter().any(|c| c.site >= n || !c.r.is_finite())
            || state
                .terrain()
                .iter()
                .any(|&t| usize::from(t) >= self.catalog.kinds.len())
        {
            return Err(Error::Layer);
        }
        validate_input(input.seed, input.attempt).map_err(|_| Error::Metadata)?;
        if input.centre_walk.is_some_and(|a| {
            a.iter()
                .any(|&v| v < -1 || i64::from(v) + 11 * n as i64 >= 1 << 30)
        }) {
            return Err(Error::Route);
        }
        let mut rules = self.runtime;
        if let Some(caps) = input.caps {
            if let Some(v) = caps.join_checks {
                rules.join_checks = v
            }
            if let Some(v) = caps.footprint_percent {
                rules.footprint_percent = v
            }
            if let Some(v) = caps.rim_tiles {
                rules.rim_tiles = v
            }
            if let Some(v) = caps.fence_detour {
                rules.fence_detour = v
            }
        }
        rules.validate()?;
        let bundle = self.bundle()?;
        let no_block = style_runtime::no_block(input.protect, input.no_block)?;
        let no_prop = input.no_prop.unwrap_or(input.protect);
        // Reuse leaf input admission before resetting scratch or running any earlier zone.
        for (index, &faction) in input.order.iter().enumerate() {
            if !input.zone.contains(&((index + 1) as u8)) {
                continue;
            }
            let features = state.features().iter().filter(|f| f.zone == faction);
            match faction {
                Zone::Fire => bundle.fire.admit_inputs(w, h, features)?,
                Zone::Frost => bundle.frost.admit_inputs(w, h, features)?,
                _ => {}
            }
        }
        state.reset_pass();
        let mut components = None;
        let mut out = Vec::with_capacity(input.order.len());
        for (index, &faction) in input.order.iter().enumerate() {
            let z = u8::try_from(index + 1).map_err(|_| Error::Metadata)?;
            let geometry = Geometry::new(z, faction, input.zone, state.tiles(), w, h, input.camps)?;
            observe(Observation::Geometry {
                index: index + 1,
                geometry: &geometry,
            });
            if geometry.info.painted == 0 {
                out.push(Report::empty(index + 1, faction));
                continue;
            }
            let spawns: Vec<_> = input
                .spawns
                .iter()
                .copied()
                .filter(|&i| {
                    usize::try_from(i)
                        .ok()
                        .is_some_and(|i| i < n && geometry.mask[i] == 1)
                })
                .collect();
            let mut rt = style_runtime::Runtime::new(
                state,
                Inputs {
                    geometry: &geometry,
                    hard: input.protect,
                    no_block: &no_block,
                    no_prop,
                    territory: input.territory,
                    spawns: &spawns,
                    centre_walk: input.centre_walk,
                    seed: input.seed,
                    attempt: input.attempt,
                    // Stub (P-MAPGEN-LANDMARK-FRAME-1): the implementer passes this zone's frame from `input.landmarks`.
                    landmark: None,
                },
                Metadata {
                    terrain: self.catalog.kinds,
                    props: self.catalog.props,
                    tile_size: crate::constants::TILE,
                },
                &rules,
            )?;
            let before = if let Some(value) = components {
                value
            } else {
                style_runtime::floor_components(rt.state().tiles(), w, h)?
                    .1
                    .len()
            };
            observe(Observation::Start {
                index: index + 1,
                runtime: &rt,
            });
            let (mut plan, shape_streams) = {
                let mut context = rt.shape_context();
                if input.centre_walk.is_some() && !spawns.is_empty() {
                    context.route_guard();
                }
                let plan = match faction {
                    Zone::Fire => Plan::Fire(bundle.fire.shape(&mut context)?),
                    Zone::Sentenced => Plan::Sentenced(bundle.sentenced.shape(&mut context)?),
                    Zone::Plague => Plan::Plague(bundle.plague.shape(&mut context)?),
                    Zone::Frost => Plan::Frost(bundle.frost.shape(&mut context)?),
                    Zone::Holy => Plan::Holy(bundle.holy.shape(&mut context)?),
                };
                (plan, context.streams)
            };
            let (count, repaired) = rt.finish_shape(before);
            components = Some(count);
            observe(Observation::Phase {
                index: index + 1,
                phase: style_runtime::Phase::Shape,
                runtime: &rt,
                plan: &plan,
                streams: &shape_streams,
            });
            let registry = entry(faction);
            if registry.surface {
                let mut context = rt.surface_context();
                match &mut plan {
                    Plan::Fire(p) => bundle.fire.surface(&mut context, p)?,
                    Plan::Plague(p) => bundle.plague.surface(&mut context, p)?,
                    Plan::Frost(p) => bundle.frost.surface(&mut context, p)?,
                    Plan::Holy(p) => bundle.holy.surface(&mut context, p)?,
                    Plan::Sentenced(_) => return Err(Error::Metadata),
                }
                let streams = context.streams;
                observe(Observation::Phase {
                    index: index + 1,
                    phase: style_runtime::Phase::Surface,
                    runtime: &rt,
                    plan: &plan,
                    streams: &streams,
                });
            }
            if input.decor && registry.props {
                let mut context = rt.prop_context();
                match &plan {
                    Plan::Fire(p) => bundle.fire.props(&mut context, p)?,
                    Plan::Sentenced(p) => bundle.sentenced.props(&mut context, p)?,
                    Plan::Plague(p) => bundle.plague.props(&mut context, p)?,
                    Plan::Frost(p) => bundle.frost.props(&mut context, p)?,
                    Plan::Holy(p) => bundle.holy.props(&mut context, p)?,
                }
                let streams = context.streams;
                observe(Observation::Phase {
                    index: index + 1,
                    phase: style_runtime::Phase::Decor,
                    runtime: &rt,
                    plan: &plan,
                    streams: &streams,
                });
            }
            observe(Observation::Done {
                index: index + 1,
                runtime: &rt,
            });
            let c = rt.counters();
            out.push(Report {
                index: index + 1,
                faction,
                blocked: c.walls + c.lows,
                walls: c.walls,
                low: c.lows,
                kept: 0,
                refused: c.refused,
                join_checks: c.join_used,
                surfaced: c.surfaced,
                props: c.props_added,
                repaired,
                features: c.features_added,
                plan: Some(plan),
            });
        }
        Ok(out)
    }
}
#[cfg(test)]
mod tests;

/// Immutable proof events; production supplies a no-op and never exposes mutable state or decisions.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum Observation<'a, 'r> {
    Geometry {
        index: usize,
        geometry: &'a Geometry,
    },
    Start {
        index: usize,
        runtime: &'a style_runtime::Runtime<'r>,
    },
    Phase {
        index: usize,
        phase: style_runtime::Phase,
        runtime: &'a style_runtime::Runtime<'r>,
        plan: &'a Plan,
        streams: &'a style_runtime::Streams,
    },
    Done {
        index: usize,
        runtime: &'a style_runtime::Runtime<'r>,
    },
}
