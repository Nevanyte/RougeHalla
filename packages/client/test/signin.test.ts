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

  it("loading the profile client signs this browser into the callsign: the token is stored, sent, and the key is gone from the bar", async () => {
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy&code=open-sesame#key=${UUID}`);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ token: UUID, created: false, profile: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchProfile } = await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBe(UUID);
    expect(address.hash).toBe("");
    expect(address.search).toBe("?profile=amy&code=open-sesame");
    await fetchProfile("amy").catch(() => {}); // the stub's profile is not a whole one; only the request matters
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers).toEqual({ [PROFILE_TOKEN_HEADER]: UUID, [PASSCODE_HEADER]: "open-sesame" });
  });

  it("a link never replaces a token this browser already holds (a crafted link cannot lock the owner out), nor other callsigns'", async () => {
    storage.set("raid.token.amy", "old-token");
    storage.set("raid.token.bob", "bobs-token");
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBe("old-token");
    expect(storage.get("raid.token.bob")).toBe("bobs-token");
    expect(address.hash).toBe("");
  });

  it("a bad key stores nothing and the page still loads", async () => {
    storage.set("raid.token.amy", "kept");
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${"k".repeat(200)}`);
    await import("../src/net/profile");
    expect(storage.get("raid.token.amy")).toBe("kept");
    expect(address.hash).toBe("");
  });

  it("with storage blocked the page still loads", async () => {
    storageBroken = true;
    stubPage(`https://fresh-origin.trycloudflare.com/?profile=amy#key=${UUID}`);
    await expect(import("../src/net/profile")).resolves.toBeDefined();
    expect(address.hash).toBe("");
  });
});
