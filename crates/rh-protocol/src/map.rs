//! Canonical collision map and optional public ground planes.

use crate::codec::{DecodeError, EncodeError, Reader, Writer};
use crate::ground::{
    context_hash, semantic_hash, validate_plane_values, GroundMode, PRESENCE_REGIONS,
    PRESENCE_TERRAIN, SECTION_VERSION,
};

/// Maximum cells in any map plane.
pub const MAX_MAP_TILES: usize = 1024 * 1024;
const MAP_HEAD_LEN: usize = 12;
const RUN_LEN: usize = 3;
const EXTENSION_STATIC_HEADER_LEN: usize = 6;
const EXTENSION_TAIL_LEN: usize = 5;
const MAX_CUMULATIVE_RUNS: usize = 3 * MAX_MAP_TILES;
const MAX_DECODED_PLANES: usize = 3 * MAX_MAP_TILES;

/// Most camp markers a map may carry (legacy: 5 zones x 10 camps).
pub const MAX_MAP_CAMPS: usize = 64;
/// Most coliseum gates (legacy: four, one per side).
pub const MAX_COLISEUM_GATES: usize = 8;
/// Most tiles in one gate (legacy: GATE_W = 4).
pub const MAX_GATE_TILES: usize = 16;
/// Most cosmetic props (reserved section; ships empty).
pub const MAX_MAP_PROPS: usize = 8192;

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

/// A cosmetic prop (reserved section; ships empty).
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
    /// Row-major ground-variant plane (reserved; ships absent).
    pub ground_variants: Option<Vec<u8>>,
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

    /// Attaches the protocol 17 public sections, recomputes the hashes and checks the whole map.
    /// STUB (P-WIRE17-MAP-1 oracle): stores the sections without encoding or validating them.
    pub fn with_public(mut self, public: MapPublic) -> Result<Self, EncodeError> {
        self.public = public;
        Ok(self)
    }

    fn runs(&self) -> Runs<'_> {
        Runs {
            values: &self.tiles,
        }
    }
    fn presence(&self) -> u8 {
        presence(self.terrain.is_some(), self.regions.is_some())
    }

    fn collision_encoded_len(&self) -> usize {
        MAP_HEAD_LEN + RUN_LEN * self.runs().count()
    }
    fn extension_static_len(&self) -> usize {
        EXTENSION_STATIC_HEADER_LEN
            + self.terrain.as_deref().map_or(0, rle_len)
            + self.regions.as_deref().map_or(0, rle_len)
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
        if self.semantic_hash
            != semantic_hash(
                self.w,
                self.h,
                self.presence(),
                self.terrain.as_deref(),
                self.regions.as_deref(),
            )
        {
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
    if flags & !(PRESENCE_TERRAIN | PRESENCE_REGIONS) != 0 {
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
    let actual_semantic_hash = hash_semantic_runs(w, h, flags, terrain, regions, total);
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
        mode,
        context_hash,
    })
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
    let planes =
        1 + usize::from(flags & PRESENCE_TERRAIN != 0) + usize::from(flags & PRESENCE_REGIONS != 0);
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

fn hash_semantic_runs(
    w: u16,
    h: u16,
    flags: u8,
    terrain: Option<PlanePlan<'_>>,
    regions: Option<PlanePlan<'_>>,
    total: usize,
) -> u32 {
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
    for plan in [terrain, regions].into_iter().flatten() {
        for chunk in plan.runs.chunks_exact(RUN_LEN).take(plan.count) {
            for _ in 0..u16::from_le_bytes([chunk[1], chunk[2]]) {
                update(&mut state, &[chunk[0]]);
            }
        }
    }
    let _ = total;
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
        public: MapPublic::default(),
    })
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
    pub fn from_slices(
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
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
        let collision_hash = layer_hash(w as u32, h as u32, tiles);
        let flags = presence(terrain.is_some(), regions.is_some());
        let semantic_hash = semantic_hash(w, h, flags, terrain, regions);
        let collision_count = Runs { values: tiles }.count();
        let static_len = MAP_HEAD_LEN
            + RUN_LEN * collision_count
            + 4
            + EXTENSION_STATIC_HEADER_LEN
            + terrain.map_or(0, rle_len)
            + regions.map_or(0, rle_len);
        let full_len = crate::encode::WELCOME_HEADER_LEN + static_len + EXTENSION_TAIL_LEN;
        if full_len > crate::MAX_SERVER_FRAME {
            return Err(EncodeError::TooLarge {
                len: full_len,
                max: crate::MAX_SERVER_FRAME,
            });
        }
        let ext_static_len =
            EXTENSION_STATIC_HEADER_LEN + terrain.map_or(0, rle_len) + regions.map_or(0, rle_len);
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
        Ok(Self {
            w,
            h,
            layer_hash: collision_hash,
            semantic_hash,
            body: out.finish().into_boxed_slice(),
        })
    }

    /// Server path for protocol 17: the same bytes as [`MapBlob::pre_encode`] for a map carrying `public`.
    /// STUB (P-WIRE17-MAP-1 oracle): ignores `public`.
    pub fn from_public(
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
        public: &MapPublic,
    ) -> Result<Self, EncodeError> {
        let _ = public;
        Self::from_slices(w, h, tiles, terrain, regions)
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

    /// Exact static-content match; hashes alone are not used as cache identity.
    pub fn matches_slices(
        &self,
        w: u16,
        h: u16,
        tiles: &[u8],
        terrain: Option<&[u8]>,
        regions: Option<&[u8]>,
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
            || self.body[offset + 1] != presence(terrain.is_some(), regions.is_some())
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
        offset == self.body.len()
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
