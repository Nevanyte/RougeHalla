import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../src/achievements";
import {
  activeGold, COSMETIC_SLOTS, COSMETICS, cosmeticById, cosmeticsInSlot, cssColor, GOLD_FACTIONS, GOLD_SLOTS,
  GOLD_TARGETS, GOLD_WEAPONS, isCosmeticSlot, isForSale, LOOK_FIELDS, LOOK_NONE, packLook, unpackLook,
  type Cosmetic, type CosmeticSlot,
} from "../src/cosmetics";
import { FACTION_IDS } from "../src/factions";
import * as shared from "../src/index";
import { REGION_WEAPONS } from "../src/map";
import { mulberry32 } from "../src/rng";

type FieldSlot = "skin" | "outline" | "trail" | "title";
const FIELD_SLOTS: readonly FieldSlot[] = ["skin", "outline", "trail", "title"];
const ALL_IDS = COSMETICS.map((c) => c.id);
const CODE_LIMIT = (bits: number): number => 2 ** bits;

// A look from ids the player owns, through the real pack/unpack pair.
const lookOf = (...ids: string[]) => {
  const equipped: Record<string, string> = {};
  for (const id of ids) equipped[cosmeticById(id)!.slot] = id;
  return unpackLook(packLook(equipped, ids));
};

describe("catalog invariants", () => {
  it("has unique ids made only of lowercase letters and hyphens", () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
    for (const id of ALL_IDS) expect(id).toMatch(/^[a-z-]+$/);
  });

  it("has an id that starts with its slot's kind (profiles store ids, so a rename is a migration)", () => {
    for (const c of COSMETICS) {
      if (c.slot.startsWith("gold-")) expect(c.id).toBe(`gilded-${c.slot.slice("gold-".length)}`);
      else expect(c.id.startsWith(`${c.slot}-`)).toBe(true);
    }
  });

  it("gives every slot at least one item, and only known slots", () => {
    for (const slot of COSMETIC_SLOTS) expect(cosmeticsInSlot(slot).length).toBeGreaterThan(0);
    for (const c of COSMETICS) expect(COSMETIC_SLOTS).toContain(c.slot);
    expect(cosmeticsInSlot("skin")).toEqual(COSMETICS.filter((c) => c.slot === "skin"));
  });

  it("lists the slots as the four plain ones plus one gold slot per target", () => {
    expect(COSMETIC_SLOTS).toEqual([...FIELD_SLOTS, ...GOLD_SLOTS]);
    expect(GOLD_SLOTS).toEqual(GOLD_TARGETS.map((t) => `gold-${t}`));
    for (const slot of COSMETIC_SLOTS) expect(isCosmeticSlot(slot)).toBe(true);
    for (const v of ["gold", "gold-axe-axe", "", "__proto__", "constructor", 3, null, undefined, {}]) {
      expect(isCosmeticSlot(v)).toBe(false);
    }
  });

  it("has wire codes that are unique per slot, whole, from 1, and fit the slot's bits", () => {
    for (const slot of FIELD_SLOTS) {
      const items = cosmeticsInSlot(slot);
      const codes = items.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(Number.isInteger(code)).toBe(true);
        expect(code).toBeGreaterThanOrEqual(1);
        expect(code).toBeLessThan(CODE_LIMIT(LOOK_FIELDS[slot].bits));
      }
    }
  });

  it("has exactly one golden variant per target: code = 1-based index in GOLD_TARGETS, id gilded-<target>", () => {
    for (const slot of GOLD_SLOTS) expect(cosmeticsInSlot(slot)).toHaveLength(1);
    GOLD_TARGETS.forEach((target, i) => {
      const [c] = cosmeticsInSlot(`gold-${target}`);
      expect(c).toMatchObject({ id: `gilded-${target}`, slot: `gold-${target}`, code: i + 1, target });
      expect(c!.code).toBeLessThan(CODE_LIMIT(LOOK_FIELDS.gold.bits));
    });
    expect(LOOK_FIELDS.gold.bits).toBe(GOLD_TARGETS.length);
  });

  it("has prices that are positive safe integers when present", () => {
    for (const c of COSMETICS) {
      if (c.price === undefined) continue;
      expect(Number.isSafeInteger(c.price)).toBe(true);
      expect(c.price).toBeGreaterThan(0);
    }
  });

  it("has colours that fit 24 bits and non-empty names", () => {
    for (const c of COSMETICS) {
      expect(c.name.length).toBeGreaterThan(0);
      if ("color" in c) {
        expect(Number.isInteger(c.color)).toBe(true);
        expect(c.color).toBeGreaterThanOrEqual(0);
        expect(c.color).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it("ties golden variants to the real factions and weapons", () => {
    for (const f of GOLD_FACTIONS) expect(FACTION_IDS).toContain(f);
    expect([...GOLD_FACTIONS].sort()).toEqual([...FACTION_IDS].sort());
    expect([...GOLD_WEAPONS].sort()).toEqual([...new Set(Object.values(REGION_WEAPONS))].sort());
    expect(new Set(GOLD_TARGETS).size).toBe(GOLD_TARGETS.length);
  });

  it("keeps the look word's fields apart and under 32 bits", () => {
    const fields = Object.values(LOOK_FIELDS).sort((a, b) => a.shift - b.shift);
    for (const f of fields) {
      expect(f.bits).toBeGreaterThan(0);
      expect(f.shift).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i]!.shift).toBeGreaterThanOrEqual(fields[i - 1]!.shift + fields[i - 1]!.bits);
    }
    const last = fields[fields.length - 1]!;
    expect(last.shift + last.bits).toBeLessThan(32);
  });
});

