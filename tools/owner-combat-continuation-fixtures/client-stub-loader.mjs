// Minimal ESM loader for the human-projection rig: every *.css import becomes an empty module and "phaser" becomes an
// empty default export. The client modules keep their real projection code; only the presentation dependencies they never
// execute in these probes (rendering, styling) are stubbed. No projection method is stubbed.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  if (specifier === "phaser") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
