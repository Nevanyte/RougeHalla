# Normal CI76d: retained offline preparation pin failure

Normal [run42680383918](https://github.com/Nevanyte/RougeHalla/actions/runs/42680383918)
tests exact `76d170a16158a9709178a741f12bd4abb357201f`. Unlike the preceding7a13 startup failure,
all five expected jobs are actually created. Provenance, C# and card-runtime source pass. Rust job129373457287
passes both workspace lint configurations, formatting, remaining default tests, real PostgreSQL server and placement
suites, and the parity report. It then **fails** the offline staging preparation step:13/14 checks pass, while
`test_actual_frozen_native_configuration_is_pinned` compares current `runtime.rs` against an older frozen base.
The exact [step15 excerpt](rust-step15.log) is retained. This run is not green; subsequent Rust-job source,
headless, decoder and browser steps are skipped. The subsequent terminal [job snapshot](jobs.json) records simulation
PASS too: four jobs pass, Rust fails only at the described offline preparation step.

The failure is current SHA256 `e90c5037ce04ba35d83da65e8b4030a070015ad3de3745d2ca27f3aa77df7e8f`
versus frozen `a3d52a5595b4e2c489784aa8e4e8bcc8a7b1f3c7cfca6685bb20a7bedaa6d7bf` for
`crates/rh-server/src/runtime.rs`. The preparation explicitly targets `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`;
the later reviewed runtime enables native WalkHint for both explicit profiles. Root assigns a bounded repair to
reconcile immutable historical preparation with the current candidate, retaining the original failure and artifact
authorization checks. No hash-only replacement, weakened gate, live artifact validation or cloud deployment is admitted
by this diagnosis. The latest earlier five-job success remains8e467beb/run42631043999.
