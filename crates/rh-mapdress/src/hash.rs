//! Integer hash noise: no RNG state, no floats. Every stage is seeded from the map hash and the stage/rule name.

/// splitmix64 finaliser.
pub fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// FNV-1a over the bytes of a name.
pub fn fnv(name: &str) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for b in name.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01B3);
    }
    h
}

/// The seed of one stage or rule: map hash and name.
pub fn stage_seed(map_hash: u64, name: &str) -> u64 {
    mix(map_hash ^ mix(fnv(name)))
}

/// A hash of `seed` and up to three integers.
pub fn at(seed: u64, a: u64, b: u64, c: u64) -> u64 {
    mix(seed ^ mix(a.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ mix(b ^ mix(c.wrapping_add(0x1234_5678)))))
}

/// A probability threshold out of 10000 from a density (props per 100 candidates).
pub fn threshold(density: f64) -> u64 {
    let t = (density * 100.0).round();
    if t <= 0.0 {
        0
    } else if t >= 10_000.0 {
        10_000
    } else {
        t as u64
    }
}

/// Smooth-ish value noise in 0..=65535 on a lattice of `CELL` tiles (integer bilinear interpolation).
pub fn value_noise(seed: u64, tx: u32, ty: u32) -> u32 {
    const CELL: u32 = 6;
    let (gx, fx) = (tx / CELL, tx % CELL);
    let (gy, fy) = (ty / CELL, ty % CELL);
    let v = |x: u32, y: u32| (at(seed, u64::from(x), u64::from(y), 77) & 0xFFFF) as u32;
    let (v00, v10, v01, v11) = (v(gx, gy), v(gx + 1, gy), v(gx, gy + 1), v(gx + 1, gy + 1));
    let top = v00 * (CELL - fx) + v10 * fx;
    let bot = v01 * (CELL - fx) + v11 * fx;
    ((u64::from(top) * u64::from(CELL - fy) + u64::from(bot) * u64::from(fy))
        / u64::from(CELL * CELL)) as u32
}
