// CLI: launches N headless bots against a running server and prints how each run ended. Every bot is the human-like brain
// (bots/brain/, docs/BOTS.md) behind the network adapter (BotClient): it sees only what a player's screen shows, clicks with
// reaction times, scatter and misses, and sends only what the game client sends. It locks a foe and the server chases and
// attacks it (the LoL-style controls), swaps slot and picks up a second weapon (a mob's drop too), farms the regional mobs
// early on and while no player is close, and hunts players otherwise and after the teleport into the coliseum, so a run ends
// with a last one standing (or a draw). The server runs mobs unless MOBS=0.
//   npm run bots -- <count> [--url http://localhost:2567] [--prefix bot] [--faction rotate] [--tier hard] [--persona random]
//                   [--seed N] [--stats <file>] [--loop] [--verbose]
// Exits non-zero when a bot failed to play (join refused, connection lost, timeout). With --loop every
// bot queues into a new run as soon as its last one is over, until the process is stopped.
// The server runs the mobs by default; start it with MOBS=0 (or MOBS=false) to leave them out, and the bots simply hunt
// each other (the result lines show the GV the mobs paid: `mobs N`). The server also fills a lobby with bots of its own
// (BOTS_FILL_TO, default 6); start it with BOTS_FILL_TO=0 to get only the bots launched here.
//
// A profile name is claimed once and then needs its token, so tokens are remembered per server in
// data/bot-tokens.json (next to the profile file, not committed). Running the CLI again reuses the same
// bot profiles instead of failing with "taken by someone else". A token is saved the moment the server
// issues it, so a join that fails afterwards does not orphan the name. The file is replaced atomically,
// and one that cannot be parsed is left alone (with a warning) rather than overwritten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACTION_IDS, PROFILE_RE, SERVER_PORT, isFactionId, mulberry32, type FactionId } from "@raid/shared";
import { BotClient, type BotRun } from "./BotClient";
import { BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS, type PersonaId, type TierId } from "./brain/types";

const USAGE = [
  "usage: npm run bots -- <count> [--url http://localhost:2567] [--prefix bot] [--faction <id|rotate|random>] [--tier <id|mix>]",
  "                        [--persona <id|random>] [--seed <n>] [--stats <file>] [--loop] [--verbose]",
  "  <count>     bots to launch, 1-64; they queue into the same lobby, farm the mobs and hunt each other",
  "  --url       server to join (default http://localhost:2567)",
  "  --prefix    profile names are <prefix>1..<count> (default bot)",
  "  --faction   the faction each bot asks for at join (default rotate)",
  `              ${FACTION_IDS.join(" | ")}   every bot asks for that one`,
  `              rotate   bot i asks for faction i mod ${FACTION_IDS.length}, so five bots make a lobby with one of each`,
  "              random   every bot rolls again before each run",
  "  --tier      how well the bots play (default hard)",
  `              ${TIER_IDS.join(" | ")}   every bot plays that tier`,
  `              mix      every bot rolls a tier before each run: ${TIER_IDS.map((t) => `${t} ${Math.round(BOT_FILL_DEFAULTS.tierMix[t] * 100)}%`).join(", ")}`,
  "  --persona   what the bots play for (default random: each bot rolls one before each run)",
  `              ${PERSONA_IDS.join(" | ")}   every bot plays that persona`,
  "  --seed      seed of the bots' random choices: the same seed against the same lobby plays the same (default: random)",
  "  --stats     a learning file: the bots read what earlier runs taught them and write what this one did (default: no learning)",
  "  --loop      queue again after every run until stopped (Ctrl-C)",
  "  --verbose   log every bot's decisions",
  "",
  "The server fills its lobbies with bots of its own (BOTS_FILL_TO, default 6): start it with BOTS_FILL_TO=0 to play only against the bots launched here.",
].join("\n");
const TOKEN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/bot-tokens.json");

type FactionChoice = FactionId | "rotate" | "random";
type TierChoice = TierId | "mix";
type PersonaChoice = PersonaId | "random";

interface Args {
  count: number; url: string; prefix: string; faction: FactionChoice; tier: TierChoice; persona: PersonaChoice;
  seed: number | undefined; stats: string | undefined; loop: boolean; verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: NaN, url: `http://localhost:${SERVER_PORT}`, prefix: "bot", faction: "rotate", tier: "hard", persona: "random",
    seed: undefined, stats: undefined, loop: false, verbose: false,
  };
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
    else if (flag === "--faction") {
      const v = value();
      if (v !== "rotate" && v !== "random" && !isFactionId(v)) fail(`--faction "${v}" is not one of: ${FACTION_IDS.join(", ")}, rotate, random`);
      args.faction = v;
    } else if (flag === "--tier") {
      const v = value();
      if (v !== "mix" && !(TIER_IDS as readonly string[]).includes(v)) fail(`--tier "${v}" is not one of: ${TIER_IDS.join(", ")}, mix`);
      args.tier = v as TierChoice;
    } else if (flag === "--persona") {
      const v = value();
      if (v !== "random" && !(PERSONA_IDS as readonly string[]).includes(v)) fail(`--persona "${v}" is not one of: ${PERSONA_IDS.join(", ")}, random`);
      args.persona = v as PersonaChoice;
    } else if (flag === "--seed") {
      const v = value();
      if (!/^\d+$/.test(v) || Number(v) > 0xffffffff) fail(`--seed "${v}" is not a whole number from 0 to 4294967295`);
      args.seed = Number(v);
    } else if (flag === "--stats") args.stats = path.resolve(value());
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

