# P-STATUS-1 final integration material — review pending

This is a mechanical packaging of immutable candidate-v1 plus final-overlay-v2. It does not change any implementation bytes. New owned paths are in owned.tar and files/. Existing shared seams are proposals in shared.patch, based on accepted stat-fold integration 7f294cc7. The coordinator must adapt these serially to preserve later placement, mob content and aggregate identity changes. No shared status record or Cargo.lock is included.

Source fixtures are the three separate immutable source handoffs; do not replace them with native-generated outputs. Read files/docs/evidence/status-runtime/native-handoff.md for boundaries, exact public shape and remaining owner responsibilities. Protocol/client/observation policy versions remain coordinator work. Checkpoint15/replay13 are private proposals only.

Independent final review and coordinator integration gates remain pending. Final author mutation evidence is a separately frozen evidence addendum.
