# FileEngine Embedding Kit — Specification

MIT-licensed, embeddable, à la carte **end-user** document functionality for
third-party ("host") commercial applications, built as dependency-free W3C Web
Components plus a minimal Node/Express **session bridge**.

---

## 1. Vision (original intent, preserved)

An embeddable front-end and minimal server integration, MIT-licensed, so a
commercial host application can drop granular FileEngine functionality into its
own pages. Front-end components use **only W3C Web Components** (no framework).
A small self-contained REST + auth interface backs them. A minimal Node/Express
**backend bridge** negotiates the user session to the FileEngine stack; the
FileEngine CORS configuration must allow the host origin to reach the REST APIs.
The **JSUM** message bus coordinates independently-embedded components so the
host can compose granular functionality. Theming is integrator-supplied (theme
modules), with default light/dark prototypes. The `to-migrate/` sources are the
author's own code, re-licensed MIT, and are the foundation for the embedded REST
and session modules.

---

## 2. Scope & governing boundary

**Embed kit = end-user document work only.** All *configuration and
administrative* functionality stays in the official FileEngine client (the AGPL
Vue SPA): ACL/permission editing, folder_actions bindings, classifier-set and
notify/webhook editing, tenant & user admin, security rules, and audit.

Some capabilities are **split**, not all-or-nothing — the kit exposes the
end-user half; the official client keeps the governance half:

| Capability | In the embed kit (end-user) | Stays in official client (admin) |
|---|---|---|
| Permissions / ACL | *Read-only* view of who-can-do-what (optional) | Grant/revoke, recursive cascade, principal picker |
| Reviews | Request a review, respond (approve/reject/ack) | Automation that *raises* reviews (folder_actions) |
| Folder actions | (nothing) | Bindings, routes, run log |
| Classifiers / templates | (nothing) | Classifier-set + notify/email template editors |
| Metadata | Read/write per-document key/values | — |
| Search / chat | Run search, RAG chat | MCP integration config, model/admin settings |
| Profile / auth | Handled by the **session bridge**, not shipped as components | 2FA policy, user provisioning |

Non-goals: no tenant administration, no user/role management, no audit/security
UI, no classifier or automation authoring.

---

## 3. Licensing

- **Embed kit: MIT.** Clean-room reimplementation of end-user flows against the
  **public REST APIs**. It must **never** import, copy, or derive from the AGPL
  Vue SPA source. Behaviour/endpoints are the contract; code is original.
- **Official client: AGPL** (unchanged).
- **`to-migrate/` re-license:** `jsum.js`, `API.js`, `jwt_relay.js` (author's own
  work) are re-headered MIT and become the kit's core (`packages/core`). Ship a
  top-level `LICENSE` (MIT) and per-file SPDX headers.
- A short `NOTICE`/`ATTRIBUTION.md` records provenance and the AGPL/MIT split so
  downstream integrators understand what they may relicense.

---

## 4. Architecture

```
Host application page
 ├─ <fe-session> ................ non-visual session/context provider (holds token + API clients)
 ├─ <fe-file-browser> ........... à la carte Web Components, each its own ES module
 ├─ <fe-document-preview> ....... coordinate via the JSUM message bus (multicall)
 ├─ <fe-comments> / <fe-chat> ...
 └─ ...                           theme via CSS custom properties + ::part()
        │ Bearer JWT (memory)                 ▲ postMessage token handshake
        ▼ direct HTTPS + WS                   │
FileEngine services (CORS allows host origin) │
 :8090 files · :8092 search/RAG · :8094 ──────┘
 discussion · :8098 BCF · :8099 folder_actions
        ▲ mint / refresh (handshake only)
        │
Node/Express session bridge (this repo) ── OAuth popup/iframe ── FileEngine IdP
```

### 4.1 Layers

1. **Web Components (UI)** — one custom element per capability, prefix `fe-`.
   Independently importable; no hard cross-module dependencies.
2. **Module API clients** — thin wrappers over `API_REST` (fetch, dedup,
   Bearer, 401→re-auth→replay) + a **WebSocket companion** for the two live
   channels (RAG chat, discussion-live). Each service (files/search/discussion/
   bcf) has its own typed client module.
3. **Session core** (`<fe-session>` + `SessionManager`) — the single shared
   dependency: holds the token, the refresh handler, tenant, base URLs, and a
   registry the components discover via the message bus.
