// State and storage behaviour of the content script: coercion of stored values,
// the class projection onto <html>, feed-route detection, and the onChanged
// listener — including the remove()/clear() case where newValue is undefined.

import test from "node:test";
import assert from "node:assert/strict";
import { loadExtension, classicPost } from "./harness.js";

const TOGGLE_CLASSES = ["lf-hide-feed", "lf-hide-ads", "lf-hide-news", "lf-hide-badges"];

// ---- coerce ---------------------------------------------------------------

test("coerce passes booleans through unchanged", async () => {
  const h = await loadExtension();
  assert.equal(h.lf.coerce("hideFeed", false), false, "explicit false must survive coercion");
  assert.equal(h.lf.coerce("hideFeed", true), true, "explicit true must survive coercion");
  h.close();
});

test("coerce falls back to DEFAULTS for every non-boolean", async () => {
  const h = await loadExtension();
  // "false" and 0 are the dangerous ones: truthiness checks would get them
  // wrong in opposite directions. Only the type check is correct.
  for (const value of [undefined, null, "false", "true", 0, 1, "", {}, []]) {
    assert.equal(
      h.lf.coerce("hideFeed", value),
      h.lf.DEFAULTS.hideFeed,
      `non-boolean ${JSON.stringify(value)} must fall back to DEFAULTS.hideFeed`,
    );
  }
  h.close();
});

test("coerce is keyed — the fallback comes from the key's own default", async () => {
  const h = await loadExtension();
  for (const key of Object.keys(h.lf.CLASS_MAP)) {
    assert.equal(
      h.lf.coerce(key, undefined),
      h.lf.DEFAULTS[key],
      `${key} must fall back to its own default, not another key's`,
    );
  }
  h.close();
});

// ---- CLASS_MAP / DEFAULTS consistency --------------------------------------

test("CLASS_MAP and DEFAULTS cover the same toggle keys", async () => {
  const h = await loadExtension();
  // A key present in only one table is silently dead: missing in DEFAULTS means
  // coerce() returns undefined, missing in CLASS_MAP means no class and no
  // reaction in the onChanged listener.
  assert.deepEqual(
    Object.keys(h.lf.CLASS_MAP).sort(),
    Object.keys(h.lf.DEFAULTS).sort(),
    "CLASS_MAP and DEFAULTS must describe the same set of toggles",
  );
  assert.deepEqual(
    Object.values(h.lf.CLASS_MAP).sort(),
    [...TOGGLE_CLASSES].sort(),
    "CLASS_MAP must map to exactly the four lf-hide-* classes",
  );
  h.close();
});

// ---- applyState ------------------------------------------------------------

test("applyState removes a class when its state flips to false", async () => {
  const h = await loadExtension();
  h.lf.currentState.hideFeed = false;
  h.lf.currentState.hideNews = false;
  h.lf.applyState();

  const classes = h.htmlClasses();
  assert.equal(classes.has("lf-hide-feed"), false, "hideFeed:false must remove lf-hide-feed");
  assert.equal(classes.has("lf-hide-news"), false, "hideNews:false must remove lf-hide-news");
  assert.equal(classes.has("lf-hide-ads"), true, "untouched hideAds must keep lf-hide-ads");
  assert.equal(classes.has("lf-hide-badges"), true, "untouched hideBadges must keep lf-hide-badges");
  h.close();
});

test("applyState re-adds a class when its state flips back to true", async () => {
  const h = await loadExtension({ storage: { hideAds: false } });
  assert.equal(h.htmlClasses().has("lf-hide-ads"), false, "stored false must win at init");

  h.lf.currentState.hideAds = true;
  h.lf.applyState();
  assert.equal(h.htmlClasses().has("lf-hide-ads"), true, "flipping back to true must re-add the class");
  h.close();
});

test("applyState is idempotent — repeated calls do not flip classes", async () => {
  const h = await loadExtension();
  const before = [...h.htmlClasses()].sort();
  for (let i = 0; i < 5; i++) h.lf.applyState();
  assert.deepEqual([...h.htmlClasses()].sort(), before, "applyState must be a projection, not a toggle");
  h.close();
});

// ---- isFeedPage / lf-feed-page --------------------------------------------

