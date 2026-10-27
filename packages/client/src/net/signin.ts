// A sign-in link carries a callsign's token to a browser that does not have it: `<origin>/?profile=<name>#key=<token>`.
// A playtest's quick tunnel has a new address every start, and localStorage (where profile.ts keeps the tokens) is per
// origin, so a returning player's token would otherwise stay behind on the old address. The token rides in the URL
// FRAGMENT: a browser never sends it to the server, and a tunnel or proxy cannot log it. It is taken out of the address
// bar at once, so a reload, a bookmark or a screenshot no longer carries it. `?profile=` and `?code=` stay.
//
// Whoever holds the link is that callsign: the host sends each one privately (`npm run playtest:signin`). The key is only a
// claim until the server accepts it: profile.ts keeps it apart, tries it on the next request, and drops it if it is refused.
// Opening a link never touches a token this browser already proved, so a crafted link cannot overwrite a good one, and a
// wrong key (a truncated copy) never blocks the right link.
import { PROFILE_RE } from "@raid/shared";

/** A token goes into an HTTP header: visible ASCII only (the server's are UUIDs, 36 characters). */
const KEY_RE = /^[\x21-\x7e]{1,128}$/;
/** The fragment is exactly `#key=<value>`, optionally followed by `&<anything else>`, which is kept as it was. */
const FRAGMENT_RE = /^#key=([^&]*)(?:&(.*))?$/;

export interface SignIn {
  name: string;
  key: string;
}

/** What the link is read from and written to. Real code passes `location` and `history`; tests pass plain values. */
export interface SignInPage {
  search: string;
  hash: string;
  pathname: string;
  /** Keeps the token for the callsign, where the profile client reads it. */
  store(name: string, key: string): void;
  /** Rewrites the address bar without navigating (`history.replaceState`). */
  replaceUrl(url: string): void;
}

/** The callsign and the token a page address names, or null when it names none or either is not acceptable. */
export function parseSignIn(search: string, hash: string): SignIn | null {
  const match = FRAGMENT_RE.exec(hash);
  if (!match) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!KEY_RE.test(key)) return null;
  const name = new URLSearchParams(search).get("profile");
  if (!name || !PROFILE_RE.test(name)) return null;
  return { name, key };
}

/**
 * Stores the token the address carries, if it is a good one, and takes `#key=` out of the address either way (a bad key
 * is no more worth keeping in the bar than a good one). Returns what it stored, or null.
 */
export function consumeSignIn(page: SignInPage): SignIn | null {
  const match = FRAGMENT_RE.exec(page.hash);
  if (!match) return null;
  const signIn = parseSignIn(page.search, page.hash);
  page.replaceUrl(`${page.pathname}${page.search}${match[2] ? `#${match[2]}` : ""}`);
  if (!signIn) return null;
  page.store(signIn.name, signIn.key);
  return signIn;
}

/** `consumeSignIn` on this page. Never throws: a page with no location or history (a test, a worker) has no link to read. */
export function consumeSignInLink(store: SignInPage["store"]): SignIn | null {
  try {
    if (typeof location === "undefined" || typeof history === "undefined") return null;
    return consumeSignIn({
      search: location.search ?? "",
      hash: location.hash ?? "",
      pathname: location.pathname ?? "/",
      store,
      replaceUrl: (url) => history.replaceState(history.state, "", url),
    });
  } catch {
    return null;
  }
}
