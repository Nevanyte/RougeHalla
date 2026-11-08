# C# protocol 14 codec check

The C# MapBlob implementation matches the protocol 14 wire contract in [WIRE.md](WIRE.md) and the Rust codec's map extension.
The ground section uses version 1, presence bits 1 (terrain) and 2 (regions), the `rh-ground/1\0` semantic hash domain,
and `rh-map-context/1\0` context domain. Both implementations hash dimensions as little-endian u32 values and include
only present planes, in terrain-then-region order. C# represents missing planes as `null`, preserving the distinction
from a present all-zero plane.

Terrain mode codes are identical: Off=0, Map=1, All=2. The explicit `MapBlob.Write(Writer, terrainMode)` path writes
the requested per-Welcome mode and computes its context hash without changing the cached map's mode. `CanonicalEquals`
compares dimensions, collision bytes, plane presence and bytes, and the actual terrain mode; hashes do not substitute for
content equality. Invalid mode values decode as `BadField("terrain mode")`.

Decode preflight uses bounded Reader copies and allocates no decoded plane until collision and semantic runs, domains,
lengths, hashes, terrain/collision compatibility, extension consumption, and outer-frame trailing bytes are validated.
The checks retain the 1,048,576-cell limit, 262,144-byte full-frame limit, 3,145,728 cumulative-run limit, and
3,145,728-byte decoded-plane budget. Decode then allocates only the validated planes. The v14 fixture matcher covers
collision-only and all five ground Welcome forms, plus malformed extension cases including extension trailing bytes and
outer `welcome_trailing`.

The C# wire constant is protocol 14. The server checks the three-byte Hello envelope before parsing the rest of an old
client's Hello; a protocol 13 client is answered with `ProtocolMismatch` (`crates/rh-server/src/conn.rs`,
`crates/rh-protocol/src/lib.rs::ClientMsg::hello_protocol`). This preserves the reload hint when Hello layouts change.

## Verification

Command, using the pinned local .NET SDK:

```sh
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter 'FullyQualifiedName~ProtocolVectorTests|FullyQualifiedName~MapBlobGroundTests|FullyQualifiedName~WishBarrierProtocolTests' --verbosity quiet
```

Result: **Passed, 307; failed, 0; skipped, 0** (`net8.0`, VSTest 17.11.1, arm64).

SHA-256 of canonical C# files and their Unity mirrors:

| File | SHA-256 |
| --- | --- |
| `client-unity/RoguehallaNet/Protocol/MapBlob.cs` | `91e66cb2afa0b0bd2f21a3b34dc73ed023d3cf72e5ae4ab997ae077337966bc1` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/MapBlob.cs` | `91e66cb2afa0b0bd2f21a3b34dc73ed023d3cf72e5ae4ab997ae077337966bc1` |
| `client-unity/RoguehallaNet/Protocol/Codec.cs` | `d6977f013d6ebd97d775ae0ffd386f59cfc5eaa6e1cf069ebaaf54109c814370` |
| `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Codec.cs` | `d6977f013d6ebd97d775ae0ffd386f59cfc5eaa6e1cf069ebaaf54109c814370` |

Both canonical/mirror pairs were byte-identical at verification time.
