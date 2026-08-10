// SPDX-License-Identifier: MIT
// FileEngine embedding kit — search model (§7 <fe-search>). (c) 2026 James Hickman.
//
// DOM-free, import-free. POSTs {query, limit, fuzzy} to the search service's /search
// (a different service base than files — the one token is accepted by all, §4.2) via
// the injected API client, and holds the hit list. Selection/rendering live in the
// element; this logic is pure and unit-tested.

export const SEARCH_PATH = "/search";

export class SearchModel {
  #client;
  #tenant;
  #hits = [];
  #query = "";
  #loading = false;
  #listeners = [];

  constructor(client, opts = {}) {
    this.#client = client;
    this.#tenant = opts.tenant || "";
    this.#client.define_endpoint(SEARCH_PATH, (payload) => {
      this.#hits = Array.isArray(payload && payload.hits) ? payload.hits : [];
      this.#loading = false;
      this.#emit();
    }, "post_json");
  }

  get hits() { return this.#hits; }
  get query() { return this.#query; }
  get loading() { return this.#loading; }

  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit() {
    const state = { hits: this.#hits, query: this.#query, loading: this.#loading };
    for (const fn of this.#listeners.slice()) fn(state);
  }

  /** Run a search. An empty/blank query clears results without a request. */
  search(query, opts = {}) {
    this.#query = query || "";
    if (!query || !String(query).trim()) {
      this.#hits = []; this.#loading = false; this.#emit();
      return false;
    }
    this.#loading = true;
    this.#emit();
    const headers = this.#tenant ? { "X-Tenant": this.#tenant } : {};
    const body = { query, limit: opts.limit || 20, fuzzy: opts.fuzzy !== false };
    const started = this.#client.call(SEARCH_PATH, "post_json", body, headers);
    if (!started) { this.#loading = false; this.#emit(); }
    return started;
  }
}
