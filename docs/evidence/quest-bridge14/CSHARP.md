# C# protocol 14 validation

Fixture: `protocol/fixtures/v14.json`

SHA-256: `ff0f474c496e8928ff62a3a4043f7ea0c2bad6f3bde0070c0767fcce66c9b2f6`

Focused C# protocol, state, quest bridge, union, session, and network tests passed:

```sh
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet test \
  client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj \
  --no-restore \
  --filter 'FullyQualifiedName~ProtocolVectorTests|FullyQualifiedName~StateTests|FullyQualifiedName~QuestBridgeProtocolTests|FullyQualifiedName~UnionProtocolTests|FullyQualifiedName~SessionTests|FullyQualifiedName~NetTests' \
  --logger 'console;verbosity=minimal'
```

Result: **426 passed, 0 failed, 0 skipped**. The selection includes the protocol 14 byte-for-byte vectors and malformed-frame reason checks, State replacement/retention behavior, QuestHandle/RosterId and QuestItem reference checks, tag 17 QuestAccept, and fail-closed session handling.

The canonical networking sources and Unity mirrors match:

```sh
client-unity/sync-net.sh --check
```

Result: `Unity copy is up to date`. `git diff --check` passed for the C# canonical sources, tests, and Unity mirror paths.

This is a .NET codec/session test gate. It does not run Unity, the browser client, Rust/server tests, or live quest gameplay/rendering.
