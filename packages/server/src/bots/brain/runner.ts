// The driver-agnostic glue (docs/BOTS.md 1): one state snapshot in, the commands the bot clicked out. Both drivers (BotManager
// in-process, BotClient over the network) build a PerceptionInput per frame and hand it here, so a bot plays the same
// whichever way it is seated. It sends only through the adapter, which is where the transport's rules (latency, the
// message guard, what the server supports) live.
import type { GameMap } from "@raid/shared";
import { createFrameRing } from "./frames";
import { perceive, type PerceptionInput } from "./perception";
import type {
  BotAdapter, BotRunnerApi, Brain, Features, FrameRingApi, MinimapView, RunnerConfig, TierParams, TimedCommand,
} from "./types";

export interface BotRunnerOptions {
  readonly brain: Brain;
  readonly adapter: BotAdapter;
  readonly cfg: RunnerConfig;
  /** generateMap(state.seed), open gates. */
  readonly map: GameMap;
  readonly features: Features;
  /** The tier's attention centre (TierParams.attention.central): the Percept marks fighters inside it. */
  readonly tier: Pick<TierParams, "attention">;
  /** Test seam: a ring of one's own. */
  readonly ring?: FrameRingApi;
}

export function createBotRunner(opts: BotRunnerOptions): BotRunnerApi<PerceptionInput> {
  const { brain, adapter, cfg, map, features } = opts;
  const ring = opts.ring ?? createFrameRing();
  const compose = { selfDelayMs: cfg.selfDelayMs, worldDelayMs: cfg.worldDelayMs, map, features, attentionCentral: opts.tier.attention.central };
  let lastMinimap: MinimapView | null = null;
  let ended = false;

  return {
    brain,
    frame(input: PerceptionInput): readonly TimedCommand[] {
      if (ended) return [];
      const frame = perceive(input, { selfId: adapter.selfId, map, features, lastMinimap });
      lastMinimap = frame.minimap;
      ring.push(frame);
      const percept = ring.compose(compose);
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
