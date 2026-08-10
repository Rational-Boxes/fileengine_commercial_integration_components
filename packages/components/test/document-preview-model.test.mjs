// SPDX-License-Identifier: MIT
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DocumentPreviewModel, pickPreview, kindOf, RENDITIONS_PATH } from "../src/document-preview-model.js";
import { API_REST } from "../../core/src/api.js";

function fakeClient() {
  return {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, headers, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
}

test("kindOf classifies by extension", () => {
  assert.equal(kindOf({ name: "preview.png" }), "image");
  assert.equal(kindOf({ name: "scan.JPEG" }), "image");
  assert.equal(kindOf({ name: "doc.pdf" }), "pdf");
  assert.equal(kindOf({ name: "data.bin" }), "other");
  assert.equal(kindOf(null), "other");
});

test("pickPreview prefers image named preview, then any image, then pdf, then first", () => {
  assert.equal(pickPreview([
    { uid: "1", name: "thumb.png", type: "file" },
    { uid: "2", name: "preview.png", type: "file" },
  ]).uid, "2");
  assert.equal(pickPreview([
    { uid: "1", name: "doc.pdf", type: "file" },
    { uid: "2", name: "scan.jpg", type: "file" },
  ]).uid, "2");
  assert.equal(pickPreview([
    { uid: "1", name: "a.bin", type: "file" },
    { uid: "2", name: "doc.pdf", type: "file" },
  ]).uid, "2");
  assert.equal(pickPreview([{ uid: "1", name: "a.bin", type: "file" }]).uid, "1");
  assert.equal(pickPreview([]), null);
  // directories are never chosen
  assert.equal(pickPreview([{ uid: "d", name: "sub", type: "directory" }]), null);
});

test("open(uid) requests renditions; response selects a preview", () => {
  const c = fakeClient();
  const m = new DocumentPreviewModel(c, { tenant: "acme" });
  const states = [];
  m.onUpdate((s) => states.push(s));

  m.open("file-1");
  assert.equal(m.loading, true);
  assert.deepEqual(c.calls[0], { path: RENDITIONS_PATH, headers: { "X-Tenant": "acme" }, pathVars: { uid: "file-1" } });

  c.respond(RENDITIONS_PATH, "get", { entries: [
    { uid: "r1", name: "thumb.png", type: "file" },
    { uid: "r2", name: "preview.png", type: "file" },
  ] });
  assert.equal(m.loading, false);
  assert.equal(m.preview.uid, "r2");
  assert.equal(m.renditions.length, 2);
  assert.equal(states.at(-1).preview.uid, "r2");
});

test("open('') clears the preview", () => {
  const c = fakeClient();
  const m = new DocumentPreviewModel(c);
  m.open("file-1");
  c.respond(RENDITIONS_PATH, "get", { entries: [{ uid: "r", name: "p.png", type: "file" }] });
  assert.ok(m.preview);
  const started = m.open("");
  assert.equal(started, false);
  assert.equal(m.preview, null);
  assert.equal(m.fileUid, null);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("end-to-end with the real API_REST client (mocked fetch)", async () => {
  const seen = [];
  globalThis.fetch = async (req) => {
    seen.push(req.url);
    return new Response(JSON.stringify({ entries: [{ uid: "r2", name: "preview.png", type: "file" }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new API_REST("http://files.example.com");
  const m = new DocumentPreviewModel(client);
  let resolve; const done = new Promise((r) => (resolve = r));
  m.onUpdate((s) => { if (!s.loading && s.fileUid) resolve(s); });
  m.open("file-9");
  const s = await done;
  assert.equal(s.preview.name, "preview.png");
  assert.ok(seen[0].endsWith("/v1/files/file-9/renditions"), seen[0]);
});
