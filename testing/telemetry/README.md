# Telemetry: offline analysis and fixtures

The design is `docs/TELEMETRY.md`. This folder holds the offline side of it (section 9) and the shared fixture
(section 10). Everything here uses the Python standard library, except `--model`, which needs numpy. DuckDB is
optional.

## Files

- `make_fixture.py`: writes N plausible `RunRecord`s as NDJSON. It is deterministic for a given `--runs` and
  `--seed`. Each run is a small event simulation. Players gain power over time. Random pairs meet in duels whose
  winner follows a known logistic (the faction and weapon edges in `TRUE_F` and `TRUE_W`, power, hp, the first
  strike and a hidden skill per player). A duel that ends in a kill removes the loser. Camps, chest offers of all
  three kinds, Trophies, deaths of every cause and 1 Hz tiles come from the same run.
- `fixtures/runs-v1.ndjson`: the committed output (`--runs 40 --seed 7`). Every line passes `validateRunRecord`
  (`deployment/cloudflare/test/dashboardPage.test.ts` checks this). Odd slots carry no `tiles` (the field is
  optional) so the file stays near 700 KB.
- `analyze.py`: the report. It covers every dashboard metric, each with its `n` and a Wilson 95% interval, using
  the definitions of the `/api/stats/*` endpoints. `--model` adds the skill-adjusted logistic model.
- `test_analyze.py`: Wilson values against known cases, the fixture's determinism and shape, the report's
  definitions (pools never mix, matrix orientations, offer splits), and the model recovering a planted faction edge
  inside its interval. The model test is skipped without numpy.

## Usage

```
python3 testing/telemetry/analyze.py ./.telemetry --pool bots              # local sink or tournament output
python3 testing/telemetry/analyze.py testing/telemetry/fixtures/runs-v1.ndjson --pool all --model
DASHBOARD_TOKEN=... python3 testing/telemetry/analyze.py --url https://play.roguehalla.com --source live --model
python3 testing/telemetry/analyze.py runs/ --json report.json             # every endpoint-shaped result
python3 testing/telemetry/analyze.py runs/ --sql "SELECT faction, avg(won) FROM players GROUP BY 1"   # DuckDB
python3 testing/telemetry/test_analyze.py
python3 testing/telemetry/make_fixture.py --runs 40 --seed 7 --out testing/telemetry/fixtures/runs-v1.ndjson
```

Filters: `--build`, `--from`/`--to` (UTC days of the run end), `--pool humans|bots|all` (default `humans`; human and
bot players are never mixed unless you ask), `--source` (default `any`, unlike the dashboard's `live`),
`--faction` and `--weapon`.

Definitions that are easy to get wrong:

- `won` means the run's winner. A draw is not a win.
- A duel matrix shows each duel from both sides. A mirror cell counts each duel as 1 win out of 2. The default is
  clean kills only.
- "Offered" counts one per eligible player per offer. "Not picked" means the player picked another option,
  skipped, or never chose. Trophy options are grouped by stat, because their gains differ.
- On the overview, `humans` and `bots` count every player record in the filtered runs. `players` counts only the
  pool.

## The model

`P(a wins) = sigmoid(F[fa] - F[fb] + W[wa] - W[wb] + g (log1p Pa - log1p Pb) + h (Sa - Sb) / 10 + d (hpa - hpb) + k first + s[a] - s[b])`

It is fit by Newton/IRLS on clean kill duels. `F` and `W` sum to zero. The per-player skill `s` (keyed by `pid`,
with one skill per bot tier) has a ridge penalty of 1. The intervals come from the inverse Hessian. Below 200 clean
kill duels the script says the intervals are too wide to act on. A second, run-level model fits
`won ~ faction + main weapon + log1p(card power at minute 5) + skill`. Treat both as reading aids, not as gates.

## The dashboard fixture

`deployment/cloudflare/src/dashboard/fixture.ts` is generated from the fixture by this script:

```
python3 testing/telemetry/analyze.py testing/telemetry/fixtures/runs-v1.ndjson --pool all \
  --dashboard-fixture deployment/cloudflare/src/dashboard/fixture.ts
```

Each value is typed with `satisfies` as its endpoint's response, so a contract change breaks the Worker build.
`npx tsx deployment/cloudflare/scripts/dashboardDev.ts` serves the page with that fixture on
`http://localhost:8788/stats`. It prints the dev token; pass `--open` to skip the login.
