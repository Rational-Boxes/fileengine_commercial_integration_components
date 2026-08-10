# FileEngine — Integrator's Guide

**Embed FileEngine document capabilities into your own application** — file browsing,
preview, upload, search, comments, metadata, and download — as drop-in Web Components,
authenticated on behalf of your users, with no server-side data proxy.

This guide is for engineers integrating the **commercial embedding kit**
(`@fileengine/embed-core` + `@fileengine/embed-components`, MIT) and, optionally, the
**provisioning service** (AGPL) that scripts new project spaces.

> **Terminology.** *FileEngine* is the document platform (a gRPC core fronted by an
> HTTP bridge on `:8090`, plus search `:8092`, discussion `:8094`, BCF `:8098`).
> *Integration* is your registered application. *Integrator / host app* is your web app
> that embeds the components. *Delegated user* is one of your end-users, on whose behalf
> the integration mints a FileEngine session.

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [How authentication works](#2-how-authentication-works)
3. [Prerequisites & registration](#3-prerequisites--registration)
4. [Quick start (10 minutes)](#4-quick-start-10-minutes)
5. [The session core — `<fe-session>`](#5-the-session-core--fe-session)
6. [Component reference](#6-component-reference)
7. [Inter-component coordination](#7-inter-component-coordination)
8. [Obtaining a session — the three profiles](#8-obtaining-a-session--the-three-profiles)
9. [Cross-origin (CORS) setup](#9-cross-origin-cors-setup)
10. [Provisioning project spaces](#10-provisioning-project-spaces)
11. [Framework integration](#11-framework-integration)
12. [Theming](#12-theming)
13. [Security model](#13-security-model)
14. [Troubleshooting](#14-troubleshooting)
15. [Reference](#15-reference)

---

## 1. Architecture at a glance

The kit is **W3C Web Components only** — no framework runtime. Each capability is an
independent ES module you import à la carte; the only shared dependency is the session
core. Nothing is bundled that you don't use.

```
Your host app (your origin, e.g. https://app.acme.com)
├─ <fe-session base tenant> ............ non-visual session/context provider
│     └─ holds the token + per-service API clients + the WebSocket companion
├─ <fe-file-browser> ................... à la carte components, each its own ES module,
├─ <fe-document-preview> ............... coordinating over events (not imports)
├─ <fe-uploader> / <fe-search> ......... 
├─ <fe-comments> (live WebSocket) ......
└─ <fe-metadata> / <fe-download> .......
                   │
                   │  Bearer <jwt>  (+ X-Tenant)          the ONE token is accepted by
                   ▼                                       every FileEngine service (§4.2)
   FileEngine services (their origins, CORS-allow your origin)
     http_bridge :8090   search :8092   discussion :8094   bcf :8098
```

Two design rules make this safe and decoupled:

- **One token, whole stack.** A single bridge-issued **HS256 JWT** authenticates every
  service. The kit obtains one token and forwards it as `Authorization: Bearer <jwt>`
  (plus `X-Tenant` when needed) to files, search, discussion, and BCF. No per-service
  login.
- **The bridge is handshake-only, never a data proxy.** Your browser talks **directly**
  to each FileEngine service (CORS-gated). The only integrator-side server code you
  *may* run is a tiny assertion-signing shim (see §8) — never a data relay.

### Packages

| Package | License | Contents |
|---|---|---|
| `@fileengine/embed-core` | MIT | `SessionManager`, `connect()`, `SessionProvider`, `<fe-session>`, `LiveSocket`, `API_REST`, JSUM `multicall` |
| `@fileengine/embed-components` | MIT | `<fe-file-browser>`, `<fe-document-preview>`, `<fe-uploader>`, `<fe-search>`, `<fe-comments>`, `<fe-metadata>`, `<fe-download>` |
| `fileengine_integration_provisioning` | AGPL | The provisioning service (`:8100`) — scripts new spaces from inline blueprints |

---

## 2. How authentication works

FileEngine issues **short-lived session tokens** (default 15 min) that are re-minted from
live directory data — so a user's role changes (or revocation) take effect within about
one refresh interval. Your integration never handles a user's FileEngine password.

Your integration is registered with FileEngine by importing **one asymmetric public
key**. The matching **private key stays with you** and is used to sign short-lived
*assertions* (RFC 7523 `jwt-bearer`) vouching for a user. FileEngine verifies the
assertion against your public key and mints that user a real session.

```
  Your backend                     FileEngine bridge (:8090)
  (holds the private key)          (holds only your public key)
       │  1. sign assertion             │
       │     { iss, sub, aud, exp,      │
       │       jti, tenant, token_type }│
       │  2. POST /v1/auth/exchange ───▶│  3. verify signature (RS256/ES256)
       │        grant_type=jwt-bearer   │     check iss / aud / exp / jti(replay)
       │        assertion=<jwt>         │     resolve the delegated user in the directory
       │  4. { access_token } ◀─────────│     mint an IP-bound session token
       ▼
  hand the token to the browser → the components use it
```

There are **two exchange outcomes**, chosen by the assertion's `token_type`:

- **`delegated`** (default) — a session **for one of your end-users** (`sub` = their
  directory uid). Roles resolve live from the directory. This is what powers the
  embedded UI.
- **`service`** — a session **for the integration acting as itself** (`sub` = a service
  principal). Roles come from deployment config (not the directory). Marked `svc:true`.
  Used for back-office automation (e.g. provisioning). Off unless the deployment enables
  it.

The kit also supports two *interactive* ways to get a session that need **no**
integrator server (see §8): **popup-OAuth** (against a FileEngine-configured IdP) and a
**password login** (directory credentials, the "passthrough" profile).

---

## 3. Prerequisites & registration

**You need, from the FileEngine operator:**

1. The base URLs of the services you'll use, e.g.
   `https://files.example.com` (bridge), `https://search.example.com`,
   `https://discuss.example.com`.
2. Your **integration issuer id** (e.g. `acme-crm`) and the **exchange audience**
   (usually `<bridge>/v1/auth/exchange`).
3. Confirmation that your **host origin(s)** are on each service's CORS allow-list
   (§9) and, for popup-OAuth, that your callback URL is allow-listed.

**You provide to the operator:**

1. A **public key** (RSA or EC/P-256, PEM/SPKI). Generate a keypair; keep the private
   key secret. Example:

   ```bash
   # RSA
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out integration.key
   openssl pkey -in integration.key -pubout -out integration.pub
   # or EC / ES256
   openssl ecparam -name prime256v1 -genkey -noout -out integration.key
   openssl pkey -in integration.key -pubout -out integration.pub
   ```

The operator configures the bridge with your issuer + public key (see the deployment
env in §15). Optionally they pin an **IP allow-list** (`INTEGRATION_ALLOWED_IPS`) — the
caller IP of a successful exchange is stamped into the token's `aip` claim.

---

## 4. Quick start (10 minutes)

A minimal host page that mounts the browser + preview and drives a session by delegated
exchange. (Replace the import URLs with your local `dist/` or CDN paths.)

```html
<script type="module">
  import '@fileengine/embed-core'              // registers <fe-session>
  import '@fileengine/embed-components/file-browser'
  import '@fileengine/embed-components/document-preview'

  // 1) One session provider, configured for your FileEngine + tenant.
  const fe = document.createElement('fe-session')
  fe.setAttribute('base', 'https://files.example.com')
  fe.setAttribute('tenant', 'acme')
  fe.setAttribute('host-origin', location.origin)
  document.body.appendChild(fe)
  const provider = fe.getSession()

  // 2) Get a session. In production your backend signs an assertion and returns the
  //    token; here we assume you fetched it and set it directly:
  const { access_token, expires_in } = await (await fetch('/my-backend/fe-session')).json()
  provider.setSession(access_token, expires_in)

  // 3) Mount components; wire selection -> preview.
  const browser = document.createElement('fe-file-browser'); browser.setAttribute('folder', 'root')
  const preview = document.createElement('fe-document-preview')
  document.body.append(browser, preview)
  browser.addEventListener('fe:select', e => preview.open(e.detail.uid))
</script>
```

That's it — the components discover `<fe-session>`, borrow its authenticated client, and
render. A `401` from any service automatically triggers a refresh + replay.

> **Want a runnable reference?** `examples/host-harness/` is a zero-dependency mock host
> app that exercises every component + all three session profiles over an ngrok tunnel.
> See its `README.md`.

---

## 5. The session core — `<fe-session>`

`<fe-session>` is a **non-visual** custom element. It holds the token, one API client
per FileEngine service (all sharing the token), and the WebSocket companion. Sibling
components discover it at runtime — they never import it.

### Attributes

| Attribute | Meaning |
|---|---|
| `base` | FileEngine bridge base URL (e.g. `https://files.example.com`) |
| `tenant` | Active tenant; travels as `X-Tenant` on requests |
| `oauth-provider` | IdP id for popup-OAuth (e.g. `google`); only for that profile |
| `callback-url` | Popup-OAuth callback (defaults to `<base>/session/callback`) |
| `host-origin` | Your origin — the **only** origin trusted for the OAuth `postMessage` |

### Methods (via `element.getSession()` → `SessionProvider`, or on the element)

| Call | Returns / effect |
|---|---|
| `getSession()` | the `SessionProvider` (see below) |
| `client(serviceBase?)` | a connected `API_REST` for a service (defaults to `base`), cached per URL |
| `login(opts?)` | start popup-OAuth; resolves when the token arrives |
| `logout()` | clear the session |
| `getToken()` | the current token, or `null` |

### Events

| Event | `detail` | When |
|---|---|---|
| `fe:session` | `{ active: boolean }` | token set / refreshed / cleared |

### `SessionProvider` (the DOM-free core)

`getSession()` returns a `SessionProvider` you can hold and pass to components (via their
`.provider` property) if you prefer explicit wiring over DOM discovery:

```js
const provider = document.querySelector('fe-session').getSession()
provider.setSession(token, expiresIn)   // install a token you obtained yourself
provider.hasSession()                   // boolean
provider.getToken()                     // string | null
provider.tenant                         // configured tenant
provider.base                           // bridge base URL
const filesApi  = provider.client()                              // files (bridge)
const searchApi = provider.client('https://search.example.com')  // another service, same token
const socket    = provider.liveSocket('wss://…/live?token=…')    // WebSocket companion
provider.onChange(token => { /* login / refresh / logout */ })
```

Every client returned by `client()` is wired for **401 → refresh → replay**: an expired
token is transparently refreshed against FileEngine and the failed call is retried.

---

## 6. Component reference

All components share the same shape: they discover `<fe-session>` (or take an explicit
`.provider`), accept plain HTML attributes, expose imperative methods, and emit
namespaced `fe:*` `CustomEvent`s (`bubbles: true, composed: true`). Import only the ones
you use — importing one never pulls in another.

### `<fe-file-browser>` — list & navigate

```html
<fe-file-browser folder="root"></fe-file-browser>
```

| | |
|---|---|
| **Endpoint** | `GET /v1/dirs/{uid}` |
| **Attributes** | `folder` (uid to list; default `root`), `tenant` |
| **Methods** | `open(uid)`, `refresh()`, `activate(entry)`; getter `entries` |
| **Events** | `fe:select` `{ uid, entry }` (a file activated) · `fe:navigate` `{ uid, entry }` (a folder entered) |

### `<fe-document-preview>` — render a rendition

```html
<fe-document-preview uid="…" markup></fe-document-preview>
```

| | |
|---|---|
| **Endpoint** | `GET /v1/files/{uid}/renditions` (+ authenticated `GET …/content` for the image) |
| **Attributes** | `uid`, `tenant`, `markup` (boolean — opt-in annotation overlay) |
| **Methods** | `open(uid)`; getter `preview` |
| **Events** | `fe:preview` `{ uid, preview, kind }` (`kind` ∈ `image`/`pdf`/`other`) |

### `<fe-uploader>` — write path

```html
<fe-uploader folder="root"></fe-uploader>
```

| | |
|---|---|
| **Endpoints** | `POST /v1/dirs/{uid}/files` (create) → `PUT /v1/files/{uid}/content` (bytes) |
| **Attributes** | `folder` (target dir uid), `tenant` |
| **Methods** | `uploadFiles(FileList)`, `uploadBlob(name, body)` |
| **Events** | `fe:upload` `{ uid, name, folder }` · `fe:upload-error` `{ name, error }` |

### `<fe-search>` — search the search service

```html
<fe-search endpoint="https://search.example.com" placeholder="Search…"></fe-search>
```

| | |
|---|---|
| **Endpoint** | `POST /search` on the **search service** (its own base — set `endpoint`) |
| **Attributes** | `endpoint` (search base; defaults to the bridge), `tenant`, `placeholder` |
| **Methods** | `search(query, { limit, fuzzy })`, `selectHit(hit)`; getter `hits` |
| **Events** | `fe:result-select` `{ uid, name, hit }` |

### `<fe-comments>` — live discussion (WebSocket)

```html
<fe-comments uid="…" endpoint="https://discuss.example.com"></fe-comments>
```

| | |
|---|---|
| **Endpoints** | `GET/POST /files/{uid}/threads` + live `wss://…/files/{uid}/live?token=…` |
| **Attributes** | `uid`, `endpoint` (discussion base), `tenant` |
| **Methods** | `open(uid)`, `post(body, { title, version })` |
| **Events** | `fe:comment` `{ uid, body }` (posted from here) |

New comment/thread events on the open file arrive over the WebSocket and refresh the
list automatically; the socket reconnects with exponential backoff.

### `<fe-metadata>` — key/value editor

```html
<fe-metadata uid="…"></fe-metadata>            <!-- editable -->
<fe-metadata uid="…" readonly></fe-metadata>   <!-- view only -->
```

| | |
|---|---|
| **Endpoints** | `GET /v1/nodes/{uid}/metadata`, `PUT/DELETE …/metadata/{key}` |
| **Attributes** | `uid`, `tenant`, `readonly` (boolean) |
| **Methods** | `open(uid)`, `setKey(key, value)`, `deleteKey(key)`; getter `entries` |
| **Events** | `fe:metadata-change` `{ uid, op: 'set'\|'delete', key }` |

### `<fe-download>` — authenticated download

```html
<fe-download uid="…" label="Download"></fe-download>
```

| | |
|---|---|
| **Endpoint** | `GET /v1/files/{uid}/content` |
| **Attributes** | `uid`, `label` |
| **Methods** | `download(uid?)` |
| **Events** | `fe:download` `{ uid, filename }` · `fe:download-error` `{ uid, error }` |

Content is fetched **with the bearer** (an `<a download>` can't carry `Authorization`),
the filename is parsed from `Content-Disposition`, then a browser save is triggered.

---

## 7. Inter-component coordination

Components are **loosely coupled**. A component emits an event; your host code routes it
to another component's method. Nothing hard-fails if a sibling isn't on the page.

```js
// browser & search both feed the preview + comments + metadata + download
const open = uid => { preview.open(uid); comments.open(uid); meta.open(uid); download.setAttribute('uid', uid) }
browser.addEventListener('fe:select',       e => open(e.detail.uid))
search .addEventListener('fe:result-select', e => open(e.detail.uid))
// refresh the browser after an upload
uploader.addEventListener('fe:upload', () => browser.refresh())
```

Advanced: components can also discover each other over the **JSUM message bus**
(`multicall`) instead of host wiring — but explicit **events-out / methods-in** is the
recommended, framework-friendly pattern.

---

## 8. Obtaining a session — the three profiles

### A. Delegated exchange (recommended for production)

Your backend signs a short-lived assertion for the logged-in user and returns the token.
**Only your backend touches the private key.**

Assertion claims (RS256 or ES256, signed with your private key):

```json
{
  "iss": "acme-crm",                                  // your integration id
  "sub": "alice@acme",                                // the delegated user's directory uid
  "aud": "https://files.example.com/v1/auth/exchange",// the exchange endpoint
  "iat": 1700000000,
  "exp": 1700000120,                                  // short-lived (≤ a couple of minutes)
  "jti": "…unique…",                                  // single-use (replays are rejected)
  "tenant": "acme",
  "token_type": "delegated"
}
```

Exchange it (form-encoded per RFC 7523, or JSON):

```
POST https://files.example.com/v1/auth/exchange
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<the signed jwt>
```

Response: `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 900 }`.
Hand `access_token` to the browser and call `provider.setSession(token, expires_in)`.

A **Node reference signer** ships in `examples/host-harness/lib/integration.mjs`
(`makeSigner`) and the harness's `POST /session/exchange` shows the relay.

### B. Popup-OAuth (no integrator server)

If the FileEngine deployment has an external IdP configured, the user signs in via a
popup and the token is `postMessage`d back — your page is never unloaded:

```js
await provider.login()   // opens <base>/v1/auth/oauth/<provider>, resolves with the token
```

Requires `oauth-provider` + `host-origin` on `<fe-session>`, and the deployment to have
that provider configured (else the bridge returns `{"error":"unknown provider"}`).

### C. Password / passthrough (directory credentials)

For hosts that collect FileEngine directory credentials directly:

```
POST <base>/v1/auth/token      Authorization: Basic base64(user:pass)   X-Tenant: acme
  → { token, token_type, expires_in }
  → or { mfa_required: true, mfa_token, methods: ["totp","email"] }      // if 2FA is enforced

POST <base>/v1/auth/2fa   { "mfa_token": "…", "method": "totp", "code": "123456" }
  → { token, token_type, expires_in }
```

The harness's "Password login" row implements exactly this, including the 2FA step.

### Service tokens (non-delegated)

For the integration acting as itself, sign the assertion with `"token_type": "service"`
and a service-principal `sub`. The bridge mints a token carrying the deployment's
configured service roles, marked `svc:true`. Enabled only when the operator sets
`INTEGRATION_ALLOW_SERVICE=true`.

---

## 9. Cross-origin (CORS) setup

Your host page is on a **different origin** than the FileEngine services, so each service
must allow your origin. FileEngine uses an **exact-match allow-list — never `*`**. The
operator sets, per service:

| Service | Env var |
|---|---|
| http_bridge `:8090` | `HTTP_CORS_ORIGINS` |
| search `:8092` | `CSAI_CORS_ORIGINS` |
| discussion `:8094` | `DISC_CORS_ORIGINS` |
| bcf `:8098` | `BCF_CORS_ORIGINS` |
| provisioning `:8100` | `PROV_CORS_ORIGINS` |

Each is a comma-separated list of full origins (e.g.
`https://app.acme.com,https://portal.acme.com`). `Authorization`, `Content-Type`,
`Range`, and `X-Tenant` are in the allowed-headers set, so Bearer + tenant + range
requests preflight cleanly.

> **Dev tip.** For a genuine cross-origin loop over HTTPS, `scripts/ngrok/` provides
> `ngrok-embedding.yml` + `embedding-up.sh`, which tunnel the harness + services and
> wire the CORS allow-lists to the (dynamic) harness origin automatically.

---

## 10. Provisioning project spaces

The **provisioning service** (`:8100`, AGPL) lets an integration create fully-wired
project spaces — folder tree, ACLs, metadata, **and** per-folder automation (folder-action
bindings: webhooks, notify, sorters, review chains) — from a single **inline JSON
blueprint**. It is a rich *setup* API, not a folder clone.

Authenticated with a bridge-issued **integration token** carrying the `provisioning`
capability and your `prov_*` scope claims (namespace, permitted tenants/actions/
resources) — issued per your registration.

### Apply a space (idempotent by `external_id`)

```
POST https://provision.example.com/v1/provisioning/spaces
Authorization: Bearer <integration token>

{
  "tenant": "acme",
  "external_id": "project-42",           // idempotency key (per tenant+integration)
  "version": "3",                        // your blueprint version, stamped on the root
  "mode": "reconcile",                   // create | reconcile (default) | enforce
  "blueprint": {
    "name": "std-project",
    "params": {                          // typed, validated per-space inputs
      "code":        { "type": "string",    "required": true },
      "lead":        { "type": "principal", "required": true },
      "notify_to":   { "type": "list" },
      "webhook_url": { "type": "url" },
      "webhook_ctx": { "type": "map" }
    },
    "root": {
      "name": "${code}",
      "acls": [{ "principal": "role:${lead}", "allow": ["r","w"] }],
      "children": [{ "name": "Incoming" }, { "name": "Approved" }]
    },
    "actions": [
      { "ref": "route", "folder": "Incoming", "type": "move_review",
        "config": { "on_approved": "${node:Approved}" } },
      { "ref": "hook", "folder": "Incoming", "type": "webhook",
        "config": { "url": "${webhook_url}", "context": "${webhook_ctx}" } }
    ]
  },
  "params": { "code": "ACME", "lead": "eng", "notify_to": ["ops@acme"],
              "webhook_url": "https://acme/hook", "webhook_ctx": { "team": "eng" } }
}
```

**Reference tokens** inside the blueprint:

| Token | Resolves to |
|---|---|
| `${param}` | a param value (scalars inline; `map`/`list` injected whole) |
| `${node:<addr>}` | the created folder's uid (address a folder by name-path, e.g. `Approved`) |
| `${resource:<ref>}` | the id of a tenant-scoped resource declared in `resources` |

`mode`: `create` (fail if exists) · `reconcile` (create-missing, additive,
non-destructive) · `enforce` (also correct drifted ACLs/metadata/action config). Pass
`"dry_run": true` to get the plan without applying. Every provisioned folder + binding
carries a `managed_by` marker, so FileEngine admin UIs flag it as externally managed.

### Inspect / adjust automation without re-authoring (§6.3)

```
GET   /v1/provisioning/spaces/{space_uid}/config     → bindings + params (secrets redacted)
PATCH /v1/provisioning/spaces/{space_uid}/config     { "tenant": "acme",
                                                       "params": { "notify_to": ["new@acme"] } }
```

`PATCH` merges the new automation params and re-renders the affected bindings in place
(idempotent reconcile) — for rotating a webhook context map, changing notify recipients,
etc.

### Other space endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v1/provisioning/spaces?tenant=&external_id=` | list within scope |
| `GET /v1/provisioning/spaces/{uid}` | inspect node map + applied version + drift |
| `PATCH /v1/provisioning/spaces/{uid}` | re-apply / upgrade to a newer blueprint/version |
| `DELETE /v1/provisioning/spaces/{uid}` | soft-delete (recoverable) |
| `POST /v1/provisioning/blueprints/validate` | validate a blueprint (CI aid), no tenant/space |

A **reconcile sweep** CLI (`provisioning-service-reconcile`) reports drift between the
persisted spaces and the live folders/bindings (missing folder, ownership change, version
mismatch) — read-only.

---

## 11. Framework integration

The components are plain custom elements, so they drop into any framework.

### Vue 3 (first-class)

Tell the Vue compiler that `fe-*` are custom elements:

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: t => t.startsWith('fe-') } } })],
}
```

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import '@fileengine/embed-core'
import '@fileengine/embed-components/file-browser'
import '@fileengine/embed-components/document-preview'
const currentUid = ref('root')
const browser = ref<HTMLElement>()
onMounted(() => browser.value?.addEventListener('fe:select',
  e => (currentUid.value = (e as CustomEvent).detail.uid)))
</script>
<template>
  <fe-session base="https://files.example.com" tenant="acme" :host-origin="location.origin" />
  <fe-file-browser ref="browser" folder="root" />
  <fe-document-preview :uid="currentUid" markup />
</template>
```

> `fe:*` events contain a colon, so bind them with `addEventListener` (as above) rather
> than a Vue `@fe:select` template handler.

### React / vanilla

Same idea: render the tags, set attributes/properties, and `addEventListener` for
`fe:*`. Set `.provider` explicitly if you construct `<fe-session>` after the components.

---

## 12. Theming

- **Shadow DOM by default** — each component encapsulates its styles; host CSS doesn't
  leak in. Per-component `light-dom` opt-out is available where you want to fully
  restyle.
- **CSS custom properties** are the theming surface (they pierce Shadow DOM). Wrap your
  components and set the tokens on the wrapper.
- **Light/dark** follows your host page.

---

## 13. Security model

- **Least privilege, short-lived.** Tokens expire quickly (default 15 min) and are
  re-minted from live directory roles, so revocation propagates fast.
- **No password handling.** Delegated + popup-OAuth never expose FileEngine credentials
  to your app. Only the passthrough profile (your choice) collects them.
- **One keypair, private key stays with you.** FileEngine imports only your **public**
  key. Compromise of FileEngine cannot forge your assertions.
- **Short-lived, single-use assertions.** Give assertions a 1–2 minute `exp` and a
  unique `jti`; the bridge rejects replays within the assertion's lifetime.
- **IP allow-list + `aip`.** The operator can restrict exchange callers by IP; the
  caller IP is recorded in the minted token's `aip` claim (defense-in-depth).
- **Exact-origin CORS.** Never `*`. Only the origins you register can call the services
  from a browser.
- **Access is enforced by CORS + ACLs, not the bridge.** Since the bridge is
  handshake-only, the levers to *not* expose a capability are: (a) don't import/enable
  the component, and (b) don't add your origin to that service's allow-list.
- **`managed_by` transparency.** Provisioned folders/bindings are marked, so tenant
  admins can see what an integration controls.

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `{"error":"unknown provider"}` on sign-in | Popup-OAuth used but no external IdP is configured on the bridge. Use delegated exchange or password login instead, or have the operator configure the IdP. |
| `invalid_grant · assertion audience mismatch` | The assertion `aud` ≠ the bridge's expected `INTEGRATION_AUDIENCE`. Set `aud` to exactly `<bridge>/v1/auth/exchange` (or the configured audience). |
| `invalid_grant · unknown delegated user` | `sub` isn't a directory uid in that tenant. Use the user's full directory uid. |
| `invalid_grant · assertion replay` | The `jti` was already used. Generate a fresh `jti` per exchange. |
| `unauthorized_client · ip not allowed` | Your caller IP isn't in `INTEGRATION_ALLOWED_IPS`. |
| `unsupported_token_type` | You requested `token_type:service` but the deployment hasn't enabled it. |
| `2fa_required` on API calls after login | The user/tenant enforces 2FA; complete `POST /v1/auth/2fa`, or use a non-2FA user/tenant. |
| CORS error / preflight fails in the browser | Your origin isn't on the service's allow-list (`*_CORS_ORIGINS`). |
| Component shows "no `<fe-session>` found" | No `<fe-session>` in the tree yet, or the component upgraded before it was appended — set `.provider` explicitly. |
| WebSocket won't connect (comments) | `wss://` from an `https` page requires the discussion service on HTTPS; check the `endpoint` and that `token`/`tenant` query params are present. |

---

## 15. Reference

### Deployment env (set by the FileEngine operator)

**Integration exchange (bridge):**

| Var | Meaning |
|---|---|
| `INTEGRATION_ISSUER` | expected assertion `iss` |
| `INTEGRATION_PUBLIC_KEY` / `_FILE` | your imported public key (PEM inline or file path) |
| `INTEGRATION_AUDIENCE` | expected assertion `aud` (default `<OAUTH_REDIRECT_BASE>/v1/auth/exchange`) |
| `INTEGRATION_ALLOWED_IPS` | optional caller-IP allow-list (IPs/CIDRs); empty = disabled |
| `INTEGRATION_ALLOW_SERVICE` | enable `token_type:service` (default `false`) |
| `INTEGRATION_SERVICE_ROLES` | roles a service token carries |

**CORS:** `HTTP_CORS_ORIGINS`, `CSAI_CORS_ORIGINS`, `DISC_CORS_ORIGINS`,
`BCF_CORS_ORIGINS`, `PROV_CORS_ORIGINS` (comma-separated exact origins).

### Session token claims (informational)

```json
{
  "iss": "fileengine-bridge", "sub": "alice@acme", "email": "alice@acme",
  "tenant": "acme", "iat": …, "exp": …, "jti": "…",
  "roles": { "acme": ["contributors","users"] },   // {tenant: [roles]}
  "amr": ["integration"],                           // auth methods; "integration" for exchange
  "aip": "203.0.113.9",                             // caller IP (exchange), when set
  "svc": true                                       // present on service tokens only
}
```

### Endpoint cheat-sheet

| Area | Method + path | Service |
|---|---|---|
| Exchange | `POST /v1/auth/exchange` | bridge |
| Password login | `POST /v1/auth/token` · `POST /v1/auth/2fa` | bridge |
| Refresh | `POST /v1/auth/refresh` | bridge |
| Identity | `GET /v1/whoami` · `GET /v1/tenants` | bridge |
| Browse | `GET /v1/dirs/{uid}` | bridge |
| File | `GET /v1/files/{uid}/renditions` · `…/content` | bridge |
| Upload | `POST /v1/dirs/{uid}/files` · `PUT /v1/files/{uid}/content` | bridge |
| Metadata | `GET/PUT/DELETE /v1/nodes/{uid}/metadata[/{key}]` | bridge |
| Search | `POST /search` | search |
| Comments | `GET/POST /files/{uid}/threads` · `wss://…/files/{uid}/live` | discussion |
| Provision | `POST /v1/provisioning/spaces` · `GET/PATCH …/{uid}/config` | provisioning |

### JS API surface (`@fileengine/embed-core`)

`SessionManager`, `SessionProvider`, `connect(session, opts)`, `LiveSocket`, `API_REST`
(+ `HTTP_GET`/`HTTP_POST_JSON`/`HTTP_POST_FORM`/`HTTP_PUT`/`HTTP_DELETE`), `multicall`,
`FeSession` / `defineFeSession`.

---

*Questions or an integration to register? Contact your FileEngine operator. This guide
tracks the `feature/embed-kit-foundation` implementation; see `SPECIFICATIONS.md` for the
full design rationale.*
