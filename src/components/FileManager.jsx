import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import R2UploadPanel from './R2UploadPanel';

/**
 * FileManager — modal that wraps R2UploadPanel.
 * All upload, download, and delete logic lives in R2UploadPanel.
 * This component handles the modal shell, drag-over state, and guest banners.
 */
const FileManager = ({ isOpen, onClose, entryId, files, onFilesChange }) => {
  const { mode } = useApp();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="surface max-w-4xl w-full max-h-[90vh] overflow-hidden transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-900">
          <h2 className="text-xl font-semibold text-gray-100">File Manager</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close file manager">
            <X size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {/* Guest info banner */}
          {mode === 'guest' && (
            <div className="mb-4 p-3 border border-blue-900/60 rounded-md flex items-center bg-blue-950/30">
              <AlertCircle size={20} className="text-blue-400 mr-2 flex-shrink-0" />
              <span className="text-blue-300 text-sm">
                Guest uploads are limited to 1 GB total and are separate from admin uploads.
              </span>
            </div>
          )}

          {/* Outer error (e.g. missing entryId) */}
          {!entryId && (
            <div className="mb-4 p-3 border border-red-900/60 rounded-md flex items-center bg-red-950/30">
              <AlertCircle size={20} className="text-red-400 mr-2 flex-shrink-0" />
              <span className="text-red-300 text-sm">Save your paste before uploading files.</span>
            </div>
          )}

          {/* Upload Panel */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-200 mb-4">Upload Files</h3>
            {entryId ? (
              <R2UploadPanel
                entryId={entryId}
                isGuestMode={mode === 'guest'}
                onFilesChange={onFilesChange}
                existingFiles={files}
              />
            ) : (
              <p className="text-neutral-500 text-sm">Save your paste first to enable file uploads.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileManager;