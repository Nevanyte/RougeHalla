import { describe, expect, it } from "vitest";
import { questDefById } from "@raid/shared";
import { expireQuestPreviews, questCollections, questFromReveal, questMinimapBlips, questReady, questReward, questRows, questTurnIn, type QuestContainerLike, type QuestStateLike } from "../src/ui/questModel";

function quest(over: Partial<QuestStateLike> = {}): QuestStateLike {
  const progress = new Map<string, number>([["me", 1]]);
  return {
    id: "q1", def: "cull-fire", x: 100, y: 200, status: "open", doneBy: "", expiresAt: 65_000,
    carrier: "", progress, accepted: new Map([["me", true]]), ...over,
  };
}

function quests(rows: QuestStateLike[]) {
  return { forEach(cb: (q: QuestStateLike, id: string) => void) { for (const q of rows) cb(q, q.id); } };
}

function container(over: Partial<QuestContainerLike> = {}): QuestContainerLike {
  return {
    id: "c1", kind: "quest", x: 300, y: 400, label: "Parcel", items: [{ def: "quest:q1" }], ...over,
  };
}

describe("the reward a quest row shows", () => {
  const def = questDefById("cull-fire")!; // Offense II and 10 GV

  it("shows the fixed mob stat stack reward regardless of feed", () => {
    expect(questReward(def)).toBe("10 Ember Imp stacks (+10% damage) and 10 GV");
    expect(questReward(def, 999)).toBe(questReward(def));
    const row = (feed?: number) => questRows({ forEach: (cb) => cb(quest(), "q1") }, "me", 5_000, "", false, feed)[0]!;
    expect(row().reward).toBe(questReward(def));
    expect(row(999).reward).toBe(questReward(def));
  });

  it("shows the full quest reward and the uncapped resulting total", () => {
    expect(questReward(def, undefined, new Map([["emberImp", 9]]))).toBe("10 Ember Imp stacks (+10% damage; 19 total after this quest) and 10 GV");
    expect(questReward(def, undefined, new Map([["emberImp", 100]]))).toBe("10 Ember Imp stacks (+10% damage; 110 total after this quest) and 10 GV");
  });
});

