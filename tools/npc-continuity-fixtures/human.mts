// Executes exact source spans from RaidScene's remote draw and regional-mob/minimap producer path.
// This is not a Phaser scene, a Minimap canvas, or a screenshot harness.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { version as typescriptVersion } from "typescript";
import { API } from "typescript/unstable/sync";
import * as tsAst from "typescript/unstable/ast";
import { transformSync, version as esbuildVersion } from "esbuild";

import { withGates, type GameMap, type Vec2 } from "@raid/shared";
import type { MobState, RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../../packages/client/src/net/interpolation.ts";
import { RemoteDraw } from "../../packages/client/src/net/remoteDraw.ts";
import { RaidVision } from "../../packages/client/src/render/RaidVision.ts";
import { shouldRenderActor } from "../../packages/client/src/render/visibility.ts";

const REPO_ROOT = new URL("../../", import.meta.url);
const RAID_SCENE_PATH = "packages/client/src/scenes/RaidScene.ts";
const SOURCE_MODULE_PATH = fileURLToPath(import.meta.url);
const sha256 = (input: string | Uint8Array): string => createHash("sha256").update(input).digest("hex");

type MobRow = {
  id: string;
  kind: string;
  status: string;
  x: number;
  y: number;
  faction: string;
  owned: boolean;
};

type ExtractedSource = {
  drawRemote: (id: string, kind: "player" | "mob", f: unknown, renderT: number) => void;
  runMobAdmissionPrefix: (this: AdmissionContext, m: MobState, id: string, renderT: number) => void;
  makeMinimapSource: (this: AdmissionContext, state: RaidState) => { forEach(cb: (mob: object, id: string) => void): void };
  spans: Record<string, { lines: [number, number]; sourceSha256: string; transpiledSha256: string }>;
  sceneSourceSha256: string;
};

type AdmissionContext = {
  remoteDraw: RemoteDraw;
  tmp: Vec2;
  rendered: Map<string, Vec2>;
  vision: RaidVision;
  room: { sessionId: string };
  admittedRows: Array<{ id: string; kind: string; status: string; x: number; y: number }>;
  drawRemote: ExtractedSource["drawRemote"];
};

function repoPath(path: string): string {
  return fileURLToPath(new URL(path, REPO_ROOT));
}

function transpile(source: string, label: string): string {
  try {
    return transformSync(source, {
      loader: "ts", target: "es2022", format: "cjs", sourcemap: false, sourcefile: `${label}.ts`,
    }).code;
  } catch (error) {
    assert.fail(`extracted ${label} failed pinned esbuild transpilation: ${String(error)}`);
  }
}

function sourceLineSpan(sourceFile: tsAst.SourceFile, node: tsAst.Node): [number, number] {
  const first = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const last = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return [first, last];
}

function namedMethod(klass: tsAst.ClassDeclaration, sourceFile: tsAst.SourceFile, name: string): tsAst.MethodDeclaration {
  const matches = klass.members.filter((node): node is tsAst.MethodDeclaration =>
    tsAst.isMethodDeclaration(node) && tsAst.isIdentifier(node.name) && node.name.text === name);
  assert.equal(matches.length, 1, `expected one ${name} method`);
  return matches[0];
}

function collectNodes<T extends tsAst.Node>(root: tsAst.Node, guard: (node: tsAst.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: tsAst.Node): void => {
    if (guard(node)) found.push(node);
    node.forEachChild((child) => { visit(child); });
  };
  visit(root);
  return found;
}

function extractExactSource(): ExtractedSource {
  const scenePath = repoPath(RAID_SCENE_PATH);
  const sceneBytes = readFileSync(scenePath);
  const api = new API({ cwd: fileURLToPath(REPO_ROOT) });
  let sf: tsAst.SourceFile;
  try {
    const snapshot = api.updateSnapshot({ openFiles: [scenePath] });
    const project = snapshot.getDefaultProjectForFile(scenePath);
    assert(project, "TypeScript 7 AST project must load RaidScene.ts");
    const sourceFile = project.program.getSourceFile(scenePath);
    assert(sourceFile, "TypeScript 7 AST program must provide RaidScene.ts");
    sf = sourceFile;
    assert.equal(project.program.getSyntacticDiagnostics(scenePath).length, 0, "RaidScene.ts must parse without syntax errors");
  } finally {
    api.close();
  }
  const sceneText = sf.getFullText();
  assert.equal(sceneText, sceneBytes.toString("utf8"), "AST project text must match the byte-hashed source file");
  const classes = sf.statements.filter((node): node is tsAst.ClassDeclaration =>
    tsAst.isClassDeclaration(node) && node.name?.text === "RaidScene");
  assert.equal(classes.length, 1, "expected one RaidScene class");
  const raidScene = classes[0];

  const drawNode = namedMethod(raidScene, sf, "drawRemote");
  const drawText = drawNode.getText(sf);
  assert.match(drawText, /this\.remoteDraw\.draw\(id, kind, f, renderT, this\.tmp\)/,
    "drawRemote source shape changed; refusing to synthesize a replacement");
  assert.match(drawText, /this\.rendered\.get\(id\)/,
    "drawRemote rendered-position update changed; refusing to synthesize a replacement");
  const drawClassText = `class ExtractedRaidScene {\n${drawText}\n}`;
  const drawJs = transpile(drawClassText, "RaidScene.drawRemote");
  const ExtractedRaidScene = new Function(`${drawJs}\nreturn ExtractedRaidScene;`)() as new () => { drawRemote: ExtractedSource["drawRemote"] };
  const drawRemote = new ExtractedRaidScene().drawRemote;

  const updateNode = namedMethod(raidScene, sf, "update");
  const mobCalls = collectNodes(updateNode, (node): node is tsAst.CallExpression => {
    if (!tsAst.isCallExpression(node) || !tsAst.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "forEach") return false;
    return node.expression.expression.getText(sf) === "state.mobs";
  });
  const admissionCallbacks = mobCalls.filter((call) => {
    const argument = call.arguments[0];
    return call.arguments.length === 1 && tsAst.isArrowFunction(argument) && tsAst.isBlock(argument.body)
      && argument.body.statements.slice(0, 3).some((statement) => statement.getText(sf).includes("this.drawRemote(id, \"mob\", m, renderT)"));
  });
  assert.equal(admissionCallbacks.length, 1, "expected one state.mobs.forEach callback with the actual mob admission prefix");
  const callback = admissionCallbacks[0].arguments[0];
  assert.ok(tsAst.isArrowFunction(callback) && tsAst.isBlock(callback.body), "state.mobs.forEach admission callback shape changed");
  const prefixStatements = callback.body.statements.slice(0, 3);
  assert.equal(prefixStatements.length, 3, "regional mob admission prefix must remain three statements");
  const prefixText = prefixStatements.map((node) => node.getText(sf)).join("\n");
  const normalizedPrefix = prefixText.replace(/\s+/g, " ");
  assert.match(normalizedPrefix, /^if \(m\.kind === "quest"\) return; this\.drawRemote\(id, "mob", m, renderT\); if \(!shouldRenderActor\(false, m\.effects, this\.tmp, this\.vision\.canSee\)\) \{ this\.rendered\.delete\(id\); return; \}$/,
    "regional mob admission prefix changed; refusing a hand-written equivalent");
  const prefixWrapper = `function runMobAdmissionPrefix(m: any, id: string, renderT: number): void {\n${prefixText}\nthis.admittedRows.push({ id, kind: m.kind, status: m.status, x: this.tmp.x, y: this.tmp.y });\n}`;
  const prefixJs = transpile(prefixWrapper, "RaidScene.mobAdmissionPrefix");
  const runMobAdmissionPrefix = new Function("shouldRenderActor", `${prefixJs}\nreturn runMobAdmissionPrefix;`)(shouldRenderActor) as ExtractedSource["runMobAdmissionPrefix"];

  const setMobCalls = collectNodes(raidScene, (node): node is tsAst.CallExpression => {
    if (!tsAst.isCallExpression(node) || !tsAst.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "setMobs") return false;
    return node.expression.expression.getText(sf) === "this.minimap";
  });
  assert.equal(setMobCalls.length, 1, "expected one this.minimap.setMobs call");
  assert.equal(setMobCalls[0].arguments.length, 1);
  const minimapArgument = setMobCalls[0].arguments[0];
  assert.ok(tsAst.isObjectLiteralExpression(minimapArgument), "Minimap source argument must remain an object literal");
  const minimapText = minimapArgument.getText(sf);
  const normalizedMinimapText = minimapText.replace(/\s+/g, " ");
  assert.match(normalizedMinimapText, /forEach: \(cb: \(mob: MinimapMob, id: string\) => void\): void => \{ state\.mobs\.forEach\(\(mob, id\) => \{ const at = this\.rendered\.get\(id\); if \(!at \|\| !this\.vision\.canSee\(at\)\) return; cb\(\{ x: at\.x, y: at\.y, kind: mob\.kind, status: mob\.status, faction: mob\.faction, owned: mob\.ownerId === this\.room\.sessionId \}, id\); \}\); \}, \}$/,
    "Minimap producer callback changed; refusing a hand-written equivalent");
  const minimapWrapper = `function makeMinimapSource(state: any): any { return ${minimapText}; }`;
  const minimapJs = transpile(minimapWrapper, "RaidScene.minimapMobProducer");
  const makeMinimapSource = new Function(`${minimapJs}\nreturn makeMinimapSource;`)() as ExtractedSource["makeMinimapSource"];

  const sourceHash = sha256(sceneBytes);
  const spans = {
    drawRemote: {
      lines: sourceLineSpan(sf, drawNode), sourceSha256: sha256(drawText), transpiledSha256: sha256(drawJs),
    },
    regionalMobAdmissionPrefix: {
      lines: [sourceLineSpan(sf, prefixStatements[0])[0], sourceLineSpan(sf, prefixStatements[2])[1]] as [number, number],
      sourceSha256: sha256(prefixText), transpiledSha256: sha256(prefixJs),
    },
    minimapProducerArgument: {
      lines: sourceLineSpan(sf, minimapArgument), sourceSha256: sha256(minimapText), transpiledSha256: sha256(minimapJs),
    },
  };
  return { drawRemote, runMobAdmissionPrefix, makeMinimapSource, spans, sceneSourceSha256: sourceHash };
}

