# Raw run receipts

All commands use cwd `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules-source` unless the
log explicitly contains its container cwd. No Rust, npm-on-host, source modification, old corpus capture, merge or push ran.

| Log | Command | Exit | Interpretation |
|---|---|---:|---|
| 01-first-capture.log | `bash tools/bot-private-modules-fixtures/capture.sh capture` | 1 | 237 cases/2952 ops recreated, write succeeded; subsequent fresh byte check rejected changed author tools/inputs during run. Default source chest life15s correction and three-lane context fix; not a semantic KILL. Raw hashes retained. |
| 02-capture.log | same capture command | 0 | 247 cases/3202 ops; stable write and fresh-process byte checks. |
| 03-reached-capture.log | same capture command | 0 | 249 cases/3229 ops; real reached assertions, exact source/coverage. |
| 04-reader-strengthened.log | `node tools/bot-private-modules-fixtures/verify.mjs parity/policy/bot-private-modules/source.json` | 0 | 18 reader negatives, then-current corpus cut. |
| 05-control-ready-capture.log | capture command | 0 | 249/3229 stable and exact after strict raw JSON/field checks. |
| 06-first-controls.log | `bash tools/bot-private-modules-fixtures/controls.sh --write` | 1 | 24 KILL /1 SURVIVED; comment NONKILL, restored PASS. The copied shared-card prerequisite file was bypassed by the workspace shared-package import; retargeted its actual cardBlock call in copied chestHunt. Survivor never labeled KILL. |
| 07-final-trajectory-capture.log | capture command | 0 | 254/3255, 34 actual reached predicates; corrected cfg continuation/Easy filter/recast/nearest/crowd source trajectories. |
| 08-final-capture.log | capture command | 0 | Lossless callback evidence and fixed controls, source0237d6…; exact fresh-process source/coverage. |
| 09-final-controls.log | controls --write | 0 | 25/25 KILL, comment NONKILL, restored exact. Bound only to source0237d6… and that tool cut. |
| 10-final-reader.log | strict reader command | 0 | 254/3255; 23 negatives. |
| 11-fresh-source-check.log | `bash tools/bot-private-modules-fixtures/capture.sh --check` | 0 | Fresh Docker install/process, output read-only; source0237d6… and coverage1e65cd… exact. |
| 12-explicit-config-capture.log | capture command | 0 | Same254/3255, explicit cfg name/modules/default learned/services declarations; sourcee3a2a4…; coverage1e65cd… unchanged. |
| 13-explicit-config-controls.log | controls --write | 0 | 25/25 KILL, comment NONKILL and restore exact against sourcee3a2a4… final explicit-config cut. |
| 14-fresh-controls-check.log | `bash tools/bot-private-modules-fixtures/controls.sh --check` | 0 | Fresh Docker control reproduction, all25 KILL and receipt bytes exact, comment/restore PASS. |

Final controls, fresh checks and seal are appended after actual receipts. Never overwrite an earlier log. Capture/compile/
decoder errors and assertion-scaffold errors are harness failures, not semantic kills. SURVIVED receipts remain in raw logs
when a concrete missing distinguishing trajectory requires source-input completion. Source behavior always wins.

18-before-config-behavior.json and19-after-config-behavior.json bind the prior explicit-config expansion to one identical
behavior projection e66054836d9a2e235a93139bb21a27fa8647a32c57b6c43f47c04a43335bd2db. The projection includes maps/catalog and
all case initial/setup/operations; it excludes only resolved config declarations. This is author-computed equivalence evidence,
not an independent reproduction claim. The later distinct-clock/phase-reentry/monotonic-sampling corrections are separately
scoped input changes and are not represented as that declaration-only equivalence.

