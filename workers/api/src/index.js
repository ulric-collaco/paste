
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('/*', cors());

// Helper for slug generation
function generateSlug(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// POST /api/verify-passcode
app.post('/api/verify-passcode', async (c) => {
    const { passcode } = await c.req.json();

    // You can set these in wrangler.toml or via `wrangler secret put`
    const allowedPasscodes = [
        c.env.DEV_PASSCODE,
        c.env.DEV_PASSCODE_2
    ].filter(Boolean); // Filter out undefined if not set

    // If no passcodes are set in env, allow none (secure default)
    if (allowedPasscodes.length === 0) {
        return c.json({ valid: false, error: 'No passcodes configured on server' }, 403);
    }

    if (allowedPasscodes.includes(passcode)) {
        return c.json({ valid: true });
    }

    return c.json({ valid: false }, 401);
});

// GET /api/entries/:slug
app.get('/api/entries/:slug', async (c) => {
    const slug = c.req.param('slug');
    const { results } = await c.env.DB.prepare(`
    SELECT e.*, 
      json_group_array(
        json_object(
          'id', f.id,
          'entry_id', f.entry_id,
          'key', f.key,
          'file_url', f.file_url,
          'file_name', f.file_name,
          'file_size', f.file_size,
          'created_at', f.created_at
        ) 
      ) as files
    FROM entries e
    LEFT JOIN files f ON e.id = f.entry_id
    WHERE e.slug = ?
    GROUP BY e.id
  `).bind(slug).all();

    if (!results || results.length === 0) {
        return c.json({ error: 'Entry not found' }, 404);
    }

    const entry = results[0];
    // Parse files JSON string if needed (SQLite returns string for json functions sometimes, check D1 behavior)
    try {
        if (typeof entry.files === 'string') {
            entry.files = JSON.parse(entry.files);
        }
        // filter out nulls from left join if no files exist
        if (Array.isArray(entry.files)) {
            entry.files = entry.files.filter(f => f.id !== null);
        }
    } catch (e) {
        entry.files = [];
    }

    return c.json(entry);
});

// GET /api/entries/passcode/:passcode
app.get('/api/entries/passcode/:passcode', async (c) => {
    const passcode = c.req.param('passcode');
    const { results } = await c.env.DB.prepare(`
    SELECT e.*, 
      json_group_array(
        json_object(
          'id', f.id,
          'entry_id', f.entry_id,
          'key', f.key,
          'file_url', f.file_url,
          'file_name', f.file_name,
          'file_size', f.file_size,
          'created_at', f.created_at
        ) 
      ) as files
    FROM entries e
    LEFT JOIN files f ON e.id = f.entry_id
    WHERE e.passcode = ?
    GROUP BY e.id
  `).bind(passcode).all();

    if (!results || results.length === 0) {
        return c.json(null); // Return null effectively if not found, or 404
    }

    const entry = results[0];
    try {
        if (typeof entry.files === 'string') {
            entry.files = JSON.parse(entry.files);
        }
        if (Array.isArray(entry.files)) {
            entry.files = entry.files.filter(f => f.id !== null);
        }
    } catch (e) {
        entry.files = [];
    }

    return c.json(entry);
});


// POST /api/entries (Create or Update)
app.post('/api/entries', async (c) => {
    const { data, passcode } = await c.req.json();

    if (data.is_guest) {
        // Guest mode: upsert a single shared entry
        // SQLite upsert syntax: INSERT ... ON CONFLICT(slug) DO UPDATE SET ...
        const result = await c.env.DB.prepare(`
      INSERT INTO entries (slug, content, is_guest, updated_at)
      VALUES ('guest-paste', ?, 1, DATE('now'))
      ON CONFLICT(slug) DO UPDATE SET
        content = excluded.content,
        updated_at = DATE('now')
      RETURNING *
    `).bind(data.content).first();
        return c.json(result);
    }

    if (passcode) {
        // Check if entry exists
        const existing = await c.env.DB.prepare('SELECT * FROM entries WHERE passcode = ?').bind(passcode).first();

        if (existing) {
            // Update existing entry
            const result = await c.env.DB.prepare(`
        UPDATE entries 
        SET content = ?, updated_at = DATE('now')
        WHERE passcode = ?
        RETURNING *
      `).bind(data.content, passcode).first();
            return c.json(result);
        } else {
            // Create new entry
            const slug = data.slug || generateSlug();
            const result = await c.env.DB.prepare(`
        INSERT INTO entries (slug, content, passcode, is_guest, created_at, updated_at)
        VALUES (?, ?, ?, 0, DATE('now'), DATE('now'))
        RETURNING *
      `).bind(slug, data.content, passcode).first();
            return c.json(result);
        }
    }

    // Fallback - create a new entry without passcode (shouldn't happen based on frontend logic but good to have)
    const slug = data.slug || generateSlug();
    const is_guest = data.is_guest ? 1 : 0;
    const result = await c.env.DB.prepare(`
    INSERT INTO entries (slug, content, is_guest, created_at, updated_at)
    VALUES (?, ?, ?, DATE('now'), DATE('now'))
    RETURNING *
  `).bind(slug, data.content, is_guest).first();

    return c.json(result);
});

// DELETE /api/entries/:id
app.delete('/api/entries/:id', async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
    return c.json({ success: true });
});

