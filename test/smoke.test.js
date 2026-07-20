// Harness smoke test: proves the shipped content script loads, its internals
// are reachable, and the scan loop settles. If this fails, every other test
// file in here is meaningless.

import test from "node:test";
import assert from "node:assert/strict";
import { loadExtension } from "./harness.js";

test("content script loads and exposes its internals", async () => {
  const h = await loadExtension();
  assert.ok(h.lf, "epilogue did not run");
  for (const name of ["coerce", "applyState", "markNews", "markAdsClassic", "collapseToSharedCard"]) {
    assert.equal(typeof h.lf[name], "function", `${name} missing from content.js`);
  }
  h.close();
});

test("defaults hide everything and land on <html>", async () => {
  const h = await loadExtension();
  const classes = h.htmlClasses();
  for (const cls of ["lf-hide-feed", "lf-hide-ads", "lf-hide-news", "lf-hide-badges"]) {
    assert.ok(classes.has(cls), `${cls} not applied from DEFAULTS`);
  }
  h.close();
});

test("scan loop settles instead of rescheduling forever", async () => {
  const h = await loadExtension({ body: "<aside><p>unrelated</p></aside>" });
  await h.flush();
  assert.equal(h.pendingFrames(), 0, "scanner never came to rest");
  h.close();
});
