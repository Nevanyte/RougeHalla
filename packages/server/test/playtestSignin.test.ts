// `npm run playtest:signin` (scripts/playtest-signin.mjs): sign-in links for the callsigns in a REAL profile file written
// by the profile store, the address file the playtest launcher leaves next to it, and that a link it prints is one the
// client's own parser accepts (the token stays in the fragment, the passcode in the query). The command only reads.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROFILE_RE } from "@raid/shared";
import { parseSignIn } from "../../client/src/net/signin";
import { JsonProfileStore } from "../src/persistence/ProfileStore";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

interface Result { out: string[]; err: string[]; code: number }
interface LinkInfo { url: string; port: number; pid: number; passcode: string | null }
interface SigninModule {
  PROFILE_RE: RegExp;
  KEY_RE: RegExp;
  buildSignInLink(a: { url: string; name: string; token: string; passcode?: string }): string;
  run(argv: string[], env?: Record<string, string | undefined>): Result;
}
interface LinkModule {
  linkFilePath(stash: string): string;
  writeLinkFile(stash: string, info: LinkInfo): void;
  readLinkFile(stash: string): (LinkInfo & { live: boolean }) | null;
  removeLinkFile(stash: string, pid?: number): void;
  stashFileFrom(env: Record<string, string | undefined>): string;
}

// A variable specifier: these are plain Node scripts outside every tsconfig.
const load = <T>(file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(SCRIPTS, file)).href) as Promise<T>;

let dir = "";
let stash = "";
let signin: SigninModule;
let link: LinkModule;
const tokens: Record<string, string> = {};

/** A profile file as the server writes it: through the store itself. */
async function seedProfiles(names: string[]): Promise<void> {
  const store = new JsonProfileStore(stash);
  for (const name of names) tokens[name] = store.claim(name).token;
  await store.close();
}

const env = (extra: Record<string, string> = {}) => ({ STASH_FILE: stash, ...extra });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "signin-"));
  stash = path.join(dir, "profiles.json");
  signin = await load<SigninModule>("playtest-signin.mjs");
  link = await load<LinkModule>("playtestLink.mjs");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the link", () => {
  it("is a link the client accepts: callsign and passcode in the query, the token only in the fragment", () => {
    const url = signin.buildSignInLink({ url: "https://abc-def.trycloudflare.com", name: "Amy_01-x", token: "a1b2/c3+d4=", passcode: "pass word&x" });
    const u = new URL(url);
    expect(u.origin).toBe("https://abc-def.trycloudflare.com");
    expect(u.searchParams.get("profile")).toBe("Amy_01-x");
    expect(u.searchParams.get("code")).toBe("pass word&x");
    expect(u.search).not.toContain("a1b2");
    expect(parseSignIn(u.search, u.hash)).toEqual({ name: "Amy_01-x", key: "a1b2/c3+d4=" });
  });

  it("has no ?code= without a passcode", () => {
    const u = new URL(signin.buildSignInLink({ url: "http://localhost:2567", name: "amy", token: "tok" }));
    expect(u.search).toBe("?profile=amy");
    expect(u.hash).toBe("#key=tok");
  });

  it("uses the same callsign and key rules as the server and the client", () => {
    expect(signin.PROFILE_RE.source).toBe(PROFILE_RE.source);
    expect(signin.KEY_RE.test("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(true);
    expect(parseSignIn("?profile=amy", `#key=${"k".repeat(128)}`)).not.toBeNull();
    expect(signin.KEY_RE.test("k".repeat(128))).toBe(true);
    expect(signin.KEY_RE.test("k".repeat(129))).toBe(false);
    expect(parseSignIn("?profile=amy", `#key=${"k".repeat(129)}`)).toBeNull();
  });
});

