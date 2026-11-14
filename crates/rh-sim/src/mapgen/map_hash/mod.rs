//! Exact legacy mapHash: source field order, ECMAScript numbers, UTF-16LE and FNV-1a.
//! Cosmetic props, coliseum and region mob_camps are deliberately absent in the source hash.
use crate::mapdata::{FeatureJob, FeatureKind, GameMapData, TileRect, WorldPt};

/// ECMAScript String(Number), including -0, NaN and infinities. No locale or I/O.
pub fn number_string(value: f64) -> String {
    ryu_js::Buffer::new().format(value).to_owned()
}
struct Hash(u32);
impl Hash {
    fn byte(&mut self, byte: u8) {
        self.0 = (self.0 ^ u32::from(byte)).wrapping_mul(0x0100_0193);
    }
    fn bytes(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.byte(byte);
        }
    }
    fn units(&mut self, units: impl IntoIterator<Item = u16>) {
        for unit in units {
            self.byte(unit as u8);
            self.byte((unit >> 8) as u8);
        }
        self.byte(0x1f);
    }
    fn string(&mut self, value: &str) {
        self.units(value.encode_utf16());
    }
    fn number(&mut self, value: f64) {
        // Buffer owns its stack storage; hash the string before it is released.
        self.string(ryu_js::Buffer::new().format(value));
    }
    fn len(&mut self, len: usize) {
        self.number(len as f64);
    }
    fn xy(&mut self, x: f64, y: f64) {
        self.number(x);
        self.number(y);
    }
    fn point(&mut self, point: WorldPt) {
        self.xy(point.x, point.y);
    }
    fn points(&mut self, points: &[WorldPt]) {
        self.len(points.len());
        for &point in points {
            self.point(point);
        }
    }
    fn rect(&mut self, rect: TileRect) {
        self.number(f64::from(rect.x));
        self.number(f64::from(rect.y));
        self.number(f64::from(rect.w));
        self.number(f64::from(rect.h));
    }
}
fn kind_name(kind: FeatureKind) -> &'static str {
    match kind {
        FeatureKind::Landmark => "landmark",
        FeatureKind::Crater => "crater",
        FeatureKind::LavaRiver => "lavaRiver",
        FeatureKind::FenceRow => "fenceRow",
        FeatureKind::Gallows => "gallows",
        FeatureKind::Barrow => "barrow",
        FeatureKind::Mere => "mere",
        FeatureKind::Headland => "headland",
        FeatureKind::Spire => "spire",
        FeatureKind::Causeway => "causeway",
        FeatureKind::Hall => "hall",
        FeatureKind::Infill => "infill",
        FeatureKind::Bush => "bush",
        FeatureKind::BogTree => "bogTree",
        FeatureKind::Church => "church",
        FeatureKind::Graveyard => "graveyard",
        FeatureKind::Volcano => "volcano",
        FeatureKind::LavaStream => "lavaStream",
        FeatureKind::LavaPool => "lavaPool",
        FeatureKind::Cave => "cave",
        FeatureKind::BogPool => "bogPool",
    }
}
fn job_name(job: FeatureJob) -> &'static str {
    match job {
        FeatureJob::Landmark => "landmark",
        FeatureJob::Pen => "pen",
        FeatureJob::Crossing => "crossing",
        FeatureJob::Lane => "lane",
        FeatureJob::Fork => "fork",
        FeatureJob::Lee => "lee",
        FeatureJob::Choke => "choke",
        FeatureJob::Cover => "cover",
        FeatureJob::Rest => "rest",
        FeatureJob::Seal => "seal",
    }
}
/// The source's eight lowercase hexadecimal digits, for the complete admitted DTO domain.
/// This computes identity only; it does not validate or generate a map. Rust strings represent
/// Unicode scalar values; lone JS surrogate strings are outside the admitted Rust DTO domain.
/// Non-finite f64 fields are rejected by map admission, but number_string still implements JS.
pub fn map_hash(map: &GameMapData) -> String {
    let mut h = Hash(0x811c_9dc5);
    h.number(map.seed as f64);
    h.number(map.attempt as f64);
    h.number(f64::from(map.w));
    h.number(f64::from(map.h));
    h.bytes(&map.tiles);
    h.bytes(&map.terrain);
    h.bytes(&map.region_grid);
    h.bytes(&map.territory_grid);
    h.len(map.camps.len());
    for c in &map.camps {
        h.string(&c.id);
        h.string(c.zone.as_str());
        h.xy(c.x, c.y);
        h.number(c.r);
        h.points(&c.spots);
        h.number(f64::from(c.elite_spot));
        h.point(c.chest);
        h.number(f64::from(c.area));
        h.number(c.radius);
    }
    h.len(map.spawn_pool.len());
    for s in &map.spawn_pool {
        h.xy(s.x, s.y);
        h.string(s.zone.as_str());
    }
    h.len(map.regions.len());
    for r in &map.regions {
        h.string(r.id.as_str());
        h.point(r.pole);
        h.number(f64::from(r.area));
        h.points(&r.spawns);
        h.points(&r.chest_spots);
    }
    h.len(map.buildings.len());
    for &b in &map.buildings {
        h.rect(b);
    }
    h.bytes(&map.feature_grid);
    h.len(map.features.len());
    for f in &map.features {
        h.string(kind_name(f.kind));
        h.string(&f.variant);
        h.string(f.zone.as_str());
        h.len(f.jobs.len());
        for &j in &f.jobs {
            h.string(job_name(j));
        }
        h.number(f64::from(f.ax));
        h.number(f64::from(f.ay));
        h.len(f.p.len());
        for &v in &f.p {
            h.number(f64::from(v));
        }
        h.rect(f.bbox);
        h.number(f64::from(f.tiles));
    }
    h.points(&map.spawns);
    h.points(&map.crate_spots);
    h.points(&map.ground_spots);
    format!("{:08x}", h.0)
}
#[cfg(test)]
mod tests;
