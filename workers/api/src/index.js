import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { ApiError, ErrorCode } from './errors.js';
import { loginSchema, createEntrySchema, fileMetaSchema } from './schemas.js';
import { authMiddleware, requestLogger, generateToken, verifyToken } from './middleware.js';

const app = new Hono();

app.use('/*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  credentials: true,
  maxAge: 86400,
}));

app.use('/*', requestLogger());

// ── In-memory rate limiter (CF Workers compatible) ─────────────────────────
// Uses a sliding window counter per IP. Resets naturally when the isolate
// is recycled. For stricter persistence, use a CF Rate Limit binding.
const rateBuckets = new Map(); // ip → { count, windowStart }

function checkRateLimit(ip, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart > windowMs) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true; // allowed
  }

  if (bucket.count >= limit) return false; // blocked

  bucket.count++;
  return true; // allowed
}

const rateLimitMiddleware = (limit, windowMs) => async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || 'anonymous';
  if (!checkRateLimit(ip, limit, windowMs)) {
    return c.json({
      error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Please slow down.' },
      requestId: c.get('requestId'),
    }, 429);
  }
  await next();
};

// General API — 120 req/min
app.use('/api/*', rateLimitMiddleware(120, 60_000));
// Auth — 10 req/15min (brute-force protection)
app.use('/api/v1/auth/*', rateLimitMiddleware(10, 15 * 60_000));

// ── Global Error Handler ───────────────────────────────────────────────────
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: c.get('requestId'),
    }, err.status);
  }
  if (err.name === 'ZodError') return c.json({
    error: { code: ErrorCode.VALIDATION_ERROR, message: 'Validation failed', details: err.errors },
    requestId: c.get('requestId'),
  }, 400);

  console.error(`[${c.get('requestId')}] Unhandled:`, err.message);
  return c.json({
    error: { code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred' },
    requestId: c.get('requestId'),
  }, 500);
});

function generateSlug(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/v1/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: 'connected', ts: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, db: 'error' }, 503);
  }
});

