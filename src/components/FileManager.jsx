import React, { useState, useCallback } from 'react';
import { X, Upload, Download, Trash2, AlertCircle } from 'lucide-react';
import { db, utils } from '../lib/neon';

const FileManager = ({ isOpen, onClose, entryId, files, onFilesChange }) => {
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

  const handleDownload = useCallback((file) => {
    // Open file URL in new tab for download
    window.open(file.file_url, '_blank');
  }, []);

  const handleDelete = useCallback(async (file) => {
    if (!window.confirm(`Are you sure you want to delete "${file.file_name}"?`)) {
      return;
    }

    setDeletingFiles(prev => new Set([...prev, file.id]));
    setError(null);

    try {
      await db.deleteFile(file.id);
      
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
  }, [files, onFilesChange]);

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
          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 border border-red-900/60 rounded-md flex items-center bg-red-950/30">
              <AlertCircle size={20} className="text-red-400 mr-2" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {/* File Upload Section */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-200 mb-4">Upload Files</h3>
            
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border border-dashed rounded-lg p-8 text-center transition-colors ${
                isUploading
                  ? 'pointer-events-none opacity-75'
                  : isDragOver
                  ? 'border-neutral-600 bg-neutral-900'
                  : 'border-neutral-800 hover:border-neutral-700'
              }`}
            >
              {isUploading ? (
                <div className="space-y-4">
                  <div className="text-neutral-300">
                    <Upload size={48} className="mx-auto mb-2" />
                    <p>Uploading files... {uploadProgress}%</p>
                  </div>
                  <div className="w-full bg-neutral-900 rounded-full h-2">
                    <div
                      className="bg-neutral-700 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload size={48} className="mx-auto text-neutral-400" />
                  <div>
                    <p className="text-neutral-300 mb-2">
                      Drag and drop files here, or click to select
                    </p>
                    <p className="text-sm text-neutral-500">
                      Supports all file types (images, documents, videos, etc.)
                    </p>
                  </div>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    disabled={isUploading}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className={`inline-block font-medium py-2 px-6 rounded-md transition-all duration-150 border ${
                      isUploading
                        ? 'bg-neutral-900 text-neutral-500 border-neutral-900 cursor-not-allowed'
                        : 'bg-neutral-950 text-gray-200 border-neutral-800 hover:bg-neutral-900 hover:border-neutral-700 cursor-pointer'
                    }`}
                  >
                    Select Files
                  </label>
                </div>
              )}
            </div>
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