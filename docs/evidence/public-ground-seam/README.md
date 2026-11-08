# Private protocol 14 public ground packet

Base: `cc7790b70fbb617fc42fdf1c1cce23f3e2d35898`, the project lead's private combined UI/account candidate with native13.
Branch: `codex/public-ground-seam`. This packet implements the approved terrain/region transport end to end, including
the server producer. Protocol14 is branch-local; the project lead owns final combined14 regeneration and admission.
Existing refs `bf59b1f9`, `f4054732`, and `690abede` are preserved.

## Result

Welcome now carries an explicitly versioned, length-delimited semantic map section. Terrain and region presence are
separate from cell value, so absent and present all-zero planes differ. The exact bytes/domains are in [WIRE.md](WIRE.md).
The collision hash is unchanged. Semantic FNV1a32 covers canonical dimensions/presence/uncompressed planes; context
FNV1a32 includes collision identity, semantic identity and the actual room terrain mode.

`rh-server::public_ground` borrows only collision, terrain and region cells from the native map. It checks dimensions
before narrowing and encodes the static prefix once per MapAssets. Room creation checks the complete cached public
content against the arena, not only hashes. Each Welcome appends mode/context from `Sim::config().hazards` outside that
arena-only cache. There is no per-tick ground serialization and no new outer message tag.

Rust, canonical C#, the Unity-packaged C# mirror, and the embedded JS decoder agree on the section. All perform bounded
preflight of the full map, extension and trailing bytes before decoded-plane allocation. They stream runs over borrowed
input without attacker-sized run vectors or a copied input buffer. Bounds remain 1,048,576 cells and a complete 256 KiB
server frame, with explicit cumulative limits of 3,145,728 decoded plane bytes and 3,145,728 runs. Unknown versions,
flags, codes and modes; malformed runs/lengths; incompatible terrain/collision; bad hashes; and trailing bytes are refused.
Hash equality alone never authorizes reuse of different canonical content or mode.

The small wirebench change adapts its diagnostic map-byte writer to the new explicit context-tail API and checks
dimension narrowing. Diagnostic header record keys/schema are unchanged; no native header artifact or provenance pin
was regenerated. The protocol13 Hello refusal remains strict and has a real socket admission assertion.

## Verification

| Gate | Result | Receipt |
| --- | --- | --- |
| Focused Rust protocol package | 95 passed, 0 failed/ignored | [RUST.md](RUST.md) |
| Affected native map/cache unit tests | 7 passed | [SERVER.txt](SERVER.txt) |
| Actual socket admission/refusal test, including protocol13 | 1 passed | [SERVER.txt](SERVER.txt) |
| Focused C# protocol/ground/Wish-barrier classes | 307 passed, 0 failed/skipped | [CSHARP.md](CSHARP.md) |
| Embedded JS vector checker | 45 server, 132 malformed, 13 chains; 18,845 checks | [JS.md](JS.md) |
| Strict protocol and affected server lint; packet formatting | Passed | Rust/server receipts |

The server tests compare complete decoded planes against the real first-playable and canonical seed1 assets. They
also cover missing versus present-zero metadata, equal collision/different ground, stale native layer dimensions,
u32-to-u16 overflow, cache/arena mismatch, and all three actual room modes sharing the same static Arc. The modified
map in the identity test is explicitly synthetic; no generator recapture or map mutation ships.

The first server compile exposed an import of GroundMode from the wrong module; the subsequent integration build
exposed a diagnostic JSON macro expression. Both are corrected. The final server receipt retains those attempts and
the passing results. Final cargo formatting uses the workspace edition; its check passes. Tests were not repeated
after formatting-only import/brace normalization.

Private golden `protocol/fixtures/v14.json` SHA256:
`e22c8eca2ba7f13a21983a14c4ce8b4d00998cff091b1b52561bab1fb53665b4`.
`MANIFEST.json` records the exact packet source/golden hashes, source asset hashes, and preserved refs. C# canonical
and Unity mirror pairs are byte-identical. Older protocol fixtures and source-provenance pins are untouched.

## Remaining admission and product gates

No features, territory, camps, private runtime, renderer, minimap, Bootstrap, MatchClient, MatchHud, map selection,
gameplay rule, or hazard activation changed. No Cargo.lock, shared checkpoint/status, native header artifact, or
content identity changed. The first-playable asset still has no terrain surfaces, and the assessed server assembly
still selects hazards Off. This transport alone does not create visible or active lava, ice, or healing light.

The project lead must compose the separate actor/quest/owner-combat14 work, regenerate the final union golden, reconcile
legitimate changed checker/probe provenance in the source metadata chain, and admit the combined revision. The old
source provenance campaign is expected to need that reconciliation; this packet did not hand-refresh or weaken pins.
Actual Unity import/build/browser acceptance, renderer integration and real map/mode activation remain later gates.
No broad workspace, map-generator, browser or Editor campaign ran, and nothing was deployed or pushed to main.
No WAN latency, input-to-photon, full-game throughput, or completed full-port claim follows from these codec checks.
