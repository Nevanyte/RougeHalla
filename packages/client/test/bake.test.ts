// render/bake.ts: drawings that do not change are painted once into a texture and shown as Images. The scene is fake (test/fakes.ts):
// its texture manager remembers what was baked.
import { describe, expect, it } from "vitest";
import { BAKE_SCALE, PIXEL_TEXTURE_KEY, around, bakedImage, ensureBake, pixelImage, placeBake, scaledPart, swapBake } from "../src/render/bake";
import { argsOf, fakeScene, fk } from "./fakes";

const REGION = { x0: -10, y0: -6, x1: 30, y1: 14 };

describe("ensureBake", () => {
  it("paints a texture once and gives the same key for the same look", () => {
    const { scene, baked } = fakeScene();
    let draws = 0;
    const draw = () => { draws++; };
    const a = ensureBake(scene, "thing", REGION, draw);
    const b = ensureBake(scene, "thing", REGION, draw);
    expect(a).toBe("bk:thing");
    expect(b).toBe(a);
    expect(draws).toBe(1);
    expect(baked.has("bk:thing")).toBe(true);
  });

  it("holds the region at the texel density, with the drawing's coordinates shifted so the region's corner is the texture's", () => {
    const { scene, baked } = fakeScene();
    ensureBake(scene, "thing", REGION, (g) => { g.fillRect(0, 0, 4, 4); });
    const b = baked.get("bk:thing")!;
    expect(b.size).toEqual([40 * BAKE_SCALE, 20 * BAKE_SCALE]);
    const names = b.calls.map(([n]) => n);
    // Scale first, then the shift in world pixels, then the drawing.
    expect(names.slice(0, 3)).toEqual(["scaleCanvas", "translateCanvas", "fillRect"]);
    expect(b.calls[0]![1]).toEqual([BAKE_SCALE, BAKE_SCALE]);
    expect(b.calls[1]![1]).toEqual([10, 6]);
  });

  it("rounds a fractional size up, so no edge is cut", () => {
    const { scene, baked } = fakeScene();
    ensureBake(scene, "frac", { x0: 0, y0: 0, x1: 10.2, y1: 3.1 }, () => {}, 2);
    expect(baked.get("bk:frac")!.size).toEqual([21, 7]);
  });

  it("keeps different keys apart", () => {
    const { scene, baked } = fakeScene();
    ensureBake(scene, "a", REGION, () => {});
    ensureBake(scene, "b", REGION, () => {});
    expect([...baked.keys()].sort()).toEqual(["bk:a", "bk:b"]);
  });
});

describe("placeBake and bakedImage", () => {
  it("puts the drawing's origin on the image's position, at the drawing's own size", () => {
    const { scene } = fakeScene();
    const real = bakedImage(scene, "thing", REGION, () => {});
    const img = fk(real);
    expect(argsOf(img, "setOrigin")[0]).toEqual([10 / 40, 6 / 20]);
    expect(img.state.scale).toBe(1 / BAKE_SCALE);
    expect(img.state.texture).toBe("bk:thing");
  });

  it("is also how an image swaps to the same region's other bakes", () => {
    const { scene } = fakeScene();
    const real = pixelImage(scene);
    const img = fk(real);
    placeBake(real, around(16));
    expect(argsOf(img, "setOrigin").at(-1)).toEqual([0.5, 0.5]);
  });
});

describe("swapBake", () => {
  it("changes the texture only when the look is another one", () => {
    const { scene } = fakeScene();
    const real = bakedImage(scene, "one", REGION, () => {});
    const img = fk(real);
    const sets = () => argsOf(img, "setTexture").length;
    swapBake(real, scene, "one", REGION, () => {});
    expect(sets()).toBe(0);
    swapBake(real, scene, "two", REGION, () => {});
    expect(sets()).toBe(1);
    expect(img.state.texture).toBe("bk:two");
    swapBake(real, scene, "two", REGION, () => {});
    expect(sets()).toBe(1);
  });
});

describe("pixelImage", () => {
  it("is an Image of one shared 1x1 texture", () => {
    const { scene, baked } = fakeScene();
    const a = fk(pixelImage(scene));
    const b = fk(pixelImage(scene));
    expect(a.state.texture).toBe(PIXEL_TEXTURE_KEY);
    expect(b.state.texture).toBe(PIXEL_TEXTURE_KEY);
    expect(baked.get(PIXEL_TEXTURE_KEY)!.size).toEqual([1, 1]);
    expect([...baked.keys()]).toEqual([PIXEL_TEXTURE_KEY]);
  });
});

describe("scaledPart", () => {
  it("applies a pose's scale on top of the baked image's own", () => {
    const { scene } = fakeScene();
    const real = pixelImage(scene);
    const img = fk(real);
    const part = scaledPart(real);
    part.setScale(1.5, 0.8);
    expect(argsOf(img, "setScale").at(-1)).toEqual([1.5 / BAKE_SCALE, 0.8 / BAKE_SCALE]);
    part.setScale(1);
    expect(argsOf(img, "setScale").at(-1)).toEqual([1 / BAKE_SCALE, 1 / BAKE_SCALE]);
    part.setPosition(3, 4);
    expect(argsOf(img, "setPosition").at(-1)).toEqual([3, 4]);
  });
});
