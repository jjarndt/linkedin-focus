// LinkedIn Focus content script.
// Applies lf-* classes on <html> from storage and flags ads/news via JS where
// no stable CSS anchor exists.
//
// LinkedIn is mid-migration between two shells (verified 2026-07):
//   - New React shell (#root, data-testid anchors): feed, profiles
//   - Classic Ember shell (#global-nav, semantic classes): messaging
// Both selector sets are kept; whichever shell is served, one of them matches.

const api = globalThis.browser ?? globalThis.chrome;

// DEFAULTS comes from shared.js (loaded first via the manifest js array).

const CLASS_MAP = {
  hideFeed: "lf-hide-feed",
  hideAds: "lf-hide-ads",
  hideNews: "lf-hide-news",
  hideBadges: "lf-hide-badges",
};

// Debug: localStorage.setItem('lfDebug','1') in any console, OR window.__lfDebug = true
// — the latter only from the extension's content-script context (console context
// dropdown in Web Inspector); the page world's window is a different object.
function debugEnabled() {
  try {
    return window.__lfDebug === true || localStorage.getItem("lfDebug") === "1";
  } catch (_) {
    return window.__lfDebug === true;
  }
}
function log(...args) {
  if (debugEnabled()) console.log("[LinkedIn Focus]", ...args);
}

let currentState = { ...DEFAULTS };
const accountLists = { allowedAccounts: new Set(), blockedAccounts: new Set() };

// Classic shell reuses .scaffold-layout__main on profile/messaging pages, so the
// feed rule there must be scoped to the feed route. The new shell needs no
// scoping: [data-testid="mainFeed"] only exists on the feed.
const FEED_PATHS = new Set(["/", "/feed", "/feed/"]);

function isFeedPage() {
  return FEED_PATHS.has(location.pathname);
}

function applyState() {
  const root = document.documentElement;
  for (const [key, cls] of Object.entries(CLASS_MAP)) {
    root.classList.toggle(cls, currentState[key]);
  }
  root.classList.toggle("lf-feed-page", isFeedPage());
  updateFeed();
}

// ---- Promoted-post detection ----------------------------------------------

// Label texts, DE + EN. New shell: a leaf <p>/<span> whose entire text is the
// label (organic posts never have that). Classic shell: label inside the actor
// header, matched by word boundary.
const LABELS = new Set(["Anzeige", "Promoted", "Gesponsert", "Sponsored"]);
const PROMOTED_RE = /\b(promoted|gesponsert|sponsored|anzeige)\b/i;
const NEW_FEED_ITEMS = '[data-testid="mainFeed"] > *';

const CLASSIC_POST_SELECTOR = [
  '[data-id^="urn:li:activity:"]',
  '[data-urn^="urn:li:activity:"]',
  "div.feed-shared-update-v2",
].join(",");

const CLASSIC_HEADER_SELECTOR = [
  ".update-components-actor__meta",
  ".update-components-actor__sub-description",
  ".update-components-actor__description",
].join(",");

// The checked-memo lives in the isolated world, not in the DOM: an attribute on
// the post would be readable AND writable by the page, which could pin it to
// skip the scan (ad survives) or freeze an lf-ad flag onto an organic post.
// The stored value is the post's identity (activity urn / mount id), not a bare
// "1": if the shell ever recycles a container for a different post, the changed
// identity forces a re-check and clears a stale lf-ad flag. WeakMap keys are
// the post elements, so entries die with the nodes. The observer invalidates
// entries when the contents of a post change without a new identity.
const checked = new WeakMap();

function markAdsClassic() {
  document.querySelectorAll(CLASSIC_POST_SELECTOR).forEach((post) => {
    const id = post.getAttribute("data-id") || post.getAttribute("data-urn") || "1";
    if (checked.get(post) === id) return;
    const headers = post.querySelectorAll(CLASSIC_HEADER_SELECTOR);
    if (!headers.length) return; // not hydrated yet, retry on next scan
    checked.set(post, id);
    const label = Array.from(headers, (header) => header.textContent.trim())
      .find((text, index) => {
        const match = PROMOTED_RE.exec(text);
        return match && (index === 0 || match[0] === text);
      });
    post.classList.toggle("lf-ad", Boolean(label));
    if (label) log("ad (classic):", label.slice(0, 60));
  });
}

