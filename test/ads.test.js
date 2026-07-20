// Promoted-post detection in both shells: markAdsClassic (Ember) and
// markAdsNewShell (React), plus the checked-memo that used to live in a
// page-writable DOM attribute.

import test from "node:test";
import assert from "node:assert/strict";
import { loadExtension, classicPost, newShellFeed, newShellPost } from "./harness.js";

const isAd = (el) => el.classList.contains("lf-ad");

// ---- classic shell: label matching ----------------------------------------

test("classic shell marks a promoted post and leaves organic posts alone", async () => {
  const h = await loadExtension({
    body: classicPost({ id: "urn:li:activity:1", header: "Acme Corp · Promoted" }) +
      classicPost({ id: "urn:li:activity:2", header: "Jane Doe · 3rd+" }),
  });
  h.lf.markAdsClassic();
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:1"]')), true, "promoted post was not marked lf-ad");
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:2"]')), false, "organic post was wrongly marked lf-ad");
  h.close();
});

test("classic shell matches all four labels case-insensitively", async () => {
  const headers = ["promoted", "GESPONSERT", "Sponsored", "anzeige", "Werbung – Anzeige", "Beitrag ist Gesponsert."];
  const h = await loadExtension({
    body: headers.map((header, i) => classicPost({ id: `urn:li:activity:${i}`, header })).join(""),
  });
  h.lf.markAdsClassic();
  headers.forEach((header, i) => {
    const post = h.document.querySelector(`[data-id="urn:li:activity:${i}"]`);
    assert.equal(isAd(post), true, `header "${header}" was not recognised as a promoted label`);
  });
  h.close();
});

test("classic shell respects word boundaries around the labels", async () => {
  // "Anzeigen" / "Promotedly" contain a label as a prefix but are ordinary words.
  const headers = ["Stellenanzeigen", "Anzeigen verwalten", "Promotedly Inc.", "Anzeigenpreise 2026", "Unsponsored content"];
  const h = await loadExtension({
    body: headers.map((header, i) => classicPost({ id: `urn:li:activity:${i}`, header })).join(""),
  });
  h.lf.markAdsClassic();
  headers.forEach((header, i) => {
    const post = h.document.querySelector(`[data-id="urn:li:activity:${i}"]`);
    assert.equal(isAd(post), false, `header "${header}" must not match the promoted regex`);
  });
  h.close();
});

test("classic shell finds posts via data-id, data-urn and the v2 class", async () => {
  const h = await loadExtension({
    body: `
      <div data-id="urn:li:activity:10"><div class="update-components-actor__meta">Promoted</div></div>
      <div data-urn="urn:li:activity:11"><div class="update-components-actor__meta">Promoted</div></div>
      <div class="feed-shared-update-v2" id="bare"><div class="update-components-actor__meta">Promoted</div></div>
      <div data-id="urn:li:job:12"><div class="update-components-actor__meta">Promoted</div></div>`,
  });
  h.lf.markAdsClassic();
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:10"]')), true, "data-id post not detected");
  assert.equal(isAd(h.document.querySelector('[data-urn="urn:li:activity:11"]')), true, "data-urn post not detected");
  assert.equal(isAd(h.document.getElementById("bare")), true, "div.feed-shared-update-v2 without urn attributes not detected");
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:job:12"]')), false, "non-activity urn must not be treated as a feed post");
  h.close();
});

test("classic shell reads the sub-description header too", async () => {
  const h = await loadExtension({
    body: `<div data-id="urn:li:activity:20">
      <div class="update-components-actor__sub-description">Gesponsert</div>
    </div>`,
  });
  h.lf.markAdsClassic();
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:20"]')), true, "sub-description header was not consulted");
  h.close();
});

// ---- classic shell: hydration retry ----------------------------------------

test("classic shell re-checks a post whose actor header hydrates later", async () => {
  const h = await loadExtension({
    body: `<div class="feed-shared-update-v2" data-id="urn:li:activity:30"><div class="post-body">content</div></div>`,
  });
  const post = h.document.querySelector('[data-id="urn:li:activity:30"]');

  h.lf.markAdsClassic();
  assert.equal(isAd(post), false, "post without a header must not be marked");

  // Header arrives with the hydration pass; the first scan must not have
  // memoised the post, otherwise the ad would survive forever.
  const header = h.document.createElement("div");
  header.className = "update-components-actor__meta";
  header.textContent = "Acme Corp · Promoted";
  post.prepend(header);

  h.lf.markAdsClassic();
  assert.equal(isAd(post), true, "post was memoised before hydration and never re-checked");
  h.close();
});

// ---- classic shell: the memo is not page-controlled -------------------------

// Both posts are injected AFTER load, i.e. the extension has never seen them.
// A post already present at load is legitimately memoised by the first scan,
// which would make these assertions pass for the wrong reason.

