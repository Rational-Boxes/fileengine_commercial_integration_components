# FileEngine Embedding Kit — Specification

MIT-licensed, embeddable, à la carte **end-user** document functionality for
third-party ("host") commercial applications, built as dependency-free W3C Web
Components. Session support is FileEngine-side + client-direct; an integrator-side
server is not required for popup-OAuth (a tiny signing shim is needed only for the
delegated profile) — see §6.

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
| Profile / auth | Handled by **session support** (§6: FileEngine-side + client-direct; no mandatory server), not shipped as components | 2FA policy, user provisioning |
| Integration credentials | (nothing) | Allocated by a **deployment/cluster management CLI** (operator, deployment-level config); the SPA shows read-only status only (§14.1) |
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
        ▲ refresh / SSO — client-direct         ▲ OAuth popup → callback page
        │                                        │  (FileEngine edge / http_bridge)
   (no integrator server for popup-OAuth)   FileEngine IdP
        │
   delegated profile only: tiny assertion-signing shim on the integrator's
   existing backend (holds the integration key) → POST /v1/auth/exchange
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
4. **Session support (no mandatory server, §6)** — the handshake needs **no
   integrator-side bridge** for popup-OAuth: the browser-facing callback + config are
   hosted **FileEngine-side (edge / http_bridge)**, and refresh / SSO / logout are
   **client-direct** to FileEngine. The *only* integrator-side piece is a tiny
   assertion-signing shim for the delegated profile (holds the integration key). A
   Node/Express bridge is shipped as an **optional reference**, never a data proxy.

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

**Bespoke deployment per external SaaS (deployment policy).** FileEngine embedding is
**not offered on a shared, generic multi-tenant instance.** Each external SaaS that
leverages FileEngine gets its **own bespoke deployment** — dedicated to that
integrator, and itself multi-tenant across *that SaaS's* tenants. So a deployment
serves **one integration** (its external-app stack), which is **deployment-wide** (not
per-tenant) and **spins up many tenants dynamically**: the external app creates each
tenant's OU in the shared LDAP, then the provisioning surface (§14.7) adopts it and
stands up its spaces/automation/resources. `allowed_tenants` is therefore the whole
deployment, and provisioning validates each tenant against LDAP as it is encountered
rather than from a fixed enumerated list. (Per-integration namespacing, §14.1, is kept
for robustness even though a deployment normally has a single integration.)

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
- **Centralized management:** the allow-lists are not hand-maintained per service —
  the **integration management CLI (§14.9)** derives them from each integration's
  registered `domains`, keeping "who's registered" and "who's CORS-allowed" consistent
  by construction (and closing domains automatically on revoke).

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

## 6. Session support — where each piece lives (no mandatory bridge server)

A standalone Node/Express bridge is **not strictly required.** The handshake
decomposes into pieces that each belong on the side holding the relevant trust; only
**one** piece is inherently integrator-side, and it is tiny. The FileEngine-side,
browser-facing pieces move to the edge; everything else is client-direct. So a
dedicated bridge server is an **optional reference implementation** (§6.4), not a
required component — and **popup-OAuth needs no integrator server at all.**

| Piece | Needs a server? | Where it lives |
|---|---|---|
| OAuth login-start redirect | no | client builds the FileEngine OAuth URL directly |
| OAuth callback (postMessage) page | no (static) | **FileEngine edge / http_bridge** (browser-facing, allowlisted) |
| Token refresh | no | client → FileEngine `/v1/auth/refresh` **directly** (CORS) |
| Deep-link SSO hand-off | no | client → FileEngine `/v1/auth/sso/handoff` **directly** |
| session/config | no | static, or a small FileEngine-side endpoint |
| Delegated assertion signing | **yes — integrator-side** | a tiny shim on the integrator's **existing** backend (holds the integration key) |
| Credential-passthrough Basic→token | yes — integrator-side | same shim, only if that profile is used |