describe("quest presentation model", () => {
  it("formats the public rows with objective, local progress, timer, card reward and status", () => {
    const rows = questRows(quests([quest()]), "me", 5_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objective: "Kill 3 mobs in Fire", progress: "1 / 3", time: "1:00", status: "Open",
      reward: "10 Ember Imp stacks (+10% damage) and 10 GV",
    });
  });

  it("marks a finished objective ready and a turn-in only in reach of the giver", () => {
    const ready = quest({ progress: new Map([["me", 3]]) });
    const def = { count: 3, kind: "kill" } as never;
    expect(questReady(ready, def, "me")).toBe(true);
    expect(questRows(quests([ready]), "me", 5_000)[0]?.status).toBe("Return to the giver");
    expect(questTurnIn(ready, def, "me", { x: 110, y: 200 })).toBe(true);
    expect(questTurnIn(ready, def, "me", { x: 500, y: 200 })).toBe(false);
  });

  it("names the completer, stops closed timers and reports expired public offers", () => {
    expect(questRows(quests([quest({ status: "done", doneBy: "Bravo" })]), "me", 5_000)[0]).toMatchObject({ status: "Done by Bravo", time: "" });
    expect(questRows(quests([quest()]), "me", 70_000)[0]).toMatchObject({ status: "Expired", time: "", expired: true });
    expect(questRows(quests([quest({ status: "expired" })]), "me", 5_000)[0]).toMatchObject({ status: "Expired", time: "", expired: true });
    // Planning: the clock is frozen and expiresAt is re-anchored at raid start, so the row shows the offer's fixed duration.
    expect(questRows(quests([quest()]), "me", 70_000, "", true)[0]).toMatchObject({ status: "Open", time: "2:30", expired: false });
  });

  it("keeps the fetch winner's progress complete and groups open rows before closed rows", () => {
    const done = quest({ id: "done", def: "banner-fire", status: "done", doneBy: "Me" });
    const expired = quest({ id: "expired", def: "bloom-plague", status: "expired" });
    const open = quest({ id: "open" });
    const rows = questRows(quests([done, expired, open]), "me", 5_000, "Me");
    expect(rows.map((row) => row.id)).toEqual(["open", "done", "expired"]);
    expect(rows[1]).toMatchObject({ progress: "1 / 1", time: "" });
  });

  it("shows the winner of any kind a full count, and never mistakes a nameless viewer for the winner", () => {
    const wonKill = quest({ id: "k", status: "done", doneBy: "Me", progress: new Map() });
    expect(questRows(quests([wonKill]), "me", 5_000, "Me")[0]).toMatchObject({ progress: "3 / 3", time: "", closed: true });
    const bravoFetch = quest({ id: "f", def: "banner-fire", status: "done", doneBy: "Bravo" });
    expect(questRows(quests([bravoFetch]), "me", 5_000, "Me")[0]?.progress).toBe("0 / 1");
    const nobody = quest({ id: "n", def: "banner-fire", status: "done", doneBy: "" });
    expect(questRows(quests([nobody]), "me", 5_000, "")[0]?.progress).toBe("0 / 1");
  });

  it("counts a closed row by the server's word or by the clock, and never gives it a timer", () => {
    const rows = questRows(quests([quest({ id: "a", status: "done", doneBy: "Bravo" }), quest({ id: "b", status: "expired" }), quest({ id: "c" })]), "me", 70_000);
    expect(rows.map((r) => [r.id, r.closed, r.time])).toEqual([["a", true, ""], ["b", true, ""], ["c", true, ""]]);
    expect(questRows(quests([quest()]), "me", 5_000)[0]).toMatchObject({ closed: false, time: "1:00" });
  });

  it("keeps the nominal reward in closed history regardless of the viewer's current feed", () => {
    const def = questDefById("cull-fire")!;
    const fed = 999;
    const completed = [
      quest({ status: "done", doneBy: "Bravo" }),
      quest({ status: "expired" }),
      quest({ expiresAt: 0 }), // expired by the server clock
    ];
    for (const q of completed) {
      expect(questRows(quests([q]), "me", 70_000, "", false, fed)[0]?.reward).toBe(questReward(def));
    }
  });

  it("does not count a revealed offer as rumoured while its preview row is shown", () => {
    const preview = questFromReveal({ id: "q1", def: "cull-fire", x: 100, y: 200, expiresAt: 65_000 });
    expect(questCollections({ quests: quests([]), unknownQuests: 5 }, preview, 0).hidden).toBe(4);
    expect(questCollections({ quests: quests([quest()]), unknownQuests: 4 }, preview, 0).hidden).toBe(4);
    expect(questCollections({ quests: quests([]), unknownQuests: 0 }, preview, 0).hidden).toBe(0);
  });

  it("forgets every private preview once the gates lock or the run ends, since the server deletes them silently", () => {
    const first = questFromReveal({ id: "q1", def: "cull-fire", x: 100, y: 200, expiresAt: 65_000 });
    const store = new Map([["q1", first]]);
    expireQuestPreviews(store, 1_000);
    expect(store.size).toBe(1);
    expireQuestPreviews(store, 1_000, true);
    expect(store.size).toBe(0);
  });

  it("does not display a legacy unknown row and reads only the synced unknown count", () => {
    const data = questCollections({ quests: quests([quest({ known: false })]), unknownQuests: 5 });
    expect(data.hidden).toBe(5);
    expect(questRows(data.quests, "me", 0)).toEqual([]);
  });

  it("shows a private reveal during its head start, then deduplicates the public row", () => {
    const preview = questFromReveal({ id: "q1", def: "cull-fire", x: 100, y: 200, expiresAt: 65_000 });
    expect(questRows(questCollections({ quests: quests([]) }, preview).quests, "me", 0)).toHaveLength(1);
    expect(questRows(questCollections({ quests: quests([quest()]) }, preview).quests, "me", 0)).toHaveLength(1);
  });

  it("keeps simultaneous private previews, deduplicates publication and expires stale entries", () => {
    const first = questFromReveal({ id: "q1", def: "cull-fire", x: 100, y: 200, expiresAt: 65_000 });
    const second = questFromReveal({ id: "q2", def: "banner-fire", x: 300, y: 400, expiresAt: 70_000 });
    const both = questCollections({ quests: quests([]) }, [first, second], 1_000);
    expect(questRows(both.quests, "me", 1_000).map((row) => row.id).sort()).toEqual(["q1", "q2"]);
    const published = questCollections({ quests: quests([quest()]) }, [first, second], 1_000);
    expect(questRows(published.quests, "me", 1_000).map((row) => row.id)).toEqual(["q1", "q2"]);
    expect(questRows(questCollections({ quests: quests([]) }, [first, second], 66_000).quests, "me", 66_000).map((row) => row.id)).toEqual(["q2"]);
    const store = new Map([["q1", first], ["q2", second]]);
    expireQuestPreviews(store, 66_000);
    expect([...store.keys()]).toEqual(["q2"]);
  });

  it("words the fixed stat reward and GV for every quest kind", () => {
    expect(questReward(questRows(quests([quest({ def: "banner-fire" })]), "me", 0)[0]!.def)).toContain("Cinder Hound stacks");
    expect(questReward(questRows(quests([quest({ def: "banner-fire" })]), "me", 0)[0]!.def)).toContain("8 Cinder Hound stacks (+4% move speed)");
  });
});

