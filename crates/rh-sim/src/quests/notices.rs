//! Source quest feedback. Strings are created only when the real producer emits a notice.
use super::catalog;
use crate::{Event, PlayerId};
pub(super) fn owner(events: &mut Vec<Event>, to: PlayerId, text: impl Into<String>) {
    events.push(Event::Toast {
        to: Some(to),
        text: text.into(),
    });
}
pub(super) fn room(events: &mut Vec<Event>, text: String) {
    events.push(Event::Toast { to: None, text });
}
/// Only the source count and sole name are needed; no heap/cache during an otherwise quiet step.
#[derive(Default)]
pub(super) struct Expired {
    count: usize,
    sole: Option<u16>,
}
impl Expired {
    pub(super) fn add(&mut self, def: u16) {
        self.count += 1;
        self.sole = Some(def);
    }
    pub(super) fn announce(self, events: &mut Vec<Event>) {
        match self.count {
            0 => {}
            1 => room(
                events,
                format!(
                    "Quest expired: {}",
                    catalog::DEFINITION[self.sole.unwrap() as usize].name
                ),
            ),
            n => room(events, format!("{n} quests expired")),
        }
    }
}

/// Source RaidRoom's derived owner notice; projection formats the unchanged raw GV event.
/// Actual Room-method capture admission is separate from this pure formatter.
pub(crate) fn quest_gv_text(amount: u32) -> String {
    format!("+{amount} GV (quest)")
}
