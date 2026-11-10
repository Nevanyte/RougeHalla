# Private tactics WIP review

Root read the moving `backend-bot-tactics` candidate at approximately09:34UTC on2026-11-10, based at `f252b869`.
This is not a sealed native admission or an executed regression result.

The source replay reports a first154-case/720-method green result and is still finishing overlap/strict gates. Root
found that `source_trace::compare_node` describes exact ordered source values but its `SVal::Obj` branch searches by
key and does not compare entry order; its local `seen` vector has no effect. The active DeepSeek worker received a
bounded request to distinguish fixed plain-JSON envelopes from genuine tagged MethodValue objects, preserve required
insertion order for raw/dynamic values (including callback and Memory payloads), and exercise the actual comparator
with an entry-permutation control that preserves all values. Any intentional fixed-schema envelope exclusion must be
stated precisely. No fixture change, numeric-tolerance expansion or unrelated production edit is authorized.

The worker also received an exact-source/evidence staging reminder because an untracked nested `target/` cache exists
inside the new tactics directory. Build output is not part of the leased source candidate. No cache was deleted or
worker file edited by Root. The final independent reviewer must use the sealed candidate and actual final receipts.
