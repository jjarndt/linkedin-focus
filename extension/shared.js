// LinkedIn Focus feature table — single source of truth for toggle keys and
// defaults. Loaded before content.js (manifest content_scripts js order) and
// before popup.js (script order in popup.html).
const DEFAULTS = { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true };
const REFRESH_SETTINGS = "refreshSettings";

function coerce(key, value) {
  return typeof value === "boolean" ? value : DEFAULTS[key];
}
