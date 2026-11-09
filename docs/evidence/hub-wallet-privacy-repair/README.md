# Hub wallet owner-display repair

Base: frozen Hub `177f19fac251dbd2649da516e46cca5f36737550`.
Repair: `244a914af6f3fd80af8fb1967d00ed702e900a01`.

Same-name Cancel, Opening or Failed can retain the prior profile internally while no current owner is admitted.
The cosmetics panel already refused actions/cleared cards, but retained its old GV wallet and saved/retry status.
The owner-change callback now clears those labels whenever the exact existing usable-profile predicate fails.
CurrentProfile shares that unchanged predicate; no identity or mutation admission rule is weakened.
Unknown operations, their UUIDs/history and explicit same-credential retries remain intact.

The focused new Editor regression drives actual account/UI callbacks: earned Owned display and a real UI purchase
request followed by synthetic 503, same-name Cancel, same-key reopen and explicit same-UUID retry, held same-name
Opening followed by 403/Failed, then held replacement-key Opening and admitted Owned. It checks cleared wallet/status,
no automatic sends, retained Unknown UUID/history and exclusion of the previous credential's retry summary.
These are controlled fake-HTTP UI cases; no server/gameplay or live browser claim.

One API-reference compilation succeeded after sourcing final-env.sh: `dotnet build <owned compile>/Tests.csproj --verbosity minimal`.
The project references build this candidate's matching RoguehallaNet and runtime client before the Editor-test assembly.
Templates were copied from `/tmp/roguehalla-ui-glass-compile` into this repair's private sibling `compile` directory;
source/Net/client reference paths were rebound there. Installed Unity6000.0.85f2 and existing art project package DLLs
supply managed API references. Result: 0 errors, 1 inherited CS0067 unused-event warning in MatchHudTrophyEditModeTests.
This is compile-only evidence: the new regression has **not run in Unity**. No Editor, UPM, asset import, render capture,
browser or broad .NET suite was launched. Root/art owns the actual combined Editor/browser proof.

Only HubCosmeticsView, its existing Editor-test file and this evidence directory change. Shared layouts/glass geometry,
nullable protocol14 presentation, account/credential APIs, source assets, gameplay and shared status/lock records remain
outside this patch. Cherry-pick the narrow repair; do not merge the frozen old Hub branch wholesale.
