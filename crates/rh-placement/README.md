# Placement library deployment boundary

The pure planner and asynchronous service are tested with local fakes. There is no production HTTP admission handler,
AWS adapter, DNS adapter, durable request store, or scheduled reaper in this crate. Passing the local tests does not prove
that a cloud placement, public TLS join, capacity target, or cost bound works.

`PlacementService::new` requires an explicit 32-byte ownership nonce. The future wrapper must generate a globally unique
nonce with a cryptographic RNG for each ownership epoch and persist it with its durable request ledger. Never reuse a
nonce with an empty ledger; fixed arrays in unit tests are test values only. The nonce and complete request/config/attempt
identity are SHA-256-bound into `GameSessionData`. The adapter must preserve that field from GameLift responses. This is
cleanup ownership metadata, **not** an admission credential or an authentication mechanism. The HTTP boundary must still
bind a request to its authenticated party and enforce the existing admission/profile-token contract.

The in-memory ledger has at most 4096 request IDs and fails closed when full. It never evicts offered or finished IDs:
retention, durable recovery, authenticated party scoping, backend timeouts, and service/reaper scheduling remain required
before deployment. No lock is held across an await. An active same-ID call is refused; a completed successful retry returns
only the offer bound to the identical request and config. Abandoned/reaping/finished requests require a new ID.

Cancellation and retryable cleanup failures retain work. A canceled reaper returns ownership to the ledger. Missing
backend ownership metadata retains the unresolved item; a foreign binding is never stopped, published, or terminated.
Cleanup uses the original zone even if service configuration changes. Termination and DNS deletion adapters must be
idempotent. A new service cannot reconcile an old epoch's requests merely by matching IDs; durable restart reconciliation
is deliberately not implemented.

Local regression command: `cargo test -p rh-placement --locked`.
