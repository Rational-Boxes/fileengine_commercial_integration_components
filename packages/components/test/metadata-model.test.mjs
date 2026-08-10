// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { MetadataModel, META_ALL_PATH, META_KEY_PATH } from "../src/metadata-model.js";

function fakeClient() {
  return {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, verb, data, headers, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
}

test("open(uid) lists metadata and exposes entries", () => {
  const c = fakeClient();
  const m = new MetadataModel(c, { tenant: "acme" });
  m.open("n1");
  assert.deepEqual(c.calls[0], {
    path: META_ALL_PATH, verb: "get", data: undefined, headers: { "X-Tenant": "acme" }, pathVars: { uid: "n1" },
  });
  c.respond(META_ALL_PATH, "get", { metadata: { color: "red", size: "L" } });
  assert.deepEqual(m.metadata, { color: "red", size: "L" });
  assert.deepEqual(m.entries, [{ key: "color", value: "red" }, { key: "size", value: "L" }]);
});

test("setKey PUTs {value} at the key path and reloads on success", () => {
  const c = fakeClient();
  const m = new MetadataModel(c);
  m.open("n1"); c.respond(META_ALL_PATH, "get", { metadata: {} });

  assert.equal(m.setKey("color", "blue"), true);
  const put = c.calls.find((k) => k.verb === "put");
  assert.deepEqual(put, { path: META_KEY_PATH, verb: "put", data: { value: "blue" }, headers: {}, pathVars: { uid: "n1", key: "color" } });

  const getsBefore = c.calls.filter((k) => k.verb === "get").length;
  c.respond(META_KEY_PATH, "put", { ok: true });   // write echoes -> reload
  assert.equal(c.calls.filter((k) => k.verb === "get").length, getsBefore + 1);
});

test("deleteKey DELETEs at the key path and reloads", () => {
  const c = fakeClient();
  const m = new MetadataModel(c);
  m.open("n1"); c.respond(META_ALL_PATH, "get", { metadata: { a: "1" } });
  assert.equal(m.deleteKey("a"), true);
  const del = c.calls.find((k) => k.verb === "delete");
  assert.deepEqual(del.pathVars, { uid: "n1", key: "a" });
  const getsBefore = c.calls.filter((k) => k.verb === "get").length;
  c.respond(META_KEY_PATH, "delete", {});
  assert.equal(c.calls.filter((k) => k.verb === "get").length, getsBefore + 1);
});

test("writes are no-ops without an open node or key", () => {
  const c = fakeClient();
  const m = new MetadataModel(c);
  assert.equal(m.setKey("k", "v"), false);   // no node
  assert.equal(m.deleteKey("k"), false);
  m.open("n"); c.respond(META_ALL_PATH, "get", { metadata: {} });
  assert.equal(m.setKey("", "v"), false);     // no key
});

test("open('') clears; a non-object metadata payload is coerced to {}", () => {
  const c = fakeClient();
  const m = new MetadataModel(c);
  m.open("n"); c.respond(META_ALL_PATH, "get", { metadata: null });
  assert.deepEqual(m.metadata, {});
  assert.equal(m.open(""), false);
  assert.equal(m.uid, null);
});