4. **Session bridge (Node/Express)** — mints/refreshes the token; does **not**
   proxy data by default (see 6.3 for the optional proxy profile).

### 4.2 One token, whole stack

A single bridge-issued **HS256 JWT** (shared `FILEENGINE_JWT_SECRET`) is accepted
by files (:8090), search/RAG (:8092), discussion (:8094), BCF (:8098), and
folder_actions (:8099). The kit obtains **one** token and forwards it as
`Authorization: Bearer <jwt>` (+ `X-Tenant` when needed) to every service. No
per-service login.

### 4.3 À la carte modularity (hard requirement)

An integrator may want *only* core documents — no AI, no PDF markup, no
AEC/CAD/CAM/BIM. Therefore:

- **Front-end:** every component ships as an independent ES module with no
  static import of another capability. `import '@fileengine/embed/file-browser'`
  must not pull in chat, 3D, or BCF. The only shared import is the session core.
  Tree-shakeable; a CDN build offers per-module URLs.
- **Message bus, not imports:** inter-component coordination is **loose**, over
  JSUM `multicall()` — a component that isn't on the page is simply never called;
  nothing breaks. No component may hard-fail if a sibling capability is absent.
- **Feature capabilities are opt-in per component** via boolean attributes
  (e.g. `<fe-document-preview markup>` enables the annotation overlay; without it
  the markup module is never loaded). AI, markup, and 3D are all such opt-ins.
- **Defense in depth at the bridge (optional):** the bridge's `MODULES` config
  gates which upstream services it will help reach. In **proxy mode** (6.3) a
  disabled module's routes return 404 — a crafted request can't reach, e.g., the
  AI service even if the component were force-loaded. In thin-bridge mode the
  equivalent lever is not CORS-allow-listing the host origin on that service.
- **Server-side truth:** module selection is a UX/attack-surface decision, never
  the security boundary — the JWT's roles + core ACLs remain authoritative.

### 4.4 Component / bundle catalog

Components are grouped for planning; each is still independently selectable.
Endpoints below are the concrete contract (base path per service).

**Bundle A — Core documents** (`VITE`-free; files :8090, some csai text)
- `<fe-file-browser>` — navigate/list; `GET /v1/dirs/{uid}`, mkdir
  `POST /v1/dirs/{uid}`, `POST /v1/nodes/{uid}/rename|move|copy`,
  `DELETE /v1/files|dirs/{uid}`, `POST /v1/files/{uid}/undelete`; optional poll.
  Emits `fe:navigate`, `fe:select`.
- `<fe-uploader>` — `POST /v1/dirs/{uid}/files` then `PUT /v1/files/{uid}/content`
  (streamed; progress events).
- `<fe-document-preview>` — `GET /v1/files/{uid}/renditions`,
  `GET /v1/files/{uid}/content` (Range/206), extracted text
  `GET /documents/{uid}/text` (csai). Sub-viewers (PDF, image, HTML) are lazy
  child modules. `markup` attribute → spatial annotation overlay (opt-in).
- `<fe-version-history>` — `GET /v1/files/{uid}/versions`,
  `.../versions/{ts}`, `POST /v1/files/{uid}/restore`.
- `<fe-metadata>` — `GET|PUT|DELETE /v1/nodes/{uid}/metadata[/{key}]`.
- `<fe-acl-view>` *(optional, read-only)* — `GET /v1/nodes/{uid}/acls`.
- `<fe-download>` — helper for `GET /v1/files/{uid}/content` (uses `API_REST.download`).

**Bundle B — Search & AI** (csai :8092; opt-in, easily excluded)
- `<fe-search>` — `POST /search {query,limit,fuzzy}`; emits `fe:result-select`.
- `<fe-chat>` — folder-scoped RAG over **WebSocket** `…/chat`; history
  `GET/DELETE /conversations[/{id}]`; optional "save report to folder".

**Bundle C — Collaboration** (discussion :8094; two channels)
- `<fe-comments>` — threads/comments/mentions with **live WS**
  `…/files/{uid}/live`; `GET|POST /files/{uid}/threads`, `…/comments`,
  `PATCH/DELETE`, `GET /files/{uid}/mentionable?q=`.
