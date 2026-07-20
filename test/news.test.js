// Right-rail module detection (markNews and its three helpers).
//
// markNews was extracted into findMarkedModules / collapseToSharedCard /
// outermostSingleChildWrapper without any test covering it. The dangerous
// failure mode is over-reach: closest() and the LCA climb are both unbounded
// by nature, so a marker can escape the <aside> and land lf-news on a
// page-level wrapper — the user then sees half the page vanish with no
// explanation. Every boundary here is asserted explicitly.
//
// Fixtures load with autoResolveGet:false so the initial storage read never
// resolves and scheduleScan never fires. The DOM is therefore pristine and
// each test drives markNews/the helpers itself.

import test from "node:test";
import assert from "node:assert/strict";
import { loadExtension } from "./harness.js";

/** Load a fixture without letting the scan loop run. */
function fixture(body) {
  return loadExtension({ body, autoResolveGet: false });
}

const NEWS_LOG = "right-rail module marked:";

/** Debug logging is off unless opted in; markNews only logs via log(). */
function enableLogging(h) {
  h.window.__lfDebug = true;
}

function newsLogs(h) {
  return h.logs.filter((line) => line.includes(NEWS_LOG));
}

function marked(h) {
  return [...h.document.querySelectorAll(".lf-news")].map((el) => el.id);
}

// findMarkedModules builds its array inside the jsdom realm, so its prototype
// is not Node's Array.prototype and deepStrictEqual would reject it on that
// alone. Copy into the test realm before comparing structurally.
function ids(mods) {
  return Array.from(mods, ({ mod }) => mod.id);
}

function markers(mods) {
  return Array.from(mods, ({ marker }) => marker);
}

// ---- findMarkedModules: target selection -----------------------------------

test("findMarkedModules targets the enclosing componentkey module", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="card" componentkey="news-module">
        <div class="header"><h2>LinkedIn News</h2></div>
      </div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News"]);

  assert.equal(mods.length, 1, "the single marker should produce exactly one module");
  assert.equal(mods[0].mod, h.document.getElementById("card"), "target should be the componentkey ancestor, not the <h2>");
  assert.equal(mods[0].marker, "LinkedIn News", "the matched marker should be reported back");
  h.close();
});

