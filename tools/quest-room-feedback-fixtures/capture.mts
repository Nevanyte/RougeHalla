// Room-method projection over ONE already captured producer batch. No World construction/step, sockets or Room lifecycle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSemantics } from "./compare.mjs";

const args = process.argv.slice(2);
assert.equal(args.length, 4, "--write|--check OUTPUT --repo ROOT");
const [mode, output, repoFlag, rootArg] = args;
assert(mode === "--write" || mode === "--check");
assert.equal(repoFlag, "--repo");
const root = resolve(rootArg!);
const tool = "tools/quest-room-feedback-fixtures";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path: string) => sha(readFileSync(join(root, path)));
const pins = JSON.parse(readFileSync(join(root, tool, "pins.json"), "utf8"));
assert.equal(process.version, pins.node);
assert.equal(process.platform, pins.platform);
assert.equal(process.arch, pins.arch);
assert.equal(fileSha(pins.input.path), pins.input.sha256, "original producer corpus bytes must remain immutable");
const corpus = JSON.parse(readFileSync(join(root, pins.input.path), "utf8"));
assert.equal(corpus.format, "rh-quest-giver-source/1");
const sourceCase = corpus.cases[pins.input.caseIndex];
assert.equal(sourceCase.input.name, pins.input.caseName);
const frame = sourceCase.frames[pins.input.frameIndex];
assert.equal(frame.label, pins.input.frameLabel);
assert.equal(frame.tick, 8);
assert.equal(frame.time, 400);
assert.equal(sourceCase.frames[pins.input.frameIndex - 1].tick + 1, frame.tick);
assert.equal(sourceCase.frames[pins.input.frameIndex - 1].time + 50, frame.time);
assert.equal(frame.projectiles.length, 0, "explicit empty projectile dependency is source-backed in this frame");
assert.equal(frame.events.length, 4);
assert.deepEqual(frame.events[0], { type: "gv", id: "p0", amount: 10, reason: "quest" });
assert.deepEqual(frame.events.slice(1).map((event: any) => [event.type, event.to]), [
  ["toast", "p0"], ["toast", "p0"], ["toast", null],
]);
assert.equal(fileSha("tools/quest-giver-fixtures/capture.mts"), corpus.provenance.tools.captureMts,
  "producer harness is the actual unchanged one that captured the input");

// Import actual source and installed Colyseus/shared dependencies. No import stubs and no copied room formatter.
const { RaidRoom } = await import(pathToFileURL(join(root, "packages/server/src/rooms/RaidRoom.ts")).href);
const { FxChannel } = await import(pathToFileURL(join(root, "packages/server/src/rooms/FxChannel.ts")).href);
const proto = RaidRoom.prototype as any;
for (const method of ["handleEvents", "toastTo", "sendTo"]) assert.equal(typeof proto[method], "function");