### 6.1 FileEngine-side embed support (edge / http_bridge)
The browser-facing, no-secret pieces live on the FileEngine side:
- **OAuth callback page** — a small static page (served by the FileEngine edge /
  http_bridge, or the SPA vhost) that reads the token from the URL fragment and
  `postMessage`s it to the opener with a validated `targetOrigin` (the embedding
  domain, carried in the OAuth `state`, checked against the allow-list). Being
  FileEngine-origin, its `return_to` is trivially allowlisted.
- **session/config** — optional small endpoint (or static file) returning non-secret
  client config (service base URLs, enabled modules, tenant, theme defaults).
- **Placement:** these are browser-facing → the **public edge (http_bridge / SPA
  vhost)**, **not** the internal provisioning service (which is server-to-server and
  not browser-exposed). Server-to-server integration support may live in the
  provisioning/integration service; browser-facing session support does not.
  (Upstream item §14.6.)

### 6.2 Client-direct (no relay)
The client holds the JWT and CORS allows the embedding origin (§5.4), so the embed
kit calls FileEngine **directly** — no relay:
- **Refresh** — `POST /v1/auth/refresh` (Bearer), driven by `API_REST`'s
  401→re-auth→replay.
- **Deep-link SSO** — `POST /v1/auth/sso/handoff` (Bearer).
- **Logout** — `DELETE /v1/auth/token`.

