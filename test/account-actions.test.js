import test from "node:test";
import assert from "node:assert/strict";
import { connectBackground, loadExtension, newShellFeed } from "./harness.js";

function change(path, allowed = true) {
  return { type: "changeAllowedAccount", path, allowed };
}

function background(initial) {
  let accounts = initial;
  let shouldFail = false;
  const writes = [];
  const send = connectBackground({
    local: {
      async get() {
        return { allowedAccounts: [...accounts] };
      },
      async set(update) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("storage unavailable");
        }
        accounts = [...update.allowedAccounts];
        writes.push(accounts);
      },
    },
  });
  return { send, writes, failNextWrite: () => { shouldFail = true; } };
}

test("overlapping adds and removes preserve unrelated existing accounts", async () => {
  const h = background(["/in/keep", "/company/remove-me"]);
  const results = await Promise.all([
    h.send(change("/in/new-author")),
    h.send(change("/company/remove-me", false)),
    h.send(change("https://de.linkedin.com/company/Example/?trk=feed")),
  ]);

  assert.deepEqual(results.at(-1), ["/in/keep", "/in/new-author", "/company/example"]);
  assert.equal(h.writes.length, 3);
});

test("invalid mutations are rejected and repeated verified adds are idempotent", async () => {
  const h = background(["/in/example"]);
  assert.equal(await h.send(change("https://example.test/in/other")), null);
  assert.equal(await h.send(change("/in/example", "false")), null);
  assert.deepEqual(await h.send(change("/in/EXAMPLE/")), ["/in/example"]);
  assert.deepEqual(await h.send(change("/company/missing", false)), ["/in/example"]);
  assert.deepEqual(h.writes, []);
});

test("a failed write leaves the old list intact and the next request can retry", async () => {
  const h = background(["/company/existing"]);
  h.failNextWrite();
  const [failed, next] = await Promise.all([
    h.send(change("/company/existing", false)),
    h.send(change("/in/new")),
  ]);
  assert.equal(failed, null);
  assert.deepEqual(next, ["/company/existing", "/in/new"]);
  assert.deepEqual(await h.send(change("/company/existing", false)), ["/in/new"]);
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

test("one action is attached to the primary author and script-generated clicks are ignored", async (t) => {
  const h = await feed();
  t.after(h.close);
  const buttons = h.document.querySelectorAll(".lf-post-account");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].previousElementSibling.id, "author-header");
  assert.equal(buttons[0].getAttribute("aria-label"), "Allow this account: /in/alex");
  buttons[0].click();
  await h.flush();
  assert.equal(h.storageData.allowedAccounts, undefined);
});

test("a trusted feed action persists the primary author and reflects later removal", async (t) => {
  const h = await feed();
  t.after(h.close);
  const post = h.document.getElementById("post");
  const action = h.lf.postActions.get(post);
  const click = { isTrusted: true, stopPropagation() {} };

  await h.lf.allowPostAccount(click, action, post, h.lf.findReactActor);
  assert.deepEqual(Array.from(h.storageData.allowedAccounts), ["/in/alex"]);
  assert.equal(action.button.textContent, "Account allowed");
  assert.equal(action.button.disabled, true);

  await h.storage.local.remove("allowedAccounts");
  await h.flush();
  assert.equal(action.button.textContent, "Allow this account");
  assert.equal(action.button.disabled, false);
});

test("recycled cards reject stale clicks and rebind a single action to the new author", async (t) => {
  const h = await feed();
  t.after(h.close);
  const post = h.document.getElementById("post");
  const oldAction = h.lf.postActions.get(post);
  h.document.getElementById("author").setAttribute("href", "/company/new-author");

  await h.lf.allowPostAccount({ isTrusted: true }, oldAction, post, h.lf.findReactActor);
  assert.equal(h.storageData.allowedAccounts, undefined);

  await h.flush();
  assert.equal(oldAction.button.isConnected, false);
  assert.equal(post.querySelectorAll(".lf-post-account").length, 1);
  assert.equal(post.querySelector(".lf-post-account").getAttribute("aria-label"), "Allow this account: /company/new-author");
});

test("classic feed shows a single action even when two wrappers identify the same post", async (t) => {
  const h = await loadExtension({
    storage: { hideFeed: false },
    body: `<main class="scaffold-layout__main"><article data-id="urn:li:activity:1">
      <div class="feed-shared-update-v2"><div class="update-components-actor">
        <a class="update-components-actor__meta-link" href="/company/example">Example</a>
      </div></div>
    </article></main>`,
  });
  t.after(h.close);

  const buttons = h.document.querySelectorAll(".lf-post-account");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute("aria-label"), "Allow this account: /company/example");
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
