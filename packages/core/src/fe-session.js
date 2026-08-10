// SPDX-License-Identifier: MIT
// FileEngine embedding kit — <fe-session> custom element (§4.1, §7). (c) 2026 James Hickman.
//
// Non-visual session/context provider. Holds the token + shared API clients and is
// discovered by sibling components over the JSUM bus (multicall to `fe-session`) — so
// à la carte modules stay decoupled (§4.3, §8). Events out (`fe:session`), methods in
// (login/logout/getSession/client). The heavy lifting lives in SessionProvider; this
// shell only maps attributes -> config and bridges DOM events.
//
// `extends Base` resolves HTMLElement at import; under Node/SSR/tests (no DOM) it falls
// back to a plain class so importing the module never throws. Registration is a no-op
// where customElements is absent.

import { SessionProvider } from "./session-provider.js";

const Base = (typeof HTMLElement !== "undefined") ? HTMLElement : class {};

export class FeSession extends Base {
  static get observedAttributes() {
    return ["base", "tenant", "oauth-provider", "callback-url", "host-origin"];
  }

  #provider = null;

  connectedCallback() { this.#ensure(); }

  attributeChangedCallback(name, oldValue, newValue) {
    // A change to session-defining attributes rebuilds the provider; a bare tenant
    // change does not (the token is tenant-scoped at mint, tenant travels as a header).
    if (oldValue === newValue || !this.#provider) return;
    if (name !== "tenant") { this.#provider = null; this.#ensure(); }
  }

  #config() {
    const base = this.getAttribute("base") || "";
    const hostOrigin = this.getAttribute("host-origin") ||
      (typeof location !== "undefined" ? location.origin : "");
    return {
      bridgeBase: base,
      oauthProvider: this.getAttribute("oauth-provider") || "google",
      callbackUrl: this.getAttribute("callback-url") || (base + "/session/callback"),
      hostOrigin,
      tenant: this.getAttribute("tenant") || "",
    };
  }

  #ensure() {
    if (this.#provider) return this.#provider;
    this.#provider = new SessionProvider(this.#config());
    this.#provider.onChange((token) => this.dispatchEvent(new CustomEvent("fe:session", {
      detail: { active: !!token }, bubbles: true, composed: true,
    })));
    return this.#provider;
  }

  // ---- host / JSUM-discoverable API ----
  getSession() { return this.#ensure(); }                     // returns the SessionProvider
  client(serviceBase) { return this.#ensure().client(serviceBase); }
  login(opts) { return this.#ensure().login(opts); }
  logout() { if (this.#provider) this.#provider.logout(); }
  getToken() { return this.#provider ? this.#provider.getToken() : null; }
  get tenant() { return this.getAttribute("tenant") || ""; }
}

// Register <fe-session>. Idempotent and safe to call where customElements is absent.
export function defineFeSession(registry =
    (typeof customElements !== "undefined" ? customElements : null)) {
  if (registry && !registry.get("fe-session")) registry.define("fe-session", FeSession);
  return registry;
}
