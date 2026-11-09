// Re-captures the sealed actual World history while passively copying each exact Schema decode buffer.
// Reference rows are comparison-only; they are never fed into the source World or the decoder.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Decoder } from "@colyseus/schema";
import type { GameMap } from "@raid/shared";
import { createHumanWitness } from "../npc-continuity-fixtures/human.mts";
import { inspectClosure } from "../card-runtime-fixtures/private-inspection.mts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REFERENCE_PATH = "parity/policy/npc-continuity/source.json";
const EXPECTED_REFERENCE_SHA256 = "15c3dbc1f5d718859413e8dbb9891602dd49870f10dae4f12dc3152e2c57de96";
const EXPECTED_SNAPSHOT_COUNT = 773;
let runSequence = 0;

type ReferenceRow = {
  time: number;
  viewerId: string | null;
  targetId: string | null;
  schema: { bytes: number; sha256: string; kind: string };
  publication: { fxBatch: unknown };
  sourceDiagnostic: { tick: number };
};

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return copy;
}

function pin(path: string): { path: string; bytes: number; sha256: string } {
  const contents = readFileSync(resolve(REPO_ROOT, path));
  return { path, bytes: contents.byteLength, sha256: sha256(contents) };
}

/**
 * Re-executes the unchanged canonical capture in this process with a passive Decoder hook.
 * Each snapshot's bytes are the exact full-state input handed to the original Schema decoder.
 */
