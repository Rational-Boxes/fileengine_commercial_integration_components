// TEST integration signing for the host harness (§14.2). MIT.
// The harness plays the external SaaS: it holds the PRIVATE key and mints short-lived,
// single-use RFC-7523 jwt-bearer assertions; FileEngine imports only the PUBLIC key.
// Extracted so the signer is unit-testable independently of the http server.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto'

export const b64url = (buf) => Buffer.from(buf).toString('base64url')

// Load a persisted RSA keypair (stable public key across restarts) or generate one.
// Returns { privatePem, publicPem, pubPath }.
export function loadOrCreateKeypair(privPath) {
  const pubPath = privPath.replace(/\.pem$/, '') + '.pub.pem'
  if (existsSync(privPath) && existsSync(pubPath)) {
    return { privatePem: readFileSync(privPath, 'utf8'), publicPem: readFileSync(pubPath, 'utf8'), pubPath }
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  writeFileSync(privPath, privatePem, { mode: 0o600 })
  writeFileSync(pubPath, publicPem)
  return { privatePem, publicPem, pubPath }
}

// Build a signer bound to an issuer/audience/private key. `now` is injectable for tests.
export function makeSigner({ issuer, audience, privatePem, ttl = 120 }) {
  return function signAssertion({ sub, tenant }, now = Math.floor(Date.now() / 1000)) {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = b64url(JSON.stringify({
      iss: issuer,
      sub,
      aud: audience,
      iat: now,
      exp: now + ttl,       // short-lived
      jti: randomUUID(),    // single-use — a replayed jti is refused by the bridge
      tenant: tenant || '',
      token_type: 'delegated',
    }))
    const signingInput = header + '.' + payload
    const sig = createSign('RSA-SHA256').update(signingInput).end().sign(privatePem)
    return signingInput + '.' + b64url(sig)
  }
}
