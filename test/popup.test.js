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
//
// browser.i18n is stubbed from the SHIPPED extension/_locales/*/messages.json,
// not from a hand-written map, so a key that exists in popup.html but not in a
// locale file fails here.

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

const LOCALES_DIR = join(ROOT, "extension", "_locales");

const KEYS = ["hideFeed", "hideAds", "hideNews", "hideBadges"];

/** Locales the extension ships, and the @@ui_locale each one would report. */
const UI_LOCALES = { en: "en_US", de: "de_DE" };

/** Flatten a shipped messages.json to { key: message }. */
function readLocale(locale) {
  const raw = JSON.parse(readFileSync(join(LOCALES_DIR, locale, "messages.json"), "utf8"));
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, entry.message]));
}

/**
 * browser.i18n double. getMessage returns "" for an unknown key, which is what
 * the real API does — that behaviour is exactly what popup.js has to survive.
 */
function makeI18nApi(messages, uiLocale) {
  const calls = [];
  return {
    calls,
    i18n: {
      getMessage(key) {
        calls.push(key);
        if (key === "@@ui_locale") return uiLocale ?? "";
        return messages[key] ?? "";
      },
    },
  };
}

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
 * @param {string}  [opts.locale="en"] which shipped locale browser.i18n serves
 * @param {object}  [opts.messages] message map replacing the shipped locale
 * @param {string}  [opts.uiLocale] what @@ui_locale reports
 * @param {boolean} [opts.noI18n=false] omit browser.i18n entirely
 */
async function loadPopup(opts = {}) {
  const {
    storage = {},
    autoResolveGet = true,
    failGet = null,
    locale = "en",
    messages = null,
    uiLocale = UI_LOCALES[locale],
    noI18n = false,
  } = opts;

  const dom = new JSDOM(POPUP_HTML, {
    url: "moz-extension://linkedin-focus/popup/popup.html",
    runScripts: "outside-only",
  });
  const { window } = dom;

  const { api, releaseGet, setCalls, raw } = makeStorageApi(storage, { failGet });
  const { i18n, calls: i18nCalls } = makeI18nApi(messages ?? readLocale(locale), uiLocale);
  if (!noI18n) api.i18n = i18n;
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
    i18nCalls,
    resolveInitialGet: releaseGet,
    /** Rendered text of every [data-i18n] element, keyed by its message key. */
    i18nText: () =>
      Object.fromEntries(
        [...window.document.querySelectorAll("[data-i18n]")].map((el) => [
          el.dataset.i18n,
          el.textContent,
        ]),
      ),
    /** Visible text of the <label> bound to a checkbox. */
    labelFor: (key) =>
      window.document.querySelector(`label[for="${key}"]`)?.textContent ?? null,
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

// --- Localization -----------------------------------------------------------

test("both shipped locales define exactly the same keys", () => {
  const en = readLocale("en");
  const de = readLocale("de");
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(de).sort(),
    "a key present in one locale and missing in the other silently ships untranslated UI",
  );
  for (const [key, message] of Object.entries(de)) {
    assert.ok(message.length > 0, `de message "${key}" is empty — getMessage would return nothing`);
    assert.ok(en[key].length > 0, `en message "${key}" is empty`);
  }
});

test("every data-i18n key in popup.html exists in both locales", async () => {
  const h = await loadPopup();
  const en = readLocale("en");
  const de = readLocale("de");
  const used = Object.keys(h.i18nText());

  assert.ok(used.length > 0, "popup.html declares no data-i18n at all");
  for (const key of used) {
    assert.ok(key in en, `popup.html uses "${key}" but _locales/en has no such message`);
    assert.ok(key in de, `popup.html uses "${key}" but _locales/de has no such message`);
  }
  h.close();
});

test("every data-i18n placeholder is actually replaced", async () => {
  // Sentinel messages: distinct from anything in the markup, so any element
  // still showing its shipped text was never resolved.
  const sentinels = Object.fromEntries(
    Object.keys(readLocale("en")).map((key) => [key, `__resolved:${key}__`]),
  );
  const h = await loadPopup({ messages: sentinels, uiLocale: "xx_XX" });

  const rendered = h.i18nText();
  for (const [key, text] of Object.entries(rendered)) {
    assert.equal(text, sentinels[key], `[data-i18n="${key}"] still shows unresolved markup text`);
  }
  assert.equal(h.document.title, sentinels.appName, "<title> was not localized");
  assert.equal(
    h.document.body.textContent.includes("data-i18n"),
    false,
    "raw attribute text leaked into the rendered popup",
  );
  h.close();
});

