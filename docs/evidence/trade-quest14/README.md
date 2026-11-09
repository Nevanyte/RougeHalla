# Private protocol14 Trade and quest metadata candidate

Implementation head: `1668f05eedc8c174927bf1f7225c0ee9cfecaf05` on `codex/trade-quest14`.
Extraction base: `614b85b1979d816e3c7a3f5838a454da76b6dbda`.
This finite candidate carries owner-only native Trade facts, ordinary Trade input and the five
source-matched quest display strings through Rust, C# and the embedded JS codec. It preserves
the existing prepare/commit transaction. It does not activate a hosted quest/trade profile or UI.

The exact byte contract is [WIRE.md](WIRE.md); protocol gates are detailed in [RUST.md](RUST.md).
[MANIFEST.json](MANIFEST.json) seals the implementation, reused source inputs and packet evidence.
The manifest excludes itself; the final evidence commit seals its bytes.

## Imported dependencies

Only the following approved upstream commits were imported, in this order. The source/evidence
commits retain their own provenance; this packet did not run another source capture.

| Upstream | Local | Purpose |
| --- | --- | --- |
| `5f7444ee48ec52c940312c8a576dd8386abae0ba` | `cda60a32` | Earned-trade armor restore bound |
| `261b9af22f30c7be60dc23bbf49edf86c7a2d346` | `12513e19` | Native private Trade view and ordinary input |
| `fb0733166b658d818cb9c038af29dd4e12cdc095` | `c3688884` | Native Trade source/privacy/restore evidence |
| `4c5e564e95182559e956630a07e12e3ccd52ee84` | `889b6a6f` | Actual quest formatter capture |
| `9ca8ba55d2cede2d078625c0a7dc78b500865c3c` | `821de3eb` | External formatter reproduction evidence |
| `eac1d09a6a5a077ab7daa2e851a768749db2b04e` | `c5e89058` | Native five-string quest metadata |
| `9034887d90b74ca1dd0593887e3d308fa6651511` | `f1b4e288` | Native metadata evidence |

The two test-only `wire.rs` repair hunks supplied in upstream
`1ddad5d63f7016e65d3eddaa5bd47082c3a3710f` are included: the test's `WirePoint` import and a literal
Freeze protocol-code assertion. No private projection helper is exposed.

The native metadata's five implementation/test leaves were verified byte-identical to `eac1d09a`.
The six native Trade view/runtime/test leaves listed in the manifest match `fb073316`.
The quest source fixture and native metadata manifest match `9034887d`.
Whole shared `observe.rs`/`item_view.rs` files are not claimed identical to the native source branch;
their existing owner-combat bridge was retained during the authorized composition.

## Delivery behavior

Input command18 contains only the fixed merchant kind and pick0..2. The server maps it to the
native `PublicCommand::Trade`, which still resolves, validates and submits through C-INPUT.
Clients do not determine prices, rewards, range, eligibility, used state or cooldown completion.

State11 is a complete Trade replacement. Omission retains its prior value; Unavailable and an
available empty view are distinct. The shared collection projector reads only the already-filtered
native observation and that same observation's inventory. It preserves saved offers, signed and
duplicate stat rows, binary64 bits, optional absolute deadline, and merchant row ordering. It uses
the native catalog/helper for merchant names and barter labels, preserving empty hand versus Fists.
Missing or invalid inventory with available Trade refuses preparation. There is no World lookup,
offer roll, modifier fold, price calculation or RNG use in this projection.

State10 Quest rows copy `name`, `giver_label`, `brief`, `objective` and `reward` from the native
factory. The strings are opaque display values; typed handles and owner facts retain authority.
Every field and the aggregate value are checked before publication. Metadata-only changes are
replacement changes. No client reward/objective formulas were introduced.

Collection preparation leaves baselines untouched until the complete reliable batch is accepted.
Tests cover dropped preparations, failed encoding, full/closed outbox, retry, forced resync and
actual Room Resume. Accepted gameplay actions remain applied when publication fails; delivery
is retried without advancing the failed publication baseline. C# and JS validate complete frames
before held-state mutation, including retained/replaced QuestItem references. C# owns copied DTO
arrays and Unity net mirrors match the source network library.

## Verification

All recorded final commands passed. Focused filters below do not overlap within their package;
the C# vector subset is included in its full-suite total and is not an additional747 tests.

