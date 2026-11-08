# Semantic source mutants (P-PERCEPTION-WITNESS-1)

Each `.patch` is applied with `patch -p1` to a writable copy of the repository under `/tmp/repo` (never to the
read-only `/repo` mount). The three corpora are then recaptured from the mutated TypeScript with the same pinned image and
capture tool. `compare.mjs` reports the first semantic JSON-path mismatch (the `profile` provenance block is skipped: a
mutant necessarily changes the mutated source file's sha256, which is not a corpus semantic). `run-mutants.sh` fails unless
the first mismatch of each mutant is exactly the signature recorded in `expected.txt`; after the three mutants it reruns the
unmutated capture against the checked-in corpus as a restored control.

| mutant | change | witnessed mismatch |
|---|---|---|
| 01-visible-only-alive | `perceive` counts `alive` only for non-self rows that pass `near(...)` (the count moves after the self/near/hidden filters) | `run-summary.json /probes/0/frame/hud/alive`: 5 -> 2 |
| 02-hidden-identity-leak | the `EFFECT_HIDDEN` `continue` is removed, so the hidden row enters `fighters` (identity and coordinates leak) | `run-summary.json /probes/0/frame/fighters/2/id`: "p-human" -> "p-hidden" |
| 03-final-batch-time | `observe` stamps events with `s.state.serverTime` instead of the originating `fx.t` | `windup-path.json /observations/0/frame/events/0/t`: 100 -> 999999 |

None is a compile-error mutant: every run must finish, write all three corpora, and differ semantically. A failure to apply
the patch, a capture crash, an identical corpus, or a different first mismatch fails the script.
