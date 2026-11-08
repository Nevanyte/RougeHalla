# P-PERCEPTION-WITNESS-1 evidence record

**Status: verified partial handoff — the packet stays INCOMPLETE** (see *Remainder and prerequisites*). Evidence only:
no production, schema, protocol, observation, policy, Cargo.lock or shared-status change is made by this branch.

- Immutable base (pushed lead checkpoint): `ecf9564ce541ae8caaa344c7cc341075a1f20f47`.
- Source-witness capture commit: `6867f132afb9d1f86bba9ecd9706a9412c4d4452`.
- Branch: `deepseek/percept-witness-1` (isolated worktree; no merge, no push).
- Packet and review: `docs/coordination/P-PERCEPTION-WITNESS-1.md`, `docs/coordination/FAIR_OBSERVATION_ADMISSION_REVIEW.md`.
- Trusted image: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
  run with `--platform linux/amd64`; capture asserts node v22.23.4 / linux / x64 (emulated on the arm64 host).

## Isolation and write scope

- All work happened in the isolated worktree; every shell workdir used its absolute path. The primary checkout and the
  managed snapshot were never written. Fresh containers mount `/repo` and `/capture` read-only, the output directory
  writable only under the isolated worktree, and use `--tmpfs /repo/node_modules` (no host cache is touched). The empty
  ignored `node_modules` mountpoints required by the mount pattern exist only in this isolated checkout.
- `capture.sh` refuses an output path outside the isolated worktree even through `RH_PERCEPT_WITNESS_OUTPUT`.
- Files are all additions: `tools/percept-witness-fixtures/**`, `parity/policy/percept-witness/**`,
  `crates/rh-server/tests/percept_witness.rs` (native controls) and this record. `parity/policy/bot-perception.json`,
  all older goldens, production crates, protocol fixtures, client code and `Cargo.lock` are untouched.

## Artifacts, hashes and provenance

| artifact | size | sha256 | capture sha256 (over the corpus, profile excluded) |
|---|---:|---|---|
| `parity/policy/percept-witness/run-summary.json` | 274,260 B | `a383ca2317fb6c3e58046b2983165df4981eb89de1c852f2e24123a119a8c08e` | `1ab9ee01e399614524f5cf76682e9c43ad7322e4072666f5465076e1dd9b82d4` |
| `parity/policy/percept-witness/availability.json` | 41,581 B | `ba009e3407a257467bddbcbc1db7712ea5d6a5627e164709c55a98489a723b40` | `307afc12ac67582441de0f03df29687177c9caa6ea4d9af12aa351c2369e4f38` |
| `parity/policy/percept-witness/windup-path.json` | 45,974 B | `704b928cee21b46ca0cfc776ba74e13ff674ec81da8bd1401fabca71e73daf07` | `c6cb4c66daaa2909d2c2c14975bfd893961a2a37419d9e5792c323705695320c` |

Every corpus is `format: "rh-percept-witness/1"` and carries a profile with the pinned image digest, the Node/linux/x64
asserts, the sha256 of the full TypeScript import closure (**191 source files + 16 style files**) and the sha256 of the
capture tools (`capture.mts` `9f7f2189fba0a00febd2439f848200480663cfbb6d07936be70d5f60d337092f`, `capture.sh`
`2bf30b21864357789bc69f16262543b3abf7caff3453e5b14717d99cb355c6ff`, `css-stub-loader.mjs`
`ddf8e37fdac4707cc0960891deecdf780729a378e14a879862decfeb84cd8e7b`). All expected values come from the actual
TypeScript; nothing is regenerated or compared from Rust. Declared projection probes are labelled `declared-probe`; the
Windup emission/packing vectors are labelled `actual-producer vector + declared-state probe`.

## Commands and actual results (Lead re-ran independently)

```sh
bash tools/percept-witness-fixtures/capture.sh
bash tools/percept-witness-fixtures/capture.sh --check   # run twice; once with the output mount read-only
bash tools/percept-witness-fixtures/run-mutants.sh
cargo test -p rh-server --test percept_witness
cargo test -p rh-sim --test observe
cargo test -p rh-server --test publish
cargo test -p rh-sim --features trusted-status-probes --test status_privacy_review
```

