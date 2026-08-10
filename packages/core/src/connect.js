// SPDX-License-Identifier: MIT
// FileEngine embedding kit — connect(): bind a SessionManager to an API_REST client. (c) 2026 James Hickman.
//
// Produces a ready-to-use FileEngine API client whose bearer always tracks the
// session, and whose 401 responses auto-drive session.refresh() -> replay (§6.2).

import { API_REST } from "./api.js";

/**
 * @param {import("./session.js").SessionManager} session
 * @param {{host_url?: string, on_error?: Function, ApiClass?: typeof API_REST}} [opts]
 * @returns {API_REST}
 */
export function connect(session, opts = {}) {
  const ApiClass = opts.ApiClass || API_REST;
  const api = new ApiClass(opts.host_url, opts.on_error);

  // 401 -> refresh the session directly against FileEngine, re-arm the bearer,
  // then replay the cached failed call(s). Throwing here lets API_REST clear
  // auth state and surface the error rather than loop.
  api.set_reauthorize(async (client) => {
    await session.refresh();
    client.set_bearer_token(session.getToken());
    client.recall();
  });

  // Keep the client's bearer in lockstep with the session (login/refresh/logout).
  api.set_bearer_token(session.getToken());
  session.onChange((token) => api.set_bearer_token(token));

  return api;
}