describe("catalog and achievements agree", () => {
  const rewarded = new Set(ACHIEVEMENTS.flatMap((a) => a.reward));

  it("has an achievement that grants every cosmetic that is not for sale", () => {
    const orphans = COSMETICS.filter((c) => c.price === undefined && !rewarded.has(c.id)).map((c) => c.id);
    expect(orphans).toEqual([]);
  });

  it("only rewards ids that exist", () => {
    for (const id of rewarded) expect(cosmeticById(id), id).toBeDefined();
  });

  it("leaves no title or golden variant that is neither priced nor rewarded", () => {
    const stranded = COSMETICS.filter((c) => (c.slot === "title" || c.slot.startsWith("gold-")) && !isForSale(c) && !rewarded.has(c.id));
    expect(stranded.map((c) => c.id)).toEqual([]);
  });

  it("sells the golden variants and also awards each one", () => {
    for (const c of COSMETICS.filter((x) => x.slot.startsWith("gold-"))) {
      expect(isForSale(c), c.id).toBe(true);
      expect(rewarded.has(c.id), c.id).toBe(true);
    }
  });
});

describe("cosmeticById", () => {
  it("finds every catalog item, returning the catalog object itself", () => {
    for (const c of COSMETICS) expect(cosmeticById(c.id)).toBe(c);
  });

  it("returns undefined for unknown ids, non-strings and prototype names", () => {
    const junk: unknown[] = [
      "", "skin-nope", "SKIN-CRIMSON", " skin-crimson", "__proto__", "constructor", "toString", "hasOwnProperty",
      undefined, null, 0, 1, true, {}, [], ["skin-crimson"], { toString: () => "skin-crimson" },
    ];
    for (const v of junk) expect(cosmeticById(v)).toBeUndefined();
  });
});

describe("isForSale", () => {
  const base = COSMETICS.find((c) => c.id === "skin-crimson") as Cosmetic;

  it("is true for a priced item and false for an earned-only one", () => {
    expect(isForSale(base)).toBe(true);
    expect(isForSale(cosmeticById("skin-laurel")!)).toBe(false);
  });

  it("agrees with the catalog: priced exactly when a price is set", () => {
    for (const c of COSMETICS) expect(isForSale(c)).toBe(c.price !== undefined);
  });

  it("rejects prices that are not positive whole GV", () => {
    for (const price of [0, -1, 0.5, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isForSale({ ...base, price }), String(price)).toBe(false);
    }
    expect(isForSale({ ...base, price: 1 })).toBe(true);
    expect(isForSale({ ...base, price: Number.MAX_SAFE_INTEGER })).toBe(true);
    expect(isForSale({ ...base, price: "40" as unknown as number })).toBe(false);
  });
});

