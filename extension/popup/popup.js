// LinkedIn Focus popup: reads/writes storage.local; content scripts react via
// onChanged. DEFAULTS comes from shared.js (loaded first in popup.html).
//
// Checkboxes stay disabled until the stored state has loaded.

const api = globalThis.browser ?? globalThis.chrome;

// Replace the English reference wording in popup.html with the active locale's
// messages from _locales/. Every write is conditional on a non-empty message:
// getMessage() returns "" for an unknown key, and blanking a <label> would
// leave a checkbox with no clickable text. A missing translation therefore
// degrades to English rather than to an empty popup.
function localize() {
  const i18n = api?.i18n;
  if (!i18n?.getMessage) return;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    const message = i18n.getMessage(el.dataset.i18n);
    if (message) el.textContent = message;
  }

  // @@ui_locale is a predefined message and uses underscores ("en_US"); the
  // lang attribute wants BCP 47 ("en-US").
  const uiLocale = i18n.getMessage("@@ui_locale");
  if (uiLocale) document.documentElement.lang = uiLocale.replace(/_/g, "-");
}

async function refreshActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) await api.tabs.sendMessage(tab.id, REFRESH_SETTINGS);
}

async function init() {
  const state = await api.storage.local.get(DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    let savedValue = coerce(key, state[key]);
    el.checked = savedValue;
    el.addEventListener("change", async () => {
      const value = el.checked;
      el.disabled = true;
      try {
        await api.storage.local.set({ [key]: value });
        savedValue = value;
      } catch (e) {
        el.checked = savedValue;
        console.error("[LinkedIn Focus] popup update failed", e);
        return;
      } finally {
        el.disabled = false;
      }
      refreshActiveTab().catch(() => {
        // There may be no receiver if the active tab is outside LinkedIn.
      });
    });
    el.disabled = false;
  }
}

// Localization is cosmetic, wiring the toggles is not: a broken i18n API must
// not stop init() from running.
try {
  localize();
} catch (e) {
  console.error("[LinkedIn Focus] popup localization failed", e);
}

init().catch((e) => console.error("[LinkedIn Focus] popup init failed", e));
