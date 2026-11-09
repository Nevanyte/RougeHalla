//! Source owner-only trader feedback. No message is stored in world state.
use crate::{Event, PlayerId};
pub(super) fn notify(events: &mut Vec<Event>, to: PlayerId, text: impl Into<String>) {
    events.push(Event::Toast {
        to: Some(to),
        text: text.into(),
    });
}
