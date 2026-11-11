# client-unity: local rules

Build and run instructions: [README.md](README.md) (its protocol-version mention is stale; `Codec.cs` holds the current one).

## RoguehallaNet (engine-free C#, netstandard2.1)

- The library in `RoguehallaNet/` is the source of truth; `sync-net.sh` copies it into
  `UnityProject/Assets/RoguehallaNet/`. Edit only the library, then run `bash client-unity/sync-net.sh`;
  `sync-net.sh --check` and `dotnet test client-unity/RoguehallaNet.Tests` fail on a stale copy.
- The codec decodes the shared golden vectors byte for byte with Rust and JS; `Protocol/Codec.cs` `ProtocolVersion` moves
  with `PROTOCOL_VERSION` in the same branch.
- Walk prediction (`Net/LocalMotion.cs`) mirrors Rust movement and passes Rust-produced vectors (`protocol/fixtures`
  `server_walk_*`, `pathfinding_*`); it changes only together with the Rust side and its vectors. The server always
  corrects it, and it predicts the local player's walk only (D9).

## UnityProject

- Rendering, UI, audio and FX. Every outcome (hits, damage, rewards, deaths, results) is drawn from server observations;
  click-time feedback is presentation only.
- Web build: `UnityProject/Tools/build-web.sh` bakes the server's content hash from `/info` into
  `Assets/Scripts/BakedContent.cs` before compiling. Close the Editor before a batch build.
- Third-party assets need provenance and licence recorded in `THIRD_PARTY_ASSETS.md` before they are added.

## Routing

C# and Unity work: `implementer-sonnet`. A change to the codec or prediction math is cross-language: `implementer-opus`,
reviewed by `reviewer-opus`.
