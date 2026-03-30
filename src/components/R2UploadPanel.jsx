import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, Download, Trash2 } from 'lucide-react'
import { db, utils } from '../lib/api'
import { generateKey, getUploadUrl, getDownloadUrl, uploadFileToR2, explainR2Error } from '../lib/r2'

/**
 * R2UploadPanel — handles the full 3-step upload flow:
 *   1. Generate a collision-resistant key
 *   2. Get a presigned PUT URL from the r2-signer worker (authenticated)
 *   3. PUT the file to R2 directly (streaming, with progress)
 *   4. POST /api/v1/files/confirm to the API worker — server verifies R2 object
 *      exists and enforces server-side quota before inserting the DB record.
 *
 * DELETE is fully server-side: the API worker deletes from R2 via native binding
 * after verifying ownership in D1. No presigned DELETE URLs are ever issued.
 */
export default function R2UploadPanel({ entryId, isGuestMode, onFilesChange, existingFiles = [] }) {
  const [files, setFiles] = useState(existingFiles)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({}) // key → 0-100
  const [error, setError] = useState(null)
  const [usage, setUsage] = useState({ guestBytes: 0, userBytes: 0 })
  const fileInputRef = useRef(null)

  const GUEST_LIMIT = 1 * 1024 * 1024 * 1024  // 1 GB
  const USER_LIMIT  = 8 * 1024 * 1024 * 1024  // 8 GB

  const loadUsage = useCallback(async () => {
    try {
      const u = await db.getAllFileSizes()
      if (u) setUsage(u)
    } catch (e) {
      console.warn('[R2UploadPanel] Failed to load usage stats', e)
    }
  }, [])

  useEffect(() => { loadUsage() }, [loadUsage])

  // Client-side pre-check (informational, not a security gate — server enforces quota too)
  const exceedsQuota = (size) => {
    const current = isGuestMode ? usage.guestBytes : usage.userBytes
    const limit   = isGuestMode ? GUEST_LIMIT : USER_LIMIT
    return current + size > limit
  }

  const handleSelect = async (e) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length) await handleFiles(selected)
    e.target.value = ''
  }

  const handleFiles = async (selectedFiles) => {
    setError(null)

    const valid = selectedFiles.filter(f => {
      if (f.size === 0) { setError('Cannot upload empty files.'); return false }
      if (exceedsQuota(f.size)) {
        setError(`"${f.name}" would exceed your ${isGuestMode ? '1 GB guest' : '8 GB'} storage quota.`)
        return false
      }
      return true
    })
    if (!valid.length) return

    setIsUploading(true)
    try {
      for (const file of valid) {
        const key = generateKey(file.name)
        setUploadProgress(p => ({ ...p, [key]: 0 }))

        // Step 1 — get presigned PUT URL
        const uploadUrl = await getUploadUrl(key, isGuestMode)

        // Step 2 — stream file to R2 with progress
        await uploadFileToR2(file, uploadUrl, pct =>
          setUploadProgress(p => ({ ...p, [key]: pct }))
        )

        // Step 3 — confirm with server: server verifies R2 object + enforces quota + inserts
        const meta = await db.confirmFileUpload({
          filename: file.name,
          key,
          size:     file.size,
          owner:    null,
          is_guest: isGuestMode,
          entry_id: entryId,
        })

        setFiles(prev => [meta, ...prev])
        onFilesChange && onFilesChange(prev => [meta, ...(prev || [])])
        await loadUsage()
      }
    } catch (err) {
      console.error('[R2UploadPanel] upload error', err)
      setError(err.message || 'Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
      setUploadProgress({})
    }
  }

  const handleDelete = async (fileMeta) => {
    if (!window.confirm(`Delete "${fileMeta.file_name}"?`)) return
    try {
      // Server deletes from R2 + D1 and verifies ownership
      await db.deleteFile(fileMeta.id)
      setFiles(prev => prev.filter(f => f.id !== fileMeta.id))
      onFilesChange && onFilesChange(prev => (prev || []).filter(f => f.id !== fileMeta.id))
      await loadUsage()
    } catch (err) {
      console.error('[R2UploadPanel] delete error', err)
      setError(err.message || 'Delete failed.')
    }
  }

  const handleDownload = async (fileMeta) => {
    try {
      if (!fileMeta.key) {
        // Fallback: open stored URL — may be private
        window.open(fileMeta.file_url, '_blank')
        return
      }
      // Get presigned GET URL — navigate to it so the browser streams natively
      // (avoids loading the entire file into RAM via fetch+blob for large files)
      const url = await getDownloadUrl(fileMeta.key)
      const a = document.createElement('a')
      a.href = url
      a.download = fileMeta.file_name || fileMeta.key
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      console.error('[R2UploadPanel] download error', err)
      if (err.message.includes('403') || err.message.includes('Guest')) {
        setError('Download requires authentication.')
      } else {
        setError(err.message || 'Download failed.')
      }
    }
  }

  const guestPct = Math.min(100, Math.round((usage.guestBytes / GUEST_LIMIT) * 100))
  const userPct  = Math.min(100, Math.round((usage.userBytes  / USER_LIMIT)  * 100))

  return (
    <div>
      {/* Quota bars */}
      <div className="mb-4 flex gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-neutral-300">Guest Storage</span>
            <span className="text-xs text-neutral-500">{utils.formatFileSize(usage.guestBytes)} / 1 GB</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${guestPct > 85 ? 'bg-red-500' : 'bg-purple-600'}`} style={{ width: `${guestPct}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-neutral-300">User Storage</span>
            <span className="text-xs text-neutral-500">{utils.formatFileSize(usage.userBytes)} / 8 GB</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${userPct > 85 ? 'bg-red-500' : 'bg-green-600'}`} style={{ width: `${userPct}%` }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-950/40 border border-red-800/60 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Drop zone */}
      <div className="border border-dashed rounded-lg p-6 text-center mb-6">
        <Upload size={36} className="mx-auto text-neutral-400 mb-2" />
        <div className="text-neutral-300 mb-2">Drag & drop or select files</div>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleSelect} disabled={isUploading} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Uploading…' : 'Select Files'}
        </button>
      </div>

      {/* Active progress bars */}
      {Object.entries(uploadProgress).map(([key, pct]) => (
        <div key={key} className="mb-2">
          <div className="flex justify-between text-xs text-neutral-400 mb-1">
            <span className="truncate">{key.split('_').slice(2).join('_')}</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ))}

      {/* File list */}
      <div className="space-y-2">
        {files.map(f => (
          <div key={f.id || f.key} className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-900 rounded-md hover:border-neutral-800 transition-colors">
            <div className="min-w-0">
              <div className="text-gray-200 truncate">{f.file_name}</div>
              <div className="text-sm text-neutral-500">{utils.formatFileSize(f.file_size)} • {utils.formatDate(f.created_at)}</div>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button onClick={() => handleDownload(f)} className="p-2 text-neutral-400 hover:text-neutral-200 transition-colors" title="Download">
                <Download size={16} />
              </button>
              <button onClick={() => handleDelete(f)} className="p-2 text-neutral-400 hover:text-red-400 transition-colors" title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
