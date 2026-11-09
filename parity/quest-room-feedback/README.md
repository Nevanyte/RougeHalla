# Quest completion room-method feedback

`source.json` is NEW derived room output over ONE unchanged batch from the accepted giver8 source corpus. It contains
that batch's original corpus SHA/case/frame, recipient/type/text/call order, declared receiver controls, actual FxChannel
calls and exact source/toolchain/harness provenance. It contains no gameplay recapture or new expected World outcome.

Generate/check with `tools/quest-room-feedback-fixtures/capture.sh` and `--check`. The only genuine producer input is
zero-based giver case7/frame8; the three additional entries are explicitly declared routing controls over that same batch.

The source Room emits private `+10 GV (quest)` before farm/private-completion/public-completion notices. Private receivers
are selected by session ID through the actual toastTo/sendTo methods. Broadcast entries are recorded method calls,
not proof of network fanout or actual client presentation. All existing corpora stay byte-immutable.
