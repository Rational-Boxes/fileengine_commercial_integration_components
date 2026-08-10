// Embedding test harness — mock host application. MIT.
// Zero-dependency Node built-in http server: serves the host page, a non-secret
// /config, the popup-OAuth callback (postMessage), a real delegated /session/exchange
// (signs an RFC-7523 assertion with a TEST integration key and relays FileEngine
// /v1/auth/exchange), and /healthz. Run behind ngrok for a real HTTPS origin.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'
import { loadOrCreateKeypair, makeSigner } from './lib/integration.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// Serve the real embed-core ESM straight from the monorepo so manual E2E exercises
// the actual kit (SessionManager/connect/API_REST), not a reimplementation.
const CORE_DIR = normalize(join(HERE, '..', '..', 'packages', 'core', 'src'))
const env = process.env
const PORT = Number(env.HARNESS_PORT || 8181)
const PUBLIC_ORIGIN = env.HARNESS_PUBLIC_ORIGIN || `http://localhost:${PORT}`

// --- TEST integration keypair (§14.2) ------------------------------------------
// The harness plays the external SaaS: it holds the PRIVATE key and signs assertions.
// FileEngine imports only the PUBLIC key (point INTEGRATION_PUBLIC_KEY_FILE at it).
// Persisted so the public key stays stable across restarts (gitignored).
const KEY_PRIV = env.HARNESS_INTEGRATION_KEY_FILE || join(HERE, '.integration_key.pem')
const INTEGRATION_ISSUER = env.HARNESS_INTEGRATION_ISSUER || 'harness-integration'
const EXCHANGE_URL = env.HARNESS_INTEGRATION_AUDIENCE ||
  ((env.FILEENGINE_API_BASE || 'http://localhost:8090') + '/v1/auth/exchange')

const { privatePem: integrationPrivatePem, publicPem: integrationPublicPem, pubPath: KEY_PUB } =
  loadOrCreateKeypair(KEY_PRIV)
const signAssertion = makeSigner({
  issuer: INTEGRATION_ISSUER, audience: EXCHANGE_URL, privatePem: integrationPrivatePem,
})

// Read a JSON request body (small bodies only).
function readJson(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

// Non-secret client config the host page reads to self-configure.
const clientConfig = {
  publicOrigin: PUBLIC_ORIGIN,
  profile: env.HARNESS_PROFILE || 'oauth', // oauth | delegated | passthrough
  tenant: env.HARNESS_TENANT || '',
  modules: (env.HARNESS_MODULES || 'file-browser,document-preview').split(',').map(s => s.trim()).filter(Boolean),
  kitBase: env.HARNESS_KIT_BASE || '', // local dist/ or CDN base for @fileengine/embed
  fileengine: {
    api: env.FILEENGINE_API_BASE || 'http://localhost:8090',
    csai: env.FILEENGINE_CSAI_BASE || 'http://localhost:8092',
    discuss: env.FILEENGINE_DISCUSS_BASE || 'http://localhost:8094',
    bcf: env.FILEENGINE_BCF_BASE || 'http://localhost:8098',
  },
  oauthProvider: env.HARNESS_OAUTH_PROVIDER || 'google',
  callbackPath: '/session/callback',
  integration: {
    issuer: INTEGRATION_ISSUER,
    audience: EXCHANGE_URL,
    publicKeyFile: KEY_PUB,   // point FileEngine's INTEGRATION_PUBLIC_KEY_FILE here
  },
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

// The OAuth callback page: read the token from the URL fragment and postMessage it to
// the opener (the host page) with a pinned targetOrigin. This is the §6.1 edge callback,
// hosted by the harness for a self-contained dev loop.
const CALLBACK_HTML = `<!doctype html><meta charset=utf8><title>signing in…</title>
<script>
(function () {
  var h = new URLSearchParams(location.hash.slice(1));
  var msg = { source: 'fe-oauth', token: h.get('token'),
              expires_in: h.get('expires_in'), token_type: h.get('token_type') };
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (window.opener) window.opener.postMessage(msg, ${JSON.stringify(PUBLIC_ORIGIN)});
  document.body ? (document.body.textContent = 'You may close this window.') : null;
  window.close();
})();
</script><body>Signing in…`

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN)
  const path = url.pathname

  if (path === '/healthz') return send(res, 200, JSON.stringify({ status: 'ok' }), 'application/json')
  if (path === '/config') return send(res, 200, JSON.stringify(clientConfig), 'application/json')
  if (path === '/session/callback') return send(res, 200, CALLBACK_HTML, 'text/html')

  if (path === '/session/exchange' && req.method === 'POST') {
    // Delegated profile (§14.2): sign an RFC-7523 assertion for the requested end-user
    // with the harness TEST integration private key, then relay FileEngine's
    // /v1/auth/exchange. FileEngine verifies against the imported public key and mints
    // a real, IP-bound session token for that user.
    const body = await readJson(req)
    if (!body || !body.sub) {
      return send(res, 400, JSON.stringify({ error: 'sub (delegated username) required' }), 'application/json')
    }
    const assertion = signAssertion({ sub: body.sub, tenant: body.tenant })
    const form = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    })
    try {
      const r = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      })
      const text = await r.text()
      return send(res, r.status, text, r.headers.get('content-type') || 'application/json')
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: 'exchange relay failed', detail: String(e) }), 'application/json')
    }
  }

  // Expose the TEST integration public key so it can be imported into FileEngine.
  if (path === '/session/pubkey') return send(res, 200, integrationPublicPem, 'application/x-pem-file')

  // /core/<file> -> the real @fileengine/embed-core source (ESM modules).
  if (path.startsWith('/core/')) {
    const coreFile = normalize(join(CORE_DIR, path.slice('/core/'.length)))
    if (!coreFile.startsWith(CORE_DIR)) return send(res, 403, 'forbidden') // path escape
    try {
      const body = await readFile(coreFile)
      const ext = coreFile.slice(coreFile.lastIndexOf('.'))
      return send(res, 200, body, MIME[ext] || 'application/octet-stream')
    } catch {
      return send(res, 404, 'not found')
    }
  }

  // static: / -> index.html, else public/<file>
  const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
  const file = normalize(join(HERE, 'public', rel))
  if (!file.startsWith(join(HERE, 'public'))) return send(res, 403, 'forbidden') // path escape
  try {
    const body = await readFile(file)
    const ext = file.slice(file.lastIndexOf('.'))
    return send(res, 200, body, MIME[ext] || 'application/octet-stream')
  } catch {
    return send(res, 404, 'not found')
  }
})

server.listen(PORT, () => {
  console.log(`[harness] http://localhost:${PORT}  (public origin: ${PUBLIC_ORIGIN})`)
  console.log(`[harness] profile=${clientConfig.profile} tenant=${clientConfig.tenant || '(unset)'} modules=${clientConfig.modules.join(',')}`)
  console.log(`[harness] integration issuer='${INTEGRATION_ISSUER}'  exchange -> ${EXCHANGE_URL}`)
  console.log(`[harness] import this PUBLIC key into FileEngine:`)
  console.log(`[harness]   INTEGRATION_ISSUER=${INTEGRATION_ISSUER}`)
  console.log(`[harness]   INTEGRATION_PUBLIC_KEY_FILE=${KEY_PUB}`)
  console.log(`[harness] tunnel with:  ngrok http ${PORT}`)
})
