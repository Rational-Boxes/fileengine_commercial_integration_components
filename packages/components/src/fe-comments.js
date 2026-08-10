// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-comments> (§7). (c) 2026 James Hickman.
//
// À la carte live-comments component. Imports ONLY its own model (§4.3); the WebSocket
// companion comes from the session provider (provider.liveSocket), not a direct import.
// Talks to the discussion service (endpoint attribute) with the one shared token.
// Method in: open(uid). Event out: fe:comment (a comment posted from here).

import { CommentsModel } from "./comments-model.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeComments extends Base {
  static get observedAttributes() { return ["uid", "endpoint", "tenant"]; }

  #model = null;
  #provider = null;
  #unsub = null;

  set provider(p) { this.#provider = p; }
  get provider() { return this.#provider || this.#discoverProvider(); }

  connectedCallback() { this.#start(); }
  disconnectedCallback() { if (this.#model) this.#model.detachSocket(); if (this.#unsub) this.#unsub(); }

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

  #discussionBase() { return this.getAttribute("endpoint") || (this.provider && this.provider.base) || ""; }

  #wsUrl(uid) {
    const p = this.provider;
    const wsBase = this.#discussionBase().replace(/^http/, "ws");
    const params = new URLSearchParams({ token: (p && p.getToken && p.getToken()) || "" });
    const tenant = this.getAttribute("tenant") || (p && p.tenant) || "";
    if (tenant) params.set("tenant", tenant);
    return `${wsBase}/files/${encodeURIComponent(uid)}/live?${params.toString()}`;
  }

  #start() {
    const provider = this.provider;
    if (!provider) { this.#renderMessage("no <fe-session> found"); return; }
    const tenant = this.getAttribute("tenant") || provider.tenant || "";
    this.#model = new CommentsModel(provider.client(this.#discussionBase()), { tenant });
    this.#unsub = this.#model.onUpdate((s) => this.#render(s));
    const uid = this.getAttribute("uid");
    if (uid) this.open(uid); else this.#render({ fileUid: null, threads: [], loading: false });
  }

  // ---- method in ----
  open(uid) {
    if (!this.#model) return false;
    this.#model.detachSocket();
    const started = this.#model.open(uid);
    if (uid && this.provider && this.provider.liveSocket) {
      // Live refresh over the WebSocket companion (vended by the session core).
      this.#model.attachSocket(this.provider.liveSocket(this.#wsUrl(uid)));
    }
    return started;
  }

  get threads() { return this.#model ? this.#model.threads : []; }

  post(body, opts) {
    if (!this.#model) return false;
    const started = this.#model.post(body, opts);
    if (started) {
      this.dispatchEvent(new CustomEvent("fe:comment", {
        detail: { uid: this.#model.fileUid, body }, bubbles: true, composed: true,
      }));
    }
    return started;
  }

  // ---- rendering ----
  #render(state) {
    if (typeof document === "undefined") return;
    if (!state.fileUid) return this.#renderMessage("Select a file to see its comments.");
    const list = state.loading ? `<li class="fe-cm-loading">Loading…</li>`
      : (state.threads || []).map((t) =>
          `<li class="fe-cm-thread"><span class="fe-cm-title">${escapeText(t.title || t.body_text || "(comment)")}</span>` +
          `<span class="fe-cm-by">${escapeText(t.opened_by || "")}</span></li>`).join("")
      || `<li class="fe-cm-empty">No comments yet.</li>`;
    this.innerHTML =
      `<div class="fe-cm"><ul class="fe-cm-list">${list}</ul>` +
      `<form class="fe-cm-compose"><input class="fe-cm-input" placeholder="Add a comment…">` +
      `<button type="submit">Post</button></form></div>`;
    const form = this.querySelector && this.querySelector(".fe-cm-compose");
    if (form && form.addEventListener) {
      form.addEventListener("submit", (ev) => {
        if (ev.preventDefault) ev.preventDefault();
        const input = this.querySelector(".fe-cm-input");
        const v = input ? input.value.trim() : "";
        if (v) { this.post(v); if (input) input.value = ""; }
      });
    }
  }

  #renderMessage(msg) {
    if (typeof document === "undefined") return;
    this.innerHTML = `<div class="fe-cm-msg">${escapeText(msg)}</div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function defineFeComments(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-comments")) registry.define("fe-comments", FeComments);
  return registry;
}

defineFeComments();
