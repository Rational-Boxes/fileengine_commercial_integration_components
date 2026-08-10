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
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, verb, pathVars, data }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
  return { tenant: "acme", client() { return client; }, _client: client };
}

let FeMetadata, defineFeMetadata;
before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class { constructor(t, i = {}) { this.type = t; this.detail = i.detail; this.bubbles = !!i.bubbles; this.composed = !!i.composed; } };
  globalThis.document = { querySelector: () => null };
  ({ FeMetadata, defineFeMetadata } = await import("../src/fe-metadata.js"));
});

function mount(p, attrs = {}) {
  const el = new FeMetadata();
  el.provider = p;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.connectedCallback();
  return el;
}

test("open(uid) lists; entries reflect the response", () => {
  const p = fakeProvider();
  const el = mount(p, { uid: "n1" });
  p._client.respond("/v1/nodes/{uid}/metadata", "get", { metadata: { a: "1" } });
  assert.deepEqual(el.entries, [{ key: "a", value: "1" }]);
});

test("setKey/deleteKey emit fe:metadata-change", () => {
  const p = fakeProvider();
  const el = mount(p, { uid: "n1" });
  const events = [];
  el.addEventListener("fe:metadata-change", (e) => events.push(e.detail));
  el.setKey("color", "red");
  el.deleteKey("color");
  assert.deepEqual(events, [
    { uid: "n1", op: "set", key: "color" },
    { uid: "n1", op: "delete", key: "color" },
  ]);
});

test("readonly disables writes", () => {
  const p = fakeProvider();
  const el = mount(p, { uid: "n1", readonly: "" });
  assert.equal(el.readonly, true);
  assert.equal(el.setKey("a", "b"), false);
  assert.equal(el.deleteKey("a"), false);
  assert.equal(p._client.calls.filter((c) => c.verb !== "get").length, 0);
});

test("no <fe-session> -> message", () => {
  const el = new FeMetadata();
  el.provider = null;
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeMetadata registers once", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeMetadata(registry); defineFeMetadata(registry);
  assert.equal(defs.size, 1);
  assert.equal(defs.get("fe-metadata"), FeMetadata);
});
