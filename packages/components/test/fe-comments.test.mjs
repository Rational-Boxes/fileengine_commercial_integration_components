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

function fakeSocket() {
  return { handlers: [], connected: false, closed: false,
    onMessage(fn) { this.handlers.push(fn); return () => {}; },
    connect() { this.connected = true; }, close() { this.closed = true; },
    emit(m) { this.handlers.slice().forEach((f) => f(m)); } };
}

function fakeProvider() {
  const client = {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, verb, data, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
  const sockets = [];
  return {
    tenant: "acme", base: "http://disc.example.com:8094", getToken: () => "tok-9",
    client() { return client; },
    liveSocket(url) { const s = fakeSocket(); s.url = url; sockets.push(s); return s; },
    _client: client, _sockets: sockets,
  };
}

let FeComments, defineFeComments;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; this.composed = !!init.composed; }
  };
  globalThis.document = { querySelector: () => null };
  globalThis.URLSearchParams = URLSearchParams;
  ({ FeComments, defineFeComments } = await import("../src/fe-comments.js"));
});

function mount(p, attrs = {}) {
  const el = new FeComments();
  el.provider = p;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.connectedCallback();
  return el;
}

test("open(uid) lists threads and attaches a live socket with a ws:// token URL", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://disc.example.com:8094" });
  el.open("file-1");
  assert.deepEqual(p._client.calls.at(-1).pathVars, { uid: "file-1" });
  assert.equal(p._sockets.length, 1);
  const url = p._sockets[0].url;
  assert.ok(url.startsWith("ws://disc.example.com:8094/files/file-1/live?"), url);
  assert.ok(url.includes("token=tok-9"));
  assert.ok(url.includes("tenant=acme"));
  assert.equal(p._sockets[0].connected, true);
});

test("a live comment event drives a reload", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://disc.example.com:8094" });
  el.open("file-1");
  const getsBefore = p._client.calls.filter((c) => c.verb === "get").length;
  p._sockets[0].emit({ type: "comment.created" });
  assert.equal(p._client.calls.filter((c) => c.verb === "get").length, getsBefore + 1);
});

test("post() posts a thread and emits fe:comment", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://disc.example.com:8094" });
  el.open("file-1");
  const events = [];
  el.addEventListener("fe:comment", (e) => events.push(e));
  const started = el.post("nice work");
  assert.equal(started, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.uid, "file-1");
  assert.equal(events[0].detail.body, "nice work");
  assert.equal(events[0].bubbles, true);
});

test("switching files replaces the socket (old one closed)", () => {
  const p = fakeProvider();
  const el = mount(p, { endpoint: "http://disc.example.com:8094" });
  el.open("file-1");
  el.open("file-2");
  assert.equal(p._sockets.length, 2);
  assert.equal(p._sockets[0].closed, true);
  assert.ok(p._sockets[1].url.includes("/files/file-2/live"));
});

test("no <fe-session> -> message, no crash", () => {
  const el = new FeComments();
  el.provider = null;
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeComments registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeComments(registry);
  assert.equal(defs.get("fe-comments"), FeComments);
  defineFeComments(registry);
  assert.equal(defs.size, 1);
});