- `<fe-reviews>` — inbox `GET /reviews?role=&status=`, per-file
  `GET|POST /files/{uid}/reviews`, `POST /reviews/{id}/acknowledge`, decision.
- `<fe-notifications>` — `GET /dashboard/attention`, mark-seen,
  `GET /dashboard/activity`, `POST /attention/flags`.

**Bundle D — 3D / openBIM** (files renditions + discussion + BCF :8098; opt-in)
- `<fe-model-viewer>` — glTF/3D rendition viewer; viewpoint-anchored comments
  via discussion; BCF export `POST /bcf/2.1/bcf-xml/export {topics}`.

**Composite convenience (optional)**
- `<fe-document-drawer>` — composes preview + comments + versions for a single
  `uid` (mirrors the SPA's `FileDetailsDrawer` role) for integrators who want one
  drop-in element instead of wiring several.

---

## 5. Session & authentication

### 5.1 Default profile — popup OAuth, token in browser, direct-to-service

Chosen to keep the host app loaded and match the spec's "CORS allows the host to
reach the REST APIs" model.

1. **Interactive login (popup).** On a user gesture, `SessionManager.login()`
   opens the bridge's `/session/login?provider=<p>` in a `window.open()` popup.
   The bridge 302s to FileEngine `GET /v1/auth/oauth/{provider}` with
   `return_to` = the bridge's `/session/callback` (must be on
   `OAUTH_RETURN_ALLOWLIST`). The IdP authenticates the user; the callback lands
   on `/session/callback#token=…&expires_in=…`. That static page reads
   `location.hash` and `postMessage`s `{token, expires_in, tenant}` to
   `window.opener` **with an explicit `targetOrigin`** (the host origin), then
   `window.close()`. The host page never unloads.
2. **Silent refresh (best-effort iframe → bridge refresh → popup).** Before the
   15-min `exp`, try a hidden iframe to the IdP with `prompt=none`; if third-party
   cookies block it, fall back to `POST /v1/auth/refresh` (Bearer re-mint via the
   bridge); if that fails (revoked/expired), fall back to a login popup.
   `API_REST.set_reauthorize()` drives this: a 401 caches the in-flight calls,
   triggers refresh, then `recall()` replays them.
3. **Token handling.** The Bearer lives in JS memory (not `localStorage`, not a
   cookie) inside `SessionManager`; components never read it directly — they call
   through the shared API clients. `X-Tenant` is set from session config.
4. **postMessage security.** Both sides pin origins: the callback posts only to
   the configured host origin; `SessionManager` accepts messages only from the
   bridge origin and validates a `state`/nonce created at `login()`.

### 5.2 Alternative profile — trusted-issuer (zero-login SSO)

For host apps that want **no** FileEngine login at all (host user ⇒ FileEngine
session): the bridge holds `FILEENGINE_JWT_SECRET` and **mints the HS256 JWT
itself** from the host's authenticated session, mapping host-user → FileEngine
`sub`/`tenant`/`roles`. Most seamless; but the bridge becomes an
impersonation-capable secret holder and minting is **unaudited** today.

Hardening required before recommending it for production (tracked as work items):
a dedicated signing identity/kid, short TTLs + refresh only, an `act`/`azp` claim
marking bridge-minted tokens, and an **audit event** emitted to the core's audit
stream on every mint. Until then, this profile is "advanced / self-hosted trust."

### 5.3 Alternative profile — credential passthrough

Each user has real FileEngine/LDAP credentials; the bridge exchanges
`POST /v1/auth/token` (Basic, handling the 2FA branch) → `{token, expires_in}`.
Real per-user audit; requires provisioning FileEngine users. Useful when the host
already stores FileEngine credentials or wants an explicit login form.

### 5.4 CORS requirements (must be configured on the FileEngine side)

- **Bridge** (`http_bridge`): `HTTP_CORS_ORIGIN` accepts a **single** origin (no
  list, no `*`, no `Allow-Credentials` — fine for Bearer). Allowed headers already
  include `Authorization`, `Content-Type`, `Range`, `X-Tenant`. **Limitation:**
  one bridge instance serves one host origin; multiple host origins need a code
  change (origin allow-list matching) — call this out to the FileEngine operator,
  and file it as an upstream enhancement if multi-tenant hosting is required.
