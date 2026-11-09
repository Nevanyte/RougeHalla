// Prints one file's recorded source hash out of a captured producer corpus (the mutant runner's provenance check).
import { readFileSync } from "node:fs";
const [corpus, rel] = process.argv.slice(2);
if (!corpus || !rel) { console.error("usage: hash-of.mjs <producer.json> <repo-relative-path>"); process.exit(2); }
const j = JSON.parse(readFileSync(corpus, "utf8"));
process.stdout.write(String((j.profile && j.profile.sourceFiles && j.profile.sourceFiles[rel]) || ""));
