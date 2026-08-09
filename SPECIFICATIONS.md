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
| Permissions / ACL | **Not in the kit at all** — permissioning is handled by pre-provisioned directory structures (§2.1) | Grant/revoke, ACL editing, principal picker (config service / official client) |
| Reviews | Request a review, respond (approve/reject/ack) | Automation that *raises* reviews (folder_actions) |
| Folder actions | (nothing) | Bindings, routes, run log |
| Classifiers / templates | (nothing) | Classifier-set + notify/email template editors |
| Metadata | Read/write per-document key/values | — |
| Search / chat | Run search, RAG chat | MCP integration config, model/admin settings |
| Profile / auth | Handled by the **session bridge**, not shipped as components | 2FA policy, user provisioning |
| Integration credentials | (nothing) | Generate/manage inter-server integration keys — System config → *Integrations* (§14.1) |
| Space/project provisioning | (nothing — end users operate *within* provisioned spaces) | Templates + apply, via the integration credential (config service, §14.7) |

Non-goals: no tenant administration, no user/role management, no audit/security
UI, no classifier or automation authoring, **no ACL/permission UI of any kind**
(not even read-only).

### 2.1 Permissioning model — pre-provisioned spaces (no ACL UI in the kit)

Permissions are **not an end-user concern** and are deliberately absent from the
embed kit. Access is expected to be correct *by construction* through the
directory structure, not managed inside embedded components:

