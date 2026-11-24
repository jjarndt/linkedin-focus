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
// browser.i18n is stubbed from the shipped English messages.json,
// not from a hand-written map, so a key that exists in popup.html but not in a
// locale file fails here.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { connectBackground } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POPUP_DIR = join(ROOT, "extension", "popup");

const SHARED_SRC = readFileSync(join(ROOT, "extension", "shared.js"), "utf8");
const POPUP_SRC = readFileSync(join(POPUP_DIR, "popup.js"), "utf8");
const POPUP_HTML = readFileSync(join(POPUP_DIR, "popup.html"), "utf8");

const LOCALES_DIR = join(ROOT, "extension", "_locales");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "extension", "manifest.json"), "utf8"));

const KEYS = ["hideFeed", "hideAds", "hideNews", "hideBadges"];

/** Flatten a shipped messages.json to { key: message }. */
function readEnglishMessages() {
  const raw = JSON.parse(readFileSync(join(LOCALES_DIR, "en", "messages.json"), "utf8"));
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
function makeStorageApi(initial, { failGet, pageAccount }) {
  const data = { ...initial };
  const setCalls = [];
  const sentMessages = [];
  let nextWriteError;
  let releaseGet;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });

  return {
    api: {
      tabs: {
        async query(options) {
          return options.active && options.currentWindow ? [{ id: 7 }] : [];
        },
        async sendMessage(tabId, message) {
          if (message === "getPageAccount") {
            if (pageAccount instanceof Error) throw pageAccount;
            return pageAccount;
          }
          sentMessages.push({ tabId, message, stored: { ...data } });
        },
      },
      storage: {
        local: {
          async get(defaults) {
            await getGate;
            if (failGet) throw failGet;
            const out = { ...(defaults ?? {}) };
            for (const key of Object.keys(data)) out[key] = data[key];
            return out;
          },
          set(obj) {
            const changes = structuredClone(obj);
            setCalls.push(changes);
            if (nextWriteError) {
              const result = Promise.reject(nextWriteError);
              nextWriteError = undefined;
              // Observe the mock rejection without consuming it for popup.js.
              result.catch(() => {});
              return result;
            }
            Object.assign(data, changes);
            return Promise.resolve();
          },
        },
      },
    },
    releaseGet,
    setCalls,
    sentMessages,
    failNextWrite: (error) => { nextWriteError = error; },
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
 * @param {object}  [opts.messages] message map replacing the shipped English messages
 * @param {string}  [opts.uiLocale] what @@ui_locale reports
 * @param {boolean} [opts.noI18n=false] omit browser.i18n entirely
 */
async function loadPopup(opts = {}) {
  const {
    storage = {},
    autoResolveGet = true,
    failGet = null,
    messages = null,
    uiLocale = "en_US",
    noI18n = false,
    pageAccount = null,
  } = opts;

  const dom = new JSDOM(POPUP_HTML, {
    url: "moz-extension://linkedin-focus/popup/popup.html",
    runScripts: "outside-only",
  });
  const { window } = dom;

  const { api, releaseGet, setCalls, sentMessages, failNextWrite, raw } = makeStorageApi(storage, { failGet, pageAccount });
  api.runtime = { sendMessage: connectBackground(api.storage) };
  const { i18n, calls: i18nCalls } = makeI18nApi(messages ?? readEnglishMessages(), uiLocale);
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
    sentMessages,
    failNextWrite,
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

test("invalid stored values show the same defaults the content script applies", async (t) => {
  const h = await loadPopup({ storage: { hideFeed: null, hideAds: 0, hideNews: "", hideBadges: false } });
  t.after(h.close);

  assert.deepEqual(h.checkedState(), {
    hideFeed: true,
    hideAds: true,
    hideNews: true,
    hideBadges: false,
  });
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

test("the popup only accepts clicks after the storage read resolves", async (t) => {
  const h = await loadPopup({ storage: { hideFeed: false }, autoResolveGet: false });
  t.after(h.close);

  const el = h.box("hideFeed");
  assert.equal(el.checked, false, "markup starts unchecked before init() runs");
  el.click();
  await h.flush();

  assert.equal(el.checked, false, "a click during loading must not show a state that cannot be saved");
  assert.deepEqual(h.setCalls, [], "nothing may be written while storage is loading");

  h.resolveInitialGet();
  await h.flush();

  assert.equal(el.disabled, false, "the checkbox must become usable after loading");
  assert.equal(el.checked, false, "the checkbox must show the storage snapshot");
  assert.deepEqual(h.setCalls, [], "the snapshot must not be written back either");
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

test("a failing storage read keeps the popup controls disabled and is logged", async (t) => {
  const boom = new Error("storage unavailable");
  const h = await loadPopup({ failGet: boom });
  t.after(h.close);

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
  assert.equal(h.box("hideFeed").checked, false, "a failed read must not leave an apparently working toggle");
  assert.deepEqual(h.setCalls, [], "no change can be saved after a failed init");
});

test("a failed storage write restores the last saved value and allows retrying", async (t) => {
  const h = await loadPopup({ storage: { hideFeed: true } });
  t.after(h.close);

  h.failNextWrite(new Error("storage unavailable"));
  h.box("hideFeed").click();
  await h.flush();

  assert.equal(h.storageData.hideFeed, true, "precondition: the failed write did not change storage");
  assert.equal(h.box("hideFeed").checked, true, "the popup must still show the last saved value");
  assert.equal(h.box("hideFeed").disabled, false, "the toggle must be usable again");
  assert.deepEqual(h.sentMessages, [], "a failed write must not request a refresh");

  h.box("hideFeed").click();
  await h.flush();

  assert.equal(h.storageData.hideFeed, false, "retrying must persist the new selection");
});

test("saving a setting refreshes the active tab after the write", async (t) => {
  const h = await loadPopup();
  t.after(h.close);

  h.box("hideFeed").click();
  await h.flush();

  assert.deepEqual(h.sentMessages, [
    { tabId: 7, message: "refreshSettings", stored: { hideFeed: false } },
  ]);
});

// --- Localization -----------------------------------------------------------

test("the extension ships only English UI messages", async () => {
  const h = await loadPopup();
  const en = readEnglishMessages();

  const shippedLocales = readdirSync(LOCALES_DIR)
    .filter((locale) => existsSync(join(LOCALES_DIR, locale, "messages.json")));
  assert.deepEqual(shippedLocales, ["en"]);
  assert.equal(MANIFEST.default_locale, "en");
  assert.equal(MANIFEST.description, "__MSG_appDescription__");
  assert.ok(en.appDescription.startsWith("Hide the LinkedIn feed"));
  const used = Object.keys(h.i18nText());
  assert.ok(used.length > 0, "popup.html declares no data-i18n at all");
  for (const key of used) {
    assert.ok(en[key]?.length > 0, `popup.html uses "${key}" without an English message`);
  }
  h.close();
});

test("every data-i18n placeholder is actually replaced", async () => {
  // Sentinel messages: distinct from anything in the markup, so any element
  // still showing its shipped text was never resolved.
  const sentinels = Object.fromEntries(
    Object.keys(readEnglishMessages()).map((key) => [key, `__resolved:${key}__`]),
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

test("a German browser locale still shows and announces the popup in English", async () => {
  const h = await loadPopup({ uiLocale: "de_DE" });

  assert.equal(h.document.documentElement.lang, "en");
  assert.equal(h.document.title, "LinkedIn Focus");
  assert.equal(h.labelFor("hideAds"), "Ads");
  assert.equal(h.labelFor("hideNews"), "News & Games");
  assert.equal(h.labelFor("hideBadges"), "Notification badges");
  assert.ok(!h.i18nCalls.includes("@@ui_locale"));
  h.close();
});

test("a missing message keeps the English fallback and a usable toggle", async () => {
  // A translator drops a key, or a locale file is one release behind. The label
  // must not be blanked: an empty <label> is an unclickable checkbox.
  const partial = readEnglishMessages();
  delete partial.toggleAds;
  const h = await loadPopup({ storage: {}, messages: partial, uiLocale: "de_DE" });

  assert.equal(h.labelFor("hideAds"), "Ads", "missing message must fall back to the markup text");
  assert.equal(h.labelFor("hideFeed"), "Feed / Timeline", "present messages must still apply");
  assert.equal(h.labelFor("hideNews"), "News & Games");

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
  const en = readEnglishMessages();
  for (const [key, text] of Object.entries(h.i18nText())) {
    assert.equal(text, en[key], `markup fallback for "${key}" drifted from _locales/en`);
  }
  h.close();
});

async function addAccount(h, url, key = "allowedAccounts") {
  const form = h.document.getElementById(`${key}Form`);
  form.querySelector("input").value = url;
  form.querySelector("button[type=submit]").click();
  await h.flush();
}

function listedAccounts(h, key = "allowedAccounts") {
  return [...h.document.querySelectorAll(`#${key}List li span`)].map((label) => label.textContent);
}

test("allowed accounts persist across reopened popups and can be removed individually", async (t) => {
  const initial = await loadPopup({ storage: { hideAds: false } });
  t.after(initial.close);
  await addAccount(initial, "https://www.linkedin.com/in/Jane-Doe/?trk=feed");
  await addAccount(initial, "https://www.linkedin.com/company/example-inc/");

  assert.deepEqual(listedAccounts(initial), ["/in/jane-doe", "/company/example-inc"]);
  assert.equal(initial.document.getElementById("accountUrl").value, "");
  assert.deepEqual(initial.storageData, { hideAds: false, allowedAccounts: ["/in/jane-doe", "/company/example-inc"] });
  assert.equal(initial.sentMessages.at(-1).message, "refreshSettings");

  const reopened = await loadPopup({ storage: initial.storageData });
  t.after(reopened.close);
  assert.deepEqual(listedAccounts(reopened), ["/in/jane-doe", "/company/example-inc"]);

  reopened.document.querySelector('[aria-label="Remove /in/jane-doe"]').click();
  await reopened.flush();
  assert.deepEqual(listedAccounts(reopened), ["/company/example-inc"]);
  assert.deepEqual(reopened.setCalls, [{ allowedAccounts: ["/company/example-inc"] }]);
});

test("the allowed account form rejects invalid and duplicate URLs without writing", async (t) => {
  const h = await loadPopup({ storage: { allowedAccounts: ["/in/jane"] } });
  t.after(h.close);
  const status = h.document.getElementById("accountStatus");
  await addAccount(h, "https://not-linkedin.test/in/jane");
  assert.equal(status.textContent, "Enter a LinkedIn profile or company URL.");
  await addAccount(h, "https://uk.linkedin.com/in/Jane/?trk=feed");
  assert.equal(status.textContent, "This account is already allowed.");
  assert.deepEqual(h.setCalls, []);
  assert.deepEqual(listedAccounts(h), ["/in/jane"]);
});

test("allowed account controls stay disabled until storage has loaded", async (t) => {
  const h = await loadPopup({ autoResolveGet: false });
  t.after(h.close);
  const controls = h.document.getElementById("allowedAccountsControls");
  assert.equal(controls.disabled, true);
  await addAccount(h, "/in/jane");
  assert.deepEqual(h.setCalls, []);

  h.resolveInitialGet();
  await h.flush();
  assert.equal(controls.disabled, false);
  assert.deepEqual(listedAccounts(h), []);
});

test("failed allow-list writes preserve stored accounts and leave the entry available for retry", async (t) => {
  const h = await loadPopup({ storage: { allowedAccounts: ["/in/jane"] } });
  t.after(h.close);
  const status = h.document.getElementById("accountStatus");
  h.failNextWrite(new Error("storage unavailable"));
  await addAccount(h, "/company/example-inc");

  assert.match(status.textContent, /Could not save/);
  assert.equal(h.document.getElementById("accountUrl").value, "/company/example-inc");
  assert.deepEqual(listedAccounts(h), ["/in/jane"]);
  assert.equal(h.sentMessages.length, 0);

  h.failNextWrite(new Error("storage unavailable"));
  h.document.querySelector('[aria-label="Remove /in/jane"]').click();
  await h.flush();
  assert.deepEqual(h.storageData.allowedAccounts, ["/in/jane"]);
  assert.deepEqual(listedAccounts(h), ["/in/jane"]);

  await addAccount(h, "/company/example-inc");
  assert.deepEqual(listedAccounts(h), ["/in/jane", "/company/example-inc"]);
});

test("the current profile or company can be allowed directly from the popup", async (t) => {
  for (const path of ["/in/alex", "/company/example"]) {
    const h = await loadPopup({ pageAccount: path, storage: { allowedAccounts: ["/in/existing"] } });
    t.after(h.close);
    const button = h.document.getElementById("allowPageAccount");

    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    button.click();
    await h.flush();

    assert.deepEqual(h.storageData.allowedAccounts, ["/in/existing", path]);
    assert.deepEqual(listedAccounts(h), ["/in/existing", path]);
    assert.equal(button.textContent, "Account allowed");
    assert.equal(button.disabled, true);

    h.document.querySelector(`[aria-label="Remove ${path}"]`).click();
    await h.flush();
    assert.equal(button.textContent, "Allow this account");
    assert.equal(button.disabled, false);
  }
});

test("an already allowed page starts disabled and does not write a duplicate", async (t) => {
  const h = await loadPopup({ pageAccount: "/in/alex", storage: { allowedAccounts: ["/in/alex"] } });
  t.after(h.close);
  const button = h.document.getElementById("allowPageAccount");

  assert.equal(button.textContent, "Account allowed");
  button.click();
  await h.flush();
  assert.deepEqual(h.setCalls, []);
});

test("the popup hides the shortcut on unsupported pages and when there is no receiver", async (t) => {
  for (const pageAccount of [null, new Error("no content script"), "https://example.test/in/other"]) {
    const h = await loadPopup({ pageAccount });
    t.after(h.close);
    assert.equal(h.document.getElementById("allowPageAccount").hidden, true);
    assert.equal(h.document.getElementById("blockPageAccount").hidden, true);
    assert.deepEqual(h.errors, []);
  }
});

test("a failed page shortcut write can be retried with the same account", async (t) => {
  const h = await loadPopup({ pageAccount: "/company/example" });
  t.after(h.close);
  const button = h.document.getElementById("allowPageAccount");
  h.failNextWrite(new Error("storage unavailable"));
  button.click();
  await h.flush();

  assert.match(h.document.getElementById("accountStatus").textContent, /Could not save/);
  assert.equal(button.disabled, false);
  assert.deepEqual(listedAccounts(h), []);

  button.click();
  await h.flush();
  assert.deepEqual(listedAccounts(h), ["/company/example"]);
  assert.equal(button.disabled, true);
});

test("blocked accounts persist after reopening and removal leaves the allow list intact", async (t) => {
  const initial = await loadPopup({ storage: { allowedAccounts: ["/in/alex"] } });
  t.after(initial.close);
  await addAccount(initial, "https://www.linkedin.com/in/Alex/?trk=feed", "blockedAccounts");
  await addAccount(initial, "https://uk.linkedin.com/company/Example/", "blockedAccounts");
  assert.deepEqual(initial.storageData, {
    allowedAccounts: ["/in/alex"],
    blockedAccounts: ["/in/alex", "/company/example"],
  });
  assert.equal(initial.sentMessages.at(-1).message, "refreshSettings");

  const reopened = await loadPopup({ storage: initial.storageData });
  t.after(reopened.close);
  assert.deepEqual(listedAccounts(reopened, "blockedAccounts"), ["/in/alex", "/company/example"]);
  reopened.document.querySelector('#blockedAccountsList [aria-label="Remove /in/alex"]').click();
  await reopened.flush();
  assert.deepEqual(listedAccounts(reopened), ["/in/alex"]);
  assert.deepEqual(listedAccounts(reopened, "blockedAccounts"), ["/company/example"]);
  assert.deepEqual(reopened.setCalls, [{ blockedAccounts: ["/company/example"] }]);
});

test("the block form rejects unrelated URLs and normalized duplicates", async (t) => {
  const h = await loadPopup({ storage: { blockedAccounts: ["/in/alex"] } });
  t.after(h.close);
  const status = h.document.getElementById("blockedAccountStatus");
  await addAccount(h, "https://example.test/in/alex", "blockedAccounts");
  assert.equal(status.textContent, "Enter a LinkedIn profile or company URL.");
  await addAccount(h, "https://de.linkedin.com/in/ALEX/", "blockedAccounts");
  assert.equal(status.textContent, "This account is already blocked.");
  assert.deepEqual(h.setCalls, []);
});

test("the profile shortcut saves only the block list and can retry a failed write", async (t) => {
  const h = await loadPopup({ pageAccount: "/in/alex", storage: { allowedAccounts: ["/in/alex"] } });
  t.after(h.close);
  const block = h.document.getElementById("blockPageAccount");
  assert.equal(block.hidden, false);
  h.failNextWrite(new Error("storage unavailable"));
  block.click();
  await h.flush();
  assert.equal(h.document.getElementById("blockedAccountStatus").textContent, "Could not save your blocked accounts. Try again.");
  assert.equal(block.disabled, false);
  assert.equal(h.storageData.blockedAccounts, undefined);
  assert.deepEqual(h.sentMessages, []);

  block.click();
  await h.flush();
  assert.deepEqual(h.storageData, { allowedAccounts: ["/in/alex"], blockedAccounts: ["/in/alex"] });
  assert.equal(block.textContent, "Account blocked");
  assert.equal(block.disabled, true);
  assert.equal(h.document.getElementById("allowPageAccount").textContent, "Account allowed");
});
