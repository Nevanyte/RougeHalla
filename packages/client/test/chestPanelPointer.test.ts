// The chest panel never takes the canvas' clicks (ui/chestPanel.css, chestPanel.ts): a left-click locks a target and a right-click
// walks, panel or no panel, so the root and the box are click-through and only the cards and Skip take the pointer. No handler is
// put on anything else, no pointer is ever captured, and nothing in the panel stops or cancels an event it does not own. The
// stylesheet is checked as text, like the build strip's, and the script by what it registers on a fake DOM.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/settings";
import { ChestPanel } from "../src/ui/chestPanel";
import { FEl, fake, installChromeDom } from "./chromeDom";

const css = readFileSync(new URL("../src/ui/chestPanel.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/ui/chestPanel.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const planningCss = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");
const buffsCss = readFileSync(new URL("../src/ui/buffsHud.css", import.meta.url), "utf8");
const chromeCss = readFileSync(new URL("../src/ui/chrome.css", import.meta.url), "utf8");

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(from: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(from);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

describe("the stylesheet", () => {
  it("is click-through at the root (past index.html's #ui > * rule) and in the box, the header, the bar, the status", () => {
    expect(rule(css, "#ui > .chest-panel")).toMatch(/pointer-events:\s*none/);
    for (const s of [".cp-box", ".cp-head", ".cp-bar", ".cp-cards", ".cp-status", ".cp-hint"]) {
      expect(rule(css, s), s).toMatch(/pointer-events:\s*none/);
    }
  });

  it("gives the pointer to the cards and to Skip, and to nothing else", () => {
    expect(rule(css, ".cp-card, .cp-skip")).toMatch(/pointer-events:\s*auto/);
    const autos = css.match(/pointer-events:\s*auto/g) ?? [];
    expect(autos).toHaveLength(1);
  });

  it("is not a modal: no scrim, no full-screen box, no fixed position", () => {
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/inset:\s*0\b/);
    expect(css).not.toMatch(/scrim|backdrop/);
    expect(rule(css, "#ui > .chest-panel")).toMatch(/position:\s*absolute/);
  });

  it("docks at the right edge, below the chrome's buttons and clear of the minimap, and not at the fight's centre", () => {
    const root = rule(css, "#ui > .chest-panel");
    expect(root).toMatch(/right:\s*12px/);
    expect(root).toMatch(/top:\s*56px/);
    expect(root).toMatch(/bottom:\s*calc\(var\(--ui-h, 600px\) \* 0\.26 \+ 34px\)/);
    expect(root).not.toMatch(/left:\s*50%/);
  });

  it("sizes with the text size setting", () => {
    expect(rule(css, "#ui > .chest-panel")).toMatch(/font-size:\s*calc\(13px \* var\(--cp-text, 1\)\)/);
    expect(rule(css, "#ui > .chest-panel")).toMatch(/width:\s*min\(calc\(248px \* var\(--cp-text, 1\)\)/);
  });

  it("says no to motion under reduced motion: the pulse and the entrance, by the OS and by the switch", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.cp-box[^}]*animation:\s*none/);
    expect(css).toMatch(/html\[data-reduced-motion\] \.cp-box[^{]*\{\s*animation:\s*none/);
    // The progress bar is moved by the script, never by a transition.
    expect(css).not.toMatch(/transition\s*:/);
    // Every animation it names is one it switches off.
    const named = [...css.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== "none");
    expect(new Set(named)).toEqual(new Set(["panel-in", "cp-pulse"]));
  });

  it("tells a card nobody can take by words and a line, not by grey alone", () => {
    expect(rule(css, ".cp-card.taken .cp-name")).toMatch(/line-through/);
    expect(rule(css, ".cp-card.maxed, .cp-card.unknown")).toMatch(/dashed/);
  });

  it("sits on the ladder: above the build tooltip, under the map screens, the toasts and the chrome", () => {
    const z = (from: string, s: string): number => Number(/z-index:\s*(\d+)/.exec(rule(from, s))![1]);
    const panel = z(css, "#ui > .chest-panel");
    expect(panel).toBeGreaterThan(z(buffsCss, ".buff-tip"));
    expect(panel).toBeLessThan(z(planningCss, "#ui > .planning"));
    expect(panel).toBeLessThan(z(style, ".toasts"));
    expect(panel).toBeLessThan(z(chromeCss, "#ui > .chrome"));
    expect(style).toMatch(/z-index ladder[\s\S]{0,300}chest panel \(chestPanel\.css, 8\)/);
  });
});

describe("the script", () => {
  it("never captures a pointer and registers no pointer or mouse handler anywhere", () => {
    expect(source).not.toMatch(/setPointerCapture|releasePointerCapture/);
    expect(source).not.toMatch(/pointerdown|pointerup|pointermove|mousedown|mouseup|mousemove|touchstart|wheel/);
  });

  it("puts click, contextmenu and focusout on the cards and Skip only, and keydown on the window only", () => {
    const { win } = installChromeDom();
    const seen: Array<{ el: string; type: string }> = [];
    const original = FEl.prototype.addEventListener;
    vi.spyOn(FEl.prototype, "addEventListener").mockImplementation(function (this: FEl, type: string, fn: (e: unknown) => void) {
      seen.push({ el: this.className, type });
      original.call(this, type, fn);
    });
    const store = new SettingsStore({ getItem: () => null, setItem: () => {} });
    const panel = new ChestPanel({ send: () => {}, settings: store });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(["cp-card", "cp-skip"], `${s.type} on ${s.el}`).toContain(s.el);
      expect(["click", "contextmenu", "focusout"], s.type).toContain(s.type); // focusout: the Tab order, never a pointer
    }
    expect(seen.filter((s) => s.el === "cp-card")).toHaveLength(9);
    expect(seen.filter((s) => s.el === "cp-skip")).toHaveLength(3);
    expect(win.keydownListeners).toBe(1);
    expect(fake(panel.element).className).toBe("chest-panel");
  });

  it("an event over the panel's own areas is nobody's: a click on the box, the header or the status is not touched", () => {
    installChromeDom();
    const store = new SettingsStore({ getItem: () => null, setItem: () => {} });
    const sent: unknown[] = [];
    const panel = new ChestPanel({ send: (m) => sent.push(m), settings: store });
    const root = fake(panel.element);
    for (const cls of ["cp-box", "cp-head", "cp-title", "cp-timer", "cp-bar", "cp-cards", "cp-status", "cp-hint"]) {
      const node = cls === "cp-box" ? root.children[0]! : root.byClass(cls)[0]!;
      for (const type of ["click", "contextmenu", "pointerdown", "mousedown", "wheel"]) {
        const e = node.dispatch(type);
        expect(e.defaultPrevented, `${type} on ${cls}`).toBe(false);
        expect(e.propagationStopped, `${type} on ${cls}`).toBe(false);
      }
    }
    expect(sent).toEqual([]);
  });
});
