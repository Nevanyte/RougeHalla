//! Canonical collision map and optional public ground planes.

use crate::codec::{DecodeError, EncodeError, Reader, Writer};
use crate::ground::{
    context_hash, semantic_hash, semantic_hash_parts, validate_plane_values, GroundMode,
    PRESENCE_BUSHES, PRESENCE_CAMPS, PRESENCE_COLISEUM, PRESENCE_GROUND_VARIANTS, PRESENCE_KNOWN,
    PRESENCE_PROPS, PRESENCE_REGIONS, PRESENCE_TERRAIN, SECTION_VERSION,
};

/// Maximum cells in any map plane.
pub const MAX_MAP_TILES: usize = 1024 * 1024;
const MAP_HEAD_LEN: usize = 12;
const RUN_LEN: usize = 3;
const EXTENSION_STATIC_HEADER_LEN: usize = 6;
const EXTENSION_TAIL_LEN: usize = 5;
/// Five run-length planes may be present: collision, terrain, regions, bushes and ground variants.
const MAX_CUMULATIVE_RUNS: usize = 5 * MAX_MAP_TILES;
const MAX_DECODED_PLANES: usize = 5 * MAX_MAP_TILES;
/// Wire bytes of one camp row (`x u16, y u16, r u16, zone u8`) and one prop row (`kind u8, x u16, y u16, variant u8,
/// flags u8`).
const CAMP_LEN: usize = 7;
const PROP_LEN: usize = 7;
/// `Zone::code` runs 1..=5; `GateSide` codes 0..=3 (n, e, s, w).
const MAX_CAMP_ZONE: u8 = 5;
const MAX_GATE_SIDE: u8 = 3;

/// Most camp markers a map may carry (legacy: 5 zones x 10 camps).
pub const MAX_MAP_CAMPS: usize = 64;
/// Most coliseum gates (legacy: four, one per side).
pub const MAX_COLISEUM_GATES: usize = 8;
/// Most tiles in one gate (legacy: GATE_W = 4).
pub const MAX_GATE_TILES: usize = 16;
/// Most cosmetic props (`rh_mapdress::MAX_PROPS`).
pub const MAX_MAP_PROPS: usize = 8192;

// P-DRESS-BAKE-1 (stub: the values are the brief's; the checks that use them are the implementer's).
/// Prop flag: drawn tall (`rh_mapdress::FLAG_TALL`).
pub const PROP_FLAG_TALL: u8 = 1;
/// Prop flag: a generator `GameMapData.props` entry; `kind` is a legacy prop-catalogue index (`rh_mapdress::FLAG_LEGACY`).
pub const PROP_FLAG_LEGACY: u8 = 2;
/// Highest rule-file kind code: five zones x ten codes x two blocks (`crates/rh-mapdress/src/rules.rs` module doc).
/// Rule props carry `1..=MAX_PROP_KIND`.
pub const MAX_PROP_KIND: u8 = 100;
/// Legacy props carry a kind below this: the generator's prop catalogue
/// (`rh_sim::mapgen::terrain_gate::DEFAULT_DEFINITION.props`).
pub const LEGACY_PROP_KINDS: u8 = 34;
/// Highest sprite variant of a rule prop (`rh_mapdress` draws `0..=3`); a legacy prop's variant is its generator `v`.
pub const MAX_PROP_VARIANT: u8 = 3;
/// Highest ground-variant id in the ground-variant plane.
pub const MAX_GROUND_VARIANT: u8 = 15;
/// World units per tile: a prop at `(x, y)` stands on tile `(x / 32, y / 32)`, which must be inside the map.
const PROP_TILE: u16 = 32;

/// One camp marker, index-aligned with the `WireCamp` rows in state. World units; `zone` is `Zone::code` (1..=5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapCamp {
    pub x: u16,
    pub y: u16,
    /// Legacy `CampDef.r`: the clearing radius in world units.
    pub r: u16,
    pub zone: u8,
}

/// A tile coordinate inside the map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapTile {
    pub x: u16,
    pub y: u16,
}

/// A coliseum gate: side 0 north, 1 east, 2 south, 3 west; its tiles in legacy order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapGate {
    pub side: u8,
    pub tiles: Vec<MapTile>,
}

/// The coliseum rectangle in tiles and its gates in legacy order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapColiseum {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    pub gates: Vec<MapGate>,
}

/// A cosmetic prop (the server's map dressing, P-DRESS-BAKE-1): x and y in world units, rows sorted by `(y, x, kind)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapProp {
    pub kind: u8,
    pub x: u16,
    pub y: u16,
    pub variant: u8,
    pub flags: u8,
}

/// Public map dressing that legacy clients generated themselves (protocol 17). Empty lists and `None` encode as absent.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MapPublic {
    pub camps: Vec<MapCamp>,
    pub coliseum: Option<MapColiseum>,
    /// Row-major bush identity plane: 0 none, else the legacy bush id.
    pub bushes: Option<Vec<u8>>,
    pub props: Vec<MapProp>,
    /// Row-major ground-variant plane (the server's map dressing; ids `0..=MAX_GROUND_VARIANT`).
    pub ground_variants: Option<Vec<u8>>,
    /// P-WIRE17-MAP-2: row-major camp patience plane: 0, or the 1-based index (into `camps`) of the camp whose patience
    /// range covers the tile (legacy `campPatienceOutline`). Present only in a section-version-3 extension.
    // Stub: the codec neither writes, reads nor checks it yet (the implementer replaces this note).
    pub patience: Option<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapBlob {
    pub w: u16,
    pub h: u16,
    /// Collision classes, row-major: 0 floor, 1 wall, 2 low.
    pub tiles: Vec<u8>,
    /// FNV-1a 32 over (w u32 LE, h u32 LE, collision cells).
    pub layer_hash: u32,
    /// Optional public semantic terrain plane, row-major. Present zeroes differ from absence.
    pub terrain: Option<Vec<u8>>,
    /// Optional public authored region plane, row-major. Present zeroes differ from absence.
    pub regions: Option<Vec<u8>>,
    pub terrain_mode: GroundMode,
    pub semantic_hash: u32,
    pub context_hash: u32,
    /// Protocol 17 public sections.
    pub public: MapPublic,
}

/// Same collision hash as `rh_sim::map::TileMap::layer_hash`.
pub fn layer_hash(w: u32, h: u32, tiles: &[u8]) -> u32 {
    let mut hsh: u32 = 0x811c_9dc5;
    for b in w
        .to_le_bytes()
        .iter()
        .chain(h.to_le_bytes().iter())
        .chain(tiles.iter())
    {
        hsh ^= *b as u32;
        hsh = hsh.wrapping_mul(0x0100_0193);
    }
    hsh
}

