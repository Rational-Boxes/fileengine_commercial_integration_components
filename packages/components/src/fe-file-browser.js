// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-file-browser> (§7). (c) 2026 James Hickman.
//
// À la carte visual component: lists a directory and navigates it. Imports ONLY its own
// model (no other component, not even core) — it discovers the shared <fe-session> at
// runtime and borrows its API client, so importing this module pulls in nothing else
// (§4.3). Events out: `fe:select` (file activated), `fe:navigate` (folder entered).
//
// `extends Base` falls back to a plain class under Node/SSR so the module imports
// without a DOM; the interesting logic lives in FileBrowserModel + the methods below,
// which are unit-testable with an injected provider.

import { FileBrowserModel, isDirectory } from "./file-browser-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeFileBrowser extends Base {
  static get observedAttributes() { return ["folder", "tenant"]; }

  #model = null;
  #provider = null;
  #unsub = null;

  // Host/test hook: set an explicit session provider instead of DOM discovery.
  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }

  connectedCallback() { this.#start(); }
  disconnectedCallback() { if (this.#unsub) this.#unsub(); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.#model) return;
    if (name === "folder") this.#model.open(newValue || "root");
  }

  // Discover the shared <fe-session> provider: nearest element in the tree, else the
  // first in the document. (A JSUM multicall to `fe-session` is the bus-based
  // alternative; a direct lookup is equivalent for a single provider.)
  #discoverProvider() {
    const root = this.getRootNode ? this.getRootNode() : null;
    const el = (root && root.querySelector && root.querySelector("fe-session")) ||
      (typeof document !== "undefined" ? document.querySelector("fe-session") : null);
    return el ? el.getSession() : null;
  }

  #start() {
    const provider = this.provider;
    if (!provider) { this.#renderError("no <fe-session> found"); return; }
    const client = provider.client();
    const tenant = this.getAttribute("tenant") || provider.tenant || "";
    this.#model = new FileBrowserModel(client, { root: this.getAttribute("folder") || "root", tenant });
    this.#unsub = this.#model.onUpdate((s) => this.#render(s));
    this.#model.open();
  }

  // ---- imperative API (methods in) ----
  open(uid) { return this.#model ? this.#model.open(uid) : false; }
  refresh() { return this.#model ? this.#model.refresh() : false; }
  get entries() { return this.#model ? this.#model.entries : []; }

  // Activate an entry: enter a folder, or emit fe:select for a file.
  activate(entry) {
    if (!entry) return;
    if (isDirectory(entry)) {
      this.dispatchEvent(new CustomEvent("fe:navigate", {
        detail: { uid: entry.uid, entry }, bubbles: true, composed: true,
      }));
      if (this.#model) this.#model.open(entry.uid);
    } else {
      this.dispatchEvent(new CustomEvent("fe:select", {
        detail: { uid: entry.uid, entry }, bubbles: true, composed: true,
      }));
    }
  }

  // ---- rendering ----
  #render(state) {
    if (typeof document === "undefined") return;  // SSR/tests: no paint
    const rows = (state.entries || []).map((e) => {
      const icon = isDirectory(e) ? "📁" : "📄";
      const name = String(e.name == null ? "" : e.name);
      return `<li class="fe-fb-row" data-uid="${escapeAttr(e.uid)}" role="button" tabindex="0">` +
        `<span class="fe-fb-ico">${icon}</span><span class="fe-fb-name">${escapeText(name)}</span></li>`;
    }).join("");
    this.innerHTML =
      `<ul class="fe-fb-list">${state.loading ? "<li class='fe-fb-loading'>Loading…</li>" : rows}</ul>`;
    // Event delegation: a row click/Enter activates its entry.
    const list = this.querySelector && this.querySelector(".fe-fb-list");
    if (list && list.addEventListener) {
      list.addEventListener("click", (ev) => this.#onRow(ev, state));
    }
  }

  #onRow(ev, state) {
    const li = ev.target && ev.target.closest && ev.target.closest("[data-uid]");
    if (!li) return;
    const uid = li.getAttribute("data-uid");
    const entry = (state.entries || []).find((e) => String(e.uid) === uid);
    if (entry) this.activate(entry);
  }

  #renderError(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-fb-error">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

export function defineFeFileBrowser(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-file-browser")) registry.define("fe-file-browser", FeFileBrowser);
  return registry;
}

defineFeFileBrowser();