- An external system (the integrator's backend) **provisions standardized "project"
  / space folder structures ahead of time** — with the right owners, roles, and
  ACLs already applied — by reaching into FileEngine's **configuration/admin APIs**
  (server-to-server, with appropriate rights), *not* through the embed kit.
- End users in the embedded components then simply operate **within** those
  pre-permissioned spaces; the JWT's roles + the folder ACLs enforce access
  server-side. There is nothing for the end user to configure.
- This pairs naturally with Posture B (§5.0): an infrastructure-level integrator
  that shares the identity source-of-truth also owns space provisioning, so a new
  application-level project maps to a pre-built, correctly-permissioned FileEngine
  space.
- **Provisioning surface — V1 (§14.7).** A higher-level "space/project template"
  provisioning API (apply a named folder+ACL template for a new project in one
  call) is a committed V1 upstream item, driven server-to-server by the embedding
  application's **integration credential** (§14.1) — not by the embed kit or an end
  user. It is how an embedding app stands up the directory structure it needs.

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
4. **Session bridge (Node/Express)** — **handshake only**. It negotiates/refreshes
   the session token and never proxies data: once the client holds a valid JWT it
   calls FileEngine's REST/WS interfaces **directly**. As thin as possible.

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
- **Access is enforced by CORS + ACLs, not the bridge.** Since the bridge is
  handshake-only (never a data proxy), the levers to *not* expose a capability are:
  (a) don't import/enable the component, and (b) don't add the embedding domain to
  that service's CORS allow-list (§5.4). A disabled module's service is simply not
  reachable from the embedding origin. The JWT roles + folder ACLs remain the real
  authority regardless.
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
- `<fe-download>` — helper for `GET /v1/files/{uid}/content` (uses `API_REST.download`).

*(No ACL component — permissioning is pre-provisioned, §2.1.)*

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
**Grouped utility widget (build it).** Each drawer *tab* is already its own
independently-embeddable component above (preview, comments, versions, metadata).
In addition, ship a grouped convenience widget:
- `<fe-document-drawer>` — a tabbed widget composing preview + comments + versions
  + metadata for a single `uid` (mirrors the SPA's `FileDetailsDrawer`), so an
  integrator can drop in one element instead of wiring several. It is itself just a
  composition over the standalone components (which remain usable on their own), and
  respects the same à la carte opt-ins (e.g. omit the AI/markup tabs).

---

## 5. Session & authentication

### 5.0 Integration postures (which session profile applies)

The available session profiles are a function of **how deeply the integrator has
integrated with the FileEngine infrastructure**, specifically whether the two
systems share a **common user source-of-truth**. This is a deployment decision the
integrator makes, not something the kit can assume.

- **Posture A — Standalone embed (no shared identity).** The host app has its own,
  separate user store. FileEngine identities are distinct. → Use **popup OAuth**
  (§5.1) or **credential passthrough** (§5.3). The user authenticates to FileEngine
  once (then silent). No infrastructure coupling required; works against any
  FileEngine instance the host is merely CORS-allowed to reach.

- **Posture B — Infrastructure-level integration (common source-of-truth).** The
  integrator has extended down to the **identity infrastructure layer**: their
  application and FileEngine are provisioned from the **same LDAP directory,
  schema, tenant, and role model** — one authoritative user store. Only in this
  posture is the **delegated silent session** (§5.2) available, and it is the
  payoff for that deeper integration: true zero-login SSO with roles that map 1:1
  because both sides read the same directory.

Posture B is a **stronger prerequisite than "point at the same LDAP host"** — it
assumes a genuinely shared source-of-truth (shared provisioning, tenanting, and
role governance), which is an infrastructure commitment. The kit supports both
postures; §5.1 is the portable default, §5.2 is the tight-integration tier.

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

### 5.2 Preferred tight-integration profile — delegated silent session (zero-login)

For host apps that want **no** FileEngine login at all (host user ⇒ FileEngine
session, established silently in the background). This profile needs a **new
upstream FileEngine endpoint** (fully specified in §14) and is the recommended
path for deep commercial embedding once that lands.

Trust model — **do NOT share the global `FILEENGINE_JWT_SECRET`.** That secret can
forge any token for any user/tenant (incl. `system_admin`) and is unaudited;
handing it to an integrator's bridge is an unacceptable blast radius. Instead each
integration gets a **scoped, registered, revocable credential**, and FileEngine —
not the bridge — does the minting, validation, and auditing.

Handshake (asymmetric assertion, RFC 7523 / RFC 8693 token-exchange shape):
1. The integration holds a **private key**; FileEngine's registry stores only its
   **public key** (§14). Nothing forge-capable ever leaves the integration.
2. On "give me a FileEngine session", the integrator's backend (or our Node
   bridge, which holds the private key) builds a short-lived **signed assertion**
   `{ iss: integration_id, sub: <user email/external-id>, tenant, aud:
   fileengine, iat, exp, jti }` and POSTs it to `POST /v1/auth/exchange`.
3. FileEngine verifies the assertion signature against the registered public key,
   checks the integration is enabled and permitted for that tenant, resolves the
   subject to a **pre-provisioned** LDAP identity (§14 — unknown subject is
   rejected in v1), and applies the integration's **role cap** and **TTL cap**.
4. It mints a normal end-user HS256 session JWT with delegation markers
   `act = { integration_id }`, `azp = integration_id`, `amr = ["delegated"]`, and
   emits an `auth.delegated_issue` **audit event**. Returns `{ token, expires_in }`.
5. The embed uses the token as `Authorization: Bearer` exactly like any other
   profile; refresh via `POST /v1/auth/refresh`.

No browser redirect or popup — the trust is established server-to-server, so the
host app is never interrupted. Because scope is enforced at mint time, a
compromised integration cannot cross tenants or escalate to admin, and every
issuance is attributable in the tamper-evident audit chain.

**Shared directory (Posture B prerequisite, §5.0).** This profile is available
*only* to integrators who have integrated at the infrastructure layer and share a
**common user source-of-truth** — the integrating application back-ends to the
**same LDAP service, schema, tenant, and role model** as FileEngine. That shared
directory is what makes the handshake clean:
- The asserted `sub` **is** a FileEngine identity — no external-id mapping table,
  no JIT provisioning. FileEngine resolves the subject in the shared directory and,
  if absent, rejects (pre-provisioned model, which is automatic here).
- **Roles map 1:1.** FileEngine resolves the subject's roles *live from the shared
  LDAP at mint time* — exactly as a normal password login does — so the token
  carries the user's real roles and the host app authorizes against the *same*
  role names. No role translation on either side.
- The integration's optional **role cap** (§14) is therefore a *least-privilege
  ceiling* on what the embed surface may receive (which is end-user-only anyway),
  never a role remapping — e.g. an integration can be configured to never obtain
  admin-scoped tokens even for a subject who genuinely holds an admin role.

### 5.3 Alternative profile — credential passthrough

Each user has real FileEngine/LDAP credentials; the bridge exchanges
`POST /v1/auth/token` (Basic, handling the 2FA branch) → `{token, expires_in}`.
Real per-user audit; requires provisioning FileEngine users. Useful when the host
already stores FileEngine credentials or wants an explicit login form.

### 5.4 CORS — strictly FileEngine's responsibility (embedding-domain allow-list)

Because the bridge is handshake-only and the client calls FileEngine **directly**,
the origin allow-list is owned entirely by the **FileEngine deployment + component
configuration**, not by the embed kit or the host application. The operator
explicitly white-lists the specific **embedding domain(s)** that may reach each
service. This is the single, authoritative access lever for browser-origin access.

- **Downstream services** (search/RAG, discussion, BCF, folder_actions) each already
  take a **list** of origins via env: `CSAI_CORS_ORIGINS`, `DISC_CORS_ORIGINS`,
  `BCF_CORS_ORIGINS`, `FA_CORS_ORIGINS` (`allow_credentials`, all methods/headers).
  Add only the embedding domains for the services whose modules are enabled — this
  *is* the à la carte access boundary.
- **Bridge / core files API** (`http_bridge`): today `HTTP_CORS_ORIGIN` accepts a
  **single** origin (no list). Since the model requires white-listing **multiple**
  specific embedding domains per deployment, this is a confirmed **upstream
  requirement**: `http_bridge` must accept an **allow-list** and echo the matching
  request origin (see §14.6). Allowed headers already include `Authorization`,
  `Content-Type`, `Range`, `X-Tenant`.
- Never `*`. Each embedding domain is named explicitly; adding/removing an embed is
  a FileEngine-side config change, giving the operator a clean audit + kill-switch.

### 5.5 Deep-link SSO into the official FileEngine client (no repeated login)

An embedded component can hand the user out to the **full official FileEngine SPA**
deep-linked to a specific target (a file, folder, review, thread, 3D viewpoint,
chat) **carrying the current session — no second login**. This is cross-origin
(host app → FileEngine SPA), so the session is handed off explicitly:

- **Recommended — one-time hand-off code.** `SessionManager.openInFileEngine(target)`
  requests a short-lived (~30–60 s), **single-use** hand-off code bound to the
  current session's subject/tenant, then opens
  `https://<fileengine-spa>/#/<route>?…&sso=<code>` (new tab/window). The SPA's
  landing route **redeems** the code (`POST /v1/auth/sso/redeem {code}` →
  `{token, expires_in}`), adopts the session as it does post-login, **strips** the
  code from the URL (`history.replaceState`), and routes to the deep-link target.
  No long-lived bearer ever appears in a URL/history/referrer.
- **Fallback (no upstream code endpoint yet).** Pass the existing bearer in the URL
  **fragment** (`#token=…&expires_in=…`), reusing the SPA's existing OAuth
  fragment-adoption path; the SPA stores it and immediately strips it. Simpler, but
  the token transits the URL — HTTPS-only, short TTL, immediate strip; prefer the
  one-time code.
- **Targets** map to existing SPA routes (from the frontend inventory): `/files`
  (`?folder=`/`?file=`), `/preview/:uid`, `/chat`, `/dashboard`, and comment/review
  anchors. Works in every session posture (popup-OAuth, delegated, passthrough).
- **Upstream support needed:** (a) a small SPA **SSO landing** that adopts a
  redeemed/fragment session and routes to the target; (b) optionally the
  `sso/handoff` + `sso/redeem` endpoints (single-use, short TTL, audited) — §14.6.
- Components expose this as an **opt-in** affordance (e.g. an "Open in FileEngine"
  action / `deep-link` attribute); integrators who don't want the hand-off simply
  don't enable it.

---

## 6. Backend session bridge (Node/Express)

Minimal, single-purpose, MIT. **Handshake only — it is never a data proxy.** Its
sole job is to get a valid JWT into the client; all document traffic then goes
client ↔ FileEngine directly (§5.4).

### 6.1 Responsibilities
- Serve the OAuth **login start** + **callback** (`postMessage`) pages.
- **Refresh** relay (`POST /v1/auth/refresh` passthrough).
- Optionally **sign the assertion + relay `/v1/auth/exchange`** (delegated
  profile, §5.2/§14) or **exchange Basic** for a token (passthrough profile).
  The bridge never mints tokens itself.
- Optionally request a **deep-link SSO hand-off code** for "Open in FileEngine"
  (§5.5).
- Serve nothing else. No data/proxy routes exist.

### 6.2 Endpoints (bridge)
- `GET /session/login?provider=&state=` → 302 to FileEngine OAuth (return_to = callback).
- `GET /session/callback` → static HTML that posts `{token,…}` to `window.opener`.
- `POST /session/refresh` → relays `POST /v1/auth/refresh`, returns fresh token.
- `POST /session/logout` → relays `DELETE /v1/auth/token`.
- `GET /session/config` → non-secret client config (service base URLs, enabled
  modules, tenant, theme defaults) so the embed can self-configure.
- *(delegated profile)* `POST /session/exchange` → builds the signed assertion for
  the host-mapped subject and relays `POST /v1/auth/exchange`; returns the token.
- *(deep-link SSO)* `POST /session/handoff` → obtains a one-time SSO code (§5.5) for
  an "Open in FileEngine" link.

### 6.3 Explicit non-goal — no data proxy
The bridge does **not** proxy REST/WebSocket/streaming traffic, does not hold the
token server-side, and offers no `direct|proxy` switch. Keeping the JWT in the
client and calling FileEngine directly is the intended model; access is governed by
FileEngine's CORS allow-list (§5.4) + ACLs, not by a bridge in the data path.

### 6.4 Config (bridge, env)
`BRIDGE_PORT`, `HOST_ORIGIN` (postMessage target), `FILEENGINE_BRIDGE_URL` (:8090),
`FILEENGINE_SPA_URL` (deep-link base), service base URLs, `MODULES` (csv:
core,search,collab,3d), `PROFILE` (oauth|delegated|passthrough); and — only for the
delegated profile — `FE_INTEGRATION_ID` + `FE_INTEGRATION_PRIVATE_KEY` (the
assertion-signing key; guarded, server-only, never shipped to the browser). The
bridge **never** holds the global `FILEENGINE_JWT_SECRET`.

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

- Token in JS memory only — never `localStorage`/cookie (there is no proxy/cookie
  profile).
- Strict `postMessage` origin + nonce validation on the login handshake.
- Deep-link SSO uses a **single-use, short-TTL** hand-off code (§5.5); avoid the
  bearer-in-fragment fallback except HTTPS-only with immediate strip.
- CORS is an explicit FileEngine-side allow-list of embedding domains, never `*`
  (§5.4); adding/removing an embed is an auditable operator config change.
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

**V1 goals (committed):** the tight-integration backbone plus the first usable
end-user surface — M0, M1, and the upstream **M-U** (delegated exchange +
integration registry & SPA *Integrations* UI + **provisioning surface** + the
multi-origin CORS allow-list). Collaboration (M2) is a strong candidate to pull
into V1; Search/AI (M3), 3D (M4), and deep-link SSO (M5) are post-V1 unless pulled
forward.

1. **M0 — Foundation.** Re-license `to-migrate` into `packages/core`; add the WS
   companion + `SessionManager` (popup OAuth + refresh); Node bridge (handshake
   only); `<fe-session>`; theming tokens + light/dark; one demo page.
2. **M1 — Core documents (Bundle A).** browser, uploader, preview (PDF/image/HTML),
   versions, metadata, download, grouped `<fe-document-drawer>`. First usable release.
3. **M-U — Inter-server integration (upstream FileEngine) — V1.** Parallelizable
   with M0/M1. Deliver §14 end-to-end:
   - Integration **registry** + **SPA *Integrations* credential UI** (generate/
     register key, scopes, rotate/revoke) — §14.1.
   - `POST /v1/auth/exchange` for **delegated-user** *and* **integration-service**
     tokens — §14.2; `auth.delegated_issue` audit.
   - **Provisioning surface** + space templates + template editor — §14.7;
     `provisioning.*` audit.
   - **Multi-origin CORS allow-list** on `http_bridge` — §14.6.
   - Bridge `delegated` profile + `SessionManager` silent path.
   This is the "tight integration" headline and the payoff for Posture B (§5.0).
4. **M2 — Collaboration (Bundle C).** comments/threads + live WS, reviews,
   notifications. *(Pull into V1 if the launch integrator needs it.)*
5. **M3 — Search & AI (Bundle B).** search, RAG chat (WS). Clearly excludable.
6. **M4 — 3D / openBIM (Bundle D).** model viewer + BCF export.
7. **M5 — Hardening & deep-link SSO.** deep-link SSO hand-off (`sso/handoff`+
   `redeem` + SPA landing, §5.5), proxy-free audit pass, docs/examples
   (React/Angular island demos), CDN publish.

---

## 13. Open decisions (confirm before/along M0)

1. **Zero-login SSO — resolved.** The delegated silent-session profile (§5.2) via
   the upstream `POST /v1/auth/exchange` (§14) is the chosen tight-integration
   path: asymmetric assertion, shared LDAP directory, pre-provisioned subjects.
   Popup-OAuth (§5.1) remains the no-upstream-change default for integrators who
   don't share a directory. (Open sub-item: is delegated exchange required for the
   *first* shippable release, or can front-end modules M1–M2 ship on popup-OAuth
   while M-U proceeds in parallel?)
