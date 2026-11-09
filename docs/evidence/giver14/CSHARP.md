# Giver protocol C# validation

The focused protocol/vector and owned-giver tests passed against the regenerated Rust protocol v14 fixture, including the giver actor and retained-delta vectors.

- Command: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --no-restore --filter 'FullyQualifiedName~ProtocolVectorTests|FullyQualifiedName~GiverActorProtocolTests' --logger 'console;verbosity=minimal'`
- Result: 355 passed, 0 failed, 0 skipped.
- Fixture SHA-256: `70b4408422d889e64816f6cb7afb9cf642fe755a5a1b60ac59fab5cb80037a9c` (`protocol/fixtures/v14.json`).
- Mirror check: `bash client-unity/sync-net.sh --check` reported `Unity copy is up to date`.
- `git diff --check` passed for the owned C# protocol and test files.

This validates the pure C# codec, tracker, view-copy and golden-vector paths. It does not compile Unity render callers or run the Unity Editor. The installed editor is 6000.0.85f2; real Unity assemblies and cached package-template assemblies are available locally, but this project has no `Library/PackageCache`, and the cached URP template package version is not confirmed to match the project manifest's URP 17.0.4. Any standalone renderer compile using those cached assemblies should be recorded as a compile smoke with that package-version limitation, not as an exact Unity project build.
