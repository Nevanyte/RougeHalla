//! Zone-themed camp buffs (P-CAMP-BUFF-THEMES-1): unreleased legacy a7b5c4ce `packages/shared/src/rosters.ts`
//! `rollCampRosters` (:232), with caller-supplied draws. Used only under `SimConfig::camp_buffs = Themed`; the default
//! keeps [`super::rosters::roll_camp_types`].
//!
//! A camp's BUFF is the stat kind its normal kills pay, one of the nine of [`stat_index`] (legacy `MOB_STAT_KEYS`); a
//! zone's THEME is the four its own normal types pay. The roll (rosters.ts:1-24): a weighted draw in a shuffled camp
//! order, a draw-free repair toward every buff within a bound of every camp and an even spread, then the types.
//! Every operation follows the legacy code in its order (f64 where legacy uses a JS number on fractions, whole numbers
//! where legacy's are whole: the distances are an `Int32Array`, the repair's sums whole world units).
use super::{normal_types_of, MobTypeId};
use crate::constants::{
    CAMP_BUFF_BALANCE_POWER, CAMP_BUFF_MAX_DISTANCE_TILES, CAMP_BUFF_NEED_CAP_TILES,
    CAMP_BUFF_NEED_REF_TILES, CAMP_BUFF_OFF_THEME_WEIGHT, CAMP_BUFF_REPAIR_STEPS, TILE,
};
use crate::modifiers::farm::{RewardStat, DEFINITION as FARM};
use crate::FactionId;

/// What the roll reads of a camp (legacy `CampSite`, rosters.ts:36): its zone and its centre in world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CampSite {
    pub zone: FactionId,
    pub x: f64,
    pub y: f64,
}

/// One camp's roll (legacy `CampRoll`, rosters.ts:39-44).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampRoll {
    /// The camp's normal mob type: always one of its own zone's four.
    pub mob_type: MobTypeId,
    /// The normal type whose stat its normal kills pay when that is not `mob_type` (an off-theme buff); `None` when it
    /// is (legacy `buff: ""`).
    pub buff: Option<MobTypeId>,
}

/// The stat kind of every normal type's farm reward, in catalog order of first type (legacy `MOB_STAT_KEYS`,
/// a7b5c4ce mobStats.ts:112: `[...new Set(MOB_STAT_REWARDS.map(mobStatKey))]`; `FARM.rows` is `MOB_STAT_REWARDS`'
/// order). Nine kinds; their count is legacy `B` (rosters.ts:57).
fn stat_keys() -> Vec<RewardStat> {
    let mut keys: Vec<RewardStat> = Vec::new();
    for row in FARM.rows.iter() {
        if !keys.contains(&row.stat) {
            keys.push(row.stat);
        }
    }
    keys
}

/// The index of the stat kind normal type `t` pays (legacy `MOB_STAT_KEYS.indexOf(statKeyOf(t))`); `None` for an elite.
pub(crate) fn stat_index(t: MobTypeId) -> Option<usize> {
    let stat = FARM.rows.iter().find(|r| r.mob == t)?.stat;
    stat_keys().iter().position(|k| *k == stat)
}

/// By stat index, the zone's normal type that pays it, `None` off its theme (legacy `zoneStatTypes`, rosters.ts:273-281:
/// the first of the zone's normal types in catalog order).
pub(crate) fn zone_stat_types(zone: FactionId) -> Vec<Option<MobTypeId>> {
    (0..stat_keys().len())
        .map(|b| {
            normal_types_of(zone)
                .map(|t| t.id)
                .find(|&t| stat_index(t) == Some(b))
        })
        .collect()
}

/// One draw of the source Rng contract (finite in [0, 1)), as [`super::rosters::roll_zone_types`] checks it.
fn draw(rng: &mut impl FnMut() -> f64) -> f64 {
    let v = rng();
    assert!(
        v.is_finite() && (0.0..1.0).contains(&v),
        "draw outside source Rng domain"
    );
    v
}

