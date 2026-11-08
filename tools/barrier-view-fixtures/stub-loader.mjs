// Deterministic Node ESM loader for this witness: "phaser" becomes an empty module (no value export is used at
// module scope by the imported render modules; only type positions name it) and every *.css becomes an empty module.
const EMPTY = "data:text/javascript,export default {};";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "phaser") return { shortCircuit: true, url: EMPTY };
  if (specifier.endsWith(".css")) return { shortCircuit: true, url: EMPTY };
  return nextResolve(specifier, context);
}
