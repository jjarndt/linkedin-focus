import test from "node:test";
import assert from "node:assert/strict";
import { connectBackground, loadExtension, newShellFeed } from "./harness.js";

function change(path, include = true, list = "allowedAccounts") {
  return { type: "changeAccountList", list, path, include };
}

function background(initial = {}) {
  const accounts = { ...initial };
  let shouldFail = false;
  const writes = [];
  const send = connectBackground({
    local: {
      async get(defaults) {
        return { ...defaults, ...accounts };
      },
      async set(update) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("storage unavailable");
        }
        const saved = structuredClone(update);
        Object.assign(accounts, saved);
        writes.push(saved);
      },
    },
  });
  return { send, writes, failNextWrite: () => { shouldFail = true; } };
}

test("overlapping adds and removes preserve unrelated existing accounts", async () => {
  const h = background({ allowedAccounts: ["/in/keep", "/company/remove-me"] });
  const results = await Promise.all([
    h.send(change("/in/new-author")),
    h.send(change("/company/remove-me", false)),
    h.send(change("https://de.linkedin.com/company/Example/?trk=feed")),
  ]);

  assert.deepEqual(results.at(-1), ["/in/keep", "/in/new-author", "/company/example"]);
  assert.equal(h.writes.length, 3);
});

test("invalid mutations are rejected and repeated verified adds are idempotent", async () => {
  const h = background({ allowedAccounts: ["/in/example"] });
  assert.equal(await h.send(change("https://example.test/in/other")), null);
  assert.equal(await h.send(change("/in/example", "false")), null);
  assert.equal(await h.send(change("/in/example", true, "hideFeed")), null);
  assert.equal(await h.send(change("/in/example", true, "__proto__")), null);
  assert.deepEqual(await h.send(change("/in/EXAMPLE/")), ["/in/example"]);
  assert.deepEqual(await h.send(change("/company/missing", false)), ["/in/example"]);
  assert.deepEqual(h.writes, []);
});

test("a failed write leaves the old list intact and the next request can retry", async () => {
  const h = background({ allowedAccounts: ["/company/existing"] });
  h.failNextWrite();
  const [failed, next] = await Promise.all([
    h.send(change("/company/existing", false)),
    h.send(change("/in/new")),
  ]);
  assert.equal(failed, null);
  assert.deepEqual(next, ["/company/existing", "/in/new"]);
  assert.deepEqual(await h.send(change("/company/existing", false)), ["/in/new"]);
});

test("overlapping mutations preserve both lists and write only the list being edited", async () => {
  const h = background({ allowedAccounts: ["/in/keep"], blockedAccounts: ["/in/unblock"] });
  const [allowed, firstBlocked, secondBlocked, remaining] = await Promise.all([
    h.send(change("/in/both")),
    h.send(change("/in/both", true, "blockedAccounts")),
    h.send(change("https://de.linkedin.com/company/EXAMPLE/?trk=feed", true, "blockedAccounts")),
    h.send(change("/in/unblock", false, "blockedAccounts")),
  ]);

  assert.deepEqual(allowed, ["/in/keep", "/in/both"]);
  assert.deepEqual(firstBlocked, ["/in/unblock", "/in/both"]);
  assert.deepEqual(secondBlocked, ["/in/unblock", "/in/both", "/company/example"]);
  assert.deepEqual(remaining, ["/in/both", "/company/example"]);
  assert.deepEqual(h.writes.map(Object.keys), [
    ["allowedAccounts"], ["blockedAccounts"], ["blockedAccounts"], ["blockedAccounts"],
  ]);
});

test("the page account follows the current SPA route and reports only account pages", async (t) => {
  const h = await loadExtension({ url: "https://de.linkedin.com/in/Alex/details/experience/" });
  t.after(h.close);
  assert.equal(h.emitMessage("getPageAccount"), "/in/alex");

  h.window.history.pushState({}, "", "/company/Example/posts/?trk=nav");
  assert.equal(h.emitMessage("getPageAccount"), "/company/example");

  h.window.history.pushState({}, "", "/feed/update/urn:li:activity:1");
  assert.equal(h.emitMessage("getPageAccount"), null);
});

const reactPost = `<div id="post" data-lazy-mount-id="post">
  <div role="listitem" componentkey="update-card-focus-fixture">
    <h2>Feed post</h2>
    <div><a id="activity" aria-haspopup="dialog" href="/company/context"><figure></figure></a></div>
    <hr role="presentation">
    <div id="author-header"><a id="author" aria-haspopup="dialog" href="/in/alex"><figure></figure></a></div>
    <p>Post with <a href="/company/mention">a mention</a></p>
  </div>
</div>`;