struct Runs<'a> {
    values: &'a [u8],
}
impl Iterator for Runs<'_> {
    type Item = (u8, u16);
    fn next(&mut self) -> Option<Self::Item> {
        let (&tile, rest) = self.values.split_first()?;
        let max = rest.len().min(u16::MAX as usize - 1);
        let same = rest[..max].iter().take_while(|&&v| v == tile).count();
        self.values = &rest[same..];
        Some((tile, same as u16 + 1))
    }
}

impl MapBlob {
    /// Collision-only compatibility constructor. New ground metadata is absent and the default mode is Off.
    pub fn new(w: u16, h: u16, tiles: Vec<u8>) -> Self {
        let layer_hash = layer_hash(w as u32, h as u32, &tiles);
        let semantic_hash = semantic_hash(w, h, 0, None, None);
        let terrain_mode = GroundMode::Off;
        let context_hash = context_hash(layer_hash, semantic_hash, terrain_mode);
        Self {
            w,
            h,
            tiles,
            layer_hash,
            terrain: None,
            regions: None,
            terrain_mode,
            semantic_hash,
            context_hash,
            public: MapPublic::default(),
        }
    }

    /// Constructs a complete ground-aware map and computes both public hashes.
    pub fn with_ground(
        w: u16,
        h: u16,
        tiles: Vec<u8>,
        terrain: Option<Vec<u8>>,
        regions: Option<Vec<u8>>,
        terrain_mode: GroundMode,
    ) -> Result<Self, EncodeError> {
        let layer_hash = layer_hash(w as u32, h as u32, &tiles);
        let presence = presence(terrain.is_some(), regions.is_some());
        let semantic_hash = semantic_hash(w, h, presence, terrain.as_deref(), regions.as_deref());
        let context_hash = context_hash(layer_hash, semantic_hash, terrain_mode);
        let map = Self {
            w,
            h,
            tiles,
            layer_hash,
            terrain,
            regions,
            terrain_mode,
            semantic_hash,
            context_hash,
            public: MapPublic::default(),
        };
        map.check()?;
        Ok(map)
    }

    /// Alias emphasizing that all semantic planes and hashes are checked before the model is returned.
    pub fn new_with_ground(
        w: u16,
        h: u16,
        tiles: Vec<u8>,
        terrain: Option<Vec<u8>>,
        regions: Option<Vec<u8>>,
        mode: GroundMode,
    ) -> Result<Self, EncodeError> {
        Self::with_ground(w, h, tiles, terrain, regions, mode)
    }

    /// Attaches the protocol 17 public sections, recomputes the hashes and checks the whole map. Empty lists and `None`
    /// are absent sections; nothing is clamped or dropped: a section a decoder would refuse is an error.
    pub fn with_public(mut self, public: MapPublic) -> Result<Self, EncodeError> {
        check_public(self.w, self.h, &public)?;
        self.public = public;
        self.semantic_hash = self.computed_semantic_hash();
        self.context_hash = context_hash(self.layer_hash, self.semantic_hash, self.terrain_mode);
        self.check()?;
        Ok(self)
    }

    fn computed_semantic_hash(&self) -> u32 {
        public_semantic_hash(
            self.w,
            self.h,
            self.terrain.as_deref(),
            self.regions.as_deref(),
            &self.public,
        )
    }

    fn runs(&self) -> Runs<'_> {
        Runs {
            values: &self.tiles,
        }
    }
    fn presence(&self) -> u8 {
        presence(self.terrain.is_some(), self.regions.is_some()) | public_presence(&self.public)
    }

    fn collision_encoded_len(&self) -> usize {
        MAP_HEAD_LEN + RUN_LEN * self.runs().count()
    }
    fn extension_static_len(&self) -> usize {
        EXTENSION_STATIC_HEADER_LEN
            + self.terrain.as_deref().map_or(0, rle_len)
            + self.regions.as_deref().map_or(0, rle_len)
            + public_len(&self.public)
    }
    /// Exact size of the complete MapBlob, including its extension and context tail.
    pub fn encoded_len(&self) -> usize {
        self.collision_encoded_len() + 4 + self.extension_static_len() + EXTENSION_TAIL_LEN
    }

    /// Whether a decoder accepts this complete map.
    pub fn check(&self) -> Result<(), EncodeError> {
        let total = self.w as usize * self.h as usize;
        if self.w == 0 || self.h == 0 || total > MAX_MAP_TILES {
            return Err(EncodeError::BadMap("size"));
        }
        if self.tiles.len() != total {
            return Err(EncodeError::BadMap("length"));
        }
        if self.tiles.iter().any(|&v| v > 2) {
            return Err(EncodeError::BadMap("run"));
        }
        if layer_hash(self.w as u32, self.h as u32, &self.tiles) != self.layer_hash {
            return Err(EncodeError::BadMap("hash"));
        }
        validate_plane_values(self.terrain.as_deref(), self.regions.as_deref())?;
        for plane in [self.terrain.as_deref(), self.regions.as_deref()]
            .into_iter()
            .flatten()
        {
            if plane.len() != total {
                return Err(EncodeError::BadMap("plane length"));
            }
        }
        if let (Some(terrain), true) = (self.terrain.as_deref(), self.tiles.len() == total) {
            if terrain
                .iter()
                .zip(&self.tiles)
                .any(|(&t, &c)| !terrain_collision_compatible(t, c))
            {
                return Err(EncodeError::BadMap("terrain collision"));
            }
        }
        check_public(self.w, self.h, &self.public)?;
        if self.semantic_hash != self.computed_semantic_hash() {
            return Err(EncodeError::BadMap("semantic hash"));
        }
        if self.context_hash != context_hash(self.layer_hash, self.semantic_hash, self.terrain_mode)
        {
            return Err(EncodeError::BadMap("context hash"));
        }
        let full_len = crate::encode::WELCOME_HEADER_LEN + self.encoded_len();
        if full_len > crate::MAX_SERVER_FRAME {
            return Err(EncodeError::TooLarge {
                len: full_len,
                max: crate::MAX_SERVER_FRAME,
            });
        }
        Ok(())
    }

    pub fn write(&self, w: &mut Writer) {
        self.write_collision(w);
        self.write_extension_static(w);
        w.u8(self.terrain_mode as u8);
        w.u32(context_hash(
            self.layer_hash,
            self.semantic_hash,
            self.terrain_mode,
        ));
    }

    fn write_collision(&self, w: &mut Writer) {
        w.u16(self.w);
        w.u16(self.h);
        w.u32(self.layer_hash);
        w.u32(self.runs().count() as u32);
        for (v, n) in self.runs() {
            w.u8(v);
            w.u16(n);
        }
    }

    fn write_extension_static(&self, w: &mut Writer) {
        let static_len = self.extension_static_len();
        w.u32((static_len + EXTENSION_TAIL_LEN) as u32);
        w.u8(SECTION_VERSION);
        w.u8(self.presence());
        w.u32(self.semantic_hash);
        write_plane(w, self.terrain.as_deref());
        write_plane(w, self.regions.as_deref());
        write_public(w, &self.public);
    }

    /// RLE-encodes immutable collision and semantic data once. Mode and context are appended per Welcome.
    pub fn pre_encode(&self) -> Result<EncodedMap, EncodeError> {
        self.check()?;
        let static_len = self.collision_encoded_len() + 4 + self.extension_static_len();
        let mut w = Writer::with_capacity(static_len);
        self.write_collision(&mut w);
        self.write_extension_static(&mut w);
        Ok(EncodedMap {
            w: self.w,
            h: self.h,
            layer_hash: self.layer_hash,
            semantic_hash: self.semantic_hash,
            body: w.finish().into_boxed_slice(),
        })
    }

    /// Encodes borrowed source planes after validation, avoiding decoded-plane clones during asset admission.
    pub fn encode_slices(
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
    ) -> Result<EncodedMap, EncodeError> {
        EncodedMap::from_slices(w, h, tiles, terrain, regions)
    }

    /// Full two-pass validation: no decoded plane is allocated until all map and extension data are proven valid.
    pub fn read(r: &mut Reader) -> Result<Self, DecodeError> {
        let mut scan = r.clone();
        preflight(&mut scan)?;
        if scan.remaining() != 0 {
            return Err(DecodeError::Trailing(scan.remaining()));
        }
        let consumed = scan.position() - r.position();
        let frame_bytes = r.bytes(consumed)?;
        decode_plan(frame_bytes)
    }
}

