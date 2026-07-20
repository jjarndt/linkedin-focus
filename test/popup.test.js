// Tests for the shipped popup (extension/popup/popup.js), the extension's only
// user interface.
//
// The popup is a classic script pair: popup.html loads shared.js and popup.js
// via <script src>. jsdom is run with runScripts: "outside-only" so those tags
// are inert, and the two files are evaluated verbatim into the window instead —
// the real popup.html is used as the document, so a mismatch between a DEFAULTS
// key and an element id shows up as a failure here.
//
// storage.local.get is gated behind a manually released promise (same idea as
// harness.js's releaseGet): popup.js documents an ordering guarantee — listeners
// are attached only after the read resolves — and that window has to be
// observable to be testable.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POPUP_DIR = join(ROOT, "extension", "popup");

const SHARED_SRC = readFileSync(join(ROOT, "extension", "shared.js"), "utf8");
const POPUP_SRC = readFileSync(join(POPUP_DIR, "popup.js"), "utf8");
const POPUP_HTML = readFileSync(join(POPUP_DIR, "popup.html"), "utf8");

const KEYS = ["hideFeed", "hideAds", "hideNews", "hideBadges"];

/**
 * browser.storage.local double for the popup. Only get/set exist, because those
 * are the only two members popup.js touches — anything else it started calling
 * would throw instead of being silently absorbed.
 */
function makeStorageApi(initial, { failGet = null } = {}) {
  const data = { ...initial };
  const setCalls = [];
  let releaseGet;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });

  return {
    api: {
      storage: {
        local: {
          async get(defaults) {
            await getGate;
            if (failGet) throw failGet;
            const out = { ...(defaults ?? {}) };
            for (const key of Object.keys(data)) out[key] = data[key];
            return out;
          },
          async set(obj) {
            setCalls.push({ ...obj });
            Object.assign(data, obj);
          },
        },
      },
    },
    releaseGet,
    setCalls,
    raw: data,
  };
}

/**
 * Load the popup into a fresh jsdom window.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.storage]  initial storage.local contents
 * @param {boolean} [opts.autoResolveGet=true] resolve the initial get immediately
 * @param {Error}   [opts.failGet]  make the initial get reject with this error
 */
async function loadPopup(opts = {}) {
  const { storage = {}, autoResolveGet = true, failGet = null } = opts;

  const dom = new JSDOM(POPUP_HTML, {
    url: "moz-extension://linkedin-focus/popup/popup.html",
    runScripts: "outside-only",
  });
  const { window } = dom;

  const { api, releaseGet, setCalls, raw } = makeStorageApi(storage, { failGet });
  window.browser = api;

  const errors = [];
  window.console.error = (...args) => errors.push(args);

  // Both files go into ONE eval: `const DEFAULTS` from shared.js lives in that
  // eval's declarative scope, mirroring how two <script> tags share the global
  // lexical environment in a real browser. The epilogue is the only way to read
  // it back out — and it couples this file to the name, so renaming DEFAULTS in
  // shared.js fails loudly here instead of silently testing nothing.
  window.eval(SHARED_SRC + "\n" + POPUP_SRC + "\n;window.__popup = { DEFAULTS };");

  // init() is async: the body of the for-loop runs only once the storage read
  // has settled, i.e. one macrotask turn later at the earliest.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  if (autoResolveGet) {
    releaseGet();
    await flush();
  }

  return {
    window,
    document: window.document,
    setCalls,
    storageData: raw,
    errors,
    flush,
    resolveInitialGet: releaseGet,
    /** The checkbox for a DEFAULTS key. */
    box: (key) => window.document.getElementById(key),
    /** Checked state of all four toggles, keyed by DEFAULTS key. */
    checkedState: () =>
      Object.fromEntries(KEYS.map((k) => [k, window.document.getElementById(k).checked])),
    close: () => dom.window.close(),
  };
}

test("popup.html has a checkbox for every DEFAULTS key", async () => {
  const h = await loadPopup();
  const defaults = h.window.__popup.DEFAULTS;
  assert.deepEqual(
    Object.keys(defaults).sort(),
    [...KEYS].sort(),
    "DEFAULTS drifted from the keys this test file knows about",
  );

  for (const key of Object.keys(defaults)) {
    const el = h.box(key);
    assert.ok(el, `popup.html has no element with id "${key}" — init() would throw on el.checked`);
    assert.equal(el.tagName, "INPUT", `#${key} is a <${el.tagName.toLowerCase()}>, not an input`);
    assert.equal(el.type, "checkbox", `#${key} is type "${el.type}", not a checkbox`);
  }
  h.close();
});