describe("quest minimap model", () => {
  const boxes = (rows: QuestContainerLike[]) => ({
    forEach(cb: (c: QuestContainerLike, id: string) => void) { for (const c of rows) cb(c, c.id); },
  });

  it("shows a known giver and its nearest ground objective", () => {
    const data = questMinimapBlips(
      quests([quest({ def: "banner-fire" })]),
      boxes([container({ x: 500, y: 400 }), container({ id: "c2", x: 280, y: 400 })]),
      "me", { x: 300, y: 400 }, new Map(), null,
    );
    expect(data.map((b) => b.role)).toEqual(["giver", "objective", "objective"]);
    expect(data[1]).toMatchObject({ x: 280, y: 400, kind: "fetch" });
    expect(data[1]!.privateObjective).toBe(true);
    expect(data[2]!.privateObjective).toBe(true);
  });

  it("keeps an exact carrier blip independent of fighter visibility", () => {
    const q = quest({ def: "banner-fire", carrier: "remote" });
    const data = questMinimapBlips(quests([q]), boxes([]), "me", undefined, new Map([["remote", { x: 700, y: 800 }]]), null);
    expect(data).toContainEqual({ role: "carrier", kind: "fetch", x: 700, y: 800 });
  });

  it("selects only one nearest item across all collect quests, but keeps every known giver", () => {
    const first = quest({ def: "bloom-plague" });
    const second = quest({ id: "q2", def: "tithe-holy", x: 500, y: 500 });
    const items = [
      container({ id: "near", x: 110, y: 100 }),
      container({ id: "far", x: 800, y: 800 }),
      container({ id: "other", x: 200, y: 200, items: [{ def: "quest:q2" }] }),
    ];
    const data = questMinimapBlips(quests([first, second]), boxes(items), "me", { x: 100, y: 100 }, new Map(), null);
    expect(data.map((b) => b.role)).toEqual(["giver", "giver", "objective", "objective", "objective"]);
    expect(data[2]).toMatchObject({ x: 110, y: 100, kind: "collect" });
    expect(data.filter((b) => b.privateObjective).map((b) => b.x)).toEqual([110, 800, 200]);
  });

  it("uses a ready local objective's giver as the turn-in blip", () => {
    const ready = quest({ def: "bloom-plague", progress: new Map([["me", 3]]) });
    const data = questMinimapBlips(quests([ready]), boxes([]), "me", { x: 100, y: 100 }, new Map(), null);
    expect(data).toContainEqual(expect.objectContaining({ role: "objective", kind: "collect", x: 100, y: 200 }));
  });

  it("leaves no giver, carrier or objective for a done or expired offer", () => {
    for (const status of ["done", "expired"]) {
      const closed = quest({ def: "banner-fire", status, carrier: "remote", doneBy: "Bravo" });
      const data = questMinimapBlips(
        quests([closed]), boxes([container({ x: 280, y: 400 })]), "me", { x: 300, y: 400 }, new Map([["remote", { x: 700, y: 800 }]]), null,
      );
      expect(data, status).toEqual([]);
    }
    const ready = quest({ def: "bloom-plague", status: "done", progress: new Map([["me", 3]]) });
    expect(questMinimapBlips(quests([ready]), boxes([]), "me", { x: 100, y: 100 }, new Map(), null)).toEqual([]);
  });

  it("does not leak an unknown giver", () => {
    expect(questMinimapBlips(quests([quest({ known: false })]), boxes([]), "me", { x: 0, y: 0 }, new Map(), null)).toEqual([]);
  });
});

