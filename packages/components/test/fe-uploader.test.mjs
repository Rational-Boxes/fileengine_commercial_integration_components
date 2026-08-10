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

const realFetch = globalThis.fetch;
let FeUploader, defineFeUploader;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.bubbles = !!init.bubbles; this.composed = !!init.composed; }
  };
  globalThis.document = { querySelector: () => null };
  ({ FeUploader, defineFeUploader } = await import("../src/fe-uploader.js"));
});

function provider() {
  return { base: "http://files.example.com", tenant: "acme", getToken: () => "tok" };
}

function mount(p, attrs = {}) {
  const el = new FeUploader();
  el.provider = p;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.connectedCallback();
  return el;
}

test("folder attribute drives the target; defaults to root", () => {
  assert.equal(mount(provider()).folder, "root");
  assert.equal(mount(provider(), { folder: "dir-9" }).folder, "dir-9");
});

test("uploadBlob runs the two-step upload and emits fe:upload on success", async () => {
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push(url);
    if (url.endsWith("/v1/dirs/dir-9/files")) return { ok: true, status: 201, json: async () => ({ uid: "new-1" }) };
    if (url.endsWith("/v1/files/new-1/content")) return { ok: true, status: 204, json: async () => null };
    throw new Error("unexpected " + url);
  };
  const el = mount(provider(), { folder: "dir-9" });
  const events = [];
  el.addEventListener("fe:upload", (e) => events.push(e));

  const result = await el.uploadBlob("doc.txt", "body");
  assert.equal(result.uid, "new-1");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { uid: "new-1", name: "doc.txt", folder: "dir-9" });
  assert.equal(events[0].bubbles, true);
  assert.ok(seen[0].endsWith("/v1/dirs/dir-9/files"));
  globalThis.fetch = realFetch;
});

test("uploadFiles emits fe:upload-error when a file fails", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const el = mount(provider());
  const errs = [];
  el.addEventListener("fe:upload-error", (e) => errs.push(e));
  await el.uploadFiles([{ name: "bad.txt" }]);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].detail.name, "bad.txt");
  globalThis.fetch = realFetch;
});

test("no <fe-session> -> message, no crash", () => {
  const el = new FeUploader();
  el.provider = null;
  el.connectedCallback();
  assert.match(el.innerHTML, /no &lt;fe-session&gt; found/);
});

test("defineFeUploader registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeUploader(registry);
  assert.equal(defs.get("fe-uploader"), FeUploader);
  defineFeUploader(registry);
  assert.equal(defs.size, 1);
});
