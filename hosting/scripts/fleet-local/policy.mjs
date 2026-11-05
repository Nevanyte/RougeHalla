// The scaling decision, as a pure function (docs/hosting/SCALING.md section 3). The local fleet manager (fleet.mjs) and the
// unit tests (policy.test.mjs) call it; the cloud analogue is the GameLift target-tracking policy on PercentAvailableGameSessions
// plus CloudWatch alarms for the guardrails. One "group" is one container group = one game session of capacity.
//
// state = {
//   groups:  [{id, state: 'idle'|'active', idleForMs, metrics?: {latenessP99Us, droppedStepsDelta, rssBytes}}]  ready groups of the
//            target build that are not draining (an old build being replaced is the deployer's business, not the policy's)
//   starting: number of groups launched but not ready yet
//   queued:   number of session requests waiting for a group
//   joinP95Ms: recent p95 of reserve-to-welcome delay (or null)
// }
export const DEFAULTS = {
  minGroups: 0, // floor of ready+starting groups (0 allows scale to zero)
  maxGroups: 4, // the cost cap: never exceeded, however high demand is
  warmMin: 1, // idle groups kept ready for the next session
  warmMax: 2, // bounded warm capacity: the buffer never asks for more idle groups than this
  targetAvailablePct: 30, // target tracking: keep idle / (idle + active) at or above this
  idleScaleInMs: 6000, // an idle group is only released after being idle this long
  latenessP99UsLimit: 25000, // guardrail: a step started more than 25 ms after its slot (p99)
  droppedStepsLimit: 0, // guardrail: any dropped simulation step since the last tick
  memLimitBytes: 0, // guardrail: 0 disables; else total RSS above 85 percent of it blocks scale-in and adds warm capacity
  joinP95MsLimit: 5000, // guardrail: placement-to-welcome p95 above this adds warm capacity
};

export function guards(state, cfg = DEFAULTS) {
  const reasons = [];
  const avoid = [];
  let extraWarm = 0;
  let rss = 0;
  for (const g of state.groups) {
    const m = g.metrics ?? {};
    rss += m.rssBytes ?? 0;
    if ((m.latenessP99Us ?? 0) > cfg.latenessP99UsLimit) {
      avoid.push(g.id);
      reasons.push(`${g.id}: step lateness p99 ${m.latenessP99Us} us > ${cfg.latenessP99UsLimit}`);
    }
    if ((m.droppedStepsDelta ?? 0) > cfg.droppedStepsLimit) {
      avoid.push(g.id);
      reasons.push(`${g.id}: ${m.droppedStepsDelta} dropped steps`);
    }
  }
  if (cfg.memLimitBytes > 0 && rss > 0.85 * cfg.memLimitBytes) {
    extraWarm += 1;
    reasons.push(`memory ${rss} B > 85% of ${cfg.memLimitBytes} B`);
  }
  if (avoid.length > 0) extraWarm += 1;
  if (state.joinP95Ms != null && state.joinP95Ms > cfg.joinP95MsLimit) {
    extraWarm += 1;
    reasons.push(`join p95 ${state.joinP95Ms} ms > ${cfg.joinP95MsLimit}`);
  }
  return { veto: reasons.length > 0, extraWarm, avoid: [...new Set(avoid)], reasons };
}

export function decide(state, cfg = DEFAULTS) {
  const g = guards(state, cfg);
  const active = state.groups.filter((x) => x.state === 'active').length;
  const idle = state.groups.filter((x) => x.state === 'idle');
  const t = cfg.targetAvailablePct / 100;
  const buffer = Math.ceil((active * t) / (1 - t));
  const warmMax = Math.max(cfg.warmMax, cfg.warmMin + g.extraWarm);
  let idleWanted = Math.max(state.queued, Math.min(Math.max(buffer, cfg.warmMin + g.extraWarm), warmMax));
  idleWanted = Math.min(idleWanted, Math.max(0, cfg.maxGroups - active)); // the cap beats demand
  idleWanted = Math.max(idleWanted, cfg.minGroups - active);
  const idleHave = idle.length + state.starting;
  const out = Math.max(0, idleWanted - idleHave);
  let scaleIn = [];
  if (idleHave > idleWanted && !g.veto) {
    scaleIn = idle
      .filter((x) => x.idleForMs >= cfg.idleScaleInMs)
      .sort((a, b) => b.idleForMs - a.idleForMs)
      .slice(0, Math.min(idle.length, idleHave - idleWanted))
      .map((x) => x.id);
  }
  return { scaleOut: out, scaleIn, avoid: g.avoid, veto: g.veto, reasons: g.reasons, idleWanted };
}
