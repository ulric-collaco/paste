-- Neon Database Schema for Paste Application
-- Run this SQL in your Neon database console to set up the tables

-- Create entries table
CREATE TABLE IF NOT EXISTS entries (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) UNIQUE NOT NULL,
    content TEXT DEFAULT '',
    passcode VARCHAR(255),
    is_guest BOOLEAN DEFAULT false,
    views INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create files table
CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);
CREATE INDEX IF NOT EXISTS idx_entries_passcode ON entries(passcode);
CREATE INDEX IF NOT EXISTS idx_entries_is_guest ON entries(is_guest);
CREATE INDEX IF NOT EXISTS idx_entries_expires_at ON entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_entry_id ON files(entry_id);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Optional: Create a function to clean up expired guest entries
-- You can call this periodically or set up a cron job
CREATE OR REPLACE FUNCTION cleanup_expired_entries()
RETURNS void AS $$
BEGIN
    DELETE FROM entries 
    WHERE expires_at < NOW() 
    AND is_guest = true;
END;
$$ LANGUAGE plpgsql;
