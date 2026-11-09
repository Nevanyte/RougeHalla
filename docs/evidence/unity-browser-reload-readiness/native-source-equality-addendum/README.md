# Exact native reference correction

Child of immutable readiness`cfb861a14d894e70c9733d9fe86e3115421f618e`.
Code`a180f47b7492b3e444671d54d3f3b63657c0d420` adds one equality check against
`NATIVE_REFERENCE=7a13b88aaa104cf2fd18dc2de7eada6c02060485` and one synthetic
unrelated-but-well-formed40-hex negative. No original test or other source changed.

The new test fails before the correction (`OPEN` instead of `FAIL`). Afterward,
only the two affected offline tests run: the existing matching-reference/template
case and the new unrelated-native negative. Both pass,0failures. This is not a
rerun of the full16-test file or actual browser acceptance. The original15-pass
log and all original evidence remain byte-identical at their historical scope.

The original READINESS.json retains its original code pins. ADDENDUM.json applies
only the two updated tool pins for this child; its other six tool and nineteen
original evidence pins are checked unchanged. Read-only independent review
confirms exactly two files/seven added lines and no blocker.

No browser, socket, server, account, profile, storage, network, build, dependency
installation or other runtime action was performed. Author work stops here.
