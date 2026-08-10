// SPDX-License-Identifier: MIT
// FileEngine embedding kit — metadata model (§7 <fe-metadata>). (c) 2026 James Hickman.
//
// DOM-free, import-free. CRUD over a node's metadata via the injected API client:
// GET /v1/nodes/{uid}/metadata (all), PUT/DELETE /v1/nodes/{uid}/metadata/{key}. A
// successful write reloads the map, so the view always reflects the server.

export const META_ALL_PATH = "/v1/nodes/{uid}/metadata";
export const META_KEY_PATH = "/v1/nodes/{uid}/metadata/{key}";

export class MetadataModel {
  #client;
  #tenant;
  #uid = null;
  #meta = {};
  #loading = false;
  #listeners = [];

  constructor(client, opts = {}) {
    this.#client = client;
    this.#tenant = opts.tenant || "";
    this.#client.define_endpoint(META_ALL_PATH, (payload) => {
      this.#meta = (payload && typeof payload.metadata === "object" && payload.metadata) || {};
      this.#loading = false;
      this.#emit();
    }, "get");
    // A write echoes success -> reload the whole map.
    this.#client.define_endpoint(META_KEY_PATH, () => this.refresh(), "put");
    this.#client.define_endpoint(META_KEY_PATH, () => this.refresh(), "delete");
  }

  get uid() { return this.#uid; }
  get metadata() { return this.#meta; }
  get entries() { return Object.entries(this.#meta).map(([key, value]) => ({ key, value })); }
  get loading() { return this.#loading; }

  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit() {
    const state = { uid: this.#uid, metadata: this.#meta, entries: this.entries, loading: this.#loading };
    for (const fn of this.#listeners.slice()) fn(state);
  }

  #headers() { return this.#tenant ? { "X-Tenant": this.#tenant } : {}; }

  open(uid) {
    if (!uid) { this.#uid = null; this.#meta = {}; this.#loading = false; this.#emit(); return false; }
    this.#uid = uid;
    this.#loading = true;
    this.#emit();
    return this.#list();
  }

  refresh() { return this.#uid ? this.#list() : false; }

  #list() {
    const started = this.#client.call(META_ALL_PATH, "get", undefined, this.#headers(), { uid: this.#uid });
    if (!started) { this.#loading = false; this.#emit(); }
    return started;
  }

  /** Set (create or overwrite) a metadata key. */
  setKey(key, value) {
    if (!this.#uid || !key) return false;
    return this.#client.call(META_KEY_PATH, "put", { value: String(value == null ? "" : value) },
                             this.#headers(), { uid: this.#uid, key });
  }

  /** Delete a metadata key. */
  deleteKey(key) {
    if (!this.#uid || !key) return false;
    return this.#client.call(META_KEY_PATH, "delete", undefined, this.#headers(), { uid: this.#uid, key });
  }
}
