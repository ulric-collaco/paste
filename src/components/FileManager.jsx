import React, { useState, useCallback } from 'react';
import { X, Upload, Download, Trash2, AlertCircle } from 'lucide-react';
import { db, utils } from '../lib/neon';
import { useApp } from '../contexts/AppContext';
import R2UploadPanel from './R2UploadPanel';
import { getSignedUrl, explainDownloadFailure } from '../lib/r2';

const FileManager = ({ isOpen, onClose, entryId, files, onFilesChange }) => {
  const { mode } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingFiles, setDeletingFiles] = useState(new Set());
  const [error, setError] = useState(null);

  // Maximum file size in MB (can be made configurable via props)
  const MAX_SIZE_MB = 100;

  const handleFileUpload = useCallback(async (filesToUpload) => {
    if (!filesToUpload.length) return;

    // Guard for missing entryId
    if (!entryId) {
      setError('Cannot upload files: Entry ID is required');
      return;
    }

    // File validation
    const validationErrors = [];
    const validFiles = [];

    for (const file of filesToUpload) {
      // Reject zero-byte files
      if (file.size === 0) {
        validationErrors.push(`"${file.name}" is empty (0 bytes)`);
        continue;
      }

      // Check file size limit
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > MAX_SIZE_MB) {
        validationErrors.push(`"${file.name}" is too large (${fileSizeMB.toFixed(1)}MB > ${MAX_SIZE_MB}MB)`);
        continue;
      }

      validFiles.push(file);
    }

    // Show validation errors without calling db.uploadFile
    if (validationErrors.length > 0) {
      setError(`File validation failed:\n${validationErrors.join('\n')}`);
      return;
    }

    if (validFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const uploadedFiles = [];
      let completed = 0;
      
      for (const file of validFiles) {
        // Upload file to storage
        const uploadedFile = await db.uploadFile(file, entryId);
        
        // Merge file_size into the uploaded file object for UI display
        uploadedFiles.push({
          ...uploadedFile,
          file_size: file.size
        });

        // Update progress after each file completes
        completed++;
        setUploadProgress(Math.round((completed / validFiles.length) * 100));
      }

      // Update parent component with new files
      onFilesChange([...files, ...uploadedFiles]);
      
    } catch (error) {
      console.error('Upload error:', error);
      setError(error.message || 'Failed to upload files');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [files, onFilesChange, entryId]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (isUploading) return;
    setIsDragOver(true);
  }, [isUploading]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isUploading) return;
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFileUpload(droppedFiles);
  }, [handleFileUpload, isUploading]);

  const handleFileSelect = useCallback((e) => {
    if (isUploading) return;
    const selectedFiles = Array.from(e.target.files);
    handleFileUpload(selectedFiles);
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  }, [handleFileUpload, isUploading]);

  // No-op here; we use shared helper from lib/r2

  const handleDownload = useCallback(async (file) => {
    try {
      if (!file.key) {
        // Fallback: try opening stored URL, but likely private and will fail
        window.open(file.file_url, '_blank');
        return;
      }
  const url = await getSignedUrl(file.key, 'GET');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(explainDownloadFailure(resp.status));
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.file_name || file.key;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
      setError(err.message || 'Failed to download file');
    }
  }, []);

  const handleDelete = useCallback(async (file) => {
    if (!window.confirm(`Are you sure you want to delete "${file.file_name}"?`)) {
      return;
    }

    setDeletingFiles(prev => new Set([...prev, file.id]));
    setError(null);

    try {
      // Delete object from R2 if key exists
      if (file.key) {
        try {
          const url = await getSignedUrl(file.key, 'DELETE');
          const resp = await fetch(url, { method: 'DELETE' });
          if (!resp.ok) console.warn('R2 delete failed with status', resp.status);
        } catch (e) {
          console.warn('Failed to delete from R2:', e);
        }
        // Remove metadata by key
        try {
          await db.deleteFileMetadata(file.key);
        } catch (e) {
          // fallback to id-based delete
          await db.deleteFile(file.id);
        }
      } else {
        // No key in record, remove by id only
        await db.deleteFile(file.id);
      }
      
      // Update parent component by removing deleted file
      onFilesChange(files.filter(f => f.id !== file.id));
      
    } catch (error) {
      console.error('Delete error:', error);
      setError(error.message || 'Failed to delete file');
    } finally {
      setDeletingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.id);
        return newSet;
      });
    }
  }, [files, onFilesChange, getSignedUrl]);

  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return 'Unknown size';
    return utils.formatFileSize ? utils.formatFileSize(bytes) : `${Math.round(bytes / 1024)} KB`;
  };

  // Use shared formatter
  const formatUploadDate = (dateString) => utils.formatDate(dateString);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="surface max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-900">
          <h2 className="text-xl font-semibold text-gray-100">File Manager</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {/* Guest info banner */}
          {mode === 'guest' && (
            <div className="mb-4 p-3 border border-blue-900/60 rounded-md flex items-center bg-blue-950/30">
              <AlertCircle size={20} className="text-blue-400 mr-2" />
              <span className="text-blue-300 text-sm">
                Guest uploads are limited to 1 GB total and are completely separate from admin uploads.
              </span>
            </div>
          )}
          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 border border-red-900/60 rounded-md flex items-center bg-red-950/30">
              <AlertCircle size={20} className="text-red-400 mr-2" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {/* File Upload Section - R2 Upload Panel */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-200 mb-4">Upload Files</h3>
            <R2UploadPanel
              entryId={entryId}
              isGuestMode={mode === 'guest'}
              onFilesChange={(updatedList) => onFilesChange(updatedList)}
              existingFiles={files}
            />
          </div>

          {/* File List Section */}
          <div>
            <h3 className="text-lg font-medium text-gray-200 mb-4">
              Files ({files.length})
            </h3>
            
            {files.length === 0 ? (
              <div className="text-center py-8 text-neutral-500">
                <p>No files uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-900 rounded-md hover:border-neutral-800 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 font-medium truncate">
                        {file.file_name}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {formatFileSize(file.file_size)} • {formatUploadDate(file.created_at)}
                      </p>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-4">
                      <button onClick={() => handleDownload(file)} className="p-2 text-neutral-400 hover:text-neutral-200 transition-colors" title="Download">
                        <Download size={18} />
                      </button>
                      
                      <button onClick={() => handleDelete(file)} disabled={deletingFiles.has(file.id)} className="p-2 text-neutral-400 hover:text-red-400 transition-colors disabled:opacity-50" title="Delete">
                        {deletingFiles.has(file.id) ? (
                          <div className="animate-spin w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full"></div>
                        ) : (
                          <Trash2 size={18} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileManager;