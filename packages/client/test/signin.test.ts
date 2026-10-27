// The sign-in link (/?profile=name#key=token): which addresses count, that the token lands where profile.ts keeps its
// tokens, and that the fragment is gone from the address bar afterwards while ?profile= and ?code= stay.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSCODE_HEADER, PROFILE_TOKEN_HEADER } from "@raid/shared";
import { consumeSignIn, consumeSignInLink, parseSignIn, type SignInPage } from "../src/net/signin";

const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("parseSignIn", () => {
  it("reads the callsign from ?profile= and the token from the fragment", () => {
    expect(parseSignIn("?profile=amy", `#key=${UUID}`)).toEqual({ name: "amy", key: UUID });
    expect(parseSignIn("?code=sesame&profile=Amy_01-x", `#key=${UUID}`)).toEqual({ name: "Amy_01-x", key: UUID });
  });

  it("decodes a percent-encoded key", () => {
    expect(parseSignIn("?profile=amy", "#key=a%2Bb%3Dc%2Fd")).toEqual({ name: "amy", key: "a+b=c/d" });
  });

  it("ignores a callsign that PROFILE_RE would refuse, or none", () => {
    for (const search of ["", "?profile=", "?profile=a", "?profile=x".padEnd(30, "x"), "?profile=has%20space", "?profile=%3Cb%3E", "?other=amy"]) {
      expect(parseSignIn(search, `#key=${UUID}`), search).toBeNull();
    }
  });

  it("ignores a key that is empty, oversized, not header-safe or badly escaped", () => {
    for (const hash of ["#key=", `#key=${"k".repeat(129)}`, "#key=has%20space", "#key=%00bad", "#key=caf%C3%A9", "#key=%E0%A4%A"]) {
      expect(parseSignIn("?profile=amy", hash), hash).toBeNull();
    }
    expect(parseSignIn("?profile=amy", `#key=${"k".repeat(128)}`)).toEqual({ name: "amy", key: "k".repeat(128) });
  });

  it("wants exactly #key=: other fragments and no fragment are not sign-in links", () => {
    for (const hash of ["", "#", "#key", "#other=1", `#x=1&key=${UUID}`, `#/key=${UUID}`, `key=${UUID}`]) {
      expect(parseSignIn("?profile=amy", hash), hash).toBeNull();
    }
  });
});

function fakePage(search: string, hash: string, pathname = "/") {
  const stored: Array<[string, string]> = [];
  const urls: string[] = [];
  const page: SignInPage = {
    search, hash, pathname,
    store: (name, key) => { stored.push([name, key]); },
    replaceUrl: (url) => { urls.push(url); },
  };
  return { page, stored, urls };
}

describe("consumeSignIn", () => {
  it("stores the token for the callsign and removes the fragment, keeping ?profile= and ?code=", () => {
    const { page, stored, urls } = fakePage("?profile=amy&code=open-sesame", `#key=${UUID}`);
    expect(consumeSignIn(page)).toEqual({ name: "amy", key: UUID });
    expect(stored).toEqual([["amy", UUID]]);
    expect(urls).toEqual(["/?profile=amy&code=open-sesame"]);
  });

  it("keeps other fragment parameters and the path", () => {
    const { page, urls } = fakePage("?profile=amy", `#key=${UUID}&tab=shop`, "/play/");
    consumeSignIn(page);
    expect(urls).toEqual(["/play/?profile=amy#tab=shop"]);
  });

  it("stores nothing for a bad key or callsign, but still takes the fragment out of the address bar", () => {
    const bad = fakePage("?profile=amy", `#key=${"k".repeat(500)}`);
    expect(consumeSignIn(bad.page)).toBeNull();
    expect(bad.stored).toEqual([]);
    expect(bad.urls).toEqual(["/?profile=amy"]);

    const noName = fakePage("?profile=a", `#key=${UUID}`);
    expect(consumeSignIn(noName.page)).toBeNull();
    expect(noName.stored).toEqual([]);
    expect(noName.urls).toEqual(["/?profile=a"]);
  });

  it("leaves an address with no #key= alone", () => {
    const none = fakePage("?profile=amy", "");
    expect(consumeSignIn(none.page)).toBeNull();
    const other = fakePage("?profile=amy", "#tab=shop");
    expect(consumeSignIn(other.page)).toBeNull();
    expect(none.urls.concat(other.urls)).toEqual([]);
    expect(none.stored.concat(other.stored)).toEqual([]);
  });
});

