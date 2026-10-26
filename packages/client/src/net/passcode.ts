// The playtest passcode (the server's PLAYTEST_PASSCODE, when its host set one). It arrives in the link the host shares
// (?code=...), is kept in localStorage so a reload, or a link without it, still works, and goes to the server on the
// REST calls that need it (a header) and in the join options. Nothing here asks the player for it: no screen, no field.
const STORAGE_KEY = "raid.passcode";
const URL_PARAM = "code";

/** The passcode this page has: the one in its address (remembered from then on), else the remembered one, else undefined. */
export function readPasscode(): string | undefined {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(location.search).get(URL_PARAM);
  } catch {
    // No location (a test without a DOM): there is no link to read.
  }
  if (fromUrl) {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Storage can be missing or throw (private mode); the link still works for this page load.
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}
