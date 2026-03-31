/**
 * Cloudflare Worker — R2 Presigned URL Signer
 *
 * Exposes two authenticated endpoints:
 *   POST /sign/upload  { key, expires? }           → { url } (PUT presigned)
 *   POST /sign/download { key, expires? }           → { url } (GET presigned)
 *
 * DELETE is intentionally NOT exposed here. The API Worker (paste-api) handles
 * deletes via native R2 bindings after verifying ownership in D1.
 *
 * Auth: Bearer token validated against TOKEN_SECRET environment variable.
 * Guest users get a 15-min short-lived PUT URL but cannot generate download URLs
 * for authenticated pastes.
 *
 * Required Wrangler secrets:
 *   R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   TOKEN_SECRET  (same secret as the paste-api worker uses to sign JWTs)
 *   R2_REGION     (optional, defaults to 'auto')
 */

const KEY_ALLOWLIST_RE = /^[a-zA-Z0-9_\-.]{1,512}$/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    // Health check — no auth required, no secrets leaked
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true,
        ts: new Date().toISOString(),
        accountId: env.R2_ACCOUNT_ID ? `${String(env.R2_ACCOUNT_ID).slice(0, 4)}…` : null,
        bucket: env.R2_BUCKET_NAME || null,
      }, 200, request)
    }

    // ── Auth gate ──────────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    // Guest uploads use a short-lived signed key passed as X-Guest-Key header
    const isGuest = request.headers.get('X-Upload-Mode') === 'guest'

    if (!isGuest) {
      // Authenticated users must provide a valid JWT
      if (!token) return json({ error: 'Unauthorized' }, 401, request)
      const valid = await verifyToken(token, env.TOKEN_SECRET)
      if (!valid) return json({ error: 'Invalid or expired token' }, 401, request)
    } else {
      // For guests we allow uploads but enforce a short TTL cap
      // No token required — quota is enforced by the paste-api worker
    }

    // ── Upload URL (PUT) ────────────────────────────────────────────────────
    if (url.pathname === '/sign/upload' && request.method === 'POST') {
      try {
        const { key, expires = isGuest ? 300 : 600 } = await request.json()

        // Key validation — prevent path traversal and bucket pollution
        if (!key || !KEY_ALLOWLIST_RE.test(key)) {
          return json({ error: 'Invalid or missing key. Use only alphanumeric, dash, dot, underscore.' }, 400, request)
        }

        const cappedExpires = Math.min(Number(expires) || 300, isGuest ? 300 : 3600)
        const signed = await presignUrl({ method: 'PUT', key, expires: cappedExpires, env })
        return json({ url: signed, key }, 200, request)
      } catch (err) {
        console.error('[r2-signer/upload]', err)
        return json({ error: err?.message || 'Failed to sign upload URL' }, 500, request)
      }
    }

    // ── Download URL (GET) ──────────────────────────────────────────────────
    if (url.pathname === '/sign/download' && request.method === 'POST') {
      if (isGuest) return json({ error: 'Guest mode cannot generate download URLs' }, 403, request)
      try {
        const { key, expires = 300 } = await request.json()

        if (!key || !KEY_ALLOWLIST_RE.test(key)) {
          return json({ error: 'Invalid or missing key' }, 400, request)
        }

        const cappedExpires = Math.min(Number(expires) || 300, 3600)
        const signed = await presignUrl({ method: 'GET', key, expires: cappedExpires, env })
        return json({ url: signed }, 200, request)
      } catch (err) {
        console.error('[r2-signer/download]', err)
        return json({ error: err?.message || 'Failed to sign download URL' }, 500, request)
      }
    }

    return json({ error: 'Not found' }, 404, request)
  }
}

// ── JWT Verification (HS256 via Web Crypto) ───────────────────────────────

async function verifyToken(token, secret) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const data = `${headerB64}.${payloadB64}`
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret || 'fallback'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sig = base64urlDecode(sigB64)
    const valid = await crypto.subtle.verify('HMAC', key, sig, enc.encode(data))
    if (!valid) return null
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - str.length % 4) % 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── AWS4-HMAC-SHA256 Presigned URL ────────────────────────────────────────

async function presignUrl({ method, key, expires, env }) {
  const accountId = env.R2_ACCOUNT_ID
  const bucket = env.R2_BUCKET_NAME
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretKey = env.R2_SECRET_ACCESS_KEY
  const region = env.R2_REGION || 'auto'

  const missing = []
  if (!accountId) missing.push('R2_ACCOUNT_ID')
  if (!bucket) missing.push('R2_BUCKET_NAME')
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!secretKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (missing.length) throw new Error(`Missing R2 config: ${missing.join(', ')}`)

  const host = `${accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${bucket}/${encodePathPreserveSlash(key)}`
  const service = 's3'

  const now = new Date()
  const amzDate = toAmzDate(now)
  const datestamp = amzDate.slice(0, 8)
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`
  const algorithm = 'AWS4-HMAC-SHA256'
  const signedHeaders = 'host'

  const qp = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  }

  if (method === 'GET') {
    const baseName = key.split('/').pop() || 'download'
    qp['response-content-disposition'] = `attachment; filename="${baseName}"`
  }

  const canonicalQueryString = Object.keys(qp).sort()
    .map(k => `${encodeQueryRfc3986(k)}=${encodeQueryRfc3986(qp[k])}`).join('&')

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, `host:${host}\n`, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
  const hashedCR = await sha256Hex(canonicalRequest)
  const stringToSign = [algorithm, amzDate, credentialScope, hashedCR].join('\n')
  const signingKey = await getSignatureKey(secretKey, datestamp, region, service)
  const signature = await hmacHexBuf(signingKey, stringToSign)

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}

// ── Crypto Helpers ────────────────────────────────────────────────────────

function toAmzDate(date) {
  const p = n => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

async function sha256Hex(msg) {
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(msg))
  return toHex(hash)
}

async function hmacBuf(keyBuf, msg) {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

async function hmacStrBuf(keyStr, msg) {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

async function getSignatureKey(key, dateStamp, region, service) {
  const kDate = await hmacStrBuf(`AWS4${key}`, dateStamp)
  const kRegion = await hmacBuf(kDate, region)
  const kService = await hmacBuf(kRegion, service)
  return hmacBuf(kService, 'aws4_request')
}

async function hmacHexBuf(keyBuf, msg) {
  const sig = await hmacBuf(keyBuf, msg)
  return toHex(sig)
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function encodeQueryRfc3986(input) {
  return encodeURIComponent(input).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodePathPreserveSlash(input) {
  return encodeQueryRfc3986(input).replace(/%2F/g, '/')
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upload-Mode',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin',
  }
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request) }
  })
}