export async function captureSourceHistory(): Promise<{
  snapshots: Array<{
    bytes: Uint8Array;
    sourceTick: number;
    sourceTime: number;
    fxBatch: unknown;
    observerId: string | null;
    targetId: string | null;
  }>;
  reference: { timeline: ReferenceRow[]; [key: string]: unknown };
  map: GameMap;
  provenance: Record<string, unknown>;
}> {
  const canonicalPath = resolve(REPO_ROOT, REFERENCE_PATH);
  const canonicalBytes = readFileSync(canonicalPath);
  const referenceSha256 = sha256(canonicalBytes);
  assert.equal(referenceSha256, EXPECTED_REFERENCE_SHA256, "sealed source-history reference hash changed");

  const copiedFrames: Uint8Array[] = [];
  const decoderPrototype = Decoder.prototype as unknown as { decode: (...args: unknown[]) => unknown };
  const decoderDescriptor = Object.getOwnPropertyDescriptor(decoderPrototype, "decode");
  assert(decoderDescriptor && typeof decoderDescriptor.value === "function", "Schema Decoder.decode must be a data method");
  const originalDecode = decoderDescriptor.value as (...args: unknown[]) => unknown;
  const originalArgvArray = process.argv;
  const originalArgv = [...process.argv];
  const originalMathRandom = Math.random;
  const inspectorGlobalNames = ["__rhInspectFunction", "__rhInspectGetter"] as const;
  const inspectorGlobalsInitiallyAbsent = inspectorGlobalNames.every(name => !(name in globalThis));
  assert(inspectorGlobalsInitiallyAbsent, "private-inspection globals must be absent before capture");
  const tempDir = mkdtempSync(join(tmpdir(), "rh-npc-runner-source-history-"));
  const outputPath = join(tempDir, "source.json");
  const capturePath = resolve(REPO_ROOT, "tools/npc-continuity-fixtures/capture.mts");
  const captureUrl = pathToFileURL(capturePath);
  captureUrl.searchParams.set("source-history-run", `${process.pid}-${runSequence++}`);

  let inspector: Awaited<ReturnType<typeof inspectClosure>> | undefined;
  let regeneratedBytes: Uint8Array;
  let map: GameMap;
  let decoderRestored = false;
  let argvRestored = false;
  let mathRandomRestored = false;
  let temporaryDirectoryRemoved = false;
  let inspectorGlobalsRemoved = false;
  let getterRetrievedAfterCapture = false;
  let inspectorClosedBeforeReturn = false;
  try {
    // The call breakpoint reads only the actual constructor argument; it does not modify the map or World.
    inspector = await inspectClosure(createHumanWitness, "createHumanWitness", "() => map");
    Object.defineProperty(decoderPrototype, "decode", {
      ...decoderDescriptor,
      value: function (this: unknown, input: unknown, ...args: unknown[]): unknown {
        assert(input instanceof Uint8Array, "canonical capture must decode a byte view");
        copiedFrames.push(copyBytes(input));
        return Reflect.apply(originalDecode, this, [input, ...args]);
      },
    });
    process.argv.splice(0, process.argv.length, process.execPath, capturePath, "--write", outputPath);
    await import(captureUrl.href);
    regeneratedBytes = readFileSync(outputPath);
    map = inspector.capture()() as GameMap;
    getterRetrievedAfterCapture = true;
  } finally {
    try {
      await inspector?.close();
      inspectorClosedBeforeReturn = true;
    } finally {
      Object.defineProperty(decoderPrototype, "decode", decoderDescriptor);
      const restoredDecoderDescriptor = Object.getOwnPropertyDescriptor(decoderPrototype, "decode");
      decoderRestored = restoredDecoderDescriptor?.value === originalDecode
        && restoredDecoderDescriptor?.configurable === decoderDescriptor.configurable
        && restoredDecoderDescriptor?.enumerable === decoderDescriptor.enumerable
        && restoredDecoderDescriptor?.writable === decoderDescriptor.writable;
      process.argv.splice(0, process.argv.length, ...originalArgv);
      argvRestored = process.argv === originalArgvArray
        && process.argv.length === originalArgv.length
        && process.argv.every((value, index) => value === originalArgv[index]);
      Math.random = originalMathRandom;
      mathRandomRestored = Math.random === originalMathRandom;
      rmSync(tempDir, { recursive: true, force: true });
      temporaryDirectoryRemoved = !existsSync(tempDir);
      inspectorGlobalsRemoved = inspectorGlobalNames.every(name => !(name in globalThis));
    }
  }

  assert.equal(sha256(regeneratedBytes!), referenceSha256, "unchanged capture output must exactly match the sealed canonical bytes");
  assert.deepEqual(regeneratedBytes!, canonicalBytes, "unchanged capture output must be byte-identical to the sealed reference");
  const reference = JSON.parse(regeneratedBytes!.toString("utf8")) as { timeline: ReferenceRow[]; [key: string]: unknown };
  assert.equal(reference.timeline.length, EXPECTED_SNAPSHOT_COUNT, "freshly regenerated source-history row count changed");
  assert.equal(copiedFrames.length, EXPECTED_SNAPSHOT_COUNT, "exactly one captured Decoder input is expected for each source row");
  assert.equal(reference.timeline.length, copiedFrames.length, "captured decoder inputs must correspond one-to-one with reference rows");
  assert(decoderRestored && argvRestored && mathRandomRestored && temporaryDirectoryRemoved
    && inspectorGlobalsInitiallyAbsent && inspectorGlobalsRemoved && getterRetrievedAfterCapture && inspectorClosedBeforeReturn,
  "all temporary instrumentation and process state must be measured restored before returning");

  const snapshots = copiedFrames.map((bytes, index) => {
    const row = reference.timeline[index];
    assert(row, `missing comparison-only reference row ${index}`);
    assert.equal(bytes.byteLength, row.schema.bytes, `Schema byte length mismatch at source row ${index}`);
    assert.equal(sha256(bytes), row.schema.sha256, `Schema bytes differ from the same-step reference row ${index}`);
    return {
      bytes,
      sourceTick: row.sourceDiagnostic.tick,
      sourceTime: row.time,
      fxBatch: row.publication.fxBatch,
      observerId: row.viewerId,
      targetId: row.targetId,
    };
  });

  const provenance = {
    mode: "unchanged canonical capture re-execution with passive copy-before-decode instrumentation",
    reference: { path: REFERENCE_PATH, bytes: canonicalBytes.byteLength, sha256: referenceSha256 },
    regeneration: { byteExact: true, rows: reference.timeline.length, copiedDecoderInputs: copiedFrames.length },
    decoderInstrumentation: "Decoder.prototype.decode copies the supplied Uint8Array and calls the original method with the same receiver and arguments; it does not alter bytes or return values.",
    mapArgumentInspection: {
      helper: "tools/card-runtime-fixtures/private-inspection.mts",
      expression: "() => map",
      exactOriginalArgument: true,
      getterRetrievedAfterCanonicalRun: getterRetrievedAfterCapture,
      inspectorClosedBeforeReturn,
      mapReturnedWithoutReconstruction: true,
    },
    boundaries: {
      referenceIsComparisonOnly: true,
      referenceFeedsWorldOrDecoder: false,
      oldCaptureAndWorldHelpersModified: false,
      tempOutputRemoved: temporaryDirectoryRemoved,
      fullSnapshotSourceRowsNotSocketOrDeltaFrames: true,
    },
    cleanupTrace: {
      inspectorGlobalsInitiallyAbsent,
      inspectorGlobalsRemoved,
      decoderOriginalDescriptorAndFunctionRestored: decoderRestored,
      argvRestored: argvRestored,
      mathRandomRestored: mathRandomRestored,
      ownedTempDirectoryAbsent: temporaryDirectoryRemoved,
    },
    helperPins: [
      pin("tools/card-runtime-fixtures/private-inspection.mts"),
      pin("tools/npc-continuity-fixtures/capture.mts"),
      pin("tools/npc-continuity-fixtures/world.mts"),
      pin("tools/npc-continuity-fixtures/human.mts"),
      pin("tools/npc-continuity-fixtures/bot.mts"),
      pin("packages/shared/src/schema.ts"),
      pin("packages/server/src/rooms/FxChannel.ts"),
    ],
    wrapperSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  };
  return { snapshots, reference, map, provenance };
}
