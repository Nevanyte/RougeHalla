import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELOAD_BUTTON, RELOAD_TEXT, RELOAD_TITLE, ReloadPrompt } from "../src/ui/reloadPrompt";
import { installUiDom, type UiEl } from "./uiDom";

let ui: UiEl;
const card = (): UiEl | undefined => ui.children.find((c): c is UiEl => typeof c !== "string" && c.classList.contains("reload-prompt"));

beforeEach(() => {
  ({ ui } = installUiDom());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReloadPrompt", () => {
  it("is not in the page until a stale join shows it", () => {
    const prompt = new ReloadPrompt(() => {});
    expect(card()).toBeUndefined();
    expect(prompt.shown).toBe(false);
  });

  it("show() puts one dialog up with the sentence and a Reload button, once however often it is asked", () => {
    const prompt = new ReloadPrompt(() => {});
    prompt.show();
    prompt.show();
    const root = card()!;
    expect(ui.children.filter((c) => typeof c !== "string" && c.classList.contains("reload-prompt"))).toHaveLength(1);
    expect(prompt.shown).toBe(true);
    expect(root.byClass("reload-card")!.getAttribute("role")).toBe("alertdialog");
    expect(root.byClass("reload-title")!.textContent).toBe(RELOAD_TITLE);
    expect(root.byClass("reload-text")!.textContent).toBe(RELOAD_TEXT);
    const button = root.allByClass("btn")[0]!;
    expect(button.textContent).toBe(RELOAD_BUTTON);
    expect(RELOAD_TEXT).toMatch(/reload/i);
  });

  it("the button reloads the page, and the card stays up until it does", () => {
    const reload = vi.fn();
    const prompt = new ReloadPrompt(reload);
    prompt.show();
    expect(reload).not.toHaveBeenCalled();
    card()!.allByClass("btn")[0]!.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(prompt.shown).toBe(true);
  });

  it("reloads the real page by default", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const prompt = new ReloadPrompt();
    prompt.show();
    card()!.allByClass("btn")[0]!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
