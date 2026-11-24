import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadExtension, newShellFeed } from "./harness.js";

const stylesheet = readFileSync(new URL("../extension/styles.css", import.meta.url), "utf8");

function reactPost(id, { actor, content = "", label = "" } = {}) {
  const header = actor ? `<a data-view-name="feed-actor-name" href="${actor}">Author</a>` : "";
  return `<div id="${id}" data-lazy-mount-id="${id}">
    <div>${header}${label ? `<p>${label}</p>` : ""}</div>${content}
  </div>`;
}

function emberPost(id, actor, content = "") {
  return `<article id="${id}" data-urn="urn:li:activity:${id}">
    <div class="feed-shared-update-v2">
      <div class="update-components-actor__meta">
        <a class="update-components-actor__meta-link" href="${actor}">Author</a>
      </div>
      ${content}
    </div>
  </article>`;
}

async function openFeed(t, options) {
  const h = await loadExtension(options);
  t.after(h.close);
  const style = h.document.createElement("style");
  style.textContent = stylesheet;
  h.document.head.append(style);
  return h;
}

function visible(h, id) {
  let element = h.document.getElementById(id);
  assert.ok(element, `Missing fixture #${id}`);
  for (; element; element = element.parentElement) {
    if (h.window.getComputedStyle(element).display === "none") return false;
  }
  return true;
}

test("account paths normalize LinkedIn URLs and deduplicate tracking variants", async (t) => {
  const h = await loadExtension();
  t.after(h.close);
  const { accountPath, normalizeAccounts } = h.lf;
  assert.equal(accountPath("  https://de.linkedin.com/in/Jane-Doe/?trk=profile#top  "), "/in/jane-doe");
  assert.equal(accountPath("linkedin.com/company/Example-Inc/"), "/company/example-inc");
  assert.equal(accountPath("/IN/Jos%C3%A9"), "/in/jos%C3%A9");
  assert.deepEqual(Array.from(normalizeAccounts([
    "/in/jane",
    "https://www.linkedin.com/in/JANE/",
    "/company/jane",
    7,
    "https://example.com/in/jane",
  ])), ["/in/jane", "/company/jane"]);
  assert.deepEqual(Array.from(normalizeAccounts("/in/jane")), []);
});

test("account paths reject non-account URLs, invalid slugs and unrelated hosts", async (t) => {
  const h = await loadExtension();
  t.after(h.close);
  for (const value of [
    null, "", "Jane Doe", "in/jane", "https://linkedin.com.evil.test/in/jane",
    "https://notlinkedin.com/company/jane", "https://user@linkedin.com/in/jane",
    "https://linkedin.com:8080/in/jane", "javascript:alert(1)", "/feed/update/1",
    "/in/jane/details/skills", "/company/", "/in/jane%2Fjohn", "/in/%",
  ]) {
    assert.equal(h.lf.accountPath(value), null, String(value));
  }
});

test("React feed reveals only posts by the exact allowed person or company", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/in/jane", "/company/space"] },
    body: newShellFeed([
      reactPost("person", { actor: "https://de.linkedin.com/in/Jane/?trk=feed" }),
      reactPost("company", { actor: "/company/space/" }),
      reactPost("similar", { actor: "/in/jane-doe" }),
      reactPost("wrongType", { actor: "/in/space" }),
      reactPost("mention", { actor: "/in/other", content: '<p><a href="/in/jane">Jane</a></p>' }),
      reactPost("repost", {
        actor: "/in/other",
        content: '<blockquote><a data-view-name="feed-actor-name" href="/in/jane">Jane</a></blockquote>',
      }),
      reactPost("quoteOnly", {
        content: '<blockquote><a data-view-name="feed-actor-name" href="/in/jane">Jane</a></blockquote>',
      }),
      reactPost("empty"),
    ]),
  });

  for (const id of ["person", "company"]) assert.equal(visible(h, id), true, id);
  for (const id of ["similar", "wrongType", "mention", "repost", "quoteOnly", "empty"]) {
    assert.equal(visible(h, id), false, id);
  }
});

test("classic feed keeps allowed posts and their nested content while hiding other authors", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/company/space"] },
    body: `<main class="scaffold-layout__main">
      ${emberPost("allowed", "/company/space", '<div id="quote" class="feed-shared-update-v2">Quoted content</div>')}
      ${emberPost("blocked", "/company/space-x", '<div class="post-body"><a href="/company/space">Mention</a></div>')}
    </main>`,
  });

  assert.equal(visible(h, "allowed"), true);
  assert.equal(visible(h, "quote"), true);
  assert.equal(visible(h, "blocked"), false);
});

