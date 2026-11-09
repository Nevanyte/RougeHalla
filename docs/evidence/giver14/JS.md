# Protocol 14 giver actor: JavaScript receipt

The embedded probe decoder and vector checker passed against the Rust-generated protocol 14 fixture.

Command, from the repository root:

```sh
node --check tools/protocol-js/check-vectors.mjs
node tools/protocol-js/check-vectors.mjs
git diff --check -- crates/rh-server/web/probe.html tools/protocol-js/check-vectors.mjs
```

Result: `JS decoder agrees with protocol/fixtures/v14.json: 51 server vectors, 171 malformed, 19 chains, 19623 checks`.

The checker covers the exact kind-4 tuple (raw faction/weapon 15, mob type 0), rejects invalid full-snapshot kits and mob type, and verifies the probe presentation adapter exposes the giver as neutral with no weapon while retaining raw wire fields. It also checks that ordinary unknown kinds and their raw kit/mob-type values remain open, and that Self faction/weapon 15 remain unchanged. Rust-generated tracker chains cover retained-field partial updates, kind/kit transition rejection with the baseline object kept intact, redundant identity edges, reset, transitions to/from an unknown kind, and a non-giver retaining the kit sentinel. A synthetic direct-`Tracker.apply` control independently confirms an invalid Full object leaves the exact prior baseline object untouched.

SHA-256 identities for this receipt:

- Fixture `protocol/fixtures/v14.json`: `70b4408422d889e64816f6cb7afb9cf642fe755a5a1b60ac59fab5cb80037a9c`
- Probe `crates/rh-server/web/probe.html`: `630721ef1e32c6020fd960f3aa8ab6b05b8c2591c54f2263aad6a804e8dadd19`
- Checker `tools/protocol-js/check-vectors.mjs`: `b09905e004f5571659a5fb8f60c63812cd87e891752e5c55e0a3acd6b67ba70c`

Runtime: Node.js `v25.8.1`. This is a decoder/vector result; it does not represent a browser or gameplay run.