### 6.3 Integrator-side signing shim (delegated profile only)
The **one** piece that must stay integrator-side: signing the RFC-7523 assertion with
the **integration private key** — whoever holds it *is* the integration, so FileEngine
must not hold it (or the separation/attribution collapses, §5.2). It is a few lines on
the integrator's **existing** backend: (1) build + sign `{iss, sub, tenant, aud, exp}`
with the integration key; (2) `POST /v1/auth/exchange` → `{token}`; (3) hand the token
to the embed (same-origin to the host). Shipped as a small **SDK/reference** (a Node
implementation + a language-agnostic spec), implementable in any stack — **not** a
mandatory standalone service. (Credential-passthrough's Basic→token is the same shape.)

### 6.4 Optional reference bridge (`bridge/` in this repo)
For integrators who prefer a drop-in over adding code to their backend, the repo ships
an **optional** minimal Node/Express reference bundling §6.3 (and, for dev, local
copies of the §6.1 pages). Convenience/reference only, **not** a required deployment,
and **never a data proxy** (§6.5).

### 6.5 Explicit non-goal — no data proxy
Nothing in the session support proxies REST/WebSocket/streaming traffic or holds the
token server-side. The JWT lives in the client; document traffic is client ↔ FileEngine
directly, governed by CORS (§5.4) + ACLs.

### 6.6 Config (only if the reference bridge / signing shim is used)
`HOST_ORIGIN` (postMessage target), `FILEENGINE_BRIDGE_URL` (:8090),
`FILEENGINE_SPA_URL` (deep-link base); and — delegated only — `FE_INTEGRATION_ID` +
`FE_INTEGRATION_PRIVATE_KEY` (server-only, never shipped to the browser; **never** the
global `FILEENGINE_JWT_SECRET`).

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

### 8.1 Framework integration — Vue 3 (and vanilla / React)

The components are plain custom elements, so they drop into any framework. **Vue 3
is a first-class target** — it renders and binds custom elements natively. A worked
Vue 3 example ships in `examples/vue3/`.

**One-time Vite/Vue config** — tell the compiler `<fe-*>` are custom elements so Vue
doesn't try to resolve them as Vue components:
```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
export default {
  plugins: [vue({ template: { compilerOptions: {
    isCustomElement: (tag) => tag.startsWith('fe-'),
  } } })],
}
```

**A component (à la carte imports, props in, events out, theming):**
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import '@fileengine/embed/core'             // registers <fe-session>
import '@fileengine/embed/file-browser'     // registers <fe-file-browser>
import '@fileengine/embed/document-preview' // …import only what you use

const base = 'https://files.example.com'    // FileEngine base (session config)
const tenant = 'acme'
const currentUid = ref('root')

const browser = ref<HTMLElement | null>(null)
onMounted(() => {
  // fe:* events are namespaced (contain a colon) → bind via addEventListener,
  // which is the robust path in Vue templates for colon-named events.
  browser.value?.addEventListener('fe:select', (e: Event) => {
    currentUid.value = (e as CustomEvent).detail.uid
  })
})
</script>

<template>
  <!-- one session provider; components discover it over the JSUM bus -->
  <fe-session :base="base" :tenant="tenant"></fe-session>

  <div class="fe-theme">
    <!-- Vue sets these as element properties when defined, else attributes;
         reactive refs flow in and the components update. -->
    <fe-file-browser ref="browser" folder="root"></fe-file-browser>
    <fe-document-preview :uid="currentUid" markup></fe-document-preview>
  </div>
</template>

<style>
/* Theme via CSS custom properties — they pierce Shadow DOM (§7). */
.fe-theme {
  --fe-color-bg: #fff; --fe-color-fg: #111; --fe-accent: #2563eb;
  --fe-radius: 10px; --fe-font: Inter, system-ui, sans-serif;
}
</style>
```

**Notes / gotchas:**
- **Props:** Vue 3 sets a bound value as a DOM *property* when the custom element
  defines it (our components do), else as an attribute — so `:uid`, `:config`
  (objects/arrays) work without the `.prop` modifier. Primitive attributes
  (`folder="root"`) are equivalent.
- **Events:** the `fe:*` events carry a colon; prefer `addEventListener` on a
  template `ref` (above). Simple `@`-listeners work for any non-namespaced events the
  kit also emits.
- **SSR / Nuxt:** custom elements are client-only — render under `<ClientOnly>` or
  gate registration in `onMounted` to avoid a server-side `document` reference.
- **Reactivity model:** *events out, props/refs in* — a component emits (`fe:select`),
  the host updates Vue state, and passing it back down (`:uid`) drives the next
  component. No two-way binding magic; just DOM props + events.
- **React/vanilla:** identical pattern — React ≥19 sets custom-element props directly
  (earlier versions: use a `ref` + set properties / `addEventListener`); vanilla just
  imports the module and sets attributes.

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
  bridge/            → OPTIONAL Node/Express reference (signing shim; §6.4) — not required
  examples/          → host-page demos: vue3/ (first-class, §8.1), react/, vanilla/, plain HTML
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
- Delegated exchange holds **no impersonation secret**: FileEngine stores only the
  integration's imported **public** key (§14.1), the global `FILEENGINE_JWT_SECRET`
  is never distributed, the private key stays with the external system, and every
  mint is audited (§14.3) with short-TTL tokens.
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
   - Integration **registry** (deployment config: public keys + scopes) + a
     **deployment/cluster management CLI** to allocate/rotate/revoke; SPA read-only
     status only — §14.1.
   - `POST /v1/auth/exchange` for **delegated-user** *and* **integration-service**
     tokens — §14.2; `auth.delegated_issue` audit.
   - **Provisioning surface** (inline blueprints, version-on-metadata) — §14.7 /
     the `fileengine_integration_provisioning` project;
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
   (Vue 3 [§8.1], React, Angular island demos), CDN publish.

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

This is a **proposal for the core FileEngine stack** (http_bridge exchange +
deployment-config registry + management CLI + official-SPA read-only status; role
lifecycle still via ldap_manager/LDAP), not the embed kit itself. It is the
prerequisite for the delegated silent-session
profile (§5.2) and the "tight integration" headline. It is additive and does not
change existing auth. Applies to **Posture B** integrators (§5.0) with a shared
LDAP source-of-truth.

### 14.1 Integration registry + management CLI (deployment-operator) — **V1**

An **inter-server integration credential** is a first-class identity representing a
whole embedding application (not a user). It is **dual-purpose**: it can (a) mint
delegated end-user sessions (§14.2) and (b) call the provisioning surface (§14.7) to
stand up the structures that application needs. Both capabilities and their scopes
are declared on the registry entry.

**Unified around one asymmetric keypair — not separate service credentials.** A
single **public/private key set** authorizes *both* jobs: the integration signs an
RFC-7523 assertion and `POST /v1/auth/exchange` mints the appropriate token type
(delegated-user *or* integration-service, per the requested audience + capabilities,
§14.2). There are deliberately **no separate, symmetric `key:secret` service
credentials** for provisioning vs. session hand-off. Unifying on the keypair means:
one credential to store (public key in deployment config, §14.1), rotate, revoke, and
audit; FileEngine never holds anything forge-capable; and a consistent, attributable
trust root for every integration action. (This supersedes the idea of using
ldap_manager's existing symmetric service-credential primitive here — that remains for
its narrow existing uses, not for embedding integrations.)

**Allocation is a deployment/cluster operation, not a tenant-admin UI.** Because
integrations are **deployment-wide** (§5.0) and bespoke to the deployment's
external-app stack, allocating/rotating/revoking a credential is an **operator-level**
action performed with a **management CLI for the whole deployment/cluster** (backed by
the deployment-config registry — public keys + scopes, below), **not** a tenant-admin
SPA screen. The CLI:
- **Imports the external system's public key (mandatory).** Integration configuration
  **MUST import the external system's public key / JWKS**: the external system
  generates and **holds its own keypair**, and FileEngine only ever receives the
  **public** key. There is **no** server-side keypair generation — the private key must
  never touch FileEngine (whoever holds it *is* the integration, §14.4). Import is by
  `kid`, supporting multiple keys for rotation.
- **Configures scope** — the `namespace` prefix (§14.1 fields), capabilities,
  tenants, roots, role/action/resource limits — and **rotates** (new `kid`, overlap,
  retire), **enable/disable**, **revoke**.
- Run by whoever operates the deployment (same trust level as deploying the stack).

**Official SPA — read-only visibility only.** The SPA does **not** allocate
credentials; it may surface **read-only** integration status/usage and, crucially,
honor the `managed_by` marker (§14a) so a tenant admin can see *which* integration
manages a space/binding. Creation stays operator/CLI.

**Registry = deployment-level configuration (config files), not a runtime UI DB.**
The integration entries — **public-key storage** and scopes — are **deployment
configuration** provisioned at deploy time (the management CLI / Ansible writes them
into the deployment's config, alongside the other service config), and **loaded by
the services that need them** (chiefly `http_bridge` for assertion verification +
scope minting at §14.2). This suits deployment-wide, bespoke integrations and keeps
public keys in the operator's config management, not a tenant-editable store. Each
entry:
- `integration_id` (issuer identifier used in the assertion `iss`).
- **Public key(s) / JWKS** by `kid` (asymmetric; RSA-2048+/EC-P256) — **imported from
  the external system** and stored in deployment config; FileEngine holds only public
  keys, never a private key or anything forge-capable.
- **`capabilities`** — any of `session_exchange`, `provisioning`.
- `allowed_tenants` — typically **deployment-wide (all tenants)**: an integration is
  deployment-scoped and spins up tenants **dynamically**, so this defaults to any
  tenant (a pattern may sub-scope). The deployment is bespoke to the integration's
  external-app stack (§5.0).
- `subject_scope` — which subjects it may assert for session exchange (e.g. any
  member of an allowed tenant; optionally restricted to a subtree/filter). Unknown
  subject ⇒ reject (pre-provisioned only, v1).
- `role_cap` (optional least-privilege ceiling; §5.2) and `ttl_cap` (≤ `token_ttl`).
- **`provisioning_scope`** — the root folder(s)/prefix under which it may create
  space structures, and the **roles** it is permitted to apply (§14.7).
- **`namespace`** — a **prefix bound to this credential** at creation, used to
  namespace the tenant-scoped resources the integration provisions (classifier sets,
  notify templates, …) so two integrations never collide on a shared name. Carried in
  the integration-service token as `prov_namespace`; authoritative, not caller-settable.
- **`domains`** — the embedding **origin(s)** (scheme+host+port) this integration
  serves from. These are the source of truth for the browser-origin **CORS allow-lists**
  (§5.4): the management CLI (§14.9) turns them into each browser-facing service's
  allow-list. Optionally per-service/module, matching the integration's enabled modules.
- **`allowed_ips`** — the integration's **known source IP(s)/CIDR(s)** (its backend's
  egress addresses). A **defense-in-depth IP allow-list** on the *server-to-server*
  surfaces (§14.2a): a valid request must originate from one of these, so a compromised
  **private key alone is not enough** — the attacker must also be on a known network.
  Deployment config, set via the CLI (§14.9).
- `enabled`, `created/rotated_at`, audit metadata.

### 14.2 Exchange endpoint (http_bridge — owns HS256 session minting)

**The imported public key is the single authorization gate for both operation
classes.** Every **provisioning** call and every **user session hand-off** is
authorized by the *same* check: verifying an assertion **signed by the integration's
private key** against the **imported public key** (§14.1). No valid signature ⇒ no
token, for either job. One key set gates everything the integration can do; revoking
it (removing the public key from deployment config) instantly closes both.

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
provisioning scope (bounded by `provisioning_scope`, plus the credential's
`namespace` as `prov_namespace` and any `prov_actions`/`prov_resources` limits) —
**no user roles, no ACL bypass**. It authorizes only the §14.7 provisioning routes,
still enforced by core ACLs on the target roots. This keeps one credential for both jobs while
keeping the two token *types* (delegated-user vs integration-service) distinct and
separately auditable.

Notes: this endpoint is server-to-server (the integration's backend / the kit's
Node bridge). Rate-limit per `integration_id`; it is a `/v1` route so it can carry
the same monitoring/allow-list posture as the rest of the bridge.

### 14.2a IP allow-list — defense-in-depth on the server-to-server surfaces
An additional network gate on the **provisioning + session-relay (exchange)** surfaces:
a valid request must originate from the integration's **known source IP(s)** (§14.1
`allowed_ips`), so that a **compromised private key alone is insufficient** — the
attacker would also have to operate from a whitelisted network (hard to do over TCP).
- **Where it applies.** Both **server-to-server** chokepoints: `POST /v1/auth/exchange`
  (the mint point for *both* token types) and the **provisioning API** (:8100). Not the
  end-user session token's *usage* — that token is used from arbitrary end-user browsers,
  which can't be IP-restricted; but it can only be **minted** by an exchange call from a
  known IP, which is the correct chokepoint.
- **Exchange gate.** After signature/audience/`exp`/`jti` checks (§14.2) and before
  minting, the bridge verifies the request's client IP ∈ `allowed_ips`; reject + audit
  otherwise. Empty `allowed_ips` ⇒ the gate is disabled for that integration (opt-in),
  though it is recommended for every integration.
- **Token binding for downstream enforcement.** The integration-service token carries
  the integration's `allowed_ips` as an **`aip`** claim (mirrors the bridge's existing
  IP-bound `mip` pattern) so the **provisioning service re-checks** the source IP itself
  — a leaked/replayed integration-service token can't be used from an off-list host.
- **Trusted-proxy correctness.** Behind the edge (nginx), the real client IP is derived
  from `X-Forwarded-For` under a **trusted-proxy** config (the platform already does this
  for audit) — the allow-list matches the *derived* client IP, never the proxy's.
- **Layered, not sole.** This sits *on top of* the asymmetric-key gate (§14.2) and core
  ACLs; it narrows the blast radius of a key compromise, it is not a replacement for
  key hygiene.

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
- **One credential, one trust root.** The same keypair authorizes both provisioning
  and session hand-off — no second, symmetric service-credential surface to leak or
  manage; a single rotate/revoke covers everything the integration can do.
- **IP allow-list backstop (§14.2a).** The server-to-server surfaces additionally
  require a known source IP, so a **compromised private key is not sufficient** on its
  own — a defense-in-depth second gate, enforced at both the exchange mint point and
  (via the `aip` claim) the provisioning service.

### 14.5 Effort / touch points (upstream)
- **Integration registry = deployment config** (config files: public keys + scopes),
  provisioned via the management CLI / Ansible and loaded by `http_bridge` — not a
  runtime DB/UI (§14.1).
- **Integration management CLI (operator, `scripts` deploy repo):** import public
  keys, allocate/rotate/revoke credentials, set scopes/namespace/domains, **and
  centralize the CORS allow-lists** across browser-facing services from each
  integration's `domains` — writing deployment config, rolled out via Ansible (§14.9).
  Not a tenant-admin UI.
- **Official SPA (AGPL client):** **read-only** integration status/usage and honoring
  the `managed_by` marker (§14a); it does **not** allocate credentials. (Provisioning
  blueprints are inline, not stored — no template editor; see the
  `fileengine_integration_provisioning` project.)
- `http_bridge`: `/v1/auth/exchange` (delegated-user **and** integration-service
  tokens) + assertion verification (extend `jwt.h` with RS256/ES256 verify + JWKS)
  + delegation/integration claims in `mintJwt`; multi-origin CORS allow-list (§14.6).
- `core`: provisioning writes go through the core's existing dir/ACL/metadata ops
  (no new write path); integration service-identity gets create+MANAGE_ACL on its
  scoped root at registration.
- `EVENT_CONTRACT`/audit: register `auth.delegated_issue`, `provisioning.*`.
- Docs: integration onboarding (key registration, assertion format, scopes,
  template authoring).

### 14.6 Related upstream items (CORS allow-list + edge callback + deep-link SSO)

Small upstream additions the embedding model depends on:

- **Embed OAuth callback + config at the edge (§6.1).** So popup-OAuth needs **no
  integrator-side server**, FileEngine hosts a tiny static **embed callback page**
  (reads the token fragment, `postMessage`s to the opener with a `state`-derived,
  allow-listed `targetOrigin`) at the edge / http_bridge / SPA vhost, plus an optional
  `session/config`. Its `return_to` is FileEngine-origin, so trivially allowlisted.
  Browser-facing → the public edge, **not** the internal provisioning service.

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

> **Authoritative spec: the dedicated `fileengine_integration_provisioning`
> project** (AGPL FastAPI service, port `8100`). The sketch below is retained as
> orientation; that project supersedes it and has refined the model. Key deltas to
> read there: (1) **no stored template library** — the integration endpoint accepts
> a **rich inline JSON blueprint** per call (blueprints live in the integrator's
> system); (2) **versioning is stamped on the space root folder metadata**
> (`provision.version` …) for the embedder to inspect, and **upgrade is the embedding
> application's responsibility** (inspect → re-apply); (3) blueprints include
> **per-space automation** (`actions`) whose folder references use `${node:<path>}`
> resolved to the space's fresh UUIDs (folder_actions bindings can't be cloned by
> UUID); (4) a **per-space setup API** to tune automation (webhook context maps,
> notify recipients, secrets) post-provision.

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

**Templates:** *superseded* — the dedicated project has **no stored template store /
template CRUD** (see the banner above); blueprints are passed inline per call and
versioning is stamped on the space root metadata. The `/v1/provisioning/templates`
endpoints once sketched here do **not** exist in the authoritative design.

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
Apply orchestration lives in the **dedicated `fileengine_integration_provisioning`
service (AGPL, :8100)**; all folder/ACL/metadata writes go through the **core** (so
existing ACL, versioning, audit, and tenancy invariants hold unchanged). *(Superseded
detail: there is no stored-template editor — blueprints are inline, §14.7 banner.)*
The composable primitives (`POST /v1/dirs/{uid}`, `POST /v1/nodes/{uid}/permissions`)
remain available to an in-scope integration token for bespoke needs, but blueprints
are the intended, auditable path.

### 14.8 V1 scope note

Per the V1 goals (§12), the following upstream items are **committed for V1**, not
deferred: the integration registry (deployment config) + management CLI (§14.1), the
delegated exchange endpoint incl. the integration service token (§14.2), and the
provisioning surface (inline blueprints, version-on-metadata; the
`fileengine_integration_provisioning` project) (§14.7). The multi-origin CORS allow-list
(§14.6) is a prerequisite for any real embed and ships with them. Deep-link SSO
(§5.5 / §14.6) remains M5 unless pulled forward.

### 14.9 Integration management CLI (deployment/operator) — integrations + CORS

A single **operator CLI** is the authoritative place to manage integrations **and**
the embedding-domain **CORS allow-lists** they imply. It is **deployment tooling**
(lives in the `scripts` deploy repo, run by whoever operates the cluster — the same
trust level as deploying the stack), not the MIT embed kit and not a tenant UI. It
writes/maintains the **deployment config** (public keys, scopes, CORS) that the
services load, and rolls it out via Ansible. It backs the §14.1 registry.

**Integration management:**
- `fe-int add <integration_id> --pubkey <pem|jwks> [--kid <id>] --namespace <prefix>
  --capabilities session,provisioning [--tenants '*'|<pattern>] [--roots <path,…>]
  [--role-cap <…>] [--actions <…>] [--resources <…>] --domains <origin,…>
  --allowed-ips <ip|cidr,…>` — **import the external system's public key** (§14.1;
  never a private key), set scopes/namespace, embedding **domains** (CORS), and the
  **source-IP allow-list** (§14.2a defense-in-depth).
- `fe-int list | show <id> | enable <id> | disable <id> | revoke <id>` — lifecycle.
  `revoke` removes the public key ⇒ closes **both** provisioning and session at once
  (§14.2) and drops the integration's domains from CORS.
- `fe-int rotate <id> --add-key <pem> --kid <new> [--retire <old-kid>]` — key
  rotation with an overlap window.

**CORS centralization (the payoff):**
- Each integration declares its embedding `domains` (§14.1); the CLI is the **one
  place** that turns those into the per-service CORS allow-lists — no hand-editing N
  service configs, no drift between "who's registered" and "who's allowed".
- `fe-int cors sync` recomputes every **browser-facing** service's allow-list —
  `HTTP_CORS_ORIGINS` (http_bridge) + `CSAI_CORS_ORIGINS` / `DISC_CORS_ORIGINS` /
  `BCF_CORS_ORIGINS` / `FA_CORS_ORIGINS` — as the **union of enabled integrations'
  domains**, scoped to the services/modules each integration actually uses (§5.4 à la
  carte). The **provisioning** service (:8100) is server-to-server, not browser-facing,
  so it is excluded. Never `*`.
- `fe-int apply` writes the deployment config and triggers the reload/redeploy.
- Net: registering an integration + its domains is **one** operation that keeps
  credentials, scopes, and CORS **consistent by construction** — the operator can't
  forget to open a domain on add, or (critically) to **close** it on revoke.

**Relation to the edge CORS work (§14.6).** The multi-origin `HTTP_CORS_ORIGINS`
allow-list on http_bridge is the *mechanism*; this CLI is the *management surface* that
populates it (and the downstream lists) from the integration registry — so §5.4's
"CORS is strictly FileEngine's responsibility" has a concrete, centralized operator
workflow.
