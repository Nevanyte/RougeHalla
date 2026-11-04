# ADR 0003: The server sends the canonical map

**Status:** Accepted. **Context:** the legacy client and server each run the ~4k-line map generator from `(seed, attempt)`
and compare a hash; a mismatch forces a reload. A Rust server and a C# client running independent generator ports would
diverge (float order, libm, iteration order) and every generator change would need two ports kept bit-identical.

**Decision.** The server is the only generator. It sends the collision layer (and, later, the other public layers: zones,
terrain, features, camps, spawns' public subset) in Welcome as a run-length-encoded `MapBlob` with an FNV-1a identity.
Clients render what they are sent. Cosmetic decoration (props) may still be derived client-side from a public seed,
because it never affects gameplay.

**Interim (Stage 1).** The Rust generator is not ported yet. `parity/maps/seed1.map.json` (`rh-map/1`) is the legacy
generator's certified map of seed 1 exported by `parity/legacy-capture/capture.ts`, so the Rust server plays on a real
160x160 map today. Porting the generator (and its certifier) is backlog packet P-MAP-1; it must reproduce the legacy
pinned hashes (`packages/shared/test/mapPins.ts`) or record an owner-approved re-pin.

**Size.** The seed-1 collision layer is 25,600 tiles; its RLE blob is reported in MIGRATION "Benchmarks". Welcome is sent
once per join or resume.
