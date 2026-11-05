//! Bounded exact landmark selection with a cache owned by one runtime and planning policy.
//! Score and bound callbacks observe immutable runtime state; placement always uses its original guard.
use super::runtime::{LandmarkRuntime, LandmarkSpec, PlacedFeature};
use super::templates::{place_landmark, stamp_template, ParsedTemplate, Stamp};
use crate::mapdata::TileRect;
mod tables;
use tables::Tables;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchDefinition {
    pub default_tries: i32,
    pub origin_stride: usize,
}
pub const DEFAULT_DEFINITION: SearchDefinition = SearchDefinition {
    default_tries: 12,
    origin_stride: 2,
};
pub fn default_definition() -> SearchDefinition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &SearchDefinition, mut word: impl FnMut(u64)) {
    word(d.default_tries as u64);
    word(d.origin_stride as u64);
}

/// Original hard/open policy. Overlays implement the same fixed-policy boundary through a closure.
pub struct Original;
pub struct Planning<'a, F> {
    hard: &'a [u8],
    open: F,
}
pub trait PlanningPolicy {
    fn hard<'a>(&'a self, rt: &'a LandmarkRuntime<'_>) -> &'a [u8];
    fn open(&mut self, rt: &LandmarkRuntime<'_>, i: i32) -> bool;
}
impl PlanningPolicy for Original {
    fn hard<'a>(&'a self, rt: &'a LandmarkRuntime<'_>) -> &'a [u8] {
        rt.original_hard()
    }
    fn open(&mut self, rt: &LandmarkRuntime<'_>, i: i32) -> bool {
        rt.open(i)
    }
}
impl<F: FnMut(&LandmarkRuntime<'_>, i32) -> bool> PlanningPolicy for Planning<'_, F> {
    fn hard<'a>(&'a self, _: &'a LandmarkRuntime<'_>) -> &'a [u8] {
        self.hard
    }
    fn open(&mut self, rt: &LandmarkRuntime<'_>, i: i32) -> bool {
        (self.open)(rt, i)
    }
}

