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
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
  return { tenant: "", base: "http://files.example.com", getToken: () => null, client() { return client; }, _client: client };
}

let FeDocumentPreview, defineFeDocumentPreview;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; this.composed = !!init.composed; }
  };
  globalThis.document = { querySelector: () => null };
  ({ FeDocumentPreview, defineFeDocumentPreview } = await import("../src/fe-document-preview.js"));
});

function mount(provider, attrs = {}) {
  const el = new FeDocumentPreview();
  el.provider = provider;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.connectedCallback();
  return el;
}

test("with no uid, shows the empty-state message and issues no request", () => {
  const p = fakeProvider();
  const el = mount(p);
  assert.equal(p._client.calls.length, 0);
  assert.match(el.innerHTML, /Select a file to preview/);
});

test("open(uid) requests renditions and emits fe:preview when they land", () => {
  const p = fakeProvider();
  const el = mount(p);
  const events = [];
  el.addEventListener("fe:preview", (e) => events.push(e));

  el.open("file-1");
  assert.deepEqual(p._client.calls.at(-1).pathVars, { uid: "file-1" });

  p._client.respond("/v1/files/{uid}/renditions", "get", { entries: [{ uid: "r2", name: "preview.png", type: "file" }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.uid, "file-1");
  assert.equal(events[0].detail.kind, "image");
  assert.equal(events[0].bubbles, true);
  assert.equal(el.preview.uid, "r2");
});

test("initial uid attribute auto-loads on connect", () => {
  const p = fakeProvider();
  const el = mount(p, { uid: "file-7" });
  assert.deepEqual(p._client.calls.at(-1).pathVars, { uid: "file-7" });
});

test("markup attribute is reflected by the markup getter (opt-in overlay)", () => {
  const p = fakeProvider();
  assert.equal(mount(p).markup, false);
  assert.equal(mount(p, { markup: "" }).markup, true);
});

test("renders 'no preview' when a file has no usable rendition", () => {
  const p = fakeProvider();
  const el = mount(p);
  el.open("file-1");
  p._client.respond("/v1/files/{uid}/renditions", "get", { entries: [] });
  assert.match(el.innerHTML, /No preview available/);
});

test("no <fe-session> -> message, no crash", () => {
  const el = new FeDocumentPreview();
  el.provider = null;
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeDocumentPreview registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeDocumentPreview(registry);
  assert.equal(defs.get("fe-document-preview"), FeDocumentPreview);
  defineFeDocumentPreview(registry);
  assert.equal(defs.size, 1);
});