test("empty storage leaves all four toggles on", async () => {
  const h = await loadPopup({ storage: {} });
  assert.deepEqual(
    h.checkedState(),
    { hideFeed: true, hideAds: true, hideNews: true, hideBadges: true },
    "DEFAULTS are all true, so a fresh install must show every toggle on",
  );
  h.close();
});

test("stored values win over defaults, key by key", async () => {
  const h = await loadPopup({ storage: { hideAds: false, hideBadges: false } });
  assert.deepEqual(
    h.checkedState(),
    { hideFeed: true, hideAds: false, hideNews: true, hideBadges: false },
    "stored false must beat the true default, untouched keys must fall back to it",
  );
  h.close();
});

test("toggling a checkbox writes only that key", async () => {
  const h = await loadPopup({ storage: {} });
  h.box("hideNews").click(); // true -> false
  await h.flush();

  assert.deepEqual(h.setCalls, [{ hideNews: false }], "exactly one key must be written, with the new state");
  h.close();
});

test("turning a toggle back on writes true", async () => {
  const h = await loadPopup({ storage: { hideFeed: false } });
  h.box("hideFeed").click(); // false -> true
  await h.flush();

  assert.deepEqual(h.setCalls, [{ hideFeed: true }], "the write must carry the post-click state");
  h.close();
});

test("each checkbox is bound to its own key", async () => {
  const h = await loadPopup({ storage: {} });
  for (const key of KEYS) {
    h.box(key).click();
    await h.flush();
  }

  assert.deepEqual(
    h.setCalls,
    [{ hideFeed: false }, { hideAds: false }, { hideNews: false }, { hideBadges: false }],
    "a closure capturing the wrong `key` or `el` would show up as duplicated or crossed writes",
  );
  h.close();
});

test("a click before the storage read resolves does not write", async () => {
  // The ordering guarantee from popup.js: listeners are attached only after the
  // read settles, so a click landing in that window cannot persist a state that
  // the incoming snapshot is about to overwrite.
  const h = await loadPopup({ storage: { hideFeed: false }, autoResolveGet: false });

  const el = h.box("hideFeed");
  assert.equal(el.checked, false, "markup starts unchecked before init() runs");
  el.click(); // user flips it to true while the read is still in flight
  await h.flush();

  assert.deepEqual(h.setCalls, [], "no listener may be attached yet, so nothing may be written");

  h.resolveInitialGet();
  await h.flush();

  assert.equal(el.checked, false, "the storage snapshot must win over the premature click");
  assert.deepEqual(h.setCalls, [], "the snapshot must not be written back either");
  h.close();
});

test("clicks after the read resolves are wired up", async () => {
  // Counterpart to the test above: proves the previous assertion is about
  // ordering, not about the listener never being attached at all.
  const h = await loadPopup({ storage: { hideFeed: false }, autoResolveGet: false });
  h.resolveInitialGet();
  await h.flush();

  h.box("hideFeed").click();
  await h.flush();
  assert.deepEqual(h.setCalls, [{ hideFeed: true }], "listener must be live once init() has finished");
  h.close();
});

test("a failing storage read is caught and logged", async () => {
  const boom = new Error("storage unavailable");
  const h = await loadPopup({ failGet: boom });

  assert.equal(h.errors.length, 1, "the rejection must be reported exactly once");
  const [prefix, err] = h.errors[0];
  assert.match(String(prefix), /LinkedIn Focus/, "log line must identify the extension");
  assert.equal(err, boom, "the original error must be passed through, not swallowed");

  // Nothing was wired up, so the UI stays at its markup state rather than
  // pretending to reflect storage.
  assert.deepEqual(
    h.checkedState(),
    { hideFeed: false, hideAds: false, hideNews: false, hideBadges: false },
    "a failed read must leave the checkboxes at their unchecked markup state",
  );
  h.box("hideFeed").click();
  await h.flush();
  assert.deepEqual(h.setCalls, [], "no listeners exist after a failed init");
  h.close();
});
