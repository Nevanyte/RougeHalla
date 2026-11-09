# Temporary path-scoped push activation

Accepted original code: `e733dbe1c9ed297131a57d8b67718f5c856c445d`.
Original evidence/base: `2703ee7ae36908cded696cf5d62a425efd56034a`.
Activation code: `cc7b158a52e4d54c8e1f1a16f99909deb299c1d6`.

Root independently accepted the original implementation, confirmed manual registration is blocked by the repository default branch `main`, and explicitly chose one actual GitHub-only build using a temporary push trigger. This delta enables that path without changing the default branch, credentials or existing workflows. This worker does not push, dispatch or build anything.

The trigger matches only `optimization_port` pushes that change `.github/workflows/staging-native-artifact.yml`. The job accepts actual `push` or `workflow_dispatch` events only on the canonical ref. Push selection is `github.sha`; manual selection remains `inputs.source_commit`. The source checkout and artifact name both use the same selected environment value that the preceding exact-SHA/ancestry check validates. The harness remains checked out at the actual workflow commit, with full history and no persisted checkout credentials. No step relabels `GITHUB_EVENT_NAME` or fabricates a manual event.

The producer checks Linux x86_64, GitHub Actions context and canonical ref, then permits only these two real event names. Push requires the exact full selected SHA to equal `GITHUB_SHA`. It also reads the bounded, regular nofollow `GITHUB_EVENT_PATH` file and requires canonical push `ref`, matching `after` and `head_commit.id`, `deleted:false`, and no manual `inputs`. A missing/malformed/mismatched/manual-style payload refuses before source/build work. The event payload is not logged or packaged. Manual mode retains the existing ability to select an older reachable exact commit; it does not acquire the push SHA restriction.

These checks trust the genuine GitHub runner context; local synthetic environment values are not event attestation. [GitHub's default variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) define the actual event/ref/SHA/payload boundary, and the [push payload reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push) defines the fields checked. No webhook signature, new token or credential is introduced.

Four new controls use explicit synthetic event files and private synthetic Git repositories:

- Accepted matching push reaches the actual existing ancestry and clean-source checks, then an injected sentinel stops before tool lookup/build/probe.
- Wrong selected SHA/GitHub SHA, short SHA, wrong ref, non-Actions context and other event names refuse before source or native work.
- Mismatched push body ref/after/head commit/deletion, or manual-style inputs relabeled push, refuse.
- Manual selection of an older reachable commit still works unchanged.

Full **19/19 offline tests PASS** in [push-activation-offline.txt](push-activation-offline.txt), including the prior15. Both modified Python files passed AST parsing and whitespace checks passed. Cached YAML parsing checked the exact temporary branch/path filter, real event/ref predicate, consistent selected environment for source/artifact, read-only permission/no persisted credentials, and all three shell payloads passed `bash -n`. No broader suite, Rust/PG/native process, host/cloud action, push or dispatch occurred. Owned Cargo/PG paths remain absent.

Original six evidence files, including15PASS and `SHA256SUMS`, remain byte-identical. All eleven historical manifest payloads were rehashed from Git objects at2703. The original manifest is historical and does not apply to the three changed current files. The additive `push-activation-SHA256SUMS` covers those three code files plus this addendum, raw test log and audit. Original code/evidence remain ancestors; no amend/rebase was used.

This trigger is path-scoped, not intrinsically single-use: another matching workflow-file push would start another run. Root owns the single activating push and must remove the temporary `on.push` entry after the actual result, avoiding additional matching edits before removal. Root must review this delta before pushing. Existing manual-only README/evidence describes the original2703 scope; this additive document records the temporary activation override. Actual build/toolchain/service/compatibility/artifact gates and mandatory `deployable:false` remain unchanged and unproved until Root's real job. No AWS or deployment authorization is added.
