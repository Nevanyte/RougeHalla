// The H help card (ui/helpOverlay.ts): the controls table, kept honest against the scenes' own key handlers, and the card's
// open / close behaviour on the fake DOM.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAMAGE_TYPE_LINE, FACTIONS, GLOSSARY, MECHANIC_TAGS, PVP_FMAX, SIGNATURE_TAGS, STAT_GLOSSARY, TAG_GLOSSARY, WEAPONS, WEAPON_TAGS, pvpFactor,
} from "@raid/shared";
import { HELP_SECTIONS, HelpOverlay, helpSectionOrder, isMouseLabel, mechanicsSections } from "../src/ui/helpOverlay";
import { fake, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

const bindings = HELP_SECTIONS.flatMap((s) => s.bindings.map((b) => ({ ...b, section: s.id })));
const find = (section: string, key: string, action?: RegExp) =>
  bindings.find((b) => b.section === section && b.keys.includes(key) && (!action || action.test(b.action)));

describe("the controls table", () => {
  it("has a run, a planning, a hub and an anywhere section, each with a title and bindings", () => {
    expect(HELP_SECTIONS.map((s) => s.id)).toEqual(["run", "planning", "hub", "anywhere"]);
    for (const s of HELP_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.bindings.length).toBeGreaterThan(0);
    }
  });

  it("gives every binding at least one key label and a short action, with no empty strings", () => {
    for (const b of bindings) {
      expect(b.keys.length).toBeGreaterThan(0);
      for (const k of b.keys) expect(k.trim()).not.toBe("");
      expect(b.action.trim()).not.toBe("");
      expect(b.action.length).toBeLessThanOrEqual(60);
      if (b.join !== undefined) expect(["+", "/", ""]).toContain(b.join);
    }
  });

  it("lists the run controls the owner named", () => {
    expect(find("run", "Right-click", /^Move/)).toBeDefined();
    expect(find("run", "Left-click", /lock the nearest enemy and attack/i)).toBeDefined();
    expect(find("run", "S", /stop/i)).toBeDefined();
    const slots = find("run", "1");
    expect(slots?.keys).toEqual(["1", "2"]);
    expect(slots?.action).toMatch(/weapon slot/i);
    expect(find("run", "Q", /swap/i)).toBeDefined();
    expect(find("run", "F", /pick up/i)).toBeDefined();
    // The practice room gives a Wish a 5 s cooldown (TRAINING_WISH_COOLDOWN_SECONDS), and the card is the same there.
    expect(find("run", "D", /wish/i)?.action).toMatch(/5 min cooldown, 5 s in training/);
    expect(find("run", "J", /quest log/i)).toBeDefined();
    expect(find("run", "Right-click", /minimap/i)?.action).toMatch(/move/i);
    expect(find("run", "Hold left-click", /minimap/i)?.action).toMatch(/peek/i);
    expect(find("run", "Esc", /leave practice/i)).toBeDefined();
  });

  it("lists the map and planning controls: hold Tab for the map, the spawn keys, the route and the keyboard path", () => {
    expect(find("run", "Hold Tab", /map/i)?.action).toMatch(/route/i);
    expect(find("planning", "1")?.keys).toEqual(["1", "2"]);
    expect(find("planning", "1")?.action).toMatch(/spawn/i);
    expect(find("planning", "Click", /route stop/i)).toBeDefined();
    expect(find("planning", "Tab")).toBeDefined();
    expect(find("planning", "Arrow keys")).toBeDefined();
    expect(find("planning", "Enter", /Ready/)).toBeDefined();
    expect(find("planning", "Delete", /stop/i)).toBeDefined();
  });

  it("lists the hub controls: walking and the station key", () => {
    expect(find("hub", "WASD")?.keys).toEqual(["WASD", "Arrow keys"]);
    expect(find("hub", "E", /station/i)).toBeDefined();
    expect(find("hub", "Right-click")).toBeDefined();
  });

  it("lists Alt+Enter as a chord, H, and Esc as general controls", () => {
    const alt = find("anywhere", "Alt");
    expect(alt?.keys).toEqual(["Alt", "Enter"]);
    expect(alt?.join).toBe("+");
    expect(alt?.action).toMatch(/fullscreen/i);
    expect(find("anywhere", "H", /help/i)).toBeDefined();
    expect(find("anywhere", "Esc")).toBeDefined();
  });

  it("is backed by the real handlers: every key it names is read by a scene or by the chrome", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const raid = read("../src/scenes/RaidScene.ts");
    const hub = read("../src/scenes/HubScene.ts");
    const chrome = read("../src/ui/chrome.ts");
    for (const code of ['"KeyS"', '"KeyQ"', '"KeyF"', '"KeyD"', '"Escape"', "(?:Digit|Numpad)([12])"]) expect(raid).toContain(code);
    expect(read("../src/ui/questLog.ts")).toContain('"KeyJ"');
    expect(read("../src/ui/mapHold.ts")).toContain('"Tab"');
    const planning = read("../src/ui/planning.ts");
    for (const code of ['"Delete"', '"ArrowRight"', "(?:Digit|Numpad)([12])"]) expect(planning).toContain(code);
    expect(raid).toMatch(/pointer\.button === 2/);
    expect(raid).toMatch(/pointer\.button === 0/);
    for (const code of ['"KeyE"', "KeyW:", "KeyA:", "KeyS:", "KeyD:", "ArrowUp:", "ArrowDown:", "ArrowLeft:", "ArrowRight:"]) expect(hub).toContain(code);
    expect(hub).toMatch(/pointer\.button === 2/);
    for (const code of ['"KeyH"', '"Enter"', '"Escape"']) expect(chrome).toContain(code);
  });

  it("orders the sections with the current place first and the general controls last", () => {
    expect(helpSectionOrder("run")).toEqual(["run", "planning", "hub", "anywhere"]);
    expect(helpSectionOrder("hub")).toEqual(["hub", "run", "planning", "anywhere"]);
    expect(helpSectionOrder("anywhere")).toEqual(["run", "planning", "hub", "anywhere"]);
  });

  it("draws labels with 'click' in them as mouse buttons", () => {
    expect(isMouseLabel("Right-click")).toBe(true);
    expect(isMouseLabel("Hold left-click")).toBe(true);
    expect(isMouseLabel("Q")).toBe(false);
    expect(isMouseLabel("Enter")).toBe(false);
  });
});