- `capture.sh` → `run-summary: 192 perceive probes, 7 schema boundary cases, 29 statusLine probes; availability: 20
  planning modes, 5 roster rows, 5 lobby scenarios; windup-path: 14 fx steps, 7 observations; controls=captured`; exit 0;
  a write-mode recapture left the three corpora **byte-identical** (`git status` unchanged).
- `capture.sh --check` → `percept-witness corpora match: run-summary.json, availability.json, windup-path.json`; exit 0.
- `run-mutants.sh` → exit 0 with `ALL 3 SEMANTIC MUTANTS KILLED` and `RESTORED CONTROL PASS`, exact first mismatches:
  `01-visible-only-alive` run-summary `/probes/0/frame/hud/alive` 5 → 2;
  `02-hidden-identity-leak` run-summary `/probes/0/frame/fighters/2/id` "p-human" → "p-hidden";
  `03-final-batch-time` windup-path `/observations/0/frame/events/0/t` 100 → 999999.
  These are compiled semantic source mutants in a writable `/tmp` copy (read-only `/repo` never patched). They demonstrate
  source-witness discrimination only; they do not certify any missing native adapter.
- `cargo test -p rh-server --test percept_witness` → **4 passed** (native current-behavior/privacy controls below).
- Pre-existing controls unchanged: `rh-sim --test observe` **8 passed**, `rh-server --test publish` **5 passed**,
  `rh-sim --features trusted-status-probes --test status_privacy_review` **2 passed**.

## Witness findings

### 1. Legacy public run-summary projection (actual `perceive`)

192 `perceive()` probes over Lobby/Planning/Active/Ended (the source string, plus an unknown fallback) × training ×
four player cases (mixed humans/bots/dead/far/hidden, empty, single, removed roster rows) × schema-default/fixed
thresholds × empty/unique/64-character winner. Each records the full `frame.hud`, the sight-filtered `fighters` rows
and `frame.self`. The hud carries `alive`, `playerCount`, `minPlayers`, `startedWith`, `winner`, `training`, `phase` and
the clock fields. Provenance: declared source-schema probes.

- **Hidden-status witness:** two otherwise-identical Active states differing only in one hidden player's status
  (effects = EFFECT_HIDDEN, inside the view box) change `hud.alive` **5 → 4** while the sight-filtered `fighters` list
  is unchanged (the hidden row is in neither frame). The source counts every stored row before sight filtering.
- **Counts:** current rows 6 vs retained roster 8 (`p-gone-1`, `p-gone-2` ids stay in `state.roster`); `hud.playerCount`
  is `players.size` (6); `hud.alive` counts stored rows by status; `hud.startedWith` is the fixed run denominator and
  does not shrink.
- **uint8 schema boundary (actual `@colyseus/schema` encode/decode):** schema defaults `minPlayers` 0, `startedWith` 0,
  `winner` ""; reflection `minPlayers`/`startedWith` are uint8 (indices 5/6), `winner` a string (index 11). The host
  accepts 0, 1, 254, 255, 256, 257 and -1 **without throwing** and stores them; `Encoder.encodeAll` (66 bytes) +
  `Decoder.decode` returns **0, 1, 254, 255, 0, 1, 255** — silent modulo-256 truncation, no refusal. A future transport
  must define representable input/refusal bounds rather than inherit this.
- Human run-summary formatter (`statusLine`) 29 declared-input probes and `winnerLabel` 6 probes captured from the actual
  client sources (formatter strings; the DOM update that only computes `alive` for non-training Active is a source anchor,
  not a replayed lifecycle).

### 2. Legacy human availability and public rosters

- **Held-Tab map availability (`planningModeFor`, 20 probes):** lobby → `preview`; planning → `planning`;
  **active + non-training + Tab held → `map`** (the only `map` cases); active without Tab → `hidden`; every training
  case → `hidden`; ended/unknown → `hidden`.
