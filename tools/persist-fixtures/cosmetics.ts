// Export the actual reference catalog and observe its look-word validation.
// Run: node --import tsx tools/persist-fixtures/cosmetics.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { COSMETICS, COSMETIC_SLOTS, packLook } from "../../packages/shared/src/cosmetics.ts";

const catalogPath = new URL("../../crates/rh-persist/data/cosmetics.json", import.meta.url);
const casesPath = new URL("../../crates/rh-persist/tests/fixtures/cosmetics.json", import.meta.url);
const cases: { label: string; equipped: Record<string, string>; owned: string[]; expected: number }[] = [];
function record(label: string, equipped: Record<string, string>, owned: string[]) {
  cases.push({ label, equipped, owned, expected: packLook(equipped, owned) });
}
record("empty", {}, []);
for (const c of COSMETICS) {
  record(`${c.id} owned`, { [c.slot]: c.id }, [c.id]);
  record(`${c.id} unowned`, { [c.slot]: c.id }, []);
  record(`${c.id} wrong slot`, { [c.slot === "skin" ? "title" : "skin"]: c.id }, [c.id]);
}
record("unknown id and slot", { skin: "__proto__", future: "skin-crimson" }, ["__proto__", "skin-crimson"]);
for (let n = 0; n < 128; n++) {
  const equipped = Object.fromEntries(COSMETIC_SLOTS.map((slot, i) => {
    const choices = COSMETICS.filter(c => c.slot === slot);
    return [slot, choices[(n * 7 + i) % choices.length].id];
  }));
  const owned = COSMETICS.filter((_c, i) => (i + n) % 3 !== 0).map(c => c.id);
  record(`combined ${n}`, equipped, owned);
}
for (const [path, value] of [
  [catalogPath, COSMETICS],
  [casesPath, { format: "rh-cosmetics-parity/1", source: "packages/shared/src/cosmetics.ts", cases }],
] as const) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== text) throw new Error(`Cosmetics changed: reconcile and regenerate ${path.pathname.split("/").at(-1)}`);
  } else writeFileSync(path, text);
}
console.log(`${COSMETICS.length} catalog entries and ${cases.length} legacy look observations ${process.argv.includes("--check") ? "unchanged" : "recorded"}`);