2. **Thin vs proxy — resolved: thin only.** The bridge negotiates the session to
   the point the client holds a valid JWT, then the client calls FileEngine's REST
   interface **directly**. No data proxy, no server-held token (§6.3). The CORS
   allow-list is strictly FileEngine's responsibility (§5.4).
3. **Multi-origin CORS — resolved: required, FileEngine-side.** The allow-list of
   specific embedding domains is owned by the FileEngine deployment + component
   config. Downstream services already take a list; `http_bridge` must be extended
   to a multi-origin allow-list (upstream §14.6).
4. **ACL component — resolved: excluded entirely.** No ACL UI (not even read-only).
   Permissioning is not an end-user concern; it is handled by pre-provisioned
   directory structures set up by external systems via FileEngine's config service
   (§2.1).
5. **Composite widget — resolved: build it.** Each drawer tab is its own
   embeddable component *and* a grouped `<fe-document-drawer>` utility widget is
   provided (built in M1), composing the standalone tabs (§4.4).

---

## 14. Upstream FileEngine additions (proposal) — delegated session exchange

This is a **proposal for the core FileEngine stack** (http_bridge + ldap_manager),
not the embed kit itself. It is the prerequisite for the delegated silent-session
profile (§5.2) and the "tight integration" headline. It is additive and does not
change existing auth. Applies to **Posture B** integrators (§5.0) with a shared
LDAP source-of-truth.

