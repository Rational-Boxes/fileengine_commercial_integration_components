// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-download> (§7). (c) 2026 James Hickman.
//
// À la carte download button. Imports ONLY its own helper (§4.3), discovers <fe-session>.
// Method in: download(uid?). Events out: fe:download (saved), fe:download-error. The
// authenticated fetch (bearer) is in download.js; the element wires the browser save.

import { fetchContent } from "./download.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeDownload extends Base {
  static get observedAttributes() { return ["uid", "label"]; }

  #provider = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }

  connectedCallback() { this.#render(); }
  attributeChangedCallback() { if (this.isConnected) this.#render(); }

  #discoverProvider() {
    const root = this.getRootNode ? this.getRootNode() : null;
    const el = (root && root.querySelector && root.querySelector("fe-session")) ||
      (typeof document !== "undefined" ? document.querySelector("fe-session") : null);
    return el ? el.getSession() : null;
  }

  // ---- method in ----
  async download(uid = this.getAttribute("uid")) {
    if (!uid) return null;
    const provider = this.provider;
    if (!provider) { this.dispatchEvent(this.#err(uid, "no <fe-session> found")); return null; }
    try {
      const { blob, filename } = await fetchContent(provider, uid);
      this.#save(blob, filename);
      this.dispatchEvent(new CustomEvent("fe:download", {
        detail: { uid, filename }, bubbles: true, composed: true,
      }));
      return { filename };
    } catch (e) {
      this.dispatchEvent(this.#err(uid, String(e && e.message ? e.message : e)));
      return null;
    }
  }

  #err(uid, error) {
    return new CustomEvent("fe:download-error", { detail: { uid, error }, bubbles: true, composed: true });
  }

  // Trigger a browser save from a blob (guarded for non-DOM environments/tests).
  #save(blob, filename) {
    if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    if (document.body) document.body.appendChild(a);
    if (a.click) a.click();
    if (a.remove) a.remove();
    if (URL.revokeObjectURL) URL.revokeObjectURL(url);
  }

  #render() {
    if (typeof document === "undefined") return;
    const label = this.getAttribute("label") || "Download";
    const uid = this.getAttribute("uid");
    this.innerHTML = `<button class="fe-dl-btn" type="button" ${uid ? "" : "disabled"}>${escapeText(label)}</button>`;
    const btn = this.querySelector && this.querySelector(".fe-dl-btn");
    if (btn && btn.addEventListener) btn.addEventListener("click", () => this.download());
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function defineFeDownload(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-download")) registry.define("fe-download", FeDownload);
  return registry;
}

defineFeDownload();
