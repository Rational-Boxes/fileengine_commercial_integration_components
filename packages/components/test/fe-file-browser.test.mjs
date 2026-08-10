// SPDX-License-Identifier: MIT
// <fe-file-browser> via a minimal DOM shim. Globals installed before import because
// `extends Base` resolves HTMLElement at import time.
import { test, before } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor() { this._attrs = new Map(); this._listeners = {}; this.innerHTML = ""; }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
  querySelector() { return null; }
  getRootNode() { return null; }
  get isConnected() { return true; }
}

// A fake API client + provider that records calls and can push a response.
function fakeProvider() {
  const client = {
    endpoints: {},
    calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
  return { tenant: "acme", client() { return client; }, _client: client };
}

let FeFileBrowser, defineFeFileBrowser;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; this.composed = !!init.composed; }
  };
  // Presence of `document` enables the element's rendering path (SSR-guarded otherwise).
  globalThis.document = { querySelector: () => null };
  ({ FeFileBrowser, defineFeFileBrowser } = await import("../src/fe-file-browser.js"));
});

function mount(provider) {
  const el = new FeFileBrowser();
  el.provider = provider;
  el.setAttribute("folder", "root");
  el.connectedCallback();
  return el;
}

test("connectedCallback opens the initial folder via the provider's client", () => {
  const p = fakeProvider();
  const el = mount(p);
  assert.equal(p._client.calls.length, 1);
  assert.deepEqual(p._client.calls[0].pathVars, { uid: "root" });
});

test("activating a file emits fe:select (bubbling+composed); no navigation", () => {
  const p = fakeProvider();
  const el = mount(p);
  const events = [];
  el.addEventListener("fe:select", (e) => events.push(e));
  el.activate({ uid: "f1", name: "doc", type: "file" });
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.uid, "f1");
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
  assert.equal(p._client.calls.length, 1);  // still just the initial open, no nav
});

test("activating a folder emits fe:navigate and loads it", () => {
  const p = fakeProvider();
  const el = mount(p);
  const nav = [];
  el.addEventListener("fe:navigate", (e) => nav.push(e));
  el.activate({ uid: "d1", name: "sub", type: "directory" });
  assert.equal(nav.length, 1);
  assert.equal(nav[0].detail.uid, "d1");
  assert.deepEqual(p._client.calls.at(-1).pathVars, { uid: "d1" });
});

test("entries getter reflects a landed response", () => {
  const p = fakeProvider();
  const el = mount(p);
  p._client.respond("/v1/dirs/{uid}", "get", { entries: [{ uid: "a", name: "A", type: "file" }] });
  assert.equal(el.entries.length, 1);
  assert.equal(el.entries[0].name, "A");
});

test("renders an error when no <fe-session> is discoverable", () => {
  const el = new FeFileBrowser();
  el.provider = null;               // explicit: no provider, and DOM discovery finds none
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeFileBrowser registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeFileBrowser(registry);
  assert.equal(defs.get("fe-file-browser"), FeFileBrowser);
  defineFeFileBrowser(registry);
  assert.equal(defs.size, 1);
});
