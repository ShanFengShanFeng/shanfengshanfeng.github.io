const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../assets/js/scholar-publications.js"), "utf8");

// Model the DOM operations used by the renderer without introducing browser dependencies.
class Element {
  constructor(tagName = "div", attributes = {}) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
    this._text = "";
    this.hidden = true;
    this.value = "all";
    this.listeners = {};
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  appendChild(child) {
    if (child.tagName === "#fragment") this.children.push(...child.children);
    else this.children.push(child);
    return child;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

const flush = () => new Promise(setImmediate);
const googleProfile = "https://scholar.google.com/citations?user=test";
const cnkiProfile = "https://au.cnki.net/author/test";
const googleData = {
  updated_at: "2026-09-07T00:00:00Z", citedby: 12,
  publications: [
    { title: "English DOI title", doi: "10.1/a", citations: 4, year: 2025, scholar_url: "https://scholar.google.com/test" },
    { title: "Protective clothing", citations: 8, year: 2024 },
    { title: "Same title", citations: null, year: 2023 },
    { title: "Related study", citations: 0, year: 2022 }
  ]
};
const cnkiData = {
  updated_at: "2026-10-20T00:00:00Z", citedby: null,
  publication_aliases: [{ titles: ["Protective clothing", "防护服研究"] }],
  publications: [
    { title: "不同标题但相同 DOI", doi: "https://doi.org/10.1/A", citations: 2, year: 2025, authors: ["金鹏", "张三"], cnki_url: "https://kns.cnki.net/test" },
    { title: "防护服研究", citations: null, year: 2024 },
    { title: " Same   title ", citations: 0, year: 2023 },
    { title: "Related study extended", citations: "", year: 2020 }
  ]
};

async function page(google, cnki, options = {}) {
  const ids = {};
  ["scholar-publications", "manual-publications", "publication-source-filter", "total_cit", "cnki_total_cit", "scholar-updated", "cnki-updated"].forEach(id => { ids[id] = new Element(); });
  ids["scholar-publications"].attributes = {
    "data-source": "https://example.org/gs_data.json",
    "data-cnki-source": "https://example.org/cnki_data.json",
    "data-profile": googleProfile,
    "data-cnki-profile": cnkiProfile
  };
  if (Object.hasOwn(options, "fallback")) ids["scholar-publications"].attributes["data-cnki-fallback"] = "/assets/data/cnki_data.json";
  const timers = new Map();
  let timerId = 0;
  const context = {
    document: {
      getElementById: id => ids[id],
      createElement: tag => new Element(tag),
      createDocumentFragment: () => new Element("#fragment")
    },
    fetch: url => {
      const data = url.startsWith("/assets/data/") ? options.fallback : url.includes("/gs_data.json") ? google : cnki;
      return data instanceof Error ? Promise.reject(data) : Promise.resolve(data).then(value => ({ ok: true, json: async () => value }));
    },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    AbortController
  };
  vm.runInNewContext(script, context);
  await flush();
  return {
    ids,
    articles: () => ids["scholar-publications"].children.filter(child => child.tagName === "article"),
    expireRequests: async () => { const callbacks = Array.from(timers.values()); timers.clear(); callbacks.forEach(callback => callback()); await flush(); }
  };
}

test("renders unified rows, merging only exact titles, DOI or reviewed translations", async () => {
  const view = await page(googleData, cnkiData);
  assert.equal(view.articles().length, 5);
  assert.match(view.articles()[0].textContent, /不同标题但相同 DOI/);
  assert.match(view.articles()[0].textContent, /金鹏, 张三/);
  assert.match(view.articles()[0].textContent, /Google Scholar · 4 citations.*CNKI · 2 citations/);
  assert.match(view.articles()[1].textContent, /Protective clothing.*防护服研究/);
  assert.match(view.articles()[4].textContent, /Related study extended/);
  assert.equal(view.ids["manual-publications"].hidden, true);
});

test("keeps unknown counts distinct from explicit zero, and never adds source totals", async () => {
  const view = await page(googleData, cnkiData);
  assert.match(view.articles()[1].textContent, /CNKI · citations unavailable/);
  assert.match(view.articles()[2].textContent, /Google Scholar · citations unavailable.*CNKI · 0 citations/);
  assert.equal(view.ids.total_cit.textContent, "12");
  assert.equal(view.ids.cnki_total_cit.textContent, "Unavailable");
  const zero = await page({ ...googleData, citedby: 0 }, { ...cnkiData, citedby: 0 });
  assert.equal(zero.ids.total_cit.textContent, "0");
  assert.equal(zero.ids.cnki_total_cit.textContent, "0");
});

test("does not merge identical titles with conflicting known DOIs or publication years", async () => {
  const view = await page({ publications: [
    { title: "Shared title", doi: "10.1/a", year: 2025 },
    { title: "Another shared title", year: 2024 }
  ] }, { publications: [
    { title: "Shared title", doi: "10.1/b", year: 2025 },
    { title: "Another shared title", year: 2023 }
  ] });
  assert.equal(view.articles().length, 4);
  const bridge = await page({ publications: [{ title: "Bridge title", doi: "10.1/a", year: 2025 }] }, { publications: [
    { title: "Bridge title", year: 2025 },
    { title: "Bridge title", doi: "10.1/b", year: 2025 }
  ] });
  assert.equal(bridge.articles().length, 2, "an intermediate missing DOI cannot hide a known conflict");
});

test("accepts explicit per-record translations and known DOI despite metadata differences", async () => {
  const view = await page({ publications: [
    { title: "English title", year: 2025 },
    { title: "DOI paper", doi: "10.1/a", year: 2023 }
  ] }, { publications: [
    { title: "中文标题", title_aliases: ["English title"], year: 2024 },
    { title: "DOI paper translated", doi: "10.1/a", year: 2024 }
  ] });
  assert.equal(view.articles().length, 2);
});

test("filters by source while preserving publications shared by both databases", async () => {
  const view = await page(googleData, cnkiData);
  const filter = view.ids["publication-source-filter"];
  assert.equal(filter.disabled, false);
  filter.value = "cnki";
  filter.listeners.change();
  assert.equal(view.articles().length, 4);
  filter.value = "scholar";
  filter.listeners.change();
  assert.equal(view.articles().length, 4);
  filter.value = "all";
  filter.listeners.change();
  assert.equal(view.articles().length, 5);
});

test("preserves each successful source when the other request fails", async () => {
  const google = await page(googleData, new Error("CNKI failed"));
  assert.equal(google.articles().length, 4);
  assert.equal(google.ids["manual-publications"].hidden, true);
  assert.match(google.ids["scholar-publications"].textContent, /CNKI synchronization data is temporarily unavailable/);
  assert.equal(google.ids["cnki-updated"].textContent, "Temporarily unavailable");
  const cnki = await page(new Error("Google failed"), cnkiData);
  assert.equal(cnki.articles().length, 4);
  assert.equal(cnki.ids["manual-publications"].hidden, true);
});

test("uses the dated saved CNKI snapshot when the remote feed is unavailable", async () => {
  const view = await page(googleData, new Error("Remote feed missing"), { fallback: { ...cnkiData, citedby: 227 } });
  assert.equal(view.articles().length, 5);
  assert.equal(view.ids.cnki_total_cit.textContent, "227");
  assert.match(view.ids["cnki-updated"].textContent, /^Saved snapshot · Last synced .*2026/);
  assert.doesNotMatch(view.ids["scholar-publications"].textContent, /synchronization data is temporarily unavailable/);
  const invalidRemote = await page(googleData, {}, { fallback: cnkiData });
  assert.equal(invalidRemote.articles().length, 5);
  assert.match(invalidRemote.ids["cnki-updated"].textContent, /^Saved snapshot/);
  const failedFallback = await page(googleData, new Error("Remote missing"), { fallback: new Error("Local missing") });
  assert.equal(failedFallback.articles().length, 4);
  assert.equal(failedFallback.ids["cnki-updated"].textContent, "Temporarily unavailable");
});

test("renders one source immediately and can recover when the other finishes later", async () => {
  let resolveCnki;
  const deferred = new Promise(resolve => { resolveCnki = resolve; });
  const view = await page(googleData, deferred);
  assert.equal(view.articles().length, 4);
  assert.equal(view.ids["cnki-updated"].textContent, "Loading…");
  resolveCnki(cnkiData);
  await flush();
  assert.equal(view.articles().length, 5);
  assert.match(view.ids["cnki-updated"].textContent, /2026/);
});

test("times out hung requests without hiding the working source", async () => {
  const view = await page(googleData, new Promise(() => {}));
  assert.equal(view.articles().length, 4);
  await view.expireRequests();
  assert.equal(view.articles().length, 4);
  assert.equal(view.ids["cnki-updated"].textContent, "Temporarily unavailable");
  assert.equal(view.ids["manual-publications"].hidden, true);
  const bothHung = await page(new Promise(() => {}), new Promise(() => {}));
  await bothHung.expireRequests();
  assert.equal(bothHung.ids["manual-publications"].hidden, false);
});

test("shows the static selection on total failure and handles invalid fields honestly", async () => {
  const failed = await page(new Error("Google failed"), new Error("CNKI failed"));
  assert.equal(failed.ids["manual-publications"].hidden, false);
  const invalid = await page({}, { updated_at: null, citedby: " ", publications: [] });
  assert.equal(invalid.ids.cnki_total_cit.textContent, "Unavailable");
  assert.equal(invalid.ids["cnki-updated"].textContent, "Sync date unavailable");
  assert.equal(invalid.ids["manual-publications"].hidden, false);
});

test("renders untrusted publication text inert and rejects script URLs", async () => {
  const title = '<img src=x onerror="alert(1)">';
  const view = await page({ publications: [{ title, authors: "<script>alert(1)</script>", scholar_url: "javascript:alert(1)" }] }, { publications: [] });
  const row = view.articles()[0];
  const titleLink = row.children[0].children[0];
  assert.equal(titleLink.textContent, title);
  assert.equal(titleLink.href, googleProfile);
  assert.equal(row.children[1].textContent, "<script>alert(1)</script>");
  assert.equal(row.children[1].children.length, 0);
});
