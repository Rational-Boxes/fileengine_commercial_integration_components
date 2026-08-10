// SPDX-License-Identifier: MIT
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session.js";
import { connect } from "../src/connect.js";
import { HTTP_GET } from "../src/api.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const CFG = {
  bridgeBase: "https://files.example.com",
  oauthProvider: "google",
  callbackUrl: "https://files.example.com/session/callback",
  hostOrigin: "https://host.example.com",
};
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bearerOf(req) { return req.headers.get("Authorization"); }

test("the connected client's bearer tracks the session", () => {
  const seen = [];
  globalThis.fetch = async (req) => { seen.push(bearerOf(req)); return jsonResponse({}); };
  const session = new SessionManager(CFG);
  const api = connect(session, { host_url: "http://x", on_error: () => {} });
  api.define_endpoint("/p", () => {}, HTTP_GET);

  session.setSession("tok-1", 900);
  api.call("/p", HTTP_GET);
  assert.equal(seen[0], "Bearer tok-1");
});

test("a 401 refreshes the session and replays the call with the new token", async () => {
  // Session refresh talks to FileEngine via its own injected fetch → tok-2.
  const refreshFetch = async () => ({ ok: true, json: async () => ({ token: "tok-2", expires_in: 900 }) });
  const session = new SessionManager(CFG, { fetchImpl: refreshFetch });
  session.setSession("tok-1", 900);

  // API traffic goes through global fetch: Bearer tok-1 → 401, Bearer tok-2 → 200.
  const bearers = [];
  globalThis.fetch = async (req) => {
    const b = bearerOf(req);
    bearers.push(b);
    if (b === "Bearer tok-1") return jsonResponse({ error: "unauthorized" }, 401);
    return jsonResponse({ ok: true, who: b });
  };

  const api = connect(session, { host_url: "http://x", on_error: (e) => { throw e; } });
  let resolve; const done = new Promise((r) => (resolve = r));
  api.define_endpoint("/p", (payload) => resolve(payload), HTTP_GET);

  api.call("/p", HTTP_GET);
  const payload = await done; // replay fires ~500ms later via recall()
  assert.deepEqual(payload, { ok: true, who: "Bearer tok-2" });
  assert.deepEqual(bearers, ["Bearer tok-1", "Bearer tok-2"]);
  assert.equal(session.getToken(), "tok-2");
});
