-- D1 Database Schema for Paste Application
-- Run this using `wrangler d1 execute paste-db --file=workers/api/schema.sql --remote`

-- Create entries table
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    content TEXT DEFAULT '',
    passcode TEXT,
    is_guest INTEGER DEFAULT 0, -- 0 for false, 1 for true
    views INTEGER DEFAULT 0,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create files table
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    key TEXT UNIQUE,
    owner TEXT,
    is_guest INTEGER DEFAULT 0, -- 0 for false, 1 for true
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);
CREATE INDEX IF NOT EXISTS idx_entries_passcode ON entries(passcode);
CREATE INDEX IF NOT EXISTS idx_entries_is_guest ON entries(is_guest);
CREATE INDEX IF NOT EXISTS idx_entries_expires_at ON entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_entry_id ON files(entry_id);

-- Clean up expired guest entries (Can be run periodically via cron)
-- Note: D1 doesn't support stored procedures like PL/pgSQL directly.
-- This query needs to be executed by a Worker/Cron Trigger.
-- DELETE FROM entries WHERE expires_at < datetime('now') AND is_guest = 1;

-- Trigger to update updated_at
CREATE TRIGGER IF NOT EXISTS update_entries_updated_at
AFTER UPDATE ON entries
BEGIN
    UPDATE entries SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
