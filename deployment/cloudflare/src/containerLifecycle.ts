export interface ImageManagedContainer {
  readonly running: boolean;
  inspect(): Promise<{ image: string; labels?: Record<string, string> } | null>;
  signal(signal: number): void;
  monitor(): Promise<void>;
}

/** Container labels have a 64-byte limit, including when a data import forces a restart. */
export async function containerReleaseLabel(build: string, epoch?: string): Promise<string> {
  if (!epoch) return build;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${build}:${epoch}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Readiness proves the bytes running in Node, independently of container startup metadata. */
export function isReadyServerBuild(response: Pick<Response, "ok" | "headers">, expectedBuild: string): boolean {
  return response.ok && response.headers.get("X-Rougehalla-Server-Build") === expectedBuild;
}

/**
 * Starts a stopped container or drains a running old image/release before replacing it. A failed or
 * unobservable shutdown is an error: starting over a live process would create two writers.
 */
export async function ensureContainerImage(
  container: ImageManagedContainer,
  targetImage: string,
  startCurrentImage: () => void,
  waitForExit: () => Promise<void>,
  stopTimeoutMs: number,
  requestGracefulStop: () => void = () => container.signal(15),
  expectedBuild?: string,
): Promise<void> {
  if (!container.running) {
    startCurrentImage();
    return;
  }

  const current = await container.inspect();
  if (!current?.image) throw new Error("Cannot verify the image of the running game container");
  if (current.image === targetImage && (expectedBuild === undefined || current.labels?.serverBuild === expectedBuild)) return;

  // Cloudflare's monitor settles when the main container process exits (including a non-zero exit).
  // Do not force-destroy on timeout: the server may still be flushing the profile snapshot.
  const exit = waitForExit().then(() => true, () => true);
  try {
    requestGracefulStop(); // SIGTERM lets Node and ProfileStore flush and release their file lock.
  } catch {
    // A process can exit between inspect() and signal(). Its monitor will settle; if it is still
    // running after the wait, fail closed instead of starting a second process.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, stopTimeoutMs)); });
  let exited = false;
  try {
    exited = await Promise.race([exit, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!exited || container.running) throw new Error("The previous game container did not stop cleanly");
  startCurrentImage();
}
