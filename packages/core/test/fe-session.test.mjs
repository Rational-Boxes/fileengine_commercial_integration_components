// SPDX-License-Identifier: MIT
// Exercises the <fe-session> custom element via a minimal DOM shim (no browser dep).
// Globals must be installed BEFORE importing the module, because `extends Base`
// resolves HTMLElement at import time.
import { test, before } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor() { this._attrs = new Map(); this._listeners = {}; }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
  get isConnected() { return true; }
}

let FeSession, defineFeSession;

before(async () => {
  globalThis.HTMLElement = FakeElement;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) {
      this.type = type; this.detail = init.detail;
      this.bubbles = !!init.bubbles; this.composed = !!init.composed;
    }
  };
  globalThis.location = { origin: "https://host.example.com" };
  ({ FeSession, defineFeSession } = await import("../src/fe-session.js"));
});

function mount() {
  const el = new FeSession();
  el.setAttribute("base", "https://files.example.com");
  el.setAttribute("tenant", "acme");
  el.setAttribute("host-origin", "https://host.example.com");
  el.connectedCallback();
  return el;
}

test("connectedCallback builds a provider exposing tenant + base config", () => {
  const el = mount();
  const provider = el.getSession();
  assert.ok(provider);
  assert.equal(provider.tenant, "acme");
});

test("client() defaults to the bridge base and is cached; distinct base -> distinct client", () => {
  const el = mount();
  const a = el.client();
  assert.equal(el.client(), a);
  assert.notEqual(el.client("https://search.example.com"), a);
});

test("session changes emit a bubbling/composed fe:session event", () => {
  const el = mount();
  const events = [];
  el.addEventListener("fe:session", (e) => events.push(e));
  el.getSession().setSession("tok", 900);
  el.getSession().logout();
  assert.equal(events.length, 2);
  assert.equal(events[0].detail.active, true);
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
  assert.equal(events[1].detail.active, false);
  assert.equal(el.getToken(), null);
});

test("observedAttributes lists the session-defining attributes", () => {
  assert.deepEqual(FeSession.observedAttributes,
    ["base", "tenant", "oauth-provider", "callback-url", "host-origin"]);
});

test("defineFeSession registers once and is idempotent", () => {
  const defs = new Map();
  const registry = { get: (n) => defs.get(n), define: (n, c) => defs.set(n, c) };
  defineFeSession(registry);
  assert.equal(defs.get("fe-session"), FeSession);
  defineFeSession(registry); // must not throw or redefine
  assert.equal(defs.size, 1);
});
