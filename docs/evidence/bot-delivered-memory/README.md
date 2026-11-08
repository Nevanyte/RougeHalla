# Private delivered13 boundary and bounded memory prefix

Base `198902f42970bd3d71d431931020819b0e36f008`; branch `codex/bot-delivered-memory`. The prior hazard candidate
`628791b5` is immutable and not rewritten. Existing admitted Knowledge RNG/view/planning/delay/learning/path/tactics
helper prefixes are retained. Local bot/brain branch inventory found no committed full memory/FrameRing/strategy/chest
port to duplicate (the preserved brain tip47ffd063 is the old proposal); uncommitted/private experiments remain untouched.

`bots/delivered.rs` accepts **owned codec-shaped reconstructed13 records**, with f32 owner data and remote u16 position/
angle codes. It widens only decoded precision, preserves actual source time and distinguishes unsupported `Unavailable`
from supported owner clear. Known type/finite/bound/order/reference checks refuse invalid or unsupported inputs. Player
and NPC presentation namespaces are separate; NPC sentinel cannot become an actor. This is NOT a decoder, publication
receipt, unforgeable delivery token, fair render percept or current action capability. No raw Observation/Sim constructor
exists. C# codec paths are read/pinned; no new C#/Unity/Web test run is claimed.

`bots/memory_prefix.rs` consumes only that frame: seen-player faction/weapon/bar/bounty/status/last-observed position,
source last-held weapon across fists, permanent observed death/MIA, own >1u anchor/stillSince and source whereabouts
uncertainty/expiry. It narrows snapshot rows by existing source bot camera and delivered hidden bit before counting or
recording them. This instantaneous subset is not full delayed FrameRing/render-time semantics. Absence never changes
last observed position/status/bounty or infers a death; NPC/dot/quest/roster/item identities are not player memory.
Historical positions are private record data; navigation uses expiry-checked whereabouts and cannot become a target/
handle. HP forgetting is explicitly `ForgottenAssumedFull`, the source heuristic, not a claim to know hidden current HP.

Memory is bounded by caller limit<=512 historical delivered players and finite weapon enums; overflow refuses the whole
transition atomically, with no eviction/truncation or clocks/owner motion advanced. It does not count hidden/off-camera
rows. Duplicate/backward source times refuse unchanged and require explicit reset; epoch/viewer mismatch and absent
owner refuse unchanged. Caller reset clears all records/motion at match/reconnect/training/source-clock reset. It preserves
allocation capacity only; no implicit restore compatibility or new persisted state format/version is introduced. All expiry
queries use the last successfully accepted delivered source time, never a World clock or tick*50.

Unavailable: canonical lock/absolute ready/draw/immunity/mirrors, source names/BOT/brand/global player counts/winner,
individual minimap, event origin history and durable item continuity. Other delivered but not yet implemented groups
(inventory/build/Wish/arena) remain outside this small frame subset too. There is no defaulting them to zero, false,
empty strings, identity multipliers or last target clicks. There are no events, input/ack guesses, AI goals, commands,
C-INPUT bypasses, I/O/entropy/ML, shared observation/wire/identity edits or seat activation.

[Next shared facts and exact root decisions/leases](NEXT_SHARED_BOT_FACTS.md) specifies actual source producers/human
receivers, entitlement, numeric precision/limits, absence/clear/lifecycle/queue rules and missing witnesses per field.
It does not allocate tags/bits/versions and keeps quest's separate candidate ownership intact. Full memory/strategy/
tactics/chest/hazard/stateful hunters remain open; this prefix is their lawful foundation, not a completion substitute.

Validation/hashes are in receipt.json; raw logs live outside the repository in
`return-cleanup-2026-11-08/bot-delivered-memory/`. No old expected corpus, Cargo.lock, shared status or production source
capture changes. Seven focused Rust tests, source bytecheck and real semantic controls are the gate; no broad workspace,
map, backend, Unity or browser campaign. Full warm allocation/time and paired-world prepared-publication proof remain
future binding gates; no such claim follows from a direct input-level noninterference test.