fn presence(terrain: bool, regions: bool) -> u8 {
    u8::from(terrain) | (u8::from(regions) << 1)
}
fn rle_len(plane: &[u8]) -> usize {
    RUN_LEN * Runs { values: plane }.count() + 4
}
fn write_plane(w: &mut Writer, plane: Option<&[u8]>) {
    if let Some(values) = plane {
        let run_count = Runs { values }.count();
        w.u32(run_count as u32);
        for (value, count) in (Runs { values }) {
            w.u8(value);
            w.u16(count);
        }
    }
}
/// Presence bits of the protocol 17 sections: a list is present when non-empty, a plane or the coliseum when `Some`.
fn public_presence(p: &MapPublic) -> u8 {
    let mut flags = 0;
    if !p.camps.is_empty() {
        flags |= PRESENCE_CAMPS;
    }
    if p.coliseum.is_some() {
        flags |= PRESENCE_COLISEUM;
    }
    if p.bushes.is_some() {
        flags |= PRESENCE_BUSHES;
    }
    if !p.props.is_empty() {
        flags |= PRESENCE_PROPS;
    }
    if p.ground_variants.is_some() {
        flags |= PRESENCE_GROUND_VARIANTS;
    }
    flags
}

fn camps_len(camps: &[MapCamp]) -> usize {
    if camps.is_empty() {
        0
    } else {
        1 + CAMP_LEN * camps.len()
    }
}
fn coliseum_len(coliseum: Option<&MapColiseum>) -> usize {
    coliseum.map_or(0, |c| {
        9 + c.gates.iter().map(|g| 2 + 4 * g.tiles.len()).sum::<usize>()
    })
}
fn props_len(props: &[MapProp]) -> usize {
    if props.is_empty() {
        0
    } else {
        2 + PROP_LEN * props.len()
    }
}
/// Wire bytes of every present public section (only meaningful once [`check_public`] passed).
fn public_len(p: &MapPublic) -> usize {
    camps_len(&p.camps)
        + coliseum_len(p.coliseum.as_ref())
        + p.bushes.as_deref().map_or(0, rle_len)
        + props_len(&p.props)
        + p.ground_variants.as_deref().map_or(0, rle_len)
}

fn write_camps(w: &mut Writer, camps: &[MapCamp]) {
    if camps.is_empty() {
        return;
    }
    w.u8(camps.len() as u8);
    for c in camps {
        w.u16(c.x);
        w.u16(c.y);
        w.u16(c.r);
        w.u8(c.zone);
    }
}
fn write_coliseum(w: &mut Writer, coliseum: Option<&MapColiseum>) {
    let Some(c) = coliseum else {
        return;
    };
    w.u16(c.x);
    w.u16(c.y);
    w.u16(c.w);
    w.u16(c.h);
    w.u8(c.gates.len() as u8);
    for g in &c.gates {
        w.u8(g.side);
        w.u8(g.tiles.len() as u8);
        for t in &g.tiles {
            w.u16(t.x);
            w.u16(t.y);
        }
    }
}
fn write_props(w: &mut Writer, props: &[MapProp]) {
    if props.is_empty() {
        return;
    }
    w.u16(props.len() as u16);
    for p in props {
        w.u8(p.kind);
        w.u16(p.x);
        w.u16(p.y);
        w.u8(p.variant);
        w.u8(p.flags);
    }
}
/// The public sections in wire (presence bit) order.
fn write_public(w: &mut Writer, p: &MapPublic) {
    write_camps(w, &p.camps);
    write_coliseum(w, p.coliseum.as_ref());
    write_plane(w, p.bushes.as_deref());
    write_props(w, &p.props);
    write_plane(w, p.ground_variants.as_deref());
}

fn section_bytes(len: usize, f: impl FnOnce(&mut Writer)) -> Vec<u8> {
    let mut w = Writer::with_capacity(len);
    f(&mut w);
    w.finish()
}