test("the German locale replaces every visible string", async () => {
  const h = await loadPopup({ locale: "de" });
  const de = readLocale("de");

  assert.deepEqual(
    h.i18nText(),
    {
      appName: de.appName,
      popupHint: de.popupHint,
      toggleFeed: de.toggleFeed,
      toggleAds: de.toggleAds,
      toggleNews: de.toggleNews,
      toggleBadges: de.toggleBadges,
    },
    "the shipped German wording must reach the DOM",
  );
  assert.equal(h.labelFor("hideAds"), "Werbung");
  assert.equal(h.document.documentElement.lang, "de-DE", "lang must follow the UI locale");
  h.close();
});

test("lang is rewritten from @@ui_locale in BCP 47 form", async () => {
  // Chromium and Firefox report a regional locale with an underscore ("en_US").
  const h = await loadPopup({ locale: "en" });
  assert.equal(
    h.document.documentElement.lang,
    "en-US",
    "@@ui_locale uses underscores; the lang attribute needs a hyphen",
  );
  h.close();
});

test("a bare @@ui_locale is passed through unchanged", async () => {
  // Safari returns the matched _locales directory name verbatim, so this
  // extension sees "de", not "de_DE". The underscore rewrite must be a no-op
  // there rather than mangling a already-valid tag.
  const h = await loadPopup({ locale: "de", uiLocale: "de" });
  assert.equal(h.document.documentElement.lang, "de");
  h.close();
});

test("an empty @@ui_locale leaves the markup lang alone", async () => {
  // Without a _locales match every predefined message is "". Writing that into
  // lang= would strip the document's language entirely.
  const h = await loadPopup({ locale: "en", uiLocale: "" });
  assert.equal(h.document.documentElement.lang, "en", "lang must not be blanked");
  h.close();
});

test("a missing message keeps the English fallback and a usable toggle", async () => {
  // A translator drops a key, or a locale file is one release behind. The label
  // must not be blanked: an empty <label> is an unclickable checkbox.
  const partial = readLocale("de");
  delete partial.toggleAds;
  const h = await loadPopup({ storage: {}, messages: partial, uiLocale: "de_DE" });

  assert.equal(h.labelFor("hideAds"), "Ads", "missing message must fall back to the markup text");
  assert.equal(h.labelFor("hideFeed"), "Feed / Timeline", "present messages must still apply");
  assert.equal(h.labelFor("hideNews"), "News & Spiele");

  // The toggle still works end to end.
  assert.deepEqual(h.checkedState(), {
    hideFeed: true,
    hideAds: true,
    hideNews: true,
    hideBadges: true,
  });
  h.box("hideAds").click();
  await h.flush();
  assert.deepEqual(h.setCalls, [{ hideAds: false }], "the toggle must stay wired");
  h.close();
});

test("no i18n API at all leaves the popup usable in English", async () => {
  // Safari or a stripped build without browser.i18n: cosmetics degrade, wiring
  // does not.
  const h = await loadPopup({ storage: {}, noI18n: true });

  assert.equal(h.errors.length, 0, "a missing i18n API is not an error path");
  assert.equal(h.labelFor("hideAds"), "Ads", "markup text is the English reference wording");
  assert.equal(h.document.documentElement.lang, "en", "lang stays at the markup default");

  h.box("hideBadges").click();
  await h.flush();
  assert.deepEqual(h.setCalls, [{ hideBadges: false }], "toggles must work without i18n");
  h.close();
});

test("popup.html ships the English reference wording as its fallback", async () => {
  // The inline text is what a user sees when i18n is unavailable, so it has to
  // BE the en locale rather than merely resemble it.
  const h = await loadPopup({ noI18n: true });
  const en = readLocale("en");
  for (const [key, text] of Object.entries(h.i18nText())) {
    assert.equal(text, en[key], `markup fallback for "${key}" drifted from _locales/en`);
  }
  h.close();
});
