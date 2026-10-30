const PROFILE_KEY = "profiles/current.json";
export const PROFILE_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

type SnapshotValue = { version: 2; profiles: Record<string, unknown> };

function response(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function authorized(request: Request, token: string | undefined): boolean {
  if (!token || token.length < 32) return false;
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return constantTimeEqual(auth.slice(7), token);
}

function validSnapshot(value: unknown): value is SnapshotValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 2 || !snapshot.profiles || typeof snapshot.profiles !== "object" || Array.isArray(snapshot.profiles)) return false;
  for (const [name, profile] of Object.entries(snapshot.profiles)) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
    const entry = profile as Record<string, unknown>;
    if (entry.name !== name || typeof entry.token !== "string" || entry.token.length === 0) return false;
  }
  return true;
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get("Content-Length");
  if (length && Number(length) > PROFILE_SNAPSHOT_MAX_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PROFILE_SNAPSHOT_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function putCondition(request: Request): Headers | null {
  const ifMatch = request.headers.get("If-Match");
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifMatch !== null && ifNoneMatch !== null) return null;
  if (ifMatch !== null) {
    const tag = ifMatch.trim();
    // A single strong ETag is the only accepted overwrite token; reject wildcards, weak tags and lists.
    if (!/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(tag)) return null;
    return new Headers({ "If-Match": tag });
  }
  if (ifNoneMatch?.trim() === "*") return new Headers({ "If-None-Match": "*" });
  return null;
}

export async function handleProfileSnapshot(
  request: Request,
  bucket: Pick<R2Bucket, "get" | "put">,
  token: string | undefined,
): Promise<Response> {
  if (!authorized(request, token)) return response(401, "unauthorized");
  if (request.method === "GET") {
    const object = await bucket.get(PROFILE_KEY);
    if (!object) return response(404, "snapshot not found");
    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json", "Cache-Control": "no-store, no-transform",
        ETag: object.httpEtag, "X-Profile-Snapshot-Etag": object.httpEtag,
      },
    });
  }
  if (request.method !== "PUT") return new Response("method not allowed", {
    status: 405,
    headers: { Allow: "GET, PUT", "Cache-Control": "no-store" },
  });

  const condition = putCondition(request);
  if (!condition) return response(428, "If-Match or If-None-Match: * required");
  const body = await readBody(request);
  if (!body) return response(413, "snapshot too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return response(400, "invalid JSON");
  }
  if (!validSnapshot(parsed)) return response(400, "invalid profile snapshot");

  const stored = await bucket.put(PROFILE_KEY, body, {
    onlyIf: condition,
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  if (!stored) return response(412, "snapshot changed");
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, no-transform", ETag: stored.httpEtag,
      "X-Profile-Snapshot-Etag": stored.httpEtag,
    },
  });
}
