# Browser reload readiness: exact native-source correction

**SOURCE + OFFLINE READINESS RELEASE**, exact code `a180f47b7492b3e444671d54d3f3b63657c0d420`, evidence `25d3447d127985a86d666a9fd460a0520ab59681`. The sole HOLD in the original cfb861a1 review is closed. Actual browser/socket/controller/runtime execution and browser acceptance remain NOT_RUN; no new execution authorization follows.

Independent immutable-Git delta review only, no Node/test/browser/Editor/build/cache/source/main action. Exactly **seven added lines in two tool files**: one nativeSource equality check against exact NATIVE_REFERENCE7a13, and one unrelated valid40hex negative checking FAIL plus the exact safe failure reason and unchanged NOT_GRANTED_BY_COLLECTOR boundary. Original tests/source semantics otherwise unchanged.

The negative was genuinely run before production correction: raw receipt preserves **0PASS/1FAIL, OPEN versus expected FAIL**. After correction, raw receipt records **two affected offline checks PASS**: existing matching-source/template case and the new negative. This is not a full16-test rerun. Original15-pass receipt and all19 original evidence pins remain byte-identical, as do the other six tool pins. No red was relabeled as success or whitespace-normalized; original diagnostic trailing whitespace is explicitly retained.

Verified current two-tool overlay pins against both code and evidence Git blobs:

* check.mjs SHA256 `73ef8e6b7927a9f461d19fb3da018de71ad4ea2a52fd909378b068a6069b146a`
* check.test.mjs SHA256 `9fb38be5e92474cfdd9768b915c4421f95f4edbc63b05f3f912706d256a8e9f9`

All five addendum payload hashes verify. ADDENDUM.json SHA256 **1f7782241292afc4dd757649a9132b5ee0ee42115fed4f9a30611c0a6503a3b1**. Original READINESS.json retains its historical pins unchanged; this additive overlay is required when verifying the corrected child. No new preload/parser/observer/routing or production hook change occurred, so original credential-skip, forwarding and finite-scope review stands.

This releases only the source/offline proposal. Root still must adopt actual native98/layout/coherent artifact identities, separately approve exact preload/driver installation, and run ordinary same-tab/current-owner/full reload and real service/PG/result/receipt proof within unchanged wall-clock/grace conditions. READY_FOR_ROOT_REVIEW remains a metadata consistency result requiring Root authenticity/visual review, never accepted gameplay or browser proof.