/// Version 2 semantic hash: planes hash their decoded cells, list sections their wire bytes (count included).
fn public_semantic_hash(
    w: u16,
    h: u16,
    terrain: Option<&[u8]>,
    regions: Option<&[u8]>,
    p: &MapPublic,
) -> u32 {
    let flags = presence(terrain.is_some(), regions.is_some()) | public_presence(p);
    let camps = section_bytes(camps_len(&p.camps), |w| write_camps(w, &p.camps));
    let coliseum = section_bytes(coliseum_len(p.coliseum.as_ref()), |w| {
        write_coliseum(w, p.coliseum.as_ref())
    });
    let props = section_bytes(props_len(&p.props), |w| write_props(w, &p.props));
    semantic_hash_parts(
        w,
        h,
        flags,
        [
            terrain.unwrap_or_default(),
            regions.unwrap_or_default(),
            &camps,
            &coliseum,
            p.bushes.as_deref().unwrap_or_default(),
            &props,
            p.ground_variants.as_deref().unwrap_or_default(),
        ],
    )
}

/// The encoder's half of the decoder's section checks, with the same reasons; it never clamps or drops.
fn check_public(w: u16, h: u16, p: &MapPublic) -> Result<(), EncodeError> {
    let total = usize::from(w) * usize::from(h);
    if p.camps.len() > MAX_MAP_CAMPS {
        return Err(EncodeError::BadMap("camp count"));
    }
    if p.camps
        .iter()
        .any(|c| c.zone == 0 || c.zone > MAX_CAMP_ZONE)
    {
        return Err(EncodeError::BadMap("camp zone"));
    }
    if let Some(c) = &p.coliseum {
        if !coliseum_rect_fits(c.x, c.y, c.w, c.h, w, h) {
            return Err(EncodeError::BadMap("coliseum rect"));
        }
        if c.gates.len() > MAX_COLISEUM_GATES {
            return Err(EncodeError::BadMap("gate count"));
        }
        for g in &c.gates {
            if g.side > MAX_GATE_SIDE {
                return Err(EncodeError::BadMap("gate side"));
            }
            if g.tiles.is_empty() || g.tiles.len() > MAX_GATE_TILES {
                return Err(EncodeError::BadMap("gate tiles"));
            }
            if g.tiles.iter().any(|t| t.x >= w || t.y >= h) {
                return Err(EncodeError::BadMap("gate tile"));
            }
        }
    }
    for plane in [p.bushes.as_deref(), p.ground_variants.as_deref()]
        .into_iter()
        .flatten()
    {
        if plane.len() != total {
            return Err(EncodeError::BadMap("plane length"));
        }
    }
    if p.props.len() > MAX_MAP_PROPS {
        return Err(EncodeError::BadMap("prop count"));
    }
    let mut previous = None;
    for prop in &p.props {
        check_prop(prop, previous, w, h).map_err(EncodeError::BadMap)?;
        previous = Some(prop);
    }
    if p.ground_variants
        .as_deref()
        .is_some_and(|g| g.iter().any(|&v| v > MAX_GROUND_VARIANT))
    {
        return Err(EncodeError::BadMap("ground variant"));
    }
    Ok(())
}

fn coliseum_rect_fits(x: u16, y: u16, cw: u16, ch: u16, w: u16, h: u16) -> bool {
    cw >= 1
        && ch >= 1
        && u32::from(x) + u32::from(cw) <= u32::from(w)
        && u32::from(y) + u32::from(ch) <= u32::from(h)
}

fn terrain_collision_compatible(terrain: u8, collision: u8) -> bool {
    match terrain {
        0 => collision <= 2,
        1..=3 => collision == 1 || collision == 2,
        4..=7 => collision == 0,
        _ => false,
    }
}

#[derive(Clone, Copy)]
struct PlanePlan<'a> {
    runs: &'a [u8],
    count: usize,
}
#[derive(Clone, Copy)]
struct MapPlan<'a> {
    w: u16,
    h: u16,
    collision_hash: u32,
    collision_runs: &'a [u8],
    collision_count: usize,
    semantic_hash: u32,
    terrain: Option<PlanePlan<'a>>,
    regions: Option<PlanePlan<'a>>,
    /// List sections keep their exact wire bytes (count included): the semantic hash covers them as sent.
    camps: Option<&'a [u8]>,
    coliseum: Option<&'a [u8]>,
    bushes: Option<PlanePlan<'a>>,
    props: Option<&'a [u8]>,
    ground_variants: Option<PlanePlan<'a>>,
    mode: GroundMode,
    context_hash: u32,
}