| Gate | Result | Evidence |
| --- | --- | --- |
| Rust protocol package | 113 passed | [log](logs/codec-rust-package-tests.txt) |
| Shared collection projection | 11 passed | [log](logs/shared-collections.txt) |
| Room Trade bridge | 2 passed | [log](logs/server-trade-bridge.txt) |
| Room Quest bridge | 4 passed | [log](logs/server-quest-bridge.txt) |
| Server wire | 23 passed | [log](logs/server-wire.txt) |
| Server owner-combat | 4 passed | [log](logs/server-owner.txt) |
| Server outbox | 9 passed | [log](logs/server-outbox.txt) |
| Native quest view | 26 passed | [log](logs/native-quest-view.txt) |
| C# full network suite | 747 passed | [log](logs/csharp-full.txt) |
| C# protocol subset | 413 passed, included above | [log](logs/csharp-vectors.txt) |
| Unity network mirrors | Exact match | [log](logs/csharp-mirror-check.txt) |
| Embedded JS codec | 65 server vectors,201 malformed,23 chains,49,311 checks | [log](logs/js-embedded-codec.txt) |
| Protocol/policy/server all-target, all-feature strict Clippy | Passed | [log](logs/shared-server-clippy.txt) |
| Protocol/policy/server formatting | Passed | [log](logs/shared-server-fmt.txt) |

The42 focused server tests are the five server rows above. Room Trade tests use a private component
genesis with real deterministic native merchant producers and ordinary typed initial placements.
A probe checkpoint supplies navigation coordinates only; quotes, cooldowns, trades and outcomes
are never installed. Encoded/decoded input executes real first-contact wait/roll, Stats and Barter
acceptance, owner-private feedback, repeat refusal, inventory changes, resync, Resume and stale
connection fencing. Each outgoing event is fed through the same temporal observer path as
`Room::wake`. This is not a hosted socket, browser, canonical scene-admission or UI test.

Synthetic projection controls explicitly cover numeric/string boundaries, signed zero, duplicate
rows, labels and transactional retention. They are not claimed as earned gameplay or source captures.
Initial test-harness failures remain in `shared-initial-key-counts.txt` and the two
`server-trade-initial-*` logs: stale ten-key expectations, bypassed temporal event carry, and wrong
expectations about omitted unchanged Trade/returned Welcome were corrected before the final gates.

The imported actual quest source corpus contains180 declared formatter contexts across20 definitions,
not180 ordinary gameplay acquisitions. Its source fixture SHA-256 is
`4a021c349a6cc085c6994550fc4415ffadedc2cd22690cd803e56cc4eda8e19e`.
Native tests on this composition pass against those unchanged bytes. Native Trade's imported six
state cases and17 action recipes retain their separate source evidence; they were not recaptured.

Rust toolchain/environment and protocol commands are in [RUST.md](RUST.md); each integration log
records its exact command. Cargo uses the isolated `rougehalla-trade-quest14` target, jobs1,
incremental0 and dev/test debug0. The final Cargo slot is released. The .NET executable was
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet`.

## Bounds and remaining acceptance

The generated private v14 fixture has SHA-256
`9012167a320419d04d62aa340276d7fbc5181a60ea818554f278a62d26b1b336`.
The2213-byte Trade maximum and24576-byte Quest value include availability. A structurally valid
24577-byte Quest is refused. Trade's structural bounds already imply2213; an extra trailing byte
tests outer trailing-data rejection, not a reachable valid-shape Trade overflow branch.
The synthetic complete eleven-key State is exactly247696 bytes, leaving14448 below the unchanged
262144-byte frame cap. The540672-byte writer buffer is unchanged. These are arithmetic/test
bounds, not measured traffic or performance results. Complete moving merchant replacements can
repeat owner text;2213×20 is a44260-byte/second/seat value ceiling before framing, not measured use.
The existing256-important-frame outbox cap remains a frame-count policy.

All previous JS server-vector prefix truncations remain exhaustive. Only the new247696-byte
all-key ceiling vector uses bounded cuts: first/last512 bytes and every1KiB boundary. The Trade
and Quest maximum vectors still receive exhaustive prefix checks. JS syntax checks also pass.

Private protocol identity remains14; no version/identity/status/content/tape refresh was made.
`Cargo.lock`, `docs/MIGRATION.md` and `docs/CONTRACTS.md` match the extraction base. Actual UI/HUD,
Editor, cloud resources, profile admission and policy Frame/epoch binding remain coordinator-owned.
The existing quest/trade profile gate remains held. The pure projection does not attest delivery;
the final policy Frame union must carry the new fields without silently dropping them.
No workspace/DB campaign, browser campaign, UI interaction, performance run or source recapture was
performed for this packet. In particular, this private14 candidate does not inherit the separately
sealed frozen-browser all-five-R/Trophy proof for runtime1310ae00. Coordinator review/union and the
actual hosted client flow are still required before public activation.
