# Bounded card source capture

Run from the repository root with Docker:

```sh
bash tools/card-catalog-fixtures/capture.sh
bash tools/card-catalog-fixtures/capture.sh --check
```

The script uses the same official Linux amd64 Node22.23.4 digest as the existing arena, terrain and Wish witnesses. Each invocation has a fresh temporary node_modules and unchanged root package-lock via `npm ci --ignore-scripts --no-audit --no-fund`. Source repository mounts are read-only; check also mounts its output read-only. No existing campaign runs. `Math.random` throws on undeclared use. A local diagnostic requires `--diagnostic` and `RH_CARD_CATALOG_OUTPUT` pointing away from the canonical corpus; diagnostic files are not canonical evidence.

Only actual shared exports generate expected values. Full `cardDef` objects and all `cardRows` outputs survive without stat-fold projection. The accepted stat-fold kernel is neither recaptured nor modified. Source files, existing tools and old corpora are hashed before and after execution; hashes are included in the output. Cases declare inputs independently of returned expected values. `$undefined` and `$number` encode undefined and exceptional numbers losslessly (including negative zero); these are descriptive input/output tags, not JSON null replacements.

Helper representations are explicit. Records and Maps support ordinary lookups and power traversal. A get-only object supports counts but its method contributes no power through Object.entries. A forEach-only object supports power traversal but cannot look up counts. Those source interface quirks and positive Infinity/fractional behavior are deliberately retained as labeled helper witnesses, not admitted native builds. No native domain is widened. Unknown catalog IDs retain each helper's actual fallback; unknown power entries count as tier1. `cardBlock` unknown returns null while `cardOptionView` unknown returns null, so block-null alone is not admission.

Every reward tape value is finite in [0,1); exceptional numbers are exercised only as count-helper inputs. Every invocation records each consumed draw with its original index, final cursor, and unused continuation. Empty pools draw zero; each nonempty selected slot draws tier then index, including a singleton or tier fallback. The tier2 request against tier1-only remaining candidates witnesses lower-tier tie fallback because there is no interactive tier3 in the actual source. There is no fabricated tier3 candidate. All five themes use genuine catalog order and the shared pool's actual remaining candidates.

The closed inventory is generated from the pinned source IDs plus fixed helper boundaries and roll tapes. Its ordered IDs and family counts are embedded in the corpus. No random sampling or statistical campaign is involved. Assertions check 80 definitions, 14 interactive augments, all ten effect kinds, unique case IDs, distinct eligible output choices and input/source immutability. Exact comparison regenerates the complete output in memory and never rewrites it.
