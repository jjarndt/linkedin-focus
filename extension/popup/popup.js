// LinkedIn Focus popup: reads/writes storage.local; content scripts react via onChanged.

const api = globalThis.browser ?? globalThis.chrome;

// Keep in sync with content.js.
const DEFAULTS = { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true };

const KEYS = Object.keys(DEFAULTS);

async function load() {
  const state = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) };
  for (const key of KEYS) {
    const el = document.getElementById(key);
    if (el) el.checked = state[key] !== false;
  }
}

function wire() {
  for (const key of KEYS) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.addEventListener("change", () => {
      api.storage.local.set({ [key]: el.checked });
    });
  }
}

load();
wire();