describe("packLook / unpackLook", () => {
  it("round-trips every cosmetic on its own", () => {
    for (const c of COSMETICS) {
      const word = packLook({ [c.slot]: c.id }, [c.id]);
      expect(word, c.id).toBeGreaterThan(0);
      const look = unpackLook(word);
      if (c.slot.startsWith("gold-")) {
        expect(look.gold, c.id).toEqual([c]);
        expect(look.gold[0]).toBe(c);
        for (const s of FIELD_SLOTS) expect(look[s], c.id).toBeUndefined();
      } else {
        expect(look[c.slot as FieldSlot], c.id).toBe(c);
        for (const s of FIELD_SLOTS) if (s !== c.slot) expect(look[s], c.id).toBeUndefined();
        expect(look.gold, c.id).toEqual([]);
      }
    }
  });

  it("round-trips one item per slot with several golds at once", () => {
    const pick = (slot: CosmeticSlot, i: number) => cosmeticsInSlot(slot)[i]!;
    const items = [
      pick("skin", 0), pick("outline", 2), pick("trail", 6), pick("title", 5),
      pick("gold-fire", 0), pick("gold-holy", 0), pick("gold-sword", 0), pick("gold-shield", 0),
    ];
    const equipped = Object.fromEntries(items.map((c) => [c.slot, c.id]));
    const look = unpackLook(packLook(equipped, items.map((c) => c.id)));
    expect(look.skin).toBe(items[0]);
    expect(look.outline).toBe(items[1]);
    expect(look.trail).toBe(items[2]);
    expect(look.title).toBe(items[3]);
    expect(look.gold.map((g) => g.id).sort()).toEqual(["gilded-fire", "gilded-holy", "gilded-shield", "gilded-sword"]);
  });

  it("round-trips the highest code of each field and every golden bit at once", () => {
    const top = FIELD_SLOTS.map((s) => cosmeticsInSlot(s).reduce((a, b) => (b.code > a.code ? b : a)));
    const golds = COSMETICS.filter((c) => c.slot.startsWith("gold-"));
    const items = [...top, ...golds];
    const word = packLook(Object.fromEntries(items.map((c) => [c.slot, c.id])), items.map((c) => c.id));
    const look = unpackLook(word);
    FIELD_SLOTS.forEach((s, i) => expect(look[s]).toBe(top[i]));
    expect(look.gold).toEqual(golds);
    expect(word).toBeLessThan(2 ** 31);
  });

  it("round-trips pseudo-random loadouts", () => {
    const rng = mulberry32(0x10a4);
    for (let n = 0; n < 300; n++) {
      const items: Cosmetic[] = [];
      for (const slot of COSMETIC_SLOTS) {
        if (rng() < 0.4) continue;
        const choices = cosmeticsInSlot(slot);
        items.push(choices[Math.floor(rng() * choices.length)]!);
      }
      const word = packLook(Object.fromEntries(items.map((c) => [c.slot, c.id])), ALL_IDS);
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThan(2 ** 31);
      const look = unpackLook(word);
      for (const s of FIELD_SLOTS) expect(look[s]).toBe(items.find((c) => c.slot === s));
      expect(look.gold.map((g) => g.id).sort()).toEqual(items.filter((c) => c.slot.startsWith("gold-")).map((c) => c.id).sort());
    }
  });

  it("packs an empty set to LOOK_NONE, even when everything is owned", () => {
    expect(LOOK_NONE).toBe(0);
    expect(packLook({}, [])).toBe(LOOK_NONE);
    expect(packLook({}, ALL_IDS)).toBe(LOOK_NONE);
    expect(unpackLook(LOOK_NONE)).toEqual({ gold: [] });
  });

  it("is independent of the order of the equipped keys and of the owned list", () => {
    const a = packLook({ skin: "skin-crimson", title: "title-rookie", "gold-axe": "gilded-axe" }, ["gilded-axe", "title-rookie", "skin-crimson"]);
    const b = packLook({ "gold-axe": "gilded-axe", title: "title-rookie", skin: "skin-crimson" }, ["skin-crimson", "gilded-axe", "title-rookie"]);
    expect(a).toBe(b);
  });

  it("ignores an item that is not owned, and keeps the owned ones beside it", () => {
    expect(packLook({ skin: "skin-crimson" }, [])).toBe(LOOK_NONE);
    expect(packLook({ skin: "skin-crimson" }, ["skin-amber"])).toBe(LOOK_NONE);
    const word = packLook({ skin: "skin-crimson", title: "title-rookie" }, ["title-rookie"]);
    expect(word).toBe(packLook({ title: "title-rookie" }, ["title-rookie"]));
    expect(unpackLook(word).skin).toBeUndefined();
    expect(unpackLook(word).title?.id).toBe("title-rookie");
  });

  it("ignores an unknown id, even if the profile claims to own it", () => {
    expect(packLook({ skin: "skin-nope" }, ["skin-nope"])).toBe(LOOK_NONE);
    expect(packLook({ title: "" }, [""])).toBe(LOOK_NONE);
  });

  it("ignores an id equipped in the wrong slot", () => {
    expect(packLook({ outline: "skin-crimson" }, ["skin-crimson"])).toBe(LOOK_NONE);
    expect(packLook({ skin: "gilded-fire" }, ["gilded-fire"])).toBe(LOOK_NONE);
    expect(packLook({ "gold-fire": "gilded-sword" }, ["gilded-sword"])).toBe(LOOK_NONE);
    expect(packLook({ "gold-fire": "title-rookie" }, ["title-rookie"])).toBe(LOOK_NONE);
  });

  it("ignores unknown slots and non-string values", () => {
    expect(packLook({ hat: "skin-crimson" }, ["skin-crimson"])).toBe(LOOK_NONE);
    const bad = [5, null, undefined, true, {}, ["skin-crimson"], { toString: () => "skin-crimson" }] as unknown[];
    for (const v of bad) {
      expect(packLook({ skin: v as string }, ["skin-crimson", "5"]), String(v)).toBe(LOOK_NONE);
    }
  });

  it("ignores prototype-ish slots and ids", () => {
    const owned = ["__proto__", "constructor", "skin-crimson"];
    expect(packLook(JSON.parse('{"__proto__":"skin-crimson","constructor":"skin-crimson"}'), owned)).toBe(LOOK_NONE);
    expect(packLook({ skin: "__proto__" }, owned)).toBe(LOOK_NONE);
    expect(packLook({ skin: "constructor" }, owned)).toBe(LOOK_NONE);
    expect(packLook({ "gold-fire": "constructor" }, owned)).toBe(LOOK_NONE);
    expect(packLook(JSON.parse('{"skin":"__proto__","title":"constructor"}'), owned)).toBe(LOOK_NONE);
  });

  it("reads only own keys of the equipped record", () => {
    const inherited = Object.create({ skin: "skin-crimson" }) as Record<string, string>;
    expect(packLook(inherited, ["skin-crimson"])).toBe(LOOK_NONE);
  });

  it("keeps the word a whole number below 2^31 with every field full", () => {
    const items = COSMETICS.filter((c) => c.slot.startsWith("gold-"));
    const word = packLook(Object.fromEntries(items.map((c) => [c.slot, c.id])), ALL_IDS);
    expect(Number.isInteger(word)).toBe(true);
    expect(word).toBeLessThan(2 ** 31);
    expect(word).toBe(((1 << GOLD_TARGETS.length) - 1) * 2 ** LOOK_FIELDS.gold.shift);
  });

  describe("unpackLook is total", () => {
    const isShape = (look: ReturnType<typeof unpackLook>): void => {
      expect(Array.isArray(look.gold)).toBe(true);
      expect(look.gold.length).toBeLessThanOrEqual(GOLD_TARGETS.length);
      for (const g of look.gold) {
        expect(g.slot.startsWith("gold-")).toBe(true);
        expect(cosmeticById(g.id)).toBe(g);
      }
      for (const s of FIELD_SLOTS) {
        const c = look[s];
        if (c !== undefined) {
          expect(c.slot).toBe(s);
          expect(cosmeticById(c.id)).toBe(c);
        }
      }
      expect(Object.keys(look).every((k) => k === "gold" || (FIELD_SLOTS as readonly string[]).includes(k))).toBe(true);
    };

    it("never throws on random uint32 words, and returns a well-formed look", () => {
      const rng = mulberry32(0xc0517e);
      for (let i = 0; i < 20000; i++) isShape(unpackLook(Math.floor(rng() * 2 ** 32)));
    });

    it("re-packs to a word that decodes to the same look and sets no bit the input lacked", () => {
      const rng = mulberry32(0x5eed);
      for (let i = 0; i < 5000; i++) {
        const word = Math.floor(rng() * 2 ** 32);
        const look = unpackLook(word);
        const items = [...FIELD_SLOTS.map((s) => look[s]), ...look.gold].filter((c): c is Cosmetic => c !== undefined);
        const packed = packLook(Object.fromEntries(items.map((c) => [c.slot, c.id])), ALL_IDS);
        expect(unpackLook(packed)).toEqual(look);
        expect(packed & ~word).toBe(0);
      }
    });

    it("ignores bit 31", () => {
      const rng = mulberry32(31);
      for (let i = 0; i < 200; i++) {
        const w = Math.floor(rng() * 2 ** 31);
        expect(unpackLook(w + 2 ** 31)).toEqual(unpackLook(w));
      }
    });

    it("handles NaN, Infinity, negatives, fractions and the largest uint32", () => {
      for (const w of [NaN, Infinity, -Infinity, -1, -(2 ** 31), -(2 ** 32), 2 ** 32 - 1, 2 ** 32, 2 ** 53, 0.5, 1.9, Number.MAX_VALUE]) {
        expect(() => unpackLook(w), String(w)).not.toThrow();
        isShape(unpackLook(w));
      }
      expect(unpackLook(NaN)).toEqual({ gold: [] });
      expect(unpackLook(Infinity)).toEqual({ gold: [] });
      expect(unpackLook(-Infinity)).toEqual({ gold: [] });
      expect(unpackLook(-1)).toEqual(unpackLook(2 ** 32 - 1));
      expect(unpackLook(2 ** 32)).toEqual({ gold: [] });
    });

    it("drops codes and bits that match nothing in the catalog", () => {
      const unusedSkinCode = Math.max(...cosmeticsInSlot("skin").map((c) => c.code)) + 1;
      expect(unusedSkinCode).toBeLessThan(CODE_LIMIT(LOOK_FIELDS.skin.bits));
      expect(unpackLook(unusedSkinCode << LOOK_FIELDS.skin.shift).skin).toBeUndefined();
      expect(unpackLook((CODE_LIMIT(LOOK_FIELDS.title.bits) - 1) << LOOK_FIELDS.title.shift).title).toBeUndefined();
    });
  });
});