- **Downstream services** each have their own env allow-list, independent of the
  bridge: `CSAI_CORS_ORIGINS`, `DISC_CORS_ORIGINS`, `BCF_CORS_ORIGINS`,
  `FA_CORS_ORIGINS` (these set `allow_credentials`, all methods/headers). Only the
  services whose modules are enabled need the host origin added — this is the
  natural à la carte lever in thin-bridge mode.

---

## 6. Backend session bridge (Node/Express)

Minimal, single-purpose, MIT.

### 6.1 Responsibilities
- Serve the OAuth **login start** + **callback** (`postMessage`) pages.
- **Refresh** relay (`POST /v1/auth/refresh` passthrough).
- Optionally **mint** (trusted-issuer profile) or **exchange Basic** (passthrough).
- Serve nothing else in the default (thin) profile.

### 6.2 Endpoints (bridge)
- `GET /session/login?provider=&state=` → 302 to FileEngine OAuth (return_to = callback).
- `GET /session/callback` → static HTML that posts `{token,…}` to `window.opener`.
- `POST /session/refresh` → relays `POST /v1/auth/refresh`, returns fresh token.
- `POST /session/logout` → relays `DELETE /v1/auth/token`.
- `GET /session/config` → non-secret client config (service base URLs, enabled
  modules, tenant, theme defaults) so the embed can self-configure.
- *(trusted-issuer only)* `POST /session/mint` → server-side mapped mint (audited).

### 6.3 Optional "proxy" profile
For integrators who must **not** expose the JWT to browser JS or who want
hard module gating and same-origin calls: the bridge proxies all service calls
(REST + WebSocket + Range/streaming), holds the token in a server session
(httpOnly cookie), and returns 404 for disabled modules. Heavier; documented as
an alternative, not the default. The front-end API clients take a `mode:
'direct'|'proxy'` switch so the same components work either way.

### 6.4 Config (bridge, env)
`BRIDGE_PORT`, `HOST_ORIGIN` (postMessage target + CORS), `FILEENGINE_BRIDGE_URL`
(:8090), service base URLs, `MODULES` (csv: core,search,collab,3d), `PROFILE`
(oauth|trusted|passthrough), `SESSION_MODE` (direct|proxy), and — only for
trusted-issuer — `FILEENGINE_JWT_SECRET` (guarded; never shipped to the browser).

---

## 7. Theming & encapsulation (Hybrid: shadow + light-DOM opt-out)

- **Default: Shadow DOM.** Each component encapsulates its styles so host CSS
  can neither leak in nor out. Robust on arbitrary host pages.
- **Per-component light-DOM opt-out:** a `light-dom` boolean attribute renders
  into the host DOM so the host's stylesheet applies directly (for integrators
  who want pixel-exact matching and accept collision risk).
- **Theming contract:**
  - A documented set of **CSS custom properties** (`--fe-color-bg`,
    `--fe-color-fg`, `--fe-accent`, `--fe-border`, `--fe-radius`, `--fe-font`, …)
    that pierce Shadow DOM and are the primary theming surface.
  - **`::part()`** hooks on every significant sub-element for structural
    overrides.
  - **Theme modules:** a theme is a small ES/CSS module setting the custom
    properties on `:host`/`::part`. Ship **`theme-light`** and **`theme-dark`**
    prototypes; integrators pass their own via a `theme` attribute or by setting
    the properties on an ancestor.
  - Respect `prefers-color-scheme` by default; honor a host `data-theme` override.
- All colors/spacing come from tokens — no hard-coded values — so a single theme
  module restyles the whole kit.

---

## 8. Message bus & composition (JSUM)

- **`multicall({query, target, params})`** is the only inter-component channel;
  loose and optional. Example: `<fe-search>` result click →
  `multicall({query:'fe-document-preview', target:'open', params:[uid]})`.
- **Lazy hydration** (`init_hydration_lifecycle` + `jsum` attribute): heavy
  components (preview, 3D, chat) activate their `_start()` only when scrolled into
  view — good for host pages embedding many elements.
- **Events out, methods in:** components emit `CustomEvent`s (`fe:*`) for host
  code, and expose imperative methods (`open(uid)`, `refresh()`, `setTenant()`)
  reachable via `multicall` or direct DOM. Documented per component.
- `<fe-session>` publishes the shared API clients; components locate it via a
  `multicall` to `fe-session` (or a documented global) rather than importing it,
  keeping modules decoupled.