const EXTRACTED = extractExactSource();
const MODULE_SHA256 = sha256(readFileSync(SOURCE_MODULE_PATH));

/**
 * Run the exact extracted RaidScene remote-draw/mob-admission/minimap-source callbacks over decoded Schema patches.
 * `map` is the source world's ordinary unlocked map. `push` uses serverTime as a declared zero-jitter local receipt clock.
 * The full Phaser scene, MobView, Minimap.setMobs, and canvas painting are intentionally not instantiated.
 */
export function createHumanWitness(map: GameMap, viewerId: string): {
  provenance: object;
  push(state: RaidState): object;
} {
  assert(map && Number.isInteger(map.w) && Number.isInteger(map.h), "a source world map is required");
  assert(typeof viewerId === "string" && viewerId.length > 0, "viewerId is required");
  const interpolator = new EntityInterpolator();
  const remoteDraw = new RemoteDraw(interpolator);
  const drawAhead = false;
  remoteDraw.setEnabled(drawAhead);
  const vision = new RaidVision();
  vision.reset(map);
  const context: AdmissionContext = {
    remoteDraw,
    tmp: { x: 0, y: 0 },
    rendered: new Map(),
    vision,
    room: { sessionId: viewerId },
    admittedRows: [],
    drawRemote: EXTRACTED.drawRemote,
  };
  let previousServerTime = -Infinity;
  let patchCount = 0;

  const provenance = {
    sourceMode: "exact AST source-span extraction; source methods/callback bodies are transpiled from unchanged RaidScene.ts spans and invoked",
    source: RAID_SCENE_PATH,
    sceneSourceSha256: EXTRACTED.sceneSourceSha256,
    moduleSha256: MODULE_SHA256,
    typescriptVersion,
    transpiler: { name: "esbuild", version: esbuildVersion },
    extracted: EXTRACTED.spans,
    callbackInvocation: {
      raidSceneDrawRemote: true,
      regionalMobAdmissionPrefix: true,
      inlineMinimapSetMobsArgumentForEach: true,
      roomSessionIdentity: "viewerId supplied as the exact sessionId field consumed by the extracted callback; no Room/socket implementation",
      raidSceneUpdate: false,
      mobViewUpdateOrConstruction: false,
      MinimapSetMobsMethod: false,
      PhaserSceneOrCanvas: false,
    },
    executionLimits: {
      actorScope: "prefix-admitted regional kinds mob/elite; quest returns from the extracted prefix; other kinds may be reported as prefix rows but no downstream view behavior is claimed",
      frameClock: "serverTime reused as local receipt time (zero-jitter declared clock); EntityInterpolator's production default clock is used",
      drawAhead,
      visionOrigin: "authoritative viewer row from decoded state; no local prediction path is run",
      geometry: "the supplied source map, or actual shared withGates(map) when state.gatesLocked",
      claimBoundary: "actual callback inputs/admission rows only; not display pixels, full RaidScene, MobView, or Minimap painting",
    },
  };

  return {
    provenance,
    push(state: RaidState): object {
      assert(state && state.players && state.mobs, "push requires a decoded RaidState-like object");
      assert(Number.isFinite(state.serverTime) && state.serverTime >= previousServerTime, "serverTime must be finite and monotonic");
      const viewer = state.players.get(viewerId);
      assert(viewer, `decoded state is missing viewer ${viewerId}`);
      const now = state.serverTime;
      const visionFacts = {
        viewerId,
        origin: { x: viewer.x, y: viewer.y },
        alive: viewer.status === "alive",
        active: state.phase === "active",
        training: state.training === true,
        gatesLocked: state.gatesLocked,
        serverTime: now,
        camps: Array.from({ length: state.camps?.length ?? 0 }, (_, index) => {
          const camp = state.camps[index];
          return camp ? { wardOwner: camp.wardOwner, wardExpiresAt: camp.wardExpiresAt } : null;
        }),
      };

      // Same production components/order: state patch -> render clock/frame setup -> RaidVision update -> actor callback.
      interpolator.onPatch(state, now);
      const renderT = interpolator.renderTime(now);
      const renderMap = state.gatesLocked ? withGates(map) : map;
      remoteDraw.beginFrame(renderMap, renderT);
      vision.update(map, state.gatesLocked, viewer, viewer.status === "alive", state.phase === "active",
        state.training === true, viewerId, state.camps, now);
      context.admittedRows.length = 0;
      state.mobs.forEach((mob, id) => EXTRACTED.runMobAdmissionPrefix.call(context, mob, id, renderT));

      const prefixRows = context.admittedRows.map((row) => ({ ...row }));
      const minimapSource = EXTRACTED.makeMinimapSource.call(context, state);
      const minimapRows: Array<Record<string, unknown>> = [];
      minimapSource.forEach((mob, id) => minimapRows.push({ ...mob, id }));
      const rowKinds = new Set(prefixRows.map((row) => row.kind));
      const unsupportedKinds = [...rowKinds].filter((kind) => kind !== "mob" && kind !== "elite");

      patchCount++;
      previousServerTime = now;
      return {
        patch: patchCount,
        sourceTime: now,
        localReceiptTime: now,
        renderTime: renderT,
        drawAhead,
        visionInput: visionFacts,
        extractedMobAdmissionPrefix: {
          invoked: true,
          statementCount: 3,
          admittedRows: prefixRows,
          unsupportedAdmittedKinds: unsupportedKinds,
        },
        inlineMinimapProducer: {
          invoked: true,
          rows: minimapRows,
          renderedPositionCount: context.rendered.size,
        },
        renderer: {
          fullSceneRan: false,
          mobViewRan: false,
          minimapSetMobsRan: false,
          pixelsCaptured: false,
        },
      };
    },
  };
}
