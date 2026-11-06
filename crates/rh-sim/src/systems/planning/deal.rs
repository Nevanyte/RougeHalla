//! Source planning.ts deal/search order and shared/planning.ts walking contours.
use crate::{mapdata::ZoneSpawn, pathfind::Pathfinder, TileMap, Vec2};

pub(super) const WALK_TOLERANCE: f64 = 0.08;
const TIER_EPS: f64 = 1e-12;
pub(super) const SEARCH_BUDGET: usize = 20_000;
pub(super) const SPARE_BUDGET: usize = 1_500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Rule {
    None,
    Global,
    Pairs,
    Fallback,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub rule: Rule,
    pub tier_pairs: usize,
    pub pairs: usize,
    pub same_zone_pairs: usize,
    pub shared: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(super) struct Deal {
    pub pairs: Vec<[i32; 2]>,
    pub report: Report,
}
#[derive(Clone, Copy)]
struct Pair {
    i: usize,
    j: usize,
    tier: bool,
    same_zone: bool,
    ratio: f64,
}

/// None is the source's unreachable Infinity, never a serialized nonfinite number.
pub(crate) fn spawn_walks(map: &TileMap) -> Vec<Option<f64>> {
    let Some(layers) = map.layers() else {
        return Vec::new();
    };
    let centre = layers.coliseum().centre;
    let mut pf = Pathfinder::default();
    let mut path = Vec::new();
    layers
        .data()
        .spawn_pool
        .iter()
        .map(|spawn| {
            let from = Vec2::new(spawn.x, spawn.y);
            pf.find_path_into(
                map,
                from,
                Vec2::new(centre.x, centre.y),
                crate::constants::PLAYER_RADIUS,
                &mut path,
            );
            if path.is_empty() {
                return None;
            }
            let mut total = 0.;
            let mut at = from;
            for next in &path {
                let dx = next.x - at.x;
                let dy = next.y - at.y;
                total += crate::math::sqrt(dx * dx + dy * dy);
                at = *next;
            }
            Some(total)
        })
        .collect()
}
pub(super) fn same_tier(a: f64, b: f64, tolerance: f64) -> bool {
    a.is_finite()
        && b.is_finite()
        && a > 0.
        && b > 0.
        && a.max(b) <= ((1. + tolerance) / (1. - tolerance)) * a.min(b) * (1. + TIER_EPS)
}
fn shuffle<T: Clone>(values: &[T], rng: &mut impl FnMut() -> f64) -> Vec<T> {
    let mut out = values.to_vec();
    for k in (1..out.len()).rev() {
        let j = (rng() * (k + 1) as f64).floor() as usize;
        out.swap(k, j);
    }
    out
}
fn disjoint(
    pairs: &[Pair],
    need: usize,
    pool: usize,
    spare: Option<usize>,
    secondary_from: usize,
    max_secondary: usize,
    budget: usize,
) -> Option<Vec<Pair>> {
    struct Search<'a> {
        pairs: &'a [Pair],
        need: usize,
        used: Vec<bool>,
        free: usize,
        out: Vec<Pair>,
        secondary_from: usize,
        max_secondary: usize,
        secondary: usize,
        steps: usize,
        budget: usize,
    }
    impl Search<'_> {
        fn dfs(&mut self, from: usize) -> bool {
            if self.out.len() == self.need {
                return true;
            }
            if self.free < 2 * (self.need - self.out.len()) {
                return false;
            }
            self.steps += 1;
            if self.steps > self.budget {
                return false;
            }
            for k in from..self.pairs.len() {
                if self.pairs.len() - k < self.need - self.out.len() {
                    return false;
                }
                let late = k >= self.secondary_from;
                if late && self.secondary >= self.max_secondary {
                    return false;
                }
                let p = self.pairs[k];
                if self.used[p.i] || self.used[p.j] {
                    continue;
                }
                self.used[p.i] = true;
                self.used[p.j] = true;
                self.free -= 2;
                self.out.push(p);
                if late {
                    self.secondary += 1;
                }
                if self.dfs(k + 1) {
                    return true;
                }
                if late {
                    self.secondary -= 1;
                }
                self.used[p.i] = false;
                self.used[p.j] = false;
                self.free += 2;
                self.out.pop();
                if self.steps > self.budget {
                    return false;
                }
            }
            false
        }
    }
    if need == 0 {
        return Some(Vec::new());
    }
    let mut used = vec![false; pool];
    if let Some(spare) = spare {
        used[spare] = true;
    }
    let free = used.iter().filter(|v| !**v).count();
    let mut s = Search {
        pairs,
        need,
        used,
        free,
        out: Vec::with_capacity(need),
        secondary_from,
        max_secondary,
        secondary: 0,
        steps: 0,
        budget,
    };
    if s.dfs(0) {
        Some(s.out)
    } else {
        None
    }
}
fn ordinary_disjoint(pairs: &[Pair], need: usize, pool: usize) -> Option<Vec<Pair>> {
    disjoint(pairs, need, pool, None, pairs.len(), 0, SEARCH_BUDGET)
}
fn lex_less(a: [f64; 4], b: [f64; 4]) -> bool {
    for i in 0..4 {
        if a[i] != b[i] {
            return a[i] < b[i];
        }
    }
    false
}

