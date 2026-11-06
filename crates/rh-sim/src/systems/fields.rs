//! Field mutations are immediate, including during ledger collection. Lifecycle callers decide deferral.
use crate::{
    state::World,
    status_runtime::{AbilityRuntime, Field, FieldSelector},
};
// Production callers arrive with P-ABIL; the real body is exercised by the explicit source harness.
#[cfg_attr(not(any(test, feature = "trusted-status-probes")), allow(dead_code))]
pub(crate) fn add(w: &mut World, mut field: Field) -> u32 {
    let id = w.next_entity_id();
    field.id = id;
    w.abilities
        .get_or_insert_with(|| AbilityRuntime::new(w.server_time))
        .fields
        .push(field);
    id
}
pub(crate) fn remove(w: &mut World, id: u32) -> Option<Field> {
    let rt = w.abilities.as_mut()?;
    let i = rt.fields.iter().position(|f| f.id == id)?;
    Some(rt.fields.remove(i))
}
// Production callers arrive with P-ABIL; the real body is exercised by the explicit source harness.
#[cfg_attr(not(any(test, feature = "trusted-status-probes")), allow(dead_code))]
pub(crate) fn remove_into(w: &mut World, selector: FieldSelector, out: &mut Vec<Field>) {
    let Some(rt) = w.abilities.as_mut() else {
        return;
    };
    // Closed selectors depend only on immutable field data: deciding them before or during
    // this stable removal is identical, and no hook can change the table during selection.
    let mut i = 0;
    while i < rt.fields.len() {
        if selector.matches(&rt.fields[i]) {
            out.push(rt.fields.remove(i))
        } else {
            i += 1
        }
    }
}
