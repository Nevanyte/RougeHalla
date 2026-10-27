#!/usr/bin/env node
// Prints sign-in links for the callsigns in the playtest's profile file, for friends who come back after the tunnel got
// a new address. A browser keeps a callsign's token per address (localStorage is per origin), and a quick tunnel's
// address changes at every start, so the old token stays behind and the callsign reads as taken. The link carries the
// token in the URL fragment (`#key=`), which no server or tunnel ever sees; the page stores it and removes it from the
// address bar (packages/client/src/net/signin.ts). Plain Node, no dependencies; it only READS the profile file.
//
//   npm run playtest:signin -- <callsign> [<callsign>...] [--url <address>]
//   npm run playtest:signin -- --all [--url <address>]
//
// The address is the one `npm run playtest` recorded next to the profile file; `--url` overrides it. Environment:
// STASH_FILE (the profile file, as for the server), PLAYTEST_PASSCODE (put in the link as ?code=, when the playtest asks
// for one; the running playtest's own is used otherwise).
//
// A link IS the callsign's password: send each one privately to its owner.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { readLinkFile, stashFileFrom } from "./playtestLink.mjs";

/** The server's PROFILE_RE (packages/shared/src/messages.ts); a test keeps the two equal. */
export const PROFILE_RE = /^[A-Za-z0-9_-]{2,16}$/;
/** What the client accepts as a key (net/signin.ts): a token goes into an HTTP header. */
export const KEY_RE = /^[\x21-\x7e]{1,128}$/;

const USAGE = `usage: npm run playtest:signin -- <callsign> [<callsign>...] [--url <address>]
       npm run playtest:signin -- --all [--url <address>]
  <callsign>    print that callsign's sign-in link (one callsign: just the link, to copy)
  --all         print one link per callsign in the profile file
  --url <addr>  the address friends open (default: the one the running playtest recorded)
Reads the profile file (STASH_FILE, default ~/.rougehalla/playtest-profiles.json) and never writes it.
The npm "--" is needed before the flags. Each link is that callsign's password: send it only to its owner.`;

/** A problem to print without a stack. `code` is the exit code: 2 for a misuse of the command, 1 for anything else. */
export class SignInError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** `<origin>/?profile=<name>[&code=<passcode>]#key=<token>`. The token stays in the fragment: it never reaches a server. */
export function buildSignInLink({ url, name, token, passcode }) {
  const query = `?profile=${encodeURIComponent(name)}${passcode ? `&code=${encodeURIComponent(passcode)}` : ""}`;
  return `${new URL(url).origin}/${query}#key=${encodeURIComponent(token)}`;
}

export function parseArgs(argv) {
  const args = { names: [], all: false, url: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === "--all") args.all = true;
    else if (flag === "--url") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (!value) throw new SignInError(`--url needs an address\n${USAGE}`, 2);
      args.url = value;
    } else if (flag === "-h" || flag === "--help") args.help = true;
    else if (arg.startsWith("-")) throw new SignInError(`unexpected argument: ${arg}\n${USAGE}`, 2);
    else args.names.push(arg);
  }
  return args;
}

/** Every callsign in the profile file with a token a link can carry, as a Map name -> token. Read-only. */
export function readProfiles(stashFile) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(stashFile, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new SignInError(`no profile file at ${stashFile}. Nobody has claimed a callsign yet, or the playtest uses another file (set STASH_FILE to it).`);
    }
    throw new SignInError(`could not read ${stashFile}: ${err.message}`);
  }
  if (!raw || typeof raw.profiles !== "object" || raw.profiles === null) throw new SignInError(`${stashFile} is not a profile file (no "profiles")`);
  const found = new Map();
  for (const [key, p] of Object.entries(raw.profiles)) {
    if (PROFILE_RE.test(key) && p && typeof p.token === "string" && KEY_RE.test(p.token)) found.set(key, p.token);
  }
  return found;
}

/** The address friends open: --url (its origin), else the one the running playtest recorded. Returns { url, passcode }. */
export function resolveTarget(args, stashFile, env) {
  let passcode = env.PLAYTEST_PASSCODE || "";
  if (args.url) {
    let u;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(args.url) ? args.url : `https://${args.url}`);
    } catch {
      throw new SignInError(`--url ${args.url} is not an address`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new SignInError(`--url needs an http or https address, not ${u.protocol}`);
    // The banner's share link carries ?code=: pasting it whole works.
    if (!passcode) passcode = u.searchParams.get("code") ?? "";
    return { url: u.origin, passcode };
  }
  const link = readLinkFile(stashFile);
  if (!link) {
    throw new SignInError(
      "no public address on record: the playtest is not running with a tunnel (or this is not its profile file).\n" +
      "Start `npm run playtest`, or pass the address friends use: --url https://....trycloudflare.com",
    );
  }
  if (!link.live) {
    throw new SignInError(
      `the playtest that recorded ${link.url} is no longer running, so that address is dead.\n` +
      "Start `npm run playtest` for a new one, or pass the address to use: --url <address>",
    );
  }
  return { url: link.url, passcode: passcode || (typeof link.passcode === "string" ? link.passcode : "") };
}

/** Runs the command; returns { out, err, code } instead of printing, so a test can check all three. */
export function run(argv, env = process.env) {
  const out = [];
  const err = [];
  try {
    const args = parseArgs(argv);
    if (args.help) return { out: [USAGE], err, code: 0 };
    if (!args.all && args.names.length === 0) throw new SignInError(`say whose link: a callsign, or --all\n${USAGE}`, 2);
    if (args.all && args.names.length > 0) throw new SignInError(`--all and callsigns together: pick one\n${USAGE}`, 2);

    const stashFile = stashFileFrom(env);
    const profiles = readProfiles(stashFile);
    const wanted = args.all ? [...profiles.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : args.names;
    const missing = wanted.filter((n) => !profiles.has(n));
    if (args.all && wanted.length === 0) throw new SignInError(`${stashFile} has no callsigns yet`);
    const { url, passcode } = resolveTarget(args, stashFile, env);

    const links = wanted.filter((n) => profiles.has(n)).map((name) => [name, buildSignInLink({ url, name, token: profiles.get(name), passcode })]);
    if (!args.all && args.names.length === 1) { for (const [, one] of links) out.push(one); }
    else for (const [name, link] of links) out.push(`${name}  ${link}`);
    if (links.length > 0) err.push("Each link is that callsign's password: send it only to its owner.");

    for (const name of missing) {
      const near = [...profiles.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
      err.push(`no callsign "${name}" in ${stashFile}${near ? ` (did you mean "${near}"? callsigns are case-sensitive)` : " (one claimed in the last second may not be saved yet)"}`);
    }
    return { out, err, code: missing.length > 0 ? 1 : 0 };
  } catch (e) {
    if (!(e instanceof SignInError)) throw e;
    err.push(e.message);
    return { out, err, code: e.code };
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const { out, err, code } = run(process.argv.slice(2));
  for (const line of out) console.log(line);
  for (const line of err) console.error(line);
  process.exitCode = code;
}
