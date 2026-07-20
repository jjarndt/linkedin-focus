// Test harness for the LinkedIn Focus content script.
//
// The extension ships as a classic content script: no exports, and loading it
// immediately runs applyState(), installs a MutationObserver and fires
// storage.local.get(). To test the SHIPPED file rather than a test-friendly
// variant of it, we load extension/shared.js + extension/content.js verbatim
// into a jsdom window and append an export epilogue at load time. The files on
// disk are never modified.
//
// Two things are stubbed for determinism, both of them browser plumbing rather
// than extension logic:
//   - requestAnimationFrame: queued, drained explicitly via flush(). The real
//     one would make scheduleScan() fire on wall-clock time.
//   - storage.local.get: its promise is held open until resolveInitialGet() is
//     called, so a test can act in the window between listener registration
//     and the initial read resolving (that window is a real race).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(ROOT, "extension");

const SHARED_SRC = readFileSync(join(EXTENSION, "shared.js"), "utf8");
const CONTENT_SRC = readFileSync(join(EXTENSION, "content.js"), "utf8");

// Internals the tests reach for. Names are coupled to content.js on purpose —
// if a function is renamed, the epilogue fails loudly instead of silently
// testing nothing.
const EPILOGUE = `
;window.__lf = {
  coerce, applyState, isFeedPage, scheduleScan,
  markAdsClassic, markAdsNewShell, markNews,
  findMarkedModules, collapseToSharedCard, outermostSingleChildWrapper,
  CLASS_MAP, DEFAULTS, NEWS_MARKERS, FEED_PATHS,
  get currentState() { return currentState; },
};
`;

// Minimal browser.storage.local double. Mirrors the parts content.js touches,
// including the detail that remove()/clear() fire onChanged with only oldValue
// set — that asymmetry is what the coercion path has to survive.
function makeStorageApi(initial, { getRejects = false } = {}) {
  const data = { ...initial };
  const listeners = [];
  let releaseGet;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });

  function emit(changes, areaName = "local") {
    for (const listener of listeners) listener(changes, areaName);
  }

  return {
    api: {
      storage: {
        local: {
          get(defaults) {
            // Snapshot NOW, resolve later. A real get() reads storage when it
            // runs, not when its promise settles — reading after the gate would
            // let a set() in the waiting window leak into the initial read and
            // paper over the init race the harness is meant to expose.
            const out = { ...(defaults ?? {}) };
            for (const key of Object.keys(data)) out[key] = data[key];
            return getGate.then(() => {
              if (getRejects) throw new Error("storage unavailable");
              return out;
            });
          },
          async set(obj) {
            const changes = {};
            for (const [key, newValue] of Object.entries(obj)) {
              changes[key] = { oldValue: data[key], newValue };
              data[key] = newValue;
            }
            emit(changes);
          },
          async remove(keys) {
            const changes = {};
            for (const key of [].concat(keys)) {
              changes[key] = { oldValue: data[key] }; // no newValue — intentional
              delete data[key];
            }
            emit(changes);
          },
          async clear() {
            const changes = {};
            for (const key of Object.keys(data)) {
              changes[key] = { oldValue: data[key] }; // no newValue — intentional
            }
            for (const key of Object.keys(data)) delete data[key];
            emit(changes);
          },
        },
        onChanged: {
          addListener(fn) {
            listeners.push(fn);
          },
        },
      },
    },
    releaseGet,
    raw: data,
    emit,
  };
}

/**
 * Load the content script into a fresh jsdom window.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.body]    innerHTML for <body>
 * @param {string}  [opts.url]     page URL (drives isFeedPage)
 * @param {object}  [opts.storage] initial storage.local contents
 * @param {boolean} [opts.autoResolveGet=true] resolve the initial get immediately
 * @param {boolean} [opts.getRejects=false]   make the initial get reject
 */
export async function loadExtension(opts = {}) {
  const {
    body = "",
    url = "https://www.linkedin.com/feed/",
    storage = {},
    autoResolveGet = true,
    getRejects = false,
  } = opts;

  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url,
    runScripts: "outside-only",
  });
  const { window } = dom;

  const rafQueue = [];
  window.requestAnimationFrame = (fn) => rafQueue.push(fn);

  const { api, releaseGet, raw, emit } = makeStorageApi(storage, { getRejects });
  window.browser = api;

  const logs = [];
  window.console.log = (...args) => logs.push(args.join(" "));

  window.eval(SHARED_SRC + "\n" + CONTENT_SRC + EPILOGUE);

  // Drain pending microtasks (MutationObserver callbacks, storage promises)
  // and then run whatever rAF callbacks those queued, repeatedly, until the
  // system settles. Bounded so a scheduling bug surfaces as a failure rather
  // than a hung test run.
  async function flush(rounds = 25) {
    for (let i = 0; i < rounds; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!rafQueue.length) {
        if (i > 0) return;
        continue;
      }
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const fn of batch) fn();
    }
  }

  if (autoResolveGet) {
    releaseGet();
    await flush();
  }

  return {
    window,
    document: window.document,
    lf: window.__lf,
    storage: api.storage,
    storageData: raw,
    logs,
    flush,
    resolveInitialGet: releaseGet,
    /** Fire onChanged directly, e.g. with a non-"local" area to test the guard. */
    emitChange: emit,
    /** Classes currently on <html>, as a Set. */
    htmlClasses: () => new Set(window.document.documentElement.classList),
    /** Pending rAF callback count — 0 means the scanner has settled. */
    pendingFrames: () => rafQueue.length,
    close: () => dom.window.close(),
  };
}

/** Build a promoted/organic post in the classic (Ember) shell. */
export function classicPost({ id = "urn:li:activity:1", header = "Jane Doe" } = {}) {
  return `<div class="feed-shared-update-v2" data-id="${id}">
    <div class="update-components-actor__meta">${header}</div>
    <div class="post-body">content</div>
  </div>`;
}

/** Build a post in the new (React) shell, inside the mainFeed container. */
export function newShellFeed(posts) {
  return `<div data-testid="mainFeed">${posts.join("")}</div>`;
}

export function newShellPost({ mountId = "m1", label = null, text = "content" } = {}) {
  const labelEl = label ? `<span>${label}</span>` : "";
  return `<div data-lazy-mount-id="${mountId}"><p>${text}</p>${labelEl}</div>`;
}