test("isFeedPage accepts the feed routes and rejects everything else", async () => {
  const cases = [
    ["https://www.linkedin.com/", true],
    ["https://www.linkedin.com/feed", true],
    ["https://www.linkedin.com/feed/", true],
    ["https://www.linkedin.com/in/jemand", false],
    ["https://www.linkedin.com/messaging/", false],
    ["https://www.linkedin.com/feed/update/xyz", false],
  ];
  for (const [url, expected] of cases) {
    const h = await loadExtension({ url });
    assert.equal(h.lf.isFeedPage(), expected, `isFeedPage() wrong for ${url}`);
    assert.equal(
      h.htmlClasses().has("lf-feed-page"),
      expected,
      `lf-feed-page presence wrong for ${url}`,
    );
    h.close();
  }
});

test("lf-feed-page ignores query string and hash", async () => {
  // location.pathname is what FEED_PATHS is matched against; a ?highlight=...
  // on the feed must not drop the scoping class.
  const h = await loadExtension({ url: "https://www.linkedin.com/feed/?trk=nav#top" });
  assert.equal(h.htmlClasses().has("lf-feed-page"), true, "query/hash must not defeat feed detection");
  h.close();
});

// ---- init path -------------------------------------------------------------

test("init fills missing keys from DEFAULTS and lets stored values win", async () => {
  const h = await loadExtension({ storage: { hideFeed: false, hideBadges: false } });
  const classes = h.htmlClasses();
  assert.equal(classes.has("lf-hide-feed"), false, "stored hideFeed:false must remove the class");
  assert.equal(classes.has("lf-hide-badges"), false, "stored hideBadges:false must remove the class");
  assert.equal(classes.has("lf-hide-ads"), true, "missing hideAds must fall back to DEFAULTS (true)");
  assert.equal(classes.has("lf-hide-news"), true, "missing hideNews must fall back to DEFAULTS (true)");
  h.close();
});

test("init coerces corrupted stored values instead of trusting them", async () => {
  // A stray string in storage (older build, manual edit) must not reach
  // classList.toggle as a force argument.
  const h = await loadExtension({ storage: { hideAds: "false", hideNews: 0, hideFeed: null } });
  const classes = h.htmlClasses();
  assert.equal(classes.has("lf-hide-ads"), true, '"false" is not a boolean and must fall back to true');
  assert.equal(classes.has("lf-hide-news"), true, "0 is not a boolean and must fall back to true");
  assert.equal(classes.has("lf-hide-feed"), true, "null is not a boolean and must fall back to true");
  h.close();
});

// ---- onChanged listener ----------------------------------------------------

test("onChanged applies a changed key to <html> without a rescan", async () => {
  const h = await loadExtension();
  await h.storage.local.set({ hideFeed: false });
  // No flush(): the listener calls applyState() synchronously to avoid a
  // one-frame flash of the hidden content.
  assert.equal(h.htmlClasses().has("lf-hide-feed"), false, "toggle must take effect before the next frame");
  h.close();
});

test("onChanged leaves untouched keys alone", async () => {
  const h = await loadExtension();
  await h.storage.local.set({ hideNews: false });
  const classes = h.htmlClasses();
  assert.equal(classes.has("lf-hide-news"), false, "changed key must be applied");
  for (const cls of ["lf-hide-feed", "lf-hide-ads", "lf-hide-badges"]) {
    assert.equal(classes.has(cls), true, `${cls} must be unaffected by a hideNews change`);
  }
  h.close();
});

test("onChanged ignores keys that are not toggles", async () => {
  const h = await loadExtension();
  const before = [...h.htmlClasses()].sort();
  await h.storage.local.set({ someFutureSetting: false, hideFeedX: false });
  await h.flush();
  assert.deepEqual([...h.htmlClasses()].sort(), before, "unknown storage keys must not change any class");
  assert.deepEqual(
    Object.keys(h.lf.currentState).sort(),
    Object.keys(h.lf.DEFAULTS).sort(),
    "unknown keys must not be copied into currentState",
  );
  h.close();
});

