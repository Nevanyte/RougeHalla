// Deterministic Node ESM loader for this source-only witness. Every *.css import is an empty module (Node cannot parse
// CSS; tsx handles the TypeScript). "phaser" is replaced by a declared minimal base-class module because client modules
// import it at module evaluation; no game, scene lifecycle, renderer, DOM or keyboard is provided by the stub. No value
// export of the stub is used by any method this witness calls.
const PHASER = "data:text/javascript;base64," + Buffer.from(
  "const Scene = class Scene {};\n" +
  "export default { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: {}, Input: {} };\n",
).toString("base64");
const EMPTY = "data:text/javascript,export default {};";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "phaser") return { shortCircuit: true, url: PHASER };
  if (specifier.endsWith(".css")) return { shortCircuit: true, url: EMPTY };
  return nextResolve(specifier, context);
}
