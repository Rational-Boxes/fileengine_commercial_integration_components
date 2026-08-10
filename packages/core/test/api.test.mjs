// SPDX-License-Identifier: MIT
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { API_REST, HTTP_GET } from "../src/api.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("path vars are substituted into the request URL and payload reaches the callback", async () => {
  const seen = [];
  globalThis.fetch = async (req) => { seen.push(req.url); return jsonResponse({ id: "42", ok: true }); };
  const api = new API_REST("http://x");

  let resolve; const got = new Promise((r) => (resolve = r));
  api.define_endpoint("/docs/{id}", (payload) => resolve(payload), HTTP_GET);

  const initiated = api.call("/docs/{id}", HTTP_GET, undefined, {}, { id: "42" });
  assert.equal(initiated, true);

  const payload = await got;
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith("/docs/42"), seen[0]);
  assert.deepEqual(payload, { id: "42", ok: true });
});

test("an identical in-flight call is deduped (returns false)", async () => {
  let release; const gate = new Promise((r) => (release = r));
  globalThis.fetch = async () => { await gate; return jsonResponse({}); };
  const api = new API_REST("http://x");
  api.define_endpoint("/a", () => {}, HTTP_GET);

  const first = api.call("/a", HTTP_GET);
  const second = api.call("/a", HTTP_GET); // identical, still in flight
  assert.equal(first, true);
  assert.equal(second, false);
  release();
});

test("a distinct call is not deduped", async () => {
  let release; const gate = new Promise((r) => (release = r));
  globalThis.fetch = async () => { await gate; return jsonResponse({}); }; // both stay in flight until released
  const api = new API_REST("http://x");
  api.define_endpoint("/a", () => {}, HTTP_GET);
  api.define_endpoint("/b", () => {}, HTTP_GET);
  assert.equal(api.call("/a", HTTP_GET), true);
  assert.equal(api.call("/b", HTTP_GET), true); // different URL → distinct key
  release();
});

test("a 401 triggers the reauthorize callback (token-refresh path)", async () => {
  globalThis.fetch = async () => jsonResponse({ error: "unauthorized" }, 401);
  const api = new API_REST("http://x", () => {}); // swallow error handler
  let reauthCount = 0;
  let resolveDone; const done = new Promise((r) => (resolveDone = r));
  api.set_reauthorize(async () => { reauthCount++; resolveDone(); });
  api.define_endpoint("/p", () => {}, HTTP_GET);

  api.call("/p", HTTP_GET);
  await done;
  assert.equal(reauthCount, 1);
});