| Later log | Command | Exit | Interpretation |
|---|---|---:|---|
| 15-final-fresh-source-check.log | capture --check | 0 | Sourcee3a2a4… and unchanged coverage reproduced in fresh container. |
| 16-final-reader.log | strict reader command | 0 | 254/3255,23 negatives at explicit-config cut. |
| 17-manifest.log | manifest --write then --check | 0/0 | Prior explicit-config candidate ff9a242e…; not the later bounded final cut. |
| 20-bounded-clock-capture.log | capture command | 1 | Reached predicate caught missing author +1000 Plan follow-up insertion (103000 versus104000). No source substitution or KILL claim; commands21..24 in that set-e chain did not run. |
| 25-bounded-clock-capture.log | capture command | 0 | Bounded fixes only: independent Hunter now/serverTime; later Plan reentry continuation; sorted short-window sample times and reader chronology gate. 255 cases/3259 ops,36 reached assertions, exact fresh-process source/coverage. |

Final source/control/reader/manifest receipts26..29 and scoped audit/commit are recorded below when complete. No additional
optional input combinations were added after Root approved the bounded clock/history corrections.

| Final-cut log | Command | Exit | Interpretation |
|---|---|---:|---|
| 26-bounded-final-controls.log | controls --write | 0 | 26/26 KILL including separate-clock alias; comment NONKILL and restored exact. Final source6697c482… only. |
| 27-bounded-fresh-source-check.log | capture --check | 0 | Fresh container/tmpfs npm install; read-only output; final source+coverage exact. |
| 28-bounded-final-reader.log | strict reader command | 0 | 255/3259 and24 negatives, including finite backwards observation clock. |
| 29-bounded-final-manifest.log | manifest --write then --check | 0/0 | Final candidate manifest c5ab8fd5… exact. |
| 30-scoped-audit.log | scripted git/syntax/all inventory pin audit | 0 | Clean original tracked tree, only three allocated new directories; source/import/config/tool/compatibility inventories unchanged. Actual aggregate counts retained. |

The final bounded cut did not repeat the full controls --check campaign after adding the clock case; final26-control write recreated each selected actual source case twice and proved comment/restored exact. Earlier explicit-config cut had the independent fresh control --check in14. Root independent reproduction can run the same final controls --check command.

Commit action after these checks: `git add -- tools/bot-private-modules-fixtures parity/policy/bot-private-modules docs/evidence/bot-private-modules-source`, then `git commit -m "test(bots): capture complete private module source witness"`. Exact resulting commit is returned to Root; no merge or push.

Final formatting-clean seal follows one whitespace-only blank-line cleanup in the source checker tool, without changing any
case/config/runtime/legacy source. Source+controls from the26-control cut are retained losslessly as31-control-base-source.json.gz
and31-control-base-controls.json.gz, so independent review can verify the equivalence preimages.

| Formatting-clean receipt | Command | Exit | Interpretation |
|---|---|---:|---|
| 31-whitespace-check-failure.json / .log.gz | git diff --cached --check | 2 | Literal trailing-space excerpt preserved losslessly; author formatting failure, not semantic KILL. |
| 32-whitespace-source-capture.log | capture command | 0 | Same255/3259 and36 predicates; generated source645e85f1…; fresh-process byte check exact. |
| 33-whitespace-fresh-check.log | capture --check | 0 | Separate fresh container/read-only-output source+coverage exact at formatting-clean cut. |
| 34-whitespace-equivalence.log | exact full-body/profile-diff assertions and envelope rebind | 0 | All maps/catalog/configs/initial/setup/declarations/results/state/callbacks byte-identical; only checks.mts pin loses1 whitespace byte; V8 coverage unchanged. All26 control receipts preserved, only top-level source bytes/SHA updated. |
| 35-sealed-reader.log | strict reader command | 0 | Final255/3259 and24 negatives. |
| 36-sealed-manifest.log | manifest --write then --check | 0/0 | Final manifest fe8fe10f… exact. |

This last controls envelope rebind is metadata-only equivalence, not a claimed rerun. The mutant source files, runtime,
case declarations and all semantic selections are unchanged; precise before/after pins and compressed original artifacts
are in34/31. Root explicitly allowed unchanged semantic controls to remain bound through lossless metadata changes when
actual inputs/results are proven identical. Independent final controls --check remains an admission command.