/// Centre-to-centre distances in whole world units, row-major n x n (legacy `distances`, rosters.ts:61-73:
/// `Math.round(Math.sqrt(dx * dx + dy * dy))` stored in an `Int32Array`).
fn distances(camps: &[CampSite]) -> Vec<i32> {
    let n = camps.len();
    let mut d = vec![0i32; n * n];
    for i in 0..n {
        for j in i + 1..n {
            let (dx, dy) = (camps[i].x - camps[j].x, camps[i].y - camps[j].y);
            let v = crate::math::js_round(crate::math::sqrt(dx * dx + dy * dy)) as i32;
            d[i * n + j] = v;
            d[j * n + i] = v;
        }
    }
    d
}

/// Legacy `boundsOf` (rosters.ts:75-87): CAMP_BUFF_MAX_DISTANCE_TILES, or the camp's ninth-nearest camp (itself first)
/// where that is farther.
fn bounds_of(d: &[i32], n: usize, b_len: usize) -> Vec<i32> {
    let floor = crate::math::js_round(CAMP_BUFF_MAX_DISTANCE_TILES * TILE) as i32;
    let k = b_len.min(n) - 1;
    let mut row = vec![0i32; n];
    (0..n)
        .map(|c| {
            row.copy_from_slice(&d[c * n..(c + 1) * n]);
            row.sort_unstable();
            floor.max(row[k])
        })
        .collect()
}

/// Phase 1, the weighted draw (legacy `drawBuffs`, rosters.ts:113-148): each camp's stat index. Draws `2n - 1`.
fn draw_buffs(
    n: usize,
    b_len: usize,
    d: &[i32],
    theme: &[bool],
    rng: &mut impl FnMut() -> f64,
) -> Vec<usize> {
    let mut stat = vec![usize::MAX; n];
    let mut count = vec![0u32; b_len];
    let cap = CAMP_BUFF_NEED_CAP_TILES * TILE;
    let reference = CAMP_BUFF_NEED_REF_TILES * TILE;
    // near[c * b_len + b]: distance from camp c to the nearest camp given b so far, capped.
    let mut near = vec![cap; n * b_len];
    let share = n as f64 / b_len as f64;
    // Legacy `shuffle` (rng.ts:47-55): Fisher-Yates from the end, `randInt(rng, 0, i + 1)`.
    let mut order: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        let j = (draw(rng) * (i + 1) as f64).floor() as usize;
        order.swap(i, j);
    }
    let mut w = vec![0f64; b_len];
    for c in order {
        let mut total = 0.;
        for b in 0..b_len {
            let r = near[c * b_len + b] / reference;
            let bal = share / (count[b] + 1) as f64;
            let mut balance = 1.;
            for _ in 0..CAMP_BUFF_BALANCE_POWER {
                balance *= bal;
            }
            let v = (if theme[c * b_len + b] {
                1.
            } else {
                CAMP_BUFF_OFF_THEME_WEIGHT
            }) * (1. + r * r)
                * balance;
            w[b] = v;
            total += v;
        }
        let mut x = draw(rng) * total;
        let mut pick = b_len - 1;
        for (b, wb) in w.iter().enumerate() {
            x -= wb;
            if x < 0. {
                pick = b;
                break;
            }
        }
        stat[c] = pick;
        count[pick] += 1;
        for j in 0..n {
            let v = f64::from(d[j * n + c]);
            if v < near[j * b_len + pick] {
                near[j * b_len + pick] = v;
            }
        }
    }
    stat
}

/// Phase 2's tables (legacy `repairBuffs` locals, rosters.ts:151-186).
struct Repair<'a> {
    n: usize,
    d: &'a [i32],
    cover: bool,
    bound: Vec<i32>,
    /// Per buff b and camp c: the nearest camp of b (index, -1 for none), its distance and the second nearest's.
    near_i: Vec<i32>,
    d1: Vec<i32>,
    d2: Vec<i32>,
    ex: Vec<i64>,
}

