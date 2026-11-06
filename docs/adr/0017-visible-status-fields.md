# 0017: Visible status fields without global runtime identities

Status: **Provisional**. The core projection is integrated and independently validated; protocol6 fact transport is implemented; Unity presentation remains pending.

## Context

Status fields are public areas used for presentation and policy decisions. The source mirrors each runtime field into
`state.fields` (`packages/server/src/sim/fields.ts`, `packages/shared/src/schema.ts`). Its policy projection checks the
origin, and both endpoints for trails, and names the owner only when visible
(`packages/server/src/bots/brain/perception.ts`, `seeFields`).

Source field IDs come from the world's shared `nextId` counter. Publishing those IDs in a filtered observation would
reveal gaps caused by unseen entities. No current input targets a field by its identity. C-OBS requires hidden and
absent worlds to remain indistinguishable when their legitimate public facts agree.

## Decision

`Observation.fields` will contain immutable snapshot facts with no raw runtime field ID. Keep every visible instance,
including multiple fields with identical public facts. Apply the source visibility predicates, redact owner and subject
identities against the current visible/self set, then sort solely by the resulting public facts. Hidden identities,
allocation order and runtime IDs must not participate in sorting or tie-breaking.

The simulation owns visibility and field projection. Live clients, policies and headless runs consume that same view.
Presentation may render or animate the observed field geometry; it does not decide status application or damage.
If transport later needs stable lifecycle handles, use viewer-local presentation handles outside the world. This decision
does not introduce an allocator or authorize exposing the shared entity counter.

## Validation

- Passed: unchanged source comparisons and14 independent public/native privacy pairs, including hidden allocations,
  owner departure, multiplicity, trail endpoints, source-timed hidden expiry and repeated observation/continuation.
- Passed: checkpoint/replay/headless/privacy/allocation gates and coordinator observation12/policy9 integration.
- Passed for the bounded fact channel: protocol6 Rust/C#/JS carries redacted field replacements and status/displacement
  scalars, with shared vectors, reconnect/resync and independent transport review ([ADR0018](0018-keyed-state-protocol-v6.md)).
- Pending: remaining ability/status one-shot effects and Unity presentation.

See [status core integration](../evidence/status-runtime/INTEGRATION.md) for the frozen evidence and limits.

This ADR records a working privacy boundary. It does not claim the status runtime, transport or Unity presentation is complete.
