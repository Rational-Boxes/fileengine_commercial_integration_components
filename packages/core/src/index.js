// SPDX-License-Identifier: MIT
// FileEngine embedding kit — core barrel. (c) 2026 James Hickman.
export { multicall, clear_cache_for, init_hydration_lifecycle } from "./jsum.js";
export { API_REST, HTTP_GET, HTTP_POST_FORM, HTTP_POST_JSON, HTTP_DELETE, HTTP_PUT } from "./api.js";
export { SessionManager } from "./session.js";
export { connect } from "./connect.js";
export { SessionProvider } from "./session-provider.js";
export { FeSession, defineFeSession } from "./fe-session.js";

// Register <fe-session> on import of the core barrel (§8: `import '@fileengine/embed/core'`
// registers it). No-op under Node/SSR where customElements is absent.
import { defineFeSession as _defineFeSession } from "./fe-session.js";
_defineFeSession();
export { bearer_handler } from "./jwt_relay.js";