impl Repair<'_> {
    fn rebuild(&mut self, stat: &[usize], b: usize) {
        let n = self.n;
        // Legacy `FAR` (rosters.ts:58): the distance to a buff no camp pays.
        let far = 1i32 << 28;
        let mut sum = 0i64;
        for c in 0..n {
            let (mut bi, mut bd, mut sd) = (-1i32, far, far);
            for (j, &s) in stat.iter().enumerate() {
                if s != b {
                    continue;
                }
                let v = self.d[c * n + j];
                if v < bd {
                    sd = bd;
                    bd = v;
                    bi = j as i32;
                } else if v < sd {
                    sd = v;
                }
            }
            self.near_i[b * n + c] = bi;
            self.d1[b * n + c] = bd;
            self.d2[b * n + c] = sd;
            if self.cover && bd > self.bound[c] {
                sum += i64::from(bd - self.bound[c]);
            }
        }
        self.ex[b] = sum;
    }

    /// The excess of buff b once camp `rem` leaves it and camp `add` joins it (legacy `exAfter`, -1 = `None`).
    fn ex_after(&self, b: usize, rem: Option<usize>, add: Option<usize>) -> i64 {
        if !self.cover {
            return 0;
        }
        let n = self.n;
        let mut sum = 0i64;
        for c in 0..n {
            let mut v = if rem.is_some_and(|r| self.near_i[b * n + c] == r as i32) {
                self.d2[b * n + c]
            } else {
                self.d1[b * n + c]
            };
            if let Some(a) = add {
                if self.d[c * n + a] < v {
                    v = self.d[c * n + a];
                }
            }
            if v > self.bound[c] {
                sum += i64::from(v - self.bound[c]);
            }
        }
        sum
    }
}

/// Phase 2, the repair (legacy `repairBuffs`, rosters.ts:151-226): at most CAMP_BUFF_REPAIR_STEPS best moves, no draws.
fn repair_buffs(n: usize, b_len: usize, d: &[i32], theme: &[bool], stat: &mut [usize]) {
    let th = |c: usize, b: usize| i64::from(theme[c * b_len + b]);
    let (lo, hi) = ((n / b_len) as i64, n.div_ceil(b_len) as i64);
    let mut count = vec![0i64; b_len];
    for &s in stat.iter() {
        count[s] += 1;
    }
    let mut r = Repair {
        n,
        d,
        // With fewer camps than buffs some buff is missing whatever the roll: only the counts and theme count.
        cover: n >= b_len,
        bound: bounds_of(d, n, b_len),
        near_i: vec![0; b_len * n],
        d1: vec![0; b_len * n],
        d2: vec![0; b_len * n],
        ex: vec![0; b_len],
    };
    for b in 0..b_len {
        r.rebuild(stat, b);
    }
    let band = |k: i64| {
        if k < lo {
            lo - k
        } else if k > hi {
            k - hi
        } else {
            0
        }
    };
    for _ in 0..CAMP_BUFF_REPAIR_STEPS {
        // key = 25 dEx + 5 dBand - dTheme; only a move below 0 improves; the first found wins a tie (camp order, then
        // buff order, then the swap's other camp).
        let mut best_key = 0i64;
        let mut best: Option<(usize, Option<usize>, usize)> = None;
        for k in 0..n {
            let a = stat[k];
            let th_a = th(k, a);
            let mut ex_left: Option<i64> = None;
            for b in 0..b_len {
                if b == a {
                    continue;
                }
                let rest = 5
                    * (band(count[a] - 1) + band(count[b] + 1) - band(count[a]) - band(count[b]))
                    - (th(k, b) - th_a);
                // A lower bound of the key (legacy's pruning, which never changes the winner).
                if rest - 25 * r.ex[b] >= best_key {
                    continue;
                }
                let left = *ex_left.get_or_insert_with(|| r.ex_after(a, Some(k), None) - r.ex[a]);
                let key = 25 * (left + r.ex_after(b, None, Some(k)) - r.ex[b]) + rest;
                if key < best_key {
                    best_key = key;
                    best = Some((k, None, b));
                }
            }
            for (l, &b) in stat.iter().enumerate().skip(k + 1) {
                if b == a {
                    continue;
                }
                // A swap keeps the counts.
                let rest = th_a + th(l, b) - th(k, b) - th(l, a);
                if rest - 25 * (r.ex[a] + r.ex[b]) >= best_key {
                    continue;
                }
                let key = 25
                    * (r.ex_after(a, Some(k), Some(l)) - r.ex[a] + r.ex_after(b, Some(l), Some(k))
                        - r.ex[b])
                    + rest;
                if key < best_key {
                    best_key = key;
                    best = Some((k, Some(l), b));
                }
            }
        }
        let Some((k, l, b)) = best else { return };
        let a = stat[k];
        stat[k] = b;
        match l {
            Some(l) => stat[l] = a,
            None => {
                count[a] -= 1;
                count[b] += 1;
            }
        }
        r.rebuild(stat, a);
        r.rebuild(stat, b);
    }
}

