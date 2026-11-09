# Coordinator API/data admission

The reviewed coordinator chain `425943e9` → `843a03e4` and full-profile chain `37bfbb7f` → `d8255a49` are integrated
on `optimization_port` as `eebcee94` → `d410207a` → `5fbc3a81` → `538de384`. Root verifies all36 cumulative authored
manifest files match the final repaired candidate. Bootstrap, MatchClient and MatchHud integration remain in the UI lane.

Independent review initially held `37bfbb7f`: current leaderboard errors were unbound and therefore unusable under the
documented `IsCurrent` check, and the real purchase409/bad_request envelope became Unavailable. The repaired candidate
binds every query outcome and preserves typed refusal. [Independent probes](independent-review.json) verify six current
error outcomes, three late stale outcomes, later-query/owner invalidation, and stable purchase UUID/profile with zero
automatic retries. No remaining blocking findings were reported in ownership retention, strict integer/JSON validation,
immutable catalogs or mutation serialization. The original candidate is preserved.

The author's full515-test C# gate belongs to `37bfbb7f`; the repaired candidate passes60 focused tests and the exact
pinned Unity/AOT API-reference compile. Root's separate private composition with the frozen first UI slice passes554
C# tests at `cc7790b7`. These are overlapping, revision-scoped checks, not an additive count or actual Editor/Web result.

This admits reusable account ownership, data, catalog and HTTP APIs. The actual UPM3.2.2 direct dependency pin, combined
Editor/IL2CPP/browser validation, full screen wiring, reload durability and real deployed preflight remain pending.
Unknown purchase/equip outcomes stay unknown until explicit retry/reconciliation; a profile refresh is not a per-match
banking receipt. No server endpoint, persistent operation journal, cloud resource or permission is added by this slice.