### 14.1 Integration registry + credential UI (admin — official SPA + ldap_manager) — **V1**

An **inter-server integration credential** is a first-class, admin-managed identity
representing a whole embedding application (not a user). It is **dual-purpose**:
it can (a) mint delegated end-user sessions (§14.2) and (b) call the provisioning
surface (§14.7) to stand up the directory structure that application needs. Both
capabilities and their scopes are declared on the registry entry.

**System-configuration UI (official SPA, admin-only).** A new *Integrations*
section under System configuration to **generate and manage** integration
credentials — consistent with the boundary (this is administrative, so it lives in
the official client, never the embed kit). It supports:
- **Create / generate.** Either register the integrator's **public key / JWKS**
  (preferred — private key never touches FileEngine) *or* generate an asymmetric
  keypair server-side and reveal the **private key once** for the integrator to
  copy (convenience; never persisted). "API key generation" in the admin sense.
- **Scope configuration** (below), **enable/disable**, **rotate** (add a new `kid`,
  overlap window, retire old), **revoke**, and view **usage/audit**.

**Registry entry (server-side, ldap_manager):**
- `integration_id` (issuer identifier used in the assertion `iss`).
- **Public key(s) / JWKS** by `kid` (asymmetric; RSA-2048+/EC-P256). FileEngine
  stores only public keys — never anything forge-capable.