/// The type that pays stat `b` in the zone of the nearest camp (camp order on a tie) whose zone has it on theme; with
/// none on this map, the first zone's in `FactionId::ALL` order (legacy `spillType`, rosters.ts:284-295).
fn spill_type(zone_rows: &[Vec<Option<MobTypeId>>], d: &[i32], c: usize, b: usize) -> MobTypeId {
    let n = zone_rows.len();
    let mut best: Option<(i32, MobTypeId)> = None;
    for (j, row) in zone_rows.iter().enumerate() {
        if let Some(t) = row[b] {
            if best.is_none_or(|(bd, _)| d[c * n + j] < bd) {
                best = Some((d[c * n + j], t));
            }
        }
    }
    best.map(|(_, t)| t)
        .or_else(|| FactionId::ALL.iter().find_map(|&z| zone_stat_types(z)[b]))
        .expect("every stat kind is on some zone's theme")
}

/// Every camp's roll, in camp order (legacy `rollCampRosters`): draws exactly `2n - 1` numbers for `n` camps (`n - 1`
/// for the shuffle of the camp order, one buff draw a camp), none for a map without camps. Draws must obey the source
/// Rng contract: finite in [0, 1).
pub fn roll_camp_rosters(camps: &[CampSite], rng: &mut impl FnMut() -> f64) -> Vec<CampRoll> {
    let n = camps.len();
    if n == 0 {
        return Vec::new();
    }
    let d = distances(camps);
    let b_len = stat_keys().len();
    let zone_rows: Vec<Vec<Option<MobTypeId>>> =
        camps.iter().map(|c| zone_stat_types(c.zone)).collect();
    let theme: Vec<bool> = zone_rows
        .iter()
        .flat_map(|row| row.iter().map(Option::is_some))
        .collect();
    let mut stat = draw_buffs(n, b_len, &d, &theme, rng);
    repair_buffs(n, b_len, &d, &theme, &mut stat);

    // Phase 3 (rosters.ts:244-266): on theme, the zone's type that pays the buff; off theme, the zone's least used type
    // and the buff from the nearest zone that has it on theme.
    let mut used = [0u32; MobTypeId::ALL.len()];
    let mut out: Vec<Option<CampRoll>> = vec![None; n];
    for c in 0..n {
        if let Some(t) = zone_rows[c][stat[c]] {
            out[c] = Some(CampRoll {
                mob_type: t,
                buff: None,
            });
            used[t as usize] += 1;
        }
    }
    for c in 0..n {
        if out[c].is_some() {
            continue;
        }
        // A tie goes to the first in catalog order counted from the camp's index.
        let types: Vec<MobTypeId> = normal_types_of(camps[c].zone).map(|t| t.id).collect();
        let mut pick: Option<(u32, MobTypeId)> = None;
        for k in 0..types.len() {
            let t = types[(c + k) % types.len()];
            let u = used[t as usize];
            if pick.is_none_or(|(least, _)| u < least) {
                pick = Some((u, t));
            }
        }
        let (least, t) = pick.expect("a zone has normal types");
        used[t as usize] = least + 1;
        out[c] = Some(CampRoll {
            mob_type: t,
            buff: Some(spill_type(&zone_rows, &d, c, stat[c])),
        });
    }
    out.into_iter()
        .map(|r| r.expect("every camp rolled"))
        .collect()
}
