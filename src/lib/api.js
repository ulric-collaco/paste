const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'; // Default for local dev

export const getToken = () => {
    if (typeof document === 'undefined') return null;
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === 'session_token' ? decodeURIComponent(parts[1]) : r;
    }, null);
}

// Helper to handle API responses
async function fetchApi(endpoint, options = {}) {
    const url = `${API_URL}/api/v1${endpoint}`;
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        if (response.status === 404) return null; // Handle not found gracefully in some cases
        let errorMsg = `API Error ${response.status}`;
        try {
            const errorJson = await response.json();
            if (errorJson.error) errorMsg = errorJson.error.message;
        } catch (_) {
            errorMsg += `: ${await response.text()}`;
        }
        throw new Error(errorMsg);
    }

    // Handle empty responses (e.g. DELETE)
    if (response.status === 204) return null;

    try {
        const json = await response.json();
        if (json && json.data !== undefined) return json.data;
        return json;
    } catch (e) {
        return null;
    }
}

export const db = {
    // Create or update a paste entry
    async createOrUpdateEntry(data, passcode) {
        // passcode is optional now if token is used
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

    async getEntryByPasscode() {
        return await fetchApi(`/entries/me`);
    },

    // Delete entry
    async deleteEntry(id) {
        await fetchApi(`/entries/${id}`, { method: 'DELETE' });
    },

    // Clear content
    async clearEntry(id) {
        return await fetchApi(`/entries/${id}/clear`, { method: 'PATCH' });
    },

    // Confirm file upload — server verifies object exists in R2, enforces quota, then inserts DB record.
    // Call this AFTER the client has PUT the file to R2 via presigned URL.
    async confirmFileUpload(fileData) {
        return await fetchApi('/files/confirm', {
            method: 'POST',
            body: JSON.stringify(fileData),
        });
    },

    // Legacy alias kept for backward compatibility — calls confirm under the hood
    async insertFileMetadata(fileData) {
        return this.confirmFileUpload(fileData);
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
            const res = await fetchApi('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ passcode })
            });
            // res = { valid: true, token: 'xxx' } (due to fetchApi unwrap not applying here maybe? Actually, verifyPasscode might return { valid, token } since it doesn't have a 'data' envelope)
            // Wait, my API returns c.json({ valid: true, token }) without a data wrapper.
            // fetchApi will return it directly since json.data is undefined
            return res;
        } catch (e) {
            return false;
        }
    },
};

// Utility functions
export const utils = {
    generateSlug(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
        let result = ''
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        return result
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },

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
