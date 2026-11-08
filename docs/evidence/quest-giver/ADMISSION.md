# Source-witness admission

The coordinator admits the source-only chain `38f6dcaa` → `00f97677` → `4e7095b9` → `649231d9` on
`optimization_port` as `121d9f7f` → `72e8fec1` → `7f49d2fe` → `06276280`.
Final corpus SHA256 is `039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`,1,229,693 bytes.

Earlier runner acceptance was held after independent review found Bash dynamic scope could overwrite cleanup's exit
status. The repaired helper and cleanup use separate local accumulators. Root executes the committed actual-runner
fixture: ordinary failure remains exit1; HUP/INT/TERM remain129/130/143; every armed path restores exact original bytes
once (three source files, three copies). This is the real runner and helper in a disposable stubbed-source repository,
not a substitute cleanup function and not a claim about untrappable SIGKILL.

Root also executes the committed payload verifier. Old and final corpora retain identical eight `format`/`cases`
payloads and canonical SHA256 `ad6e10ddd7f2de02530b8ae037101315941aef4da815cdfd279773f32b215b8d`.
The pinned recapture and source semantic controls are independently reproduced by the lane's separate checker, as
recorded in the [evidence](README.md). Their combined-guard mutation limits remain explicit.

This admits evidence and tooling. A genuine neutral native giver, canonical storage/restore, public projection, protocol
and Unity flows remain separate implementation work. No native content or format identity changes here.