test("findMarkedModules falls back to the grandparent when there is no componentkey", async () => {
  // Games box: the header <p> sits directly in the module container, which
  // carries no componentkey of its own.
  const h = await fixture(`
    <aside id="rail">
      <div id="games"><div id="head"><p>Spiel des Tages</p></div></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["Spiel des Tages"]);

  assert.equal(mods.length, 1, "the games marker should produce one module");
  assert.equal(mods[0].mod, h.document.getElementById("head"), "without componentkey the target is the text node's grandparent");
  h.close();
});

test("findMarkedModules matches the English games marker too", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="games"><div id="head"><p>Today's games</p></div></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["Today's games"]);

  assert.equal(mods.length, 1, "\"Today's games\" should be recognised as a marker");
  assert.equal(mods[0].mod, h.document.getElementById("head"), "English games box should resolve like the German one");
  h.close();
});

// ---- findMarkedModules: the aside boundary ---------------------------------

test("findMarkedModules never escapes the aside via closest()", async () => {
  // The only [componentkey] in the tree sits ABOVE the aside. Marking it would
  // hide the entire page column.
  const h = await fixture(`
    <div id="page" componentkey="page-wrapper">
      <aside id="rail">
        <div id="mod"><p>LinkedIn News</p></div>
      </aside>
    </div>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News"]);

  assert.equal(mods.length, 1, "the marker should still be found inside the aside");
  assert.equal(mods[0].mod, h.document.getElementById("mod"), "a componentkey above the aside must be discarded in favour of the in-aside fallback");
  h.close();
});

test("markNews leaves a componentkey wrapper above the aside unmarked", async () => {
  const h = await fixture(`
    <div id="page" componentkey="page-wrapper">
      <aside id="rail">
        <div id="mod"><p>LinkedIn News</p></div>
      </aside>
    </div>
  `);
  h.lf.markNews();

  assert.equal(h.document.getElementById("page").classList.contains("lf-news"), false, "lf-news on the page wrapper would hide far more than the news card");
  assert.deepEqual(marked(h), ["mod"], "only the in-aside module should carry lf-news");
  h.close();
});

test("findMarkedModules discards a componentkey on the aside itself", async () => {
  const h = await fixture(`
    <aside id="rail" componentkey="right-rail"><p>LinkedIn News</p></aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News"]);

  // closest() hits the aside, the fallback (<p>.parentElement) is the aside
  // again — both rejected, so nothing is marked at all.
  assert.equal(mods.length, 0, "the aside itself must never become a module target");
  h.close();
});

test("markNews never marks the aside itself", async () => {
  const h = await fixture(`
    <aside id="rail" componentkey="right-rail"><p>LinkedIn News</p></aside>
  `);
  h.lf.markNews();

  assert.equal(h.document.getElementById("rail").classList.contains("lf-news"), false, "hiding the whole aside is over-reach, not module detection");
  assert.equal(marked(h).length, 0, "no element should be marked when the only candidate is the aside");
  h.close();
});

test("markNews ignores a marker sitting as a direct text child of the aside", async () => {
  // Fallback would be aside.parentElement (<body>) — must not be marked.
  const h = await fixture(`<aside id="rail">LinkedIn News</aside>`);
  h.lf.markNews();

  assert.equal(h.document.body.classList.contains("lf-news"), false, "lf-news must never reach <body>");
  assert.equal(marked(h).length, 0, "a bare text child of the aside yields no valid module");
  h.close();
});

// ---- findMarkedModules: pending consumption --------------------------------

test("findMarkedModules consumes each marker at most once", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="first" componentkey="a"><p>LinkedIn News</p></div>
      <div id="second" componentkey="b"><p>LinkedIn News heute</p></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News"]);

  assert.equal(mods.length, 1, "one pending marker must not match twice");
  assert.equal(mods[0].mod, h.document.getElementById("first"), "the first occurrence in document order wins");
  h.close();
});

test("findMarkedModules empties the pending array it is handed", async () => {
  const h = await fixture(`
    <aside id="rail"><div componentkey="a"><p>LinkedIn News</p></div></aside>
  `);
  const aside = h.document.getElementById("rail");
  const pending = ["LinkedIn News"];
  h.lf.findMarkedModules(aside, pending);

  assert.deepEqual(pending, [], "the matched marker must be spliced out of pending");
  h.close();
});

test("markNews does not mutate the shared NEWS_MARKERS array", async () => {
  // findMarkedModules splices its argument; markNews must hand it a copy.
  const h = await fixture(`
    <aside id="rail"><div componentkey="a"><p>LinkedIn News</p></div></aside>
  `);
  const before = [...h.lf.NEWS_MARKERS];
  h.lf.markNews();
  h.lf.markNews();

  assert.deepEqual([...h.lf.NEWS_MARKERS], before, "NEWS_MARKERS is module state and must survive a scan intact");
  h.close();
});

test("findMarkedModules resolves two different markers independently", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="news" componentkey="news"><p>LinkedIn News</p></div>
      <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News", "Spiel des Tages"]);

  assert.deepEqual(
    ids(mods),
    ["news", "games"],
    "both markers should resolve to their own module",
  );
  assert.deepEqual(markers(mods), ["LinkedIn News", "Spiel des Tages"], "each module should report the marker that found it");
  h.close();
});

// ---- collapseToSharedCard --------------------------------------------------

test("collapseToSharedCard replaces two modules with their common ancestor", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="card">
        <div id="news" componentkey="news"><p>LinkedIn News</p></div>
        <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
      </div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News", "Spiel des Tages"]);
  const collapsed = h.lf.collapseToSharedCard(mods, aside);

  assert.equal(collapsed.length, 1, "the shared card should replace both modules");
  assert.equal(collapsed[0].mod, h.document.getElementById("card"), "the LCA of both modules is the shared card");
  assert.equal(collapsed[0].marker, "news+games card", "the collapsed entry should be labelled as the shared card");
  h.close();
});

test("markNews hides the shared card instead of leaving an empty shell", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="card">
        <div id="news" componentkey="news"><p>LinkedIn News</p></div>
        <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
      </div>
    </aside>
  `);
  h.lf.markNews();

  assert.deepEqual(marked(h), ["card"], "only the shared card should be marked, not the two inner modules");
  h.close();
});

test("collapseToSharedCard refuses to collapse when the LCA is the aside", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="news" componentkey="news"><p>LinkedIn News</p></div>
      <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News", "Spiel des Tages"]);
  const collapsed = h.lf.collapseToSharedCard(mods, aside);

  assert.equal(collapsed, mods, "when the LCA is the aside the original list must be returned unchanged");
  assert.deepEqual(ids(collapsed), ["news", "games"], "both modules stay separate targets");
  h.close();
});

