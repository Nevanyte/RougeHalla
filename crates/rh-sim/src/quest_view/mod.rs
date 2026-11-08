//! Quest disclosure policy, independent of wire and viewer-handle allocation.
//!
//! This leaf is deliberately not wired into production until the observer/transport design is admitted. Inputs must be
//! drawn from authoritative state for the seat being projected, never from client claims. The decision contains no
//! identity, coordinates or handles, so an ineligible row cannot accidentally carry private facts through this seam.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QuestRowAccess {
    None,
    /// The finder alone has the source's private, non-actionable four-second preview.
    Preview,
    /// The offer has entered the globally published quest log (including planning and closed linger).
    Published,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DisclosureInput {
    pub human: bool,
    pub published: bool,
    /// The offer is still open; closed published rows can remain in the log during linger.
    pub open: bool,
    /// Authoritative runtime says this viewer found the unpublished offer and its head start began.
    pub finder_preview: bool,
    /// Authoritative accepted set contains this viewer, never an untrusted client flag.
    pub accepted: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Disclosure {
    pub row: QuestRowAccess,
    /// Permission to project live objective positions outside ordinary vision. This does not issue an action handle.
    pub owner_objectives: bool,
}

pub(crate) fn disclosure(input: DisclosureInput) -> Disclosure {
    if !input.human {
        return Disclosure {
            row: QuestRowAccess::None,
            owner_objectives: false,
        };
    }
    let row = if input.published {
        QuestRowAccess::Published
    } else if input.open && input.finder_preview {
        QuestRowAccess::Preview
    } else {
        QuestRowAccess::None
    };
    Disclosure {
        row,
        owner_objectives: input.published && input.open && input.accepted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> DisclosureInput {
        DisclosureInput {
            human: true,
            published: false,
            open: true,
            finder_preview: false,
            accepted: false,
        }
    }

    #[test]
    fn hidden_is_absent_except_for_the_finders_preview() {
        let mut i = input();
        assert_eq!(
            disclosure(i),
            Disclosure {
                row: QuestRowAccess::None,
                owner_objectives: false
            }
        );
        i.finder_preview = true;
        assert_eq!(
            disclosure(i),
            Disclosure {
                row: QuestRowAccess::Preview,
                owner_objectives: false
            }
        );
        // Even forged/stale acceptance cannot turn a hidden preview into objective knowledge.
        i.accepted = true;
        assert!(!disclosure(i).owner_objectives);
        i.open = false;
        assert_eq!(disclosure(i).row, QuestRowAccess::None);
    }

    #[test]
    fn published_log_and_owner_objectives_have_distinct_entitlements() {
        let mut i = input();
        i.published = true;
        assert_eq!(
            disclosure(i),
            Disclosure {
                row: QuestRowAccess::Published,
                owner_objectives: false
            }
        );
        i.accepted = true;
        assert!(disclosure(i).owner_objectives);
        i.open = false;
        assert_eq!(
            disclosure(i),
            Disclosure {
                row: QuestRowAccess::Published,
                owner_objectives: false
            }
        );
    }

    #[test]
    fn bots_get_no_quest_fact_even_from_inconsistent_state() {
        for published in [false, true] {
            for open in [false, true] {
                for finder_preview in [false, true] {
                    for accepted in [false, true] {
                        let i = DisclosureInput {
                            human: false,
                            published,
                            open,
                            finder_preview,
                            accepted,
                        };
                        assert_eq!(
                            disclosure(i),
                            Disclosure {
                                row: QuestRowAccess::None,
                                owner_objectives: false
                            }
                        );
                    }
                }
            }
        }
    }
}

/// A public, nonspatial roster identity. This namespace has no conversion to an actor or action reference.
/// Allocation and proof of roster entitlement belong to the future publication adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PublicRosterId(std::num::NonZeroU32);

impl PublicRosterId {
    pub(crate) fn from_roster_grant(value: std::num::NonZeroU32) -> Self {
        Self(value)
    }
}

/// Already-authorized presentation text. Invalid input is refused, never truncated or silently rewritten.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicLabel(String);

impl PublicLabel {
    pub(crate) fn checked(label: &str) -> Option<Self> {
        if label.is_empty() || label.len() > u8::MAX as usize || label.chars().any(char::is_control)
        {
            return None;
        }
        Some(Self(label.to_owned()))
    }
}

/// One source-public quest participant, keyed by an already-granted roster identity, not a body reference.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicParticipant {
    pub roster: PublicRosterId,
    pub accepted: bool,
    pub progress: u32,
    pub visited_mask: u8,
}

/// Nonspatial source-public facts about a published offer. There are deliberately no raw IDs, actor references or positions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicQuestPeople {
    pub participants: Vec<PublicParticipant>,
    pub carrier: Option<PublicRosterId>,
    pub done_by: Option<PublicLabel>,
}

impl PublicQuestPeople {
    /// The caller supplies only roster-granted identities and an authorized checked label. Reject a hidden/preview row
    /// wholesale so a future adapter cannot expose these source-public fields before the offer becomes public.
    pub(crate) fn for_row(
        access: QuestRowAccess,
        participants: Vec<PublicParticipant>,
        carrier: Option<PublicRosterId>,
        done_by: Option<PublicLabel>,
    ) -> Option<Self> {
        (access == QuestRowAccess::Published).then_some(Self {
            participants,
            carrier,
            done_by,
        })
    }
}

#[cfg(test)]
mod public_people_tests {
    use super::*;
    use std::num::NonZeroU32;

    #[test]
    fn public_facts_survive_without_any_body_visibility_input() {
        let roster = PublicRosterId::from_roster_grant(NonZeroU32::new(7).unwrap());
        let participant = PublicParticipant {
            roster,
            accepted: true,
            progress: 2,
            visited_mask: 5,
        };
        let label = PublicLabel::checked("A scout").unwrap();
        let facts = PublicQuestPeople::for_row(
            QuestRowAccess::Published,
            vec![participant.clone()],
            Some(roster),
            Some(label.clone()),
        )
        .unwrap();
        assert_eq!(facts.participants, vec![participant]);
        assert_eq!(facts.carrier, Some(roster));
        assert_eq!(facts.done_by, Some(label));
    }

    #[test]
    fn hidden_and_preview_never_publish_participant_or_carrier_facts() {
        let roster = PublicRosterId::from_roster_grant(NonZeroU32::new(1).unwrap());
        for access in [QuestRowAccess::None, QuestRowAccess::Preview] {
            assert!(PublicQuestPeople::for_row(
                access,
                vec![],
                Some(roster),
                PublicLabel::checked("Winner")
            )
            .is_none());
        }
    }

    #[test]
    fn labels_are_bounded_and_invalid_text_is_refused() {
        assert!(PublicLabel::checked("").is_none());
        assert!(PublicLabel::checked("line\nbreak").is_none());
        assert!(PublicLabel::checked(&"x".repeat(256)).is_none());
        assert!(PublicLabel::checked(&"x".repeat(255)).is_some());
        assert!(PublicLabel::checked("Éowyn").is_some());
    }
}