fn preflight<'a>(r: &mut Reader<'a>) -> Result<MapPlan<'a>, DecodeError> {
    let w = r.u16()?;
    let h = r.u16()?;
    let collision_hash = r.u32()?;
    let collision_count = r.u32()? as usize;
    let total = usize::from(w) * usize::from(h);
    if w == 0 || h == 0 || total > MAX_MAP_TILES {
        return Err(DecodeError::BadMap("size"));
    }
    if collision_count == 0 || collision_count > total || collision_count > MAX_CUMULATIVE_RUNS {
        return Err(DecodeError::BadMap("run"));
    }
    let collision_bytes = collision_count
        .checked_mul(RUN_LEN)
        .ok_or(DecodeError::BadMap("run"))?;
    let collision_runs = r.bytes(collision_bytes)?;
    validate_runs(collision_runs, collision_count, total, 2, "run")?;
    let actual_collision_hash = hash_collision_runs(w, h, collision_runs, collision_count);
    if actual_collision_hash != collision_hash {
        return Err(DecodeError::BadMap("hash"));
    }

    let ext_len = r.u32()? as usize;
    if ext_len < EXTENSION_STATIC_HEADER_LEN + EXTENSION_TAIL_LEN {
        return Err(DecodeError::BadMap("extension length"));
    }
    let ext = r.bytes(ext_len)?;
    let mut er = Reader::new(ext);
    let version = er.u8()?;
    if version != SECTION_VERSION {
        return Err(DecodeError::BadMap("section version"));
    }
    let flags = er.u8()?;
    if flags & !PRESENCE_KNOWN != 0 {
        return Err(DecodeError::BadMap("presence"));
    }
    let semantic_hash = er.u32()?;
    let mut cumulative_runs = collision_count;
    let terrain = if flags & PRESENCE_TERRAIN != 0 {
        Some(read_plane_plan(&mut er, total, &mut cumulative_runs)?)
    } else {
        None
    };
    let regions = if flags & PRESENCE_REGIONS != 0 {
        Some(read_plane_plan(&mut er, total, &mut cumulative_runs)?)
    } else {
        None
    };
    let camps = if flags & PRESENCE_CAMPS != 0 {
        Some(section(ext, &mut er, read_camps)?)
    } else {
        None
    };
    let coliseum = if flags & PRESENCE_COLISEUM != 0 {
        Some(section(ext, &mut er, |r| read_coliseum(r, w, h))?)
    } else {
        None
    };
    let bushes = if flags & PRESENCE_BUSHES != 0 {
        Some(read_plane_plan(&mut er, total, &mut cumulative_runs)?)
    } else {
        None
    };
    let props = if flags & PRESENCE_PROPS != 0 {
        Some(section(ext, &mut er, |r| read_props(r, w, h))?)
    } else {
        None
    };
    let ground_variants = if flags & PRESENCE_GROUND_VARIANTS != 0 {
        let plan = read_plane_plan(&mut er, total, &mut cumulative_runs)?;
        if plan
            .runs
            .chunks_exact(RUN_LEN)
            .any(|run| run[0] > MAX_GROUND_VARIANT)
        {
            return Err(DecodeError::BadMap("ground variant"));
        }
        Some(plan)
    } else {
        None
    };
    if cumulative_runs > MAX_CUMULATIVE_RUNS {
        return Err(DecodeError::BadMap("run"));
    }
    let mode = GroundMode::from_code(er.u8()?)?;
    let context_hash = er.u32()?;
    if er.remaining() != 0 {
        return Err(DecodeError::BadMap("extension trailing"));
    }
    if decoded_bytes(total, flags)? > MAX_DECODED_PLANES {
        return Err(DecodeError::BadMap("decoded size"));
    }
    validate_plane_plan(terrain, regions)?;
    if let Some(terrain) = terrain {
        validate_terrain_compatibility(collision_runs, collision_count, terrain)?;
    }
    let actual_semantic_hash = hash_semantic(
        w,
        h,
        flags,
        [
            Part::Plane(terrain),
            Part::Plane(regions),
            Part::Bytes(camps),
            Part::Bytes(coliseum),
            Part::Plane(bushes),
            Part::Bytes(props),
            Part::Plane(ground_variants),
        ],
    );
    if semantic_hash != actual_semantic_hash {
        return Err(DecodeError::BadMap("semantic hash"));
    }
    if context_hash != context_hash_fn(collision_hash, semantic_hash, mode) {
        return Err(DecodeError::BadMap("context hash"));
    }
    Ok(MapPlan {
        w,
        h,
        collision_hash,
        collision_runs,
        collision_count,
        semantic_hash,
        terrain,
        regions,
        camps,
        coliseum,
        bushes,
        props,
        ground_variants,
        mode,
        context_hash,
    })
}

/// Runs `read` and returns the exact extension bytes it consumed.
fn section<'a>(
    ext: &'a [u8],
    r: &mut Reader<'a>,
    read: impl FnOnce(&mut Reader<'a>) -> Result<(), DecodeError>,
) -> Result<&'a [u8], DecodeError> {
    let start = r.position();
    read(r)?;
    Ok(&ext[start..r.position()])
}

fn read_camps(r: &mut Reader<'_>) -> Result<(), DecodeError> {
    let count = usize::from(r.u8()?);
    if count == 0 || count > MAX_MAP_CAMPS {
        return Err(DecodeError::BadMap("camp count"));
    }
    let rows = r.bytes(count * CAMP_LEN)?;
    if rows
        .chunks_exact(CAMP_LEN)
        .any(|row| row[6] == 0 || row[6] > MAX_CAMP_ZONE)
    {
        return Err(DecodeError::BadMap("camp zone"));
    }
    Ok(())
}

fn read_coliseum(r: &mut Reader<'_>, w: u16, h: u16) -> Result<(), DecodeError> {
    let (x, y, cw, ch) = (r.u16()?, r.u16()?, r.u16()?, r.u16()?);
    if !coliseum_rect_fits(x, y, cw, ch, w, h) {
        return Err(DecodeError::BadMap("coliseum rect"));
    }
    let gates = usize::from(r.u8()?);
    if gates > MAX_COLISEUM_GATES {
        return Err(DecodeError::BadMap("gate count"));
    }
    for _ in 0..gates {
        if r.u8()? > MAX_GATE_SIDE {
            return Err(DecodeError::BadMap("gate side"));
        }
        let tiles = usize::from(r.u8()?);
        if tiles == 0 || tiles > MAX_GATE_TILES {
            return Err(DecodeError::BadMap("gate tiles"));
        }
        for _ in 0..tiles {
            let (tx, ty) = (r.u16()?, r.u16()?);
            if tx >= w || ty >= h {
                return Err(DecodeError::BadMap("gate tile"));
            }
        }
    }
    Ok(())
}

fn read_props(r: &mut Reader<'_>, w: u16, h: u16) -> Result<(), DecodeError> {
    let count = usize::from(r.u16()?);
    if count == 0 || count > MAX_MAP_PROPS {
        return Err(DecodeError::BadMap("prop count"));
    }
    let rows = r.bytes(count * PROP_LEN)?;
    let mut previous = None;
    for row in rows.chunks_exact(PROP_LEN) {
        let prop = prop_row(row);
        check_prop(&prop, previous.as_ref(), w, h).map_err(DecodeError::BadMap)?;
        previous = Some(prop);
    }
    Ok(())
}

/// The value checks of one prop row in the wire rules' order (flags, kind, variant, tile, order), shared by the encoder
/// and the decoder; `previous` is the row before it.
fn check_prop(p: &MapProp, previous: Option<&MapProp>, w: u16, h: u16) -> Result<(), &'static str> {
    if p.flags & !(PROP_FLAG_TALL | PROP_FLAG_LEGACY) != 0 {
        return Err("prop flags");
    }
    if p.flags & PROP_FLAG_LEGACY != 0 {
        // A legacy prop's kind is a generator catalogue index and its variant the generator's `v` (not checked).
        if p.kind >= LEGACY_PROP_KINDS {
            return Err("prop kind");
        }
    } else {
        if p.kind == 0 || p.kind > MAX_PROP_KIND {
            return Err("prop kind");
        }
        if p.variant > MAX_PROP_VARIANT {
            return Err("prop variant");
        }
    }
    if p.x / PROP_TILE >= w || p.y / PROP_TILE >= h {
        return Err("prop tile");
    }
    if previous.is_some_and(|q| (q.y, q.x, q.kind) >= (p.y, p.x, p.kind)) {
        return Err("prop order");
    }
    Ok(())
}

