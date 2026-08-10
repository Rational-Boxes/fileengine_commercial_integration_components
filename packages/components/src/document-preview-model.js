// SPDX-License-Identifier: MIT
// FileEngine embedding kit — document-preview model (§7 <fe-document-preview>). (c) 2026 James Hickman.
//
// DOM-free, import-free: given a file uid, lists its renditions (GET
// /v1/files/{uid}/renditions — hidden child files) through the injected API client and
// picks the best preview candidate. Rendering + authenticated byte-fetch live in the
// element; the selection logic here is pure and unit-tested.

export const RENDITIONS_PATH = "/v1/files/{uid}/renditions";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const PDF_RE = /\.pdf$/i;

/** Classify a rendition entry by its name extension. */
export function kindOf(entry) {
  const name = entry && entry.name ? String(entry.name) : "";
  if (IMAGE_RE.test(name)) return "image";
  if (PDF_RE.test(name)) return "pdf";
  return "other";
}

/**
 * Choose the best preview rendition: an image named "preview" wins, then any image,
 * then a PDF, then the first non-directory entry. Returns null when there is nothing.
 */
export function pickPreview(entries) {
  const files = (entries || []).filter((e) => e && e.type !== "directory");
  const namedImage = files.find((e) => /preview/i.test(e.name || "") && IMAGE_RE.test(e.name || ""));
  if (namedImage) return namedImage;
  const anyImage = files.find((e) => IMAGE_RE.test(e.name || ""));
  if (anyImage) return anyImage;
  const pdf = files.find((e) => PDF_RE.test(e.name || ""));
  if (pdf) return pdf;
  return files[0] || null;
}

export class DocumentPreviewModel {
  #client;
  #tenant;
  #fileUid = null;
  #renditions = [];
  #preview = null;
  #loading = false;
  #listeners = [];

  constructor(client, opts = {}) {
    this.#client = client;
    this.#tenant = opts.tenant || "";
    this.#client.define_endpoint(RENDITIONS_PATH, (payload) => {
      this.#renditions = Array.isArray(payload && payload.entries) ? payload.entries : [];
      this.#preview = pickPreview(this.#renditions);
      this.#loading = false;
      this.#emit();
    }, "get");
  }

  get fileUid() { return this.#fileUid; }
  get renditions() { return this.#renditions; }
  get preview() { return this.#preview; }
  get loading() { return this.#loading; }

  onUpdate(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  #emit() {
    const state = { fileUid: this.#fileUid, renditions: this.#renditions, preview: this.#preview, loading: this.#loading };
    for (const fn of this.#listeners.slice()) fn(state);
  }

  /** Load renditions for a file uid. Passing a falsy uid clears the preview. */
  open(uid) {
    if (!uid) {
      this.#fileUid = null; this.#renditions = []; this.#preview = null; this.#loading = false;
      this.#emit();
      return false;
    }
    this.#fileUid = uid;
    this.#loading = true;
    this.#preview = null;
    this.#emit();
    const headers = this.#tenant ? { "X-Tenant": this.#tenant } : {};
    const started = this.#client.call(RENDITIONS_PATH, "get", undefined, headers, { uid });
    if (!started) { this.#loading = false; this.#emit(); }
    return started;
  }
}