function markAdsNewShell() {
  // Post wrapper = direct child of the feed container. Not filtered on
  // [data-lazy-mount-id] so the marker survives if that internal attribute
  // is renamed; non-post children simply never grow text and are skipped.
  document
    .querySelectorAll(NEW_FEED_ITEMS)
    .forEach((post) => {
      const id = post.getAttribute("data-lazy-mount-id") || "1";
      if (checked.get(post) === id) return;
      const leaves = post.querySelectorAll("p, span");
      if (!leaves.length) return; // skeleton / not hydrated yet, retry on next scan
      checked.set(post, id);
      let label = "";
      for (const el of leaves) {
        if (el.childElementCount !== 0) continue;
        const text = el.textContent.trim();
        if (LABELS.has(text)) {
          label = text;
          break;
        }
      }
      post.classList.toggle("lf-ad", Boolean(label));
      if (label) log("ad (new shell):", label);
    });
}

// Match the outer post's actor header. Links in the post text, comments or
// quoted content are not evidence of authorship.
const REACT_POST_CARD = '[role="listitem"][componentkey^="update-card-focus"]';
const REACT_ACTOR_AVATAR = 'a[href][aria-haspopup="dialog"]:has(figure)';
const NEW_ACTOR_LINK = 'a[data-view-name="feed-actor-name"][href]';
const CLASSIC_ACTOR_LINK = 'a.update-components-actor__meta-link[href], a.feed-shared-actor__container-link[href]';
const CLASSIC_FEED_ITEMS = `.scaffold-layout__main :is(${CLASSIC_POST_SELECTOR})`;
const QUOTED_POST = "blockquote, .update-components-mini-update-v2, .feed-shared-update-v2__reshared-content";
const postAccounts = new WeakMap();
const postActions = new WeakMap();

function findReactActor(post) {
  const card = post.querySelector(REACT_POST_CARD);
  if (!card) {
    const link = findActorLink(post, NEW_ACTOR_LINK);
    return { link, anchor: link };
  }

  // A social activity banner can precede the author, separated by a rule.
  // Inspect the author header only, before the post body and comments.
  let header = card.querySelector("h2")?.nextElementSibling;
  const separator = header?.nextElementSibling;
  if (separator?.matches('hr[role="presentation"]')) header = separator.nextElementSibling;
  return { link: header?.querySelector(REACT_ACTOR_AVATAR), anchor: header };
}

function findClassicActor(post) {
  const link = findActorLink(post, CLASSIC_ACTOR_LINK);
  return { link, anchor: link?.closest(".update-components-actor") ?? link };
}

function findActorLink(post, selector) {
  return [...post.querySelectorAll(selector)].find((link) => !link.closest(QUOTED_POST));
}

function findPostAccount(post, findActor) {
  const { link, anchor } = findActor(post);
  const path = accountPath(link?.getAttribute("href"));
  return path ? { path, anchor } : null;
}

function renderPostActions(actions) {
  for (const [list, button] of Object.entries(actions.buttons)) {
    const included = accountLists[list].has(actions.path);
    button.disabled = actions.pending || included;
    const label = !included && actions.failedList === list
      ? `Retry ${list === "allowedAccounts" ? "allowing" : "blocking"}`
      : accountActionLabel(list, included);
    if (button.textContent !== label) {
      button.textContent = label;
      button.setAttribute("aria-label", `${label}: ${decodeURIComponent(actions.path)}`);
    }
  }
}

async function addPostAccount(event, list, actions, post, findActor) {
  // The page can dispatch clicks on injected buttons. Save only on a real user
  // action and recheck the author in case LinkedIn has recycled the card.
  const button = actions.buttons[list];
  if (!event.isTrusted || button.disabled || currentState.hideFeed || !isFeedPage()) return;
  const account = findPostAccount(post, findActor);
  if (account?.path !== actions.path || account.anchor.nextElementSibling !== actions.container) return;
  if (button.parentElement !== actions.container) return;
  event.stopPropagation();
  actions.pending = true;
  actions.failedList = null;
  renderPostActions(actions);
  try {
    await changeAccountList(api, list, actions.path, true);
    await refreshState();
  } catch (e) {
    actions.failedList = list;
    log("account update failed", e);
  } finally {
    actions.pending = false;
    renderPostActions(actions);
  }
}