test("React update cards match the avatar in the primary author header", async (t) => {
  const avatar = (path) => `<a href="${path}" aria-haspopup="dialog"><figure></figure></a>`;
  const post = (id, author, { activity = "", comment = "" } = {}) => reactPost(id, {
    content: `<div role="listitem" componentkey="update-card-focus-${id}">
      <div>
        <h2>Feed post</h2>
        ${activity ? `<div>${avatar(activity)} liked this</div><hr role="presentation">` : ""}
        <div>${avatar(author)}</div>
        <p>Post body</p>
      </div>
      <div>${comment ? avatar(comment) : ""}</div>
    </div>`,
  });
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/in/jane", "/company/space"] },
    body: newShellFeed([
      post("person", "/in/jane"),
      post("company", "/company/space", { activity: "/in/other" }),
      post("like", "/in/other", { activity: "/company/space" }),
      post("comment", "/in/other", { comment: "/in/jane" }),
    ]),
  });
  assert.equal(visible(h, "person"), true);
  assert.equal(visible(h, "company"), true);
  assert.equal(visible(h, "like"), false);
  assert.equal(visible(h, "comment"), false);
});

test("ads from allowed accounts still follow the independent Ads setting", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/company/space"] },
    body: newShellFeed([reactPost("ad", { actor: "/company/space", label: "Promoted" })]),
  });

  assert.equal(visible(h, "ad"), false);
  await h.storage.local.set({ hideAds: false });
  await h.flush();
  assert.equal(visible(h, "ad"), true);
  await h.storage.local.set({ hideAds: true });
  await h.flush();
  assert.equal(visible(h, "ad"), false);
});

test("account edits and feed switches take effect on the open page", async (t) => {
  const h = await openFeed(t, {
    body: newShellFeed([
      reactPost("one", { actor: "/in/jane" }),
      reactPost("two", { actor: "/company/space" }),
    ]),
  });

  assert.equal(visible(h, "one"), false);
  await h.storage.local.set({ allowedAccounts: ["/in/jane"] });
  await h.flush();
  assert.equal(visible(h, "one"), true);
  assert.equal(visible(h, "two"), false);

  await h.storage.local.set({ allowedAccounts: ["/company/space"] });
  await h.flush();
  assert.equal(visible(h, "one"), false);
  assert.equal(visible(h, "two"), true);

  await h.storage.local.set({ hideFeed: false });
  await h.flush();
  assert.equal(visible(h, "one"), true);
  assert.equal(visible(h, "two"), true);

  await h.storage.local.set({ hideFeed: true });
  await h.storage.local.remove("allowedAccounts");
  await h.flush();
  assert.equal(visible(h, "one"), false);
  assert.equal(visible(h, "two"), false);
  assert.equal(h.htmlClasses().has("lf-filter-feed"), false);
});

test("late author hydration and reused cards are filtered again", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/in/jane"] },
    body: newShellFeed([reactPost("reused")]),
  });

  const post = h.document.getElementById("reused");
  assert.equal(visible(h, "reused"), false);
  post.firstElementChild.innerHTML = '<a data-view-name="feed-actor-name" href="/in/jane">Jane</a>';
  await h.flush();
  assert.equal(visible(h, "reused"), true);

  post.querySelector("a").setAttribute("href", "/in/other");
  await h.flush();
  assert.equal(visible(h, "reused"), false);

  post.parentElement.insertAdjacentHTML("beforeend", reactPost("later", { actor: "/in/jane" }));
  await h.flush();
  assert.equal(visible(h, "later"), true);
});

test("a stale initial storage read cannot overwrite a live allow-list update", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/in/jane"] },
    autoResolveGet: false,
    body: newShellFeed([
      reactPost("one", { actor: "/in/jane" }),
      reactPost("two", { actor: "/company/space" }),
    ]),
  });

  await h.storage.local.set({ allowedAccounts: ["/company/space"] });
  h.resolveInitialGet();
  await h.flush();

  assert.equal(visible(h, "one"), false);
  assert.equal(visible(h, "two"), true);
});

