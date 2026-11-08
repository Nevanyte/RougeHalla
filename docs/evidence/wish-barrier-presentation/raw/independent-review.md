# Independent source review note

Reviewed branch `codex/unity-wish-barrier-presentation` at `5a1b5af9bb41a6c39e1473f7442ea2d396bf4f64`, against immutable base `abd1ccfe6edc90df16c64283af09c913bddbd81d`.

## Resolved review questions

- The `MatchClient` Wish-input and target-screen observation hooks are within the separately released networking diagnostic API. Upstream commit `10cbfa25789378a5ded021a2265700ffd46e5484` adds the `TakeTargetRequest`/`TraceTargetScreens` path and captures the return from `CollectWishInput` for the optional `sampleWish` marker. Art branch commit `855b5b241e239c65937104116706c5be11f9d144` records that exact commit as cherry-picked (`-x`). These lines therefore are not an unleased art-slice change. The trace remains opt-in as described in the evidence README.
- The suspected nonfinite landed-coordinate case is excluded by the protocol representation before presentation receives `WireFx`: `WishWire.ReadPoint` reads both axes as `U16` and applies `Quant.DequantizePos`, which divides the unsigned integer by the finite position scale. Wish Started/Landed validation also applies `Quant.PosInRange` on encode and validates the delivered event fields. Thus coordinates from decoded Session packets are finite and within the quantized domain; adding duplicate geometry/game-rule validation in the presenter is not needed for this reachable input path.

Source locations: `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Messages.cs` (`WishWire.ReadPoint`, `ValidateStarted`, `ValidateLanded`); `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Codec.cs` (`Quant.DequantizePos`, `PosMax`). Matching synchronized decoder copies exist under `client-unity/RoguehallaNet/Protocol/`.

## Evidence scope

This note is a source review only. It does not extend the reported source/EditMode or trace-guard evidence to a live Unity input run, Web build, full R-to-server flow, display scanout, or end-to-end acceptance. The worktree had an uncommitted `ProjectSettings/ShaderGraphSettings.asset` change during review; coordinator reports it as Editor-added trailing whitespace to normalize and record separately.