- **`capabilities`** — any of `session_exchange`, `provisioning`.
- `allowed_tenants` — the tenant(s) this integration operates in.
- `subject_scope` — which subjects it may assert for session exchange (e.g. any
  member of an allowed tenant; optionally restricted to a subtree/filter). Unknown
  subject ⇒ reject (pre-provisioned only, v1).
- `role_cap` (optional least-privilege ceiling; §5.2) and `ttl_cap` (≤ `token_ttl`).
- **`provisioning_scope`** — the root folder(s)/prefix under which it may create
  space structures, and the **templates/roles** it is permitted to apply (§14.7).
- `enabled`, `created/rotated_at`, audit metadata.

### 14.2 Exchange endpoint (http_bridge — owns HS256 session minting)
`POST /v1/auth/exchange` — request body a **signed assertion** (RFC 7523 JWT-bearer
grant shape):
```
grant_type = urn:ietf:params:oauth:grant-type:jwt-bearer
assertion  = <JWT signed by the integration's private key>
    header : { alg: RS256|ES256, kid }
    claims : { iss: integration_id, sub: <subject>, tenant, aud: "fileengine-exchange",
               iat, exp (≤ ~60s), jti }
```
Server steps:
1. Look up `integration_id` in the registry (must be enabled); verify the assertion
   signature against the registered public key (`kid`-selected). Pin algs
   (reject `none`/HS confusion), enforce `aud`, short `exp`, and single-use `jti`
   (replay guard).
