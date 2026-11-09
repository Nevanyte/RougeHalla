// Print the corpus profile's recorded source hash for one repo-relative path (the mutated file must be in the closure).
import { readFileSync } from "node:fs";
const [corpusPath, rel] = process.argv.slice(2);
if (!corpusPath || !rel) { console.error("usage: hash-of.mjs <corpus.json> <repo-relative-path>"); process.exit(2); }
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const hash = corpus.profile && corpus.profile.sourceFiles ? corpus.profile.sourceFiles[rel] : undefined;
if (hash !== undefined) console.log(hash);
