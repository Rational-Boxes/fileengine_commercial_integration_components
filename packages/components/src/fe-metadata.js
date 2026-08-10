// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-metadata> (§7). (c) 2026 James Hickman.
//
// À la carte metadata editor. Imports ONLY its own model (§4.3), discovers <fe-session>.
// Method in: open(uid), setKey/deleteKey. Event out: fe:metadata-change. The `readonly`
// boolean attribute renders the values without edit controls.

import { MetadataModel } from "./metadata-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeMetadata extends Base {
  static get observedAttributes() { return ["uid", "tenant", "readonly"]; }

  #model = null;
  #provider = null;
  #unsub = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }
  get readonly() { return this.hasAttribute && this.hasAttribute("readonly"); }

  connectedCallback() { this.#start(); }
  disconnectedCallback() { if (this.#unsub) this.#unsub(); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.#model) return;
    if (name === "uid") this.open(newValue || "");
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
    this.#model = new MetadataModel(provider.client(), { tenant });
    this.#unsub = this.#model.onUpdate((s) => this.#render(s));
    const uid = this.getAttribute("uid");
    if (uid) this.open(uid); else this.#render({ uid: null, entries: [], loading: false });
  }

  // ---- method in ----
  open(uid) { return this.#model ? this.#model.open(uid) : false; }
  get entries() { return this.#model ? this.#model.entries : []; }

  setKey(key, value) {
    if (!this.#model || this.readonly) return false;
    const started = this.#model.setKey(key, value);
    if (started) this.#emitChange("set", key);
    return started;
  }

  deleteKey(key) {
    if (!this.#model || this.readonly) return false;
    const started = this.#model.deleteKey(key);
    if (started) this.#emitChange("delete", key);
    return started;
  }

  #emitChange(op, key) {
    this.dispatchEvent(new CustomEvent("fe:metadata-change", {
      detail: { uid: this.#model.uid, op, key }, bubbles: true, composed: true,
    }));
  }

  // ---- rendering ----
  #render(state) {
    if (typeof document === "undefined") return;
    if (!state.uid) return this.#renderMessage("Select a node to view its metadata.");
    const rows = (state.entries || []).map((e) =>
      `<li class="fe-md-row"><span class="fe-md-key">${escapeText(e.key)}</span>` +
      `<span class="fe-md-val">${escapeText(e.value)}</span>` +
      (this.readonly ? "" : `<button class="fe-md-del" data-key="${escapeAttr(e.key)}" type="button">✕</button>`) +
      `</li>`).join("") || `<li class="fe-md-empty">No metadata.</li>`;
    const editor = this.readonly ? "" :
      `<form class="fe-md-add"><input class="fe-md-k" placeholder="key">` +
      `<input class="fe-md-v" placeholder="value"><button type="submit">Set</button></form>`;
    this.innerHTML = `<div class="fe-md">${state.loading ? "<p>Loading…</p>" : `<ul class="fe-md-list">${rows}</ul>`}${editor}</div>`;

    const list = this.querySelector && this.querySelector(".fe-md-list");
    if (list && list.addEventListener) {
      list.addEventListener("click", (ev) => {
        const b = ev.target && ev.target.closest && ev.target.closest("[data-key]");
        if (b) this.deleteKey(b.getAttribute("data-key"));
      });
    }
    const form = this.querySelector && this.querySelector(".fe-md-add");
    if (form && form.addEventListener) {
      form.addEventListener("submit", (ev) => {
        if (ev.preventDefault) ev.preventDefault();
        const k = this.querySelector(".fe-md-k"), v = this.querySelector(".fe-md-v");
        const key = k ? k.value.trim() : "";
        if (key) { this.setKey(key, v ? v.value : ""); if (k) k.value = ""; if (v) v.value = ""; }
      });
    }
  }

  #renderMessage(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-md-msg">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

export function defineFeMetadata(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-metadata")) registry.define("fe-metadata", FeMetadata);
  return registry;
}

defineFeMetadata();