describe("the accept state in rows and on the minimap", () => {
  const boxes = (rows: QuestContainerLike[]) => ({
    forEach(cb: (c: QuestContainerLike, id: string) => void) { for (const c of rows) cb(c, c.id); },
  });
  const none = new Map<string, boolean>();

  it("marks each open row Accepted or Not accepted with the giver to talk to, and says what to do in planning", () => {
    const yes = questRows(quests([quest()]), "me", 5_000)[0]!;
    expect(yes).toMatchObject({ accepted: true, acceptance: "Accepted" });
    const no = questRows(quests([quest({ accepted: none })]), "me", 5_000)[0]!;
    expect(no).toMatchObject({ accepted: false, acceptance: "Not accepted: talk to Ashmother Vela" });
    // Only the local player's accept counts, and a preview (no set at all) is not accepted.
    expect(questRows(quests([quest({ accepted: new Map([["remote", true]]) })]), "me", 5_000)[0]!.accepted).toBe(false);
    expect(questRows(quests([quest({ accepted: undefined })]), "me", 5_000)[0]!.accepted).toBe(false);
    expect(questRows(quests([quest({ accepted: none })]), "me", 5_000, "", true)[0]!.acceptance).toBe("Accept at the giver in the run");
    // A closed row has no acceptance line; the status stays the row's own word.
    expect(questRows(quests([quest({ status: "expired" })]), "me", 5_000)[0]!.acceptance).toBe("");
    expect(no.status).toBe("Open");
  });

  it("gives every giver blip its accepted flag, solid for a held offer", () => {
    const data = questMinimapBlips(
      quests([quest({ id: "a" }), quest({ id: "b", x: 500, y: 500, accepted: none })]), boxes([]), "me", undefined, new Map(), null,
    );
    expect(data.filter((b) => b.role === "giver").map((b) => b.accepted)).toEqual([true, false]);
  });

  it("points the one objective at the nearest open giver while nothing is accepted", () => {
    const far = quest({ id: "far", def: "bloom-plague", x: 900, y: 900, accepted: none });
    const near = quest({ id: "near", def: "tithe-holy", x: 200, y: 100, accepted: none });
    // Items of an offer that has not been accepted are not what to walk to: the giver is.
    const items = [container({ id: "i", x: 110, y: 100, items: [{ def: "quest:far" }] })];
    const data = questMinimapBlips(quests([far, near]), boxes(items), "me", { x: 100, y: 100 }, new Map(), null);
    expect(data.filter((b) => b.role === "objective")).toMatchObject([{ role: "objective", kind: "collect", x: 200, y: 100 }]);
  });

  it("points at an accepted offer's objective even when an unaccepted giver is nearer", () => {
    const held = quest({ id: "held", def: "bloom-plague", x: 900, y: 900 });
    const open = quest({ id: "open", def: "tithe-holy", x: 120, y: 100, accepted: none });
    const items = [container({ id: "i", x: 700, y: 100, items: [{ def: "quest:held" }] })];
    const data = questMinimapBlips(quests([held, open]), boxes(items), "me", { x: 100, y: 100 }, new Map(), null);
    expect(data.filter((b) => b.role === "objective")).toMatchObject([{ role: "objective", kind: "collect", x: 700, y: 100 }]);
  });
});
