import { neon } from '@neondatabase/serverless'

const connectionString = import.meta.env.VITE_NEON_DATABASE_URL

if (!connectionString) {
  throw new Error('Missing Neon database URL. Please check your .env file.')
}

// Create Neon SQL client
const sql = neon(connectionString)

// Database operations
export const db = {
  // Create or update a paste entry
  async createOrUpdateEntry(data, passcode) {
    if (data.is_guest) {
      // Guest mode: upsert a single shared entry
      const result = await sql`
        INSERT INTO entries (slug, content, is_guest, updated_at)
        VALUES ('guest-paste', ${data.content}, true, NOW())
        ON CONFLICT (slug) 
        DO UPDATE SET 
          content = ${data.content},
          updated_at = NOW()
        RETURNING *
      `
      return result[0]
    }
    
    if (passcode) {
      // Check if entry exists
      const existing = await sql`
        SELECT * FROM entries WHERE passcode = ${passcode}
      `
      
      if (existing.length > 0) {
        // Update existing entry
        const result = await sql`
          UPDATE entries 
          SET content = ${data.content}, updated_at = NOW()
          WHERE passcode = ${passcode}
          RETURNING *
        `
        return result[0]
      } else {
        // Create new entry with passcode
        const result = await sql`
          INSERT INTO entries (slug, content, passcode, is_guest, created_at, updated_at)
          VALUES (
            ${data.slug || generateSlug()},
            ${data.content},
            ${passcode},
            false,
            NOW(),
            NOW()
          )
          RETURNING *
        `
        return result[0]
      }
    }

    // Fallback - create a new entry
    const result = await sql`
      INSERT INTO entries (slug, content, is_guest, created_at, updated_at)
      VALUES (
        ${data.slug || generateSlug()},
        ${data.content},
        ${data.is_guest || false},
        NOW(),
        NOW()
      )
      RETURNING *
    `
    return result[0]
  },

  async getEntry(slug) {
    const entries = await sql`
      SELECT e.*, 
        COALESCE(
          json_agg(
            json_build_object(
              'id', f.id,
              'entry_id', f.entry_id,
              'key', f.key,
              'file_url', f.file_url,
              'file_name', f.file_name,
              'file_size', f.file_size,
              'created_at', f.created_at
            )
          ) FILTER (WHERE f.id IS NOT NULL),
          '[]'
        ) as files
      FROM entries e
      LEFT JOIN files f ON e.id = f.entry_id
      WHERE e.slug = ${slug}
      GROUP BY e.id
    `
    
    if (entries.length === 0) {
      throw new Error('Entry not found')
    }
    return entries[0]
  },

  async getEntryByPasscode(passcode) {
    const entries = await sql`
      SELECT e.*, 
        COALESCE(
          json_agg(
            json_build_object(
              'id', f.id,
              'entry_id', f.entry_id,
              'key', f.key,
              'file_url', f.file_url,
              'file_name', f.file_name,
              'file_size', f.file_size,
              'created_at', f.created_at
            )
          ) FILTER (WHERE f.id IS NOT NULL),
          '[]'
        ) as files
      FROM entries e
      LEFT JOIN files f ON e.id = f.entry_id
      WHERE e.passcode = ${passcode}
      GROUP BY e.id
    `
    
    return entries.length > 0 ? entries[0] : null
  },

  // Delete entry (only for passcode mode)
  async deleteEntry(id) {
    await sql`DELETE FROM entries WHERE id = ${id}`
  },

  // Clear content of entry (alternative to delete)
  async clearEntry(passcode) {
    const result = await sql`
      UPDATE entries 
      SET content = '', updated_at = NOW()
      WHERE passcode = ${passcode}
      RETURNING *
    `
    if (result.length === 0) {
      throw new Error('Entry not found')
    }
    return result[0]
  },

  // Upload file - Note: Neon doesn't have built-in storage, you'll need to use a service like S3, Cloudflare R2, or Vercel Blob
  async uploadFile(file, entryId) {
    throw new Error('File upload not implemented. Please configure an external storage provider (S3, R2, Vercel Blob, etc.)')
  },

  // Return aggregated file sizes (bytes) for guests and non-guests
  async getAllFileSizes() {
    try {
      // Try direct grouping by files.is_guest (if column exists)
      const rows = await sql`
        SELECT is_guest, COALESCE(SUM(file_size), 0) AS total_bytes
        FROM files
        GROUP BY is_guest
      `

      let guestBytes = 0
      let userBytes = 0
      for (const r of rows) {
        if (r.is_guest) guestBytes = Number(r.total_bytes || 0)
        else userBytes = Number(r.total_bytes || 0)
      }
      return { guestBytes, userBytes }
    } catch (err) {
      // Fallback: files table may not have is_guest column; join entries to determine guest vs user
      const rows = await sql`
        SELECT
          COALESCE(SUM(CASE WHEN e.is_guest THEN f.file_size ELSE 0 END), 0) AS guest_bytes,
          COALESCE(SUM(CASE WHEN e.is_guest THEN 0 ELSE f.file_size END), 0) AS user_bytes
        FROM files f
        LEFT JOIN entries e ON f.entry_id = e.id
      `
      const r = rows[0] || { guest_bytes: 0, user_bytes: 0 }
      return { guestBytes: Number(r.guest_bytes || 0), userBytes: Number(r.user_bytes || 0) }
    }
  },

  // Insert a file metadata record after successful upload
  async insertFileMetadata({ filename, key, size, owner = null, is_guest = false, entry_id = null }) {
    // Build a public URL based on Cloudflare R2 S3-compatible public URL format
    const account = import.meta.env.VITE_R2_ACCOUNT_ID || ''
    const bucket = import.meta.env.VITE_R2_BUCKET_NAME || ''
    // Always provide a non-null value to satisfy NOT NULL constraint.
    // If env is missing, store a harmless placeholder; downloads use the object key with presigned URLs anyway.
    const publicUrl = (account && bucket)
      ? `https://${account}.r2.cloudflarestorage.com/${bucket}/${encodeURIComponent(key)}`
      : `https://r2-placeholder.invalid/${encodeURIComponent(key)}`

    const result = await sql`
      INSERT INTO files (entry_id, file_url, file_name, file_size, key, owner, is_guest, created_at)
      VALUES (
        ${entry_id},
        ${publicUrl},
        ${filename},
        ${size},
        ${key},
        ${owner},
        ${is_guest},
        NOW()
      )
      RETURNING *
    `
    return result[0]
  },

  // Delete metadata by key (used after R2 delete)
  async deleteFileMetadata(key) {
    const rows = await sql`SELECT * FROM files WHERE key = ${key}`
    if (rows.length === 0) return { success: false }
    const file = rows[0]
    await sql`DELETE FROM files WHERE key = ${key}`
    return { success: true, deletedFile: file }
  },

  // Delete a file
  async deleteFile(fileId) {
    const files = await sql`
      SELECT * FROM files WHERE id = ${fileId}
    `
    
    if (files.length === 0) {
      throw new Error('File not found')
    }
    
    const fileRecord = files[0]
    
    // Delete file record from database
    await sql`DELETE FROM files WHERE id = ${fileId}`
    
    return { success: true, id: fileId, deletedFile: fileRecord }
  },

  // Increment view count for an entry
  async incrementViews(slug) {
    try {
      await sql`
        UPDATE entries 
        SET views = views + 1
        WHERE slug = ${slug}
      `
    } catch (error) {
      console.warn('Failed to increment views:', error)
    }
  },

  // Clean up expired guest entries
  async cleanupExpiredEntries() {
    await sql`
      DELETE FROM entries 
      WHERE expires_at < NOW() 
      AND is_guest = true
    `
  },
}

// Utility functions
export const utils = {
  // Generate unique slug
  generateSlug(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  },

  // Format file size
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },

  // Format a date (Date or ISO string) as en-GB with UTC suffix
  formatDate(dateInput) {
    if (!dateInput) return '...'
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    try {
      return (
        date.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'UTC',
        }) + ' UTC'
      )
    } catch {
      return date.toISOString()
    }
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy: ', err)
      return false
    }
  }
}

// Helper function for slug generation
function generateSlug(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
