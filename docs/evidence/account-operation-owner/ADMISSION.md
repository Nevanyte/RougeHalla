# Coordinator admission

Source leaf `f722962d8e92dab9918b5d3a76328da5c5636446` is integrated as `e7ebbb48` after independent code review.
All four manifest payloads and the canonical/Unity mirror bytes verify. The31-test affected API suite passes,
including three new read-only/registration, cancellation/reopen and same-name replacement-credential cases.

The predicate delegates to existing admitted-owner checks and grants no new authority. It performs no I/O, exposes no
credential and preserves the original Unknown UUID/state/history; SendAsync rechecks ownership before requests.
Hub adoption and Editor/browser proof are separate. Native/gameplay/protocol and cloud state are unchanged.
