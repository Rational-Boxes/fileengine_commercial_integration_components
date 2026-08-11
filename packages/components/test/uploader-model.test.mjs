// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { UploaderModel } from "../src/uploader-model.js";

function provider({ token = "tok-1", tenant = "acme", base = "http://files.example.com" } = {}) {
  return { base, tenant, getToken: () => token };
}

// A fetch stub that records requests and returns scripted responses per URL suffix.
function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    for (const [suffix, resp] of script) if (url.endsWith(suffix)) return resp();
    throw new Error("unexpected fetch: " + url);
  };
  fn.calls = calls;
  return fn;
}
const ok = (body, status = 200) => () => ({ ok: status < 400, status, json: async () => body });

test("upload does create then content, with auth + tenant headers and correct URLs", async () => {
  const fetchImpl = scriptedFetch([
    ["/v1/dirs/root/files", ok({ uid: "new-1" }, 201)],
    ["/v1/files/new-1/content", ok(null, 204)],
  ]);
  const m = new UploaderModel(provider(), { fetchImpl });
  const phases = [];
  m.onUpdate((s) => phases.push(s.phase));

  const result = await m.upload("root", "hello.txt", "hi");
  assert.deepEqual(result, { phase: "done", name: "hello.txt", uid: "new-1" });

  // step 1: create
  const create = fetchImpl.calls[0];
  assert.ok(create.url.endsWith("/v1/dirs/root/files"));
  assert.equal(create.opts.method, "POST");
  assert.equal(create.opts.headers.Authorization, "Bearer tok-1");
  assert.equal(create.opts.headers["X-Tenant"], "acme");
  assert.equal(create.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(create.opts.body), { name: "hello.txt" });

  // step 2: content
  const put = fetchImpl.calls[1];
  assert.ok(put.url.endsWith("/v1/files/new-1/content"));
  assert.equal(put.opts.method, "PUT");
  assert.equal(put.opts.body, "hi");
  assert.equal(put.opts.headers.Authorization, "Bearer tok-1");

  assert.deepEqual(phases, ["creating", "uploading", "done"]);
});

test("a failed create throws and skips the content PUT", async () => {
  const fetchImpl = scriptedFetch([["/v1/dirs/root/files", ok({ error: "denied" }, 403)]]);
  const m = new UploaderModel(provider(), { fetchImpl });
  const errors = [];
  m.onUpdate((s) => { if (s.phase === "error") errors.push(s); });
  await assert.rejects(m.upload("root", "x", "data"), /create failed: 403/);
  assert.equal(fetchImpl.calls.length, 1);        // no content PUT attempted
  assert.equal(errors[0].step, "create");
});

test("a failed content PUT throws after the node was created", async () => {
  const fetchImpl = scriptedFetch([
    ["/v1/dirs/root/files", ok({ uid: "new-2" }, 201)],
    ["/v1/files/new-2/content", ok(null, 500)],
  ]);
  const m = new UploaderModel(provider(), { fetchImpl });
  const errors = [];
  m.onUpdate((s) => { if (s.phase === "error") errors.push(s); });
  await assert.rejects(m.upload("root", "x", "data"), /content failed: 500/);
  assert.equal(errors[0].step, "content");
  assert.equal(errors[0].uid, "new-2");
});

test("omits auth/tenant headers when unauthenticated / no tenant", async () => {
  const fetchImpl = scriptedFetch([
    ["/v1/dirs/d/files", ok({ uid: "u" }, 201)],
    ["/v1/files/u/content", ok(null, 204)],
  ]);
  const m = new UploaderModel(provider({ token: null, tenant: "" }), { fetchImpl });
  await m.upload("d", "n", "b");
  const h = fetchImpl.calls[0].opts.headers;
  assert.equal(h.Authorization, undefined);
  assert.equal(h["X-Tenant"], undefined);
});

test("uses the global fetch with the global as `this` (no Illegal invocation)", async () => {
  const realFetch = globalThis.fetch;
  let capturedThis = "unset";
  globalThis.fetch = function (url) {
    capturedThis = this;
    return Promise.resolve({ ok: true, status: url.endsWith("/files") ? 201 : 204, json: async () => ({ uid: "u" }) });
  };
  try {
    const m = new UploaderModel(provider(), {});   // no fetchImpl -> real global path
    await m.upload("root", "n", "b");
    assert.notEqual(capturedThis, m, "fetch must not be called with the model as this");
    assert.equal(capturedThis, globalThis);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("path segments are URL-encoded", async () => {
  const fetchImpl = scriptedFetch([
    ["/v1/dirs/a%2Fb/files", ok({ uid: "x y" }, 201)],
    ["/v1/files/x%20y/content", ok(null, 204)],
  ]);
  const m = new UploaderModel(provider({ tenant: "" }), { fetchImpl });
  await m.upload("a/b", "n", "b");
  assert.ok(fetchImpl.calls[0].url.endsWith("/v1/dirs/a%2Fb/files"));
  assert.ok(fetchImpl.calls[1].url.endsWith("/v1/files/x%20y/content"));
});
