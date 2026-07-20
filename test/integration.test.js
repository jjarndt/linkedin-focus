// Integration tests: how the pieces play together — storage changes reaching the
// DOM without a reload, the scan loop reacting to SPA navigation and mutations,
// and content.js / styles.css / manifest.json staying in agreement.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadExtension, classicPost } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(ROOT, "extension");

// One macrotask turn: lets jsdom deliver MutationObserver callbacks without
// draining the rAF queue (h.flush() would drain it and hide the batching).
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const promotedPost = (id) =>
  classicPost({ id, header: "ACME Corp · Promoted" });

const newsAside = `<aside>
  <div componentkey="news-module">
    <h2>LinkedIn News</h2>
    <ul><li>Some headline</li></ul>
  </div>
</aside>`;

// ---------------------------------------------------------------------------
// A) Live toggle flow
// ---------------------------------------------------------------------------

test("turning hideFeed off removes the class without a reload", async () => {
  const h = await loadExtension();
  assert.ok(h.htmlClasses().has("lf-hide-feed"), "precondition: feed hidden by default");

  await h.storage.local.set({ hideFeed: false });

  assert.equal(
    h.htmlClasses().has("lf-hide-feed"),
    false,
    "lf-hide-feed still on <html> after storage said hideFeed:false",
  );
  h.close();
});

test("toggles are independent of each other", async () => {
  const h = await loadExtension();

  await h.storage.local.set({ hideFeed: false });

  const classes = h.htmlClasses();
  for (const cls of ["lf-hide-ads", "lf-hide-news", "lf-hide-badges"]) {
    assert.ok(classes.has(cls), `${cls} was dropped by an unrelated hideFeed change`);
  }
  h.close();
});

test("turning a toggle back on re-applies its class", async () => {
  const h = await loadExtension();
  await h.storage.local.set({ hideBadges: false });
  assert.equal(h.htmlClasses().has("lf-hide-badges"), false, "class not removed");

  await h.storage.local.set({ hideBadges: true });

  assert.ok(h.htmlClasses().has("lf-hide-badges"), "class not restored after re-enabling");
  h.close();
});

test("with hideAds off, promoted posts are never marked", async () => {
  const h = await loadExtension({
    body: promotedPost("urn:li:activity:1"),
    storage: { hideAds: false },
  });
  await h.flush();

  const post = h.document.querySelector(".feed-shared-update-v2");
  assert.equal(post.classList.contains("lf-ad"), false, "post marked although hideAds is off");
  h.close();
});

test("switching hideAds on re-scans and marks posts that were already there", async () => {
  const h = await loadExtension({
    body: promotedPost("urn:li:activity:1"),
    storage: { hideAds: false },
  });
  const post = h.document.querySelector(".feed-shared-update-v2");
  assert.equal(post.classList.contains("lf-ad"), false, "precondition: not marked yet");

  await h.storage.local.set({ hideAds: true });
  await h.flush();

  assert.ok(post.classList.contains("lf-ad"), "existing promoted post not marked after enabling hideAds");
  h.close();
});

test("with hideNews off, right-rail modules are never marked", async () => {
  const h = await loadExtension({ body: newsAside, storage: { hideNews: false } });
  await h.flush();

  assert.equal(
    h.document.querySelectorAll(".lf-news").length,
    0,
    "module marked although hideNews is off",
  );
  h.close();
});

test("switching hideNews on re-scans and marks the news module", async () => {
  const h = await loadExtension({ body: newsAside, storage: { hideNews: false } });

  await h.storage.local.set({ hideNews: true });
  await h.flush();

  const marked = h.document.querySelector(".lf-news");
  assert.ok(marked, "news module not marked after enabling hideNews");
  assert.equal(
    marked.getAttribute("componentkey"),
    "news-module",
    "lf-news landed on the wrong element",
  );
  h.close();
});

// ---------------------------------------------------------------------------
// B) SPA navigation and rescan
// ---------------------------------------------------------------------------

test("pushState alone does not schedule a scan (isolated world, unpatched)", async () => {
  const h = await loadExtension({ url: "https://www.linkedin.com/feed/" });
  assert.ok(h.htmlClasses().has("lf-feed-page"), "precondition: on the feed route");

  // pushState touches neither the DOM nor popstate, so nothing can notice it.
  h.window.history.pushState({}, "", "/jobs/");

  assert.equal(h.pendingFrames(), 0, "extension patched pushState after all");
  assert.ok(
    h.htmlClasses().has("lf-feed-page"),
    "lf-feed-page changed without any observable event",
  );
  h.close();
});

test("popstate triggers a scan that re-evaluates the route", async () => {
  const h = await loadExtension({ url: "https://www.linkedin.com/feed/" });
  h.window.history.pushState({}, "", "/jobs/");

  h.window.dispatchEvent(new h.window.PopStateEvent("popstate"));
  assert.equal(h.pendingFrames(), 1, "popstate did not schedule a scan");
  await h.flush();

  assert.equal(
    h.htmlClasses().has("lf-feed-page"),
    false,
    "lf-feed-page survived navigation away from the feed",
  );
  h.close();
});

test("popstate back onto the feed restores lf-feed-page", async () => {
  const h = await loadExtension({ url: "https://www.linkedin.com/jobs/" });
  assert.equal(h.htmlClasses().has("lf-feed-page"), false, "precondition: not on the feed");

  h.window.history.pushState({}, "", "/feed/");
  h.window.dispatchEvent(new h.window.PopStateEvent("popstate"));
  await h.flush();

  assert.ok(h.htmlClasses().has("lf-feed-page"), "lf-feed-page not re-applied on the feed route");
  h.close();
});

