# Terminal-producer admission

The coordinator admits the reviewed chain `67856d1a` → `9c4f9250` → `633c303c` → `5e18203e` → `bfb7fd6b`
as `0610dff8` → `150c29ce` → `bf193335` → `da638992` → `146264b8` on `optimization_port`.
There is no production gameplay change: the native addition is one integration test consuming five actual-source cases.
The source corpus stays byte-identical, SHA256 `a5a925ba170169e6dd52845d82baff8cb342d1228ffb9a55b66f85da91c85722`.

Root independently runs that native test against the integrated main source:1/1 passes across the five declared
Fizzle/Interrupted cases and restored continuations. Strict all-feature Clippy for the new test passes.
Root also executes the committed runner-safety and actual-runner signal fixtures. Both hashing implementations refuse
failed, empty and malformed digests before arming restoration. HUP/INT/TERM retain exact129/130/143 exit statuses and
restore once; restoration failure exits nonzero, attempts once and retains recovery bytes. These fixtures operate only
on disposable files; they do not mutate the live simulation source or claim SIGKILL handling.

The [original evidence](README.md) retains historical tool hashes from earlier runner revisions. At this admission the
exact repaired hashes are:

| Tool | SHA256 |
| --- | --- |
| `run-mutants.sh` | `f14680c48be4db5be7372901bbcbe83071293d0c7fabdbd9a250af0db793d639` |
| `lib/runner-guard.sh` | `a426dfb07fcc0147c26d18d715bc641dfbcba64bbd5580f1ba230d2b8eb8cd6e` |
| `tests/runner-safety.sh` | `249db3e0dc81d59350411561987ff9a025ff4e6e6b820926f18d792aa6ef749c` |

Those runner files are outside this corpus's four-file capture-harness inventory; no fixture refresh is required for
their safety repairs. This closes the bounded pending-Wish terminal evidence. Full source-born NPC signatures, public
client reason presentation and the broader port are not certified by this test.