2. Enforce `tenant ∈ allowed_tenants` and `sub ∈ subject_scope`.
3. Resolve `sub` in the **shared LDAP** and read its roles live (as normal login
   does). Absent ⇒ `404 subject_not_provisioned`.
4. Apply `role_cap` (intersect) and `ttl_cap`.
5. Mint the standard end-user HS256 session JWT (`mintJwt`) **plus** delegation
   claims: `act = { sub: integration_id }`, `azp = integration_id`,
   `amr = ["delegated"]`.
6. Emit an **audit event** (§14.3). Respond `{ token, token_type: "Bearer",
   expires_in }`. Refresh thereafter uses the existing `POST /v1/auth/refresh`
   (which re-reads roles live and preserves the delegation markers).

**Integration service token (for provisioning).** The same assertion mechanism also
issues a token that acts **as the integration itself** (not an end user), used to
call the provisioning surface (§14.7). Selected by the assertion audience /
requested scope: `aud: "fileengine-provisioning"` (or `scope=provisioning`) ⇒ if the
integration holds the `provisioning` capability, mint a **service-scoped** token
whose `sub = integration_id`, `amr = ["integration"]`, carrying only the
provisioning scope (bounded by `provisioning_scope`) — **no user roles, no ACL
bypass**. It authorizes only the §14.7 provisioning routes, still enforced by
core ACLs on the target roots. This keeps one credential for both jobs while
keeping the two token *types* (delegated-user vs integration-service) distinct and
separately auditable.

Notes: this endpoint is server-to-server (the integration's backend / the kit's
Node bridge). Rate-limit per `integration_id`; it is a `/v1` route so it can carry
the same monitoring/allow-list posture as the rest of the bridge.

### 14.3 Audit
New event `auth.delegated_issue` into the tamper-evident chain:
`{ integration_id, subject, tenant, roles_granted, source_ip, jti, outcome }` —
every delegated mint (and every rejection) is attributable, closing the "unaudited
impersonation" gap that sharing `FILEENGINE_JWT_SECRET` leaves open.

### 14.4 Security properties
- **No shared signing secret.** FileEngine holds only integration *public* keys;
  the global `FILEENGINE_JWT_SECRET` is never distributed to integrators.
- **Bounded blast radius.** A compromised integration key is scoped to its tenants,
  subject_scope, and role_cap, is independently revocable, and cannot cross tenants
  or escalate to admin. Contrast: the raw JWT secret can forge anything, silently.
- **Non-repudiation + full audit** of every issuance.
- **Roles are truthful** (read live from the shared LDAP), never asserted by the
  integration — the assertion names a *subject*, not its privileges.

### 14.5 Effort / touch points (upstream)
- `ldap_manager`: integration **registry** model + admin routes + rotation/
  revocation (mirrors existing service-credential machinery); **provisioning**
  template store + apply/reconcile orchestration (§14.7).
- **Official SPA (AGPL client):** new **System configuration → Integrations**
  section — generate/register credential, configure scopes (session + provisioning),
  rotate/revoke, view usage; plus the **provisioning template editor**.
- `http_bridge`: `/v1/auth/exchange` (delegated-user **and** integration-service
  tokens) + assertion verification (extend `jwt.h` with RS256/ES256 verify + JWKS)
  + delegation/integration claims in `mintJwt`; multi-origin CORS allow-list (§14.6).
- `core`: provisioning writes go through the core's existing dir/ACL/metadata ops
  (no new write path); integration service-identity gets create+MANAGE_ACL on its
  scoped root at registration.
- `EVENT_CONTRACT`/audit: register `auth.delegated_issue`, `provisioning.*`.
- Docs: integration onboarding (key registration, assertion format, scopes,
  template authoring).

### 14.6 Related upstream items (CORS allow-list + deep-link SSO)

Two smaller upstream additions the embedding model depends on:

- **Multi-origin CORS on `http_bridge` (§5.4).** Today `HTTP_CORS_ORIGIN` echoes a
  single origin. Extend it to a configured **allow-list** of embedding domains:
  match the request `Origin` against the list and echo it (with `Vary: Origin`),
  else emit no CORS headers. Never `*`. The downstream FastAPI services already
  accept a list, so this only closes the bridge/core-files gap. Env e.g.
  `HTTP_CORS_ORIGINS` (csv). This is the single authoritative browser-origin lever.

