// Cloudflare Worker to generate S3-compatible presigned URLs for Cloudflare R2
// Do NOT expose your R2 credentials on the client. Deploy this Worker on Cloudflare and
// set the following secrets/environment variables:
// - R2_ACCOUNT_ID
// - R2_BUCKET_NAME
// - R2_ACCESS_KEY_ID
// - R2_SECRET_ACCESS_KEY
// - R2_REGION (defaults to 'auto')
//
// POST /sign { key, method, expires }
//   -> { url }
// Supports methods: GET, PUT, DELETE

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    // Simple health endpoint to verify deploy and env (no secrets leaked)
    if (url.pathname === '/health' && request.method === 'GET') {
      const now = new Date()
      return json({
        ok: true,
        now: now.toISOString(),
        amzDate: toAmzDate(now),
        accountId: env.R2_ACCOUNT_ID ? `${String(env.R2_ACCOUNT_ID).slice(0, 6)}…` : null,
        bucket: env.R2_BUCKET_NAME || null,
        region: env.R2_REGION || 'auto',
      }, 200, request)
    }

    if (url.pathname === '/sign' && request.method === 'POST') {
      try {
        const { key, method = 'PUT', expires = 300 } = await request.json()
        if (!key || !['GET', 'PUT', 'DELETE'].includes(method)) {
          return json({ error: 'Invalid request' }, 400, request)
        }

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
        if (missing.length) {
          // Help surface which secrets are not configured in Wrangler/CF dashboard
          return json({ error: `Missing R2 configuration: ${missing.join(', ')}` }, 500, request)
        }

        const presigned = await presignUrl({
          method,
          accountId,
          bucket,
          key,
          region,
          accessKeyId,
          secretKey,
          expires: Number(expires) || 300,
        })
        return json({ url: presigned }, 200, request)
      } catch (err) {
        // Log for Worker logs; do not leak stack to clients
        console.error('[r2-signer] Failed to sign URL', err)
        return json({ error: err?.message || 'Failed to sign' }, 500, request)
      }
    }

    return json({ ok: true }, 200, request)
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin',
  }
}

function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    }
  })
}

async function presignUrl({ method, accountId, bucket, key, region, accessKeyId, secretKey, expires }) {
  const host = `${accountId}.r2.cloudflarestorage.com`
  // Encode path but preserve '/'
  const canonicalUri = `/${bucket}/${encodePathPreserveSlash(key)}`
  const service = 's3'

  const now = new Date()
  const amzDate = toAmzDate(now)
  const datestamp = amzDate.slice(0, 8)
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`

  const signedHeaders = 'host'
  const algorithm = 'AWS4-HMAC-SHA256'

  const qp = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  }

  // For GET, include response disposition to preserve filename and avoid extension interference
  if (method === 'GET') {
    const baseName = String(key).split('/').pop() || 'download'
    qp['response-content-disposition'] = `attachment; filename="${baseName}"`
  }

  // Strict RFC3986 for query (encode '/')
  const canonicalQueryString = Object.keys(qp) 
    .sort()
    .map((k) => `${encodeQueryRfc3986(k)}=${encodeQueryRfc3986(qp[k])}`)
    .join('&')
  const canonicalHeaders = `host:${host}\n`
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest)
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n')

  const signingKey = await getSignatureKey(secretKey, datestamp, region, service)
  const signature = await hmacHexBuf(signingKey, stringToSign)

  const presignedUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
  return presignedUrl
}

function encodeRfc3986(input) {
  // Encode but keep '/'
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, '/')
}

function toAmzDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const MM = pad(date.getUTCMonth() + 1)
  const dd = pad(date.getUTCDate())
  const HH = pad(date.getUTCHours())
  const mm = pad(date.getUTCMinutes())
  const ss = pad(date.getUTCSeconds())
  return `${yyyy}${MM}${dd}T${HH}${mm}${ss}Z`
}

async function sha256Hex(message) {
  const enc = new TextEncoder()
  const data = enc.encode(message)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return toHex(hash)
}

async function hmac(key, msg) {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return sig
}

async function hmacHex(key, msg) {
  const sig = await hmac(key, msg)
  return toHex(sig)
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = await hmac(`AWS4${key}`, dateStamp)
  const kRegion = await hmacBuf(kDate, regionName)
  const kService = await hmacBuf(kRegion, serviceName)
  const kSigning = await hmacBuf(kService, 'aws4_request')
  return kSigning
}

async function hmacBuf(keyBuf, msg) {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return sig
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

// Strict RFC3986 for query (does NOT preserve '/')
function encodeQueryRfc3986(input) {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

// Path encoder that preserves '/'
function encodePathPreserveSlash(input) {
  return encodeQueryRfc3986(input).replace(/%2F/g, '/')
}

// Convenience: hex-encode HMAC when key is an ArrayBuffer (used for SigV4 signing key)
async function hmacHexBuf(keyBuf, msg) {
  const sig = await hmacBuf(keyBuf, msg)
  return toHex(sig)
}
