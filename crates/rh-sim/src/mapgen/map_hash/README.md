# Exact legacy map identity and Number strings

This leaf implements `map_hash(&GameMapData) -> String` and reusable pure
`number_string(f64) -> String`. It does not generate a map, admit a map, replace the
stored import identity, certify a Rust generator, or claim finished-map pin parity.
No production I/O, clock, entropy, process-global state or caches are introduced.

## Exact source semantics

The authority is `packages/shared/src/mapgen.ts::mapHash`. The port preserves its
field/list order, byte layers, list lengths, FNV-1a u32 wrapping, two bytes per UTF-16
code unit in low/high order, the final `0x1f` string separator, and eight lowercase
hexadecimal result digits. Numbers first undergo ECMAScript `String(Number)`.

Hashed fields are seed/attempt/dimensions; tiles/terrain/regionGrid/territoryGrid;
all camp fields; spawnPool; region id/pole/area/spawns/chestSpots; buildings;
featureGrid; every feature field; spawns/crateSpots/groundSpots. The legacy source
omits **props, all coliseum data, and regions[].mobCamps**. These omissions are
intentional and tested. They are not claims that all omitted metadata is cosmetic.
The tests exhaustively destructure the involved DTO records so new fields require
an explicit hashing decision.

The admitted seed and attempt ranges are JavaScript safe integers. Integer DTO
fields convert exactly to binary64 within admission bounds. World coordinates and
camp radii are not restricted to integers: the complete finite admitted f64 domain
uses the same number formatter. The 949 full-map radius probes include all 901
integer reach2 values from 0 through 30², plus arbitrary finite nonnegative values
and exponent boundaries. Every one is independently admitted by the existing M0
validator. Supplemental field/list mutants are labelled hash-function inputs; some
intentionally violate map cross-reference constraints and do not claim admission.
Unicode camp-id probes update the omitted mob-camp id consistently and pass M0.

Rust strings preserve all Unicode scalar strings, including supplementary characters
encoded as surrogate pairs for hashing. Lone JS surrogate strings cannot inhabit
Rust `String` and are rejected by M0's serde decoder; they are outside its admitted
DTO domain. Their source helper behavior is nevertheless captured as raw u16 units,
without JSON string replacement or Unicode normalization. Non-finite map coordinates
and radii are rejected by M0. The reusable number helper additionally implements
`NaN`, `Infinity`, `-Infinity`, and signed-zero normalization exactly; their oracle
inputs are binary64 bits, never JSON's lossy non-finite-to-null conversion.

## Numeric dependency decision

Use `ryu-js = "=1.0.3"`, not ordinary Rust Display, ordinary ryu, or serde_json.
Display demonstrably differs at 1e21 and negative zero; JSON differs at 1.0 and
non-finite values. Shortest-roundtrip conversion also needs ECMAScript's decimal
choice and exponent thresholds, not a cosmetic reformatting of arbitrary Display.

Primary upstream: https://github.com/boa-dev/ryu-js and its release package on
https://docs.rs/ryu-js/1.0.3/ryu_js/. The downloaded 1.0.3 Cargo metadata declares
edition 2021, Rust 1.71, and `Apache-2.0 OR BSL-1.0`. Registry checksum:
`04d056b875a9d2e6cb9a61d127afee9ac5999b9f87bcb32079d1318e505be714`.
There are no mandatory runtime dependencies. The algorithm and ECMAScript adjustment
are maintained upstream; this leaf does not invent a float conversion algorithm.
The local toolchain tested is Rust 1.97.0; compatibility with the project MSRV 1.85
is supported by the upstream 1.71 declaration and the APIs used, not an asserted
local 1.85 build (that toolchain is not installed).

Both the hash's stack-buffer number path and the public String-returning helper are
checked against actual Node strings for 122,370 distinct binary64 patterns. Coverage
includes 100,000 fixed-seed xorshift64 raw words, every binary exponent neighborhood,
decimal exponent neighborhoods, signed zeros, subnormals, extremes, safe-integer
neighbors, binary fractions, and all legal radius values. Finite nonzero outputs
also round-trip to the same bits. This is bounded differential evidence, not an
exhaustive enumeration of all 2^64 encodings.

## Actual-source capture

`tools/map-fixtures/map-hash.ts` imports the original generator/hash and creates a
temporary mapgen copy. Unique anchors add an exported reference to the existing
nested helper closures and an observational string-entry callback. Nested closures
cannot be exposed with a module-level export alone. No hash, Number formatting, or
map generation algorithm is copied into the oracle. Captured helper closures are
invoked only after the original mapHash call has returned, starting from that known
map hash. The callback records the string already passed by the real source `num`.

Eight actual tryAttempt maps cover styled/plain × decor on/off, negative and wide
safe-integer metadata, and a nonzero attempt. Complete original/tapped GameMap
values and actual hashes must agree; every pure mapHash input must remain deeply
equal before/after. All 39 transitive source dependency hashes are retained and
pinned by the test. The fixture also has 275 raw UTF-16 cases (272 scalar strings,
three source-only lone-surrogate cases), 2,048 byte steps, 107 field/list mutations,
and 949 independently admitted finite-radius full-map hash cases.

Canonical runner: Linux x64 Node 22.23.4, image
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`,
`--pull=never --platform linux/amd64`, read-only repository and private output,
node_modules tmpfs. Run `node --import tsx tools/map-fixtures/map-hash.ts` with
`RH_MAP_HASH_OUTPUT` for an external destination; `--check` requires byte equality.
A second canonical capture has reproduced the fixture byte-for-byte.

## Integration and verification boundary

The coordinator owns the parent module export, dependency manifest, Cargo.lock,
content/status integration and acceptance. This worker used an external harness
with rh-sim, the new leaf via a path module, ryu-js, and float-roundtrip serde_json.
No live parent module or manifest was changed. Production hash constants/enum names
are fixed wire encodings, not gameplay tuning and do not enter content visitation.

Eight negative implementation mutants are rejected: ordinary Display in numeric
hashing; missing positive exponent plus; UTF-8 instead of UTF-16; reversed UTF-16
byte order; missing delimiter; wrong FNV prime; omitted radius; truncated seed.
Logs and frozen file hashes accompany the external handoff. Independent review and
the coordinator's integration checks remain required.

## Independent review repair: numeric input inventories

Review showed that the original whole-map test checked 949 results but did not
require 949 distinct inputs: copying the radius-zero record into every slot could
pass. The repaired test admits only the exact 949-bit set constructed without
reading `numericMaps`: all `sqrt(reach2)*32` inputs for reach2=0..900, nonnegative
finite named boundaries (including -0), the fixed dyadic/safe-integer pre-fuzz
probes, and the independently regenerated xorshift64 samples selected by the
capture's fixed ordinal schedule. The actual assigned map radius is compared by
bits before hashing, so -0/subnormal inputs cannot silently normalize.

The 122,370 helper cases already required uniqueness; they now additionally require
exact class counts and independently derived named, binary-power-neighbor,
decimal-center, radius, safe-integer/fraction and all 100,000 raw-fuzz inputs.
Decimal exponentiation's captured neighboring values remain source-driven, while
correctly rounded decimal centers across the full range are independently required.
No fixture, tool, production implementation, dependency or expected hash changed.

A new bounded regression test checks the unchanged input sets, the original all-zero
duplication attack, a dropped case, replacements of required radius/-0/subnormal/
exponent/maximum cases, and helper duplicates/removals. It copies compact u64 input
vectors rather than repeatedly cloning the complete fixture. The repaired suite
contains nine tests; independent review will reapply the original full-fixture
corruption against the frozen repair.
