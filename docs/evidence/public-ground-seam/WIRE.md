# Private protocol 14 ground contract

Base cc7790b70fbb617fc42fdf1c1cce23f3e2d35898. Internal section version 1. All multibyte integers little-endian.
No new outer message tag. Existing Welcome fields and collision map precede the extension unchanged.

## Bytes after the existing collision RLE

```
extension_length:u32                 // excludes this four-byte length; includes everything below
section_version:u8 = 1
presence:u8                         // bit0 terrain, bit1 region; all other bits forbidden
semantic_hash:u32
if terrain present:
    run_count:u32
    runs[run_count]: (value:u8, length:u16)
if region present:
    run_count:u32
    runs[run_count]: (value:u8, length:u16)
terrain_mode:u8                      // 0 Off, 1 Map, 2 All; actual room config
context_hash:u32
```

Canonical plane order is terrain then region. Absent planes have no run-count field. Present planes decode to exactly
`N=w*h` row-major bytes; an all-zero present plane differs from absence. The minimum extension_length is 11.
Terrain domain 0..7; region domain 0..6. Terrain0 accepts any valid collision class; 1..3 require collision1 or2;
4..7 require collision0. No semantic inference or clamping. Native full metadata projects both planes, otherwise both absent.

## Hash bytes

FNV-1a32 uses offset 0x811c9dc5 and wrapping multiply 0x01000193 after XOR of each byte.
Collision hash remains exactly dimensions as u32 LE then collision cells, with no new fields.

Semantic hash feeds this exact concatenation (domains are ASCII bytes including the terminating NUL):

```
"rh-ground/1\0"
w:u32 LE, h:u32 LE, section_version:u8=1, presence:u8
terrain uncompressed N bytes if present
region uncompressed N bytes if present
```

Context hash feeds:

```
"rh-map-context/1\0"
collision_hash:u32 LE, semantic_hash:u32 LE, terrain_mode:u8
```

Hashes alone never establish cache equality: compare dimensions, collision bytes, presence, complete semantic planes,
and actual mode when reusing decoded/context-bound content. Expose those decoded facts without gameplay calculations.
Decoded names: Rust `terrain`, `regions`, `terrain_mode`, `semantic_hash`, `context_hash`; C# `Terrain`, `Regions`,
`TerrainMode`, `SemanticHash`, `ContextHash`; JS `terrain`, `regions`, `terrainMode`, `semanticHash`, `contextHash`.

## Static encoding and limits

MapBlob's decoded model may contain mode/context. EncodedMap must cache only the static prefix through semantic runs
(its extension length already accounts for the final five context bytes). A required mode argument on the cached Welcome
encoder writes the final mode and computed context hash outside that static cache. No room mode is stored in an arena-only
cache, and no per-tick serialization is introduced. Root wires the room's actual config to this explicit argument.

All decoders must preflight the whole map/extension with a copied/bounded reader before allocating decoded planes.
Validate shape, all run counts/bytes/domains/lengths/hashes, context, terrain/collision compatibility and exact extension
consumption first; only then allocate/decode. Retain nonzero dimensions, N<=1,048,576 and full frame<=262,144 bytes.
Each plane has 1..N runs; cumulative run count <=3,145,728 (collision plus at most two planes), with encoded byte-count
checks against the bounded input before loops. Explicit cumulative decoded plane budget is 3,145,728 bytes, using checked
arithmetic for N*(1+number_of_present_planes). Reject unknown version/flags/mode, zero/overfill/truncated runs, missing
section, excess section/trailing bytes, bad hashes or incompatible terrain. Producer performs checked u32-to-u16 narrowing
and preflights the complete Welcome size before asset admission. No cap increases or truncation.

Rust protocol agent owns protocol/types/golden and chooses narrow APIs consistent with these bytes, communicating them
early. This packet's chat lead owns server projection and consumers; the project lead owns final main admission.
C#/JS agents own their codecs and focused tests. Native-header metadata/content/status,
gameplay activation, renderer and broad test/build campaigns remain outside scope. Final combined 14 admission is root-owned.
