// Settings and messages shared by the content script, popup and background page.
const DEFAULTS = { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true };
const SETTINGS_DEFAULTS = { ...DEFAULTS, allowedAccounts: [] };
const REFRESH_SETTINGS = "refreshSettings";
const GET_PAGE_ACCOUNT = "getPageAccount";
const CHANGE_ALLOWED_ACCOUNT = "changeAllowedAccount";

function coerce(key, value) {
  return typeof value === "boolean" ? value : DEFAULTS[key];
}

// Store just the account path, so tracking parameters, country domains and
// capitalization do not create duplicate entries.
function accountPath(value, { allowSubpages = false } = {}) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const bareDomain = /^(?:[\w.-]+\.)?linkedin\.com\//i.test(input);
  if (!bareDomain && !input.startsWith("/") && !/^https?:\/\//i.test(input)) return null;
  try {
    const url = new URL(bareDomain ? `https://${input}` : input, "https://www.linkedin.com");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
    const match = /^\/(in|company)\/([^/]+)(\/.*)?$/i.exec(url.pathname);
    if (!match || (!allowSubpages && match[3] && match[3] !== "/")) return null;
    const slug = decodeURIComponent(match[2]).normalize("NFC").toLowerCase();
    if (!/^[\p{L}\p{M}\p{N}._-]+$/u.test(slug)) return null;
    return `/${match[1].toLowerCase()}/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}

function normalizeAllowedAccounts(value) {
  return Array.isArray(value) ? [...new Set(value.map((entry) => accountPath(entry)).filter(Boolean))] : [];
}

async function changeAllowedAccount(api, path, allowed) {
  const accounts = await api.runtime.sendMessage({ type: CHANGE_ALLOWED_ACCOUNT, path, allowed });
  if (!Array.isArray(accounts)) throw new Error("Could not update allowed accounts");
  return accounts;
}