pub(super) fn deal(
    pool: &[ZoneSpawn],
    walks: &[Option<f64>],
    n: usize,
    rng: &mut impl FnMut() -> f64,
) -> Deal {
    let empty = Report {
        rule: Rule::None,
        tier_pairs: 0,
        pairs: 0,
        same_zone_pairs: 0,
        shared: 0,
    };
    if n == 0 {
        return Deal {
            pairs: vec![],
            report: empty,
        };
    }
    if pool.is_empty() {
        return Deal {
            pairs: vec![[-1, -1]; n],
            report: empty,
        };
    }
    if pool.len() == 1 {
        return Deal {
            pairs: vec![[0, 0]; n],
            report: Report {
                rule: Rule::Fallback,
                pairs: n,
                shared: usize::from(n > 1),
                ..empty
            },
        };
    }
    let distances: Vec<_> = walks.iter().map(|v| v.unwrap_or(f64::INFINITY)).collect();
    let mut all = Vec::new();
    for i in 0..pool.len() {
        for j in i + 1..pool.len() {
            let lo = distances[i].min(distances[j]);
            let hi = distances[i].max(distances[j]);
            all.push(Pair {
                i,
                j,
                tier: same_tier(distances[i], distances[j], WALK_TOLERANCE),
                same_zone: pool[i].zone == pool[j].zone,
                ratio: if lo.is_finite() && lo > 0. && hi.is_finite() {
                    hi / lo
                } else {
                    f64::INFINITY
                },
            });
        }
    }
    let count = n.min(pool.len() / 2);
    let tier = shuffle(
        &all.iter()
            .copied()
            .filter(|p| p.tier && !p.same_zone)
            .collect::<Vec<_>>(),
        rng,
    );
    let mut chosen = None;
    let mut rule = Rule::Pairs;
    let mut windows = Vec::new();
    let mut seen = Vec::<Vec<bool>>::new();
    for k in 0..pool.len() {
        if !distances[k].is_finite() {
            continue;
        }
        let inside: Vec<_> = distances
            .iter()
            .map(|v| *v >= distances[k] && same_tier(distances[k], *v, WALK_TOLERANCE))
            .collect();
        if seen.contains(&inside) {
            continue;
        }
        let window: Vec<_> = tier
            .iter()
            .copied()
            .filter(|p| inside[p.i] && inside[p.j])
            .collect();
        seen.push(inside);
        if window.len() >= count {
            windows.push(window);
        }
    }
    for window in shuffle(&windows, rng) {
        chosen = ordinary_disjoint(&window, count, pool.len());
        if chosen.is_some() {
            rule = Rule::Global;
            break;
        }
    }
    if chosen.is_none() && n > count && pool.len() % 2 == 1 {
        let partnered: Vec<_> = (0..pool.len())
            .filter(|k| tier.iter().any(|p| p.i == *k || p.j == *k))
            .collect();
        for spare in shuffle(&partnered, rng) {
            chosen = disjoint(
                &tier,
                count,
                pool.len(),
                Some(spare),
                tier.len(),
                0,
                SPARE_BUDGET,
            );
            if chosen.is_some() {
                break;
            }
        }
    }
    if chosen.is_none() {
        chosen = ordinary_disjoint(&tier, count, pool.len());
    }
    if chosen.is_none() {
        rule = Rule::Fallback;
        let mut near = shuffle(
            &all.iter()
                .copied()
                .filter(|p| !p.tier && !p.same_zone)
                .collect::<Vec<_>>(),
            rng,
        );
        let mut last = shuffle(
            &all.iter()
                .copied()
                .filter(|p| p.same_zone)
                .collect::<Vec<_>>(),
            rng,
        );
        // Stable sort: equal ratios (including Infinity-Infinity) retain shuffled order.
        near.sort_by(|a, b| a.ratio.total_cmp(&b.ratio));
        last.sort_by(|a, b| a.ratio.total_cmp(&b.ratio));
        let mut list = tier.clone();
        list.extend(near);
        for secondary in 1..=count {
            chosen = disjoint(
                &list,
                count,
                pool.len(),
                None,
                tier.len(),
                secondary,
                SEARCH_BUDGET,
            );
            if chosen.is_some() {
                break;
            }
        }
        if chosen.is_none() {
            let secondary_from = list.len();
            list.extend(last);
            for secondary in 1..=count {
                chosen = disjoint(
                    &list,
                    count,
                    pool.len(),
                    None,
                    secondary_from,
                    secondary,
                    SEARCH_BUDGET,
                );
                if chosen.is_some() {
                    break;
                }
            }
        }
        if chosen.is_none() {
            let mut sorted = all.clone();
            sorted.sort_by(|a, b| a.ratio.total_cmp(&b.ratio));
            chosen = Some(ordinary_disjoint(&sorted, count, pool.len()).unwrap_or_default());
        }
    }
    let mut chosen = chosen.unwrap();
    let mut uses = vec![0usize; pool.len()];
    for p in &chosen {
        uses[p.i] += 1;
        uses[p.j] += 1;
    }
    while chosen.len() < n {
        let mut best = None;
        let mut best_key = [0.; 4];
        for p in shuffle(&all, rng) {
            let key = [
                (uses[p.i] + uses[p.j]) as f64,
                f64::from(p.same_zone),
                if p.tier { 0. } else { 1. },
                p.ratio,
            ];
            if best.is_none() || lex_less(key, best_key) {
                best = Some(p);
                best_key = key;
            }
        }
        let p = best.unwrap();
        chosen.push(p);
        uses[p.i] += 1;
        uses[p.j] += 1;
    }
    let dealt = shuffle(&chosen, rng);
    let pairs = dealt
        .iter()
        .map(|p| {
            if rng() < 0.5 {
                [p.i as i32, p.j as i32]
            } else {
                [p.j as i32, p.i as i32]
            }
        })
        .collect();
    let tier_pairs = dealt.iter().filter(|p| p.tier && !p.same_zone).count();
    Deal {
        pairs,
        report: Report {
            rule: if tier_pairs < dealt.len() && rule != Rule::Fallback {
                Rule::Fallback
            } else {
                rule
            },
            tier_pairs,
            pairs: dealt.len(),
            same_zone_pairs: dealt.iter().filter(|p| p.same_zone).count(),
            shared: uses.iter().filter(|n| **n > 1).count(),
        },
    }
}

pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    word(WALK_TOLERANCE.to_bits());
    word(TIER_EPS.to_bits());
    word(SEARCH_BUDGET as u64);
    word(SPARE_BUDGET as u64);
}
