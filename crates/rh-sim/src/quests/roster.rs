//! Source `selectQuests`: the run's twenty offers, at least two of each verb, dealt from shuffled per-kind pools, a shuffled
//! kind cycle for the rest, and the first `known` of a privately shuffled order public. Deterministic per stream.
use super::catalog::{Kind, DEFINITION};
use crate::constants::{QUEST_COUNT, QUEST_KNOWN_COUNT};

/// One roster offer: a catalog row index and whether it is public from the start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RosterEntry {
    pub def: usize,
    pub known: bool,
}

fn shuffled_indices(xs: &[usize], random: &mut impl FnMut() -> f64) -> Vec<usize> {
    let mut out = xs.to_vec();
    for i in (1..out.len()).rev() {
        let j = (random() * (i + 1) as f64).floor() as usize;
        out.swap(i, j);
    }
    out
}

/// Source `selectQuests(random, count = QUEST_COUNT, known = QUEST_KNOWN_COUNT)`.
pub fn select_quests(random: &mut impl FnMut() -> f64) -> Vec<RosterEntry> {
    let count = QUEST_COUNT as usize;
    let known = QUEST_KNOWN_COUNT as usize;
    let kinds = Kind::ALL;
    let mut pools: Vec<Vec<usize>> = kinds
        .iter()
        .map(|k| {
            let rows: Vec<usize> = DEFINITION
                .iter()
                .enumerate()
                .filter(|(_, d)| d.kind == *k)
                .map(|(i, _)| i)
                .collect();
            shuffled_indices(&rows, random)
        })
        .collect();
    let mut picked: Vec<usize> = Vec::new();
    let take = |kind: usize, pools: &mut Vec<Vec<usize>>, picked: &mut Vec<usize>| -> bool {
        match pools[kind].pop() {
            Some(def) => {
                picked.push(def);
                true
            }
            None => false,
        }
    };
    for kind in 0..kinds.len() {
        take(kind, &mut pools, &mut picked);
        take(kind, &mut pools, &mut picked);
    }
    let cycle = shuffled_indices(&(0..kinds.len()).collect::<Vec<_>>(), random);
    let mut i = 0usize;
    while picked.len() < count && pools.iter().any(|p| !p.is_empty()) {
        take(cycle[i % cycle.len()], &mut pools, &mut picked);
        i += 1;
    }
    let order = shuffled_indices(&picked, random);
    order
        .into_iter()
        .enumerate()
        .map(|(i, def)| RosterEntry {
            def,
            known: i < known,
        })
        .collect()
}
