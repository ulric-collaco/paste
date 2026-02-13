
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'; // Default for local dev

// Helper to handle API responses
async function fetchApi(endpoint, options = {}) {
    const url = `${API_URL}/api${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    });

    if (!response.ok) {
        if (response.status === 404) return null; // Handle not found gracefully in some cases
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    // Handle empty responses (e.g. DELETE)
    if (response.status === 204) return null;

    try {
        return await response.json();
    } catch (e) {
        return null;
    }
}

export const db = {
    // Create or update a paste entry
    async createOrUpdateEntry(data, passcode) {
        const result = await fetchApi('/entries', {
            method: 'POST',
            body: JSON.stringify({ data, passcode }),
        });
        return result;
    },

    async getEntry(slug) {
        const entry = await fetchApi(`/entries/${slug}`);
        if (!entry) throw new Error('Entry not found');
        return entry;
    },

    async getEntryByPasscode(passcode) {
        return await fetchApi(`/entries/passcode/${passcode}`);
    },

    // Delete entry
    async deleteEntry(id) {
        await fetchApi(`/entries/${id}`, { method: 'DELETE' });
    },

    // Clear content
    async clearEntry(passcode) {
        return await fetchApi(`/entries/passcode/${passcode}/clear`, { method: 'PUT' });
    },

    // Upload file - metadata insertion
    async insertFileMetadata(fileData) {
        return await fetchApi('/files', {
            method: 'POST',
            body: JSON.stringify(fileData),
        });
    },

    // Delete metadata by key
    async deleteFileMetadata(key) {
        return await fetchApi(`/files/key/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },

    // Delete file
    async deleteFile(fileId) {
        return await fetchApi(`/files/${fileId}`, { method: 'DELETE' });
    },

    // Increment view count
    async incrementViews(slug) {
        await fetchApi(`/entries/${slug}/views`, { method: 'POST' });
    },

    // Get aggregated file sizes
    async getAllFileSizes() {
        return await fetchApi('/stats');
    },

    // Cleanup - this is now server-side logic but keeping the method stub just in case
    async cleanupExpiredEntries() {
        // No-op or call an admin endpoint
        console.warn('cleanupExpiredEntries is now handled by the server cron/scheduled tasks');
    },

    // Keep uploadFile throwing error as before, or implement actual upload via presigned URL if needed
    async uploadFile(file, entryId) {
        throw new Error('File upload not implemented. Please configure an external storage provider (S3, R2, Vercel Blob, etc.)');
    },

    // Securely verify passcode via API (server-side check)
    async verifyPasscode(passcode) {
        try {
            const res = await fetchApi('/verify-passcode', {
                method: 'POST',
                body: JSON.stringify({ passcode })
            });
            return res && res.valid;
        } catch (e) {
            return false;
        }
    },
};

// Utility functions - copied from neon.js as they are client-side helpers
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
