# Demo integration preparation — 2026-11-09

Scope follows the owner's [technical demo decision](../../coordination/TECHNICAL_DEMO.md).

Root merged the reviewed caller-UID correction `77ce8d1a`, native postbuild correction/evidence `1f58350f`/`d1ac627d`,
Settings `cb7f67d9`/`fc328469`, and icon-first HUD `6a2175d1`. Combined main before this record is `68ef361e`.

- Original normal CI `cdec`/42711938030 and `7401`/42714491423: provenance, simulation, C# and card-source pass.
  Rust passes the native/PostgreSQL/parity/smoke prefix, then the NPC wrapper fails. The retained cdec diagnostic
  explicitly reports `/out/npm.log: Permission denied`, exit71, Source not started. The wrapper ran root with
  capabilities dropped against a caller-owned0700 mount. The earlier8da generic failure is not retroactively diagnosed.
- Corrected `77ce8d1a` runs with the actual caller UID/GID and caller-owned private tmpfs. Root's one continuity and
  one runner execution both reproduce the whole unchanged original files exactly:13,952,630 and30,636,484 bytes.
  Receipts retain actual arguments, context/source identities and verified container cleanup. The observed local user
  is501:20; synthetic1001:1002 is not a claim about the real GitHub runner's UID. No Source body or oracle changed.
- Root's merged offline checks pass9 NPC controls and25 native-component checks; the fast card provenance auditor
  passes. The Rust job checkout now avoids persisting the GitHub credential in the repository mounted into Source.
- First actual Linux native artifact run42714491373/job129492372135 compiled the optimized PostgreSQL server in160s,
  then failed with a generic postbuild refusal and no artifact. Its underlying cause remains UNKNOWN. The reviewed
  repair independently stages finished Cargo output and retains redacted static stage/code diagnostics; synthetic
  hardlink tests do not prove the original failure's cause. The separate retry is one real selected-commit push,
  not a synthetic event or cloud deployment. Its temporary path-scoped trigger must be removed after terminal result.
- HUD review covers source/lifecycle/layout and offline compile, not an actual combined Editor/Web/browser pass.
  Native Settings and icon HUD tests, the optimized combined Web build, ordinary multiplayer acceptance, Calgary
  hosting and M5 metrics remain open. Existing native98/Web57 evidence retains its old revision scope.

The private Memory review repair is preserved at `3e3178b9` and parked; no full Brain/public activation is admitted.
Optional attack preview and content completion are not demo blockers. `SHA256SUMS` binds the four copied receipts/
reviews; source data, npm logs and credentials are not bundled here.
