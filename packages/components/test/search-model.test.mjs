// SPDX-License-Identifier: MIT
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SearchModel, SEARCH_PATH } from "../src/search-model.js";
import { API_REST } from "../../core/src/api.js";

function fakeClient() {
  return {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers) { this.calls.push({ path, verb, data, headers }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
}

test("search() POSTs query/limit/fuzzy and populates hits from the response", () => {
  const c = fakeClient();
  const m = new SearchModel(c, { tenant: "acme" });
  const states = [];
  m.onUpdate((s) => states.push(s));

  m.search("invoice", { limit: 5, fuzzy: false });
  assert.equal(m.loading, true);
  assert.deepEqual(c.calls[0], {
    path: SEARCH_PATH, verb: "post_json",
    data: { query: "invoice", limit: 5, fuzzy: false },
    headers: { "X-Tenant": "acme" },
  });

  c.respond(SEARCH_PATH, "post_json", { query: "invoice", hits: [
    { file_uid: "f1", name: "Invoice.pdf", snippet: "…", score: 0.9 },
  ] });
  assert.equal(m.loading, false);
  assert.equal(m.hits.length, 1);
  assert.equal(m.hits[0].file_uid, "f1");
  assert.equal(states.at(-1).hits[0].name, "Invoice.pdf");
});

test("defaults: limit 20, fuzzy true", () => {
  const c = fakeClient();
  new SearchModel(c).search("x");
  assert.deepEqual(c.calls[0].data, { query: "x", limit: 20, fuzzy: true });
});

test("an empty/blank query clears hits and issues no request", () => {
  const c = fakeClient();
  const m = new SearchModel(c);
  m.search("a");
  c.respond(SEARCH_PATH, "post_json", { hits: [{ file_uid: "x", name: "X" }] });
  assert.equal(m.hits.length, 1);

  const started = m.search("   ");
  assert.equal(started, false);
  assert.equal(m.hits.length, 0);
  assert.equal(c.calls.length, 1);  // no second request
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("end-to-end with the real API_REST client against the search base (mocked fetch)", async () => {
  const seen = [];
  globalThis.fetch = async (req) => {
    seen.push({ url: req.url, method: req.method });
    return new Response(JSON.stringify({ hits: [{ file_uid: "f9", name: "Doc", snippet: "s", score: 1 }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new API_REST("http://search.example.com");  // the search service base
  const m = new SearchModel(client);
  let resolve; const done = new Promise((r) => (resolve = r));
  m.onUpdate((s) => { if (!s.loading && s.query) resolve(s); });
  m.search("hello");
  const s = await done;
  assert.equal(s.hits[0].file_uid, "f9");
  assert.ok(seen[0].url.endsWith("/search"), seen[0].url);
  assert.equal(seen[0].method, "POST");
});
