# Manual Linux x86_64 native component

This is a code-only workflow/producer and strict component packager. No workflow has been dispatched and no native artifact has been built by this packet. Root reviews the source before the first manual build. It uses no AWS access, deployment action, public upload or repository/cloud secret.

The new `.github/workflows/staging-native-artifact.yml` has only `workflow_dispatch`, read-only contents permission, and two checkouts with `persist-credentials:false`. It runs only from `optimization_port`. Root must supply a full lowercase40-hex `source_commit`, reachable from the fetched canonical branch tip. The reviewed harness is checked out separately at the workflow commit, with complete ancestry; selected source is checked out at the exact input SHA. Source can predate the harness. The manifest binds both identities and the actual fetched branch tip. No user input is interpolated as shell code.

On the hosted Linux x86_64 runner, the producer checks a clean exact source checkout, reads the selected source's exact stable Rust pin, and installs that toolchain via rustup. It runs:

```text
cargo build --locked --release -p rh-server --features postgres --bin rh-server --target x86_64-unknown-linux-gnu
```

`CARGO_PROFILE_RELEASE_DEBUG=0` is explicit and recorded. A fresh job-owned Cargo home/target lives under `RUNNER_TEMP`; build/runtime subprocess environments omit cloud/GitHub credentials. Actual `rustc -vV`, `cargo -vV`, GNU libc, source Git tree, Cargo.lock/toolchain file SHA256, binary byte length/SHA256 and ELF identity are recorded. No `rh-server --version` behavior is assumed.

## Actual runtime metadata, not an input receipt

The producer requires the fresh CI-only PostgreSQL16 service to have no public tables before starting the executable. Its fixed public throwaway credentials are used only against the CI loopback service; they are not repository/cloud secrets or existing account credentials, and are never packaged. The producer accepts no arbitrary database URL or expected protocol/content receipt.

It starts the built binary on a fresh loopback port with core runtime, one-room cap, zero fill bots and bot learning off. It makes only bounded GET requests to `/readyz`, `/info` and `/healthz`, with proxies/redirects disabled. Real readiness must say PostgreSQL storage `ok`; memory fallback refuses. Actual `/info` supplies protocol/content, and must report zero rooms, lobbies, players, results and closed rooms. SQL checks zero profiles, session leases, matches, match results, ledger, monthly balances and purchases. There are no claims, accounts, Hello/WebSocket requests or room creation. Counts are rechecked after clean shutdown. Observed responses and server version are stored in the manifest.

The startup poll is bounded to40s; all HTTP/DB commands and process stop have finite timeouts, with an overall receipt bound of60s. Owned process-group SIGTERM is followed by at most5s grace; failure to stop triggers owned-group SIGKILL and refuses the artifact. A nonzero exit or changed binary/source/lockfile also refuses. Server logs remain private in the owned temporary workspace and are removed with it. Compiler/tool installation output can appear in GitHub logs; server argv/logs and database URLs are never printed by this harness.

## Strict component archive

The deterministic, uncompressed USTAR archive contains exactly two regular files, in this order:

| Path | Mode | Contents |
|---|---|---|
| `bin/rh-server` |0755| The executed Linux x86_64 ELF executable |
| `component.json` |0644| Canonical strict nonsecret manifest |

UID/GID/mtime are zero and owner names empty. Only the explicit executable is read, through nofollow path descriptors; links, non-executable/multiple-link/oversized inputs refuse. ELF64 little-endian x86_64 type/headers/load segments/entry and supported interpreter are checked. Binary ceiling128MiB and manifest ceiling32KiB are refusal bounds, not measured build sizes. Archive verification extracts nothing, checks every manifest field/hash, and compares full canonical archive bytes, rejecting links, extras, duplicates, traversal, altered metadata, malformed/truncated/padded/trailing data and noncanonical/duplicate JSON. Output is create-new, never overwritten.

Only this archive is retained as a GitHub Actions artifact for3days; no workspace/log/Cargo/database/credential paths are uploaded. GitHub's outer artifact ZIP/digest is distinct from the deterministic inner component tar/digest printed by the producer. There is no release/publication/deploy step. The action pins are checkout `11bd71901bbe5b1630ceea73d27597364c9af683` and upload-artifact `ea165f8d65b6e75b540449e92b4886f43607fa02`.

`deployable:false` is mandatory. This is **not** the final host public bundle, ARM64 artifact, Unity build, Source/Training/map validation, trusted installer/toolchain/PG/age/Caddy/TLS package, account progression proof, backup/offhost restore or cloud authorization. A structurally valid manifest is not cryptographic build attestation; Root must inspect the actual reviewed workflow/run/source and artifact checksums. Synthetic unit inputs cannot establish a real native build.

## Code-only verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tools/staging-native-artifact -p 'test_*.py' -v
```

Tests use synthetic ELF/HTTP/DB/toolchain facts and private synthetic Git repositories. No Rust build, PostgreSQL service, native executable, workflow dispatch or host provisioning runs on the Mac. They cover deterministic contents, strict schema/identity/readiness, no secret-like extra fields, ELF/mode/link/path refusals, archive corruption/traversal/extra members, exact ancestry and dirty-source refusal, loopback request restrictions, bounded synthetic observed readiness/cleanup and Mac/event rejection. CLI `verify --archive /absolute/component.tar` performs structural inspection only and never executes the executable.

## Exact unresolved first-build gates

Root must review/integrate/push the workflow and ensure GitHub makes this manual workflow dispatchable on the configured repository/default branch. The workflow itself requires the execution ref `optimization_port`; no default-branch/permission change is made here. GitHub documents a default-branch workflow-registration requirement for manual dispatch. Root selects the source SHA and authorizes the first actual run; this packet dispatches nothing.

The first real job must establish runner `ubuntu-24.04` x86_64 availability, sufficient disposable disk/time, preinstalled `python3`, `git`, `rustup` and `psql`, access to the exact Rust release/locked crate downloads, fresh PostgreSQL16 startup/loopback port publication, the real build/ELF/loader and observed readiness/clean stop. No package-install, alternate target, credential or database fallback is implemented. Failure stops at that gate. The runner-image and `postgres:16` image tags may change; actual GNU libc/toolchain/PG versions are recorded, but this is not a fully pinned OS/container supply chain or reproducible-build claim. Root can require immutable runner/container pins in a later reviewed delta.

An x86_64 GNU executable with observed libc is not proof it runs on an arbitrary host or an ARM64 EC2 instance. Root must separately establish target OS/loader/library compatibility and all host/security/durability/deployment gates. No AWS resource, login, spending, application data or DNS was touched.
