# Accepted Web57 router manifest — filesystem preparation

This addendum follows the Root source/offline preparation review
`6c96e986caa58db4669ee8d652ee9b15e2b0ee113a77f79f67a58a415fcbf03c`.
Base evidence remains `85af961e4d6f5f5f9e7e55b0c8d36dfb1a0e80a0`; source for
the tiny Markdown MIME change is `e1146d40cbd0b9d1c54b45175c8c86f8ba448e02`.
The prior manifest and all prior 14 offline checks are preserved at their exact
scope. Only two tool pins and the updated runtime plan are superseded here.

Root accepted Art's actual Web57 artifact manifest SHA-256
`a224cc6cc378604e4f9407f1c540f3ceae364d9cf0c97004fcd21df816c83824`:
14 physical files, 106,987,680 bytes, source 57e and client/protocol composition
5e19. The Web tree stays immutable. Web1 remains held. The router whitelist now
admits `.md` as `text/plain; charset=utf-8`; both Markdown license notices are
included alongside the seven text notices, HTML, JS, data and wasm resources.
The affected MIME test passes once and rejects HTML, another wrong MIME and an
undeclared extension. No inherited test was rerun.

`payloads/router-assets.json` is the strict `unity-router-assets/1` derivation of
all 14 accepted rows plus an explicit `/` alias to the identical index.html.
Original filenames, SHA-256 values and byte lengths are preserved. There are
15 URL entries and 106,995,600 alias-counted bytes; the physical artifact still
has 14 files and 106,987,680 bytes. All resources are uncompressed, so no encoding
is declared. The derived manifest SHA-256 is
`103664aed485a1ee634d2be6de1ca759822a95a10945540aa8b1ed35a57e41d7`.
The separate provenance receipt binds the original accepted manifest, exact Web
root, every original physical row, generator and alias to this derived file.

Actual preparation ran outside the reserved runtime state allocation, under:

`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/web57-router-preflight-2026-11-09-01`

The immutable serving root is:

`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/web-build-57e166-2026-11-09/Web`

The pinned existing host Node 22.23.4/darwin/arm64 binary was rehashed to
`2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0`.
Its actual version was verified before the one affected test and one filesystem
preflight. `loadSealedAssets` streamed and verified all declared artifact bytes,
including both Markdown notices and the root alias: **FS_LOAD_PASS, 14 physical
files / 15 URLs**. The runner never calls createLocalRouter or listenLocalOnly.
Exact argv, stdout/stderr, hashes and source cut are retained in payload receipts.
This establishes filesystem loading only; HTTP/WS, serving, browser and runtime
acceptance remain unrun. The startup manifest hash must still be supplied as an
external Root release pin; self-consistency alone is not authorization.

An initial host Python orchestration attempt failed because that Python lacks
hashlib.file_digest. It stopped before any test, artifact change or commit.
The raw error is preserved. Streamed hashlib.sha256 replaced that host-only hash
call, after which the genuine checks above ran once. No real check was retried.

RUNTIME_PLAN.md now includes `--trusted-proxies 127.0.0.1` in both exact native
argv alongside `--client-ip-header x-forwarded-for`, as Root required. The Node
upstream peer is fixed at 127.0.0.1; an IPv6 browser peer remains the forwarded
client value. The rest of the approved database/state/spool/ownership plan is
unchanged. The reserved `browser-c52-actual` state root remains absent.

No PostgreSQL, native server, router listener, proxy request, browser, Editor,
build or cloud operation was started. Phase A (fresh durable PG, two native
processes, router, public identities, zero-room/bootstrap checks) needs Root's
separate runtime release. Browser Phase B remains a later release after the
actual Phase A identities, durability, static and upgrade checks are reviewed.
