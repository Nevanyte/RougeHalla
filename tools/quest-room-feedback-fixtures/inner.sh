#!/bin/sh
# Host tree is /source:ro. Only disposable /work copies receive dependencies or mutations.
set -eu
MODE=$1
BASE=/work/base
TOOL=tools/quest-room-feedback-fixtures
mkdir -p "$BASE/tools" "$BASE/parity/quest-giver"
cp -a /source/packages "$BASE/packages"
cp /source/package.json /source/package-lock.json /source/tsconfig.base.json "$BASE/"
cp -a "/source/$TOOL" "$BASE/$TOOL"
mkdir -p "$BASE/tools/quest-giver-fixtures"
cp /source/tools/quest-giver-fixtures/capture.mts "$BASE/tools/quest-giver-fixtures/capture.mts"
cp /source/parity/quest-giver/source.json "$BASE/parity/quest-giver/source.json"
cd "$BASE"
npm ci --ignore-scripts --no-audit --no-fund >/work/npm-ci.log 2>&1 || { cat /work/npm-ci.log >&2; exit 1; }
case "$MODE" in
 capture) node --import tsx "$TOOL/capture.mts" --write /out --repo "$BASE" ;;
 --check) node --import tsx "$TOOL/capture.mts" --check /out --repo "$BASE" ;;
 --mutants)
  node --import tsx "$TOOL/capture.mts" --check /out --repo "$BASE"
  for name in quest-label private-route provenance-only; do
    VARIANT="/work/variant-$name"
    mkdir -p "$VARIANT" "/work/output-$name"
    # Separate commands: an archive creation failure cannot be hidden by an extraction pipeline.
    tar --exclude=./node_modules -cf "/work/$name.tar" .
    tar -C "$VARIANT" -xf "/work/$name.tar"
    rm "/work/$name.tar"
    mkdir -p "$VARIANT/node_modules/@raid"
    for dep in "$BASE"/node_modules/*; do
      depname=$(basename "$dep")
      [ "$depname" = '@raid' ] && continue
      ln -s "$dep" "$VARIANT/node_modules/$depname"
    done
    for pkg in shared server client; do ln -s "$VARIANT/packages/$pkg" "$VARIANT/node_modules/@raid/$pkg"; done
    node "$TOOL/mutants.mjs" "$VARIANT" "$name"
    ( cd "$VARIANT" && node --import tsx "$TOOL/capture.mts" --write "/work/output-$name" --repo "$VARIANT" ) \
      >"/work/$name.capture.log" 2>&1 || { cat "/work/$name.capture.log" >&2; echo 'MUTANT CAPTURE FAILED: not a semantic kill' >&2; exit 1; }
    set +e
    node "$TOOL/compare.mjs" /out/source.json "/work/output-$name/source.json" >"/work/$name.compare.log" 2>&1
    status=$?
    set -e
    cat "/work/$name.compare.log"
    if [ "$name" = 'provenance-only' ]; then
      [ "$status" -eq 0 ] || { echo 'PROVENANCE-ONLY CONTROL FAILED' >&2; exit 1; }
      grep -q '"provenanceChanged":true' "/work/$name.compare.log" || { echo 'PROVENANCE CONTROL DID NOT CHANGE HASHES' >&2; exit 1; }
      echo 'PROVENANCE_ONLY_NONKILL_PASS'
    else
      [ "$status" -eq 1 ] || { echo 'SEMANTIC MUTANT SURVIVED OR COMPARATOR FAILED' >&2; exit 1; }
      grep -q '^ROOM_OUTPUT_SEMANTIC_MISMATCH:' "/work/$name.compare.log" || { echo 'UNINTENDED MUTANT FAILURE' >&2; exit 1; }
      echo "SEMANTIC_KILL_PASS $name"
    fi
    rm -rf "$VARIANT" "/work/output-$name"
  done
  node --import tsx "$TOOL/capture.mts" --check /out --repo "$BASE"
  echo 'MUTANTS_PASS semantic2/2 provenance-only-nonkill1/1 pristine-controls2/2'
  ;;
 *) exit 2 ;;
esac