function updatePostActions(post, account, findActor) {
  let actions = postActions.get(post);
  if (actions && (actions.path !== account?.path || actions.anchor !== account.anchor)) {
    actions.container.remove();
    postActions.delete(post);
    actions = null;
  }
  if (!account) return;
  if (!actions) {
    const container = document.createElement("div");
    container.className = "lf-post-account-actions";
    const newActions = { ...account, container, buttons: {}, pending: false, failedList: null };
    for (const list of Object.keys(accountLists)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lf-post-account";
      button.addEventListener("click", (event) => addPostAccount(event, list, newActions, post, findActor));
      newActions.buttons[list] = button;
      container.append(button);
    }
    postActions.set(post, newActions);
    actions = newActions;
  }
  renderPostActions(actions);
  if (actions.anchor.nextElementSibling !== actions.container) actions.anchor.after(actions.container);
}

function updatePost(post, findActor, filtering) {
  if (!postAccounts.has(post)) {
    postAccounts.set(post, findPostAccount(post, findActor));
  }
  const account = postAccounts.get(post);
  if (filtering) post.classList.toggle("lf-allowed-post", accountLists.allowedAccounts.has(account?.path));
  post.classList.toggle("lf-blocked-post", accountLists.blockedAccounts.has(account?.path));
  if (!currentState.hideFeed) updatePostActions(post, account, findActor);
}

function updateFeed() {
  const feedPage = isFeedPage();
  const filtering = feedPage && currentState.hideFeed && accountLists.allowedAccounts.size > 0;
  if (filtering || (feedPage && !currentState.hideFeed)) {
    for (const post of document.querySelectorAll(NEW_FEED_ITEMS)) {
      updatePost(post, findReactActor, filtering);
    }
    for (const post of document.querySelectorAll(CLASSIC_FEED_ITEMS)) {
      if (!post.parentElement.closest(CLASSIC_FEED_ITEMS)) updatePost(post, findClassicActor, filtering);
    }
  }
  document.documentElement.classList.toggle("lf-filter-feed", filtering);
}

// ---- News-module detection (new shell) ------------------------------------

// The right-rail modules (news box, daily games) have no stable attribute of
// their own; find their header text and mark the enclosing component. Classic
// shell is handled purely in CSS. Scans are cheap (asides are small) and
// classList.add is idempotent, so no checked-flag is needed.
const NEWS_MARKERS = ["LinkedIn News", "Spiel des Tages", "Today's games"];
let markedNews = new Set();

// News box: enclosing componentkey ancestor. Games box has none; there the
// header <p> sits directly in the module container. closest() is unbounded, so
// discard matches at/above the aside — otherwise lf-news could land on a
// page-level wrapper and hide far more than the card. Consumes `pending`: each
// marker is matched at most once.
function findMarkedModules(aside, pending) {
  const mods = [];
  const walker = document.createTreeWalker(aside, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && pending.length) {
    const marker = walker.currentNode.textContent.trim();
    const index = pending.indexOf(marker);
    if (index === -1) continue;
    const el = walker.currentNode.parentElement;
    let mod = el.closest("[componentkey]");
    if (!mod || mod === aside || !aside.contains(mod)) mod = el.parentElement;
    if (mod && mod !== aside && aside.contains(mod)) {
      pending.splice(index, 1);
      mods.push({ mod, marker });
    }
  }
  return mods;
}

// News and games share one visual card; hiding the modules individually leaves
// an empty card shell. Hide their common ancestor only if the modules account
// for the whole card.
function containsOnlyModules(element, modules) {
  if (modules.has(element)) return true;
  return element.children.length > 0 && Array.from(element.childNodes).every((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) return containsOnlyModules(child, modules);
    return child.nodeType !== Node.TEXT_NODE || !child.textContent.trim();
  });
}

function collapseToSharedCard(mods, aside) {
  if (mods.length <= 1) return mods;
  let lca = mods[0].mod;
  while (lca !== aside && !mods.every(({ mod }) => lca.contains(mod))) {
    lca = lca.parentElement;
  }
  const modules = new Set(mods.map(({ mod }) => mod));
  if (lca === aside || lca.querySelector("iframe") || !containsOnlyModules(lca, modules)) return mods;
  return [{ mod: lca, marker: "news+games card" }];
}

