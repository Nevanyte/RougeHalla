# Current public-facts metadata correction

The current source-evidence candidate is the additive [watcher loadout correction](watcher-loadout-correction/README.md), source commit `77bc42ec54fd9003925efcde808e83f0878cf426`. Its canonical fixture SHA-256 is `0819c53f1eabbf875849cdc0d2be7479bde7013527d980fd38e0c4b20072f260` (119,213 bytes).

The original packet `29a26514` and its evidence/manifest remain historical. Review found its swap-only witness metadata incorrectly described the watcher as Bow-equipped. That separate World actually left both watcher slots empty. The corrected capture reads both seats' actual initial weapon slots and preserves the original unarmed scenario. Only that metadata and the capture file's provenance hash change; every other recorded fixture value is identical.

The old README/receipt/manifest describe the original source cut and must be checked at `29a26514`, not treated as current-file hashes. The new correction manifest seals the current two source files and additive evidence. The original semantic controls are preserved as historical results and were not rerun for this metadata-only change. A new pinned capture and one byte-exact check pass.

This corrects source metadata only. All original World-consistency, hidden-gameplay, lifetime, privacy, rebase, identity/order, population/budget and native/protocol 15 admission limits remain held. Root owns independent review and the main merge.
