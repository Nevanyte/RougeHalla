# e2baad retake failure triage

Exact source cut: `e2baadae03dd25cf74979bdfeb3bf35fd696393d`. The recovery and global account-binding groups were the only groups in scope. Raw test result names exactly match all six selectors in `EXPECTED_TESTS.json`.

## Recorded result

- `AccountRecoveryViewEditModeTests`: 2 passed, 0 failed.
- `MatchClientAccountBindingEditModeTests` (global namespace): 3 passed, 1 failed.
- Total: 6 executed, 5 passed, 1 failed, 0 unrun. No retry, source edit, Play, or HTTP replay was performed.

Failing selector: `MatchClientAccountBindingEditModeTests.SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`.

The runner reports `Expected: True / But was: False` at `MatchClientAccountBindingEditModeTests.cs:196`. At that line the assertion is `Assert.That(pickup.GetComponentInChildren<TMPro.TMP_Text>() == null, Is.True);`; line 197 separately asserts a TMP child exists when queried with `includeInactive: true`. The preceding lines call `RefreshWorldHudVisibility`, fetch `_pickup`, and assert its GameObject is inactive in hierarchy. This records the test's stated condition and exact failing assertion only; the cause is unassigned.

The raw runner stack and message are preserved in `tests-MatchClientAccountBindingEditModeTests.json` and summarized in `test-verification.json`. No fixture adjustment, assertion change, log suppression, debugging execution, or HTTP replay was attempted.

## Revision boundaries

The 95bd9c receipt remains a separate earlier cut (11 pass, 1 fail, 4 unrun); its prior recovery failure was retaken here and both recovery selectors passed. The 719cc2 receipt remains separately scoped at 18 passes and was not rerun. No result is combined into an all-revisions pass count.
