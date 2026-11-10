# Safe post-build diagnostics and independent executable staging

Follow-up base: `024ad82a3d87721b5fb8bd5e39916d34c474065b`.
Code: `1f58350f167284e8fcba460e77f106ad0a8e4fce`.

## Preserve the actual result and its uncertainty

Root retained terminal native run **42714491373**, job **129492372135**, source `7401e2908a080799937a6f074dbc142d74320cc1`: the actual locked optimized Linux PostgreSQL binary compiled successfully in **2m40s**. The producer then refused about1.3s later, emitted only its generic diagnosis message, and produced no archive. **The underlying post-build failure cause is UNKNOWN.** Those facts come from Root's retained run, not a new run or independently downloaded logs in this packet. The native tool sources at7401 and this follow-up's024 base are byte-identical before the repair.

The metadata-only local check found the existing Mac `final-target/debug/rh-server` was regular0755,42,479,296bytes, **nlink1**, with no same-inode `deps/rh_server-*` candidate found. No binary contents were read or executed. This does not confirm a two-link Linux output or diagnose the failed job. A two-link Cargo-like output is tested below as a reachable filesystem input case, not claimed as the actual cause. A later successful retry would not retroactively identify the old unknown exception.

Root owns removal of the temporary push trigger and any separately reviewed retry activation. This worker changes no workflow, pushes/dispatches nothing and runs no Rust build, PG/server process or host action.

## Keep strict archive inputs; stage trusted Cargo output separately

The existing `component.py`, including its single-link reader/ELF/schema/archive guards, remains byte-identical. A real two-link regular executable is refused by that strict reader; this is preserved in a regression.

The producer now opens only its fixed `target/x86_64-unknown-linux-gnu/release/rh-server` under its owned private scratch. Held nofollow directory/file descriptors check runner ownership, non-writable-by-others directories, regular/executable/bounded source bytes and stable inode/metadata before/after copying. Multiple links are permitted only at this trusted Cargo-output boundary. No source chmod, overwrite, hardlink, rename or archive-guard relaxation is used.

It creates a NEW private stage directory and exclusive executable inode, writes and fsyncs the bytes and directories, verifies independent inode/single link and reads through the original strict reader. Validation, the readiness process, pre/post hashes and archive creation all use **that same copy**. The original Cargo file and its links stay unchanged. Source symlinks/writable media/path aliases, changed output or an existing stage refuse. This fixes the reachable multi-link input incompatibility without claiming it caused7401.

## Safe, structured first-failure diagnostics

The CLI emits bounded `rh-native-diagnostic/1` JSON events to stderr. Stages and codes come from fixed allowlists; no exception string, argument vector, captured stdout/stderr, environment, database URL or private server log is serialized. Unknown Refused messages map to `refused_unclassified`; unknown exception types map to a fixed category. All literal `require` reasons in producer and component currently have explicit static codes.

Each phase records its first escaping failure before cleanup runs. A later cleanup failure cannot replace that original phase/code. Controlled binary observations include only kind, mode, byte count, link count and whether the owner matches the runner. Controlled process exit status is numeric. Paths, token values, arbitrary error fields and raw ELF bytes are not diagnostics. Invalid CLI arguments also produce a static code instead of echoing their values. Failure remains a nonzero exit; no error is converted to success or retried automatically.

## Static review of the remaining post-build conditions

No second deterministic defect was proved by this source-only review. No real post-build condition is newly claimed PASS.

| Phase | Conditions reviewed / future safe diagnosis |
|---|---|
| `cargo-output-copy` | Owned source policy, link/mode/size observations, stable read, exclusive/fsynced independent copy. Real two-link injected regression passes; old Linux file metadata remains unknown. |
| `staged-binary` | Unchanged strict reader and ELF64/x86_64 headers, executable load entry, bounded segments and supported interpreter. Actual failed-run ELF was unavailable for inspection. |
| `database-fresh` | Fixed CI-only URL matches service configuration; psql is bounded and requires zero public tables. Connection/query failure becomes `command_failed`/`command_timeout` at this phase. No actual DB probe was run here. |
| `server-start`, `http-ready`, `http-info` | Existing source explicitly accepts `--runtime core`; bound/fill/learning flags are supported. `/readyz` storage must be actual PostgreSQL; `/info` expected key set/counters matches inspected server source. Readiness timeout/early exit/HTTP/JSON errors gain specific phase and static codes. |
| `database-boundary`, `server-stop`, `database-final` | Business tables exist in inspected migrations; zero rows and empty runtime are enforced, owned process drain is bounded, nonzero exit refuses, and final counts must agree. No runtime/SQL success is inferred from the earlier compile. |
| `source-recheck` | The executed copy bytes, actual Git head/clean tree and lock/toolchain files must remain unchanged. |
| `manifest-build`, `archive-create`, `archive-verify` | Actual toolchain/host/libc/PostgreSQL receipt formats, binary identity, two-member canonical archive and all strict path/link/schema/size/checksum requirements remain. Static failure codes distinguish these checks without dumping receipt or log contents. |

## Offline evidence

The original19PASS log/evidence and earlier manifests are unchanged. The new suite first passed **25/25** ([postbuild-first-offline.txt](postbuild-first-offline.txt)); after adding explicit codes for the remaining three CLI argument refusals, final **25/25 PASS** ([postbuild-final-offline.txt](postbuild-final-offline.txt)). Three Python files passed AST parsing, all static require-reason/code coverage passed, and staged whitespace checks passed. No broader suite ran.

Tests create actual private two-link files and show the original strict reader refuses them. An injected producer run writes synthetic Cargo output into the real owned scratch, invokes the real staging/copy/strict-read/archive paths, and asserts the readiness callback and archive use the same independent single-link copy. Compiler/probe responses are explicitly synthetic; only local private Git subprocesses are permitted. Native processes, Rust and PostgreSQL are never executed. Additional cases cover symlinks/writable sources/exclusive stage refusal, unknown sensitive exception text, subprocess argv/output/error redaction, invalid CLI input and preservation of the first error across cleanup.

Reproduce current offline tests with the same pinned environment and task-owned Cargo/PG paths shown in the original README, then run `bash docs/evidence/staging-native-artifact/verify.sh`. No new local worktree/cache or native/database state was created. Temporary fixture files and synthetic archives are cleaned. The additive `postbuild-SHA256SUMS` covers the three code files plus new evidence; historical manifests apply to their recorded Git objects and are not rewritten against changed current source.

Actual Linux readiness, metadata, clean stop and component archive remain unproved after the successful compile. Original host/client/installer/PG/age/TLS/offhost restore/deployment gates remain separate; `deployable:false` remains mandatory. Root must review this repair and diagnostics before authorizing ONE separately activated retry. No automatic retry or trigger edit is included.
