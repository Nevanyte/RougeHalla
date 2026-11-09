# Bot ownTimings native component

Status: PASS. One bounded mechanical Rust component of the remaining authoritative bot port: the source
bot's ownTimings timing lookup. This is a pure timing component; it intentionally proves no live fight,
orb-walk, full brain, tournament outcome, socket/Room or public activation.

## Base / branch / source witness

- Exact base: 11d04034c18a6cf2764dafa82553ab4b49b3c8de.
- Branch/worktree: deepseek/bot-own-timings in
  /Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings.
- Code head: 8d452fde2eca203990f75be35007bc2f4e2d2b15 (code commit; the evidence commit is the
  branch head containing this receipt and is reported to Root).
- Immutable admitted source witness: parity/policy/bot-fight/source.json, 467,672 bytes, sha256
  197fe5d24b6b34822a3ef76e2999d422e6127bbda1e8dfda0ba0af3ee5e2785e. It was not modified or
  recaptured; its timing rows are the only expected-output oracle.

## Write lease / API

Only new crates/rh-policy/src/bots/kite/own_timings.rs and the declaration/re-export lines in
crates/rh-policy/src/bots/kite.rs changed. The existing away_point implementation is untouched; no
sim API, source corpus/tool, tuning, RNG, protocol/delivery/client/status/Cargo.lock or activation
change.

    pub struct OwnTimings {
        pub interval_ms: f64,
        pub windup_ms: f64,
    }
    pub fn own_timings(
        faction: Option<rh_sim::FactionId>,
        weapon: crate::bots::types::BotWeapon,
        as_mult: f64,
        windup_mult: Option<f64>,
    ) -> Option<OwnTimings>;

The helper is exported from crate::bots::kite. Explicit BotWeapon::Fists means an available empty hand
(the real six-variant catalog entry), never a missing-inventory fallback. No faction returns None; an
absent windup mirror uses the source default 1. The caller still owns missing owner/inventory/public-fact
refusal; this helper invents no eligibility, default faction, zero clocks or hidden facts.

## Implementation

- Reuses already-public native content::paced, content::attack_interval and content::player_timings,
  which are the native equivalents of the source pacedFaction / attackInterval / player weaponTimings.
- Reproduces the exact source scaleWindup arithmetic order locally (a source arithmetic step, not a new
  tuning table): windupMult == 1 or non-finite returns unchanged; a ranged windup is never cut by
  windupMult < 1; otherwise ranged windup = max(base, min(interval, base * mult)), melee windup =
  min(interval, base * mult); root follows the same source order only where root > 0. Player melee
  windups are zero, so axe root is zero in this player-timing path. Interval is returned as
  interval * 1000 and windup as windup * 1000, preserving source binary64 order.
- No clamping, guessed rounding, generic epsilon or default missing fact was added.

## Tests / oracle

The focused test child consumes the immutable source corpus directly, never the new implementation, and
compares raw f64 bits exactly:
- 90/90 timing rows: intervalMs and windupMs exact. All five source factions and all six BotWeapon
  variants (including Fists) are covered across the source's three mirror pairs.
- 6/6 no-faction unavailableTiming rows return None for each weapon.
- Explicit Fists controls: all 15 source Fists rows are Some, with the source's zero windup and exact
  interval; no missingInventory diagnostic is relabeled as supported Fists behavior.
- Default-windup controls: every actual source row with windupMult == 1 is also called with None and
  must equal the same source row exactly (source default is 1).
There is no tolerance. Any source/native mismatch would be a failure; none occurred.

## Commands / environment / results

Run from the worktree with Rust 1.97.0, private target /tmp/bot-own-timings-target, CARGO_BUILD_JOBS=1,
CARGO_PROFILE_TEST_DEBUG=0:

- cargo test -p rh-policy --lib bots::kite::own_timings -- --nocapture
  exit 0: 3 passed, 0 failed, 140 filtered; source 90 rows, six nulls, Fists/default controls all pass.
- cargo fmt --check: exit 0.
- cargo clippy -p rh-policy --all-targets --all-features -- -D warnings: exit 0 (strict scoped lint).

Portable raw logs are tracked under documentation evidence logs/ (force-added despite *.log ignore):
- cargo-test.log sha256 481e7b7a934e73db73628ab82cf1a6bf86a33f1c0b403abbc3bfd5a99e3fed6d
- clippy.log sha256 6e15326d9a32e2c00bcc338d6ef59d1f1278f2c309bd80a7e992bbcc3bf36318
- fmt-check.log sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (empty, fmt clean)
hashes.txt records git object/content hashes and file hashes used for the seal.

## Scope / limits

- Code: new crates/rh-policy/src/bots/kite/own_timings.rs (207 lines, 7281 bytes, sha256
  18d0981c621644db6d88939103c6d5a08dc4c5d8ba06bde7dc7e70089035db21) plus only declaration/re-export
  lines in crates/rh-policy/src/bots/kite.rs. Existing away_point body unchanged.
- No bot.rs/perception/fight/OrbWalk/live dispatch, no sim rules/helpers/exports, no RNG, no
  protocol/delivery/server/client, no source corpus/capture/tool, no identities/content/tapes, no global
  status or Cargo.lock/Cargo.toml edit.
- This is a pure timing lookup: no live fight activation, orbwalk, full brain or tournament outcome is
  claimed. Public catalog reuse required no wider change; no dependency was widened.

Root owns review/merges; this lane stops here.