function feed() {
  return loadExtension({ body: newShellFeed([reactPost]), storage: { hideFeed: false } });
}

test("both actions are attached to the primary author and script-generated clicks are ignored", async (t) => {
  const h = await feed();
  t.after(h.close);
  const group = h.document.querySelector(".lf-post-account-actions");
  assert.equal(group.previousElementSibling.id, "author-header");
  assert.deepEqual(
    [...group.children].map((button) => button.getAttribute("aria-label")),
    ["Allow this account: /in/alex", "Block this account: /in/alex"],
  );
  for (const button of group.children) button.click();
  await h.flush();
  assert.equal(h.storageData.allowedAccounts, undefined);
  assert.equal(h.storageData.blockedAccounts, undefined);
});

test("a trusted feed action persists the primary author and reflects later removal", async (t) => {
  const h = await feed();
  t.after(h.close);
  const post = h.document.getElementById("post");
  const actions = h.lf.postActions.get(post);
  const button = actions.buttons.allowedAccounts;
  const click = { isTrusted: true, stopPropagation() {} };

  await h.lf.addPostAccount(click, "allowedAccounts", actions, post, h.lf.findReactActor);
  assert.deepEqual(Array.from(h.storageData.allowedAccounts), ["/in/alex"]);
  assert.equal(button.textContent, "Account allowed");
  assert.equal(button.disabled, true);

  await h.storage.local.remove("allowedAccounts");
  await h.flush();
  assert.equal(button.textContent, "Allow this account");
  assert.equal(button.disabled, false);
});

test("a trusted block action persists the author and immediately marks the post hidden", async (t) => {
  const h = await feed();
  t.after(h.close);
  const post = h.document.getElementById("post");
  const actions = h.lf.postActions.get(post);
  const click = { isTrusted: true, stopPropagation() {} };

  await h.lf.addPostAccount(click, "blockedAccounts", actions, post, h.lf.findReactActor);
  assert.deepEqual(Array.from(h.storageData.blockedAccounts), ["/in/alex"]);
  assert.equal(h.storageData.allowedAccounts, undefined);
  assert.equal(post.classList.contains("lf-blocked-post"), true);
  assert.equal(actions.buttons.blockedAccounts.disabled, true);
});

test("recycled cards reject stale clicks and rebind the actions to the new author", async (t) => {
  const h = await feed();
  t.after(h.close);
  const post = h.document.getElementById("post");
  const oldActions = h.lf.postActions.get(post);
  h.document.getElementById("author").setAttribute("href", "/company/new-author");

  await h.lf.addPostAccount({ isTrusted: true }, "allowedAccounts", oldActions, post, h.lf.findReactActor);
  await h.lf.addPostAccount({ isTrusted: true }, "blockedAccounts", oldActions, post, h.lf.findReactActor);
  assert.equal(h.storageData.allowedAccounts, undefined);
  assert.equal(h.storageData.blockedAccounts, undefined);

  await h.flush();
  assert.equal(oldActions.container.isConnected, false);
  assert.equal(post.querySelectorAll(".lf-post-account-actions").length, 1);
  assert.ok(post.querySelector('[aria-label="Block this account: /company/new-author"]'));
});

test("classic feed shows one action group even when two wrappers identify the same post", async (t) => {
  const h = await loadExtension({
    storage: { hideFeed: false },
    body: `<main class="scaffold-layout__main"><article data-id="urn:li:activity:1">
      <div class="feed-shared-update-v2"><div class="update-components-actor">
        <a class="update-components-actor__meta-link" href="/company/example">Example</a>
      </div></div>
    </article></main>`,
  });
  t.after(h.close);

  assert.equal(h.document.querySelectorAll(".lf-post-account-actions").length, 1);
  assert.ok(h.document.querySelector('[aria-label="Allow this account: /company/example"]'));
  assert.ok(h.document.querySelector('[aria-label="Block this account: /company/example"]'));
});

test("the injected action is absent while initially hiding the feed", async (t) => {
  const h = await loadExtension({
    body: newShellFeed([reactPost]),
    storage: { allowedAccounts: ["/in/alex"] },
  });
  t.after(h.close);
  assert.equal(h.document.querySelector(".lf-post-account"), null);
  assert.ok(h.document.getElementById("post").classList.contains("lf-allowed-post"));
});
