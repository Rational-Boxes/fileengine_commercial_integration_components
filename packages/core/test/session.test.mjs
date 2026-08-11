// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session.js";

function fakeWin() {
  const listeners = {};
  return {
    opened: [],
    popupResult: {}, // truthy = popup opened
    crypto: { randomUUID: () => "nonce-1" },
    open(url) { this.opened.push(url); return this.popupResult; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    listenerCount(type) { return (listeners[type] || []).length; },
    emit(type, ev) { (listeners[type] || []).slice().forEach((fn) => fn(ev)); },
  };
}

const CFG = {
  bridgeBase: "https://files.example.com",
  oauthProvider: "google",
  callbackUrl: "https://files.example.com/session/callback",
  hostOrigin: "https://host.example.com",
};

test("login opens the OAuth popup with return_to + state", async () => {
  const win = fakeWin();
  const sm = new SessionManager(CFG, { win });
  sm.login();
  assert.equal(win.opened.length, 1);
  const u = new URL(win.opened[0]);
  assert.equal(u.pathname, "/v1/auth/oauth/google");
  assert.equal(u.searchParams.get("return_to"), CFG.callbackUrl);
  assert.equal(u.searchParams.get("state"), "nonce-1");
});

test("login resolves with the token from a valid postMessage", async () => {
  const win = fakeWin();
  const sm = new SessionManager(CFG, { win });
  const p = sm.login();
  win.emit("message", {
    origin: CFG.hostOrigin,
    data: { source: "fe-oauth", token: "tok-123", expires_in: 900, state: "nonce-1" },
  });
  const tok = await p;
  assert.equal(tok, "tok-123");
  assert.ok(sm.hasSession());
  assert.equal(win.listenerCount("message"), 0); // handler removed
});

test("login ignores messages from a foreign origin", async () => {
  const win = fakeWin();
  const sm = new SessionManager(CFG, { win });
  const p = sm.login();
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  win.emit("message", {
    origin: "https://evil.example.com",
    data: { source: "fe-oauth", token: "attacker", state: "nonce-1" },
  });
  await Promise.resolve();
  assert.equal(settled, false);        // still pending
  assert.equal(sm.getToken(), null);   // attacker token not accepted
});

test("login ignores a mismatched state nonce", async () => {
  const win = fakeWin();
  const sm = new SessionManager(CFG, { win });
  const p = sm.login();
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  win.emit("message", {
    origin: CFG.hostOrigin,
    data: { source: "fe-oauth", token: "x", state: "wrong-nonce" },
  });
  await Promise.resolve();
  assert.equal(settled, false);
});

test("login rejects when the popup is blocked", async () => {
  const win = fakeWin();
  win.popupResult = null;
  const sm = new SessionManager(CFG, { win });
  await assert.rejects(sm.login(), /popup blocked/);
});

test("refresh updates the token via a direct FileEngine call", async () => {
  const win = fakeWin();
  let calledUrl, authHeader;
  const fetchImpl = async (url, opts) => {
    calledUrl = url; authHeader = opts.headers.Authorization;
    return { ok: true, json: async () => ({ token: "tok-2", expires_in: 900 }) };
  };
  const sm = new SessionManager(CFG, { win, fetchImpl });
  sm.setSession("tok-1", 900);
  const t = await sm.refresh();
  assert.equal(t, "tok-2");
  assert.equal(calledUrl, "https://files.example.com/v1/auth/refresh");
  assert.equal(authHeader, "Bearer tok-1");
});

test("refresh throws on non-ok and with no session", async () => {
  const sm = new SessionManager(CFG, { win: fakeWin(), fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(sm.refresh(), /no session/);
  sm.setSession("tok-1", 900);
  await assert.rejects(sm.refresh(), /refresh failed: 401/);
});

test("handoff mints a one-time code from the current session", async () => {
  let calledUrl, authHeader;
  const fetchImpl = async (url, opts) => {
    calledUrl = url; authHeader = opts.headers.Authorization;
    return { ok: true, json: async () => ({ code: "hc-123", expires_in: 60 }) };
  };
  const sm = new SessionManager(CFG, { win: fakeWin(), fetchImpl });
  sm.setSession("tok-1", 900);
  const out = await sm.handoff();
  assert.deepEqual(out, { code: "hc-123", expires_in: 60 });
  assert.equal(calledUrl, "https://files.example.com/v1/auth/sso/handoff");
  assert.equal(authHeader, "Bearer tok-1");
});

test("handoff throws with no session and on non-ok", async () => {
  const sm = new SessionManager(CFG, { win: fakeWin(), fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(sm.handoff(), /no session/);
  sm.setSession("tok-1", 900);
  await assert.rejects(sm.handoff(), /handoff failed: 401/);
});

test("logout clears the session", () => {
  const sm = new SessionManager(CFG, { win: fakeWin() });
  sm.setSession("t", 900);
  assert.ok(sm.hasSession());
  sm.logout();
  assert.equal(sm.hasSession(), false);
  assert.equal(sm.getToken(), null);
});