/** Each distinct problem once: a --loop run would otherwise repeat it for every bot and every run. */
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

/** Never throws: a token we cannot save only costs the next run a "taken" error, not this one its run. */
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

/** What one run of one bot is set up as: asked of the server (the faction) and handed to the brain (the rest). */
interface Style { faction: FactionId; tier: TierId; persona: PersonaId | undefined; seed: number }

function formatRun({ profile, result, error, abandoned }: BotRun, faction: FactionId, brain: string): string {
  if (abandoned) return `${profile.padEnd(10)} ABANDONED  left the run on purpose`;
  if (!result) return `${profile.padEnd(10)} ERROR      ${error ?? "no result"}`;
  const by = result.killedBy ? `  by ${result.killedBy}` : "";
  const { kills, mobs, bounty, quest, win, total } = result.gv;
  const withheld = result.winBonusWithheld ? " withheld" : "";
  const gv = `GV +${total} (kills ${kills}, mobs ${mobs}, bounty ${bounty}, quests ${quest ?? 0}, win ${win}${withheld})`;
  return `${profile.padEnd(10)} ${faction.padEnd(9)} ${brain.padEnd(18)} ${result.outcome.padEnd(10)} place ${result.place}/${result.players}  kills ${result.kills}  ${gv}  ${result.durationSec}s${by}`;
}

/**
 * Bot `index`'s setup for its run number `round`. With --seed every roll comes from a stream of its own for that bot and run, so
 * the same command plays the same line-up; without it Math.random is fine here: this is tooling, not shared sim code.
 */
function styleFor(args: Args, index: number, round: number): Style {
  const rng = args.seed === undefined
    ? Math.random
    : mulberry32((args.seed + Math.imul(index + 1, 0x9e3779b1) + Math.imul(round, 0x85ebca6b)) >>> 0);
  const faction = args.faction === "rotate" ? FACTION_IDS[index % FACTION_IDS.length]!
    : args.faction === "random" ? FACTION_IDS[Math.floor(rng() * FACTION_IDS.length)]!
    : args.faction;
  let tier: TierId;
  if (args.tier === "mix") {
    // The same shares as the server's own fill bots.
    let roll = rng() * TIER_IDS.reduce((sum, t) => sum + BOT_FILL_DEFAULTS.tierMix[t], 0);
    tier = TIER_IDS.find((t) => (roll -= BOT_FILL_DEFAULTS.tierMix[t]) < 0) ?? "hard";
  } else tier = args.tier;
  // A persona left to the client is drawn from the seed.
  const persona = args.persona === "random" ? undefined : args.persona;
  return { faction, tier, persona, seed: Math.floor(rng() * 0x100000000) >>> 0 };
}

async function playOnce(args: Args, profile: string, style: Style): Promise<{ run: BotRun; brain: string }> {
  const key = `${args.url}/${profile}`;
  // Saved the moment the server hands it out, before the join that can still fail.
  const bot = new BotClient({
    verbose: args.verbose, faction: style.faction, tier: style.tier, seed: style.seed,
    ...(style.persona ? { persona: style.persona } : {}),
    ...(args.stats ? { statsFile: args.stats } : {}),
    onToken: (token) => rememberToken(key, token),
  });
  try {
    await bot.connect(args.url, profile, savedToken(key));
  } catch (err) {
    return { run: { profile, result: null, error: errText(err) }, brain: style.tier };
  }
  return { run: await bot.run(), brain: `${bot.tierId}/${bot.personaId}` };
}

/** Plays one bot (once, or forever with --loop). Returns how many of its runs failed. */
async function runBot(args: Args, profile: string, index: number): Promise<number> {
  let failures = 0;
  for (let round = 0; ; round++) {
    const style = styleFor(args, index, round);
    const { run, brain } = await playOnce(args, profile, style);
    console.log(formatRun(run, style.faction, brain));
    if (run.error) {
      failures++;
      if (args.loop) await new Promise((r) => setTimeout(r, 2000)); // don't hammer a server that is down
    }
    if (!args.loop) return failures;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const names = Array.from({ length: args.count }, (_, i) => `${args.prefix}${i + 1}`);
  console.log(`${names.length} bot(s) -> ${args.url}${args.loop ? " (looping, Ctrl-C to stop)" : ""}`);
  const failures = (await Promise.all(names.map((name, i) => runBot(args, name, i)))).reduce((a, b) => a + b, 0);
  process.exitCode = failures > 0 ? 1 : 0;
  setTimeout(() => process.exit(), 2000).unref(); // never hang on a socket the SDK forgot
}

void main();
