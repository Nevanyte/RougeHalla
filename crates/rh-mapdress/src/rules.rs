//! The rule file (`rules/zones.json`): parsing and validation. Every refusal names the rule (or the kind) it is about.
//!
//! Units: distances (`inner`, `outer`, `radius`, `minSpacing`, `distance`, margins, widths, `moat`) are TILES. Densities
//! are props per 100 candidate tiles. `clearing` is a share in 0..=1.
//!
//! Order rules: a cluster's `moat` (default 2) keeps edge and filler props out of the disk of `radius + moat` tiles round
//! each of its sites, so a cluster reads as a grove with open ground round it. A filler rule's `minSpacing` (default 2)
//! keeps filler props that many tiles apart. Both are optional; files without them are still valid.
use rh_sim::mapdata::{FeatureKind, Zone};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Where a prop may stand. The class of a tile is `wall` (collision 1), `low` (collision 2), otherwise the name of its
/// floor terrain: `ember`, `bog`, `ice`, `light`, else `floor`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TileClass {
    Floor,
    Ember,
    Bog,
    Ice,
    Light,
    Low,
    Wall,
}

/// What an edge rule hugs. `Border` is a tile with a 4-neighbour in another `region_grid` value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Against {
    Wall,
    Low,
    Border,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KindDef {
    pub name: String,
    pub code: u8,
    pub tall: bool,
}

