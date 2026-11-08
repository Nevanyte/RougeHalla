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
