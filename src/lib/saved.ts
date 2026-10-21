// Remembers a player's registration on THIS device only, so they don't need to retype it.
const KEY = "efa-my-registration";
export type Saved = { ref: string; phone: string };

export function saveMine(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function loadMine(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.ref === "string" && typeof v.phone === "string" ? v : null;
  } catch { return null; }
}
export function clearMine() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
