import { enqueueClientMessage, type InputQueue } from "../../packages/server/src/sim/inputs";
import { TokenBucket } from "../../packages/server/src/guards/tokenBucket";
import { loadConfig, type ServerConfig } from "../../packages/server/src/config";

export const CAPTURE_FREE_MESSAGE_TYPES: ReadonlySet<string> = new Set(["aim", "beat"]);
type OrderConfig = Pick<ServerConfig, "orderBurst" | "orderPerSecond">;

/** Real production defaults with no ambient environment; the legacy edge bucket uses the injected simulation clock. */
export function createIntake(budgeted: boolean, config: OrderConfig = loadConfig({})) {
  const budgets = new Map<string, TokenBucket>();
  return (player: string, queue: InputQueue, type: string, msg: unknown, now: number, training = false): boolean => {
    if (budgeted && config.orderBurst > 0 && config.orderPerSecond > 0 && !CAPTURE_FREE_MESSAGE_TYPES.has(type)) {
      let budget = budgets.get(player);
      if (!budget) budgets.set(player, budget = new TokenBucket(config.orderBurst, config.orderPerSecond, now));
      if (!budget.take(now)) return false;
    }
    const dropped = queue.dropped;
    return enqueueClientMessage(queue, type, msg, { training }) && queue.dropped === dropped;
  };
}