---

## 9. Distribution & build (TypeScript → ESM + types)

- **Authoring:** TypeScript. **Runtime:** zero dependencies (W3C Web Components
  only). No framework, no polyfills beyond documented evergreen-browser support.
- **Outputs:** per-module **ESM** (`dist/esm/<module>.js`) + `.d.ts`; an optional
  bundled/minified single-file build; a documented **CDN** path per module.
- **Package layout (monorepo, workspaces):**
  ```
  packages/core      → jsum, API_REST, WS client, SessionManager, <fe-session>   (MIT, from to-migrate)
  packages/files     → <fe-file-browser> <fe-uploader> <fe-document-preview> …
  packages/search    → <fe-search> <fe-chat>
  packages/collab    → <fe-comments> <fe-reviews> <fe-notifications>
  packages/openbim   → <fe-model-viewer>
  packages/themes    → theme-light, theme-dark
  bridge/            → Node/Express session bridge
  examples/          → host-page demos (vanilla, React island, plain HTML)
  ```
- **Versioning:** independent semver per package; `core` is the shared peer.
- **No build for consumers:** integrators can `<script type=module>` the CDN ESM
  or `npm install` per package.

---

## 10. Security considerations

- Token in memory only (default profile); never `localStorage`/cookie unless
  proxy profile (then httpOnly + SameSite).
- Strict `postMessage` origin + nonce validation on the login handshake.
- CORS is per-origin, never `*`; document exact operator config.
- Trusted-issuer profile treated as an **impersonation key**: guarded env,
  audited mints, short TTL, never shipped to the browser.
- Module gating is attack-surface reduction, not authorization — ACLs/roles in
  the JWT remain the security boundary.
- Respect the core's soft-delete/versioning semantics; destructive ops
  (delete/purge/restore) confirm in-UI and are still ACL-enforced server-side.

---

## 11. Testing

- **Unit:** message bus (`multicall`, cache invalidation, hydration), `API_REST`
  (dedup, 401→re-auth→replay, path templating, download), `SessionManager`
  (popup/iframe/refresh state machine) — carry over `to-migrate/*.test.js` and
  extend.
- **Component:** each Web Component in isolation (Shadow vs light-dom, theming
  properties, events/methods) — Web Test Runner / Playwright component tests.
- **Integration:** a demo host page against a running dev stack (start via
  `scripts/start_backend_services.sh`), exercising login handshake + each module.
- **Contract:** pin the REST/WS endpoints the kit depends on; a smoke test flags
  drift from the FileEngine API.

---

## 12. Milestones

1. **M0 — Foundation.** Re-license `to-migrate` into `packages/core`; add the WS
   companion + `SessionManager` (popup OAuth + refresh); Node bridge (default
   profile); `<fe-session>`; theming tokens + light/dark; one demo page.
2. **M1 — Core documents (Bundle A).** browser, uploader, preview (PDF/image/HTML),
   versions, metadata, download. Ship as the first usable release.
3. **M2 — Collaboration (Bundle C).** comments/threads + live WS, reviews,
   notifications.
4. **M3 — Search & AI (Bundle B).** search, RAG chat (WS). Clearly excludable.
5. **M4 — 3D / openBIM (Bundle D).** model viewer + BCF export.
6. **M5 — Hardening.** proxy profile, trusted-issuer audit path, multi-origin
   CORS upstream ask, docs/examples (React/Angular island demos), CDN publish.

---

## 13. Open decisions (confirm before/along M0)

1. **Zero-login SSO?** Default is popup-OAuth (one interactive FileEngine login,
   then silent). If true zero-login is required, adopt the trusted-issuer profile
   (§5.2) and its hardening — confirm which.
2. **Thin vs proxy session** (§6.3): default thin (token in browser, direct calls,
   per-service CORS). Confirm whether any target integrator needs the token hidden
   / same-origin proxy in v1, or if that's an M5 option.
3. **Multi-host-origin** on one FileEngine instance requires an upstream CORS
   allow-list change (§5.4). Needed for v1, or single-origin per deployment?
4. **`<fe-acl-view>`** (read-only permissions) — include in Bundle A, or omit
   entirely to keep the kit purely document-centric?
5. **Composite `<fe-document-drawer>`** — build the convenience element in M1, or
   leave composition to integrators?