describe("HelpOverlay", () => {
  function setup(onClose?: () => void) {
    const { doc } = installChromeDom();
    const help = new HelpOverlay(onClose ? { onClose } : {});
    const root = fake(help.element);
    doc.ui.append(root);
    return { help, doc, root };
  }

  it("is built closed", () => {
    const { help, root } = setup();
    expect(help.isOpen).toBe(false);
    expect(root.hidden).toBe(true);
  });

  it("draws every key of every binding as a keycap, and every action as text", () => {
    const { help, root } = setup();
    const caps = root.find((e) => e.tagName === "KBD");
    expect(caps).toHaveLength(HELP_SECTIONS.flatMap((s) => s.bindings).reduce((n, b) => n + b.keys.length, 0));
    for (const cap of caps) expect(cap.className).toMatch(/^keycap/);
    const text = root.allText;
    for (const b of bindings) expect(text).toContain(b.action);
    const mouseCaps = caps.filter((c) => c.className.includes("mouse")).map((c) => c.textContent);
    expect(mouseCaps).toContain("Right-click");
    expect(mouseCaps).not.toContain("Q");
  });

  it("joins a chord with + and alternatives with /", () => {
    const { help, root } = setup();
    const joins = root.byClass("help-join").map((e) => e.textContent);
    expect(joins).toContain("+");
    expect(joins).toContain("/");
  });

  it("opens, and puts the current place's controls first", () => {
    const { help, root } = setup();
    const order = (id: string) => Number(root.byClass("help-section").find((s) => s.byClass("help-section-title")[0]!.textContent === HELP_SECTIONS.find((h) => h.id === id)!.title)!.style.order);
    help.open("hub");
    expect(help.isOpen).toBe(true);
    expect([order("hub"), order("run"), order("planning"), order("anywhere")]).toEqual([0, 1, 2, 3]);
    help.open("run");
    expect([order("run"), order("planning"), order("hub"), order("anywhere")]).toEqual([0, 1, 2, 3]);
  });

  it("is a labelled dialog that takes focus when it opens", () => {
    const { help, doc, root } = setup();
    help.open();
    const card = root.byClass("help-card")[0]!;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
    const title = root.byClass("help-title")[0]!;
    expect(card.getAttribute("aria-labelledby")).toBe(title.id);
    expect(doc.activeElement).toBe(card);
  });

  it("closes from its close button, which is labelled for a screen reader", () => {
    const { help, root } = setup();
    help.open();
    const close = root.byClass("help-close")[0]!;
    expect(close.getAttribute("aria-label")).toBe("Close help");
    close.click();
    expect(help.isOpen).toBe(false);
  });

  it("closes on a click outside the card, not on a click inside it", () => {
    const { help, root } = setup();
    help.open();
    root.byClass("help-card")[0]!.click();
    root.byClass("help-title")[0]!.click();
    expect(help.isOpen).toBe(true);
    root.click();
    expect(help.isOpen).toBe(false);
  });

  it("asks its owner to close when given onClose, instead of closing itself", () => {
    const onClose = vi.fn();
    const { help, root } = setup(onClose);
    help.open();
    root.click();
    root.byClass("help-close")[0]!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(help.isOpen).toBe(true);
  });

  it("knows whether a node is inside it", () => {
    const { help, doc, root } = setup();
    expect(help.contains(root.byClass("help-close")[0]! as never)).toBe(true);
    expect(help.contains(doc.body as never)).toBe(false);
    expect(help.contains(null)).toBe(false);
  });
});

