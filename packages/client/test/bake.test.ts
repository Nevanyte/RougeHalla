// render/bake.ts: drawings that do not change are painted once into a texture and shown as Images. The scene is fake (test/fakes.ts):
// its texture manager remembers what was baked.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAKE_SCALE, MAX_BAKE_SCALE, PIXEL_TEXTURE_KEY, around, bakeScale, bakeScaleFor, bakedImage, ensureBake, pixelImage, placeBake, reachableZoom, scaledPart, setBakeScale, swapBake,
} from "../src/render/bake";
import { computeLayout } from "../src/view/viewport";
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

describe("the density of a bake", () => {
  afterEach(() => { setBakeScale(null); vi.unstubAllGlobals(); });

  it("takes one texel per screen pixel in half steps, never below BAKE_SCALE or above MAX_BAKE_SCALE", () => {
    expect([0.5, 1, 1.6, 2, 2.0000000001].map(bakeScaleFor)).toEqual([2, 2, 2, 2, 2]);
    expect([2.01, 2.4, 2.48, 2.5].map(bakeScaleFor)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect([2.51, 2.9, 3, 5].map(bakeScaleFor)).toEqual([3, 3, 3, MAX_BAKE_SCALE]);
    expect([NaN, Infinity].map(bakeScaleFor)).toEqual([2, 2]);
  });

  it("is BAKE_SCALE where there is no window, and what the screen allows where there is one", () => {
    expect(reachableZoom()).toBe(0);
    expect(bakeScale()).toBe(BAKE_SCALE);
    setBakeScale(null);
    // A 16-inch MacBook Pro: a 1500x900 window now (zoom 1.9) that can go fullscreen at 1728x1117 on a DPR 2 screen (zoom 2.48).
    vi.stubGlobal("window", { innerWidth: 1500, innerHeight: 900, devicePixelRatio: 2, screen: { width: 1728, height: 1117 } });
    expect(reachableZoom()).toBeCloseTo(computeLayout({ cssW: 1728, cssH: 1117, dpr: 2, hiDpi: true }).zoom, 9);
    expect(reachableZoom()).toBeGreaterThan(2.4);
    expect(bakeScale()).toBe(2.5);
    // A small laptop that never zooms past 2 stays at the base density, a window already bigger than its screen counts.
    setBakeScale(null);
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2, screen: { width: 1440, height: 900 } });
    expect(bakeScale()).toBe(BAKE_SCALE);
    setBakeScale(null);
    vi.stubGlobal("window", { innerWidth: 3840, innerHeight: 2160, devicePixelRatio: 1, screen: { width: 1920, height: 1080 } });
    expect(bakeScale()).toBe(2.5);
  });

  it("is fixed once it is first read, so no view mixes two densities", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 700, devicePixelRatio: 1, screen: { width: 1000, height: 700 } });
    expect(bakeScale()).toBe(BAKE_SCALE);
    vi.stubGlobal("window", { innerWidth: 3840, innerHeight: 2160, devicePixelRatio: 1, screen: { width: 3840, height: 2160 } });
    expect(bakeScale()).toBe(BAKE_SCALE);
    setBakeScale(3);
    expect(bakeScale()).toBe(3);
  });

  it("sizes the textures and the images that show them at the page's density", () => {
    setBakeScale(2.5);
    const { scene, baked } = fakeScene();
    const real = bakedImage(scene, "thing", REGION, (g) => { g.fillRect(0, 0, 4, 4); });
    const b = baked.get("bk:thing")!;
    expect(b.size).toEqual([100, 50]);
    expect(b.calls[0]![1]).toEqual([2.5, 2.5]);
    expect(fk(real).state.scale).toBe(1 / 2.5);
    const pose = scaledPart(real);
    pose.setScale(1.5, 0.8);
    const [sx, sy] = argsOf(fk(real), "setScale").at(-1) as number[];
    expect([sx, sy]).toEqual([1.5 * (1 / 2.5), 0.8 * (1 / 2.5)]);
    const other = pixelImage(scene);
    placeBake(other, around(16));
    expect(fk(other).state.scale).toBe(1 / 2.5);
  });
});
