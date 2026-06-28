/**
 * Hidemium Active tab URL/title matching (equal | contain).
 */

export function matchFilter(value, filter, mode) {
  if (filter == null || String(filter).trim() === "") return true;
  const hay = String(value ?? "");
  const needle = String(filter);
  const m = mode === "equal" ? "equal" : "contain";
  if (m === "equal") return hay === needle;
  return hay.includes(needle);
}

/** tabIndex in UI is 1-based (Hidemium); legacy index is 0-based. */
export function resolveTabIndex(params) {
  if (Number.isFinite(params?.tabIndex)) {
    return Math.max(0, Math.floor(params.tabIndex) - 1);
  }
  if (Number.isFinite(params?.index)) {
    return Math.max(0, Math.floor(params.index));
  }
  return null;
}