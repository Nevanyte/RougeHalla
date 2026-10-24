export function uiRoot(): HTMLElement {
  return document.getElementById("ui")!;
}

/** A 0xRRGGBB number (the shared catalogs' colours) as a CSS colour. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