test("markNews marks both modules rather than the aside when they share no inner card", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="news" componentkey="news"><p>LinkedIn News</p></div>
      <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
    </aside>
  `);
  h.lf.markNews();

  assert.equal(h.document.getElementById("rail").classList.contains("lf-news"), false, "collapsing onto the aside would hide the whole right rail");
  assert.deepEqual(marked(h), ["news", "games"], "each module is marked on its own");
  h.close();
});

test("collapseToSharedCard refuses to collapse when the LCA contains an iframe", async () => {
  // The iframe is unrelated content (ad slot); collapsing would hide it too.
  const h = await fixture(`
    <aside id="rail">
      <div id="card">
        <div id="news" componentkey="news"><p>LinkedIn News</p></div>
        <iframe id="adframe" title="ad"></iframe>
        <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
      </div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News", "Spiel des Tages"]);
  const collapsed = h.lf.collapseToSharedCard(mods, aside);

  assert.equal(collapsed, mods, "an iframe inside the LCA must block the collapse");
  assert.deepEqual(ids(collapsed), ["news", "games"], "both modules stay separate targets");
  h.close();
});

test("markNews leaves an iframe-bearing card visible", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="card">
        <div id="news" componentkey="news"><p>LinkedIn News</p></div>
        <iframe id="adframe" title="ad"></iframe>
        <div id="games" componentkey="games"><p>Spiel des Tages</p></div>
      </div>
    </aside>
  `);
  h.lf.markNews();

  assert.equal(h.document.getElementById("card").classList.contains("lf-news"), false, "hiding the card would take the iframe with it");
  assert.deepEqual(marked(h), ["news", "games"], "only the two modules are marked");
  h.close();
});

test("collapseToSharedCard leaves a single module untouched", async () => {
  const h = await fixture(`
    <aside id="rail"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>
  `);
  const aside = h.document.getElementById("rail");
  const mods = h.lf.findMarkedModules(aside, ["LinkedIn News"]);
  const collapsed = h.lf.collapseToSharedCard(mods, aside);

  assert.equal(collapsed, mods, "a one-element list must be returned as-is, no ancestor climb");
  assert.equal(collapsed[0].mod, h.document.getElementById("news"), "the single module stays the target");
  h.close();
});

test("collapseToSharedCard leaves an empty module list untouched", async () => {
  const h = await fixture(`<aside id="rail"><p>nothing</p></aside>`);
  const aside = h.document.getElementById("rail");
  const collapsed = h.lf.collapseToSharedCard([], aside);

  assert.deepEqual(collapsed, [], "no modules means nothing to collapse");
  h.close();
});

// ---- outermostSingleChildWrapper -------------------------------------------

test("outermostSingleChildWrapper climbs several single-child wrappers", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="outer"><div id="mid"><div id="inner"><p>LinkedIn News</p></div></div></div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const target = h.lf.outermostSingleChildWrapper(h.document.getElementById("inner"), aside);

  assert.equal(target, h.document.getElementById("outer"), "every padded single-child shell above the module must be climbed");
  h.close();
});

test("outermostSingleChildWrapper stops below a parent with two children", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="outer">
        <div id="mid"><div id="inner"><p>LinkedIn News</p></div></div>
        <div id="sibling">unrelated module</div>
      </div>
    </aside>
  `);
  const aside = h.document.getElementById("rail");
  const target = h.lf.outermostSingleChildWrapper(h.document.getElementById("inner"), aside);

  assert.equal(target, h.document.getElementById("mid"), "climbing past a parent with a sibling would hide that sibling too");
  h.close();
});

