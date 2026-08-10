// Embedding test harness — mock host application. MIT.
// Zero-dependency Node built-in http server: serves the host page, a non-secret
// /config, the popup-OAuth callback (postMessage), a delegated /session/exchange stub,
// and /healthz. Run behind ngrok for a real HTTPS origin (see README).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const env = process.env
const PORT = Number(env.HARNESS_PORT || 8181)
const PUBLIC_ORIGIN = env.HARNESS_PUBLIC_ORIGIN || `http://localhost:${PORT}`

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
    // Delegated profile (§6.3): sign an RFC-7523 assertion with the harness TEST
    // integration private key and relay FileEngine /v1/auth/exchange. Stubbed until
    // the upstream exchange endpoint (§14.2) lands.
    return send(res, 501, JSON.stringify({
      error: 'not_implemented',
      detail: 'Wire FE_INTEGRATION_PRIVATE_KEY + POST FileEngine /v1/auth/exchange when §14.2 lands.',
    }), 'application/json')
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
  console.log(`[harness] tunnel with:  ngrok http ${PORT}`)
})
