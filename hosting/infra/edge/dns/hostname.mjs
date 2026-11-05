// Placement id -> game hostname. Mirrors crates/rh-placement/src/hostname.rs; both are tested against
// hosting/placement/vectors/hostnames.json. `<region>-<token>.<zone>`: one DNS label, covered by one `*.<zone>` certificate.
import { createHash } from "node:crypto";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

export function token(placementId) {
  const digest = createHash("sha256").update(placementId, "utf8").digest();
  let out = "";
  let buf = 0;
  let bits = 0;
  for (const b of digest) {
    buf = ((buf << 8) | b) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 12) {
      bits -= 5;
      out += B32[(buf >>> bits) & 31];
    }
    if (out.length === 12) break;
  }
  return out;
}

export function regionOk(region) {
  return typeof region === "string" && /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(region);
}

export function gameHostname(region, placementId, zone) {
  if (typeof placementId !== "string" || placementId === "") throw new Error("placement id is required");
  if (!regionOk(region)) throw new Error(`region ${JSON.stringify(region)} is not usable in a DNS label`);
  if (!zone || zone.startsWith(".") || zone.startsWith("*") || zone.endsWith(".")) throw new Error("zone must be a bare domain such as g.rougehalla.com");
  return `${region}-${token(placementId)}.${zone}`;
}

/** True when `name` has the shape this module produces under `zone` (what the janitor may delete; nothing else). */
export function isGameHostname(name, zone) {
  if (!name.endsWith(`.${zone}`)) return false;
  const label = name.slice(0, -(zone.length + 1));
  return /^[a-z0-9]+(-[a-z0-9]+)*-[a-z2-7]{12}$/.test(label) && !label.includes(".");
}
