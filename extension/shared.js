// Settings and messages shared by the content script, popup and background page.
const DEFAULTS = { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true };
const ACCOUNT_LIST_DEFAULTS = { allowedAccounts: [], blockedAccounts: [] };
const SETTINGS_DEFAULTS = { ...DEFAULTS, ...ACCOUNT_LIST_DEFAULTS };
const REFRESH_SETTINGS = "refreshSettings";
const GET_PAGE_ACCOUNT = "getPageAccount";
const CHANGE_ACCOUNT_LIST = "changeAccountList";

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

function normalizeAccounts(value) {
  return Array.isArray(value) ? [...new Set(value.map((entry) => accountPath(entry)).filter(Boolean))] : [];
}

async function changeAccountList(api, list, path, include) {
  const accounts = await api.runtime.sendMessage({ type: CHANGE_ACCOUNT_LIST, list, path, include });
  if (!Array.isArray(accounts)) throw new Error(`Could not update ${list}`);
  return accounts;
}

function accountActionLabel(list, included) {
  if (list === "allowedAccounts") return included ? "Account allowed" : "Allow this account";
  return included ? "Account blocked" : "Block this account";
}