describe("the Mechanics page (data)", () => {
  const sections = mechanicsSections();
  const by = (id: string) => sections.find((x) => x.id === id)!;

  it("has the glossary terms, the power and PvP lines, the signatures and the weapons, in that order", () => {
    expect(sections.map((x) => x.id)).toEqual(["terms", "power", "signatures", "weapons"]);
    for (const x of sections) {
      expect(x.title.length).toBeGreaterThan(3);
      expect(x.entries.length).toBeGreaterThan(0);
      for (const e of x.entries) {
        expect(e.term.trim(), x.id).not.toBe("");
        expect(e.text.trim(), `${x.id}/${e.term}`).not.toBe("");
      }
    }
  });

  it("lists AD and AP and every tag of the glossary, worded as the cards' chips word them, with the damage-type line first", () => {
    const terms = by("terms");
    expect(terms.intro).toBe(DAMAGE_TYPE_LINE);
    expect(terms.entries).toEqual(GLOSSARY.map((g) => ({ term: g.term, text: g.text })));
    const names = terms.entries.map((e) => e.term);
    for (const needed of ["AD", "AP", "Physical", "Magic", "True", "Damage over time", "On-hit", "Returned", "Block", "Slow", "Heal", "Ramping", "Execute", "Critical strike", "Area"]) {
      expect(names, needed).toContain(needed);
    }
    expect(terms.entries.find((e) => e.term === "AD")!.text).toBe(STAT_GLOSSARY.ad.text);
    for (const tag of MECHANIC_TAGS) expect(terms.entries.find((e) => e.term === TAG_GLOSSARY[tag].term)?.text, tag).toBe(TAG_GLOSSARY[tag].text);
  });

  it("states card power and the PvP factor with the real numbers", () => {
    const power = by("power").entries;
    expect(power.map((e) => e.term)).toEqual(["Card power", "PvP factor", "Normal mob rewards", "Quest rewards", "Chests"]);
    const pvp = power[1]!.text;
    expect(pvp).toContain(`x${pvpFactor(0).toFixed(2)} at power 0`);
    expect(pvp).toContain(`x${pvpFactor(6).toFixed(2)} at power 6`);
    expect(pvp).toContain(`tops out at x${PVP_FMAX.toFixed(2)}`);
    expect(pvp).toContain("x0.77 at power 0");
    expect(power[0]!.text).toMatch(/sum of the tiers of the cards you hold/);
    expect(power[0]!.text).toContain("live chest rewards are interactive augments");
    expect(power[0]!.text).toContain("Mob stat stacks and quest rewards do not add power");
    expect(power[2]!.text).toContain("up to 10 stacks per type");
    expect(power[2]!.text).toContain("Normal mob progress catalog");
    expect(power[3]!.text).toContain("same 10-stack cap");
    expect(power[4]!.text).toContain("elite death drops an augment chest");
  });

  it("lists each signature with its tags (the owner's table: burn magic over time, backlash physical returned, the mark true ramping...)", () => {
    const sig = by("signatures").entries;
    expect(sig).toHaveLength(SIGNATURE_TAGS.length);
    const text = (term: string) => sig.find((e) => e.term === term)!.text;
    expect(text(`${FACTIONS.fire.displayName}: Burn`)).toBe("Magic, Damage over time");
    expect(text(`${FACTIONS.fire.displayName}: Backlash`)).toBe("Physical, Returned");
    expect(text(`${FACTIONS.sentenced.displayName}: Mark`)).toContain("Each landed weapon hit");
    expect(text(`${FACTIONS.sentenced.displayName}: Mark`)).toContain("True, Ramping");
    expect(text(`${FACTIONS.plague.displayName}: Disease and execute`)).toBe("Magic, Damage over time, Execute");
    expect(text(`${FACTIONS.frost.displayName}: Chill`)).toBe("Slow");
    expect(text(`${FACTIONS.holy.displayName}: Lifesteal`)).toBe("Heal");
    // The Holy faction is shown to players as Demon Blood.
    expect(sig.some((e) => e.term.startsWith("Demon Blood:"))).toBe(true);
  });

  it("lists each weapon with what it scales with and what it does, from the weapon table", () => {
    const rows = by("weapons").entries;
    expect(rows.map((e) => e.term)).toEqual(WEAPON_TAGS.map((r) => WEAPONS[r.weapon].name));
    expect(rows.find((e) => e.term === "Wand")!.text).toContain("Scales with AP 1.0 + AD 0.3");
    expect(rows.find((e) => e.term === "Sword")!.text).toContain("Scales with AD 1.0");
    expect(rows.find((e) => e.term === "Fists")!.text).toContain("Scales with AD 0.6 + AP 0.6");
    for (const row of WEAPON_TAGS) expect(rows.find((e) => e.term === WEAPONS[row.weapon].name)!.text).toContain(row.note);
  });
});