test("a post injected into the DOM is picked up by the observer and marked", async () => {
  const h = await loadExtension({ body: '<div id="feed"></div>' });
  assert.equal(h.document.querySelectorAll(".lf-ad").length, 0, "precondition: nothing marked");

  h.document
    .getElementById("feed")
    .insertAdjacentHTML("beforeend", promotedPost("urn:li:activity:99"));
  await h.flush();

  const post = h.document.querySelector('[data-id="urn:li:activity:99"]');
  assert.ok(post.classList.contains("lf-ad"), "post added after load was never scanned");
  h.close();
});

test("an organic post injected later stays unmarked", async () => {
  const h = await loadExtension({ body: '<div id="feed"></div>' });

  h.document
    .getElementById("feed")
    .insertAdjacentHTML(
      "beforeend",
      classicPost({ id: "urn:li:activity:100", header: "Jane Doe · 2. Grad" }),
    );
  await h.flush();

  const post = h.document.querySelector('[data-id="urn:li:activity:100"]');
  assert.equal(post.classList.contains("lf-ad"), false, "organic post falsely flagged as an ad");
  h.close();
});

test("mutations in separate turns collapse into a single scheduled frame", async () => {
  const h = await loadExtension({ body: '<div id="feed"></div>' });
  const feed = h.document.getElementById("feed");

  // Each `await tick` lets the observer callback run, so scheduleScan() is
  // entered three separate times — the `scheduled` flag has to absorb two.
  for (const n of [1, 2, 3]) {
    feed.insertAdjacentHTML("beforeend", `<div class="post-${n}">x</div>`);
    await tick();
  }

  assert.equal(h.pendingFrames(), 1, "one rAF per mutation — scans are not being batched");
  await h.flush();
  assert.equal(h.pendingFrames(), 0, "scanner did not settle after the batched scan");
  h.close();
});

test("scan re-arms after the frame runs", async () => {
  const h = await loadExtension({ body: '<div id="feed"></div>' });
  const feed = h.document.getElementById("feed");

  feed.insertAdjacentHTML("beforeend", "<div>a</div>");
  await h.flush();
  assert.equal(h.pendingFrames(), 0, "queue not drained by flush");

  feed.insertAdjacentHTML("beforeend", "<div>b</div>");
  await tick();

  assert.equal(h.pendingFrames(), 1, "scheduled flag stayed set — later mutations are ignored");
  h.close();
});

// ---------------------------------------------------------------------------
// C) Cross-file consistency (static, no jsdom)
// ---------------------------------------------------------------------------

const CSS = readFileSync(join(EXTENSION, "styles.css"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8"));

test("every class content.js sets on <html> is styled in styles.css", async () => {
  const h = await loadExtension();
  const classes = Object.values(h.lf.CLASS_MAP);
  assert.ok(classes.length > 0, "CLASS_MAP is empty");

  for (const cls of classes) {
    assert.ok(CSS.includes(`.${cls}`), `${cls} is set by content.js but has no rule in styles.css`);
  }
  h.close();
});

test("CLASS_MAP covers exactly the DEFAULTS keys", async () => {
  const h = await loadExtension();
  assert.deepEqual(
    Object.keys(h.lf.CLASS_MAP).sort(),
    Object.keys(h.lf.DEFAULTS).sort(),
    "CLASS_MAP and shared.js DEFAULTS have drifted apart",
  );
  h.close();
});

test("JS-applied element markers are styled too", () => {
  for (const cls of ["lf-ad", "lf-news", "lf-feed-page"]) {
    assert.ok(CSS.includes(`.${cls}`), `${cls} is applied by content.js but never styled`);
  }
});

test("manifest loads shared.js before content.js", () => {
  const js = MANIFEST.content_scripts[0].js;
  assert.ok(js.includes("shared.js"), "shared.js not in content_scripts");
  assert.ok(
    js.indexOf("shared.js") < js.indexOf("content.js"),
    "content.js reads DEFAULTS from shared.js — loading it first is a ReferenceError",
  );
});

test("content script runs at document_start", () => {
  assert.equal(
    MANIFEST.content_scripts[0].run_at,
    "document_start",
    "later injection lets the unfiltered feed flash up before the classes land",
  );
});

test("permissions are limited to storage", () => {
  assert.deepEqual(MANIFEST.permissions, ["storage"], "extension requests more than it needs");
  assert.equal(MANIFEST.host_permissions, undefined, "unexpected host_permissions");
  assert.equal(MANIFEST.optional_permissions, undefined, "unexpected optional_permissions");
});

test("content script matches linkedin.com only", () => {
  const matches = MANIFEST.content_scripts[0].matches;
  assert.ok(matches.length > 0, "no match patterns");
  for (const pattern of matches) {
    assert.match(pattern, /:\/\/(\*\.)?linkedin\.com\//, `${pattern} is not scoped to linkedin.com`);
  }
});

test("every file referenced by the manifest exists", () => {
  const cs = MANIFEST.content_scripts[0];
  const referenced = [
    ...cs.js,
    ...cs.css,
    MANIFEST.action.default_popup,
    ...Object.values(MANIFEST.icons),
  ];

  for (const rel of referenced) {
    assert.ok(existsSync(join(EXTENSION, rel)), `manifest references ${rel}, which is not on disk`);
  }
});
