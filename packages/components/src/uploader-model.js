// SPDX-License-Identifier: MIT
// FileEngine embedding kit — uploader model (§7 <fe-uploader>). (c) 2026 James Hickman.
//
// Two-step upload (§7): POST /v1/dirs/{uid}/files {name} to create the node, then
// PUT /v1/files/{uid}/content with the raw bytes. API_REST JSON-stringifies PUT bodies,
// so binary content goes through an authenticated fetch directly (like the preview's
// blob fetch). Import-free; the session provider is duck-typed (base/getToken/tenant),
// and fetch is injectable, so this is fully unit-testable.

export class UploaderModel {
  #provider;
  #fetch;
  #tenant;
  #listeners = [];

  /**
   * @param {{base?: string, tenant?: string, getToken?: Function}} provider
   * @param {{fetchImpl?: Function, tenant?: string}} [opts]
   */
  constructor(provider, opts = {}) {
    this.#provider = provider;
    // Wrap the global fetch so `this.#fetch(...)` invokes it with the global as `this`
    // (a bare stored reference would set `this` to this model -> "Illegal invocation").
    this.#fetch = opts.fetchImpl ||
      (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
        ? (...args) => globalThis.fetch(...args)
        : undefined);
    this.#tenant = opts.tenant || (provider && provider.tenant) || "";
  }

  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit(state) { for (const fn of this.#listeners.slice()) fn(state); }

  #headers(extra) {
    const h = Object.assign({}, extra);
    const token = this.#provider && this.#provider.getToken && this.#provider.getToken();
    if (token) h["Authorization"] = "Bearer " + token;
    if (this.#tenant) h["X-Tenant"] = this.#tenant;
    return h;
  }

  /**
   * Upload a file into a directory: create the node, then stream the bytes.
   * Emits progress ({phase: creating|uploading|done|error, ...}); resolves with
   * {phase:'done', uid, name} or throws on failure.
   * @param {string} parentUid  target directory uid
   * @param {string} name       file name
   * @param {Blob|ArrayBuffer|Uint8Array|string} body  file content
   */
  async upload(parentUid, name, body) {
    const base = (this.#provider && this.#provider.base) || "";
    this.#emit({ phase: "creating", name });

    const createRes = await this.#fetch(`${base}/v1/dirs/${encodeURIComponent(parentUid)}/files`, {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) {
      const err = { phase: "error", step: "create", status: createRes.status, name };
      this.#emit(err);
      throw new Error("create failed: " + createRes.status);
    }
    const created = await createRes.json();
    const uid = created && created.uid;

    this.#emit({ phase: "uploading", name, uid });
    const putRes = await this.#fetch(`${base}/v1/files/${encodeURIComponent(uid)}/content`, {
      method: "PUT",
      headers: this.#headers(),
      body,
    });
    if (!putRes.ok) {
      const err = { phase: "error", step: "content", status: putRes.status, name, uid };
      this.#emit(err);
      throw new Error("content failed: " + putRes.status);
    }

    const done = { phase: "done", name, uid };
    this.#emit(done);
    return done;
  }
}
