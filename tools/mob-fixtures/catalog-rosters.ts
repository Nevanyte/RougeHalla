/** Pure leaf oracle: unchanged public source exports, explicitly declared draw tapes, no source rewrite. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import * as m from "../../packages/shared/src/mobs.ts";
import * as r from "../../packages/shared/src/rosters.ts";
import type { FactionId } from "../../packages/shared/src/factions.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = resolve(ROOT, "parity/mobs/catalog-rosters.json");
const BASE = "49726d60fdd92e669c6605b13bac40c14ba56421"; // Source snapshot, not a claim about the coordinator's later integration revision.
const ZONES: FactionId[] = ["fire", "sentenced", "plague", "frost", "holy"];
type Camp = { zone: FactionId; spotCount: number; eliteSpot: number };
type Input = { kind: "catalog" | "kinds" } |
  { kind: "zone"; zone: FactionId; count: number; tape: number[] } |
  { kind: "camps"; zones: FactionId[]; tape: number[] } |
  { kind: "elites"; camps: Camp[]; tape: number[] } |
  { kind: "spots"; camp: Camp; campType: m.MobTypeId; eliteType: m.MobTypeId | null; tape: number[] };
type Case = { id: string; input: Input };

/** Synthetic declared tape streams; independent input generation, not the world's private RNG. */
function tape(stream: number): number[] {
  let word = stream >>> 0;
  return Array.from({ length: 49 }, () => {
    word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
    return word / 4294967296;
  });
}
function inventory(): Case[] {
  const cases: Case[] = [{ id: "catalog", input: { kind: "catalog" } }, { id: "kinds", input: { kind: "kinds" } }];
  for (let i = 0; i < 200; i++) {
    // Vary first-seen order, repeat/interleave zones, and exercise bag wrap without RNG-selected inputs.
    const zones = Array.from({ length: 13 + i % 54 }, (_, k) => ZONES[(k * (i % 4 + 1) + i) % 5]!);
    cases.push({ id: `stream-${i}`, input: { kind: "camps", zones, tape: tape(i) } });
  }
  for (let z = 0; z < 5; z++) for (const count of [0, 1, 4, 10, 12, 13, 25]) {
    cases.push({ id: `zone-${z}-${count}`, input: { kind: "zone", zone: ZONES[z]!, count, tape: tape(1000 + z * 100 + count) } });
  }
  const layouts: FactionId[][] = [[], ["holy"], ["holy", "fire", "holy", "plague", "fire"], Array(13).fill("frost")];
  layouts.forEach((zones, i) => cases.push({ id: `layout-${i}`, input: { kind: "camps", zones, tape: tape(2000+i) } }));
  for (const [i, draw] of [0, 0.25, 0.5, 0.75, 1 - 1/4294967296].entries()) {
    cases.push({ id: `draw-boundary-${i}`, input: { kind: "zone", zone: "fire", count: 13, tape: Array(49).fill(draw) } });
  }
  for (let z = 0; z < 5; z++) {
    const camps = Array.from({ length: 13 }, (_, k) => ({ zone: ZONES[(z + k % 2) % 5]!, spotCount: 4, eliteSpot: k % 4 === 0 ? -1 : k % 4 }));
    cases.push({ id: `elites-${z}`, input: { kind: "elites", camps, tape: tape(3000+z) } });
    for (const [j, [spotCount, eliteSpot]] of [[0,-1],[0,0],[4,-1],[4,0],[4,3],[4,4],[4,-2]].entries()) {
      for (let explicit = 0; explicit < 2; explicit++) cases.push({ id: `spots-${z}-${j}-${explicit}`, input: {
        kind: "spots", camp: { zone: ZONES[z]!, spotCount: spotCount!, eliteSpot: eliteSpot! },
        campType: m.MOB_TYPES[(z*6 + 1) % 30]!.id,
        // Source accepts a typed elite override even from another zone. Do not add validation it lacks.
        eliteType: explicit ? m.MOB_TYPES[((z+1)*6 + 5) % 30]!.id : null, tape: tape(4000+z*100+j*2+explicit),
      } });
    }
  }
  cases.push({ id: "elites-empty", input: { kind: "elites", camps: [], tape: tape(5000) } });
  assert.equal(cases.length, 322);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  assert.equal(new Set(cases.slice(2, 202).map(c => JSON.stringify((c.input as {tape:number[]}).tape))).size, 200);
  return cases;
}
function evaluate(input: Input): unknown {
  if (input.kind === "catalog") {
    const lookupIds: (string | null)[] = [null, "", "not-a-mob", "EMBERIMP", ...m.MOB_TYPES.map(t => t.id)];
    return {
      roles: m.MOB_ROLES.map(id => m.MOB_ROLE_DEFS[id]), types: m.MOB_TYPES,
      regions: ZONES.map(zone => ({ zone, names: [m.mobName(zone,false),m.mobName(zone,true)], weapon: m.mobWeapon(zone),
        all: m.mobTypesOf(zone).map(t => t.id), normal: m.normalTypesOf(zone).map(t => t.id), elite: m.elitesOf(zone).map(t => t.id) })),
      lookups: ZONES.flatMap(zone => lookupIds.map(id => ({ zone, id, byId: id === null ? null : m.mobTypeById(id)?.id ?? null,
        inZone: m.mobTypeIn(zone,id ?? undefined)?.id ?? null, weapon: m.mobTypeWeapon(zone,id ?? undefined) }))),
      reach: m.MOB_TYPES.map(t => ({ id: t.id, damage: m.mobReachDamage(t) })), bagCopies: r.BAG_COPIES,
    };
  }
  if (input.kind === "kinds") return ["mob","elite","dummy","zombie","", "Mob", "player"].map(kind => ({ kind, regional: m.isRegionalKind(kind) }));
  let used = 0;
  const next = () => {
    const draw = input.tape[used++];
    if (draw === undefined || !Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("exhausted/invalid declared tape");
    return draw;
  };
  let output: unknown;
  const sourceCamp = (c: Camp) => ({ zone: c.zone, spots: Array.from({length:c.spotCount},()=>({x:0,y:0})), eliteSpot: c.eliteSpot });
  if (input.kind === "zone") output = r.rollZoneTypes(input.zone,input.count,next);
  else if (input.kind === "camps") output = r.rollCampTypes(input.zones,next);
  else if (input.kind === "elites") output = r.rollCampElites(input.camps.map(sourceCamp));
  else output = r.campMobs(sourceCamp(input.camp),input.campType,input.eliteType ?? undefined);
  const draws = used;
  const continuation = Array.from({length:4},next);
  return { output, draws, continuation };
}
/** Track the complete transitive static local import closure, plus the runner and lockfile. */
function sources(): {path:string;sha256:string}[] {
  const seen = new Set<string>();
  function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(resolve(ROOT,path),"utf8");
    if (!path.endsWith(".ts")) return;
    for (const hit of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
      let full = resolve(dirname(resolve(ROOT,path)),hit[1]!);
      if (!full.endsWith(".ts") && !full.endsWith(".json")) full += ".ts";
      visit(relative(ROOT,full));
    }
  }
  visit("tools/mob-fixtures/catalog-rosters.ts");
  visit("package-lock.json");
  return [...seen].sort().map(path=>({path,sha256:createHash("sha256").update(readFileSync(resolve(ROOT,path))).digest("hex")}));
}
function capture() {
  assert.equal(process.version,"v22.23.4","canonical Node version");
  assert.equal(process.platform,"linux","canonical platform");
  assert.equal(process.arch,"x64","canonical arch");
  const cases = inventory().map(c=>({...c,expected:evaluate(c.input)}));
  return { format: "rh-mob-catalog/1", provenance: { base: BASE, command: "node --import tsx tools/mob-fixtures/catalog-rosters.ts --capture",
    runtime: {node:process.version,platform:process.platform,arch:process.arch}, sources:sources() },
    coverage: { cases:cases.length, types:30, normal:20, elite:10, roles:5, streams:200, lookups:170, continuation:4 }, cases };
}
function bytes(value: unknown): string { return JSON.stringify(value)+"\n"; }
function verify(raw: string, canonical: string) { assert.equal(raw,canonical,"closed complete fixture bytecheck failed; no file rewritten"); }
function options(args:string[]) {
  let mode = ""; let path = FIXTURE;
  const seen = new Set<string>();
  for (let i=0;i<args.length;i++) {
    const arg=args[i]!;
    if(seen.has(arg)) throw new Error(`duplicate option ${arg}`);
    seen.add(arg);
    if(["--capture","--check","--self-test"].includes(arg)) { if(mode) throw new Error("incompatible modes"); mode=arg; }
    else if(arg==="--output") { const val=args[++i]; if(!val || val.startsWith("--")) throw new Error("missing output path"); path=resolve(ROOT,val); }
    else throw new Error(`unknown option ${arg}; partial/zero-work filters are not supported`);
  }
  if(!mode) throw new Error("exactly one mode required");
  if(mode!=="--capture" && seen.has("--output")) throw new Error("output only permitted with capture");
  return {mode,path};
}
function selfTest(canonical: string) {
  let checks=0;
  for(const args of [[],["--unknown"],["--only","absent"],["--capture","--check"],["--check","--check"],["--capture","--output"],["--check","--output","x"]]) {
    assert.throws(()=>options(args)); checks++;
  }
  const mutate = (f:(c:any)=>void) => { const c=JSON.parse(canonical);f(c); assert.throws(()=>verify(bytes(c),canonical));checks++; };
  mutate(c=>c.cases=[]); mutate(c=>c.cases.pop()); mutate(c=>c.cases.push(c.cases[0]));
  mutate(c=>c.provenance.sources[0].sha256="0".repeat(64)); mutate(c=>c.extra=true);
  mutate(c=>c.cases[2].input.tape[0]=1); mutate(c=>c.cases[2].input.tape=[]);
  mutate(c=>c.cases[2].expected.continuation.pop()); mutate(c=>c.cases[2].expected.draws++);
  assert.throws(()=>verify(canonical.replace('"format":','"format":"duplicate","format":'),canonical));checks++;
  console.log(JSON.stringify({selfTestChecks:checks}));
}
const opts=options(process.argv.slice(2));
const canonical=bytes(capture());
if(opts.mode==="--capture") { mkdirSync(dirname(opts.path),{recursive:true});writeFileSync(opts.path,canonical); }
else { verify(readFileSync(FIXTURE,"utf8"),canonical);if(opts.mode==="--self-test")selfTest(canonical); }
console.log(JSON.stringify({mode:opts.mode,bytes:canonical.length,sha256:createHash("sha256").update(canonical).digest("hex"),cases:322}));
