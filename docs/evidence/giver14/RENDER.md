# Managed render compile and pure appearance contract

The 63 runtime C# source files under `client-unity/UnityProject/Assets/Scripts` compiled against the canonical net project and real installed Unity6000.0.85f2 managed engine assemblies. References also include the editor's cached cross-platform template assemblies and its bundled Newtonsoft.Json assembly. The exact reference hashes and external harness sources are retained in [render-compile](render-compile/assemblies.json).

```sh
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet build /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/giver14-render-compile/RenderCompile.csproj --nologo --verbosity quiet
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/dotnet/dotnet run --project /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/giver14-render-compile/ContractRunner.csproj --verbosity quiet
```

Compile result: **0 errors**, 28 warnings (existing serialized catalog fields and obsolete Unity API use, CS0649/CS0618). The pure appearance runner passed **5 checks**: giver returns no fighter catalog key with absent or even supplied faction; ordinary Fire/Holy player appearances remain; opaque unknown kind255/faction15 retains its previous fallback. It creates no Unity objects.

The five leased render callers preserve layout and compact geometry. Only the owned remote actor kit is nullable. A giver bypasses both knight catalog fallbacks, reuses an existing neutral silhouette/color/marks, disables and clears its weapon sprite, clears stale attack timing, and supplies no fabricated combat audio context. Current NPC delivery forwards the received barrier values; giver barrier rendering uses those values. HP, status, effects, positions and sorting remain driven by delivered facts. No click/target/interact code changed.

This is a managed compile and pure-function contract, **not** an Editor, IL2CPP/Web, graphics, runtime pool, or visual acceptance test. No Unity Editor was launched. The template-cache package assembly versions were not verified against the project's InputSystem1.20.0/URP17.0.4/Newtonsoft3.2.2 manifest. Actual project package resolution, Editor build and rendered verification remain coordinator-owned. There are no Unity runtime API stubs in this compile.