- **Held-Tab roster (`mapRosterRows`):** all **five** declared synced rows appear, including the dead player, the far
  player outside the observer's view box, the bot and the EFFECT_HIDDEN player: identities, champions, dead/alive flags,
  kits and build strength, sorted by strength then name then id. There is no sight filter in this projection.
- **Same rows through `perceive()` contrast:** fighters only `[r-dead, r-human]` (far and hidden rows dropped), and
  `hud.alive` 4 of `playerCount` 5 — the two populations are different surfaces.
- **Menu lobby activity (actual `LobbyStatus.snapshot`):** 5 declared room/lease scenarios. Training-only rooms are
  excluded (`activeGame` null); the **first non-training room wins** (`room-a` before a later joinable `room-b`); the
  active game's human/bot seats are copied (Alice human alive, Bot Bob bot alive, Cara human dead); waiting hub lists
  Zed; `onlineCount` 3 (bots excluded); a full non-joinable arena (limit 2/count 2) → `arenaAvailable` false;
  `arenaLimit` 0 → `null`/available; a joinable full room → available.

### 3. Legacy Windup emission → pack → decode → perceive

Two real `createGameWorld`/`step` runs (seed 7; sword-vs-shield and wand) with the actual source producers and the
actual `packFx`/`unpackFx`: 14 fx steps and 7 observations (emission/packing labelled actual-producer; the actor state
handed to `perceive` is a declared projection of the real fighters plus a declared observer).

- Sword step t=100: raw fx `windup(ms=0)`, `swing`, `block`, two `hit`s, `heal`; packed batch t=100; observed frame
  keeps `windup`, `swing`, `block`, both `hit`s all at t=100 (the heal is below the client's shown threshold and is
  dropped); hit amounts round 31.06 → 31 and 1.73 → 2.
- Wand single-source windups: t=100 and t=1400, packed `[0,0,2,0,450]`, decoded `t` 100 / 1400 exactly.
- Same-step two sources at t=2450: tuples `[0,0,2,0,450]` and `[0,1,2,314,319]` (angle π → 314, ms 318.979 → 319),
  decoded and observed both at t=2450.
- **Originating time:** a visible windup is observed at t=100 while the declared state clock is 999999, so an observed
  event time cannot come from the final observation clock; two batches keep their own times [100, 1400]; a same-step
  pair shares 2450. Redaction: hidden (EFFECT_HIDDEN), out-of-frame and `canSee=false` observers drop the windup from
  `frame.events` while the global `hud.alive` stays 3.

### 4. Current native controls (new `crates/rh-server/tests/percept_witness.rs`, 4 passed)

1. The real Rust weapons producer emits `Event::Windup` for a melee press; its declared visibility is `ServerOnly`, it
   never becomes a `SeenEvent` (feeding the emitted events through the observation filter yields nothing) and protocol-11
   `WireFx` has no windup variant (the human frames of the same wake carry none).
2. Delivered controls: a real melee fight's `Swing` and `Hit` reach the observing human's `Observation` and decoded
   human frames.
3. Hidden identity/position privacy: two worlds differing only in the pillar-hidden player's action produce equal
   observations, equal reliable/fx frames byte-for-byte and equal Full snapshot bytes across 20 ticks; the hidden raw id
   never appears in decoded snapshot actors; the `ItemObserver`-prepared (actor-reference) path carries no hidden raw id.
4. Observation17 JSON has no `alive`/`playerCount`/`minPlayers`/`winner` aggregates; `ArenaView.started_with` is present
   (the fixed public run denominator).

## Admission matrix (legacy witness vs current native Observation17 / protocol 11)

