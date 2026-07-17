// LinkedIn Focus popup: reads/writes storage.local; content scripts react via
// onChanged. DEFAULTS comes from shared.js (loaded first in popup.html).
//
// One async pass: set each checkbox from storage, THEN attach its listener.
// Wiring before the read resolves would let a click write storage and then be
// visually reverted by the stale snapshot.

const api = globalThis.browser ?? globalThis.chrome;

async function init() {
  const state = await api.storage.local.get(DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    el.checked = state[key];
    el.addEventListener("change", () => {
      api.storage.local.set({ [key]: el.checked });
    });
  }
}

init().catch((e) => console.error("[LinkedIn Focus] popup init failed", e));