describe("the Mechanics page (the card)", () => {
  function setup() {
    const { doc } = installChromeDom();
    const help = new HelpOverlay({});
    const root = fake(help.element);
    doc.ui.append(root);
    return { help, doc, root };
  }

  it("is a second page behind a tab: Controls first, Mechanics on click, each tab marking the page shown", () => {
    const { help, root } = setup();
    const [controlsTab, mechanicsTab] = root.byClass("help-tab");
    expect([controlsTab!.textContent, mechanicsTab!.textContent]).toEqual(["Controls", "Mechanics"]);
    expect(controlsTab!.getAttribute("role")).toBe("tab");
    expect(root.byClass("help-tabs")[0]!.getAttribute("role")).toBe("tablist");
    const [controls, mechanics] = root.byClass("help-body");
    help.open();
    expect(help.page).toBe("controls");
    expect([controls!.hidden, mechanics!.hidden]).toEqual([false, true]);
    expect(controlsTab!.getAttribute("aria-selected")).toBe("true");
    expect(mechanicsTab!.getAttribute("aria-selected")).toBe("false");
    mechanicsTab!.click();
    expect(help.page).toBe("mechanics");
    expect([controls!.hidden, mechanics!.hidden]).toEqual([true, false]);
    expect(mechanicsTab!.getAttribute("aria-selected")).toBe("true");
    controlsTab!.click();
    expect(help.page).toBe("controls");
  });

  it("opens on the page it is asked for, and on Controls by default (a reopened card does not keep Mechanics)", () => {
    const { help } = setup();
    help.open("hub", "mechanics");
    expect(help.page).toBe("mechanics");
    help.close();
    help.open();
    expect(help.page).toBe("controls");
  });

  it("draws every term and its definition on the Mechanics page, with no keycaps among them", () => {
    const { root } = setup();
    const page = root.byClass("help-mechanics")[0]!;
    const text = page.allText;
    for (const x of mechanicsSections()) {
      expect(text).toContain(x.title);
      for (const e of x.entries) {
        expect(text).toContain(e.term);
        expect(text).toContain(e.text);
      }
    }
    expect(page.find((e) => e.tagName === "KBD")).toHaveLength(0);
    expect(page.byClass("help-mech-section")).toHaveLength(4);
    // The controls table still has exactly its keycaps (the Mechanics page adds none).
    expect(root.find((e) => e.tagName === "KBD")).toHaveLength(HELP_SECTIONS.flatMap((s) => s.bindings).reduce((n, b) => n + b.keys.length, 0));
  });

  it("keeps the controls sections the groundLegend and chrome tests count: the Mechanics sections use their own class", () => {
    const { doc } = installChromeDom();
    const root = fake(new HelpOverlay({ ground: false }).element);
    doc.ui.append(root);
    expect(root.byClass("help-section")).toHaveLength(HELP_SECTIONS.length);
  });
});
