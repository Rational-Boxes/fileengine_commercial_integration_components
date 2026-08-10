# Embedding test harness (mock host application)

A **standalone, zero-dependency** mock "external SaaS host application" that embeds the
FileEngine Web Components, so the embed kit can be **manually tested end-to-end against a
live FileEngine dev stack** — over its **own ngrok tunnel** (a real HTTPS origin).

This is a test/dev tool (MIT, part of the kit's `examples/`), **not** a production
component. It stands in for a real integrator's host app.

## Why a standalone service on ngrok (not just localhost)

Several behaviours only work — or only behave *realistically* — with a real,
externally-reachable HTTPS origin distinct from FileEngine's:

- **Popup-OAuth callback (§5.1 / §6.1):** the OAuth `return_to` and `postMessage`
  `targetOrigin` must be a concrete origin on FileEngine's allow-list. ngrok gives the
  harness a stable HTTPS origin to register.
- **CORS (§5.4):** the harness's ngrok origin is added to FileEngine's per-service CORS
  allow-lists (via the `fe-int` CLI / config) — exercising the *real* browser-origin
  access path, not a same-origin shortcut.
- **Deep-link SSO (§5.5):** cross-origin hand-off from the harness → the official SPA.
- **Third-party-cookie behaviour:** silent-iframe refresh vs. bridge refresh only
  differ under a true cross-site origin.
- **postMessage / Shadow-DOM / theming** behave as they will in a real host page.

## What it exercises

- Each **session profile**: popup-OAuth (default), delegated silent (via the local
  signing shim, §6.3), credential passthrough.
- Each **component module** à la carte (`<fe-file-browser>`, `<fe-document-preview>`,
  `<fe-comments>`, `<fe-search>`, `<fe-chat>`, …) + `<fe-session>`.
- **Theming** (CSS custom properties + light/dark), Shadow-DOM vs `light-dom`.
- **Deep-link SSO** into the official client.
- **CORS allow-listing** and à la carte access (only enabled modules reachable).

## Architecture (minimal)

A tiny **Node built-in-`http`** server (no `npm install`) that serves:

- `GET /` → the host page (`public/index.html`) embedding the components + a small
  control panel (pick profile / modules / theme).
- `GET /config` → non-secret client config (FileEngine base URLs, tenant, enabled
  modules, kit CDN/local module paths) so the page self-configures.
- `GET /session/callback` → the popup-OAuth callback page (reads the `#token` fragment,
  `postMessage`s to the opener with a pinned `targetOrigin`) — the §6.1 edge callback,
  hosted here for dev so the harness is self-contained.
- `POST /session/exchange` → **(delegated profile only)** the §6.3 signing shim: signs
  an RFC-7523 assertion with the harness's *test* integration private key and relays
  FileEngine `/v1/auth/exchange`, returning the token. **Stub** until the upstream
  exchange endpoint (§14.2) lands; wire the real key + endpoint then.
- `GET /healthz`.

```
Browser (ngrok HTTPS origin)                 FileEngine dev stack
  index.html + <fe-*> components  ── Bearer ──▶ :8090/:8092/:8094/:8098  (CORS allows ngrok origin)
        │  popup → /session/callback ──postMessage token──┐
        ▼                                                 │
  harness server (this dir) ── (delegated) sign+exchange ─┴─▶ :8090/v1/auth/exchange
```

## Run it

```bash
# 1) FileEngine dev stack up (from the meta-project):
scripts/start_backend_services.sh

# 2) The harness (zero deps):
cd examples/host-harness
cp .env.example .env            # set FILEENGINE_* base URLs, tenant, profile, modules
node server.mjs                 # serves http://localhost:8181

# 3) Tunnel it:
ngrok http 8181                 # note the https://<name>.ngrok.io origin

# 4) On the FileEngine side, allow the ngrok origin:
#    - add it to the CORS allow-lists (fe-int cors, or *_CORS_ORIGINS env)
#    - add https://<name>.ngrok.io/session/callback to the OAuth return_to allowlist
#    - (delegated profile) register the harness test PUBLIC key + its scopes/namespace

# 5) Open the ngrok URL in a browser and drive the control panel.
```

## Config (`.env`)

| Var | Meaning |
|---|---|
| `HARNESS_PORT` | listen port (default 8181) |
| `HARNESS_PUBLIC_ORIGIN` | the ngrok origin (postMessage target + config echo) |
| `FILEENGINE_API_BASE` … | FileEngine service base URLs (:8090/:8092/:8094/:8098) |
| `HARNESS_TENANT` | tenant to operate as |
| `HARNESS_PROFILE` | `oauth` \| `delegated` \| `passthrough` |
| `HARNESS_MODULES` | csv of component modules to load (à la carte) |
| `HARNESS_KIT_BASE` | where to load the kit ESM from (local `dist/` or CDN) |
| `FE_INTEGRATION_ID` / `FE_INTEGRATION_PRIVATE_KEY` | delegated profile only (test key) |

## Status / roadmap

- **Now:** scaffold — server + placeholder host page + callback + config; runs on ngrok
  and shows the control panel. Component embeds are stubbed until the kit's M0/M1 land.
- **As components land:** flesh out `index.html` to import the real `<fe-*>` modules and
  add per-module demo panels.
- **When the exchange endpoint (§14.2) lands:** wire the real delegated signing shim.

Security: this harness holds a **test** integration private key for the delegated
profile only — never a production key. Its ngrok origin is a *test* CORS entry to be
removed after testing.
