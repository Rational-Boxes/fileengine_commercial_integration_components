// SPDX-License-Identifier: MIT
// FileEngine embedding kit — comments model (§7 <fe-comments>). (c) 2026 James Hickman.
//
// DOM-free, import-free. Lists a file's discussion threads (GET /files/{uid}/threads),
// opens a new thread (POST), and — via an attached LiveSocket (vended by the session
// provider) — refreshes on live comment/thread events. The socket is injected, so the
// live path is unit-testable with a fake socket.

export const THREADS_PATH = "/files/{uid}/threads";

export class CommentsModel {
  #client;
  #tenant;
  #fileUid = null;
  #threads = [];
  #loading = false;
  #listeners = [];
  #socket = null;
  #unsub = null;

  constructor(client, opts = {}) {
    this.#client = client;
    this.#tenant = opts.tenant || "";
    // Listing: every threads response updates the list.
    this.#client.define_endpoint(THREADS_PATH, (payload) => {
      this.#threads = Array.isArray(payload && payload.threads) ? payload.threads : [];
      this.#loading = false;
      this.#emit();
    }, "get");
    // Posting a new thread -> reload (the WS will also notify other clients).
    this.#client.define_endpoint(THREADS_PATH, () => this.refresh(), "post_json");
  }

  get fileUid() { return this.#fileUid; }
  get threads() { return this.#threads; }
  get loading() { return this.#loading; }

  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit() {
    const state = { fileUid: this.#fileUid, threads: this.#threads, loading: this.#loading };
    for (const fn of this.#listeners.slice()) fn(state);
  }

  /** Attach a LiveSocket-like ({onMessage, connect, close}) for live refresh. */
  attachSocket(socket) {
    this.detachSocket();
    this.#socket = socket;
    this.#unsub = socket.onMessage((msg) => this.#onLive(msg));
    if (socket.connect) socket.connect();
  }

  detachSocket() {
    if (this.#unsub) this.#unsub();
    if (this.#socket && this.#socket.close) this.#socket.close();
    this.#socket = null;
    this.#unsub = null;
  }

  #onLive(msg) {
    const type = (msg && msg.type) || "";
    // A comment/thread event on the open file -> reload the list.
    if (type.startsWith("comment") || type.startsWith("thread")) this.refresh();
  }

  open(uid) {
    if (!uid) { this.#fileUid = null; this.#threads = []; this.#loading = false; this.#emit(); return false; }
    this.#fileUid = uid;
    this.#loading = true;
    this.#emit();
    return this.#list(uid);
  }

  refresh() { return this.#fileUid ? this.#list(this.#fileUid) : false; }

  #list(uid) {
    const headers = this.#tenant ? { "X-Tenant": this.#tenant } : {};
    const started = this.#client.call(THREADS_PATH, "get", undefined, headers, { uid });
    if (!started) { this.#loading = false; this.#emit(); }
    return started;
  }

  /** Open a new thread (an opening comment) on the current file. */
  post(body, opts = {}) {
    if (!this.#fileUid || !body || !String(body).trim()) return false;
    const headers = this.#tenant ? { "X-Tenant": this.#tenant } : {};
    const data = { body, version: opts.version || "", title: opts.title || "" };
    return this.#client.call(THREADS_PATH, "post_json", data, headers, { uid: this.#fileUid });
  }
}
