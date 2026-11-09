// Static, host-only source closure scan for the bot-vision witness. It READS TypeScript text
// and never imports, evaluates, compiles or transforms a source module. Statements are matched
// only where an import/export keyword starts a line (the repository's formatting); the runtime
// load hook, not this scan, is the binding closure guard: any load outside the manifest refuses.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';

export const ENTRY = 'packages/server/src/bots/brain/vision.ts';
/** The only bare specifier the closure may use: the workspace package entry from packages/shared/package.json `exports["."]`. */
export const PACKAGE_ENTRIES = Object.freeze({ '@raid/shared': 'packages/shared/src/index.ts' });

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function statements(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(import|export)\b/.test(lines[i])) continue;
    const line = i + 1;
    let stmt = lines[i];
    // A brace list opened and not closed on its first line continues to the line that closes it.
    if (/^(import|export)\b[^{}]*\{[^}]*$/.test(stmt)) {
      while (i + 1 < lines.length && !/\}/.test(lines[i + 1])) stmt += '\n' + lines[++i];
      if (i + 1 < lines.length) stmt += '\n' + lines[++i];
    }
    out.push({ line, text: stmt });
  }
  return out;
}

function names(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const type = /^type\s+/.test(s);
    const body = s.replace(/^type\s+/, '');
    const [imported, local] = body.split(/\s+as\s+/).map((x) => x.trim());
    return { imported, local: local ?? imported, type };
  });
}

export function parse(text) {
  const imports = [], runtime = new Set(), types = new Set(), stars = [], reexports = [];
  for (const { line, text: s } of statements(text)) {
    let m;
    if ((m = /^import\s+type\s+[\s\S]*?from\s+['"]([^'"]+)['"]/.exec(s))) {
      imports.push({ line, spec: m[1], typeOnly: true, names: [] });
    } else if ((m = /^import\s+['"]([^'"]+)['"]/.exec(s))) {
      imports.push({ line, spec: m[1], typeOnly: false, sideEffect: true, names: [] });
    } else if ((m = /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/.exec(s))) {
      imports.push({ line, spec: m[2], typeOnly: false, namespace: m[1], names: [] });
    } else if ((m = /^import\s+(?:(\w+)\s*,?\s*)?(?:\{([\s\S]*?)\})?\s*from\s+['"]([^'"]+)['"]/.exec(s))) {
      const list = m[2] !== undefined ? names(m[2]) : [];
      if (m[1]) list.unshift({ imported: 'default', local: m[1], type: false });
      imports.push({ line, spec: m[3], typeOnly: false, names: list });
    } else if ((m = /^export\s+type\s+\{[\s\S]*?\}\s*from\s+['"]([^'"]+)['"]/.exec(s))) {
      imports.push({ line, spec: m[1], typeOnly: true, names: [] });
    } else if ((m = /^export\s+\*\s+from\s+['"]([^'"]+)['"]/.exec(s))) {
      stars.push(m[1]);
      imports.push({ line, spec: m[1], typeOnly: false, star: true, names: [] });
    } else if ((m = /^export\s+\{([\s\S]*?)\}\s*from\s+['"]([^'"]+)['"]/.exec(s))) {
      const list = names(m[1]);
      reexports.push({ spec: m[2], names: list });
      for (const n of list) (n.type ? types : runtime).add(n.local);
      imports.push({ line, spec: m[2], typeOnly: false, names: list.map((n) => ({ ...n, local: n.imported })) });
    } else if ((m = /^export\s+(?:declare\s+)?(?:interface|type)\s+(\w+)/.exec(s))) {
      types.add(m[1]);
    } else if ((m = /^export\s+(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|enum|class|function\*?|const|let|var)\s+(\w+)/.exec(s))) {
      runtime.add(m[1]);
    } else if ((m = /^export\s+\{([\s\S]*?)\}/.exec(s))) {
      for (const n of names(m[1])) (n.type ? types : runtime).add(n.local);
    } else if (/^export\s+default\b/.test(s)) {
      runtime.add('default');
    }
  }
  return { imports, runtime, types, stars, reexports };
}

export function resolveSpec(root, fromRel, spec) {
  if (Object.hasOwn(PACKAGE_ENTRIES, spec)) return PACKAGE_ENTRIES[spec];
  if (!spec.startsWith('.')) return null;
  const base = resolve(root, dirname(fromRel), spec);
  for (const candidate of [base, `${base}.ts`, `${base}${sep}index.ts`]) {
    if (candidate.endsWith('.ts') && existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(root, candidate).split(sep).join('/');
    }
  }
  return null;
}

/** Breadth-first runtime closure from ENTRY. Returns files in discovery order plus problems. */
export function scan(root) {
  const files = [], parsed = new Map(), problems = [], edges = [];
  const queue = [ENTRY];
  const seen = new Set(queue);
  while (queue.length) {
    const rel = queue.shift();
    const bytes = readFileSync(resolve(root, rel));
    const info = parse(bytes.toString('utf8'));
    parsed.set(rel, info);
    files.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) });
    for (const imp of info.imports) {
      if (imp.typeOnly) continue;
      const target = resolveSpec(root, rel, imp.spec);
      if (!target) { problems.push(`${rel}:${imp.line}: unresolved runtime specifier ${JSON.stringify(imp.spec)}`); continue; }
      edges.push({ from: rel, spec: imp.spec, to: target });
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  // A named value import without `type` must name a runtime export: Node's type stripping keeps it.
  const runtimeOf = (rel, stack = new Set()) => {
    if (stack.has(rel)) return new Set();
    stack.add(rel);
    const info = parsed.get(rel);
    const out = new Set(info.runtime);
    for (const star of info.stars) {
      const target = resolveSpec(root, rel, star);
      if (target && parsed.has(target)) for (const n of runtimeOf(target, stack)) if (n !== 'default') out.add(n);
    }
    return out;
  };
  for (const [rel, info] of parsed) {
    for (const imp of info.imports) {
      if (imp.typeOnly || imp.star) continue;
      const target = resolveSpec(root, rel, imp.spec);
      if (!target || !parsed.has(target)) continue;
      const exported = runtimeOf(target);
      for (const n of imp.names) {
        if (n.type) continue;
        if (!exported.has(n.imported)) problems.push(`${rel}:${imp.line}: value import ${JSON.stringify(n.imported)} from ${imp.spec} has no static runtime export (type-only names need \`type\`)`);
      }
    }
  }
  return { files, edges, problems };
}