fn read_plane_plan<'a>(
    r: &mut Reader<'a>,
    total: usize,
    cumulative: &mut usize,
) -> Result<PlanePlan<'a>, DecodeError> {
    let count = r.u32()? as usize;
    if count == 0 || count > total {
        return Err(DecodeError::BadMap("run"));
    }
    *cumulative = cumulative
        .checked_add(count)
        .ok_or(DecodeError::BadMap("run"))?;
    if *cumulative > MAX_CUMULATIVE_RUNS {
        return Err(DecodeError::BadMap("run"));
    }
    let bytes = count
        .checked_mul(RUN_LEN)
        .ok_or(DecodeError::BadMap("run"))?;
    let runs = r.bytes(bytes)?;
    validate_runs(runs, count, total, u8::MAX, "run")?;
    Ok(PlanePlan { runs, count })
}

fn validate_runs(
    runs: &[u8],
    count: usize,
    total: usize,
    max_value: u8,
    reason: &'static str,
) -> Result<(), DecodeError> {
    if runs.len()
        != count
            .checked_mul(RUN_LEN)
            .ok_or(DecodeError::BadMap(reason))?
    {
        return Err(DecodeError::BadMap(reason));
    }
    let mut cells = 0usize;
    for chunk in runs.chunks_exact(RUN_LEN) {
        let value = chunk[0];
        let n = u16::from_le_bytes([chunk[1], chunk[2]]) as usize;
        if value > max_value || n == 0 {
            return Err(DecodeError::BadMap(reason));
        }
        cells = cells.checked_add(n).ok_or(DecodeError::BadMap(reason))?;
        if cells > total {
            return Err(DecodeError::BadMap(reason));
        }
    }
    if cells != total {
        return Err(DecodeError::BadMap("length"));
    }
    Ok(())
}

fn validate_plane_plan(
    terrain: Option<PlanePlan<'_>>,
    regions: Option<PlanePlan<'_>>,
) -> Result<(), DecodeError> {
    if terrain.is_some_and(|p| p.runs.chunks_exact(3).any(|r| r[0] > 7)) {
        return Err(DecodeError::BadMap("terrain value"));
    }
    if regions.is_some_and(|p| p.runs.chunks_exact(3).any(|r| r[0] > 6)) {
        return Err(DecodeError::BadMap("region value"));
    }
    Ok(())
}

fn validate_terrain_compatibility(
    collision: &[u8],
    collision_count: usize,
    terrain: PlanePlan<'_>,
) -> Result<(), DecodeError> {
    let mut ci = RunCursor::new(collision, collision_count);
    let mut ti = RunCursor::new(terrain.runs, terrain.count);
    while let (Some((c, cn)), Some((t, tn))) = (ci.current(), ti.current()) {
        if !terrain_collision_compatible(t, c) {
            return Err(DecodeError::BadMap("terrain collision"));
        }
        let step = cn.min(tn);
        ci.advance(step);
        ti.advance(step);
    }
    Ok(())
}

struct RunCursor<'a> {
    bytes: &'a [u8],
    index: usize,
    run_left: usize,
}
impl<'a> RunCursor<'a> {
    fn new(bytes: &'a [u8], _count: usize) -> Self {
        let run_left = if bytes.is_empty() {
            0
        } else {
            usize::from(u16::from_le_bytes([bytes[1], bytes[2]]))
        };
        Self {
            bytes,
            index: 0,
            run_left,
        }
    }
    fn current(&self) -> Option<(u8, usize)> {
        if self.index < self.bytes.len() {
            Some((self.bytes[self.index], self.run_left))
        } else {
            None
        }
    }
    fn advance(&mut self, n: usize) {
        self.run_left -= n;
        if self.run_left == 0 {
            self.index += 3;
            if self.index < self.bytes.len() {
                self.run_left = usize::from(u16::from_le_bytes([
                    self.bytes[self.index + 1],
                    self.bytes[self.index + 2],
                ]));
            }
        }
    }
}

fn decoded_bytes(total: usize, flags: u8) -> Result<usize, DecodeError> {
    let planes = 1 + [
        PRESENCE_TERRAIN,
        PRESENCE_REGIONS,
        PRESENCE_BUSHES,
        PRESENCE_GROUND_VARIANTS,
    ]
    .iter()
    .filter(|&&bit| flags & bit != 0)
    .count();
    total
        .checked_mul(planes)
        .ok_or(DecodeError::BadMap("decoded size"))
}

