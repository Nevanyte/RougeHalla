// Deterministic Node ESM loader for this witness. "phaser" is replaced by a declared, minimal base-class module: the
// imported RaidScene declares `extends Phaser.Scene` at module evaluation, so a truly empty module cannot be evaluated;
// the stub provides only that base class (no game, scene lifecycle, renderer, DOM or keyboard). Every *.css import is an
// empty module (Node cannot parse CSS; tsx handles the TypeScript). No value export of the stub is used by any method this
// witness calls.
const PHASER = "data:text/javascript;base64," + Buffer.from(
  "const Scene = class Scene {};\n" +
  "export default { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } };\n",
).toString("base64");
const EMPTY = "data:text/javascript,export default {};";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "phaser") return { shortCircuit: true, url: PHASER };
  if (specifier.endsWith(".css")) return { shortCircuit: true, url: EMPTY };
  return nextResolve(specifier, context);
}