/// Keep-clear margins, in tiles.
#[derive(Clone, Debug, PartialEq)]
pub struct KeepClearRules {
    /// Around a camp: its clearing radius `r` plus this many tiles.
    pub camp_margin: u32,
    /// Around the coliseum rectangle and each gate tile.
    pub coliseum_margin: u32,
    /// Width of the tall-prop corridor from a camp to the nearest coliseum gate.
    pub corridor_width: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RingProp {
    pub kind: u8,
    pub density: f64,
}

/// A distance band `[inner, outer)` tiles from the zone's anchor.
#[derive(Clone, Debug, PartialEq)]
pub struct RingRule {
    pub name: String,
    pub inner: f64,
    pub outer: f64,
    pub ground_variant: u8,
    pub props: Vec<RingProp>,
    pub on: Vec<TileClass>,
}

/// P-DRESS-ANCHOR-1: the generator's distance bands (`signature::band`, G4), re-exported so rules and callers name one type.
pub use rh_sim::mapgen::landmarks::signature::Band;

/// A ring of the landmark path: every tile of the zone whose `signature::band` from the zone's anchor footprint is
/// `band` (instead of a distance range from a feature centre).
#[derive(Clone, Debug, PartialEq)]
pub struct BandRing {
    pub name: String,
    pub band: Band,
    pub ground_variant: u8,
    pub props: Vec<RingProp>,
    pub on: Vec<TileClass>,
}

/// The rings a zone lays round the generator's landmark (`GameMapData.anchors`); used for a zone only when the map has
/// an anchor for it. Otherwise the zone's `signature_feature` and `rings` (the fallback path) apply as before.
#[derive(Clone, Debug, PartialEq)]
pub struct LandmarkRules {
    /// The landmark's feature kind: `Volcano`, `Church`, `BogTree`, `Cave` or `Hall`. Must equal the anchor's `kind`.
    pub feature: FeatureKind,
    pub rings: Vec<BandRing>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClusterRule {
    pub name: String,
    pub kinds: Vec<u8>,
    /// Members lie within this many tiles of their site.
    pub radius: f64,
    /// Sites of this rule are at least this many tiles apart.
    pub min_spacing: f64,
    /// Share of the zone's free floor that lies farther than `radius` from every site of this rule.
    pub clearing: f64,
    /// Most sites per zone.
    pub sites: u32,
    /// Most members per site.
    pub members: u32,
    /// Open ground round the grove, in tiles: edge and filler props keep out of every tile whose centre is within
    /// `radius + moat` tiles of a site of this rule.
    pub moat: f64,
    pub on: Vec<TileClass>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EdgeRule {
    pub name: String,
    pub kinds: Vec<u8>,
    pub against: Vec<Against>,
    /// Chebyshev distance in tiles to an `against` tile.
    pub distance: u32,
    pub density: f64,
    pub on: Vec<TileClass>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FillerRule {
    pub name: String,
    pub kinds: Vec<u8>,
    pub density: f64,
    /// Filler props (of any filler rule) stand at least this many tiles apart, measured between tile centres.
    pub min_spacing: f64,
    pub on: Vec<TileClass>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ZoneRules {
    pub zone: Zone,
    /// The zone's signature feature kind; the largest such feature of the zone is the ring anchor.
    pub signature_feature: FeatureKind,
    pub rings: Vec<RingRule>,
    /// The landmark path (P-DRESS-ANCHOR-1); `None` for a file without `signature.landmark`.
    pub landmark: Option<LandmarkRules>,
    pub clusters: Vec<ClusterRule>,
    pub edges: Vec<EdgeRule>,
    pub fillers: Vec<FillerRule>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    pub kinds: Vec<KindDef>,
    pub keep_clear: KeepClearRules,
    /// In the order fire, sentenced, plague, frost, holy (those present in the file).
    pub zones: Vec<ZoneRules>,
}

impl Rules {
    /// The embedded starter file.
    pub fn starter() -> Rules {
        Rules::from_json(include_str!("../rules/zones.json"))
            .expect("embedded rules/zones.json is valid")
    }

    pub fn from_json(text: &str) -> Result<Rules, String> {
        let raw: Raw = serde_json::from_str(text).map_err(|e| format!("rule file: {e}"))?;
        raw.build()
    }

    pub fn kind_code(&self, name: &str) -> Option<u8> {
        self.kinds.iter().find(|k| k.name == name).map(|k| k.code)
    }
    pub fn kind_name(&self, code: u8) -> Option<&str> {
        self.kinds
            .iter()
            .find(|k| k.code == code)
            .map(|k| k.name.as_str())
    }
    pub fn is_tall(&self, code: u8) -> bool {
        self.kinds.iter().any(|k| k.code == code && k.tall)
    }
    pub fn zone(&self, zone: Zone) -> Option<&ZoneRules> {
        self.zones.iter().find(|z| z.zone == zone)
    }
    /// The tile classes a prop of `code` may stand on: the union over every rule that places it.
    pub fn allowed_classes(&self, code: u8) -> Vec<TileClass> {
        let mut out: Vec<TileClass> = Vec::new();
        let mut add = |on: &[TileClass]| {
            for c in on {
                if !out.contains(c) {
                    out.push(*c);
                }
            }
        };
        for z in &self.zones {
            for r in &z.rings {
                if r.props.iter().any(|p| p.kind == code) {
                    add(&r.on);
                }
            }
            for r in z.landmark.iter().flat_map(|l| l.rings.iter()) {
                if r.props.iter().any(|p| p.kind == code) {
                    add(&r.on);
                }
            }
            for r in &z.clusters {
                if r.kinds.contains(&code) {
                    add(&r.on);
                }
            }
            for r in &z.edges {
                if r.kinds.contains(&code) {
                    add(&r.on);
                }
            }
            for r in &z.fillers {
                if r.kinds.contains(&code) {
                    add(&r.on);
                }
            }
        }
        out
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Raw {
    #[allow(dead_code)]
    version: u32,
    kinds: BTreeMap<String, RawKind>,
    keep_clear: RawKeepClear,
    zones: BTreeMap<String, RawZone>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawKind {
    code: u8,
    #[serde(default)]
    tall: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawKeepClear {
    camp_margin: u32,
    coliseum_margin: u32,
    corridor_width: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawZone {
    signature: RawSignature,
    #[serde(default)]
    clusters: Vec<RawCluster>,
    #[serde(default)]
    edges: Vec<RawEdge>,
    #[serde(default)]
    filler: Vec<RawFiller>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSignature {
    feature: FeatureKind,
    rings: Vec<RawRing>,
    #[serde(default)]
    landmark: Option<RawLandmark>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLandmark {
    feature: FeatureKind,
    rings: Vec<RawBandRing>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawBandRing {
    name: String,
    band: String,
    #[serde(default)]
    ground_variant: u8,
    props: Vec<RawRingProp>,
    #[serde(default = "floor_only")]
    on: Vec<TileClass>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawRing {
    name: String,
    inner: f64,
    outer: f64,
    #[serde(default)]
    ground_variant: u8,
    props: Vec<RawRingProp>,
    #[serde(default = "floor_only")]
    on: Vec<TileClass>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRingProp {
    kind: String,
    density: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCluster {
    name: String,
    kinds: Vec<String>,
    radius: f64,
    min_spacing: f64,
    clearing: f64,
    sites: u32,
    members: u32,
    #[serde(default = "default_gap")]
    moat: f64,
    #[serde(default = "floor_only")]
    on: Vec<TileClass>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEdge {
    name: String,
    kinds: Vec<String>,
    against: Vec<Against>,
    distance: u32,
    density: f64,
    #[serde(default = "floor_only")]
    on: Vec<TileClass>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawFiller {
    name: String,
    kinds: Vec<String>,
    density: f64,
    #[serde(default = "default_gap")]
    min_spacing: f64,
    #[serde(default = "floor_only")]
    on: Vec<TileClass>,
}
fn default_gap() -> f64 {
    2.0
}
fn floor_only() -> Vec<TileClass> {
    vec![TileClass::Floor]
}

fn zone_of(name: &str) -> Option<Zone> {
    [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ]
    .into_iter()
    .find(|z| z.as_str() == name)
}

impl Raw {
    fn build(self) -> Result<Rules, String> {
        let mut kinds: Vec<KindDef> = Vec::new();
        for (name, k) in &self.kinds {
            if k.code == 0 {
                return Err(format!("kind \"{name}\": code 0 is reserved"));
            }
            if let Some(other) = kinds.iter().find(|o| o.code == k.code) {
                return Err(format!(
                    "kind \"{name}\": code {} is already used by \"{}\"",
                    k.code, other.name
                ));
            }
            kinds.push(KindDef {
                name: name.clone(),
                code: k.code,
                tall: k.tall,
            });
        }
        let code = |rule: &str, kind: &str| -> Result<u8, String> {
            kinds
                .iter()
                .find(|k| k.name == kind)
                .map(|k| k.code)
                .ok_or_else(|| format!("rule \"{rule}\": unknown kind \"{kind}\""))
        };
        let mut names: Vec<String> = Vec::new();
        let mut claim = |rule: &str| -> Result<(), String> {
            if names.iter().any(|n| n == rule) {
                return Err(format!("rule \"{rule}\": name is used twice"));
            }
            names.push(rule.to_string());
            Ok(())
        };
        let density = |rule: &str, d: f64| -> Result<f64, String> {
            if d.is_finite() && d >= 0.0 {
                Ok(d)
            } else {
                Err(format!(
                    "rule \"{rule}\": density {d} must be a number >= 0"
                ))
            }
        };
        let kind_list = |rule: &str, list: &[String]| -> Result<Vec<u8>, String> {
            if list.is_empty() {
                return Err(format!("rule \"{rule}\": kinds is empty"));
            }
            list.iter().map(|k| code(rule, k)).collect()
        };
        let mut zones = Vec::new();
        for z in [
            Zone::Fire,
            Zone::Sentenced,
            Zone::Plague,
            Zone::Frost,
            Zone::Holy,
        ] {
            let Some(rz) = self.zones.get(z.as_str()) else {
                continue;
            };
            let mut rings = Vec::new();
            for r in &rz.signature.rings {
                claim(&r.name)?;
                if !(r.inner.is_finite()
                    && r.outer.is_finite()
                    && r.inner >= 0.0
                    && r.inner < r.outer)
                {
                    return Err(format!(
                        "rule \"{}\": ring needs 0 <= inner < outer (inner {}, outer {})",
                        r.name, r.inner, r.outer
                    ));
                }
                if r.props.is_empty() {
                    return Err(format!("rule \"{}\": ring has no props", r.name));
                }
                let mut props = Vec::new();
                for p in &r.props {
                    props.push(RingProp {
                        kind: code(&r.name, &p.kind)?,
                        density: density(&r.name, p.density)?,
                    });
                }
                rings.push(RingRule {
                    name: r.name.clone(),
                    inner: r.inner,
                    outer: r.outer,
                    ground_variant: r.ground_variant,
                    props,
                    on: r.on.clone(),
                });
            }
            let mut clusters = Vec::new();
            for c in &rz.clusters {
                claim(&c.name)?;
                if !(c.radius.is_finite() && c.radius > 0.0) {
                    return Err(format!("rule \"{}\": radius must be > 0", c.name));
                }
                if !(c.min_spacing.is_finite() && c.min_spacing >= 0.0) {
                    return Err(format!("rule \"{}\": minSpacing must be >= 0", c.name));
                }
                if !(0.0..=1.0).contains(&c.clearing) {
                    return Err(format!(
                        "rule \"{}\": clearing must be within 0..=1",
                        c.name
                    ));
                }
                if !(c.moat.is_finite() && c.moat >= 0.0) {
                    return Err(format!("rule \"{}\": moat must be >= 0", c.name));
                }
                if c.sites == 0 || c.members == 0 {
                    return Err(format!(
                        "rule \"{}\": sites and members must be >= 1",
                        c.name
                    ));
                }
                clusters.push(ClusterRule {
                    name: c.name.clone(),
                    kinds: kind_list(&c.name, &c.kinds)?,
                    radius: c.radius,
                    min_spacing: c.min_spacing,
                    clearing: c.clearing,
                    sites: c.sites,
                    members: c.members,
                    moat: c.moat,
                    on: c.on.clone(),
                });
            }
            let mut edges = Vec::new();
            for e in &rz.edges {
                claim(&e.name)?;
                if e.distance == 0 || e.against.is_empty() {
                    return Err(format!(
                        "rule \"{}\": distance must be >= 1 and against non-empty",
                        e.name
                    ));
                }
                edges.push(EdgeRule {
                    name: e.name.clone(),
                    kinds: kind_list(&e.name, &e.kinds)?,
                    against: e.against.clone(),
                    distance: e.distance,
                    density: density(&e.name, e.density)?,
                    on: e.on.clone(),
                });
            }
            let mut fillers = Vec::new();
            for f in &rz.filler {
                claim(&f.name)?;
                if !(f.min_spacing.is_finite() && f.min_spacing >= 0.0) {
                    return Err(format!("rule \"{}\": minSpacing must be >= 0", f.name));
                }
                fillers.push(FillerRule {
                    name: f.name.clone(),
                    kinds: kind_list(&f.name, &f.kinds)?,
                    density: density(&f.name, f.density)?,
                    min_spacing: f.min_spacing,
                    on: f.on.clone(),
                });
            }
            let landmark = match &rz.signature.landmark {
                None => None,
                Some(l) => {
                    let mut band_rings = Vec::new();
                    for r in &l.rings {
                        claim(&r.name)?;
                        let band = match r.band.as_str() {
                            "core" => Band::Core,
                            "near" => Band::Near,
                            "mid" => Band::Mid,
                            "far" => Band::Far,
                            other => {
                                return Err(format!(
                                "rule \"{}\": unknown band \"{other}\" (core, near, mid or far)",
                                r.name
                            ))
                            }
                        };
                        if let Some(first) = band_rings.iter().find(|b: &&BandRing| b.band == band)
                        {
                            return Err(format!(
                                "rule \"{}\": band \"{}\" already has a ring (rule \"{}\")",
                                r.name, r.band, first.name
                            ));
                        }
                        if r.props.is_empty() {
                            return Err(format!("rule \"{}\": ring has no props", r.name));
                        }
                        let mut props = Vec::new();
                        for p in &r.props {
                            props.push(RingProp {
                                kind: code(&r.name, &p.kind)?,
                                density: density(&r.name, p.density)?,
                            });
                        }
                        band_rings.push(BandRing {
                            name: r.name.clone(),
                            band,
                            ground_variant: r.ground_variant,
                            props,
                            on: r.on.clone(),
                        });
                    }
                    Some(LandmarkRules {
                        feature: l.feature,
                        rings: band_rings,
                    })
                }
            };
            zones.push(ZoneRules {
                zone: z,
                signature_feature: rz.signature.feature,
                rings,
                landmark,
                clusters,
                edges,
                fillers,
            });
        }
        for name in self.zones.keys() {
            if zone_of(name).is_none() {
                return Err(format!("zone \"{name}\": unknown zone"));
            }
        }
        Ok(Rules {
            kinds,
            keep_clear: KeepClearRules {
                camp_margin: self.keep_clear.camp_margin,
                coliseum_margin: self.keep_clear.coliseum_margin,
                corridor_width: self.keep_clear.corridor_width,
            },
            zones,
        })
    }
}
