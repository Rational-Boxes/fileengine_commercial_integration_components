// SPDX-License-Identifier: MIT
import { test, before } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor() { this._attrs = new Map(); this._listeners = {}; this.innerHTML = ""; }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  hasAttribute(n) { return this._attrs.has(n); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
  querySelector() { return null; }
  getRootNode() { return null; }
  get isConnected() { return true; }
}

function fakeProvider() {
  const client = {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers) { this.calls.push({ path, verb, data }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
  const bases = [];
  return { tenant: "", base: "http://files.example.com", getToken: () => "t",
    client(b) { bases.push(b); return client; }, _client: client, _bases: bases };
}

let FeSearch, defineFeSearch;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; this.composed = !!init.composed; }
  };
  globalThis.document = { querySelector: () => null };
  ({ FeSearch, defineFeSearch } = await import("../src/fe-search.js"));
});

function mount(p, attrs = {}) {
  const el = new FeSearch();
  el.provider = p;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.connectedCallback();
  return el;
}

test("binds a client to the endpoint (search service) base", () => {
  const p = fakeProvider();
  mount(p, { endpoint: "http://search.example.com" });
  assert.equal(p._bases.at(-1), "http://search.example.com");
});

test("falls back to the bridge base when no endpoint given", () => {
  const p = fakeProvider();
  mount(p);
  assert.equal(p._bases.at(-1), "http://files.example.com");
});

test("search(query) issues a post_json /search request", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://search.example.com" });
  el.search("report");
  assert.equal(p._client.calls.at(-1).path, "/search");
  assert.equal(p._client.calls.at(-1).verb, "post_json");
  assert.equal(p._client.calls.at(-1).data.query, "report");
});

test("selecting a hit emits fe:result-select mapping file_uid -> uid", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://search.example.com" });
  const events = [];
  el.addEventListener("fe:result-select", (e) => events.push(e));
  el.search("q");
  p._client.respond("/search", "post_json", { hits: [{ file_uid: "f1", name: "Doc" }] });
  assert.equal(el.hits.length, 1);

  el.selectHit(el.hits[0]);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.uid, "f1");
  assert.equal(events[0].detail.name, "Doc");
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
});

test("no <fe-session> -> message, no crash", () => {
  const el = new FeSearch();
  el.provider = null;
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeSearch registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeSearch(registry);
  assert.equal(defs.get("fe-search"), FeSearch);
  defineFeSearch(registry);
  assert.equal(defs.size, 1);
});