// PUT /api/entries/passcode/:passcode/clear
app.put('/api/entries/passcode/:passcode/clear', async (c) => {
    const passcode = c.req.param('passcode');
    const result = await c.env.DB.prepare(`
    UPDATE entries 
    SET content = '', updated_at = DATE('now')
    WHERE passcode = ?
    RETURNING *
  `).bind(passcode).first();

    if (!result) {
        return c.json({ error: 'Entry not found' }, 404);
    }
    return c.json(result);
});


// POST /api/files (Metadata)
app.post('/api/files', async (c) => {
    const { filename, key, size, owner, is_guest, entry_id } = await c.req.json();

    const account = c.env.VITE_R2_ACCOUNT_ID || ''; // Access from env vars
    const bucket = c.env.VITE_R2_BUCKET_NAME || '';

    const publicUrl = (account && bucket)
        ? `https://${account}.r2.cloudflarestorage.com/${bucket}/${encodeURIComponent(key)}`
        : `https://r2-placeholder.invalid/${encodeURIComponent(key)}`;

    const result = await c.env.DB.prepare(`
    INSERT INTO files (entry_id, file_url, file_name, file_size, key, owner, is_guest, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, DATE('now'))
    RETURNING *
  `).bind(entry_id, publicUrl, filename, size, key, owner, is_guest ? 1 : 0).first();

    return c.json(result);
});

// DELETE /api/files/key/:key
app.delete('/api/files/key/:key', async (c) => {
    const key = c.req.param('key');
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE key = ?').bind(key).first();

    if (!file) return c.json({ success: false });

    await c.env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
    return c.json({ success: true, deletedFile: file });
});

// DELETE /api/files/:id
app.delete('/api/files/:id', async (c) => {
    const id = c.req.param('id');
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();

    if (!file) return c.json({ error: 'File not found' }, 404);

    await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
    return c.json({ success: true, id, deletedFile: file });
});

// GET /api/stats (File sizes)
app.get('/api/stats', async (c) => {
    const { results } = await c.env.DB.prepare(`
    SELECT is_guest, COALESCE(SUM(file_size), 0) as total_bytes
    FROM files
    GROUP BY is_guest
  `).all();

    let guestBytes = 0;
    let userBytes = 0;

    if (results) {
        for (const r of results) {
            if (r.is_guest === 1) guestBytes = Number(r.total_bytes || 0);
            else userBytes = Number(r.total_bytes || 0);
        }
    }

    return c.json({ guestBytes, userBytes });
});

// POST /api/entries/:slug/views
app.post('/api/entries/:slug/views', async (c) => {
    const slug = c.req.param('slug');
    await c.env.DB.prepare('UPDATE entries SET views = views + 1 WHERE slug = ?').bind(slug).run();
    return c.json({ success: true });
});

export default app;
