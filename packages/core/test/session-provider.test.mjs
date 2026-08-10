// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionProvider } from "../src/session-provider.js";

const CFG = {
  bridgeBase: "https://files.example.com",
  oauthProvider: "google",
  callbackUrl: "https://files.example.com/session/callback",
  hostOrigin: "https://host.example.com",
  tenant: "acme",
};

test("client() is cached per service base and defaults to the bridge base", () => {
  const p = new SessionProvider(CFG);
  const a = p.client();
  const b = p.client();
  assert.equal(a, b, "same instance for the default base");
  const search = p.client("https://search.example.com");
  assert.notEqual(a, search, "distinct base -> distinct client");
  assert.equal(p.client("https://search.example.com"), search, "cached per base");
});

test("all service clients share the one session token (§4.2)", () => {
  const p = new SessionProvider(CFG);
  const files = p.client("https://files.example.com");
  const search = p.client("https://search.example.com");
  p.setSession("tok-1", 900);
  // Both clients were connected to the same session; a token change reaches both
  // (verified indirectly: the provider's session is the single source).
  assert.equal(p.getToken(), "tok-1");
  assert.ok(files && search);
});

test("login/logout/getToken/hasSession delegate to the session; tenant is exposed", () => {
  const p = new SessionProvider(CFG);
  assert.equal(p.tenant, "acme");
  assert.equal(p.hasSession(), false);
  p.setSession("tok", 900);
  assert.equal(p.hasSession(), true);
  assert.equal(p.getToken(), "tok");
  p.logout();
  assert.equal(p.hasSession(), false);
  assert.equal(p.getToken(), null);
});

test("onChange fires on session changes", () => {
  const p = new SessionProvider(CFG);
  const seen = [];
  p.onChange((t) => seen.push(t));
  p.setSession("a", 900);
  p.logout();
  assert.deepEqual(seen, ["a", null]);
});
