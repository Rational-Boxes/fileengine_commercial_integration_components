// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-search> (§7). (c) 2026 James Hickman.
//
// À la carte search component. Imports ONLY its own model (§4.3), discovers the shared
// <fe-session>. Talks to the search service (its own base, via the `endpoint` attribute)
// with the one shared token. Event out: `fe:result-select` (a hit chosen) — the host
// routes it to <fe-document-preview>.open(uid), so search and preview coordinate without
// importing each other.

import { SearchModel } from "./search-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeSearch extends Base {
  static get observedAttributes() { return ["endpoint", "tenant", "placeholder"]; }

  #model = null;
  #provider = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }

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
    // A client bound to the search service base (defaults to the bridge base).
    const client = provider.client(this.getAttribute("endpoint") || provider.base);
    this.#model = new SearchModel(client, { tenant });
    this.#model.onUpdate((s) => this.#render(s));
    this.#render({ hits: [], query: "", loading: false });
  }

  // ---- method in ----
  search(query, opts) { return this.#model ? this.#model.search(query, opts) : false; }
  get hits() { return this.#model ? this.#model.hits : []; }

  selectHit(hit) {
    if (!hit) return;
    this.dispatchEvent(new CustomEvent("fe:result-select", {
      detail: { uid: hit.file_uid, name: hit.name, hit },
      bubbles: true, composed: true,
    }));
  }

  // ---- rendering ----
  #render(state) {
    if (typeof document === "undefined") return;
    const placeholder = this.getAttribute("placeholder") || "Search…";
    const results = state.loading ? `<li class="fe-se-loading">Searching…</li>`
      : (state.hits || []).map((h) =>
          `<li class="fe-se-hit" data-uid="${escapeAttr(h.file_uid)}" role="button" tabindex="0">` +
          `<span class="fe-se-name">${escapeText(h.name || "")}</span>` +
          `<span class="fe-se-snip">${escapeText(h.snippet || "")}</span></li>`).join("")
      || (state.query ? `<li class="fe-se-empty">No results.</li>` : "");
    this.innerHTML =
      `<form class="fe-se"><input class="fe-se-input" type="search" placeholder="${escapeAttr(placeholder)}" ` +
      `value="${escapeAttr(state.query || "")}"><button class="fe-se-go" type="submit">Search</button></form>` +
      `<ul class="fe-se-list">${results}</ul>`;

    const form = this.querySelector && this.querySelector(".fe-se");
    if (form && form.addEventListener) {
      form.addEventListener("submit", (ev) => {
        if (ev.preventDefault) ev.preventDefault();
        const input = this.querySelector(".fe-se-input");
        this.search(input ? input.value : "");
      });
    }
    const list = this.querySelector && this.querySelector(".fe-se-list");
    if (list && list.addEventListener) list.addEventListener("click", (ev) => this.#onHit(ev, state));
  }

  #onHit(ev, state) {
    const li = ev.target && ev.target.closest && ev.target.closest("[data-uid]");
    if (!li) return;
    const uid = li.getAttribute("data-uid");
    const hit = (state.hits || []).find((h) => String(h.file_uid) === uid);
    if (hit) this.selectHit(hit);
  }

  #renderMessage(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-se-msg">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

export function defineFeSearch(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-search")) registry.define("fe-search", FeSearch);
  return registry;
}

defineFeSearch();