test("onChanged coerces a non-boolean newValue to the default", async () => {
  const h = await loadExtension({ storage: { hideFeed: false } });
  assert.equal(h.htmlClasses().has("lf-hide-feed"), false, "precondition: feed visible");

  await h.storage.local.set({ hideFeed: "false" });
  assert.equal(
    h.htmlClasses().has("lf-hide-feed"),
    true,
    'the string "false" must be rejected and fall back to DEFAULTS (true)',
  );
  h.close();
});

test("turning hideAds on later starts marking promoted posts", async () => {
  const h = await loadExtension({
    storage: { hideAds: false },
    body: classicPost({ header: "Jane Doe · Promoted" }),
  });
  const post = h.document.querySelector(".feed-shared-update-v2");
  assert.equal(post.classList.contains("lf-ad"), false, "with hideAds off nothing may be marked");

  await h.storage.local.set({ hideAds: true });
  await h.flush();
  assert.equal(post.classList.contains("lf-ad"), true, "enabling hideAds must trigger a rescan that marks the ad");
  h.close();
});

// ---- remove()/clear(): newValue undefined ----------------------------------

test("remove() restores the defaults and the classes stay put across scans", async () => {
  const h = await loadExtension({ storage: { hideFeed: false, hideAds: false } });
  assert.equal(h.htmlClasses().has("lf-hide-feed"), false, "precondition: feed visible");

  // remove() fires onChanged with oldValue only. Without coercion the
  // undefined newValue would reach classList.toggle(cls, undefined), which per
  // WebIDL means "no force argument" — i.e. flip on every single scan.
  await h.storage.local.remove(["hideFeed", "hideAds"]);
  for (const cls of TOGGLE_CLASSES) {
    assert.equal(h.htmlClasses().has(cls), true, `${cls} must be back to its default right after remove()`);
  }

  // Drive several real scan rounds: each DOM mutation wakes the observer,
  // which reschedules applyState(). A toggling bug shows up here, not above.
  for (let round = 0; round < 5; round++) {
    h.document.body.appendChild(h.document.createElement("div"));
    await h.flush();
    for (const cls of TOGGLE_CLASSES) {
      assert.equal(h.htmlClasses().has(cls), true, `${cls} flipped off in scan round ${round} after remove()`);
    }
  }
  h.close();
});

test("clear() restores the defaults and the classes stay put across scans", async () => {
  const h = await loadExtension({
    storage: { hideFeed: false, hideAds: false, hideNews: false, hideBadges: false },
  });
  for (const cls of TOGGLE_CLASSES) {
    assert.equal(h.htmlClasses().has(cls), false, `precondition: ${cls} must be off`);
  }

  await h.storage.local.clear();
  for (const cls of TOGGLE_CLASSES) {
    assert.equal(h.htmlClasses().has(cls), true, `${cls} must be back to its default right after clear()`);
  }

  for (let round = 0; round < 5; round++) {
    h.document.body.appendChild(h.document.createElement("div"));
    await h.flush();
    for (const cls of TOGGLE_CLASSES) {
      assert.equal(h.htmlClasses().has(cls), true, `${cls} flipped off in scan round ${round} after clear()`);
    }
  }
  h.close();
});

test("currentState holds real booleans after remove(), never undefined", async () => {
  const h = await loadExtension({ storage: { hideNews: false } });
  await h.storage.local.remove("hideNews");
  for (const key of Object.keys(h.lf.CLASS_MAP)) {
    assert.equal(typeof h.lf.currentState[key], "boolean", `${key} must stay a boolean after remove()`);
  }
  assert.equal(h.lf.currentState.hideNews, true, "removed key must revert to its default value");
  h.close();
});

// ---- known open bug --------------------------------------------------------

test(
  "a toggle during the initial read survives",
  async () => {
    // The onChanged listener is installed before storage.local.get(DEFAULTS)
    // resolves. A toggle landing in that window is applied to currentState and
    // then overwritten by the (older) initial read.
    const h = await loadExtension({ autoResolveGet: false });
    await h.storage.local.set({ hideFeed: false });
    assert.equal(h.htmlClasses().has("lf-hide-feed"), false, "toggle must take effect immediately");

    h.resolveInitialGet();
    await h.flush();
    assert.equal(
      h.htmlClasses().has("lf-hide-feed"),
      false,
      "the initial read must not resurrect the pre-toggle value",
    );
    h.close();
  },
);
