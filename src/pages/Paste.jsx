import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { db, utils } from '../lib/neon';
import { Edit, Save, X, AlertCircle, Files } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useCallback } from 'react';
import FileManager from '../components/FileManager';

// Custom renderer for fenced code blocks to add a copy button
const CodeBlock = ({ node, inline, className, children, ...props }) => {
    const code = String(children).replace(/\n$/, '');
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
        } catch (err) {
            // Fallback: select and copy
            const textarea = document.createElement('textarea');
            textarea.value = code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }, [code]);

    return !inline ? (
        <div className="relative my-4">
            <div className="absolute right-2 top-2">
                <button onClick={handleCopy} className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600">
                    Copy
                </button>
            </div>
            <SyntaxHighlighter language={language} style={tomorrow} PreTag="div" {...props}>
                {code}
            </SyntaxHighlighter>
        </div>
    ) : (
        <code className={className} {...props}>
            {children}
        </code>
    );
};


const Paste = ({ mode }) => {
    const [content, setContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [pubDate, setPubDate] = useState(null);
    const [editDate, setEditDate] = useState(null);
    const [slug, setSlug] = useState(null);
    const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
    const [entryFiles, setEntryFiles] = useState([]);
    const [currentEntryId, setCurrentEntryId] = useState(null);
    const { passcode, resetMode, getCookie } = useApp();
    const navigate = useNavigate();

    useEffect(() => {
        const loadPaste = async () => {
            setIsLoading(true);
            try {
                if (mode === 'admin') {
                    // Only allow access to /admin when a passcode cookie/context is present.
                    const cookiePass = getCookie('passcode')
                    if (!passcode && !cookiePass) {
                        // No passcode in context or cookie — block direct access
                        navigate('/')
                        return
                    }

                    const effectivePass = passcode || cookiePass
                    // use effectivePass for admin entry lookups
                    const entry = await db.getEntryByPasscode(effectivePass)
                    if (entry) {
                        setContent(entry.content || '');
                        setEditedContent(entry.content || '');
                        setPubDate(new Date(entry.created_at));
                        setEditDate(new Date(entry.updated_at || entry.created_at));
                        setSlug(entry.slug);
                        setCurrentEntryId(entry.id);
                        setEntryFiles(entry.files || []);
                        await db.incrementViews(entry.slug);
                    } else {
                        setContent('');
                        setEditedContent('');
                        setPubDate(new Date());
                        setEditDate(new Date());
                        setCurrentEntryId(null);
                        setEntryFiles([]);
                    }
                } else { // guest mode
                    const guestSlug = 'guest-paste';
                    try {
                        const entry = await db.getEntry(guestSlug);
                        if (entry && entry.content) {
                            setContent(entry.content);
                            setEditedContent(entry.content);
                            setPubDate(new Date(entry.created_at));
                            setEditDate(new Date(entry.updated_at || entry.created_at));
                            setSlug(guestSlug);
                            setCurrentEntryId(entry.id);
                            setEntryFiles(entry.files || []);
                            setIsEditing(false);
                        } else {
                            setContent('');
                            setEditedContent('');
                            setPubDate(new Date());
                            setEditDate(new Date());
                            setSlug(guestSlug);
                            setCurrentEntryId(null);
                            setEntryFiles([]);
                            setIsEditing(true);
                        }
                    } catch (err) {
                        setContent('');
                        setEditedContent('');
                        setPubDate(new Date());
                        setEditDate(new Date());
                        setSlug(guestSlug);
                        setCurrentEntryId(null);
                        setEntryFiles([]);
                        setIsEditing(true);
                        console.log("Could not find guest-paste, starting fresh.");
                    }
                }
            } catch (err) {
                setError('Failed to load paste. Please try again.');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };
        loadPaste();
    }, [mode, passcode, navigate]);

    const handleEdit = () => {
        setEditedContent(content);
        setIsEditing(true);
    };

    const handleSave = async () => {
        setIsLoading(true);
        setError('');
        try {
            let currentSlug = slug;
            // If there's no slug, it's a new entry, so generate one.
            if (!currentSlug) {
                currentSlug = utils.generateSlug();
                setSlug(currentSlug);
            }

            const entryData = {
                slug: currentSlug,
                content: editedContent,
                is_guest: mode === 'guest',
            };

            const cookiePass = getCookie('passcode');
            const effectivePass = passcode || cookiePass;
            const savedEntry = await db.createOrUpdateEntry(entryData, effectivePass);
            
            setContent(savedEntry.content);
            setEditDate(new Date(savedEntry.updated_at || savedEntry.created_at));
            setCurrentEntryId(savedEntry.id);
            setSlug(savedEntry.slug || currentSlug);
            
            setIsEditing(false);

        } catch (err) {
            setError('Failed to save paste.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
    };

    const formatDate = (date) => {
        if (!date) return '...';
        return date.toLocaleString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        }) + ' UTC';
    };

    const isUserAuthenticated = () => {
        const cookiePass = getCookie('passcode')
        return !!(passcode || cookiePass)
    };

    if (isLoading) {
        return (
            <div className="bg-black min-h-screen flex items-center justify-center text-gray-300">
                Loading your paste...
            </div>
        );
    }

    const markdown = content || '';

    return (
        <div className="bg-black min-h-screen text-gray-300 font-sans flex justify-center py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl w-full space-y-6">
                {/* Top utility bar for quick actions (guest gets a Copy Link button) */}
                {mode !== 'admin' && (
                  <div className="flex items-center justify-end">
                    <CopyShareLinkButton slug={slug || 'guest-paste'} />
                  </div>
                )}

                <div className="text-center">
                    <h1 className="heading-xl">
                        {mode === 'admin' ? 'Admin Paste' : 'Guest Paste'}
                    </h1>
                    <p className="mt-2 muted">
                        {mode === 'admin' ? 'Your permanent, editable paste.' : 'A shared paste anyone can edit.'}
                    </p>
                </div>

                {error && (
                    <div className="rentry-error bg-red-900 text-white p-3 rounded-lg flex items-center">
                        <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span className="text-sm">{error}</span>
                    </div>
                )}

                <div className="surface overflow-hidden">
                    {isEditing ? (
                        <textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="textarea font-mono text-sm leading-relaxed min-h-96"
                            placeholder="Start typing your paste..."
                        />
                    ) : (
                        <div className="prose p-6 overflow-x-auto min-h-96">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code: CodeBlock,
                                }}
                            >
                                {markdown}
                            </ReactMarkdown>
                        </div>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                    <div className="flex items-center space-x-4">
                        {isEditing ? (
                            <>
                                <button onClick={handleSave} disabled={isLoading} className="btn btn-primary disabled:opacity-50">
                                    <Save size={16} className="mr-2" />
                                    {isLoading ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={handleCancel} className="btn">
                                    <X size={16} className="mr-2" />
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <button onClick={handleEdit} className="btn">
                                <Edit size={16} className="mr-2" />
                                Edit
                            </button>
                        )}
                        <button onClick={() => { resetMode(); navigate('/'); }} className="btn">
                            Back to Home
                        </button>
                    </div>
                    <div className="text-xs text-neutral-500 flex flex-wrap justify-center sm:justify-end gap-x-4 gap-y-1">
                        <span>Pub: {utils.formatDate(pubDate)}</span>
                        <span>Last Edit: {utils.formatDate(editDate)}</span>
                    </div>
                </div>

                {/* Floating File Manager Button - Only show when authenticated */}
                {isUserAuthenticated() && (
                    <button
                        onClick={() => currentEntryId && setIsFileManagerOpen(true)}
                        disabled={!currentEntryId}
                        className={`fixed bottom-6 right-6 p-4 rounded-full border z-40 transition-all duration-150 ${
                            currentEntryId 
                                ? 'bg-neutral-950 border-neutral-800 text-gray-200 hover:bg-neutral-900 hover:border-neutral-700'
                                : 'bg-neutral-900 border-neutral-900 text-neutral-600 cursor-not-allowed opacity-75'
                        }`}
                        title={currentEntryId ? "File Manager" : "Save your paste first to enable file management"}
                    >
                        <Files size={24} />
                    </button>
                )}

                {/* FileManager Modal */}
                <FileManager
                    isOpen={isFileManagerOpen}
                    onClose={() => setIsFileManagerOpen(false)}
                    entryId={currentEntryId}
                    files={entryFiles}
                    onFilesChange={setEntryFiles}
                />
            </div>
        </div>
    );
};

export default Paste;

// Small action button to copy a public, read-only link for sharing
const CopyShareLinkButton = ({ slug }) => {
    const [copied, setCopied] = React.useState(false)
    const shareUrl = React.useMemo(() => {
        try {
            const origin = window.location.origin
            const cleanSlug = slug || 'guest-paste'
            return `${origin}/v/${cleanSlug}`
        } catch {
            return `/v/${slug || 'guest-paste'}`
        }
    }, [slug])

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch (err) {
            // Fallback copy
            const ta = document.createElement('textarea')
            ta.value = shareUrl
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button onClick={handleCopy} className="btn btn-primary">
                {copied ? 'Copied!' : 'Copy this link'}
            </button>
        </div>
    )
}
