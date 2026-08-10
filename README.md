# FileEngine Embedding Kit

**Embed FileEngine document capabilities into your own web app** — file browsing,
preview, upload, search, live comments, metadata, and download — as drop-in
[Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components),
authenticated on behalf of your users, with **no server-side data proxy**.

Framework-agnostic (W3C Web Components only), tree-shakeable, MIT-licensed.

```html
<fe-session base="https://files.example.com" tenant="acme"></fe-session>

<fe-file-browser folder="root"></fe-file-browser>
<fe-document-preview markup></fe-document-preview>
```

The components discover the `<fe-session>` provider, borrow its authenticated client, and
render. One short-lived token authenticates **every** FileEngine service; a `401`
transparently refreshes and replays. Your browser talks **directly** to FileEngine — the
bridge is a handshake, never a data relay.

---

## Packages

| Package | What |
|---|---|
| **`@fileengine/embed-core`** | `SessionManager`, `connect()`, `SessionProvider`, `<fe-session>`, `LiveSocket`, `API_REST` |
| **`@fileengine/embed-components`** | the à la carte visual components (below) |

### Components

Each is an independent ES module — importing one never pulls in another.

| Component | Purpose |
|---|---|
| `<fe-file-browser>` | list & navigate directories (`fe:select`, `fe:navigate`) |
| `<fe-document-preview>` | render a file's rendition (`fe:preview`; `markup` opt-in) |
| `<fe-uploader>` | upload files (create + content; `fe:upload`) |
| `<fe-search>` | full-text search (`fe:result-select`) |
| `<fe-comments>` | threaded comments, **live over WebSocket** (`fe:comment`) |
| `<fe-metadata>` | key/value metadata editor (`fe:metadata-change`) |
| `<fe-download>` | authenticated download button (`fe:download`) |

Components coordinate **loosely** — events out, methods in — so nothing hard-fails if a
sibling isn't on the page.

---

## Quick start

```html
<script type="module">
  import '@fileengine/embed-core'                       // registers <fe-session>
  import '@fileengine/embed-components/file-browser'
  import '@fileengine/embed-components/document-preview'

  const fe = document.createElement('fe-session')
  fe.setAttribute('base', 'https://files.example.com')
  fe.setAttribute('tenant', 'acme')
  fe.setAttribute('host-origin', location.origin)
  document.body.appendChild(fe)
  const provider = fe.getSession()

  // Get a session token (your backend signs an assertion — see the guide), then:
  provider.setSession(access_token, expires_in)

  const browser = document.createElement('fe-file-browser'); browser.setAttribute('folder', 'root')
  const preview = document.createElement('fe-document-preview')
  document.body.append(browser, preview)
  browser.addEventListener('fe:select', e => preview.open(e.detail.uid))
</script>
```

**Authentication** is by short-lived, per-user tokens. Your integration registers **one
public key** with FileEngine; your backend signs RFC-7523 assertions and exchanges them
for user sessions. Three ways to get a session:

- **Delegated exchange** (recommended) — your backend vouches for a user.
- **Popup-OAuth** — against a FileEngine-configured IdP, no integrator server.
- **Password / passthrough** — directory credentials (with 2FA).

See the [**Integrator's Guide**](docs/INTEGRATORS_GUIDE.md) for the full flow.

---

## Documentation

- 📘 [**Integrator's Guide**](docs/INTEGRATORS_GUIDE.md) — architecture, auth, every
  component (attributes/methods/events/endpoints), CORS, provisioning, framework
  integration, security, troubleshooting, and a full reference.
- 📐 [SPECIFICATIONS.md](SPECIFICATIONS.md) — the design rationale.
- 🧪 [`examples/host-harness/`](examples/host-harness/README.md) — a runnable, zero-dependency
  mock host app that exercises every component + all three session profiles over an ngrok
  tunnel.

---

## Repository layout

```
packages/core/          @fileengine/embed-core  (session core + <fe-session> + LiveSocket)
packages/components/    @fileengine/embed-components  (the à la carte <fe-*> components)
examples/host-harness/  standalone mock host app for manual E2E over ngrok
docs/INTEGRATORS_GUIDE.md
SPECIFICATIONS.md
```

## Developing

Zero build, zero runtime dependencies — plain ESM + the platform. Node ≥ 20.

```bash
# unit tests (node:test)
cd packages/core        && npm test
cd packages/components  && npm test

# run the manual test harness (see its README for ngrok wiring)
cd examples/host-harness && node server.mjs   # http://localhost:8181
```

Every component is a **DOM-free model + a thin custom-element shell**, unit-tested
without a browser. À la carte isolation is enforced: a component's only static import is
its own model.

## License

[MIT](LICENSE) © James Hickman. The provisioning service
(`fileengine_integration_provisioning`) is a separate, AGPL-licensed component.
