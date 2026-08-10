// SPDX-License-Identifier: MIT
// FileEngine embedding kit — SessionProvider (§4.1 session core). (c) 2026 James Hickman.
//
// The DOM-free heart of <fe-session>: one SessionManager plus a cache of per-service
// API_REST clients (files/search/discussion/bcf all share the one token — §4.2). Kept
// separate from the custom element so the wiring is unit-testable without a browser.

import { SessionManager } from "./session.js";
import { connect } from "./connect.js";

export class SessionProvider {
  #session;
  #clients = new Map();   // service base URL -> connected API_REST
  #connect;
  #config;

  /**
   * @param {import("./session.js").SessionConfig & {tenant?: string}} config
   * @param {{win?: any, fetchImpl?: Function, connect?: Function}} [deps]
   */
  constructor(config, deps = {}) {
    this.#config = config;
    this.#session = new SessionManager(config, deps);
    this.#connect = deps.connect || connect;
  }

  get session() { return this.#session; }
  get tenant() { return this.#config.tenant || ""; }

  /**
   * A connected API client for a FileEngine service. All services accept the one
   * bridge token (§4.2), so each client shares this provider's session — its bearer
   * tracks login/refresh and a 401 auto-refreshes + replays. Cached per base URL.
   * @param {string} [serviceBase] defaults to the bridge base.
   * @returns {import("./api.js").API_REST}
   */
  client(serviceBase) {
    const base = serviceBase || this.#config.bridgeBase;
    if (!this.#clients.has(base)) {
      this.#clients.set(base, this.#connect(this.#session, { host_url: base }));
    }
    return this.#clients.get(base);
  }

  login(opts) { return this.#session.login(opts); }
  logout() { this.#session.logout(); }
  getToken() { return this.#session.getToken(); }
  hasSession() { return this.#session.hasSession(); }
  setSession(token, expiresIn) { this.#session.setSession(token, expiresIn); }
  onChange(fn) { return this.#session.onChange(fn); }
}
