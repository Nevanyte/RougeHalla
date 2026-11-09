/** Actual source bot consumers over earned, decoded World updates; no decisions are submitted to the World. */
import assert from "node:assert/strict";
import { mulberry32, type FxBatch, type GameMap } from "@raid/shared";
import { canPlayerSee } from "../../packages/server/src/sim/vision.ts";
import type { SimEvent, World } from "../../packages/server/src/sim/world.ts";
import { detectFeatures, perceive } from "../../packages/server/src/bots/brain/perception.ts";
import { createFrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { createMemory } from "../../packages/server/src/bots/brain/memory.ts";
import { createKnowledge } from "../../packages/server/src/bots/brain/knowledge.ts";
import { createHuntAdapter } from "../../packages/server/src/bots/brain/huntAdapter.ts";
import { createPathBudget, createPathService } from "../../packages/server/src/bots/brain/services.ts";
import {
  BOT_PATH_BUDGET_PER_TICK, PERSONAS, TIERS, WORLD_RENDER_DELAY_MS,
  type BrainConfig, type BrainContext, type Frame, type Percept,
} from "../../packages/server/src/bots/brain/types.ts";

// These are declared consumer-method streams. They are not derived Brain/reset streams, and do not replace World RNG.
const METHOD_SEEDS = { decide: 0x4e504301, motor: 0x4e504302, lapse: 0x4e504303, knowledge: 0x4e504304 } as const;

function countedStream(seed: number) {
  const source = mulberry32(seed);
  const values: number[] = [];
  let delivered = 0;
  return {
    next: () => { const value = source(); values.push(value); return value; },
    snapshot: () => {
      const newlyDrawn = values.slice(delivered);
      delivered = values.length;
      return { seed, totalDraws: values.length, newlyDrawn };
    },
  };
}

/** Copies actual returns now, so later source consumer mutation cannot rewrite an earlier capture row. */
const copy = <T>(value: T): T => structuredClone(value);

function frameSummary(frame: Frame) {
  return copy(frame);
}

function perceptSummary(percept: Percept) {
  return copy(percept);
}

export function createBotWitness(map: GameMap, viewerId: string) {
  const tier = TIERS.normal;
  const persona = PERSONAS.farmer;
  const ring = createFrameRing();
  const pathBudget = createPathBudget();
  const paths = createPathService(map, pathBudget);
  const rng = Object.fromEntries(Object.entries(METHOD_SEEDS).map(([key, seed]) => [key, countedStream(seed)])) as
    Record<keyof typeof METHOD_SEEDS, ReturnType<typeof countedStream>>;
  const logs: string[] = [];
  let lastMinimap: Frame["minimap"] | null = null;
  let consumers: {
    cfg: BrainConfig;
    memory: ReturnType<typeof createMemory>;
    knowledge: ReturnType<typeof createKnowledge>;
    hunt: ReturnType<typeof createHuntAdapter>;
  } | null = null;

  const provenance = {
    classification: "actual source perceive -> FrameRing -> Memory -> HuntAdapter/MobHunter method witness over decoded earned World updates",
    scope: "no full Brain, strategy/tactics scheduling, humanizer, action submission or survival proof; returned decisions never feed the World",
    visibility: "actual sim/vision.canPlayerSee(sourceWorld, viewerId, point); no substituted visibility callback or manually installed vision history",
    publication: "parent owns actual FxChannel batch-before-patch/extendRoster/Schema encode-decode/rosterSent; this consumer receives that exact optional fourth argument and never changes roster or World",
    order: "preserve actual source lists, Map insertion order and IDs; no sort, canonical rename or synthetic memory entries",
    configuration: {
      tier: "normal", persona: "farmer", selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS,
      attentionCentral: tier.attention.central, pathBudgetPerTick: BOT_PATH_BUDGET_PER_TICK,
      invocationCadence: "Memory and HuntAdapter run once per composed push; this does not claim the full Brain's configured decision cadence",
      engaged: false, engagedMeaning: "no tactics module is run; default HuntAdapter attacking fallback sees this explicit method-probe value",
      learned: "disabled; no learned store or external bias",
    },
    methodRng: {
      algorithm: "actual shared mulberry32", seeds: METHOD_SEEDS,
      boundary: "separate declared method seeds, not full Brain derive/reset wiring; Knowledge creation draws and any method draws are observed in order; World RNG is untouched",
    },
    consumerDiagnostics: "engagement and ban Map are read-only snapshots of actual TypeScript private consumer fields, separate from policy inputs; no expiry-mutating accessor is called just to observe bans",
    sourceModules: [
      "packages/server/src/sim/vision.ts", "packages/server/src/bots/brain/perception.ts",
      "packages/server/src/bots/brain/frames.ts", "packages/server/src/bots/brain/memory.ts",
      "packages/server/src/bots/brain/huntAdapter.ts", "packages/server/src/bots/mobHunt.ts",
      "packages/server/src/bots/brain/knowledge.ts", "packages/server/src/bots/brain/services.ts",
      "packages/server/src/bots/brain/types.ts", "packages/shared/src/rng.ts",
    ],
  };

  return {
    provenance,
    push(state: any, events: readonly SimEvent[], sourceWorld: World, publishedFxBatch?: FxBatch | null) {
      assert.equal(state.serverTime, sourceWorld.state.serverTime, "decoded state and source World must be the same step");
      if (publishedFxBatch === undefined) {
        assert(!events.some(event => event.type === "fx") && sourceWorld.projectiles.size === 0,
          "actual published FxChannel batch is required when this step has FX or projectiles");
      }
      const features = detectFeatures({ state, map });
      if (consumers === null) {
        const cfg: BrainConfig = {
          id: viewerId, name: "NPC continuity source consumer method witness", tier, persona,
          seed: METHOD_SEEDS.decide, map, features,
          learned: { enabled: false, bias: () => 0 },
          services: { paths, log: message => logs.push(message) }, modules: [],
        };
        consumers = {
          cfg, memory: createMemory({ tier, map, selfId: viewerId, features }),
          knowledge: createKnowledge(tier, rng.knowledge.next),
          hunt: createHuntAdapter(cfg, { log: message => logs.push(message) }),
        };
      }
      assert.deepEqual(features, consumers.cfg.features, "source feature presence must remain stable during this method witness");
      const frame = perceive({ state, ...(publishedFxBatch ? { fxs: [publishedFxBatch] } : {}) }, {
        selfId: viewerId, map, features, lastMinimap,
        canSee: point => canPlayerSee(sourceWorld, viewerId, point),
      });
      lastMinimap = frame.minimap;
      ring.push(frame);
      const percept = ring.compose({
        selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS, map, features,
        attentionCentral: tier.attention.central,
      });
      pathBudget.startTick();
      let huntResult: object | null = null;
      let stimuli: unknown = null;
      if (percept !== null) {
        paths.setFrame(percept.now, percept.hud.gatesLocked);
        stimuli = consumers.memory.observe(percept);
        const context: BrainContext = {
          cfg: consumers.cfg, p: percept, mem: consumers.memory.view, know: consumers.knowledge,
          svc: consumers.cfg.services,
          rng: { decide: rng.decide.next, motor: rng.motor.next, lapse: rng.lapse.next },
          engaged: false,
        };
        const decision = consumers.hunt.decide(context);
        const hunter = consumers.hunt.hunter;
        const bans = Reflect.get(hunter, "banned");
        assert(bans instanceof Map, "unchanged source MobHunter ban storage must be observable as a Map");
        huntResult = copy({
          decision, target: hunter.target, stats: hunter.stats,
          config: consumers.hunt.config,
          diagnosticsOnly: {
            engagement: Reflect.get(hunter, "eng"),
            bans: [...bans.entries()].map(([id, until]) => ({ id, until })),
          },
          tracker: [...consumers.memory.view.mobs.keys()].map(id => ({
            id, home: hunter.tracker.home(id), mob: hunter.tracker.mob(id),
            returning: hunter.tracker.returning(id, percept.now),
            awake: hunter.tracker.awake(id, percept.now, consumers.hunt.config.awakeMoved),
          })),
        });
      }
      const result = {
        now: state.serverTime, frame: frameSummary(frame),
        percept: percept === null ? null : perceptSummary(percept),
        memory: copy({
          mobs: [...consumers.memory.view.mobs.values()],
          camps: [...consumers.memory.view.camps.values()],
          self: consumers.memory.view.self, stimuli,
        }),
        hunt: huntResult, consumerLogs: logs.splice(0),
        methodRng: Object.fromEntries(Object.entries(rng).map(([key, stream]) => [key, stream.snapshot()])),
        pathService: { budgetLeft: pathBudget.left, ...paths.stats },
      };
      return result;
    },
  };
}
