// SPDX-License-Identifier: MIT
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FileBrowserModel, isDirectory, DIRS_PATH } from "../src/file-browser-model.js";
// Integration import: the real API client from core, to prove the model works against
// the actual define_endpoint/call contract (not just a fake).
import { API_REST } from "../../core/src/api.js";

// --- a fake client implementing the duck-typed contract ---
function fakeClient() {
  return {
    endpoints: {},
    calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) {
      this.calls.push({ path, verb, headers, pathVars });
      return true;
    },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
}

test("isDirectory classifies entry types", () => {
  assert.equal(isDirectory({ type: "directory" }), true);
  assert.equal(isDirectory({ type: "symlink" }), true);
  assert.equal(isDirectory({ type: "file" }), false);
  assert.equal(isDirectory(null), false);
});

test("open() issues a listing call with path var + tenant header, and loading toggles", () => {
  const c = fakeClient();
  const m = new FileBrowserModel(c, { root: "root", tenant: "acme" });
  const states = [];
  m.onUpdate((s) => states.push(s));

  const started = m.open("root");
  assert.equal(started, true);
  assert.equal(m.loading, true);
  assert.deepEqual(c.calls[0], {
    path: DIRS_PATH, verb: "get", headers: { "X-Tenant": "acme" }, pathVars: { uid: "root" },
  });

  // Response lands -> entries populated, loading cleared, subscribers notified.
  c.respond(DIRS_PATH, "get", { entries: [{ uid: "a", name: "A", type: "directory" }, { uid: "b", name: "B", type: "file" }] });
  assert.equal(m.entries.length, 2);
  assert.equal(m.loading, false);
  assert.equal(states.at(-1).entries[1].name, "B");
});

test("open(uid) updates currentUid and navigates", () => {
  const c = fakeClient();
  const m = new FileBrowserModel(c, { root: "root" });
  m.open("folder-42");
  assert.equal(m.currentUid, "folder-42");
  assert.deepEqual(c.calls.at(-1).pathVars, { uid: "folder-42" });
  assert.deepEqual(c.calls.at(-1).headers, {});  // no tenant configured
});

test("a deduped in-flight call clears loading", () => {
  const c = fakeClient();
  c.call = () => false;  // simulate API_REST dedup
  const m = new FileBrowserModel(c, { root: "root" });
  const started = m.open("root");
  assert.equal(started, false);
  assert.equal(m.loading, false);
});

// --- integration against the real API_REST + a mocked fetch ---
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("works end-to-end with the real API_REST client (mocked fetch)", async () => {
  const seen = [];
  globalThis.fetch = async (req) => {
    seen.push(req.url);
    return new Response(JSON.stringify({ entries: [{ uid: "x", name: "X", type: "file" }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new API_REST("http://files.example.com");
  const m = new FileBrowserModel(client, { root: "root" });
  let resolve; const updated = new Promise((r) => (resolve = r));
  m.onUpdate((s) => { if (!s.loading) resolve(s); });

  m.open("root");
  const state = await updated;
  assert.equal(state.entries[0].name, "X");
  assert.ok(seen[0].endsWith("/v1/dirs/root"), seen[0]);
});
