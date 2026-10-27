// Counters tab: the two stacked counter loops (factions and weapons) as pentagrams, with the picked faction highlighted
// (a run starts on fists, which sit outside the weapon loop, so no weapon node is picked). The geometry and the matchups come from shared/wheel.ts, which reads them off BEATS /
// WEAPON_BEATS, so a retuned loop redraws itself. Built as inline SVG (never innerHTML); the DOM is built once and a
// new pick only changes classes and arrowheads.
import {
  FACTIONS, FACTION_WHEEL, WEAPONS, WEAPON_WHEEL, isFactionId, wheelMatchups,
  type FactionId, type Wheel, type WeaponId,
} from "@raid/shared";
import { cssColor, el } from "../dom";
import type { HubPanel } from "./hubPanels";
import "./counterWheel.css";

export type NodeRole = "pick" | "beats" | "losesTo" | "other";
/** Seen from the pick: an edge it wins, an edge it loses, or one it is not part of. */
export type EdgeRole = "win" | "loss" | "other";

export interface WheelHighlight<Id extends string> {
  /** The picked node, or null when there is no pick (or it is not on this wheel); every role is then "other". */
  pick: Id | null;
  nodes: Record<Id, NodeRole>;
  /** One role per entry of `wheel.edges`, same order. */
  edges: EdgeRole[];
}

/** What every node and edge of `wheel` is from the point of view of `pick`. A pick that is not on the wheel counts as none. */
export function wheelHighlight<Id extends string>(wheel: Wheel<Id>, pick: Id | null): WheelHighlight<Id> {
  const pickId = pick !== null && wheel.nodes.some((n) => n.id === pick) ? pick : null;
  const matchups = pickId === null ? null : wheelMatchups(wheel, pickId);
  const nodes = {} as Record<Id, NodeRole>;
  for (const { id } of wheel.nodes) {
    nodes[id] = !matchups ? "other"
      : id === pickId ? "pick"
      : matchups.beats.includes(id) ? "beats"
      : matchups.losesTo.includes(id) ? "losesTo"
      : "other";
  }
  const edges = wheel.edges.map((e): EdgeRole => (pickId === null ? "other" : e.winner === pickId ? "win" : e.loser === pickId ? "loss" : "other"));
  return { pick: pickId, nodes, edges };
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "no one";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function matchupText(name: string, beats: readonly string[], losesTo: readonly string[]): string {
  return `${name} beats ${joinNames(beats)}, and loses to ${joinNames(losesTo)}.`;
}

/** The whole loop in words, for a screen reader: "Fire beats Sentenced and Plague. Sentenced beats ...". */
export function wheelDescription<Id extends string>(wheel: Wheel<Id>, labelOf: (id: Id) => string): string {
  return wheel.nodes
    .map(({ id }) => `${labelOf(id)} beats ${joinNames(wheelMatchups(wheel, id).beats.map(labelOf))}.`)
    .join(" ");
}

interface Point { x: number; y: number }

/** The segment a→b shortened by `startGap` at a and `endGap` at b (so arrows start and stop outside the node circles). */
export function trimSegment(a: Point, b: Point, startGap: number, endGap: number): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  const ux = dx / len;
  const uy = dy / len;
  return { x1: a.x + ux * startGap, y1: a.y + uy * startGap, x2: b.x - ux * endGap, y2: b.y - uy * endGap };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 280;
const VIEW_H = 260;
const CENTER: Point = { x: 140, y: 140 };
const RING_RADIUS = 90;
const NODE_RADIUS = 17;
const TAIL_GAP = NODE_RADIUS + 6;
const HEAD_GAP = NODE_RADIUS + 8;
/** Draw order: an edge that matters goes on top of the dimmed ones. */
const EDGE_RANK: Record<EdgeRole, number> = { other: 0, loss: 1, win: 2 };
const EDGE_ROLES: readonly EdgeRole[] = ["other", "win", "loss"];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, className?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  // setAttribute, not className: on an SVG element className is a read-only SVGAnimatedString.
  if (className) node.setAttribute("class", className);
  return node;
}

/** Keeps the marker ids of two wheels on one page apart (an id must be unique in the document). */
let wheelSvgs = 0;

export interface WheelSvg<Id extends string> {
  svg: SVGSVGElement;
  /** Re-colours the existing elements for a new highlight; nothing is rebuilt. */
  apply(highlight: WheelHighlight<Id>): void;
}

