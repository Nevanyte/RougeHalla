// The driver-agnostic glue (docs/BOTS.md 1): one state snapshot in, the commands the bot clicked out. Both drivers (BotManager
// in-process, BotClient over the network) build a PerceptionInput per frame and hand it here, so a bot plays the same
// whichever way it is seated. It sends only through the adapter, which is where the transport's rules (latency, the
// message guard, what the server supports) live.
import type { GameMap } from "@raid/shared";
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

export function createBotRunner(opts: BotRunnerOptions): BotRunnerApi<PerceptionInput> {
  const { brain, adapter, cfg, map, features } = opts;
  const ring = opts.ring ?? createFrameRing();
  const compose = { selfDelayMs: cfg.selfDelayMs, worldDelayMs: cfg.worldDelayMs, map, features, attentionCentral: opts.tier.attention.central };
  const vision = opts.vision ? new BotVision(map) : null;
  let lastMinimap: MinimapView | null = null;
  let ended = false;

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
      return sent;
    },
    end(result) {
      ended = true;
      return brain.end(result);
    },
  };
}