test("outermostSingleChildWrapper stops at the aside", async () => {
  const h = await fixture(`
    <aside id="rail"><div id="only"><p>LinkedIn News</p></div></aside>
  `);
  const aside = h.document.getElementById("rail");
  const target = h.lf.outermostSingleChildWrapper(h.document.getElementById("only"), aside);

  assert.equal(target, h.document.getElementById("only"), "the aside is the hard ceiling even when it has a single child");
  h.close();
});

test("markNews marks the outermost wrapper, not the componentkey module", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="wrap"><div id="news" componentkey="news"><p>LinkedIn News</p></div></div>
    </aside>
  `);
  h.lf.markNews();

  assert.deepEqual(marked(h), ["wrap"], "the padded wrapper must be marked or an empty shell stays visible");
  h.close();
});

// ---- markNews: whole-function behaviour ------------------------------------

test("markNews is idempotent across repeated scans", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="card">
        <div componentkey="news"><p>LinkedIn News</p></div>
        <div componentkey="games"><p>Spiel des Tages</p></div>
      </div>
    </aside>
  `);
  enableLogging(h);
  h.lf.markNews();
  h.lf.markNews();

  const card = h.document.getElementById("card");
  assert.deepEqual([...card.classList], ["lf-news"], "the class must be present exactly once after two scans");
  assert.equal(marked(h).length, 1, "a second scan must not mark additional elements");
  assert.equal(newsLogs(h).length, 1, "an already-marked module must not be logged again");
  h.close();
});

test("markNews logs the marker that matched", async () => {
  const h = await fixture(`
    <aside id="rail"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>
  `);
  enableLogging(h);
  h.lf.markNews();

  assert.deepEqual(newsLogs(h), ["[LinkedIn Focus] right-rail module marked: LinkedIn News"], "the log should name the marker responsible");
  h.close();
});

test("markNews leaves an aside without markers completely untouched", async () => {
  const h = await fixture(`
    <aside id="rail">
      <div id="jobs" componentkey="jobs"><p>Jobs, die zu dir passen</p></div>
    </aside>
  `);
  enableLogging(h);
  const before = h.document.getElementById("rail").outerHTML;
  h.lf.markNews();

  assert.equal(h.document.getElementById("rail").outerHTML, before, "an aside without any marker must not be modified at all");
  assert.equal(marked(h).length, 0, "nothing should be marked");
  assert.deepEqual(newsLogs(h), [], "nothing should be logged");
  h.close();
});

test("markNews handles each aside independently", async () => {
  const h = await fixture(`
    <aside id="left"><div id="jobs" componentkey="jobs"><p>Jobs für dich</p></div></aside>
    <aside id="right"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>
  `);
  h.lf.markNews();

  assert.deepEqual(marked(h), ["news"], "only the aside containing a marker should be affected");
  h.close();
});

test("markNews collapses news and games that live in separate asides without merging them", async () => {
  // pending is rebuilt per aside, so the games marker in the second aside must
  // still match even though the first aside already consumed the news marker.
  const h = await fixture(`
    <aside id="a"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>
    <aside id="b"><div id="games"><div id="ghead"><p>Spiel des Tages</p></div></div></aside>
  `);
  h.lf.markNews();

  // #ghead is the raw module, but it is the only child of #games, so the
  // wrapper climb lifts the mark one level and stops below the aside.
  assert.deepEqual(marked(h), ["news", "games"], "each aside resolves its own marker set");
  h.close();
});

test("markNews marks the news module reached through the scan loop", async () => {
  // End-to-end through scheduleScan: hideNews defaults to true, so a normal
  // load must mark the module without any manual call.
  const h = await loadExtension({
    body: `<aside id="rail"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>`,
  });
  await h.flush();

  assert.deepEqual(marked(h), ["news"], "the default scan should mark the news module");
  h.close();
});

test("markNews does not run while hideNews is off", async () => {
  const h = await loadExtension({
    body: `<aside id="rail"><div id="news" componentkey="news"><p>LinkedIn News</p></div></aside>`,
    storage: { hideNews: false },
  });
  await h.flush();

  assert.equal(marked(h).length, 0, "with hideNews disabled nothing may be marked");
  h.close();
});
