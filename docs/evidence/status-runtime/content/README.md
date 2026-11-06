# Frozen status content proposal v1

Private coordinator proposal, 2026-11-05. No live edits, descendants, builds or tests performed. Inputs are accepted final status-runtime-work material (integration-v2 manifest `3f7575820bdf8d8c4b70a0a2c1efa89e5d383386efdfa6bffe30ec401d4b60d8`) plus accepted live mob aggregate integration. Actor plan stays frozen unchanged.

## Ready artifacts

- `aggregate-fragment.rs`: minimal coordinator-owned borrowed-slice seam. Add one final optional argument to the common hash function; existing wrappers pass None without changing supplied stat, mob, map or signature definitions. Default hashing streams actual visitors with no Vec/heap allocation. Distinct labels and lengths frame the two streams. Root places the fold before stat-fold and retains mob fold.
- `status-api-content-only.patch`: five existing numeric constants re-exported narrowly for independent integration inventory, actual AbilityId::ALL replacing the duplicate visitor list, and actual Axe tag length/bytes appended to visit_extra_content. No behavior, rule or table replacement.
- `crates/rh-sim/tests/status_content.rs`: one new integration test file, three tests. It independently constructs labeled words from actual typed rules/policies and production constants, then compares complete visitor outputs. No copied tuning values, alternate status table or alternate hasher.

## Audit result and precise missing identity

`StatusRule` has six fields: max_ms, combine, cap, cleanse, bit, players_only. They are all visited and all used by actual admission, mutation, value/effects or cleanse readers. `RankOneFieldPolicy` has exit_stun_ms and burn; both are visited and read by real field removal/DoT processing. FieldKind discriminants, AbilityId discriminants/text, HIDDEN_REVEAL_MS, EFFECT_CASTING, HASTE_BASE_FLOOR, DEATH_FLOOR_DEFAULT_HP and the five stats constants are covered by existing visitors. Stat-fold dependencies, including lifesteal_cap and attack mirror codecs, stay in the already integrated stat-fold identity.

Coordinator identified an additional metadata mismatch: the accepted extra visitor has a hardcoded ability list instead of reading AbilityId::ALL. The patch switches to the actual ALL table (same current values/order), so classifying ALL as folded becomes truthful.

Actual omission found: `StatusTag::Axe.as_str()` is the ordinary axe producer's status grouping key. `items::hit_landed` constructs that variant, `StatusInstance::key`/mutation::apply compare its actual string, but neither accepted status visitor folds it. The WeaponId Axe string being folded elsewhere does not capture an independent change of this tag mapping. The patch appends the real tag, never a copied literal.

Other numeric literals inspected are algebraic identities/units and structural encodings (0/1, milliseconds/seconds, payload bit masks), or validation headroom (`geometry_scalar_is_safe` multiplier4); they are not independent status tuning tables. Cast cancellation facts and Payload values are per-instance runtime input, not fixed content definitions. Their checkpoint/hash coverage remains the existing status responsibility. This bounded review does not claim every arbitrary future control-flow edit changes content identity.

## Exact coverage

Existing rule visitor:105 words =14 kinds ×7 mandatory words +5 present cap values +2 globals. Existing extra visitor:63 words =3 field kinds +7 numeric constants +53 ability key/policy words. Axe key adds4 words, so proposed inventory is105+67=172 words. The test asserts exact counts and exact value/order equality.

Both StatusRule and RankOneFieldPolicy are destructured without `..`; adding a field makes the integration inventory fail compilation. Exhaustive matches cover StatusKind, FieldKind, AbilityId, Combine and CleanseClass. Default aggregate equality proves the supplied stream seam is the actual production hash path.

Every one of172 actual words is bit-perturbed, deleted and duplicated:516 aggregate sensitivity cases. Every unequal adjacent word pair is swapped; identical-word swaps are explicitly not claimed as changes. Entire rule/extra streams are exchanged. Typed mutations cover14 cap presence flips (including None vs Some(0)),14 rule membership replacements/13 adjacent rule swaps,10 field-policy option flips (including Some((0,0))),5 ability membership/4 adjacent ability swaps,3 FieldKind membership/2 swaps. This checks optional presence and row interpretation rather than only numeric sensitivity.

The mutation test is about hash sensitivity, not a claim that arbitrary malformed word slices are admitted gameplay. No production consumer accepts this slice as a rule table.

## Integration and validation boundary

Root applies/reviews the two small status patch fragments, adds the common optional argument plus supplied wrapper, folds status actual visitors, classifies actual definitions and updates the golden from an executed test. Do not hard-code a guessed new golden. Existing baseline is `b5a9b0f84279dcfb` until the status fold runs.

Recommended bounded check after integration: `cargo test -p rh-sim --test status_content --test mob_catalog_content --test content`; preserve root full integration gate. No commands are represented here as passed. Initial bare rustfmt was absent from shell PATH; the located pinned toolchain formatter was then used. No compilation occurred. The exact supplied test still needs root typecheck and execution against the integrated wrapper.