test("classic profile activity stays visible outside the feed route", async (t) => {
  const h = await openFeed(t, {
    url: "https://www.linkedin.com/in/jane/",
    storage: { allowedAccounts: ["/in/jane"] },
    body: `<main class="scaffold-layout__main">${emberPost("activity", "/in/other")}</main>`,
  });

  assert.equal(visible(h, "activity"), true);
  assert.equal(h.htmlClasses().has("lf-filter-feed"), false);
});

test("the full React feed hides only posts with an exact blocked primary author", async (t) => {
  const h = await openFeed(t, {
    storage: { hideFeed: false, blockedAccounts: ["https://de.linkedin.com/in/Jane/?trk=feed", "/company/example"] },
    body: newShellFeed([
      reactPost("person", { actor: "/in/jane" }),
      reactPost("company", { actor: "/company/example/" }),
      reactPost("similar", { actor: "/in/jane-doe" }),
      reactPost("sameSlug", { actor: "/in/example" }),
      reactPost("mention", { actor: "/in/other", content: '<p><a href="/in/jane">Jane</a></p>' }),
      reactPost("quote", {
        actor: "/in/other",
        content: '<blockquote><a data-view-name="feed-actor-name" href="/in/jane">Jane</a></blockquote>',
      }),
      reactPost("unknown"),
    ]),
  });

  for (const id of ["person", "company"]) assert.equal(visible(h, id), false, id);
  for (const id of ["similar", "sameSlug", "mention", "quote", "unknown"]) {
    assert.equal(visible(h, id), true, id);
  }
});

test("blocking overrides an allowed account until it is removed from the block list", async (t) => {
  const h = await openFeed(t, {
    storage: { allowedAccounts: ["/in/jane"], blockedAccounts: ["/in/jane"] },
    body: newShellFeed([
      reactPost("jane", { actor: "/in/jane" }),
      reactPost("other", { actor: "/in/other" }),
    ]),
  });
  assert.equal(visible(h, "jane"), false);
  assert.equal(visible(h, "other"), false);

  await h.storage.local.set({ hideFeed: false });
  assert.equal(visible(h, "jane"), false);
  assert.equal(visible(h, "other"), true);

  await h.storage.local.set({ hideFeed: true });
  await h.storage.local.remove("blockedAccounts");
  assert.equal(visible(h, "jane"), true);
  assert.equal(visible(h, "other"), false);
});

test("classic blocking hides the outer post and stops applying when navigating to a profile", async (t) => {
  const h = await openFeed(t, {
    storage: { hideFeed: false, blockedAccounts: ["/company/example"] },
    body: `<main class="scaffold-layout__main">
      ${emberPost("blocked", "/company/example", '<div id="nested" class="feed-shared-update-v2">Nested content</div>')}
      ${emberPost("visible", "/company/example-partner")}
    </main>`,
  });
  assert.equal(visible(h, "blocked"), false);
  assert.equal(visible(h, "nested"), false);
  assert.equal(visible(h, "visible"), true);

  h.window.history.pushState({}, "", "/company/example/");
  h.window.dispatchEvent(new h.window.PopStateEvent("popstate"));
  await h.flush();
  assert.equal(visible(h, "blocked"), true);
});

test("blocked posts are reevaluated when an author appears or a card is reused", async (t) => {
  const h = await openFeed(t, {
    storage: { hideFeed: false, blockedAccounts: ["/in/jane"] },
    body: newShellFeed([reactPost("reused")]),
  });
  const post = h.document.getElementById("reused");
  assert.equal(visible(h, "reused"), true);

  post.firstElementChild.innerHTML = '<a data-view-name="feed-actor-name" href="/in/jane">Jane</a>';
  await h.flush();
  assert.equal(visible(h, "reused"), false);

  post.querySelector("a").setAttribute("href", "/in/other");
  post.parentElement.insertAdjacentHTML("beforeend", reactPost("later", { actor: "/in/jane" }));
  await h.flush();
  assert.equal(visible(h, "reused"), true);
  assert.equal(visible(h, "later"), false);
});

test("a stale initial read cannot overwrite a live block-list update", async (t) => {
  const h = await openFeed(t, {
    storage: { hideFeed: false, blockedAccounts: ["/in/jane"] },
    autoResolveGet: false,
    body: newShellFeed([
      reactPost("jane", { actor: "/in/jane" }),
      reactPost("other", { actor: "/in/other" }),
    ]),
  });
  await h.storage.local.set({ blockedAccounts: ["/in/other"] });
  h.resolveInitialGet();
  await h.flush();
  assert.equal(visible(h, "jane"), true);
  assert.equal(visible(h, "other"), false);
});
