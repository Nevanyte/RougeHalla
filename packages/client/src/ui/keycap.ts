// A key drawn as a keycap, for the weapon bar's hints and the help overlay.
import "./keycap.css";
import { el } from "./dom";

export function keycap(label: string, extraClass?: string): HTMLElement {
  return el("kbd", extraClass ? `keycap ${extraClass}` : "keycap", label);
}