/**
 * One pentagram: a circle per node (in `colorOf`'s colour, named by `labelOf`) and an arrow per edge, winner to loser.
 * Sides (next node clockwise) are solid and diagonals (the one after) dashed. DOM only, no Phaser.
 */
export function buildWheelSvg<Id extends string>(
  wheel: Wheel<Id>,
  labelOf: (id: Id) => string,
  colorOf: (id: Id) => number,
  highlight: WheelHighlight<Id>,
  title = "Counter wheel",
): WheelSvg<Id> {
  const uid = `cw${wheelSvgs++}`;
  const svg = svgEl("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: "img", "aria-label": `${title}. ${wheelDescription(wheel, labelOf)}` });

  const defs = svgEl("defs");
  for (const role of EDGE_ROLES) {
    const marker = svgEl("marker", {
      id: `${uid}-head-${role}`, markerUnits: "userSpaceOnUse", markerWidth: 9, markerHeight: 9, refX: 9, refY: 4.5, orient: "auto",
    });
    marker.append(svgEl("path", { d: "M0,0 L9,4.5 L0,9 Z" }, `cw-head cw-h-${role}`));
    defs.append(marker);
  }

  const place = new Map<Id, Point>();
  for (const n of wheel.nodes) place.set(n.id, { x: CENTER.x + n.x * RING_RADIUS, y: CENTER.y + n.y * RING_RADIUS });

  const edgeLayer = svgEl("g", {}, "cw-edges");
  const edgeEls = wheel.edges.map((e) => {
    const seg = trimSegment(place.get(e.winner)!, place.get(e.loser)!, TAIL_GAP, HEAD_GAP);
    const line = svgEl("line", seg);
    edgeLayer.append(line);
    return line;
  });

  const nodeLayer = svgEl("g", {}, "cw-nodes");
  const nodeEls = new Map<Id, SVGGElement>();
  for (const n of wheel.nodes) {
    const at = place.get(n.id)!;
    const name = labelOf(n.id);
    const m = wheelMatchups(wheel, n.id);
    const g = svgEl("g");
    const tip = svgEl("title");
    tip.textContent = matchupText(name, m.beats.map(labelOf), m.losesTo.map(labelOf));
    // The top node's label goes above it; the others sit below, where the pentagon leaves the most room.
    const labelY = n.y < -0.5 ? at.y - NODE_RADIUS - 9 : at.y + NODE_RADIUS + 15;
    const label = svgEl("text", { x: at.x, y: labelY }, "cw-label");
    label.textContent = name;
    g.append(
      tip,
      svgEl("circle", { cx: at.x, cy: at.y, r: NODE_RADIUS + 8 }, "cw-halo"),
      svgEl("circle", { cx: at.x, cy: at.y, r: NODE_RADIUS + 4 }, "cw-ring"),
      svgEl("circle", { cx: at.x, cy: at.y, r: NODE_RADIUS, fill: cssColor(colorOf(n.id)) }, "cw-dot"),
      label,
    );
    nodeLayer.append(g);
    nodeEls.set(n.id, g);
  }

  svg.append(defs, edgeLayer, nodeLayer);

  const apply = (h: WheelHighlight<Id>): void => {
    svg.setAttribute("class", h.pick === null ? "cw-svg" : "cw-svg cw-has-pick");
    for (const [id, g] of nodeEls) g.setAttribute("class", `cw-node cw-n-${h.nodes[id] ?? "other"}`);
    wheel.edges.forEach((e, i) => {
      const role = h.edges[i] ?? "other";
      const line = edgeEls[i]!;
      line.setAttribute("class", `cw-edge cw-e-${e.kind} cw-e-${role}`);
      line.setAttribute("marker-end", `url(#${uid}-head-${role})`);
    });
    // Moving an existing element re-orders it; nothing is recreated.
    wheel.edges
      .map((_, i) => i)
      .sort((a, b) => EDGE_RANK[h.edges[a] ?? "other"] - EDGE_RANK[h.edges[b] ?? "other"] || a - b)
      .forEach((i) => edgeLayer.append(edgeEls[i]!));
  };
  apply(highlight);
  return { svg, apply };
}

/** The faction that is picked, or null for none. An object so a later pick (the weapon in hand, say) can join it. */
export interface WheelPick { faction: FactionId | null }

const NO_PICK_HINT = "Pick a faction to see your matchups";

/** The weapon ring's caption for a pick: every run starts on fists, which are not on the ring; a looted weapon joins it. */
export function startingKitText(factionName: string): string[] {
  return [
    `${factionName} starts on fists: the fastest hands, the shortest reach, and a swing no shield stops.`,
    "Fists sit outside this ring. Loot a weapon from a chest, the ground or a fallen mob and it takes its place on it.",
  ];
}

function sentence(who: string, color: number, beats: readonly string[], losesTo: readonly string[]): HTMLElement {
  const p = el("p", "cw-sentence");
  const name = el("span", "cw-who", who);
  name.style.color = cssColor(color);
  // The words of matchupText, with the verbs picked out in the colours of the arrows.
  p.append(name, " ", el("span", "cw-win", "beats"), ` ${joinNames(beats)}, and `, el("span", "cw-loss", "loses to"), ` ${joinNames(losesTo)}.`);
  return p;
}

export class CounterWheel implements HubPanel {
  readonly title = "Counters";
  readonly root = el("div", "hub-tab hub-counters");

  private readonly hint = el("p", "cw-hint", NO_PICK_HINT);
  private readonly factionCaption = el("div", "cw-caption");
  private readonly weaponCaption = el("div", "cw-caption");
  private readonly factions: WheelSvg<FactionId>;
  private readonly weapons: WheelSvg<WeaponId>;
  private faction: FactionId | null = null;

  constructor() {
    this.factions = buildWheelSvg(FACTION_WHEEL, (id) => FACTIONS[id].displayName, (id) => FACTIONS[id].color, wheelHighlight(FACTION_WHEEL, null), "Faction counter wheel");
    this.weapons = buildWheelSvg(WEAPON_WHEEL, (id) => WEAPONS[id].name, (id) => WEAPONS[id].color, wheelHighlight(WEAPON_WHEEL, null), "Weapon counter wheel");

    const wheels = el("div", "cw-wheels");
    wheels.append(
      this.section("Factions", this.factions.svg, this.factionCaption),
      this.section("Weapons", this.weapons.svg, this.weaponCaption),
    );

    const legend = el("p", "cw-legend");
    legend.append(
      "Arrows point from winner to loser: solid to the next node round the ring, dashed to the one after. Your pick glows gold; ",
      el("span", "cw-win", "green"), " is what it beats, ", el("span", "cw-loss", "red"), " is what beats it.",
    );
    this.root.append(this.hint, wheels, legend);
    this.setPick({ faction: null });
  }

  /** Nothing here depends on the profile. */
  render(): void {}

  /** Highlights the picked faction (the weapon ring has no pick: a run starts on fists); `{ faction: null }` clears it. Updates the DOM in place. */
  setPick(pick: WheelPick): void {
    const faction = isFactionId(pick.faction) ? pick.faction : null;
    this.faction = faction;
    this.factions.apply(wheelHighlight(FACTION_WHEEL, faction));
    this.weapons.apply(wheelHighlight(WEAPON_WHEEL, null));

    this.hint.hidden = faction !== null;
    this.factionCaption.hidden = faction === null;
    this.weaponCaption.hidden = faction === null;
    if (faction === null) {
      this.factionCaption.replaceChildren();
      this.weaponCaption.replaceChildren();
      return;
    }
    const f = wheelMatchups(FACTION_WHEEL, faction);
    this.factionCaption.replaceChildren(
      sentence(FACTIONS[faction].displayName, FACTIONS[faction].color, f.beats.map((id) => FACTIONS[id].displayName), f.losesTo.map((id) => FACTIONS[id].displayName)),
    );
    this.weaponCaption.replaceChildren(...startingKitText(FACTIONS[faction].displayName).map((t) => el("p", "cw-sub", t)));
  }

  /** The faction last passed to `setPick`. */
  get pick(): FactionId | null {
    return this.faction;
  }

  private section(name: string, svg: SVGSVGElement, caption: HTMLElement): HTMLElement {
    const head = el("div", "cw-wheel-head");
    head.append(el("span", undefined, name), el("span", "cw-wheel-note", "Each beats the next two, clockwise"));
    const box = el("div", "cw-wheel");
    box.append(head, svg, caption);
    return box;
  }
}
