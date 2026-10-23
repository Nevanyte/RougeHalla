// CLI: launches N headless bots against a running server and prints how each raid ended.
//   npm run bots -- <count> [--url http://localhost:2567] [--prefix bot] [--loop] [--verbose]
// Exits non-zero when a bot failed to play (join refused, connection lost, timeout). With --loop every
// bot queues into a new raid as soon as its last one is over, until the process is stopped.
//
// A profile name is claimed once and then needs its token, so tokens are remembered per server in
// data/bot-tokens.json (next to the stash file, not committed). Running the CLI again reuses the same
// bot profiles instead of failing with "taken by someone else". A token is saved the moment the server
// issues it, so a join that fails afterwards does not orphan the name. The file is replaced atomically,
// and one that cannot be parsed is left alone (with a warning) rather than overwritten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_RE, SERVER_PORT } from "@raid/shared";
import { BotClient, type BotRun } from "./BotClient";

const USAGE = "usage: npm run bots -- <count> [--url http://localhost:2567] [--prefix bot] [--loop] [--verbose]";
const TOKEN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/bot-tokens.json");

interface Args { count: number; url: string; prefix: string; loop: boolean; verbose: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { count: NaN, url: `http://localhost:${SERVER_PORT}`, prefix: "bot", loop: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    // `--url --loop` means a forgotten value, not a server called "--loop".
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) fail(`${flag} needs a value`);
      return v;
    };
    const toggle = (): true => {
      if (inline !== undefined) fail(`${flag} does not take a value`);
      return true;
    };
    if (flag === "--url") args.url = value();
    else if (flag === "--prefix") args.prefix = value();
    else if (flag === "--loop") args.loop = toggle();
    else if (flag === "--verbose") args.verbose = toggle();
    else if (/^\d+$/.test(arg) && Number.isNaN(args.count)) args.count = Number(arg);
    else fail(`unexpected argument: ${arg}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 64) fail("<count> must be a number from 1 to 64");
  // The names are prefix + 1..count; their length only grows with the number, so the two ends cover them all.
  for (const n of new Set([1, args.count])) {
    const name = `${args.prefix}${n}`;
    if (!PROFILE_RE.test(name)) fail(`--prefix "${args.prefix}" makes "${name}", which is not a valid profile name (2-16 letters, digits, _ or -)`);
  }
  return args;
}

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Each distinct problem once: a --loop run would otherwise repeat it for every bot and every raid. */
const warned = new Set<string>();
function warn(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[bots] ${message}`);
}

/**
 * The saved tokens: empty when there is no file yet, null when there is one that cannot be trusted
 * (unreadable, not JSON, not an object). Null must never be turned into "empty" and written back,
 * or one bad byte would erase every token in the file.
 */
function readTokens(): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(TOKEN_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    warn(`cannot read ${TOKEN_FILE} (${errText(err)}); bot tokens will not be remembered`);
    return null;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not a JSON object");
    return raw as Record<string, unknown>;
  } catch (err) {
    warn(`${TOKEN_FILE} is unusable (${errText(err)}); leaving it as it is, so bot tokens will not be remembered until it is fixed or deleted`);
    return null;
  }
}

function savedToken(key: string): string | undefined {
  const token = readTokens()?.[key];
  return typeof token === "string" && token !== "" ? token : undefined;
}

/** Never throws: a token we cannot save only costs the next run a "taken" error, not this one its raid. */
function rememberToken(key: string, token: string): void {
  if (token === "") return;
  const tokens = readTokens();
  if (!tokens || tokens[key] === token) return;
  tokens[key] = token;
  // Written beside the target and renamed over it, so a crash mid-write leaves the old file intact.
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, TOKEN_FILE);
  } catch (err) {
    warn(`could not save the token for ${key} to ${TOKEN_FILE}: ${errText(err)}`);
    try { fs.rmSync(tmp, { force: true }); } catch { /* the temp file is only litter */ }
  }
}

function formatRun({ profile, result, error, abandoned }: BotRun): string {
  if (abandoned) return `${profile.padEnd(10)} ABANDONED  left the raid on purpose`;
  if (!result) return `${profile.padEnd(10)} ERROR      ${error ?? "no result"}`;
  const by = result.killedBy ? `  by ${result.killedBy}` : "";
  return `${profile.padEnd(10)} ${result.outcome.padEnd(10)} kills ${result.kills}  extracted ${result.extracted.length}  lost ${result.lost.length}  ${result.durationSec}s${by}`;
}

async function playOnce(args: Args, profile: string): Promise<BotRun> {
  const key = `${args.url}/${profile}`;
  // Saved the moment the server hands it out, before the join that can still fail.
  const bot = new BotClient({ verbose: args.verbose, onToken: (token) => rememberToken(key, token) });
  try {
    await bot.connect(args.url, profile, savedToken(key));
  } catch (err) {
    return { profile, result: null, error: errText(err) };
  }
  return bot.run();
}

/** Plays one bot (once, or forever with --loop). Returns how many of its runs failed. */
async function runBot(args: Args, profile: string): Promise<number> {
  let failures = 0;
  do {
    const run = await playOnce(args, profile);
    console.log(formatRun(run));
    if (run.error) {
      failures++;
      if (args.loop) await new Promise((r) => setTimeout(r, 2000)); // don't hammer a server that is down
    }
  } while (args.loop);
  return failures;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const names = Array.from({ length: args.count }, (_, i) => `${args.prefix}${i + 1}`);
  console.log(`${names.length} bot(s) -> ${args.url}${args.loop ? " (looping, Ctrl-C to stop)" : ""}`);
  const failures = (await Promise.all(names.map((name) => runBot(args, name)))).reduce((a, b) => a + b, 0);
  process.exitCode = failures > 0 ? 1 : 0;
  setTimeout(() => process.exit(), 2000).unref(); // never hang on a socket the SDK forgot
}

void main();
