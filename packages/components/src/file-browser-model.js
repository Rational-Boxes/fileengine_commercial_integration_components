// SPDX-License-Identifier: MIT
// FileEngine embedding kit — file-browser model (§7 <fe-file-browser>). (c) 2026 James Hickman.
//
// DOM-free directory-listing state machine driven by an injected API client (the one
// published by <fe-session>). No imports — the client contract is duck-typed
// (define_endpoint/call, API_REST) so this stays decoupled from core and testable with
// a fake client. The API client's callback model (define once, call to trigger) is used
// directly, so a 401 mid-navigation is transparently refreshed + replayed by API_REST.

export const DIRS_PATH = "/v1/dirs/{uid}";

export function isDirectory(entry) {
  return !!(entry && (entry.type === "directory" || entry.type === "symlink"));
}

export class FileBrowserModel {
  #client;
  #tenant;
  #entries = [];
  #currentUid;
  #loading = false;
  #error = null;
  #listeners = [];

  /**
   * @param {{define_endpoint: Function, call: Function}} client  an API_REST (from the session provider)
   * @param {{root?: string, tenant?: string}} [opts]
   */
  constructor(client, opts = {}) {
    this.#client = client;
    this.#currentUid = opts.root || "root";
    this.#tenant = opts.tenant || "";
    // Register the listing endpoint once; its callback lands every dir response.
    client.define_endpoint(DIRS_PATH, (payload) => {
      this.#entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
      this.#loading = false;
      this.#error = null;
      this.#emit();
    }, "get");
  }

  get entries() { return this.#entries; }
  get currentUid() { return this.#currentUid; }
  get loading() { return this.#loading; }
  get error() { return this.#error; }

  /** Subscribe to state changes; returns an unsubscribe function. */
  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit() {
    const state = { entries: this.#entries, currentUid: this.#currentUid, loading: this.#loading, error: this.#error };
    for (const fn of this.#listeners.slice()) fn(state);
  }

  /**
   * Load a directory's entries. Sets loading immediately, then entries when the
   * response lands. Returns false if API_REST deduped an identical in-flight request.
   */
  open(uid = this.#currentUid) {
    this.#currentUid = uid;
    this.#loading = true;
    this.#emit();
    const headers = this.#tenant ? { "X-Tenant": this.#tenant } : {};
    const started = this.#client.call(DIRS_PATH, "get", undefined, headers, { uid });
    if (!started) { this.#loading = false; this.#emit(); }  // already in flight
    return started;
  }

  /** Reload the current directory. */
  refresh() { return this.open(this.#currentUid); }
}