describe("npm run playtest:signin", () => {
  it("prints one callsign's link on its own, from the profile file and --url", async () => {
    await seedProfiles(["amy", "bob"]);
    const r = signin.run(["amy", "--url", "http://localhost:2671"], env());
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`http://localhost:2671/?profile=amy#key=${tokens.amy}`]);
    expect(r.err.join("\n")).toMatch(/password/i);
  });

  it("--all prints one 'name  link' line per callsign, sorted", async () => {
    await seedProfiles(["zed", "Amy", "bob"]);
    const r = signin.run(["--all", "--url=https://x.trycloudflare.com/"], env());
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      `Amy  https://x.trycloudflare.com/?profile=Amy#key=${tokens.Amy}`,
      `bob  https://x.trycloudflare.com/?profile=bob#key=${tokens.bob}`,
      `zed  https://x.trycloudflare.com/?profile=zed#key=${tokens.zed}`,
    ]);
  });

  it("several callsigns print as lines; a name the file lacks is reported and fails the command, the rest still print", async () => {
    await seedProfiles(["amy", "bob"]);
    const r = signin.run(["amy", "Bob", "nobody", "--url", "http://localhost:2671"], env());
    expect(r.code).toBe(1);
    expect(r.out).toEqual([`amy  http://localhost:2671/?profile=amy#key=${tokens.amy}`]);
    expect(r.err.join("\n")).toMatch(/no callsign "Bob".*did you mean "bob"/);
    expect(r.err.join("\n")).toMatch(/no callsign "nobody"/);
  });

  it("one callsign the file lacks prints no link and fails", async () => {
    await seedProfiles(["amy"]);
    const r = signin.run(["nobody", "--url", "http://localhost:2671"], env());
    expect(r.code).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.err.join("\n")).toMatch(/no callsign "nobody"/);
  });

  it("reads the file and nothing else: it is not rewritten and no lock appears", async () => {
    await seedProfiles(["amy"]);
    const before = fs.readFileSync(stash, "utf8");
    const mtime = fs.statSync(stash).mtimeMs;
    signin.run(["--all", "--url", "http://localhost:2671"], env());
    expect(fs.readFileSync(stash, "utf8")).toBe(before);
    expect(fs.statSync(stash).mtimeMs).toBe(mtime);
    expect(fs.readdirSync(dir)).toEqual(["profiles.json"]);
  });

  it("takes the address, and the passcode, of the running playtest when it is not told", async () => {
    await seedProfiles(["amy"]);
    link.writeLinkFile(stash, { url: "https://live-one.trycloudflare.com", port: 2567, pid: process.pid, passcode: "open-sesame" });
    const r = signin.run(["amy"], env());
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`https://live-one.trycloudflare.com/?profile=amy&code=open-sesame#key=${tokens.amy}`]);
    // --url wins, and does not borrow the other playtest's passcode; the environment's passcode does go in.
    expect(signin.run(["amy", "--url", "http://localhost:2671"], env()).out[0]).toBe(`http://localhost:2671/?profile=amy#key=${tokens.amy}`);
    expect(signin.run(["amy"], env({ PLAYTEST_PASSCODE: "mine" })).out[0]).toContain("&code=mine#key=");
    // Pasting the banner's share link whole works too.
    expect(signin.run(["amy", "--url", "https://x.trycloudflare.com/?code=from-banner"], env()).out[0]).toContain("&code=from-banner#key=");
  });

  it("refuses an address from a playtest that is no longer running, or none at all", async () => {
    await seedProfiles(["amy"]);
    const none = signin.run(["amy"], env());
    expect(none.code).toBe(1);
    expect(none.out).toEqual([]);
    expect(none.err.join("\n")).toMatch(/no public address on record/);

    const dead = spawnSync(process.execPath, ["-e", "0"]);
    link.writeLinkFile(stash, { url: "https://dead-one.trycloudflare.com", port: 2567, pid: dead.pid!, passcode: null });
    const r = signin.run(["amy"], env());
    expect(r.code).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.err.join("\n")).toMatch(/recorded https:\/\/dead-one\.trycloudflare\.com is no longer running/);
  });

  it("explains a missing profile file, a bad address and a misuse", async () => {
    const missing = signin.run(["amy", "--url", "http://localhost:2671"], env());
    expect(missing.code).toBe(1);
    expect(missing.err.join("\n")).toMatch(/no profile file at .*profiles\.json.*STASH_FILE/);

    await seedProfiles(["amy"]);
    expect(signin.run(["amy", "--url", "ftp://x"], env()).code).toBe(1);
    expect(signin.run([], env()).code).toBe(2);
    expect(signin.run(["--all", "amy"], env()).code).toBe(2);
    expect(signin.run(["--bogus"], env()).code).toBe(2);
    expect(signin.run(["amy", "--url"], env()).code).toBe(2);
    expect(signin.run(["--help"], env()).code).toBe(0);
  });

  it("skips a profile whose token cannot ride in a link rather than printing a broken one", () => {
    fs.writeFileSync(stash, JSON.stringify({ version: 2, profiles: {
      ok: { name: "ok", token: "good-token" },
      bad: { name: "bad", token: "has a space" },
      "x": { name: "x", token: "short-name" },
    } }));
    const r = signin.run(["--all", "--url", "http://localhost:2671"], env());
    expect(r.out).toEqual(["ok  http://localhost:2671/?profile=ok#key=good-token"]);
  });

  it("runs as a script with the npm-style arguments and exits 0", async () => {
    await seedProfiles(["amy"]);
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, "playtest-signin.mjs"), "amy", "--url", "http://localhost:2671"], {
      env: { ...process.env, STASH_FILE: stash }, encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`http://localhost:2671/?profile=amy#key=${tokens.amy}`);
    const bad = spawnSync(process.execPath, [path.join(SCRIPTS, "playtest-signin.mjs")], { env: { ...process.env, STASH_FILE: stash }, encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/usage:/);
  });
});

describe("the address file", () => {
  it("is written next to the profile file for this user only, read back, and removed by its own launcher only", () => {
    expect(link.linkFilePath(stash)).toBe(`${stash}.link.json`);
    expect(link.readLinkFile(stash)).toBeNull();
    link.writeLinkFile(stash, { url: "https://a.trycloudflare.com", port: 2600, pid: process.pid, passcode: "pw" });
    expect(fs.statSync(link.linkFilePath(stash)).mode & 0o077).toBe(0);
    expect(link.readLinkFile(stash)).toMatchObject({ url: "https://a.trycloudflare.com", port: 2600, pid: process.pid, passcode: "pw", live: true });
    link.removeLinkFile(stash, process.pid + 1); // someone else's
    expect(link.readLinkFile(stash)).not.toBeNull();
    link.removeLinkFile(stash);
    expect(link.readLinkFile(stash)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
    link.removeLinkFile(stash); // nothing there: no throw
  });

  it("is ignored when it is not a link file", () => {
    fs.writeFileSync(link.linkFilePath(stash), "{not json");
    expect(link.readLinkFile(stash)).toBeNull();
    fs.writeFileSync(link.linkFilePath(stash), JSON.stringify({ pid: 1 }));
    expect(link.readLinkFile(stash)).toBeNull();
  });

  it("follows STASH_FILE, else the playtest default", () => {
    expect(link.stashFileFrom({ STASH_FILE: "/x/y.json" })).toBe("/x/y.json");
    expect(link.stashFileFrom({})).toBe(path.join(os.homedir(), ".rougehalla", "playtest-profiles.json"));
  });
});
