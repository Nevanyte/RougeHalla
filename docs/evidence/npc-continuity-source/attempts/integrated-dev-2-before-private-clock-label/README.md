# Successful integrated candidate before private-clock labeling

This capture and byte-exact check passed at 773 actual source steps. The raw fixture is preserved unchanged: 13,886,133 bytes, SHA-256 43ad781d5ff65364f12ad3f4a70f3de6394afecc4e529487f1c6b62aa71e47ec.

Inspection showed that the parent timeline called decoded RaidState.tick simply tick. Source schema.ts:345-346 marks tick noSync, so the actual decoder retains its default 0; it is not the real server step index and was never passed in from private state to consumers. The new parent records the actual World tick only in sourceDiagnostic, and separately labels the actual decoded noSync default. A new pinned capture/check supplies the final candidate. No gameplay, consumer, human producer or source rule changes are made for this metadata correction. This earlier passing candidate remains historical.
