// Shared helpers for Cloudflare R2 presigned URLs

const getSignerBase = () => {
  const base = import.meta.env.VITE_R2_SIGNER_URL
  if (!base) {
    throw new Error('Missing VITE_R2_SIGNER_URL in .env')
  }
  return base.replace(/\/$/, '')
}

/**
 * Get a presigned URL from the R2 signer Worker
 * method: 'GET' | 'PUT' | 'DELETE'
 * key: object key in the bucket
 * expires: seconds (default 300)
 */
export async function getSignedUrl(key, method = 'GET', expires = 300) {
  const endpoint = `${getSignerBase()}/sign`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, method, expires })
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const j = await resp.json()
      if (j?.error) detail = `: ${j.error}`
    } catch {
      // ignore
    }
    throw new Error(`Failed to get signed URL (status ${resp.status})${detail}`)
  }
  const data = await resp.json()
  if (!data.url) throw new Error('Signer did not return a URL')
  return data.url
}

/**
 * User-friendly message for common R2 download errors
 */
export function explainDownloadFailure(status) {
  if (status === 400) return 'Bad request to R2 (400). The object key may be malformed.'
  if (status === 401) return 'Unauthorized (401). Check that your presigned URL is valid.'
  if (status === 403) return 'Forbidden (403). This usually means the URL is missing/expired a signature. Ensure VITE_R2_SIGNER_URL is configured and try again.'
  if (status === 404) return 'File not found (404). It may have been deleted or the key is wrong.'
  return `Download failed (status ${status})`
}
