import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { RunResult } from "@raid/shared";
import { ResultsScreen } from "../src/ui/results";
import { installUiDom, type UiEl } from "./uiDom";

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    outcome: "won", profile: "op-test", durationSec: 252, kills: 3, killedBy: null, place: 1, players: 8,
    gv: { kills: 120, mobs: 30, bounty: 0, win: 500, total: 650 }, winBonusWithheld: false,
    ...over,
  };
}

let ui: UiEl;
let onContinue: Mock<() => void>;
let screen: ResultsScreen;
const panel = (): UiEl => ui.children.find((c): c is UiEl => typeof c !== "string" && c.classList.contains("results"))!;

beforeEach(() => {
  ({ ui } = installUiDom());
  onContinue = vi.fn<() => void>();
  screen = new ResultsScreen({ onContinue });
});
afterEach(() => vi.unstubAllGlobals());

describe("ResultsScreen", () => {
  it("opens with the outcome as the title and as a class on the panel", () => {
    screen.show(result());
    const p = panel();
    expect(screen.visible).toBe(true);
    expect(p.classList.contains("results-won")).toBe(true);
    const title = [...p.walk()].find((n) => n.tag === "h1")!;
    expect(title.textContent).toBe("VICTORY");
    expect(title.classList.contains("outcome-won")).toBe(true);
  });

  it("names every outcome", () => {
    const titles: Array<[RunResult["outcome"], string]> = [["won", "VICTORY"], ["draw", "DRAW"], ["died", "YOU DIED"], ["mia", "LEFT THE RUN"]];
    for (const [outcome, text] of titles) {
      screen.show(result({ outcome }));
      expect([...panel().walk()].find((n) => n.tag === "h1")!.textContent).toBe(text);
      expect(panel().classList.contains(`results-${outcome}`)).toBe(true);
    }
  });

  it("an outcome this client does not know gets a neutral title and no outcome class from the server's text", () => {
    screen.show(result({ outcome: "weird thing" as RunResult["outcome"] }));
    const p = panel();
    expect([...p.walk()].find((n) => n.tag === "h1")!.textContent).toBe("RUN OVER");
    expect(p.className).toBe("panel results results-over");
  });

  it("shows the place, a shared place for a draw, and the headline facts", () => {
    screen.show(result({ outcome: "draw", place: 1, players: 2, durationSec: 65, kills: 1 }));
    const p = panel();
    expect(p.byClass("result-place")!.textContent).toBe("#1 of 2 players (shared)");
    const facts = p.allByClass("result-fact").map((f) => [f.byClass("result-fact-l")!.textContent, f.byClass("result-fact-n")!.textContent]);
    expect(facts).toEqual([["Time", "1:05"], ["Kills", "1"]]);
  });

  it("names the killer only when there is one", () => {
    screen.show(result({ outcome: "died", killedBy: "Rival" }));
    expect(panel().byClass("result-killer")!.textContent).toBe("Killed by Rival");
    screen.show(result());
    expect(panel().byClass("result-killer")).toBeUndefined();
  });

  it("lists the GV rows, dims the empty ones and ends with the banked total", () => {
    screen.show(result());
    const rows = panel().allByClass("gv-row").map((r) => [r.children.map((c) => (typeof c === "string" ? c : c.textContent))]);
    expect(rows).toEqual([[["Kills", "+120"]], [["Mobs", "+30"]], [["Bounties", "+0"]], [["Win bonus", "+500"]]]);
    expect(panel().allByClass("gv-row").map((r) => r.classList.contains("zero"))).toEqual([false, false, true, false]);
    const total = panel().byClass("gv-total")!;
    expect(total.byClass("gv-total-l")!.textContent).toBe("GV banked");
    expect(total.byClass("gv-amount")!.textContent).toBe("+650");
  });

  it("a GV field missing from an older server's payload reads as nothing, not +NaN", () => {
    screen.show(result({ gv: { kills: 5, total: 5 } as RunResult["gv"] }));
    const amounts = panel().allByClass("gv-amount").map((a) => a.textContent);
    expect(amounts).toEqual(["+5", "+0", "+0", "+0", "+5"]);
  });

  it("says why a withheld win bonus reads +0", () => {
    screen.show(result({ winBonusWithheld: true, gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 } }));
    expect(panel().text).toMatch(/Win bonus: needs \d+\+ players and damage on \d+\+ opponents/);
  });

  it("lists unlocked achievements by their catalog names and skips ids it does not know", () => {
    screen.show(result({ achievements: ["first_blood", "no-such-achievement"] }));
    const box = panel().byClass("ach-box")!;
    expect(box.allByClass("ach-name").map((n) => n.textContent)).toEqual(["First Blood"]);
    screen.show(result({ achievements: ["no-such-achievement"] }));
    expect(panel().byClass("ach-box")).toBeUndefined();
  });

  it("the button calls onContinue and hide() takes the panel away", () => {
    screen.show(result());
    const button = [...panel().walk()].find((n) => n.tag === "button")!;
    expect(button.textContent).toBe("Back to hub");
    button.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    screen.hide();
    expect(screen.visible).toBe(false);
    expect(ui.children).toHaveLength(0);
  });

  it("showing twice keeps one panel", () => {
    screen.show(result());
    screen.show(result({ outcome: "died", killedBy: "x" }));
    expect(ui.children).toHaveLength(1);
  });
});
