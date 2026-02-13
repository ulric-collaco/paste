import React, { useState, useRef, useEffect } from 'react'
import { Upload, Download, Trash2 } from 'lucide-react'
import { db, utils } from '../lib/api'
import { getSignedUrl, explainDownloadFailure } from '../lib/r2'

// Small helper to format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Generate a unique key for R2 object
const generateKey = (filename) => {
  const ts = Date.now()
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${ts}_${safe}`
}

// R2UploadPanel: Handles uploads using signed PUT URLs and tracks progress and quota
export default function R2UploadPanel({ entryId, isGuestMode, onFilesChange, existingFiles = [] }) {
  const [files, setFiles] = useState(existingFiles)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({}) // key -> percent
  const [error, setError] = useState(null)
  const [usage, setUsage] = useState({ guestBytes: 0, userBytes: 0 })
  const fileInputRef = useRef(null)

  const GUEST_LIMIT = 1 * 1024 * 1024 * 1024 // 1GB
  const USER_LIMIT = 8 * 1024 * 1024 * 1024 // 8GB

  const loadUsage = async () => {
    try {
      const u = await db.getAllFileSizes()
      setUsage(u)
    } catch (e) {
      console.error('Failed to load usage', e)
    }
  }

  useEffect(() => { loadUsage() }, [])

  const handleSelect = async (e) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    await handleFiles(selected)
    e.target.value = ''
  }

  const checkQuota = (size) => {
    if (isGuestMode) {
      return (usage.guestBytes + size) <= GUEST_LIMIT
    }
    // combined users share USER_LIMIT (both accounts together)
    return (usage.userBytes + size) <= USER_LIMIT
  }

  // Use shared signer helper from lib/r2

  const uploadToR2 = (file, key, onProgress) => {
    return new Promise(async (resolve, reject) => {
      try {
        const url = await getSignedUrl(key, 'PUT')

        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url, true)
        // Do not set custom x-amz-* headers to avoid CORS preflight
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            onProgress(pct)
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ url, key })
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      } catch (err) {
        reject(err)
      }
    })
  }

  const handleFiles = async (selectedFiles) => {
    setError(null)
    const valid = []
    for (const f of selectedFiles) {
      if (f.size === 0) continue
      // quota check
      if (!checkQuota(f.size)) {
        setError(`Uploading ${f.name} would exceed your storage quota.`)
        return
      }
      valid.push(f)
    }

    if (valid.length === 0) return

    setIsUploading(true)
    try {
      for (const f of valid) {
        const key = generateKey(f.name)
        setUploadProgress((p) => ({ ...p, [key]: 0 }))

        const res = await uploadToR2(f, key, (pct) => setUploadProgress((p) => ({ ...p, [key]: pct })))

        // Insert metadata in Neon
        const meta = await db.insertFileMetadata({ filename: f.name, key, size: f.size, owner: null, is_guest: isGuestMode, entry_id: entryId })

        // Add to list
        setFiles((prev) => [meta, ...prev])
        onFilesChange && onFilesChange((prev) => [meta, ...(prev || [])])

        // Update usage
        await loadUsage()
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Upload failed')
    } finally {
      setIsUploading(false)
      setUploadProgress({})
    }
  }

  const handleDelete = async (fileMeta) => {
    if (!window.confirm(`Delete "${fileMeta.file_name}"?`)) return
    try {
      // Delete using signed URL
      const url = await getSignedUrl(fileMeta.key, 'DELETE')
      const resp = await fetch(url, { method: 'DELETE' })
      if (!resp.ok) throw new Error('Failed to delete object from R2')

      // Remove metadata
      await db.deleteFileMetadata(fileMeta.key)
      setFiles((prev) => prev.filter((f) => f.key !== fileMeta.key))
      onFilesChange && onFilesChange((prev) => (prev || []).filter((f) => f.key !== fileMeta.key))
      await loadUsage()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Delete failed')
    }
  }

  const handleDownload = async (fileMeta) => {
    try {
      // Use signed GET URL
      const url = await getSignedUrl(fileMeta.key, 'GET')
      // Debug: ensure we see encoded credential and fresh date
      try {
        const u = new URL(url)
        // eslint-disable-next-line no-console
        console.log('[r2-download] X-Amz-Date:', u.searchParams.get('X-Amz-Date'), 'now:', new Date().toISOString())
        // eslint-disable-next-line no-console
        console.log('[r2-download] X-Amz-Credential:', u.searchParams.get('X-Amz-Credential'))
      } catch (_) { }

      // Fetch as blob to avoid extensions stripping query params on navigation
      const resp = await fetch(url, { method: 'GET' })
      if (!resp.ok) throw new Error(explainDownloadFailure(resp.status))
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileMeta.file_name || fileMeta.key
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      console.error(err)
      setError('Download failed')
    }
  }

  // progress percentages
  const guestPct = Math.min(100, Math.round((usage.guestBytes / GUEST_LIMIT) * 100))
  const userPct = Math.min(100, Math.round((usage.userBytes / USER_LIMIT) * 100))

  return (
    <div>
      {/* Quota bars */}
      <div className="mb-4 flex gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-neutral-300">Guest Storage</span>
            <span className="text-xs text-neutral-500">{formatBytes(usage.guestBytes)} / 1 GB</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-2">
            <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${guestPct}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-neutral-300">User Storage</span>
            <span className="text-xs text-neutral-500">{formatBytes(usage.userBytes)} / 8 GB</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-2">
            <div className="bg-green-600 h-2 rounded-full" style={{ width: `${userPct}%` }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="border border-dashed rounded-lg p-6 text-center mb-6">
        <Upload size={36} className="mx-auto text-neutral-400 mb-2" />
        <div className="text-neutral-300 mb-2">Drag & drop or select files to upload</div>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleSelect} />
        <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="btn btn-primary">
          Select Files
        </button>
      </div>

      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.id || f.key} className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-900 rounded-md">
            <div className="min-w-0">
              <div className="text-gray-200 truncate">{f.file_name}</div>
              <div className="text-sm text-neutral-500">{formatBytes(f.file_size)} • {new Date(f.created_at).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button onClick={() => handleDownload(f)} className="p-2 text-neutral-400 hover:text-neutral-200"><Download size={16} /></button>
              <button onClick={() => handleDelete(f)} className="p-2 text-neutral-400 hover:text-red-400"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
