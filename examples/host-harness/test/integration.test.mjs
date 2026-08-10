// SPDX-License-Identifier: MIT
// Proves the harness signer produces a standard RS256 JWT that verifies against the
// SPKI public key — the same shape the bridge's C++ verifier (assertion_verify.cpp)
// consumes. Uses a temp key file so it never touches the persisted harness key.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createVerify } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'
import { loadOrCreateKeypair, makeSigner, b64url } from '../lib/integration.mjs'

const priv = join(tmpdir(), `fe-harness-test-${process.pid}.pem`)
const pub = priv.replace(/\.pem$/, '') + '.pub.pem'
after(() => { for (const f of [priv, pub]) if (existsSync(f)) rmSync(f) })

const AUD = 'https://files.example.com/v1/auth/exchange'
const decodeSeg = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))

test('signer emits a well-formed RS256 JWT whose signature verifies against the SPKI key', () => {
  const { privatePem, publicPem } = loadOrCreateKeypair(priv)
  const sign = makeSigner({ issuer: 'harness-integration', audience: AUD, privatePem })
  const jwt = sign({ sub: 'alice@acme', tenant: 'acme' }, 1700000000)

  const [h, p, sig] = jwt.split('.')
  assert.equal([h, p, sig].filter(Boolean).length, 3, 'three non-empty segments')

  const header = decodeSeg(h)
  assert.equal(header.alg, 'RS256')
  assert.equal(header.typ, 'JWT')

  const claims = decodeSeg(p)
  assert.equal(claims.iss, 'harness-integration')
  assert.equal(claims.sub, 'alice@acme')
  assert.equal(claims.aud, AUD)
  assert.equal(claims.tenant, 'acme')
  assert.equal(claims.token_type, 'delegated')
  assert.equal(claims.iat, 1700000000)
  assert.equal(claims.exp, 1700000120)
  assert.ok(claims.jti && claims.jti.length >= 8, 'has a jti')

  // The signature is RSA-PKCS1v1.5 over SHA-256("<h>.<p>") — exactly what the C++
  // verifier checks via EVP_DigestVerify(sha256).
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).end()
    .verify(publicPem, Buffer.from(sig, 'base64url'))
  assert.equal(ok, true)
})

test('a tampered payload fails verification', () => {
  const { privatePem, publicPem } = loadOrCreateKeypair(priv)
  const sign = makeSigner({ issuer: 'harness-integration', audience: AUD, privatePem })
  const jwt = sign({ sub: 'alice@acme', tenant: 'acme' }, 1700000000)
  const [h, , sig] = jwt.split('.')
  const forgedPayload = b64url(JSON.stringify({ iss: 'harness-integration', sub: 'attacker', aud: AUD }))
  const ok = createVerify('RSA-SHA256').update(`${h}.${forgedPayload}`).end()
    .verify(publicPem, Buffer.from(sig, 'base64url'))
  assert.equal(ok, false)
})

test('each assertion has a unique jti (single-use)', () => {
  const { privatePem } = loadOrCreateKeypair(priv)
  const sign = makeSigner({ issuer: 'x', audience: AUD, privatePem })
  const a = decodeSeg(sign({ sub: 'u' }).split('.')[1])
  const b = decodeSeg(sign({ sub: 'u' }).split('.')[1])
  assert.notEqual(a.jti, b.jti)
})

test('token_type defaults to delegated and can be set to service', () => {
  const { privatePem } = loadOrCreateKeypair(priv)
  const sign = makeSigner({ issuer: 'x', audience: AUD, privatePem })
  assert.equal(decodeSeg(sign({ sub: 'u' }).split('.')[1]).token_type, 'delegated')
  assert.equal(decodeSeg(sign({ sub: 'svc:x', tokenType: 'service' }).split('.')[1]).token_type, 'service')
})
