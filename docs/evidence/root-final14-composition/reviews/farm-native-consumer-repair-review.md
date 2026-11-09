# Native farm consumer repair — narrow read-only re-review

**RELEASE for a916d8e83534fa5cbbbc4163ced48df8e1695142**, code **76b57df2525392abcf571cf9452d255d852e9c8d**, branch `deepseek/farm-native-consumer-repair`, based on immutable **4ecfb6cdb13908319be20807249667c12bac0416**. All five identified findings are closed within the requested test/evidence scope. No new blocker found. This releases the repaired test-only native producer consumer for Root admission; it does not admit staged public delivery, Room/codec/UI or hosting.

The [original4ec HELD review](/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/farm-native-consumer-review.md) is preserved unchanged, SHA-256188b0d6b700d6d7b9661c5dd9b610666dd2f9f494d16556ae570e1f94dd80612. Its verdict remains applicable to4ec alone. This separate report evaluates only the narrow repair and unchanged context.

One worker. No test/build/format/lint/Docker/capture/mutant/Editor/browser/cloud rerun or campaign. Only this report was written; no repository, source/corpus, production, version, identity, tape, status, lock or old review file was edited. The repair worktree `/Users/nevinmckinnon/Documents/Projects/RogueHalla-farm-native-consumer-repair` is clean at the stated head.

## Findings closed

| Original finding | Closure verified |
|---|---|
| Uncommitted verification logs | All six original/corrected log files are now tracked Git blobs, including both empty format logs. All nine SHA256SUMS entries validate directly against `git show a916d8e:PATH`, as well as worktree bytes. No private/untracked file is needed to verify the manifest. |
| Overbroad1e-8 host normalization | The helper is replaced with `actual.to_bits() == expected.to_bits()`. serverTime, drawStartedAt, readyAt, hp and maxHp use it every frame. No epsilon, abs-difference or near helper remains. Decoded u32 clocks and mirror assertions remain exact. The corrected focused receipt passes with these exact assertions, so no residual readyAt/HP normalization is being accepted. |
| Farm totals erase type identity | Every frame now builds a source typed `BTreeMap<String,u64>` and a native typed map over ALL catalog types with nonzero counts. Exact map equality rejects extra types/wrong distribution. The sealed source has104 empty frames then31 with onlyplagueRat3. The original actual-kill and final PlagueRat assertions remain. |
| Incorrect testBytes360 | Corrected receipt records13,572 bytes /371 lines, SHA-256a86b11819b31374e84d157e29466a17138e0a4e97c55d272ba164fb2c37916df. These agree with the HEAD Git blob and working file. |
| Unsupported first-lethal-hit wording | New README/receipt state the owner-sourced combined disease/execute ledger pass killed the target, both disease callbacks already observe the dead victim after combined subtraction, and derived kill.lethalHit selects the last dead-status callback. There is no unique first-hit attribution in the new superseding prose. Original source/history bytes remain untouched. |

The typed source entries are unique positive catalog counts in this immutable corpus; the BTreeMap comparison does not discard any recorded source duplicate/count information here. Native actual counts come from owner.farm, never from the expected map. The exact helper compares native state to the sealed JSON values; no source fallback or expected-state installation was added.

## Byte and scope verification

The only two commits after4ec are76b57df2 and a916d8e8. The11-path diff contains only the existing new native test and `docs/evidence/owner-combat-farm-native/**`. Every changed worktree file matches its sealed HEAD Git blob. The original cfg(test) declaration/owner_combat.rs body is unchanged by this repair.

Compared function bodies to4ec: corpus loading/number conversion, target_actor, secrets, arena, placements, construct, run and the actual test entry are byte-identical. Only the comparison helper and frame comparison logic changed, plus the BTreeMap import. Native map generation, RNG, rack setup, actor binding, ordinary validate→submit actions and real stepping are preserved. No producer, projection implementation or source outcome was changed to make the stronger checks pass.

All30 sealed source additions remain byte-identical to both4ec and **9800a34c57ce12d43d84fdc210313934e382ad79**. Farm corpus remains1,250,830 bytes, SHA-256 **9cbb71b162a6bf36b5b4445cd4ca4bb5ab5e3c6559279467153e9ee9d7a62228**. The original four-category source boundary, untouched source mutants/receipts and their one-restored-checkout/fresh-Node method remain unchanged; no mutant execution is inferred for this native repair.

`sealed-payloads.txt` has nine historical payload records. Independently verified each claimed Git blob ID and SHA-256 using the named4ec or9800 commit object, rather than trusting a worktree copy. This includes the original receipt/README/checksum/test/module and selected frozen source payloads. The three renamed original logs match the exact hashes recorded by the original review; tracking them now repairs portability without pretending they were tracked at4ec.

Sealed repair evidence hashes:

- receipt.json:17942e24237af1bcc31d445dd6b5d87aacb1d19a953bbfc8584498b10bf6ca9e
- SHA256SUMS:7e3f274923d9eeced1500226d612bf47a0d14eab45913a1da057fc634b030ad7
- sealed-payloads.txt:b19f328072164ac9444c2bcb750d9d2d0462023670186e949e8eb6ffbbca29d4

## Focused receipts and limits

Inspected the now-portable corrected log payloads, not newly executed gates. Corrected cargo log records the exact farm test,135 compared frames, actual kill/farm3/asMult1030 and **1 passed/0 failed/781 filtered**. Its SHA-256 is5a80bf5bb58c424c2608c6effc87f2bfbc946d9ceb8341fd66964be5ddce1f21. Corrected scoped clippy log records Checking rh-sim in the repair path and successful Finished, with no warning, SHA418de69fb939e16f8eabc5fe9bcbe7bf205b8894071126c06b42326310f006ff. Format logs are tracked empty files with the standard empty SHA; exit0 is attested in the corrected README/receipt. These remain author receipts for one focused test, fmt and scoped no-deps clippy, not strict/all-feature or workspace acceptance.

The real native path remains seed20261101/attempt0/hash3435915058,50 camps, native ActorOrigin camp20/spot0 nonelitePlagueRat; declared initial seats/HP/RNG/rack setup; ordinary pickup step1 and Target step4 through validate+submit;135 native completed steps; actual step105/frame104/tick106/time5300 death and farm3/asMult1030. The stronger exact host and typed-map assertions now support the narrow comparison claim without a numerical waiver.

The source alias is a trusted raw fixture binding to the native camp actor. Native canonical-held target comparison and current-native-entitlement projection are preserved. They do not establish independent source entitlement parity or delivered public ActorRef/ItemObserver staging. Matching native projected clocks/mirrors to the sealed source's decoded scalars is not native wire encode/decode. No shared policy Frame/Room reliable enqueue, socket/join/Resume, Unity/UI, public profile/identity, digest/tape or cloud acceptance is supplied by this repair. Those remain separate Root gates.

**Disposition: RELEASE repaired a916d8e8 only; original4ec hold/history retained. Root admission remains separate. Stop after this finite re-review.**