pub type Bound<'a, 'state> = dyn FnMut(&LandmarkRuntime<'state>, &TileRect, u8, bool) -> f64 + 'a;

/// Not cloneable or transferable between contexts. The exclusively borrowed runtime cannot be
/// replaced while this session exists. Interior changes to a planning closure require `reset`.
///
/// ```compile_fail
/// use rh_sim::mapgen::landmarks::{runtime::LandmarkRuntime, search::LandmarkSearch};
/// fn replace<'a, 'b>(s: &mut LandmarkSearch<'a, 'b>, other: &'a mut LandmarkRuntime<'b>) {
///     s.rt = other; // The context is fixed for the session.
/// }
/// ```
/// ```compile_fail
/// use rh_sim::mapgen::landmarks::search::LandmarkSearch;
/// fn transfer(a: &mut LandmarkSearch<'_, '_>, b: &mut LandmarkSearch<'_, '_>) {
///     b.tab = a.tab.take(); // A foreign cache cannot be attached.
/// }
/// ```
/// ```compile_fail
/// use rh_sim::mapgen::landmarks::{runtime::LandmarkRuntime, search::LandmarkSearch};
/// fn mutate(s: &mut LandmarkSearch<'_, '_>) {
///     let _: &mut LandmarkRuntime<'_> = s.runtime(); // Observation is read-only.
/// }
/// ```
pub struct LandmarkSearch<'session, 'state, P = Original> {
    rt: &'session mut LandmarkRuntime<'state>,
    policy: P,
    tab: Option<Tables>,
    definition: SearchDefinition,
    #[cfg(test)]
    diagnostics: Vec<serde_json::Value>,
}
impl<'session, 'state> LandmarkSearch<'session, 'state, Original> {
    pub fn new(rt: &'session mut LandmarkRuntime<'state>) -> Self {
        Self::from_policy(rt, Original)
    }
    pub fn with_planning<'a, F: FnMut(&LandmarkRuntime<'_>, i32) -> bool>(
        rt: &'session mut LandmarkRuntime<'state>,
        hard: &'a [u8],
        open: F,
    ) -> LandmarkSearch<'session, 'state, Planning<'a, F>> {
        assert_eq!(hard.len(), rt.state().tiles.len());
        LandmarkSearch::from_policy(rt, Planning { hard, open })
    }
}
impl<'session, 'state, P: PlanningPolicy> LandmarkSearch<'session, 'state, P> {
    fn from_policy(rt: &'session mut LandmarkRuntime<'state>, policy: P) -> Self {
        Self {
            rt,
            policy,
            tab: None,
            definition: DEFAULT_DEFINITION,
            #[cfg(test)]
            diagnostics: Vec::new(),
        }
    }
    pub fn with_definition(mut self, definition: SearchDefinition) -> Self {
        assert!(definition.origin_stride > 0);
        self.definition = definition;
        self.reset();
        self
    }
    pub fn runtime(&self) -> &LandmarkRuntime<'state> {
        self.rt
    }
    /// Read-only test evidence for actual recipe/search composition; absent from production builds.
    #[cfg(test)]
    pub(crate) fn diagnostics(&self) -> &[serde_json::Value] {
        &self.diagnostics
    }
    pub fn reset(&mut self) {
        self.tab = None;
        #[cfg(test)]
        self.diagnostics.push(serde_json::json!({"type":"reset"}));
    }
    /// Reservations are invisible to the source checksum, so explicitly forget fit tables.
    pub fn reserve(&mut self, i: i32) {
        self.rt.reserve(i);
        self.reset();
    }
    /// External placement is detected by feature count / box sum on the next search.
    pub fn place_whole(&mut self, spec: &LandmarkSpec) -> Option<PlacedFeature> {
        self.rt.place_whole(spec)
    }
    pub fn place_stamp(
        &mut self,
        t: &ParsedTemplate,
        s: &Stamp,
        rot: u8,
        mirror: bool,
    ) -> Option<PlacedFeature> {
        place_landmark(self.rt, t, s, rot, mirror)
    }
    pub fn best_default(
        &mut self,
        t: &ParsedTemplate,
        score: impl FnMut(&LandmarkRuntime<'state>, &Stamp, u8, bool) -> f64,
        bound: Option<&mut Bound<'_, 'state>>,
    ) -> Option<PlacedFeature> {
        self.best(t, score, self.definition.default_tries, bound)
    }
    pub fn best(
        &mut self,
        t: &ParsedTemplate,
        mut score: impl FnMut(&LandmarkRuntime<'state>, &Stamp, u8, bool) -> f64,
        tries: i32,
        mut bound: Option<&mut Bound<'_, 'state>>,
    ) -> Option<PlacedFeature> {
        let rebuild = self.tab.as_ref().is_none_or(|tab| !tab.valid(self.rt));
        if rebuild {
            self.tab = Some(Tables::build(self.rt, &mut self.policy));
        }
        #[cfg(test)]
        self.diagnostics.push(
            serde_json::json!({"type":if rebuild {"build"} else {"reuse"},"tables":self.tab}),
        );
        let tab = self.tab.as_ref().unwrap();
        let candidates = tab.candidates(self.rt, t, self.definition.origin_stride);
        #[cfg(test)]
        self.diagnostics
            .push(serde_json::json!({"type":"candidates","values":candidates}));
        let keep = tries.max(0) as usize;
        let mut top = Vec::<Ranked>::new();
        let mut bounds = Vec::new();
        let mut heap = Vec::new();
        if keep > 0 && candidates.len() > keep {
            if let Some(bound) = bound.as_mut() {
                for &(origin, o) in &candidates {
                    let ori = &t.orientations[o as usize];
                    let w = self.rt.state().w;
                    let b = bound(
                        self.rt,
                        &TileRect {
                            x: origin % w as i32,
                            y: origin / w as i32,
                            w: ori.bw as u32,
                            h: ori.bh as u32,
                        },
                        o & 3,
                        o >= 4,
                    );
                    bounds.push(if b.is_nan() { f64::INFINITY } else { b });
                }
                heap.extend(0..candidates.len());
                for i in (0..heap.len() / 2).rev() {
                    sift_down(&mut heap, i, &bounds);
                }
            }
        }
        for r in 0..candidates.len() {
            let k = if bounds.is_empty() {
                r
            } else {
                let k = heap[0];
                if top.len() == keep && bounds[k] < top[keep - 1].score {
                    break;
                }
                let tail = heap.pop().unwrap();
                if !heap.is_empty() {
                    heap[0] = tail;
                    sift_down(&mut heap, 0, &bounds);
                }
                k
            };
            let (origin, o) = candidates[k];
            let w = self.rt.state().w;
            // The fitting geometry is guaranteed inside the runtime grid for accepted templates.
            let Some(stamp) = stamp_template(
                t,
                origin % w as i32,
                origin / w as i32,
                o & 3,
                o >= 4,
                w,
                self.rt.state().h,
            ) else {
                continue;
            };
            let sc = score(self.rt, &stamp, o & 3, o >= 4);
            let entry = Ranked {
                origin,
                o,
                score: if sc.is_nan() { f64::NEG_INFINITY } else { sc },
            };
            if keep == 0 {
                continue;
            }
            let p = top
                .iter()
                .position(|old| better(&entry, old))
                .unwrap_or(top.len());
            if p < keep {
                top.insert(p, entry);
                if top.len() > keep {
                    top.pop();
                }
            }
        }
        #[cfg(test)]
        self.diagnostics.push(serde_json::json!({"type":"shortlist","values":top.iter().map(|e|(e.origin,e.o)).collect::<Vec<_>>()}));
        for e in top {
            let w = self.rt.state().w;
            let Some(stamp) = stamp_template(
                t,
                e.origin % w as i32,
                e.origin / w as i32,
                e.o & 3,
                e.o >= 4,
                w,
                self.rt.state().h,
            ) else {
                continue;
            };
            let placed = place_landmark(self.rt, t, &stamp, e.o & 3, e.o >= 4);
            #[cfg(test)]
            self.diagnostics.push(serde_json::json!({"type":"attempt","origin":e.origin,"o":e.o,"result":placed,"state":tests::runtime_snapshot(self.rt)}));
            if placed.is_some() {
                self.tab.as_mut().unwrap().patch(self.rt, &stamp);
                #[cfg(test)]
                self.diagnostics
                    .push(serde_json::json!({"type":"patch","tables":self.tab}));
                return placed;
            }
        }
        None
    }
}

struct Ranked {
    origin: i32,
    o: u8,
    score: f64,
}
fn better(a: &Ranked, b: &Ranked) -> bool {
    a.score > b.score || (a.score == b.score && (a.origin, a.o) < (b.origin, b.o))
}
fn sift_down(heap: &mut [usize], mut i: usize, bounds: &[f64]) {
    let top = heap[i];
    loop {
        let mut c = 2 * i + 1;
        if c >= heap.len() {
            break;
        }
        let ahead = |a: usize, b: usize| bounds[a] > bounds[b] || (bounds[a] == bounds[b] && a < b);
        if c + 1 < heap.len() && ahead(heap[c + 1], heap[c]) {
            c += 1;
        }
        let ch = heap[c];
        if ahead(top, ch) {
            break;
        }
        heap[i] = ch;
        i = c;
    }
    heap[i] = top;
}

pub fn best_landmark<'state>(
    rt: &mut LandmarkRuntime<'state>,
    t: &ParsedTemplate,
    score: impl FnMut(&LandmarkRuntime<'state>, &Stamp, u8, bool) -> f64,
    tries: i32,
    bound: Option<&mut Bound<'_, 'state>>,
) -> Option<PlacedFeature> {
    LandmarkSearch::new(rt).best(t, score, tries, bound)
}
pub fn best_landmark_with<'state>(
    rt: &mut LandmarkRuntime<'state>,
    hard: &[u8],
    open: impl FnMut(&LandmarkRuntime<'_>, i32) -> bool,
    t: &ParsedTemplate,
    score: impl FnMut(&LandmarkRuntime<'state>, &Stamp, u8, bool) -> f64,
    tries: i32,
    bound: Option<&mut Bound<'_, 'state>>,
) -> Option<PlacedFeature> {
    LandmarkSearch::with_planning(rt, hard, open).best(t, score, tries, bound)
}

#[cfg(test)]
mod tests;
