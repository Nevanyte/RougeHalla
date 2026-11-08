// Deterministic Node ESM loader for the client modules this witness imports: every *.css resolves to an empty
// module (Node cannot parse CSS), and every other specifier is resolved normally (tsx's hooks handle TypeScript).
const EMPTY_CSS = "data:text/javascript,export default {}";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) return { shortCircuit: true, url: EMPTY_CSS };
  return nextResolve(specifier, context);
}
