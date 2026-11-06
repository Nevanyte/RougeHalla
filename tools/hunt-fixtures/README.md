# Sentenced hunt fixtures

Six actual-source scenarios for P-FACTION-4. The capture installs the same modules as the accepted Holy/Sentenced
foundation, then inserts `sentencedHunt` immediately before `mods`, matching the production installer order.

Run in the pinned **Linux x64 Node 22.23.4** container:

```sh
docker run --rm --platform linux/amd64 -v "$PWD":/repo -v <node-modules-volume>:/repo/node_modules -w /repo \
  node:22.23.4-bookworm-slim bash -lc 'npm ci --ignore-scripts --no-audit --no-fund && node tools/hunt-fixtures/check.mjs'
```

The checker verifies every pinned source SHA in `parity/hunt/source-manifest.json`, recaptures each scenario into a
temporary directory, and requires byte-exact fixture and manifest-hash equality. It never edits `packages/**` and never
regenerates a parity fixture from Rust.
