// FileEngine dev gateway — MIT.
// A transparent reverse proxy that fronts all the FileEngine services under path
// prefixes on ONE origin, so the embedding test needs a single services tunnel instead
// of one per service. It is a DIFFERENT origin than the harness, so the browser→service
// path is still genuinely cross-origin (CORS + the exchange are exercised for real): the
// gateway forwards the browser's Origin/Authorization/X-Tenant to each service and
// forwards the service's CORS response back, unchanged.
//
//   /api/*            -> http_bridge        (:8090)   e.g. /api/v1/dirs/{uid}, /api/v1/auth/exchange
//   /csai/*           -> convert_search_ai  (:8092)   e.g. /csai/search, /csai/v1/onlyoffice/config
//   /discuss/*        -> discussion         (:8094)   REST + WebSocket (/discuss/files/{uid}/live)
//   /bcf/*            -> bcf_service        (:8098)   prefix FORWARDED (router is mounted under /bcf)
//   /folder-actions/* -> folder_actions     (:8099)   classifier-sets + notify-templates admin API
//   /provisioning/*   -> provisioning       (:8100)
//
// The gateway strips its prefix before forwarding, because each service mounts its routes
// at root (mirroring the SPA's Vite proxy `rewrite`). The exception is bcf_service, whose
// APIRouter itself declares prefix="/bcf" (its Vite proxy has NO rewrite) — so that route
// forwards the /bcf prefix verbatim (strip: false).
//
// (ONLYOFFICE Document Server (:8080) and WebDAV (:8088) are NOT fronted here — their
//  absolute paths / verbs can't sit behind a path prefix, so each keeps its own tunnel.)
//
// Zero dependencies (node:http + node:net for the WebSocket upgrade).
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'

const env = process.env
const PORT = Number(env.GATEWAY_PORT || 8199)

// strip: true (default) removes the gateway prefix before forwarding (service mounts at
// root); false forwards the prefix verbatim (service's own router is mounted under it).
const ROUTES = [
  { prefix: '/api',            target: env.FE_BRIDGE  || 'http://localhost:8090' },
  { prefix: '/csai',           target: env.FE_CSAI    || 'http://localhost:8092' },
  { prefix: '/discuss',        target: env.FE_DISCUSS || 'http://localhost:8094' },
  { prefix: '/bcf',            target: env.FE_BCF     || 'http://localhost:8098', strip: false },
  { prefix: '/folder-actions', target: env.FE_FA      || 'http://localhost:8099' },
  { prefix: '/provisioning',   target: env.FE_PROV    || 'http://localhost:8100' },
]

function matchRoute(path) {
  for (const r of ROUTES) if (path === r.prefix || path.startsWith(r.prefix + '/')) return r
  return null
}
// Path sent upstream: strip the gateway prefix unless the route opts out (strip: false),
// in which case the service expects its own prefix and we forward the URL verbatim.
const upstreamPath = (route, url) => route.strip === false ? url : (url.slice(route.prefix.length) || '/')

const server = createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}') }
  const route = matchRoute(req.url)
  if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"no gateway route"}') }
  const t = new URL(route.target)
  const up = httpRequest({
    hostname: t.hostname, port: t.port, method: req.method,
    path: upstreamPath(route, req.url),
    headers: { ...req.headers, host: t.host },   // forwards Origin / Authorization / X-Tenant verbatim
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)   // forwards the service's CORS headers back
    upRes.pipe(res)
  })
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'upstream', detail: String(e) })) })
  req.pipe(up)
})

// WebSocket (discussion-live): raw socket bridge, prefix stripped.
server.on('upgrade', (req, socket, head) => {
  const route = matchRoute(req.url)
  if (!route) return socket.destroy()
  const t = new URL(route.target)
  const upstream = netConnect(Number(t.port), t.hostname, () => {
    const headers = { ...req.headers, host: t.host }
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    upstream.write(`${req.method} ${upstreamPath(route, req.url)} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    if (head && head.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, () => {
  console.log(`[fe-gateway] http://localhost:${PORT}  (one origin -> all FileEngine services)`)
  for (const r of ROUTES) console.log(`[fe-gateway]   ${r.prefix.padEnd(14)} -> ${r.target}`)
})
