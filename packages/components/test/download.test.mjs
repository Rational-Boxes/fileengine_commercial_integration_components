// SPDX-License-Identifier: MIT
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { parseFilename, fetchContent } from "../src/download.js";

test("parseFilename handles quoted, unquoted, and RFC5987 filename*", () => {
  assert.equal(parseFilename('attachment; filename="report.pdf"'), "report.pdf");
  assert.equal(parseFilename("attachment; filename=report.pdf"), "report.pdf");
  assert.equal(parseFilename("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"), "résumé.pdf");
  assert.equal(parseFilename(""), "");
  assert.equal(parseFilename(null), "");
});

function provider({ token = "tok", tenant = "acme", base = "http://files.example.com" } = {}) {
  return { base, tenant, getToken: () => token };
}
const resp = (body, { ok = true, status = 200, cd } = {}) => ({
  ok, status,
  blob: async () => body,
  headers: { get: (h) => (h.toLowerCase() === "content-disposition" ? cd : null) },
});

test("fetchContent sends bearer + tenant, returns blob + filename from Content-Disposition", async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return resp("BYTES", { cd: 'attachment; filename="doc.txt"' }); };
  const out = await fetchContent(provider(), "file-1", { fetchImpl });
  assert.equal(out.blob, "BYTES");
  assert.equal(out.filename, "doc.txt");
  assert.ok(seen.url.endsWith("/v1/files/file-1/content"));
  assert.equal(seen.opts.headers.Authorization, "Bearer tok");
  assert.equal(seen.opts.headers["X-Tenant"], "acme");
});

test("fetchContent falls back to the uid when no Content-Disposition", async () => {
  const out = await fetchContent(provider({ tenant: "" }), "file-9", { fetchImpl: async () => resp("B") });
  assert.equal(out.filename, "file-9");
});

test("fetchContent throws on a non-ok response", async () => {
  await assert.rejects(
    fetchContent(provider(), "x", { fetchImpl: async () => resp("", { ok: false, status: 403 }) }),
    /download failed: 403/);
});

test("fetchContent omits auth/tenant when unauthenticated / no tenant", async () => {
  let seen;
  await fetchContent(provider({ token: null, tenant: "" }), "x", {
    fetchImpl: async (url, opts) => { seen = opts; return resp("B"); },
  });
  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(seen.headers["X-Tenant"], undefined);
});

// ---- element ----
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

let FeDownload, defineFeDownload;
before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class { constructor(t, i = {}) { this.type = t; this.detail = i.detail; this.bubbles = !!i.bubbles; } };
  globalThis.document = undefined;   // no DOM save in tests; #save is guarded
  globalThis.fetch = async () => resp("BYTES", { cd: 'attachment; filename="a.bin"' });
  ({ FeDownload, defineFeDownload } = await import("../src/fe-download.js"));
});

test("download() emits fe:download with the resolved filename", async () => {
  const el = new FeDownload();
  el.provider = provider();
  el.setAttribute("uid", "file-1");
  const events = [];
  el.addEventListener("fe:download", (e) => events.push(e.detail));
  const out = await el.download();
  assert.equal(out.filename, "a.bin");
  assert.deepEqual(events, [{ uid: "file-1", filename: "a.bin" }]);
});

test("download() emits fe:download-error on failure", async () => {
  globalThis.fetch = async () => resp("", { ok: false, status: 500 });
  const el = new FeDownload();
  el.provider = provider();
  const errs = [];
  el.addEventListener("fe:download-error", (e) => errs.push(e.detail));
  const out = await el.download("file-2");
  assert.equal(out, null);
  assert.equal(errs.length, 1);
  assert.match(errs[0].error, /download failed: 500/);
});

test("defineFeDownload registers once", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeDownload(registry); defineFeDownload(registry);
  assert.equal(defs.size, 1);
});