type DeclaredReceiver = { id: string; label: string };
function project(name: string, role: string, clientsSpec: DeclaredReceiver[], botIds: string[]) {
  const rows: any[] = [];
  const lookups: string[] = [];
  const fxCalls: any[] = [];
  const receiver: any = Object.create(proto); // No Room constructor, session lifecycle, auth or sockets.
  const sinks = clientsSpec.map(({ id, label }) => ({ sessionId: id, label,
    send(type: string, message: any) { rows.push({ order: rows.length, route: "client", recipient: id, type,
      payload: structuredClone(message) }); },
  }));
  const clients = Object.assign(sinks, { getById(id: string) { lookups.push(id); return sinks.find(c => c.sessionId === id); } });
  Object.defineProperty(receiver, "clients", { value: clients });
  receiver.broadcast = (type: string, message: any) => rows.push({ order: rows.length, route: "broadcast", recipient: null,
    type, payload: structuredClone(message) }); // Recorder only: no invented Colyseus fanout.
  receiver.run = null; // Explicitly no telemetry dependency in this method witness.
  receiver.built = { state: { serverTime: frame.time }, projectiles: new Map() };
  assert.equal(receiver.world, receiver.built, "actual RaidRoom world getter uses the declared built dependency");
  receiver.botBatches = [];
  if (botIds.length) receiver.bots = {
    isBot: (id: string) => botIds.includes(id),
    onToast(id: string, text: string) { rows.push({ order: rows.length, route: "bot.onToast", recipient: id,
      type: "toast", payload: { text } }); }, // Declared receiver sink, not a BotManager/quest producer.
  };
  const actualFx = new FxChannel();
  receiver.fxChannel = new Proxy(actualFx, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== "batch") return value;
    return (fxs: any[], time: number, projectiles: Map<string, any>) => {
      const result = Reflect.apply(value, target, [fxs, time, projectiles]);
      fxCalls.push({ eventCount: fxs.length, time, projectileCount: projectiles.size, returned: structuredClone(result) });
      return result;
    };
  } }); // Transparent call recorder: the actual FxChannel.prototype.batch executes, without replacement rules.
  assert(receiver.fxChannel instanceof FxChannel);
  assert.equal(receiver.toastTo, proto.toastTo);
  assert.equal(receiver.sendTo, proto.sendTo);
  assert.equal(receiver.handleEvents, proto.handleEvents);
  const events = structuredClone(frame.events);
  const before = JSON.stringify(events);
  Reflect.apply(proto.handleEvents, receiver, [events]);
  assert.equal(JSON.stringify(events), before, "room projection must not mutate its captured producer input");
  assert.deepEqual(fxCalls, [{ eventCount: 0, time: 400, projectileCount: 0, returned: null }]);
  assert.equal(receiver.world.projectiles.size, 0);
  assert.deepEqual(receiver.botBatches, []);
  return { name, role, dependencies: { clients: clientsSpec, botIds, telemetry: "absent", serverTime: frame.time,
    world: "minimal built record through actual world getter; no World construction",
    projectiles: "explicit empty Map; captured frame has no projectiles", broadcast: "recorded call, no session fanout" },
    rows, clientLookups: lookups, actualFxCalls: fxCalls };
}
const receivers = [
  project("genuine-completion-batch-human-receiver", "room method witness over unchanged real giver8 input", [
    { id: "p0", label: "name0" }, { id: "p1", label: "name1" }, { id: "p2", label: "name2" },
  ], []),
  project("duplicate-label-route-control", "declared dispatch control, not new gameplay", [
    { id: "p0", label: "name0" }, { id: "p1", label: "name0" }, { id: "p2", label: "name2" },
  ], []),
  project("missing-owner-route-control", "declared dispatch control; foreign clients must receive no private sends", [
    { id: "p1", label: "name0" }, { id: "p2", label: "name2" },
  ], []),
  project("bot-onToast-route-control", "declared recipient-classification control, not bot quest eligibility/production", [
    { id: "p1", label: "name1" }, { id: "p2", label: "name2" },
  ], ["p0"]),
];
function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}
const sourceFiles = ["packages/server/src", "packages/shared/src"].flatMap(files).sort();
const harnessFiles = files(tool).filter(path => /\.(mts|mjs|sh|json)$/.test(path)).sort();
const configFiles = ["package.json", "package-lock.json", "tsconfig.base.json", "packages/server/package.json",
  "packages/shared/package.json", "packages/client/package.json", "packages/server/tsconfig.json",
  "packages/shared/tsconfig.json", "packages/client/tsconfig.json", "tools/quest-giver-fixtures/capture.mts"];
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const dependencyVersions = Object.fromEntries(["tsx", "typescript", "esbuild", "@colyseus/core", "@colyseus/schema"]
  .map(name => [name, lock.packages[`node_modules/${name}`].version]));
const body = { format: "rh-quest-room-feedback/1", input: { path: pins.input.path, sha256: pins.input.sha256,
  caseIndex: pins.input.caseIndex, caseName: sourceCase.input.name, frameIndex: pins.input.frameIndex,
  frameLabel: frame.label, tick: frame.tick, time: frame.time, rawEventsSha256: sha(JSON.stringify(frame.events)),
  events: frame.events, captureScope: "one original step between picked-4 and turned-in; no gameplay recapture" }, receivers,
  provenance: { sourceBaseRevision: pins.sourceBaseRevision, image: pins.image, platform: "linux/amd64", node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(), v8: process.versions.v8, dependencyVersions,
    sourceClosure: "conservative complete packages/server/src + packages/shared/src superset; no import stubs",
    sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, fileSha(path)])),
    harnessSha256: Object.fromEntries(harnessFiles.map(path => [path, fileSha(path)])),
    configSha256: Object.fromEntries(configFiles.map(path => [path, fileSha(path)])),
    limits: "method projection over captured events; receiver stubs; no Room lifecycle, sockets, auth, live sessions or client presentation" } };
const text = JSON.stringify(body, null, 2) + "\n";
const file = join(output!, "source.json");
if (mode === "--write") { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
else {
  const expected = JSON.parse(readFileSync(file, "utf8"));
  assertSemantics(expected, body); // Actual output first: a metadata-only mismatch cannot masquerade as a semantic kill.
  assert.equal(text, readFileSync(file, "utf8"), "FULL_BYTE_CHECK_MISMATCH");
}
console.log(JSON.stringify({ status: mode === "--check" ? "CHECK_PASS" : "CAPTURE_PASS", receivers: receivers.length,
  genuineProducerBatches: 1, sourceFiles: sourceFiles.length, bytes: Buffer.byteLength(text), sha256: sha(text) }));
