# Fresh-import TagManager parsing repair

The committed baseline `TagManager.asset` used27 bare empty layer entries. A fresh pinned Unity6000.0.85f2 import
reported `Parser Failure at line41` twice, even though the process returned0. Cached Editor tests therefore did not
establish that this project-settings source imported cleanly from scratch.

Two fresh, minimal, disposable projects were run sequentially using the same [native probe](TagManagerParserProbe.cs).
The original384-byte file reproduces both parser errors. Replacing only the27 bare entries with explicit empty strings
removes every TagManager parser error. Both completed probes return identical32 layer names/indices and the Default
sorting layer ID/value0. Both source files remain byte-identical before/after import; the live art project is untouched.
The [receipt](receipt.json) preserves native values, exact file hashes, exit codes, parser messages and generated
temporary-project settings overlays. Original SHA256 is `ba0fc9a31e0e92db24a4641274512353665c197833f42af08b54b13f98e8a010`;
fixed SHA256 is `0a61082afba2a5e8bbb48ea85716597ab62af959e5cb4929d7a7ee7a899f36b0`.

Root independently verifies the receipt, intended values and exact27-line transformation, then admits only that settings
change. No gameplay layer, mask, sorting order or rule changes. Full temporary projects/logs remain privately under
the project tools' `tagmanager-parser-2026-11-08/` directory; both batch processes exited. This is a native settings-parser
gate, not a new full game import, Web build, UI or performance result.
