# Lossless data compression for the next staging bundle

The live-domain baseline transferred23,504,777B and reached Unity-ready in24.512s under the8Mbit/s staging cap.
Its10,809,404B `.data` asset had no Content-Encoding. One offline gzip candidate shrinks that asset to3,400,837B
(**68.54%**,7,408,567B saved), with the exact original decoded SHA256. Existing Wasm/data/JS payloads and quality remain
unchanged; the package adds a sidecar and its separate provenance entry. The measured canonical build is untouched.

The projected four-file transfer is16,096,210B (**31.52% less** than the live baseline). At the same cap the ideal wire
saving is7.409s. **The new domain load time is unmeasured:** the current owner playtest keeps its existing bundle and
host. No second cloud run, DNS change, AWS resource or player setting change was made for this work.

[Compression arithmetic and hashes](compression.json) · [packaging identity](packaging.json) · [actual HTTP proof](http-proof.json).

The local comparison uses the same actual Caddy2.11.9 Linux arm64 executable, same original payload and a read-only
packaged Web directory. Without precompressed serving, it sends10,809,404B; with the new file_server option it sends
3,400,837B as gzip. A first exploration exposed Caddy sniffing the unknown `.data` extension as application/x-gzip.
The final config explicitly sets application/octet-stream; an actual Chromium fetch transparently decompresses the
response and verifies the full original hash and byte count. Identity clients still receive original bytes. The206
range check is for the identity representation; compressed range behavior was not tested.

The response includes Vary:Accept-Encoding and representation-specific ETags. The new proxy also corrects `/health`
to Rust’s actual `/healthz`; real Caddy plus real Rust locally returns200/ok. Both temporary local containers were
stopped. Future public deployment retains its normal TLS/full-match proof gate.

The rendered future bootstrap passes Calgary cfn-lint with zero findings, [security guard](guard.json), AWS
validate-template, and Python/shell syntax checks. The existing live bootstrap and public performance record stay
historical. The helper uses filename-empty/mtime0 gzip and refuses existing sidecars; originals retain their hashes.
An independent bounded review found no material packaging/MIME/cache blocker and preserves the above scope limits.
