//! Source one-second AP hit history. This grows from actual weapon landings, never a fabricated rate.
#[derive(Clone, Debug, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HitWindow {
    pub(crate) target: Option<crate::PlayerId>,
    hits: Vec<f64>,
}
impl HitWindow {
    pub(crate) fn note(&mut self, target: crate::PlayerId, now: f64, count: usize) {
        if self.target != Some(target) {
            self.target = Some(target);
            self.hits.clear();
        }
        // Pruning before insertion preserves the source append-then-prune resulting order.
        let first = self
            .hits
            .iter()
            .position(|t| now - *t < super::DEFINITION.ap_hit_window_ms)
            .unwrap_or(self.hits.len());
        self.hits.drain(..first);
        self.hits.extend(std::iter::repeat_n(now, count));
    }
    pub(crate) fn rate(&self) -> f64 {
        self.hits.len() as f64 / (super::DEFINITION.ap_hit_window_ms / 1000.)
    }
    pub(crate) fn valid(&self, now: f64) -> bool {
        self.target.is_none_or(|id| id.0 != 0)
            && self
                .hits
                .iter()
                .all(|t| t.is_finite() && *t >= 0. && *t <= now)
            && self.hits.windows(2).all(|v| v[0] <= v[1])
            && (self.hits.is_empty() || self.target.is_some())
    }
}
pub(crate) fn update(w: &mut crate::state::World, ledger: &[crate::systems::ledger::Entry]) {
    for p in w
        .players
        .iter_mut()
        .filter(|p| p.standing() && p.signature.engaged)
    {
        let Some(target) = p.signature.target else {
            continue;
        };
        let count = ledger
            .iter()
            .filter(|e| {
                e.by == Some(p.id)
                    && e.victim == target
                    && e.weapon.is_some()
                    && e.sig.is_none()
                    && e.ability.is_none()
                    && !e.dot
                    && !e.passive
                    && !e.derived
                    && !e.arena
                    && e.scale > 0.
                    && e.packet.raw > 0.
            })
            .count();
        p.signature.ap_hits.note(target, w.server_time, count);
    }
}
