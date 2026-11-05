# Final terrain, decor and generator shape checks

This pure leaf ports stage ten, the post-ground decor/bush exclusion, and `shapeGateFailure` from actual `mapgen.ts`.
It neither draws randomness nor certifies a complete independent map. The generator's final terrain gate remains
`terrain_gate`; the separately authored finished-map certifier is another module.

`clear_terrain` is a no-op when no style hook ran. Otherwise it removes floor kinds buried under WALL, clears ICE with
any nonfloor neighbor or map-edge adjacency, and retains props only on their declared tile class. LOW kinds under WALL
remain, as in source. The ICE helper checks its eight neighbors, not its own tile. Tables/ICE identity are borrowed
from the same live terrain definition already included in content identity.

`clear_loot_decor` preserves prop order and returns the original bush exclusion around crates and ground spots.
Props also avoid the entire original picked pool, before the later spawn gate removes any members. Pool exclusion
is not added to the bush mask; the separate pool5 input already protects bushes. Invalid positions, lengths, byte
domains and tuning are refused before mutation; cosmetic props outside the map are filtered as in source.

`shape_gate` first checks all unowned zone blockers, including LOW; only then does it check same-zone eight-connected
WALL pieces. Feature ids are used only for zero/nonzero ownership, matching this narrow source gate. The gate does not
replace the richer strict feature checks of independent certification. Live minimum-piece and loot-margin values share
one allocation-free visitor and coordinator aggregate content fold.

The oracle saves nine genuine attempts (plain/styled, decor on/off, negative/wide/retry metadata) and one explicitly
labelled custom prop-injection hook run. That hook first executes the actual default zone styler, then supplies all
34 prop kinds on all three existing tile classes, invalid-coordinate/kind probes, and props on every original pool
member and its halo. Original and tapped complete
outputs and map hashes must agree before saving any observations. All five ordered phase boundaries are consumed.
Genuine outputs are also bound to the separate accepted records oracle, preventing a self-consistent empty world from
passing. The prop-injection input inventory is independently reconstructed in Rust. Every original pool is recomputed
exactly from accepted Rust stages one through five; it is not equated with the later gate's reduced pool. Genuine
final feature ownership is bound to the separate records output, including its exact renumbered ids.

The unmodified private ICE and shape helpers are exposed by export only. Their labelled synthetic cases cover 120
edge/class/neighbor combinations and 12 exact shape inputs with fail-first priority and border/zone separation.
The private `clearBuried` closure is exposed without invoking it during generation. After complete output/hash
equality is established, 48 labelled synthetic inputs call that original closure on its source-owned arrays, covering
all terrain kinds/classes with and without a style hook. No helper algorithm is copied into the oracle.

Canonical capture and byte-exact `--check` use Linux x64 Node22.23.4, image c86ecead9e55, read-only source archive,
private output and executable node_modules. All 75 shared source hashes are retained. Rust tests reject unknown fields,
wrong phase order, missing inventories and changed synthetic inputs, compare complete arrays/props/masks, and exercise
malformed preflight and live policy changes. Independent review and final combined integration remain required.
