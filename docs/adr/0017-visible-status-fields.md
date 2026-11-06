# 0017: Visible status fields without global runtime identities

Status: **Provisional**. The design is approved for the private P-STATUS-1 implementation; integrated validation is pending.

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

## Validation still required

- Bind source visibility/schema behavior to the unchanged reference and compare ordinary native runtime observations.
- Check hidden versus absent allocations, hidden owner/subject changes, departure, equal public tuples, multiplicity,
  trail endpoints, visibility/trail expiry, repeated reads and sorting.
- Prove projection cannot mutate the simulation or affect its checkpoint, replay, RNG or later behavior.
- Integrate the observation/policy versions and any required Rust/C#/JS wire changes through the coordinator.

This ADR records a working privacy boundary. It does not claim the status runtime, transport or Unity presentation is complete.
