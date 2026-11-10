# Pre-seal `Send` compatibility correction (Root/Sol, 2026-11-10)

Root pre-seal composition correction (independently reviewed by Sol): production `rh-policy::Policy` requires `Send`.
The new private module layer's persistent registry callbacks were `Rc`, making an actual `modules::registry::Registry`
`!Send` even when only the four built-ins are used. Corrected in-packet, mechanically, without widening scope:

- `modules/registry.rs`: `CustomModule.enabled` is now `Arc<dyn Fn(&Features) -> bool + Send + Sync>`;
  `Registry.cast_policy` is `Option<Arc<dyn Fn() + Send + Sync>>`; `register_cast_policy`/`cast_policy` signatures
  updated accordingly. Registration order, equal-id replacement keeping position, enabled filtering, reset and the
  opaque policy slot's allocation identity (`Arc::ptr_eq`) are unchanged.
- Harness/control call sites updated only at the persistent-callback boundary:
  `modules/source_tests.rs` (policy slot and the custom `enabled` capture; the capture closure is `Send + Sync` and its
  callbacks are appended to the per-op ordered trace after the operation — the source corpus calls no other callback in
  registry `enabled` operations, so sequence/order remain exact) and `modules/controls_tests.rs` (policy identity,
  custom descriptors). Uncaptured test-local `Rc` (walk/sight counters, message logs) remains, as permitted.
- `modules/source_trace.rs` test fixture updated to the `Arc` custom descriptor type.
- New compile/unit assertion (in `modules/registry.rs` tests):
  `assert_send::<Registry>()`, `assert_send::<CustomModule>()`, and each of the four built-in module state types
  (`WishesModule`, `PlanningModule`, `ChestsModule`, `HazardsModule`) — test `send_assertions::new_private_module_layer_is_send`
  passes (1 passed).
- No `unsafe impl Send/Sync`, no wrapper hiding a non-`Send` inner registry, no whole-Brain lock, no unrelated trait-bound
  or existing-file expansion. Root is separately fixing the Strategy persistent-callback/goals seam; Strategy was not
  edited here beyond the allocated `pub(super) mod types;` line.

Re-verified after the mechanical change:

```
cargo test -p rh-policy --lib --locked --offline -j1 frozen_private_modules_source_replay -- --nocapture
=> 255 cases / 3259 ops (corpus 3259) / 0 failures
cargo test -p rh-policy --lib --locked --offline -j1 modules::controls_tests::
=> 28 passed / 0 failed
cargo test -p rh-policy --lib --locked --offline -j1 send_assertions::
=> 1 passed / 0 failed
```
