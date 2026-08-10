// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { CommentsModel, THREADS_PATH } from "../src/comments-model.js";

function fakeClient() {
  return {
    endpoints: {}, calls: [],
    define_endpoint(path, cb, verb) { (this.endpoints[verb + "|" + path] ||= []).push(cb); },
    call(path, verb, data, headers, pathVars) { this.calls.push({ path, verb, data, headers, pathVars }); return true; },
    respond(path, verb, payload) { for (const cb of (this.endpoints[verb + "|" + path] || [])) cb(payload); },
  };
}

// A LiveSocket-like fake with a message driver.
function fakeSocket() {
  return {
    handlers: [], connected: false, closed: false,
    onMessage(fn) { this.handlers.push(fn); return () => { this.handlers = this.handlers.filter((f) => f !== fn); }; },
    connect() { this.connected = true; },
    close() { this.closed = true; },
    emit(msg) { this.handlers.slice().forEach((f) => f(msg)); },
  };
}

test("open(uid) lists threads with tenant header + path var", () => {
  const c = fakeClient();
  const m = new CommentsModel(c, { tenant: "acme" });
  m.open("file-1");
  assert.equal(m.loading, true);
  assert.deepEqual(c.calls[0], {
    path: THREADS_PATH, verb: "get", data: undefined,
    headers: { "X-Tenant": "acme" }, pathVars: { uid: "file-1" },
  });
  c.respond(THREADS_PATH, "get", { threads: [{ id: "t1", title: "Hi", opened_by: "alice" }] });
  assert.equal(m.loading, false);
  assert.equal(m.threads.length, 1);
});

test("post() opens a thread via post_json and a created response reloads the list", () => {
  const c = fakeClient();
  const m = new CommentsModel(c);
  m.open("file-1");
  c.respond(THREADS_PATH, "get", { threads: [] });

  const started = m.post("Looks good", { title: "Nit" });
  assert.equal(started, true);
  const postCall = c.calls.find((k) => k.verb === "post_json");
  assert.deepEqual(postCall.data, { body: "Looks good", version: "", title: "Nit" });

  // The post_json callback fires -> refresh() -> a new GET is issued.
  const getsBefore = c.calls.filter((k) => k.verb === "get").length;
  c.respond(THREADS_PATH, "post_json", { id: "t2" });
  const getsAfter = c.calls.filter((k) => k.verb === "get").length;
  assert.equal(getsAfter, getsBefore + 1);
});

test("post() is a no-op without an open file or with a blank body", () => {
  const c = fakeClient();
  const m = new CommentsModel(c);
  assert.equal(m.post("hi"), false);        // no open file
  m.open("f"); c.respond(THREADS_PATH, "get", { threads: [] });
  assert.equal(m.post("   "), false);       // blank
});

test("a live comment/thread event refreshes; unrelated events do not", () => {
  const c = fakeClient();
  const m = new CommentsModel(c);
  const sock = fakeSocket();
  m.open("file-1");
  c.respond(THREADS_PATH, "get", { threads: [] });
  m.attachSocket(sock);
  assert.equal(sock.connected, true);

  const getsBefore = c.calls.filter((k) => k.verb === "get").length;
  sock.emit({ type: "presence.update" });          // unrelated -> no refresh
  assert.equal(c.calls.filter((k) => k.verb === "get").length, getsBefore);
  sock.emit({ type: "comment.created", id: "c9" }); // relevant -> refresh
  assert.equal(c.calls.filter((k) => k.verb === "get").length, getsBefore + 1);
});

test("attachSocket replaces + closes the prior socket; detachSocket closes", () => {
  const c = fakeClient();
  const m = new CommentsModel(c);
  m.open("f"); c.respond(THREADS_PATH, "get", { threads: [] });
  const s1 = fakeSocket(), s2 = fakeSocket();
  m.attachSocket(s1);
  m.attachSocket(s2);
  assert.equal(s1.closed, true);
  m.detachSocket();
  assert.equal(s2.closed, true);
});

test("open('') clears threads and stops listening", () => {
  const c = fakeClient();
  const m = new CommentsModel(c);
  m.open("f"); c.respond(THREADS_PATH, "get", { threads: [{ id: "t" }] });
  assert.equal(m.threads.length, 1);
  assert.equal(m.open(""), false);
  assert.equal(m.threads.length, 0);
  assert.equal(m.fileUid, null);
});
