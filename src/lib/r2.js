/**
 * r2.js — Frontend helper for generating presigned URLs via the r2-signer Worker.
 *
 * The signer worker is the ONLY place that holds R2 credentials.
 * The frontend never has direct access to R2 secrets.
 *
 * Endpoints:
 *   POST /sign/upload   { key, expires? }  → { url, key }  (PUT presigned, auth or guest)
 *   POST /sign/download { key, expires? }  → { url }       (GET presigned, auth only)
 *
 * DELETE is handled server-side by the API worker via native R2 bindings.
 */

import { getToken } from './api.js';

const RAW_SIGNER_URL = import.meta.env.VITE_R2_SIGNER_URL || '';
const SIGNER_URL = RAW_SIGNER_URL
  .replace(/\/$/, '')
  .replace(/\/sign\/(upload|download)$/, '');

if (!SIGNER_URL && import.meta.env.DEV) {
  console.warn('[r2] VITE_R2_SIGNER_URL is not set. File uploads will not work.');
}

if (/\/sign\/(upload|download)\/?$/.test(RAW_SIGNER_URL) && import.meta.env.DEV) {
  console.warn('[r2] VITE_R2_SIGNER_URL should be the signer base URL, not /sign/upload or /sign/download.');
}

async function readSignerPayload(resp) {
  const raw = await resp.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __raw: raw };
  }
}

function getUrlFromPayload(payload) {
  return payload?.url || payload?.signedUrl || payload?.presignedUrl || payload?.data?.url || null;
}

function payloadPreview(payload) {
  if (!payload) return '';
  if (typeof payload.__raw === 'string') return payload.__raw.slice(0, 180);
  try {
    return JSON.stringify(payload).slice(0, 180);
  } catch {
    return '';
  }
}

function signerResponseError(kind, payload) {
  const endpointHint = `Check VITE_R2_SIGNER_URL (current: ${SIGNER_URL})`;
  if (payload?.ok === true && !getUrlFromPayload(payload)) {
    return new Error(`Signer ${kind} endpoint returned ok=true but no url. ${endpointHint}`);
  }
  const preview = payloadPreview(payload);
  if (preview) {
    return new Error(`Signer returned invalid ${kind} response: ${preview}. ${endpointHint}`);
  }
  return new Error(`Signer returned no URL. ${endpointHint}`);
}

/**
 * Generate a unique, collision-resistant R2 object key.
 * Format: {timestamp}_{8-char-uuid}_{sanitized-filename}
 */
export function generateKey(filename) {
  const ts = Date.now();
  const id = crypto.randomUUID().slice(0, 8);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `${ts}_${id}_${safe}`;
}

/**
 * Get a presigned PUT URL to upload a file directly to R2.
 * @param {string} key - R2 object key (generate via generateKey())
 * @param {boolean} isGuest - whether the upload is from a guest session
 * @param {number} expires - TTL in seconds (default 600 for auth, 300 for guests)
 */
export async function getUploadUrl(key, isGuest = false, expires = isGuest ? 300 : 600) {
  if (!SIGNER_URL) throw new Error('R2 signer URL not configured (VITE_R2_SIGNER_URL)');

  const headers = { 'Content-Type': 'application/json' };
  if (!isGuest) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } else {
    headers['X-Upload-Mode'] = 'guest';
  }

  const resp = await fetch(`${SIGNER_URL}/sign/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, expires }),
  });

  const payload = await readSignerPayload(resp);

  if (!resp.ok) {
    throw new Error(payload?.error || payload?.message || `Failed to get upload URL (${resp.status})`);
  }

  const signedUrl = getUrlFromPayload(payload);
  if (signedUrl) return signedUrl;
  if (payload?.error) throw new Error(payload.error);
  throw signerResponseError('upload', payload);
}

/**
 * Get a presigned GET URL to download a file from R2.
 * @param {string} key - R2 object key
 * @param {number} expires - TTL in seconds (max 3600)
 */
export async function getDownloadUrl(key, expires = 300) {
  if (!SIGNER_URL) throw new Error('R2 signer URL not configured (VITE_R2_SIGNER_URL)');

  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const resp = await fetch(`${SIGNER_URL}/sign/download`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, expires }),
  });

  const payload = await readSignerPayload(resp);

  if (!resp.ok) {
    throw new Error(payload?.error || payload?.message || `Failed to get download URL (${resp.status})`);
  }

  const signedUrl = getUrlFromPayload(payload);
  if (signedUrl) return signedUrl;
  if (payload?.error) throw new Error(payload.error);
  throw signerResponseError('download', payload);
}

/**
 * Upload a File object to R2 via a presigned PUT URL.
 * Streams progress via onProgress(percent: 0-100).
 */
export function uploadFileToR2(file, uploadUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    // R2 does not accept custom headers from presigned URL requests — do not add any
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`R2 upload failed with HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during R2 upload'));
    xhr.ontimeout = () => reject(new Error('R2 upload timed out'));
    xhr.timeout = 10 * 60 * 1000; // 10 minute max
    xhr.send(file);
  });
}

/**
 * Human-readable message for common R2 HTTP error codes
 */
export function explainR2Error(status) {
  const map = {
    400: 'Bad request — object key may be malformed.',
    401: 'Unauthorized — presigned URL is invalid.',
    403: 'Forbidden — URL is expired or signature is invalid.',
    404: 'File not found — it may have been deleted.',
    413: 'File too large.',
  };
  return map[status] || `R2 error (HTTP ${status})`;
}
