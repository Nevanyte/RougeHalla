# P-CI-GREEN-8: the trusted-feature graph test fetches what it needs in CI

- **Serves:** CI green for PR 80 (owner, 2026-11-20: "Please push and merge the new augments").
- **Tier:** coordinator (a few lines in one test file, through the gate).
- **Failure (the oracle):** CI run 44862423096, jobs "Produce CI artifacts" (x86_64 and aarch64), PR 80 head `52bd52065`.
  - `crates/rh-sim/tests/trusted_build_leak_paths.rs` `the_resolved_server_graph_names_no_trusted_feature` ran
    `cargo tree --locked --offline -p rh-server --target all` and failed:
    `failed to download arc-swap v1.9.3 ... --offline was specified`.
  - `.github/workflows/determinism.yml` builds only `rh-sim`, `rh-policy` and `rh-headless`, so rh-server's graph for
    every target is not in the runner's registry. The test's comment assumed it was. Locally it always is, which is why
    the gate never saw this.
- **Fix:** drop `--offline` and keep `--locked`, so the graph is exactly the lock file's and cargo may fetch it. The
  assertions are unchanged. The doc comment and the failure message now say why.
- **Write scope:** that test file and this brief.
- **Done:** the test passes locally (6/6), the coordinator's full gate is green on the merged tree, and the CI artifact
  jobs pass on PR 80.