// Climb single-child wrappers so no padded empty shell stays visible.
function outermostSingleChildWrapper(mod, aside) {
  while (
    mod.parentElement &&
    mod.parentElement !== aside &&
    mod.parentElement.children.length === 1
  ) {
    mod = mod.parentElement;
  }
  return mod;
}

function markNews() {
  const targets = new Set();
  for (const aside of document.querySelectorAll("aside")) {
    const text = aside.textContent || "";
    const pending = NEWS_MARKERS.filter((m) => text.includes(m));
    if (!pending.length) continue;
    const mods = collapseToSharedCard(findMarkedModules(aside, pending), aside);
    for (const { mod, marker } of mods) {
      const target = outermostSingleChildWrapper(mod, aside);
      targets.add(target);
      if (!target.classList.contains("lf-news")) {
        target.classList.add("lf-news");
        log("right-rail module marked:", marker);
      }
    }
  }
  for (const previous of markedNews) {
    if (!targets.has(previous)) previous.classList.remove("lf-news");
  }
  markedNews = targets;
}

// ---- Scan scheduling -------------------------------------------------------

let scheduled = false;
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (currentState.hideAds) {
      markAdsClassic();
      markAdsNewShell();
    }
    applyState(); // path may have changed via SPA nav
    if (currentState.hideNews) markNews();
  });
}

let pendingReadKeys = null;

async function refreshState() {
  const liveKeys = new Set();
  pendingReadKeys = liveKeys;
  try {
    const stored = await api.storage.local.get(SETTINGS_DEFAULTS);
    if (pendingReadKeys !== liveKeys) return;

    for (const key of Object.keys(CLASS_MAP)) {
      if (!liveKeys.has(key)) currentState[key] = coerce(key, stored[key]);
    }
    for (const list of Object.keys(accountLists)) {
      if (!liveKeys.has(list)) accountLists[list] = new Set(normalizeAccounts(stored[list]));
    }
    applyState();
    scheduleScan();
  } catch (e) {
    log("storage read failed", e);
  } finally {
    if (pendingReadKeys === liveKeys) pendingReadKeys = null;
  }
}

// Live toggle: popup writes storage.local, every tab reacts here.
api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let touched = false;
  for (const key of Object.keys(CLASS_MAP)) {
    if (changes[key]) {
      currentState[key] = coerce(key, changes[key].newValue);
      // A pending snapshot must not overwrite a newer live value.
      pendingReadKeys?.add(key);
      touched = true;
    }
  }
  for (const list of Object.keys(accountLists)) {
    if (!changes[list]) continue;
    accountLists[list] = new Set(normalizeAccounts(changes[list].newValue));
    pendingReadKeys?.add(list);
    touched = true;
  }
  if (touched) {
    applyState(); // immediately, no one-frame FOUC on toggle
    scheduleScan(); // markers may need to (re)run, e.g. hideAds just turned on
  }
});

// SPA navigation: LinkedIn swaps content without full reload. Patching
// history.pushState would be useless here — content scripts run in an isolated
// world, so the page's own pushState calls never hit a patched copy. Route
// changes are picked up by the MutationObserver below (every nav swaps DOM;
// applyState re-reads location.pathname per scan); popstate covers back/forward.
window.addEventListener("popstate", scheduleScan);

// Apply defaults synchronously at document_start (no FOUC), then reconcile with storage.
applyState();

const observer = new MutationObserver((mutations) => {
  for (const { target } of mutations) {
    let element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    for (; element; element = element.parentElement) {
      checked.delete(element);
      postAccounts.delete(element);
    }
  }
  scheduleScan();
});
observer.observe(document.documentElement, {
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["data-testid", "data-id", "data-urn", "data-lazy-mount-id", "componentkey", "data-view-name", "href", "role", "aria-haspopup"],
  subtree: true,
});

// Catch up with changes a background tab may have missed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshState();
});
api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message === REFRESH_SETTINGS) refreshState();
  if (message === GET_PAGE_ACCOUNT) {
    sendResponse(accountPath(location.href, { allowSubpages: true }));
  }
});
refreshState();
