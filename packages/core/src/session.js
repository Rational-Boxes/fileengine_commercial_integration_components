// SPDX-License-Identifier: MIT
// FileEngine embedding kit — SessionManager (§5, §6). (c) 2026 James Hickman.
//
// Holds the end-user session token in memory and drives the popup-OAuth handshake
// (§5.1) and refresh (§6.2). No mandatory server: the popup callback is hosted on the
// FileEngine edge and posts the token back; refresh is a direct call to FileEngine.
// Dependencies (window, fetch) are injectable so the state machine is unit-testable.

/**
 * @typedef {Object} SessionConfig
 * @property {string} bridgeBase       FileEngine base URL (e.g. https://files.example.com)
 * @property {string} oauthProvider    OAuth provider id (e.g. "google")
 * @property {string} callbackUrl      Allow-listed edge callback that postMessages the token
 * @property {string} hostOrigin       This host page's origin — the only trusted postMessage source
 * @property {string} [refreshPath]    default "/v1/auth/refresh"
 * @property {string} [logoutPath]     default "/v1/auth/token"
 * @property {string} [tenant]         optional X-Tenant
 */

export class SessionManager {
  #token = null;
  #expiresAt = 0;
  #cfg;
  #win;
  #fetch;
  #listeners = [];

  /**
   * @param {SessionConfig} cfg
   * @param {{win?: any, fetchImpl?: Function}} [deps]
   */
  constructor(cfg, deps = {}) {
    this.#cfg = { refreshPath: "/v1/auth/refresh", logoutPath: "/v1/auth/token", ...cfg };
    this.#win = deps.win || (typeof window !== "undefined" ? window : undefined);
    this.#fetch = deps.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  }

  getToken() { return this.#token; }
  hasSession() { return !!this.#token; }
  /** ms until expiry (may be negative). */
  msUntilExpiry() { return this.#expiresAt - Date.now(); }

  setSession(token, expiresIn) {
    this.#token = token || null;
    this.#expiresAt = token ? Date.now() + Number(expiresIn || 0) * 1000 : 0;
    for (const fn of this.#listeners.slice()) fn(this.#token);
  }

  /**
   * Subscribe to token changes (login / refresh / logout). Fires with the new
   * token (or null). Returns an unsubscribe function. Used by connect() to keep
   * an API client's bearer in sync.
   * @param {(token: string|null) => void} fn
   */
  onChange(fn) {
    this.#listeners.push(fn);
    return () => { this.#listeners = this.#listeners.filter((f) => f !== fn); };
  }

  logout() { this.setSession(null, 0); }

  /**
   * Popup-OAuth login (§5.1). Opens the FileEngine OAuth start in a popup; resolves
   * with the captured token when the edge callback postMessages it back. The host page
   * is never unloaded. Rejects on error / a closed popup.
   * @param {{state?: string}} [opts]
   * @returns {Promise<string>} the session token
   */
  login(opts = {}) {
    const win = this.#win;
    if (!win) return Promise.reject(new Error("no window"));
    const nonce = opts.state || (win.crypto?.randomUUID?.() ?? String(Math.random()));
    const url = new URL(this.#cfg.bridgeBase + "/v1/auth/oauth/" + this.#cfg.oauthProvider);
    url.searchParams.set("return_to", this.#cfg.callbackUrl);
    url.searchParams.set("state", nonce);

    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.origin !== this.#cfg.hostOrigin) return;          // pin origin
        const d = e.data;
        if (!d || d.source !== "fe-oauth") return;              // our message only
        if (d.state && d.state !== nonce) return;               // nonce (when echoed)
        win.removeEventListener("message", handler);
        if (d.token) { this.setSession(d.token, d.expires_in); resolve(this.#token); }
        else reject(new Error(d.error || "no token in callback"));
      };
      win.addEventListener("message", handler);
      const popup = win.open(url.toString(), "fe-signin", "width=520,height=640");
      if (!popup) {
        win.removeEventListener("message", handler);
        reject(new Error("popup blocked"));
      }
    });
  }

  /**
   * Refresh the session directly against FileEngine (§6.2) — no relay. Used by the
   * API client's 401→re-auth→replay flow. Updates the in-memory token.
   * @returns {Promise<string>}
   */
  async refresh() {
    if (!this.#token) throw new Error("no session to refresh");
    const r = await this.#fetch(this.#cfg.bridgeBase + this.#cfg.refreshPath, {
      method: "POST",
      headers: { Authorization: "Bearer " + this.#token },
    });
    if (!r.ok) throw new Error("refresh failed: " + r.status);
    const d = await r.json();
    this.setSession(d.token, d.expires_in);
    return this.#token;
  }
}