test("page-set data-lf-checked cannot make a promoted post survive the scan", async () => {
  const id = "urn:li:activity:40";
  const h = await loadExtension();
  // Old memo format: attribute value === data-id meant "already checked".
  h.document.body.insertAdjacentHTML(
    "beforeend",
    classicPost({ id, header: "Acme Corp · Promoted" }).replace("<div ", `<div data-lf-checked="${id}" `),
  );
  const post = h.document.querySelector(`[data-id="${id}"]`);
  assert.equal(post.getAttribute("data-lf-checked"), id, "precondition: attack attribute not set");

  h.lf.markAdsClassic();
  assert.equal(isAd(post), true, "a page-written data-lf-checked attribute skipped the ad scan");
  h.close();
});

test("page-set lf-ad on an organic post is removed by the scan", async () => {
  const id = "urn:li:activity:41";
  const h = await loadExtension();
  h.document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="feed-shared-update-v2 lf-ad" data-id="${id}" data-lf-checked="${id}">
      <div class="update-components-actor__meta">Jane Doe</div>
    </div>`,
  );
  const post = h.document.querySelector(`[data-id="${id}"]`);

  h.lf.markAdsClassic();
  assert.equal(isAd(post), false, "a page-pinned lf-ad class kept an organic post hidden forever");
  h.close();
});

test("classic shell memo skips a post that has not changed identity", async () => {
  const id = "urn:li:activity:42";
  const h = await loadExtension({ body: classicPost({ id, header: "Jane Doe" }) });
  const post = h.document.querySelector(`[data-id="${id}"]`);

  h.lf.markAdsClassic();
  // The class is our probe: a second inspection would strip it again.
  post.classList.add("lf-ad");
  h.lf.markAdsClassic();
  assert.equal(isAd(post), true, "post was inspected a second time although its identity was unchanged");
  h.close();
});

test("classic shell re-checks a recycled container and drops the stale lf-ad", async () => {
  const h = await loadExtension({ body: classicPost({ id: "urn:li:activity:43", header: "Acme · Promoted" }) });
  const post = h.document.querySelector('[data-id="urn:li:activity:43"]');
  h.lf.markAdsClassic();
  assert.equal(isAd(post), true, "promoted post was not marked before recycling");

  // Same DOM node, different post: the shell reused the container.
  post.setAttribute("data-id", "urn:li:activity:44");
  post.querySelector(".update-components-actor__meta").textContent = "Jane Doe";

  h.lf.markAdsClassic();
  assert.equal(isAd(post), false, "stale lf-ad survived on a recycled container");
  h.close();
});

// ---- new shell -------------------------------------------------------------

test("new shell marks a post whose leaf text is exactly a label", async () => {
  const h = await loadExtension({
    body: newShellFeed([
      newShellPost({ mountId: "ad", label: "Promoted" }),
      newShellPost({ mountId: "organic" }),
      newShellPost({ mountId: "de", label: "Anzeige" }),
    ]),
  });
  h.lf.markAdsNewShell();
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="ad"]')), true, "exact 'Promoted' leaf did not mark the post");
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="de"]')), true, "exact 'Anzeige' leaf did not mark the post");
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="organic"]')), false, "post without any label was marked");
  h.close();
});

test("new shell requires exact equality, not a substring like the classic shell", async () => {
  const h = await loadExtension({
    body: newShellFeed([
      `<div data-lazy-mount-id="x"><p>Promoted by Acme</p></div>`,
      `<div data-lazy-mount-id="y"><p>promoted</p></div>`,
    ]),
  });
  h.lf.markAdsNewShell();
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="x"]')), false, "'Promoted by Acme' must not match in the new shell");
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="y"]')), false, "new shell label matching is case-sensitive via the LABELS set");
  h.close();
});

test("new shell trims surrounding whitespace on the label leaf", async () => {
  const h = await loadExtension({
    body: newShellFeed([`<div data-lazy-mount-id="ws"><span>\n   Gesponsert  \n</span></div>`]),
  });
  h.lf.markAdsNewShell();
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="ws"]')), true, "whitespace around the label prevented the match");
  h.close();
});

test("new shell only considers leaf elements", async () => {
  const h = await loadExtension({
    body: newShellFeed([`<div data-lazy-mount-id="wrapped"><span><b>Promoted</b></span></div>`]),
  });
  h.lf.markAdsNewShell();
  // <b> is not in the p/span leaf set, and the <span> has a child element.
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="wrapped"]')), false, "a non-leaf span was treated as a label");
  h.close();
});

test("new shell marks the direct feed child, and ignores labels outside the feed", async () => {
  const h = await loadExtension({
    body: newShellFeed([`<div data-lazy-mount-id="nested"><section id="inner"><span>Promoted</span></section></div>`]) +
      `<div id="outside"><span>Promoted</span></div>`,
  });
  h.lf.markAdsNewShell();
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="nested"]')), true, "direct feed child was not marked for a nested label");
  assert.equal(isAd(h.document.getElementById("inner")), false, "lf-ad landed on the inner element instead of the post wrapper");
  assert.equal(isAd(h.document.getElementById("outside")), false, "element outside [data-testid=mainFeed] was marked");
  h.close();
});

test("new shell re-checks a skeleton post once it hydrates", async () => {
  const h = await loadExtension({
    body: newShellFeed([`<div data-lazy-mount-id="skel"><div class="placeholder"></div></div>`]),
  });
  const post = h.document.querySelector('[data-lazy-mount-id="skel"]');

  h.lf.markAdsNewShell();
  assert.equal(isAd(post), false, "skeleton without p/span must not be marked");

  const span = h.document.createElement("span");
  span.textContent = "Sponsored";
  post.append(span);

  h.lf.markAdsNewShell();
  assert.equal(isAd(post), true, "skeleton was memoised and never re-checked after hydration");
  h.close();
});

test("page-set data-lf-checked cannot hide a promoted post in the new shell", async () => {
  const h = await loadExtension({ body: newShellFeed([]) });
  const feed = h.document.querySelector('[data-testid="mainFeed"]');
  feed.insertAdjacentHTML(
    "beforeend",
    `<div data-lazy-mount-id="attack" data-lf-checked="attack"><span>Promoted</span></div>`,
  );
  const post = h.document.querySelector('[data-lazy-mount-id="attack"]');

  h.lf.markAdsNewShell();
  assert.equal(isAd(post), true, "a page-written data-lf-checked attribute skipped the new-shell ad scan");
  h.close();
});

test("new shell strips a page-set lf-ad from an organic post", async () => {
  const h = await loadExtension({ body: newShellFeed([]) });
  const feed = h.document.querySelector('[data-testid="mainFeed"]');
  feed.insertAdjacentHTML(
    "beforeend",
    `<div class="lf-ad" data-lazy-mount-id="victim" data-lf-checked="victim"><p>content</p></div>`,
  );
  const post = h.document.querySelector('[data-lazy-mount-id="victim"]');

  h.lf.markAdsNewShell();
  assert.equal(isAd(post), false, "page-pinned lf-ad kept an organic new-shell post hidden");
  h.close();
});

test("new shell memo keys on the mount id and re-checks on recycle", async () => {
  const h = await loadExtension({
    body: newShellFeed([newShellPost({ mountId: "m1", label: "Promoted" })]),
  });
  const post = h.document.querySelector('[data-lazy-mount-id="m1"]');
  h.lf.markAdsNewShell();
  assert.equal(isAd(post), true, "promoted post was not marked before recycling");

  post.querySelector("span").textContent = "content";
  h.lf.markAdsNewShell();
  assert.equal(isAd(post), true, "post was re-inspected although its mount id was unchanged");

  post.setAttribute("data-lazy-mount-id", "m2");
  h.lf.markAdsNewShell();
  assert.equal(isAd(post), false, "stale lf-ad survived a recycled mount container");
  h.close();
});

// ---- integration with the scan loop ----------------------------------------

test("the scan loop marks ads without an explicit call", async () => {
  const h = await loadExtension({
    body: classicPost({ id: "urn:li:activity:50", header: "Acme · Promoted" }) +
      newShellFeed([newShellPost({ mountId: "n1", label: "Anzeige" })]),
  });
  await h.flush();
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:50"]')), true, "classic ad not marked by the scheduled scan");
  assert.equal(isAd(h.document.querySelector('[data-lazy-mount-id="n1"]')), true, "new-shell ad not marked by the scheduled scan");
  h.close();
});

test("no ad marking happens while hideAds is off", async () => {
  const h = await loadExtension({
    storage: { hideAds: false },
    body: classicPost({ id: "urn:li:activity:51", header: "Acme · Promoted" }),
  });
  await h.flush();
  assert.equal(h.lf.currentState.hideAds, false, "storage stub did not deliver hideAds:false");
  assert.equal(isAd(h.document.querySelector('[data-id="urn:li:activity:51"]')), false, "ads were marked although hideAds is off");
  h.close();
});

test("turning hideAds on marks already-present ads", async () => {
  const h = await loadExtension({
    storage: { hideAds: false },
    body: classicPost({ id: "urn:li:activity:52", header: "Acme · Promoted" }),
  });
  await h.flush();
  const post = h.document.querySelector('[data-id="urn:li:activity:52"]');
  assert.equal(isAd(post), false, "precondition: post must be unmarked while hideAds is off");

  await h.storage.local.set({ hideAds: true });
  await h.flush();
  assert.equal(isAd(post), true, "enabling hideAds did not run a scan over existing posts");
  h.close();
});
