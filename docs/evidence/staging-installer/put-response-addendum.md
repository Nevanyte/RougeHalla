# PUT-response validation child

Preserves released offline foundation code2d68e8b90f1d98e4a1993482a26dc76bcf5bd3ef and evidencee246002aa6b2b038639d78700fc205e7a4005b34 unchanged in history. Root independent source/evidence review is coordination/reports/staging-installer-e246-independent-review.md, SHA2568590fb6b87034aee7377b6f6b2d4e5fa514a446d6d94b844e17023bf8f4b2b4f. That review admits the offline foundation only, not operational use. Corrected immutable code is **15ad9dbf061494a95116ca61611bb17e730563b4**, direct child ofe246.

The small code correction requires a dictionary PUT response and a builtin **nonempty string** VersionId other than literal null, together with the already-required matching checksum. It does not stringify arbitrary values or accept numeric/Boolean/container versions. No AWS response was fetched and no CLI/cloud call occurred. A conforming synthetic response still yields offhost_restore_proved:false.

Only the affected new offline verifier tests ran: **2 passed**, first run,0.002s. The new refusal control covers12 malformed version values (None, empty/null string, Boolean, integer/float, lists, objects),7 malformed/missing-version response shapes,6 malformed/mismatched checksum values, and a valid string+checksum control. The existing bounded ciphertext-envelope/checksum test also passes. These are synthetic parser inputs, not actual encryption/upload/host success. No old14-test suite, whole new suite, broad lint, policy validation or host-script execution was repeated.

    export PYTHONDONTWRITEBYTECODE=1
    export PYTHONPATH=tools/staging-full-runtime/installer
    python3 -m unittest -v \
      test_installer.InstallerTests.test_only_bounded_ciphertext_envelope_produces_conditional_checksum_put_not_restore_claim \
      test_installer.InstallerTests.test_put_response_requires_nonempty_string_version_and_matching_checksum
    shasum -a 256 -c docs/evidence/staging-installer/put-response-SHA256SUMS

Source README adds precise limitations, not operational implementation:

- Already-expired first boot **only refuses**. It neither installs the expiry timer nor independently shuts the paid host down. No budget-safe expired-boot behavior was claimed. A real bootstrap must independently stop/terminate it before any download/install/service path and prove terminate-on-poweroff. Host material stays inert/unexecuted and unchanged.
- Inequality of supplied device strings is not physical root-device ancestry/alias proof. The trusted real collector, mount ownership, encryption/AZ/account and canonical physical device graph remain operational gates.
- This Allow-only role fragment does not constrain other identity/resource grants. Actual effective authority and attachment/PassRole still need review. Conditional create-only applies to an absent current key; a current delete marker can permit recreation in a versioned bucket. External lifecycle/admin actions and all retained-resource costs remain in scope.
- Absolute policy time is not in-flight cancellation, host termination or a storage-cost stop. No current AMI, pricing, access or operational authority is asserted.

Host material, controller, role generation, existing preparer/refusing userdata and every old staging sibling remain byte-unchanged. No marker, executor, public service, DB or restore is activated. Source README/transfer verifier/test are the only three source changes aftere246. Current nine-source hashes are in put-response-frozen-source.json. All27 historical e246 payload hashes remain valid against their immutable Git blobs; original evidence files and original SHA256SUMS are untouched. Its old source hashes are historical, so use the new put-response-SHA256SUMS for this child, not the original manifest against modified source.

No host/cloud/network/login/CLI response execution, current access/cost probe, cache install, Cargo/DB/Editor/UI action or new permission request. The final child evidence commit is reported separately. Stop for Root review.