describe("on a page", () => {
  let storage: Map<string, string>;
  let address: URL;
  let storageBroken = false;

  function stubPage(href: string): void {
    address = new URL(href);
    // The page's own location follows replaceState, as in a browser.
    vi.stubGlobal("location", {
      get search() { return address.search; },
      get hash() { return address.hash; },
      get pathname() { return address.pathname; },
      get href() { return address.href; },
      get origin() { return address.origin; },
      get protocol() { return address.protocol; },
      get hostname() { return address.hostname; },
    });
    vi.stubGlobal("history", {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => { address = new URL(url, address); },
    });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => { if (storageBroken) throw new Error("denied"); return storage.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (storageBroken) throw new Error("denied"); storage.set(k, v); },
      removeItem: (k: string) => { if (storageBroken) throw new Error("denied"); storage.delete(k); },
    });
  }

  beforeEach(() => {
    storage = new Map();
    storageBroken = false;
    vi.resetModules();
    vi.stubEnv("VITE_SERVER_URL", "");
    vi.stubEnv("DEV", false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("consumeSignInLink reads location and rewrites the address with history.replaceState", () => {
    stubPage(`https://new-name.trycloudflare.com/?profile=amy&code=pw#key=${UUID}`);
    const seen: Array<[string, string]> = [];
    expect(consumeSignInLink((n, k) => seen.push([n, k]))).toEqual({ name: "amy", key: UUID });
    expect(seen).toEqual([["amy", UUID]]);
    expect(address.href).toBe("https://new-name.trycloudflare.com/?profile=amy&code=pw");
    expect(address.hash).toBe("");
  });

  it("is quiet where there is no location or history, or storage that throws", () => {
    vi.stubGlobal("location", undefined);
    expect(consumeSignInLink(() => { throw new Error("no"); })).toBeNull();
    stubPage(`https://x.example/?profile=amy#key=${UUID}`);
    expect(consumeSignInLink(() => { throw new Error("denied"); })).toBeNull();
  });

  /** A whole profile as the server sends it (profile.ts refuses anything less). */
  const wholeProfile = (name: string) => ({
    name, gv: 0, gvLifetime: 0, gvByMonth: {}, stats: {}, cosmetics: { owned: [], equipped: {} }, achievements: {},
    progress: { winsByFaction: {}, winsByWeapon: {} },
  });

  /** A server that knows one callsign with one token: 403 for any other, 200 with a whole profile for the right one. */
  function stubServer(token: string) {
    const seen: Array<string | undefined> = [];
    const spy = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      const sent = init.headers[PROFILE_TOKEN_HEADER];
      seen.push(sent);
      return sent === token
        ? new Response(JSON.stringify({ token, created: false, profile: wholeProfile("amy") }), { status: 200 })
        : new Response(JSON.stringify({ error: "profile belongs to someone else" }), { status: 403 });
    });
    vi.stubGlobal("fetch", spy);
    return seen;
  }

  it("loading the profile client keeps a link's key apart until the server accepts it: then it is the token, sent, and the key is gone from the bar", async () => {
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy&code=open-sesame#key=${UUID}`);
    const seen = stubServer(UUID);
    const { fetchProfile } = await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBeUndefined(); // not proven yet
    expect(storage.get("raid.link.amy")).toBe(UUID);
    expect(address.hash).toBe("");
    expect(address.search).toBe("?profile=amy&code=open-sesame");
    await fetchProfile("amy");
    expect(seen).toEqual([UUID]);
    expect(storage.get("raid.token.amy")).toBe(UUID);
    expect(storage.get("raid.link.amy")).toBeUndefined();
  });

  it("a wrong key never blocks the right link: it is dropped when the server refuses it, and the owner's own link then signs in", async () => {
    // A truncated copy (or a crafted link) first, on a browser that holds nothing for the callsign.
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID.slice(0, 20)}`);
    let seen = stubServer(UUID);
    let mod = await import("../src/net/profile");
    await expect(mod.fetchProfile("amy")).rejects.toMatchObject({ kind: "taken" });
    expect(seen).toEqual([UUID.slice(0, 20)]);
    expect(storage.get("raid.link.amy")).toBeUndefined(); // dropped
    expect(storage.get("raid.token.amy")).toBeUndefined(); // never promoted

    // The wrong key opened twice in a row, then the right one before any request: the newest unproven key wins.
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${"w".repeat(36)}`);
    vi.resetModules();
    mod = await import("../src/net/profile");
    expect(storage.get("raid.link.amy")).toBe("w".repeat(36));
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    vi.resetModules();
    seen = stubServer(UUID);
    mod = await import("../src/net/profile");
    expect(storage.get("raid.link.amy")).toBe(UUID);
    await mod.fetchProfile("amy");
    expect(seen).toEqual([UUID]);
    expect(storage.get("raid.token.amy")).toBe(UUID);
    expect(storage.get("raid.link.amy")).toBeUndefined();
  });

  it("a link never replaces a token the server has accepted (a crafted link cannot lock the owner out), nor other callsigns'", async () => {
    storage.set("raid.token.amy", UUID);
    storage.set("raid.token.bob", "bobs-token");
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${"c".repeat(36)}`);
    const seen = stubServer(UUID);
    const { fetchProfile } = await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBe(UUID);
    expect(storage.get("raid.link.amy")).toBeUndefined(); // not even kept beside it
    expect(storage.get("raid.token.bob")).toBe("bobs-token");
    expect(address.hash).toBe("");
    await fetchProfile("amy");
    expect(seen).toEqual([UUID]);
    expect(storage.get("raid.token.amy")).toBe(UUID);
  });

  it("a token the server itself refuses is kept but marked, and a link may be tried beside it: the right one replaces it, a wrong one costs nothing", async () => {
    storage.set("raid.token.amy", "stale-token");
    stubPage("https://fresh-origin.trycloudflare.com/?profile=amy");
    stubServer(UUID);
    let mod = await import("../src/net/profile");
    await expect(mod.fetchProfile("amy")).rejects.toMatchObject({ kind: "taken" });
    expect(storage.get("raid.token.amy")).toBe("stale-token"); // a 403 must not cost a token that may be good (a gateway's, say)

    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${"w".repeat(36)}`);
    vi.resetModules();
    let seen = stubServer(UUID);
    mod = await import("../src/net/profile");
    expect(storage.get("raid.link.amy")).toBe("w".repeat(36));
    await expect(mod.fetchProfile("amy")).rejects.toMatchObject({ kind: "taken" });
    expect(seen).toEqual(["w".repeat(36)]);
    expect(storage.get("raid.link.amy")).toBeUndefined();
    expect(storage.get("raid.token.amy")).toBe("stale-token");

    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    vi.resetModules();
    seen = stubServer(UUID);
    mod = await import("../src/net/profile");
    await mod.fetchProfile("amy");
    expect(seen).toEqual([UUID]);
    expect(storage.get("raid.token.amy")).toBe(UUID);
    expect(storage.get("raid.rejected.amy")).toBeUndefined();
  });

  it("a request that fails for another reason keeps the link's key for the next try", async () => {
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { fetchProfile } = await import("../src/net/profile");
    await expect(fetchProfile("amy")).rejects.toMatchObject({ kind: "unavailable" });
    expect(storage.get("raid.link.amy")).toBe(UUID);
    const seen = stubServer(UUID);
    await fetchProfile("amy");
    expect(seen).toEqual([UUID]);
  });

  it("a bad key stores nothing and the page still loads", async () => {
    storage.set("raid.token.amy", "kept");
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${"k".repeat(200)}`);
    await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBe("kept");
    expect(storage.get("raid.link.amy")).toBeUndefined();
    expect(address.hash).toBe("");
  });

  it("with storage blocked the page still loads", async () => {
    storageBroken = true;
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    await expect(import("../src/net/profile")).resolves.toBeDefined();
    expect(address.hash).toBe("");
  });
});
