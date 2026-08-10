// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-document-preview> (§7). (c) 2026 James Hickman.
//
// À la carte visual component: previews a file's rendition. Imports ONLY its own model
// (§4.3) and discovers the shared <fe-session> at runtime. Method in: open(uid) (host
// wires <fe-file-browser>'s `fe:select` to it). Events out: `fe:preview`. The `markup`
// boolean attribute is the opt-in for the annotation overlay (§4.3) — the markup module
// is only ever loaded when present; absent, nothing extra is pulled in.

import { DocumentPreviewModel, kindOf } from "./document-preview-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeDocumentPreview extends Base {
  static get observedAttributes() { return ["uid", "tenant", "markup"]; }

  #model = null;
  #provider = null;
  #unsub = null;
  #objectUrl = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }
  get markup() { return this.hasAttribute && this.hasAttribute("markup"); }

  connectedCallback() { this.#start(); }
  disconnectedCallback() {
    if (this.#unsub) this.#unsub();
    this.#revoke();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.#model) return;
    if (name === "uid") this.#model.open(newValue || "");
  }

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
    this.#model = new DocumentPreviewModel(provider.client(), { tenant });
    this.#unsub = this.#model.onUpdate((s) => this.#render(s));
    const uid = this.getAttribute("uid");
    if (uid) this.#model.open(uid); else this.#render({ fileUid: null, loading: false, preview: null, renditions: [] });
  }

  // ---- method in ----
  open(uid) { return this.#model ? this.#model.open(uid) : false; }
  get preview() { return this.#model ? this.#model.preview : null; }

  #render(state) {
    // Emit for host code regardless of DOM (events are the contract; paint is optional).
    if (!state.loading && state.fileUid) {
      this.dispatchEvent(new CustomEvent("fe:preview", {
        detail: { uid: state.fileUid, preview: state.preview, kind: kindOf(state.preview) },
        bubbles: true, composed: true,
      }));
    }
    if (typeof document === "undefined") return;

    if (!state.fileUid) return this.#renderMessage("Select a file to preview.");
    if (state.loading) return this.#renderMessage("Loading preview…");
    const p = state.preview;
    if (!p) return this.#renderMessage("No preview available for this file.");

    const kind = kindOf(p);
    const meta = `<div class="fe-dp-meta">${escapeText(p.name || "")} · ${kind}` +
      (this.markup ? ` · <span class="fe-dp-markup">markup</span>` : "") + `</div>`;
    this.innerHTML = `<figure class="fe-dp">${meta}<div class="fe-dp-body" data-kind="${kind}"></div></figure>`;

    // Best-effort inline image: fetch the rendition bytes WITH the bearer (an <img src>
    // can't carry Authorization), then show an object URL. Not unit-tested; guarded.
    if (kind === "image") this.#loadImage(p.uid).catch(() => {});
  }

  async #loadImage(renditionUid) {
    const provider = this.provider;
    if (!provider || typeof fetch === "undefined") return;
    const token = provider.getToken && provider.getToken();
    const base = provider.base || "";
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch(`${base}/v1/files/${encodeURIComponent(renditionUid)}/content`, { headers });
    if (!r.ok) return;
    const blob = await r.blob();
    this.#revoke();
    this.#objectUrl = (typeof URL !== "undefined" && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
    const body = this.querySelector && this.querySelector(".fe-dp-body");
    if (body && this.#objectUrl) body.innerHTML = `<img class="fe-dp-img" alt="preview" src="${this.#objectUrl}">`;
  }

  #revoke() {
    if (this.#objectUrl && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
  }

  #renderMessage(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-dp-msg">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function defineFeDocumentPreview(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-document-preview")) registry.define("fe-document-preview", FeDocumentPreview);
  return registry;
}

defineFeDocumentPreview();
