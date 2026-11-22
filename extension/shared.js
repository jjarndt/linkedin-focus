// LinkedIn Focus feature table — single source of truth for toggle keys and
// defaults. Loaded before content.js (manifest content_scripts js order) and
// before popup.js (script order in popup.html).
const DEFAULTS = { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true };
const SETTINGS_DEFAULTS = { ...DEFAULTS, allowedAccounts: [] };
const REFRESH_SETTINGS = "refreshSettings";

function coerce(key, value) {
  return typeof value === "boolean" ? value : DEFAULTS[key];
}

// Store just the account path, so tracking parameters, country domains and
// capitalization do not create duplicate entries.
function accountPath(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const bareDomain = /^(?:[\w.-]+\.)?linkedin\.com\//i.test(input);
  if (!bareDomain && !input.startsWith("/") && !/^https?:\/\//i.test(input)) return null;
  try {
    const url = new URL(bareDomain ? `https://${input}` : input, "https://www.linkedin.com");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
    const match = /^\/(in|company)\/([^/]+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[2]).normalize("NFC").toLowerCase();
    if (!/^[\p{L}\p{M}\p{N}._-]+$/u.test(slug)) return null;
    return `/${match[1].toLowerCase()}/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}

function normalizeAllowedAccounts(value) {
  return Array.isArray(value) ? [...new Set(value.map(accountPath).filter(Boolean))] : [];
}
