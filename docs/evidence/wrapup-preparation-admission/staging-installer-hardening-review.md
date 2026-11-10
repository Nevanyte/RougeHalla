# Installer PUT response hardening: finite delta review

**PREPARATION-ONLY SOURCE + EVIDENCE RELEASE.** Exact corrected code `15ad9dbf061494a95116ca61611bb17e730563b4`, evidence child `7b2599aad0a7ad8bb00e9300ed1312e26dab6078`, prior released seal `e246002aa6b2b038639d78700fc205e7a4005b34`. The earlier verifier-hardening observation is closed. Operational activation remains HOLD in full.

Read only immutable Git blobs in owned-seat-checkpoint/repo; no current worker disk source inspection, code/test/host/cloud execution, cache, account access, secret or main mutation.

`verify_put_response` now requires **type(response) is dict**, then **type(VersionId) is str**, nonempty and not literal `null`, together with exact expected checksum. No stringify/coercion, truthiness or Boolean/integer/container equality path remains for VersionId. Conforming synthetic response still returns offhost_restore_proved:false. No permission, transfer executor or actual offhost assurance was added.

Exactly three source paths change from e246: verifier, focused test and README. New control independently supplies12 malformed version values, seven bad/missing-version response shapes and six bad checksum values, plus valid string/checksum. The checksum/envelope existing focused test is retained. Raw receipt confirms **two affected tests PASS**, first run,0.002s; it is not a13-test/full-suite rerun or a real upload. No reviewer execution was needed.

Verified all **14 new checksum entries** against sealed Git, manifest SHA256 **a4d05a2821bd678d5209b9906d613c54222815601fd3c9992d1cfaf1596be621**. Verified all **nine current source pins** against code and evidence heads. Reverified all27 original e246 payload hashes against their original immutable blobs. Original evidence files and original manifest are unchanged. Three original source payloads intentionally have new hashes; the addendum explicitly directs current-child verification to the new manifest rather than pretending the old manifest matches modified source.

README precisely incorporates the independent review's limits: expired first boot only refuses and needs independent real shutdown; supplied device inequality is not physical root/partition/alias proof; Allow-only policy can be enlarged by other grants; delete markers can permit conditional key recreation; policy time is not in-flight cancellation or a host/storage-cost stop. These are documentation corrections, not new host functionality.

Host material, foundation ordering, role generator, old preparer/refusing userdata and adjacent staging files remain unchanged. No host executor/marker/DB/cloud service or restore activation exists. Real identity/IAM attachment/PassRole/IMDS, AMI/tools, expiry/volume/lock/secret/PG/egress, Source+Training/TLS/account probes, actual encrypted producer/offhost/cold restore/fencing and CAD20TOTAL current cost/retention/cleanup gates remain required. This closes only the narrow offline validation concern.
