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

// Classic shell reuses .scaffold-layout__main on profile/messaging pages, so the
// feed rule there must be scoped to the feed route. The new shell needs no
// scoping: [data-testid="mainFeed"] only exists on the feed.
function isFeedPage() {
  const p = location.pathname;
  return p === "/" || p === "/feed" || p === "/feed/";
}

function applyState() {
  const root = document.documentElement;
  for (const [key, cls] of Object.entries(CLASS_MAP)) {
    root.classList.toggle(cls, currentState[key]);
  }
  root.classList.toggle("lf-feed-page", isFeedPage());
}

// ---- Promoted-post detection ----------------------------------------------

// Label texts, DE + EN. New shell: a leaf <p>/<span> whose entire text is the
// label (organic posts never have that). Classic shell: label inside the actor
// header, matched by word boundary.
const LABELS = new Set(["Anzeige", "Promoted", "Gesponsert", "Sponsored"]);
const PROMOTED_RE = /\b(promoted|gesponsert|sponsored|anzeige)\b/i;

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

// The checked-flag stores the post's identity (activity urn / mount id), not a
// bare "1": if the shell ever recycles a container for a different post, the
// changed identity forces a re-check and clears a stale lf-ad flag.
function markAdsClassic() {
  document.querySelectorAll(CLASSIC_POST_SELECTOR).forEach((post) => {
    const id = post.getAttribute("data-id") || post.getAttribute("data-urn") || "1";
    if (post.dataset.lfChecked === id) return;
    const header = post.querySelector(CLASSIC_HEADER_SELECTOR);
    if (!header) return; // not hydrated yet, retry on next scan
    post.dataset.lfChecked = id;
    post.classList.remove("lf-ad");
    if (PROMOTED_RE.test(header.textContent || "")) {
      post.classList.add("lf-ad");
      log("ad (classic):", (header.textContent || "").trim().slice(0, 60));
    }
  });
}

function markAdsNewShell() {
  // Post wrapper = direct child of the feed container. Not filtered on
  // [data-lazy-mount-id] so the marker survives if that internal attribute
  // is renamed; non-post children simply never grow text and are skipped.
  document
    .querySelectorAll('[data-testid="mainFeed"] > *')
    .forEach((post) => {
      const id = post.getAttribute("data-lazy-mount-id") || "1";
      if (post.dataset.lfChecked === id) return;
      const leaves = post.querySelectorAll("p, span");
      if (!leaves.length) return; // skeleton / not hydrated yet, retry on next scan
      post.dataset.lfChecked = id;
      post.classList.remove("lf-ad");
      for (const el of leaves) {
        if (el.childElementCount === 0 && LABELS.has((el.textContent || "").trim())) {
          post.classList.add("lf-ad");
          log("ad (new shell):", (el.textContent || "").trim());
          break;
        }
      }
    });
}

// ---- News-module detection (new shell) ------------------------------------

// The right-rail modules (news box, daily games) have no stable attribute of
// their own; find their header text and mark the enclosing component. Classic
// shell is handled purely in CSS. Scans are cheap (asides are small) and
// classList.add is idempotent, so no checked-flag is needed.
const NEWS_MARKERS = ["LinkedIn News", "Spiel des Tages", "Today's games"];

function markNews() {
  for (const aside of document.querySelectorAll("aside")) {
    const text = aside.textContent || "";
    const pending = NEWS_MARKERS.filter((m) => text.includes(m));
    if (!pending.length) continue;
    const mods = [];
    const walker = document.createTreeWalker(aside, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && pending.length) {
      const marker = pending.find((m) => walker.currentNode.textContent.includes(m));
      if (!marker) continue;
      pending.splice(pending.indexOf(marker), 1);
      // News box: enclosing componentkey ancestor. Games box has none; there
      // the header <p> sits directly in the module container. closest() is
      // unbounded, so discard matches at/above the aside — otherwise lf-news
      // could land on a page-level wrapper and hide far more than the card.
      const el = walker.currentNode.parentElement;
      let mod = el.closest("[componentkey]");
      if (!mod || mod === aside || !aside.contains(mod)) mod = el.parentElement;
      if (mod && mod !== aside && aside.contains(mod)) mods.push({ mod, marker });
    }
    // News and games share one visual card; hiding the modules individually
    // leaves an empty card shell. Hide their common ancestor instead, unless
    // it also wraps unrelated content (ad iframe) or the whole aside.
    if (mods.length > 1) {
      let lca = mods[0].mod;
      while (lca !== aside && !mods.every(({ mod }) => lca.contains(mod))) {
        lca = lca.parentElement;
      }
      if (lca !== aside && !lca.querySelector("iframe")) {
        mods.length = 0;
        mods.push({ mod: lca, marker: "news+games card" });
      }
    }
    for (let { mod, marker } of mods) {
      // Climb single-child wrappers so no padded empty shell stays visible.
      while (
        mod.parentElement &&
        mod.parentElement !== aside &&
        mod.parentElement.children.length === 1
      ) {
        mod = mod.parentElement;
      }
      if (!mod.classList.contains("lf-news")) {
        mod.classList.add("lf-news");
        log("right-rail module marked:", marker);
      }
    }
  }
}

// ---- Scan scheduling -------------------------------------------------------

let scheduled = false;
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyState(); // path may have changed via SPA nav
    if (currentState.hideAds) {
      markAdsClassic();
      markAdsNewShell();
    }
    if (currentState.hideNews) markNews();
  });
}

// Live toggle: popup writes storage.local, every tab reacts here.
api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let touched = false;
  for (const key of Object.keys(CLASS_MAP)) {
    if (changes[key]) {
      currentState[key] = changes[key].newValue;
      touched = true;
    }
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

const observer = new MutationObserver(() => scheduleScan());
observer.observe(document.documentElement, { childList: true, subtree: true });

// get(DEFAULTS) fills in missing keys with the defaults and returns a Promise
// on every supported target (Safari, Chrome MV3).
api.storage.local
  .get(DEFAULTS)
  .then((stored) => {
    currentState = stored;
    scheduleScan();
  })
  .catch((e) => log("storage read failed", e));