// ── AUTH ───────────────────────────────────────────────────────────────────
app.post('/api/v1/auth/login', zValidator('json', loginSchema), async (c) => {
  const { passcode } = c.req.valid('json');
  const allowedPasscodes = [c.env.DEV_PASSCODE, c.env.DEV_PASSCODE_2].filter(Boolean);

  if (allowedPasscodes.length === 0) throw new ApiError(ErrorCode.UNAUTHORIZED, 'No passcodes configured', 403);
  if (!allowedPasscodes.includes(passcode)) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Invalid passcode', 401);

  const secret = c.env.TOKEN_SECRET || 'fallback-secret-change-me';
  const token = await generateToken(
    { passcode, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    secret
  );

  return c.json({ valid: true, token });
});

// ── ENTRIES ────────────────────────────────────────────────────────────────

// GET own entry (authenticated)
app.get('/api/v1/entries/me', authMiddleware(), async (c) => {
  const passcode = c.get('passcode');
  const { results } = await c.env.DB.prepare(`
    SELECT e.*, json_group_array(json_object(
      'id', f.id, 'entry_id', f.entry_id, 'key', f.key,
      'file_url', f.file_url, 'file_name', f.file_name,
      'file_size', f.file_size, 'created_at', f.created_at
    )) as files
    FROM entries e LEFT JOIN files f ON e.id = f.entry_id
    WHERE e.passcode = ? GROUP BY e.id
  `).bind(passcode).all();

  if (!results || results.length === 0) return c.json({ data: null });
  const entry = results[0];
  try {
    if (typeof entry.files === 'string') entry.files = JSON.parse(entry.files);
    if (Array.isArray(entry.files)) entry.files = entry.files.filter(f => f.id !== null);
  } catch { entry.files = []; }
  return c.json({ data: entry, meta: { requestId: c.get('requestId') } });
});

// GET entry by slug (public)
app.get('/api/v1/entries/:slug', async (c) => {
  const slug = c.req.param('slug');
  const { results } = await c.env.DB.prepare(`
    SELECT e.*, json_group_array(json_object(
      'id', f.id, 'entry_id', f.entry_id, 'key', f.key,
      'file_url', f.file_url, 'file_name', f.file_name,
      'file_size', f.file_size, 'created_at', f.created_at
    )) as files
    FROM entries e LEFT JOIN files f ON e.id = f.entry_id
    WHERE e.slug = ? GROUP BY e.id
  `).bind(slug).all();

  if (!results || results.length === 0) throw new ApiError(ErrorCode.ENTRY_NOT_FOUND, 'Entry not found', 404);
  const entry = results[0];
  try {
    if (typeof entry.files === 'string') entry.files = JSON.parse(entry.files);
    if (Array.isArray(entry.files)) entry.files = entry.files.filter(f => f.id !== null);
  } catch { entry.files = []; }
  return c.json({ data: entry, meta: { requestId: c.get('requestId') } });
});

// POST create/update entry
app.post('/api/v1/entries', zValidator('json', createEntrySchema), async (c) => {
  const reqBody = c.req.valid('json');
  const data = reqBody.data;
  let passcode = reqBody.passcode;

  if (!data.is_guest) {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (token) {
      const secret = c.env.TOKEN_SECRET || 'fallback-secret-change-me';
      const payload = await verifyToken(token, secret);
      if (payload?.passcode) passcode = payload.passcode;
    }
  }

  if (data.is_guest) {
    const result = await c.env.DB.prepare(`
      INSERT INTO entries (slug, content, is_guest, updated_at)
      VALUES ('guest-paste', ?, 1, datetime('now'))
      ON CONFLICT(slug) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
      RETURNING *
    `).bind(data.content).first();
    return c.json({ data: result, meta: { requestId: c.get('requestId') } });
  }

  if (passcode) {
    const existing = await c.env.DB.prepare('SELECT * FROM entries WHERE passcode = ?').bind(passcode).first();
    if (existing) {
      const result = await c.env.DB.prepare(`
        UPDATE entries SET content = ?, updated_at = datetime('now') WHERE passcode = ? RETURNING *
      `).bind(data.content, passcode).first();
      return c.json({ data: result, meta: { requestId: c.get('requestId') } });
    } else {
      const slug = data.slug || generateSlug();
      const result = await c.env.DB.prepare(`
        INSERT INTO entries (slug, content, passcode, is_guest, created_at, updated_at)
        VALUES (?, ?, ?, 0, datetime('now'), datetime('now')) RETURNING *
      `).bind(slug, data.content, passcode).first();
      return c.json({ data: result, meta: { requestId: c.get('requestId') } });
    }
  }

  throw new ApiError(ErrorCode.UNAUTHORIZED, 'Authentication required for non-guest paste', 401);
});

// DELETE entry (owned)
app.delete('/api/v1/entries/:id', authMiddleware(), async (c) => {
  const id = c.req.param('id');
  const passcode = c.get('passcode');
  const entry = await c.env.DB.prepare('SELECT passcode FROM entries WHERE id = ?').bind(id).first();
  if (!entry) throw new ApiError(ErrorCode.ENTRY_NOT_FOUND, 'Not found', 404);
  if (entry.passcode !== passcode) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Not your paste', 403);

  await c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return c.json({ success: true, meta: { requestId: c.get('requestId') } });
});

// PATCH clear entry content (owned)
app.patch('/api/v1/entries/:id/clear', authMiddleware(), async (c) => {
  const id = c.req.param('id');
  const passcode = c.get('passcode');
  const entry = await c.env.DB.prepare('SELECT passcode FROM entries WHERE id = ?').bind(id).first();
  if (!entry) throw new ApiError(ErrorCode.ENTRY_NOT_FOUND, 'Not found', 404);
  if (entry.passcode !== passcode) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Not your paste', 403);

  const result = await c.env.DB.prepare(`
    UPDATE entries SET content = '', updated_at = datetime('now') WHERE id = ? RETURNING *
  `).bind(id).first();
  return c.json({ data: result, meta: { requestId: c.get('requestId') } });
});

// ── FILES ──────────────────────────────────────────────────────────────────

// POST confirm upload — server verifies R2 object exists, enforces quota, inserts DB record
app.post('/api/v1/files/confirm', zValidator('json', fileMetaSchema), async (c) => {
  const { filename, key, size, owner, is_guest, entry_id } = c.req.valid('json');

  const GUEST_LIMIT = 1 * 1024 * 1024 * 1024;
  const USER_LIMIT  = 8 * 1024 * 1024 * 1024;
  const { results: usageRows } = await c.env.DB.prepare(
    'SELECT is_guest, COALESCE(SUM(file_size),0) as total_bytes FROM files GROUP BY is_guest'
  ).all();
  let guestBytes = 0, userBytes = 0;
  for (const r of usageRows || []) {
    if (r.is_guest === 1) guestBytes = Number(r.total_bytes);
    else userBytes = Number(r.total_bytes);
  }
  const currentBytes = is_guest ? guestBytes : userBytes;
  const limit = is_guest ? GUEST_LIMIT : USER_LIMIT;
  if (currentBytes + size > limit) {
    throw new ApiError(ErrorCode.QUOTA_EXCEEDED, 'Storage quota exceeded', 413);
  }

  // Verify object exists in R2 via native binding (if binding is configured)
  if (c.env.R2_BUCKET) {
    const head = await c.env.R2_BUCKET.head(key);
    if (!head) throw new ApiError(ErrorCode.ENTRY_NOT_FOUND, 'Object not found in R2 — upload may have failed', 422);
  }

  const account = c.env.R2_ACCOUNT_ID || '';
  const bucket  = c.env.R2_BUCKET_NAME || '';
  const publicUrl = (account && bucket)
    ? `https://pub-${account}.r2.dev/${encodeURIComponent(key)}`
    : `https://r2-placeholder.invalid/${encodeURIComponent(key)}`;

  const result = await c.env.DB.prepare(`
    INSERT INTO files (entry_id, file_url, file_name, file_size, key, owner, is_guest, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *
  `).bind(entry_id, publicUrl, filename, size, key, owner, is_guest ? 1 : 0).first();
  return c.json({ data: result, meta: { requestId: c.get('requestId') } });
});

// DELETE file by key (ownership verified)
app.delete('/api/v1/files/key/:key', authMiddleware(), async (c) => {
  const key = c.req.param('key');
  const passcode = c.get('passcode');
  const file = await c.env.DB.prepare(
    'SELECT f.*, e.passcode FROM files f JOIN entries e ON f.entry_id = e.id WHERE f.key = ?'
  ).bind(key).first();
  if (!file) return c.json({ success: false });
  if (file.passcode !== passcode) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Not your file', 403);

  if (c.env.R2_BUCKET) {
    try { await c.env.R2_BUCKET.delete(key); } catch (e) { console.warn('[R2 delete]', e?.message); }
  }
  await c.env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
  return c.json({ success: true, deletedFile: file, meta: { requestId: c.get('requestId') } });
});

// DELETE file by id (ownership verified)
app.delete('/api/v1/files/:id', authMiddleware(), async (c) => {
  const id = c.req.param('id');
  const passcode = c.get('passcode');
  const file = await c.env.DB.prepare(
    'SELECT f.*, e.passcode FROM files f JOIN entries e ON f.entry_id = e.id WHERE f.id = ?'
  ).bind(id).first();
  if (!file) throw new ApiError(ErrorCode.ENTRY_NOT_FOUND, 'File not found', 404);
  if (file.passcode !== passcode) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Not your file', 403);

  if (c.env.R2_BUCKET && file.key) {
    try { await c.env.R2_BUCKET.delete(file.key); } catch (e) { console.warn('[R2 delete]', e?.message); }
  }
  await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return c.json({ success: true, id, deletedFile: file, meta: { requestId: c.get('requestId') } });
});

// ── STATS & MISC ───────────────────────────────────────────────────────────

app.get('/api/v1/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT is_guest, COALESCE(SUM(file_size), 0) as total_bytes FROM files GROUP BY is_guest'
  ).all();
  let guestBytes = 0, userBytes = 0;
  for (const r of results || []) {
    if (r.is_guest === 1) guestBytes = Number(r.total_bytes || 0);
    else userBytes = Number(r.total_bytes || 0);
  }
  return c.json({ data: { guestBytes, userBytes }, meta: { requestId: c.get('requestId') } });
});

app.post('/api/v1/entries/:slug/views', async (c) => {
  const slug = c.req.param('slug');
  await c.env.DB.prepare('UPDATE entries SET views = views + 1 WHERE slug = ?').bind(slug).run();
  return c.json({ success: true });
});

export default app;