- **Deep-link SSO hand-off (§5.5).** To open the official SPA deep-linked without a
  second login:
  - `POST /v1/auth/sso/handoff` (Bearer) → `{ code, expires_in }` — mints a
    **single-use**, ~30–60 s code bound to the caller's session (subject/tenant),
    stored server-side (or as a signed, self-contained one-time token). Audited.
  - `POST /v1/auth/sso/redeem` `{ code }` → `{ token, expires_in }` — redeems once,
    returns a normal session JWT; further redemptions fail. Audited.
  - **SPA support:** an `sso` landing that calls `redeem` (or adopts a `#token`
    fragment in the fallback), stores the session as post-login, strips the
    code/token from the URL, and routes to the requested deep-link target.
  - Reuses the existing JWT infrastructure; no new trust root. Keeps long-lived
    bearers out of URLs when the code path is used.

### 14.7 Provisioning surface (config service) — **V1** — full proposal

A server-to-server API for an embedding application to **stand up and maintain the
directory structure it needs** — standardized "project"/space folder trees with
owners, roles, ACLs, and metadata already applied — so end users then simply
operate within correctly-permissioned spaces (§2.1). Called with an **integration
service token** (§14.2, `provisioning` capability) by the integrator's backend;
**never** exposed to the browser or the embed kit. Base path `/v1/provisioning`.

