# Resume98 public discovery audit

Read-only file comparison. No discovery verifier, Unity API, or tests were run for this audit.

## Result

**PASS** — 98 unique discovered cases matched against 98 Candidate04 cases. Exact full-name membership, fixture counts, argument/parameter representations, pinned NUnit attributes, and loaded method signatures/MVIDs were compared.

| Fixture | Contract | Discovery |
|---|---:|---:|
| `MatchLaunchEditModeTests` | 17 | 17 |
| `MatchSettlementEditModeTests` | 22 | 22 |
| `Roguehalla.Client.Tests.MatchResumeEditModeTests` | 8 | 8 |
| `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 | 11 |
| `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 | 8 |
| `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 | 6 |
| `Roguehalla.Client.Tests.TrainingConsoleIntegrationEditModeTests` | 13 | 13 |
| `Roguehalla.Client.Tests.TrainingConsoleSelectorsEditModeTests` | 5 | 5 |
| `Roguehalla.Client.Tests.TrainingConsoleViewEditModeTests` | 8 | 8 |

Discovery marks all cases `Runnable`, with `executedTests: false`; the 98 cases share one test-assembly MVID. Each selected argument matched by CLR type, displayed literal, and typed bool/numeric/enum payload. Loaded signatures matched each fixture method and parameter CLR type. Candidate04-pinned `declaredCaseAttributes` were compared when present; fields omitted from the contract were not treated as expected empty attributes.

## Net assembly name

Frozen `Assets/RoguehallaNet/RoguehallaNet.asmdef` declares assembly name `RoguehallaNet` and root namespace `Roguehalla.Net`. The observer lookup uses the correct assembly name.

## SHA-256 inputs

| File | SHA-256 |
|---|---|
| `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/discovered-cases.json` | `3686e2eb4f65e619e5f0cb0589eb1aab6588a3a47f35e6fbd68e4ef7e47276bc` |
| `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/loaded-signatures-raw.json` | `dcc25dbc7215234a34d693d804f69de404c3ad272ad3937b681ec1afc51a5c81` |
| `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/loaded-identity-raw.json` | `20ad1f78bae0a94f1055aa52fb37eef90f88dcdb0f5618300ec1cc418d760fa8` |
| `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/docs/evidence/unity-owned-seat-resume/metadata/candidate04-1bf48a81/typed-fixture-contract.json` | `6bfa787e4f63be11fc8a1d51879f30cfc7617f4d7d51883afc60a28a7ef8870e` |
| `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/docs/evidence/unity-owned-seat-resume/metadata/candidate04-1bf48a81/source-input-pins.json` | `72ab2814479574ed1c159a1a6af077f86b8c6870eaccb86c20ab97ea49312a1c` |

No mismatches found. This is a metadata audit only, not test execution or runtime proof.