| Legacy fact (witnessed) | Legacy surface | Current native | Disposition |
|---|---|---|---|
| `alive` aggregate (all stored rows, sight-independent) | `perceive.hud.alive`; human HUD only non-training Active | absent | **ABSENT native** (needs a named aggregate exception + ADR before admission) |
| `playerCount` current rows | `perceive.hud.playerCount` (`players.size`) | absent | **ABSENT native** |
| `minPlayers` threshold | `perceive.hud.minPlayers`; uint8 schema (modulo-256 on the wire) | room config only (`usize`) | **ABSENT from observation/wire**; representable bounds undecided |
| `startedWith` fixed denominator | `perceive.hud.startedWith` | `ArenaView.started_with` (lifecycle profiles only) | **PRESENT native** |
| Winner display name ("" before/draw/nobody; retained after leaving) | `perceive.hud.winner`; `winnerLabel` | `SeenEvent::Ended { winner: PlayerId, draw }`; `WireResult` has no winner name | **DELIBERATELY NARROWER** (id/draw only); durable winner name not evidenced |
| Held-Tab roster: all synced player rows, identities/kit/dead flags, unsighted | `mapRosterRows` (non-training Active + Tab + results closed) | human wire actors are sight-filtered; no all-row roster projection | **DELIBERATELY NARROWER** (legacy human disclosure surface; roster identities are not carried) |
| Menu lobby activity: first non-training room, human/bot seats, alive flags, waiting hub | `LobbyStatus.snapshot` | no equivalent projection in the current observation/wire | **ABSENT native** |
| Event originating step time | `TimedFx.t` = source batch step time, preserved into `ObservedEvent.t` | `SeenEvent` has no timestamp; human catch-up batches carry the final observation tick | **NARROWER/ABSENT**; equivalence not established |
| Windup event (actual producer → pack → decode → perceive when seen) | legacy fx kind `windup` | `Event::Windup` is `ServerOnly`; no `SeenEvent`/`WireFx` variant | **ABSENT native/wire** (visible windup gap recorded) |
| Swing / Hit / Block | legacy fx + perception | `SeenEvent` + `WireFx` | **PRESENT native** (controls pass) |
| Hidden actor identity/coordinate privacy | legacy `perceive` sight-filters fighters/events, but synced state and roster disclose all player rows to clients | observation/wire sight-filtered; ItemObserver presentation refs; hidden absent | **NARROWER native** (no leak; legacy disclosure recorded) |

## Remainder and prerequisites (INCOMPLETE)

1. **No genuine legacy lifecycle trace.** Reconnect-grace hold vs permanent removal, winner retention after leaving and
   a durable draw bit are not replayed: rows and winner strings are declared schema probes. Prerequisite: a pinned
   Colyseus room runtime profile (server + client join/drop/resume in the container) or an equivalent source-level room
   harness; not provided by the current fixture profile. The empty-winner vs draw distinction must not be inferred.
2. **Legacy frame-time visibility vs native completed-step visibility equivalence is not established.** The capture
   witnesses the legacy side only; a shared human/native projection decision belongs to the lead after this evidence.
3. **Bow windup is deliberately not scripted.** Source fact: `startAttack` sets the synced `drawStartedAt` for a bow and
   emits the windup fx only for the other weapons; the windup witness uses the real melee/wand producers.
4. **Human DOM/scene lifecycle is not replayed.** Availability is witnessed through the actual pure source
   (`planningModeFor`, `mapRosterRows`, `LobbyStatus.snapshot`); the RaidScene Tab/results-closed wiring is a source anchor.
5. **Native admission is a design decision.** Run-summary aggregates, an all-row public roster, lobby activity and
   event originating times are absent/narrower natively; admitting any needs the lead's transport/observation decision
   and (for aggregates) a reviewed ADR with a named aggregate exception (C-OBS unchanged today).
6. The three mutants kill source-witness discrimination only; they are not native parity and do not certify any missing
   adapter.

## Constraints honoured

No production/schema/observation/visibility/protocol/version/policy/Cargo.lock/shared-status edits; no old golden
modified; no invented events, times or identities; no account data, secrets, ML or cloud resources; no privileged test
seams added (the pre-existing trusted-status-probe feature is only run, unchanged); no merge or push. Verified partial
handoff: the packet remains INCOMPLETE with the prerequisites above.
