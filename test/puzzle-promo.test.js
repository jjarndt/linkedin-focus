// Use the right-rail component key observed on LinkedIn's live feed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadExtension } from "./harness.js";

const styles = readFileSync(new URL("../extension/styles.css", import.meta.url), "utf8");
const puzzle = `<div id="puzzle-card"><div><div componentkey="feedRightNavGamesComponentRef">
  <p>LinkedIn Puzzle Games</p><a href="/games/zip/">Zip lösen</a>
</div></div></div>`;
const body = `<aside><section id="news"><p>LinkedIn News</p><p>Top-Storys</p></section>
  ${puzzle}<div id="other-card">Another card</div></aside>
  <main><div id="organic" componentkey="feedRightNavGamesComponentRef">
    <p>LinkedIn Puzzle Games</p><a href="/games/zip/">A post about Zip</a>
  </div></main>`;

function addStyles(document) {
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.append(style);
}

test("Ads hides the complete puzzle card but preserves News and organic posts", async (t) => {
  const h = await loadExtension({ body, storage: { hideFeed: false, hideAds: true, hideNews: false } });
  t.after(h.close);
  addStyles(h.document);
  const display = (id) => h.window.getComputedStyle(h.document.getElementById(id)).display;
  assert.equal(display("puzzle-card"), "none");
  for (const id of ["news", "other-card", "organic"]) assert.notEqual(display(id), "none", id);

  await h.storage.local.set({ hideAds: false });
  await h.flush();
  assert.notEqual(display("puzzle-card"), "none");

  await h.storage.local.set({ hideNews: true });
  await h.flush();
  assert.equal(display("puzzle-card"), "none");
});

test("a late puzzle card is found and its recycled wrapper is unmarked", async (t) => {
  const h = await loadExtension({ body: '<aside><div>Neighbor</div></aside>', storage: { hideAds: true, hideNews: false } });
  t.after(h.close);
  h.document.querySelector("aside").insertAdjacentHTML("beforeend", puzzle);
  await h.flush();
  const card = h.document.getElementById("puzzle-card");
  assert.equal(card.classList.contains("lf-puzzle-promo"), true);
  card.querySelector("[componentkey]").setAttribute("componentkey", "unrelated");
  await h.flush();
  assert.equal(card.classList.contains("lf-puzzle-promo"), false);
});

test("a puzzle component outside the home feed is not marked", async (t) => {
  const h = await loadExtension({ body, url: "https://www.linkedin.com/games/zip/" });
  t.after(h.close);
  assert.equal(h.document.querySelector(".lf-puzzle-promo"), null);
});
