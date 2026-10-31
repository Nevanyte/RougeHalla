// The driver-agnostic glue (docs/BOTS.md 1): one state snapshot in, the commands the bot clicked out. Both drivers (BotManager
// in-process, BotClient over the network) build a PerceptionInput per frame and hand it here, so a bot plays the same
// whichever way it is seated. It sends only through the adapter, which is where the transport's rules (latency, the
// message guard, what the server supports) live.
import { EFFECT_CASTING, EFFECT_STUNNED, type GameMap } from "@raid/shared";
import { BotVision } from "./vision";
import { createFrameRing } from "./frames";
import { perceive, type PerceptionInput } from "./perception";
import type {
  BotAdapter, BotRunnerApi, Brain, Features, FrameRingApi, MinimapView, RunnerConfig, TierParams, TimedCommand,
} from "./types";

export interface BotRunnerOptions {
  readonly brain: Brain;
  readonly adapter: BotAdapter;
  readonly cfg: RunnerConfig;
  /** The room's map (generateMap(seed, attempt)), open gates. */
  readonly map: GameMap;
  readonly features: Features;
  /** The tier's attention centre (TierParams.attention.central): the Percept marks fighters inside it. */
  readonly tier: Pick<TierParams, "attention">;
  /** Test seam: a ring of one's own. */
  readonly ring?: FrameRingApi;
  /** Enabled by live drivers; legacy perception-only fixtures can omit raid sight. */
  readonly vision?: boolean;
}

/** Potion use reads only the bot's own synced HUD state. The timer throttles retries over latency. */
export function shouldUsePotion(
  me: { status: string; hp: number; maxHp: number; potionLarge?: number; potionSmall?: number; healingUntil?: number; effects?: number },
  now: number, lastTriedAt: number,
): boolean {
  return me.status === "alive" && me.maxHp > 0 && me.hp < me.maxHp * 0.65
    && (me.potionLarge ?? 0) + (me.potionSmall ?? 0) > 0 && (me.healingUntil ?? 0) <= now
    && ((me.effects ?? 0) & (EFFECT_STUNNED | EFFECT_CASTING)) === 0 && now - lastTriedAt >= 1000;
}

export function createBotRunner(opts: BotRunnerOptions): BotRunnerApi<PerceptionInput> {
  const { brain, adapter, cfg, map, features } = opts;
  const ring = opts.ring ?? createFrameRing();
  const compose = { selfDelayMs: cfg.selfDelayMs, worldDelayMs: cfg.worldDelayMs, map, features, attentionCentral: opts.tier.attention.central };
  const vision = opts.vision ? new BotVision(map) : null;
  let lastMinimap: MinimapView | null = null;
  let ended = false;
  let lastHealAt = -Infinity;

  return {
    brain,
    frame(input: PerceptionInput): readonly TimedCommand[] {
      if (ended) return [];
      vision?.update(input, adapter.selfId);
      const frame = perceive(input, { selfId: adapter.selfId, map, features, lastMinimap, canSee: vision?.canSee });
      lastMinimap = frame.minimap;
      ring.push(frame);
      const composed = ring.compose(compose);
      const percept = composed && vision ? vision.filter(composed) : composed;
      if (!percept) return [];
      const sent: TimedCommand[] = [];
      for (const tc of brain.tick(percept)) {
        // A message this server does not take is never sent: the brain cannot know about every branch's message set.
        if (!adapter.supports(tc.cmd.type)) continue;
        if (adapter.send(tc.cmd, tc.at)) sent.push(tc);
      }
      const me = input.state.players.get(adapter.selfId);
      if (me && adapter.supports("useConsumable") && shouldUsePotion(me, input.state.serverTime, lastHealAt)
        && adapter.send({ type: "useConsumable", msg: { kind: "heal" } }, input.state.serverTime)) {
        lastHealAt = input.state.serverTime;
      }
      return sent;
    },
    end(result) {
      ended = true;
      return brain.end(result);
    },
  };
}