fn hash_collision_runs(w: u16, h: u16, runs: &[u8], count: usize) -> u32 {
    let mut state = 0x811c_9dc5u32;
    let update = |state: &mut u32, bytes: &[u8]| {
        for &b in bytes {
            *state = (*state ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    };
    update(&mut state, &(w as u32).to_le_bytes());
    update(&mut state, &(h as u32).to_le_bytes());
    for chunk in runs.chunks_exact(RUN_LEN).take(count) {
        for _ in 0..u16::from_le_bytes([chunk[1], chunk[2]]) {
            update(&mut state, &[chunk[0]]);
        }
    }
    state
}

/// One semantic-hash input: a plane hashes its decoded cells, a list section its wire bytes.
#[derive(Clone, Copy)]
enum Part<'a> {
    Plane(Option<PlanePlan<'a>>),
    Bytes(Option<&'a [u8]>),
}

fn hash_semantic<const N: usize>(w: u16, h: u16, flags: u8, parts: [Part<'_>; N]) -> u32 {
    let mut state = 0x811c_9dc5u32;
    let update = |state: &mut u32, bytes: &[u8]| {
        for &b in bytes {
            *state = (*state ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    };
    update(&mut state, crate::ground::SEMANTIC_DOMAIN);
    update(&mut state, &(w as u32).to_le_bytes());
    update(&mut state, &(h as u32).to_le_bytes());
    update(&mut state, &[SECTION_VERSION, flags]);
    for part in parts {
        match part {
            Part::Plane(Some(plan)) => {
                for chunk in plan.runs.chunks_exact(RUN_LEN).take(plan.count) {
                    for _ in 0..u16::from_le_bytes([chunk[1], chunk[2]]) {
                        update(&mut state, &[chunk[0]]);
                    }
                }
            }
            Part::Bytes(Some(bytes)) => update(&mut state, bytes),
            Part::Plane(None) | Part::Bytes(None) => {}
        }
    }
    state
}

fn context_hash_fn(collision: u32, semantic: u32, mode: GroundMode) -> u32 {
    context_hash(collision, semantic, mode)
}

fn decode_runs(bytes: &[u8], count: usize, total: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(total);
    for chunk in bytes.chunks_exact(RUN_LEN).take(count) {
        out.resize(
            out.len() + u16::from_le_bytes([chunk[1], chunk[2]]) as usize,
            chunk[0],
        );
    }
    out
}

fn decode_plan(frame: &[u8]) -> Result<MapBlob, DecodeError> {
    let mut r = Reader::new(frame);
    let plan = preflight(&mut r)?;
    if r.remaining() != 0 {
        return Err(DecodeError::Trailing(r.remaining()));
    }
    let total = usize::from(plan.w) * usize::from(plan.h);
    let tiles = decode_runs(plan.collision_runs, plan.collision_count, total);
    let terrain = plan.terrain.map(|p| decode_runs(p.runs, p.count, total));
    let regions = plan.regions.map(|p| decode_runs(p.runs, p.count, total));
    let public = MapPublic {
        camps: plan.camps.map_or_else(Vec::new, decode_camps),
        coliseum: plan.coliseum.map(decode_coliseum).transpose()?,
        bushes: plan.bushes.map(|p| decode_runs(p.runs, p.count, total)),
        props: plan.props.map_or_else(Vec::new, decode_props),
        ground_variants: plan
            .ground_variants
            .map(|p| decode_runs(p.runs, p.count, total)),
        patience: None,
    };
    Ok(MapBlob {
        w: plan.w,
        h: plan.h,
        layer_hash: plan.collision_hash,
        tiles,
        terrain,
        regions,
        terrain_mode: plan.mode,
        semantic_hash: plan.semantic_hash,
        context_hash: plan.context_hash,
        public,
    })
}

fn le16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

/// Camp rows from a section the preflight already checked (count byte first).
fn decode_camps(section: &[u8]) -> Vec<MapCamp> {
    section[1..]
        .chunks_exact(CAMP_LEN)
        .map(|row| MapCamp {
            x: le16(row, 0),
            y: le16(row, 2),
            r: le16(row, 4),
            zone: row[6],
        })
        .collect()
}

fn prop_row(row: &[u8]) -> MapProp {
    MapProp {
        kind: row[0],
        x: le16(row, 1),
        y: le16(row, 3),
        variant: row[5],
        flags: row[6],
    }
}

fn decode_props(section: &[u8]) -> Vec<MapProp> {
    section[2..].chunks_exact(PROP_LEN).map(prop_row).collect()
}

fn decode_coliseum(section: &[u8]) -> Result<MapColiseum, DecodeError> {
    let mut r = Reader::new(section);
    let (x, y, w, h) = (r.u16()?, r.u16()?, r.u16()?, r.u16()?);
    let count = usize::from(r.u8()?);
    let mut gates = Vec::with_capacity(count);
    for _ in 0..count {
        let side = r.u8()?;
        let n = usize::from(r.u8()?);
        let mut tiles = Vec::with_capacity(n);
        for _ in 0..n {
            tiles.push(MapTile {
                x: r.u16()?,
                y: r.u16()?,
            });
        }
        gates.push(MapGate { side, tiles });
    }
    Ok(MapColiseum { x, y, w, h, gates })
}

/// Cached immutable prefix. The final mode/context tail is emitted by [`EncodedMap::write_with_mode`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedMap {
    w: u16,
    h: u16,
    layer_hash: u32,
    semantic_hash: u32,
    body: Box<[u8]>,
}
impl EncodedMap {
    /// A map without protocol 17 public sections.
    pub fn from_slices(
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
    ) -> Result<Self, EncodeError> {
        Self::from_public(w, h, tiles, terrain, regions, &MapPublic::default())
    }

    /// Server path for protocol 17: the same bytes as [`MapBlob::pre_encode`] for a map carrying `public`.
    pub fn from_public(
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
        public: &MapPublic,
    ) -> Result<Self, EncodeError> {
        let total = usize::from(w) * usize::from(h);
        if w == 0 || h == 0 || total > MAX_MAP_TILES {
            return Err(EncodeError::BadMap("size"));
        }
        if tiles.len() != total {
            return Err(EncodeError::BadMap("length"));
        }
        if tiles.iter().any(|&v| v > 2) {
            return Err(EncodeError::BadMap("run"));
        }
        validate_plane_values(terrain, regions)?;
        for plane in [terrain, regions].into_iter().flatten() {
            if plane.len() != total {
                return Err(EncodeError::BadMap("plane length"));
            }
        }
        if terrain.is_some_and(|plane| {
            plane
                .iter()
                .zip(tiles)
                .any(|(&t, &c)| !terrain_collision_compatible(t, c))
        }) {
            return Err(EncodeError::BadMap("terrain collision"));
        }
        check_public(w, h, public)?;
        let collision_hash = layer_hash(w as u32, h as u32, tiles);
        let flags = presence(terrain.is_some(), regions.is_some()) | public_presence(public);
        let semantic_hash = public_semantic_hash(w, h, terrain, regions, public);
        let collision_count = Runs { values: tiles }.count();
        let ext_static_len = EXTENSION_STATIC_HEADER_LEN
            + terrain.map_or(0, rle_len)
            + regions.map_or(0, rle_len)
            + public_len(public);
        let static_len = MAP_HEAD_LEN + RUN_LEN * collision_count + 4 + ext_static_len;
        let full_len = crate::encode::WELCOME_HEADER_LEN + static_len + EXTENSION_TAIL_LEN;
        if full_len > crate::MAX_SERVER_FRAME {
            return Err(EncodeError::TooLarge {
                len: full_len,
                max: crate::MAX_SERVER_FRAME,
            });
        }
        let mut out = Writer::with_capacity(static_len);
        out.u16(w);
        out.u16(h);
        out.u32(collision_hash);
        out.u32(collision_count as u32);
        write_runs(&mut out, tiles);
        out.u32((ext_static_len + EXTENSION_TAIL_LEN) as u32);
        out.u8(SECTION_VERSION);
        out.u8(flags);
        out.u32(semantic_hash);
        write_plane(&mut out, terrain);
        write_plane(&mut out, regions);
        write_public(&mut out, public);
        Ok(Self {
            w,
            h,
            layer_hash: collision_hash,
            semantic_hash,
            body: out.finish().into_boxed_slice(),
        })
    }

    pub fn static_bytes(&self) -> &[u8] {
        &self.body
    }
    pub fn len(&self) -> usize {
        self.body.len() + 5
    }
    pub fn is_empty(&self) -> bool {
        self.body.is_empty()
    }
    pub fn w(&self) -> u16 {
        self.w
    }
    pub fn h(&self) -> u16 {
        self.h
    }
    pub fn layer_hash(&self) -> u32 {
        self.layer_hash
    }
    pub fn semantic_hash(&self) -> u32 {
        self.semantic_hash
    }
    pub fn encoded_len_for_mode(&self, _mode: GroundMode) -> usize {
        self.len()
    }
    pub fn write_with_mode(&self, w: &mut Writer, mode: GroundMode) {
        w.bytes(&self.body);
        w.u8(mode as u8);
        w.u32(context_hash(self.layer_hash, self.semantic_hash, mode));
    }

    /// Exact static-content match for a map without public sections; hashes alone are not used as cache identity.
    pub fn matches_slices(
        &self,
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
    ) -> bool {
        self.matches_public(w, h, tiles, terrain, regions, &MapPublic::default())
    }

    /// Exact static-content match including the protocol 17 public sections, so a cache never reuses a stale blob.
    pub fn matches_public(
        &self,
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
        public: &MapPublic,
    ) -> bool {
        if self.w != w || self.h != h || tiles.len() != usize::from(w) * usize::from(h) {
            return false;
        }
        let Some((collision_runs, mut offset)) = encoded_runs(&self.body, 8) else {
            return false;
        };
        if !runs_match(collision_runs, tiles) || offset + 10 > self.body.len() {
            return false;
        }
        let ext_len =
            u32::from_le_bytes(self.body[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        if ext_len < EXTENSION_STATIC_HEADER_LEN + EXTENSION_TAIL_LEN
            || offset + ext_len - EXTENSION_TAIL_LEN != self.body.len()
        {
            return false;
        }
        if self.body[offset] != SECTION_VERSION
            || self.body[offset + 1]
                != presence(terrain.is_some(), regions.is_some()) | public_presence(public)
        {
            return false;
        }
        offset += EXTENSION_STATIC_HEADER_LEN;
        for values in [terrain, regions].into_iter().flatten() {
            let Some((runs, next)) = encoded_runs(&self.body, offset) else {
                return false;
            };
            if !runs_match(runs, values) {
                return false;
            }
            offset = next;
        }
        if check_public(w, h, public).is_err() || offset + public_len(public) != self.body.len() {
            return false;
        }
        let mut expected = Writer::with_capacity(public_len(public));
        write_public(&mut expected, public);
        self.body[offset..] == expected.finish()[..]
    }

    /// [`Self::matches_public`] for a blob that may also carry dressing (props, ground variants): every section but those
    /// two must match `public` exactly, and the dressing the blob carries must pass the decoder's checks. `public`'s own
    /// dressing is ignored. A cold path (room start, pool tests), never per tick: it decodes the blob once.
    pub fn matches_public_any_dressing(
        &self,
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
        public: &MapPublic,
    ) -> bool {
        let mut out = Writer::with_capacity(self.len());
        self.write_with_mode(&mut out, GroundMode::Off);
        let bytes = out.finish();
        let Ok(decoded) = MapBlob::read(&mut Reader::new(&bytes)) else {
            return false;
        };
        let dressed = MapPublic {
            props: decoded.public.props,
            ground_variants: decoded.public.ground_variants,
            ..public.clone()
        };
        self.matches_public(w, h, tiles, terrain, regions, &dressed)
    }
}

fn write_runs(w: &mut Writer, values: &[u8]) {
    for (value, count) in (Runs { values }) {
        w.u8(value);
        w.u16(count);
    }
}

fn encoded_runs(bytes: &[u8], count_offset: usize) -> Option<(&[u8], usize)> {
    if count_offset.checked_add(4)? > bytes.len() {
        return None;
    }
    let count = u32::from_le_bytes(bytes[count_offset..count_offset + 4].try_into().ok()?) as usize;
    let start = count_offset + 4;
    let end = start.checked_add(count.checked_mul(RUN_LEN)?)?;
    Some((bytes.get(start..end)?, end))
}

fn runs_match(runs: &[u8], values: &[u8]) -> bool {
    let mut expected = Runs { values };
    let mut actual = runs.chunks_exact(RUN_LEN);
    loop {
        match (expected.next(), actual.next()) {
            (None, None) => return true,
            (Some((v, n)), Some(bytes))
                if v == bytes[0] && n == u16::from_le_bytes([bytes[1], bytes[2]]) => {}
            _ => return false,
        }
    }
}

// Reader support is intentionally narrow: the map preflight needs to compare the scan pass's exact consumed prefix.

#[cfg(test)]
mod dressing_match_tests {
    use super::*;

    fn props() -> Vec<MapProp> {
        vec![
            MapProp {
                kind: 1,
                x: 16,
                y: 16,
                variant: 0,
                flags: PROP_FLAG_TALL,
            },
            MapProp {
                kind: 2,
                x: 40,
                y: 70,
                variant: 3,
                flags: 0,
            },
        ]
    }

    /// A dressed and an undressed blob of one map both match that map; neither matches another map, and a blob whose
    /// non-dressing sections differ (camps) never matches.
    #[test]
    fn a_blob_matches_its_map_with_or_without_dressing() {
        let tiles = vec![0u8; 12];
        let plain = MapPublic::default();
        let dressing = MapPublic {
            props: props(),
            ground_variants: Some((0..12).map(|i| (i % 4) as u8).collect()),
            ..MapPublic::default()
        };
        let undressed = EncodedMap::from_public(4, 3, &tiles, None, None, &plain).unwrap();
        let dressed = EncodedMap::from_public(4, 3, &tiles, None, None, &dressing).unwrap();
        let camps = MapPublic {
            camps: vec![MapCamp {
                x: 16,
                y: 16,
                r: 40,
                zone: 1,
            }],
            ..MapPublic::default()
        };
        let mut other = tiles.clone();
        other[5] = 1;
        for blob in [&undressed, &dressed] {
            assert!(blob.matches_public_any_dressing(4, 3, &tiles, None, None, &plain));
            // The caller's own dressing is ignored: only the blob's counts.
            assert!(blob.matches_public_any_dressing(4, 3, &tiles, None, None, &dressing));
            assert!(!blob.matches_public_any_dressing(4, 3, &other, None, None, &plain));
            assert!(!blob.matches_public_any_dressing(4, 3, &tiles, None, None, &camps));
        }
        // The exact match stays exact: a dressed blob is not the undressed map's blob.
        assert!(!dressed.matches_public(4, 3, &tiles, None, None, &plain));
    }
}
