// Vercel Serverless Function to generate S3-compatible presigned URLs for Cloudflare R2
// Keep secrets ONLY on the server: set these in Vercel Project Settings -> Environment Variables
// - R2_ACCOUNT_ID
// - R2_BUCKET_NAME
// - R2_ACCESS_KEY_ID
// - R2_SECRET_ACCESS_KEY
// - R2_REGION (optional, defaults to 'auto')

import crypto from 'crypto'

export default async function handler(req, res) {
  // Simple CORS for local dev if needed
  const origin = req.headers.origin || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with')
  res.setHeader('Access-Control-Max-Age', '3600')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}')
    const { key, method = 'PUT', expires = 300 } = body
    if (!key || !['GET', 'PUT', 'DELETE'].includes(method)) {
      return res.status(400).json({ error: 'Invalid request' })
    }

    const accountId = process.env.R2_ACCOUNT_ID
    const bucket = process.env.R2_BUCKET_NAME
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretKey = process.env.R2_SECRET_ACCESS_KEY
    const region = process.env.R2_REGION || 'auto'

    const missing = []
    if (!accountId) missing.push('R2_ACCOUNT_ID')
    if (!bucket) missing.push('R2_BUCKET_NAME')
    if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID')
    if (!secretKey) missing.push('R2_SECRET_ACCESS_KEY')
    if (missing.length) {
      return res.status(500).json({ error: `Missing R2 configuration: ${missing.join(', ')}` })
    }

    const url = await presignUrl({ method, accountId, bucket, key, region, accessKeyId, secretKey, expires: Number(expires) || 300 })
    return res.status(200).json({ url })
  } catch (err) {
    console.error('[api/r2-sign] Failed to sign URL', err)
    return res.status(500).json({ error: err?.message || 'Failed to sign' })
  }
}

async function presignUrl({ method, accountId, bucket, key, region, accessKeyId, secretKey, expires }) {
  const host = `${accountId}.r2.cloudflarestorage.com`
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

  if (method === 'GET') {
    const baseName = String(key).split('/').pop() || 'download'
    qp['response-content-disposition'] = `attachment; filename="${baseName}"`
  }

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

  const hashedCanonicalRequest = sha256Hex(canonicalRequest)
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n')

  const signingKey = getSignatureKey(secretKey, datestamp, region, service)
  const signature = hmacHex(signingKey, stringToSign)

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
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

function sha256Hex(message) {
  return crypto.createHash('sha256').update(message, 'utf8').digest('hex')
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest()
}

function hmacHex(keyBuf, msg) {
  return crypto.createHmac('sha256', keyBuf).update(msg, 'utf8').digest('hex')
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmac(`AWS4${key}`, dateStamp)
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName, 'utf8').digest()
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName, 'utf8').digest()
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request', 'utf8').digest()
  return kSigning
}

function encodeQueryRfc3986(input) {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodePathPreserveSlash(input) {
  return encodeQueryRfc3986(input).replace(/%2F/g, '/')
}