Design principles: **declarative** (describe the desired space, don't script
mkdir/grant), **idempotent + reconcilable** (safe to re-apply on every "new
project" event; converges to the template), **scoped** (confined to the
integration's roots/templates/roles; core ACLs still enforce every write), and
**auditable** (every action in the tamper-evident chain).

#### 14.7.1 Space template (declarative model)
An admin-authored, versioned template describes a desired subtree. Bound to
**existing** roles/claims (identity/role *creation* stays with the shared directory
/ ldap_manager — §14.7.6). Parameterized via `${...}` substitution.

```jsonc
{
  "template_id": "project-standard",
  "version": 3,
  "params": ["project_code", "manager_role", "member_role"],   // required inputs
  "root": {
    "name": "${project_code}",
    "metadata": { "type": "project", "code": "${project_code}" },
    "acls": [
      { "principal": "role:${manager_role}", "allow": ["r","w","d","m"] },
      { "principal": "role:${member_role}",  "allow": ["r","w"] },
      { "principal": "everyone",             "deny":  ["r"] }        // gate the space
    ],
    "children": [
      { "name": "Documents" },
      { "name": "Drawings",  "children": [ { "name": "Superseded" } ] },
      { "name": "Incoming",  "acls": [ { "principal": "role:${member_role}", "allow": ["r","w"] } ] },
      { "name": "Approved",  "acls": [ { "principal": "role:${member_role}", "allow": ["r"] } ] }
    ]
  }
}
```
- Child folders **inherit** the parent's ACLs unless they declare their own
  (mirrors the core's ACL_INHERIT semantics); a child may add or override.
- `metadata` seeds per-node custom metadata. Permission keys reuse the kit's letter
  vocabulary (`r w d l u v b s m i` …, §7 of the platform's ACL model).

#### 14.7.2 Endpoints

**Spaces (integration-driven):**
- `POST /v1/provisioning/spaces` — apply a template, creating/reconciling a space.
  Body: `{ template_id, version?, tenant, parent_uid?, params:{...},
  external_id, mode?: "create"|"reconcile"|"enforce", dry_run?: bool }`.
  - `external_id` is the integrator's own key (e.g. their project id) → **idempotency**:
    a repeat call with the same `external_id` returns the same space, never a
    duplicate. `parent_uid` defaults to the integration's scoped root.
  - `mode`: `create` (fail if exists) · `reconcile` (default: create-missing,
    additive, never destructive) · `enforce` (also correct drifted ACLs/metadata to
    match the template; still non-destructive to user content).
  - `dry_run:true` → return the **plan** (nodes/ACLs/metadata that would be
    created/updated) without applying.
  - Response: `{ space_uid, external_id, template_id, version, status:"created"|"reconciled"|"noop",
    nodes:[{ path, uid, action:"created"|"existing"|"updated" }], warnings:[...] }`.
- `GET /v1/provisioning/spaces?tenant=&external_id=&template_id=` — list within scope.
- `GET /v1/provisioning/spaces/{space_uid}` — inspect: node map, applied
  template+version, and **drift** vs the current template.
- `PATCH /v1/provisioning/spaces/{space_uid}` — re-apply / upgrade to a newer
  template version (reconcile|enforce), or update params (e.g. rename bindings).
- `POST /v1/provisioning/spaces/{space_uid}/grants` — bounded ACL adjustment on the
  space (add/remove a permitted role/claim grant, within `provisioning_scope`), for
  membership-shaped changes that don't warrant a full re-template.
- `DELETE /v1/provisioning/spaces/{space_uid}` — **soft-delete** (scope-checked,
  honors the core's recoverable-delete + versioning); optional, off by default.

**Templates (admin — official SPA):**
- `GET /v1/provisioning/templates` — list (an integration sees only the templates
  its `provisioning_scope` permits).
- `GET /v1/provisioning/templates/{id}` — fetch (+ versions).
- `POST /v1/provisioning/templates` · `PUT /v1/provisioning/templates/{id}` — create
  / new version (admin only; edited in the SPA *Integrations/Provisioning* section).
- `DELETE /v1/provisioning/templates/{id}` — retire (existing spaces keep their
  applied version).

#### 14.7.3 Apply semantics (idempotency, reconciliation, transactions)
- **Idempotent by `external_id`.** First apply creates; subsequent applies reconcile
  to the (possibly upgraded) template. This makes "provision on project creation"
  safe to call unconditionally and safe to retry.
- **Never destructive by default.** Reconcile/enforce only *add* folders and
  *adjust ACLs/metadata* to match; they never delete user folders or content. Removal
  is an explicit, separately-scoped operation.
- **Best-effort with a full report, not silent partial.** A multi-node apply returns
  per-node `action`/`warnings`; a mid-apply failure leaves a consistent, resumable
  state (re-apply completes it). `dry_run` lets the caller preview before committing.
- **Drift reporting** (`GET`/inspect) surfaces where a space diverged from its
  template so an operator/integration can choose to `enforce`.

#### 14.7.4 Authorization & scope
- Requires an **integration service token** (`sub = integration_id`,
  `amr:["integration"]`, `provisioning` capability). No user roles, no ACL bypass.
- Enforced ceilings from the registry `provisioning_scope` (§14.1): allowed
  **tenant(s)**, allowed **root prefix(es)** (spaces may only be created under
  them), allowed **template ids**, and allowed **principals/roles** it may grant
  (e.g. may bind `role:project:*` but never `system_admin`).
- The integration's service identity must hold **create + MANAGE_ACL on its scoped
  root** — established once at registration (grant on the root), so provisioning
  writes are ordinary ACL-checked core operations, not a privileged bypass.
- Rate-limited per `integration_id`; server-to-server only (not CORS-exposed).

#### 14.7.5 Audit
New events into the tamper-evident chain, each `{ integration_id, tenant,
template_id, version, space_uid, external_id, mode, outcome, source_ip }`:
`provisioning.space_applied`, `provisioning.space_reconciled`,
`provisioning.space_deleted`, and (admin) `provisioning.template_changed`.

#### 14.7.6 Boundary with identity (roles/members)
Provisioning manages **structure + ACL + metadata**, binding to roles/claims that
already exist. **Creating roles/groups and managing membership stays in the shared
directory** (the integrator writes to the common LDAP, or uses an ldap_manager
admin surface) — consistent with Posture B (§5.0) and the source-of-truth boundary.
This keeps provisioning from becoming a second, competing identity authority. (A
convenience "ensure these role bindings exist" hook may be considered later, but
role lifecycle is out of the provisioning surface's V1 remit.)

#### 14.7.7 Home / implementation
Templates + apply orchestration live in the **config service (ldap_manager) + core**;
all folder/ACL/metadata writes go through the **core** (so existing ACL, versioning,
audit, and tenancy invariants hold unchanged). The **template editor** is an admin
surface in the official SPA (alongside the §14.1 *Integrations* UI), never the embed
kit. The composable primitives (`POST /v1/dirs/{uid}`, `POST /v1/nodes/{uid}/permissions`)
remain available to an in-scope integration token for bespoke needs, but templates
are the intended, auditable path.

### 14.8 V1 scope note

Per the V1 goals (§12), the following upstream items are **committed for V1**, not
deferred: the integration registry + SPA *Integrations* credential UI (§14.1), the
delegated exchange endpoint incl. the integration service token (§14.2), and the
provisioning surface + space templates (§14.7). The multi-origin CORS allow-list
(§14.6) is a prerequisite for any real embed and ships with them. Deep-link SSO
(§5.5 / §14.6) remains M5 unless pulled forward.
