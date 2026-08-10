// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-uploader> (§7). (c) 2026 James Hickman.
//
// À la carte write-path component: uploads files into a directory (two-step create +
// content). Imports ONLY its own model (§4.3), discovers the shared <fe-session>.
// Attribute: `folder` (target dir uid). Method in: uploadBlob(name, body) / uploadFiles.
// Event out: `fe:upload` (per file, on success) so the host can refresh a browser.

import { UploaderModel } from "./uploader-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeUploader extends Base {
  static get observedAttributes() { return ["folder", "tenant"]; }

  #model = null;
  #provider = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }
  get folder() { return this.getAttribute("folder") || "root"; }
  set folder(uid) { this.setAttribute("folder", uid || "root"); }

  connectedCallback() { this.#start(); }

  #discoverProvider() {
    const root = this.getRootNode ? this.getRootNode() : null;
    const el = (root && root.querySelector && root.querySelector("fe-session")) ||
      (typeof document !== "undefined" ? document.querySelector("fe-session") : null);
    return el ? el.getSession() : null;
  }

  #start() {
    const provider = this.provider;
    if (!provider) { this.#renderMessage("no <fe-session> found"); return; }
    const tenant = this.getAttribute("tenant") || provider.tenant || "";
    this.#model = new UploaderModel(provider, { tenant });
    this.#model.onUpdate((s) => this.#renderStatus(s));
    this.#render();
  }

  // ---- method in ----
  async uploadBlob(name, body) {
    if (!this.#model) return null;
    const result = await this.#model.upload(this.folder, name, body);
    this.dispatchEvent(new CustomEvent("fe:upload", {
      detail: { uid: result.uid, name: result.name, folder: this.folder },
      bubbles: true, composed: true,
    }));
    return result;
  }

  /** Upload a list of File objects (e.g. from an <input type=file>). */
  async uploadFiles(files) {
    const out = [];
    for (const f of Array.from(files || [])) {
      try { out.push(await this.uploadBlob(f.name, f)); }
      catch (e) { this.dispatchEvent(new CustomEvent("fe:upload-error", { detail: { name: f.name, error: String(e) }, bubbles: true, composed: true })); }
    }
    return out;
  }

  // ---- rendering ----
  #render() {
    if (typeof document === "undefined") return;
    this.innerHTML =
      `<div class="fe-up"><label class="fe-up-pick">Upload to <code>${escapeText(this.folder)}</code>` +
      `<input class="fe-up-input" type="file" multiple></label>` +
      `<div class="fe-up-status" aria-live="polite"></div></div>`;
    const input = this.querySelector && this.querySelector(".fe-up-input");
    if (input && input.addEventListener) {
      input.addEventListener("change", (ev) => {
        const files = ev.target && ev.target.files;
        if (files && files.length) this.uploadFiles(files);
      });
    }
  }

  #renderStatus(s) {
    if (typeof document === "undefined") return;
    const box = this.querySelector && this.querySelector(".fe-up-status");
    if (!box) return;
    const msg = s.phase === "done" ? `✓ ${s.name}`
      : s.phase === "error" ? `✗ ${s.name} (${s.step} ${s.status})`
      : s.phase === "uploading" ? `↑ ${s.name}…`
      : `+ ${s.name}…`;
    box.textContent = msg;
  }

  #renderMessage(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-up-msg">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function defineFeUploader(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-uploader")) registry.define("fe-uploader", FeUploader);
  return registry;
}

defineFeUploader();
