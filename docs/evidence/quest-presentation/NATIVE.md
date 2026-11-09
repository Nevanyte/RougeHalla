# Native authoritative quest metadata

Source-only commits:4c5e564e95182559e956630a07e12e3ccd52ee84 and9ca8ba55d2cede2d078625c0a7dc78b500865c3c.
Native-only implementation/tests:eac1d09a6a5a077ab7daa2e851a768749db2b04e. Root approved the exact five String fields:
name, giver_label, brief, objective, reward. No public protocol/server/client/header/content/tape/status/lock change.

The new quest_view/presentation.rs builds text from the existing catalog and reward rules. Only after the existing
human/viewer/row entitlement gates does stage() obtain the selected owner's Farm facts and format an entitled row.
Closed Done/Expired history uses existing rules::reward_text without reading later owner counts. Open/Preview uses
existing reward_stats/Farm.count and the actual source binary64 addition/template representation. For example the
source MAX_SAFE_INTEGER+14 result is9007199254741004, not the exact-u64 sum9007199254741005. This changes display only,
not grant caps, payout or progression. Historical card helpers/payouts are not used as new rewards.

All five fields are checked by UTF8 byte length against the existing255-B label bound; failure returns the existing
InvalidLabel error through stage's fallible preparation, before publication/authority commit. No truncation or partial
row is emitted. Static strings/grammar do not require a new identity, input, game rule, RNG source, canonical field,
cache or alias. Current stage builds fresh staged views; this packet adds no cache or zero-allocation claim. Existing
can_accept/Owner*/handle/navigation logic is unchanged. Aggregate public byte caps/identities remain root/Net-owned.

## Verification and boundaries

- Native helper parity compares all20 definitions and all180 captured declared formatter contexts, exact five strings
  and Number bits; measured maxima25/22/96/61/91 and4,720 extra encoded bytes agree with actual source capture.
 160 contexts exercise the production Farm/state formatter;20 absent-optional-count source helper probes compare the
  shared fixed-wording branch (an entitled Native player always has Farm). These are method-input probes, not180
  ordinary acquisitions/outcomes. Source functions/compiled mutations/external byte reproduction are recorded separately.
- Per-field synthetic owned-text controls accept255 UTF8 bytes and refuse256 without rewriting. They are boundary
  controls, not installed game state or a fabricated invalid catalog in a live match.
- All26 affected quest_view tests pass, retaining prepared commit/drop/reconnect, preview authority, lazy roster and
  hidden/exhaustion/typed-owner/actual acceptance/turn-in/expiry/navigation controls. New tests use the existing real
  native Farm grant as labelled trusted setup, compare the owner's137-count wording to actual source, ensure identical
  names confer no ownership, foreign Farm facts change nothing, projection preserves state/RNG, and disabled/bot/
  unknown viewers have no metadata. One deliberately noncanonical hidden bad-definition guard proves unentitled
  rows never inspect metadata. It is not a canonical restore/admission claim.
- Strict all-targets Clippy for rh-sim/rh-policy/rh-headless/rh-parity with trusted-status-probes and fmt pass.

No unchanged World/source/public14/giver8/workspace campaign is repeated. Source evidence files and fixture bytes are
unchanged after the source seal. The native view carries strings; existing public codecs still need the root-owned
extension, whole-frame budget review and final OBS/policy/transport union. No public activation, Unity panel/rendering,
full-browser acceptance, new gameplay grant, final efficiency or complete-port claim follows from this packet.