describe("activeGold", () => {
  const fire = cosmeticById("gilded-fire")!;
  const sword = cosmeticById("gilded-sword")!;

  it("matches only the faction and weapon given", () => {
    const look = lookOf("gilded-fire", "gilded-sword");
    expect(activeGold(look, { faction: "fire" })).toEqual({ faction: fire });
    expect(activeGold(look, { weapon: "sword" })).toEqual({ weapon: sword });
    expect(activeGold(look, { faction: "frost", weapon: "axe" })).toEqual({});
    expect(activeGold(look, { faction: "fire", weapon: "axe" })).toEqual({ faction: fire });
    expect(activeGold(look, { faction: "frost", weapon: "sword" })).toEqual({ weapon: sword });
  });

  it("never matches an undefined faction or weapon", () => {
    const look = lookOf(...ALL_IDS.filter((id) => id.startsWith("gilded-")));
    expect(activeGold(look, {})).toEqual({});
    expect(activeGold(look, { faction: undefined, weapon: undefined })).toEqual({});
    expect(activeGold(look, { faction: "fire" }).weapon).toBeUndefined();
    expect(activeGold(look, { weapon: "bow" }).faction).toBeUndefined();
  });

  it("does not report a faction gold as the weapon one, or the reverse", () => {
    const factionOnly = lookOf("gilded-fire");
    const weaponOnly = lookOf("gilded-sword");
    expect(activeGold(factionOnly, { faction: "fire", weapon: "sword" })).toEqual({ faction: fire });
    expect(activeGold(weaponOnly, { faction: "fire", weapon: "sword" })).toEqual({ weapon: sword });
    expect(activeGold(factionOnly, { weapon: "sword" })).toEqual({});
    expect(activeGold(weaponOnly, { faction: "fire" })).toEqual({});
  });

  it("can show a faction gold and a weapon gold together", () => {
    const both = activeGold(lookOf("gilded-fire", "gilded-sword", "gilded-frost", "gilded-bow"), { faction: "fire", weapon: "sword" });
    expect(both).toEqual({ faction: fire, weapon: sword });
  });

  it("reports nothing for a look without golds", () => {
    expect(activeGold(unpackLook(LOOK_NONE), { faction: "fire", weapon: "sword" })).toEqual({});
    expect(activeGold(lookOf("skin-crimson", "title-rookie"), { faction: "fire", weapon: "sword" })).toEqual({});
  });

  it("finds each golden variant by its own target", () => {
    const look = lookOf(...ALL_IDS.filter((id) => id.startsWith("gilded-")));
    for (const f of GOLD_FACTIONS) expect(activeGold(look, { faction: f }).faction?.id).toBe(`gilded-${f}`);
    for (const w of GOLD_WEAPONS) expect(activeGold(look, { weapon: w }).weapon?.id).toBe(`gilded-${w}`);
  });
});

describe("cssColor", () => {
  it("formats #rrggbb with zero padding", () => {
    expect(cssColor(0xff8000)).toBe("#ff8000");
    expect(cssColor(0xff)).toBe("#0000ff");
    expect(cssColor(0)).toBe("#000000");
    expect(cssColor(0xffffff)).toBe("#ffffff");
    expect(cssColor(0x0a0b0c)).toBe("#0a0b0c");
  });

  it("drops anything above 24 bits", () => {
    expect(cssColor(0x1ff8000)).toBe("#ff8000");
  });

  it("formats every catalog colour", () => {
    for (const c of COSMETICS) if ("color" in c) expect(cssColor(c.color)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("shared index", () => {
  it("re-exports the cosmetics API", () => {
    expect(shared.packLook).toBe(packLook);
    expect(shared.unpackLook).toBe(unpackLook);
    expect(shared.COSMETICS).toBe(COSMETICS);
    expect(shared.activeGold).toBe(activeGold);
  });
});
