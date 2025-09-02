import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { db, utils } from '../lib/supabase';
import { Edit, Save, X, AlertCircle } from 'lucide-react';

const Paste = () => {
    const [content, setContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    const [pubDate, setPubDate] = useState(null);
    const [editDate, setEditDate] = useState(null);
    const [slug, setSlug] = useState(null);

    const { mode, passcode, resetMode } = useApp();
    const navigate = useNavigate();

    useEffect(() => {
        if (!mode) {
            navigate('/');
            return;
        }

        const loadPaste = async () => {
            setIsLoading(true);
            try {
                if (mode === 'passcode') {
                    const entry = await db.getEntryByPasscode(passcode);
                    if (entry) {
                        setContent(entry.content || '');
                        setEditedContent(entry.content || '');
                        setPubDate(new Date(entry.created_at));
                        setEditDate(new Date(entry.updated_at || entry.created_at));
                        setSlug(entry.slug);
                        // Increment views
                        await db.incrementViews(entry.slug);
                    } else {
                        // First time for admin, start with empty content
                        setContent('');
                        setEditedContent('');
                        setPubDate(new Date());
                        setEditDate(new Date());
                    }
                } else { // Guest mode
                    const guestSlug = 'guest-paste';
                    try {
                        const entry = await db.getEntry(guestSlug);
                        if (entry && entry.content) {
                            setContent(entry.content);
                            setEditedContent(entry.content);
                            setPubDate(new Date(entry.created_at));
                            setEditDate(new Date(entry.updated_at || entry.created_at));
                            setSlug(guestSlug);
                            setIsEditing(false); // Content exists, start in view mode.
                        } else {
                            // No content, start in edit mode.
                            setContent('');
                            setEditedContent('');
                            setPubDate(new Date());
                            setEditDate(new Date());
                            setSlug(guestSlug);
                            setIsEditing(true);
                        }
                    } catch (err) {
                        // Error fetching, start fresh in edit mode.
                        setContent('');
                        setEditedContent('');
                        setPubDate(new Date());
                        setEditDate(new Date());
                        setSlug(guestSlug);
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

            const savedEntry = await db.createOrUpdateEntry(entryData, passcode);
            
            setContent(savedEntry.content);
            setEditDate(new Date(savedEntry.updated_at || savedEntry.created_at));
            
            if (mode === 'passcode') {
                setIsEditing(false);
            }
            // For guests, we stay in editing mode.

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

    if (isLoading) {
        return (
            <div className="bg-gray-800 min-h-screen flex items-center justify-center text-white">
                Loading your paste...
            </div>
        );
    }

    return (
        <div className="bg-gray-800 min-h-screen text-gray-300 font-sans flex justify-center py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl w-full space-y-6">
                <div className="text-center">
                    <h1 className="text-4xl font-extrabold text-white tracking-tight">
                        {mode === 'passcode' ? 'Admin Paste' : 'Shared Guest Paste'}
                    </h1>
                    <p className="mt-4 text-lg text-blue-400">
                        {mode === 'passcode' ? 'Your permanent, editable paste.' : 'This is a shared paste that anyone can edit.'}
                    </p>
                </div>

                {error && (
                    <div className="rentry-error bg-red-900 text-white p-3 rounded-lg flex items-center">
                        <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span className="text-sm">{error}</span>
                    </div>
                )}

                <div className="bg-gray-900 shadow-lg rounded-lg overflow-hidden">
                    {isEditing ? (
                        <textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="w-full h-96 bg-gray-900 text-gray-100 p-6 resize-y border-none outline-none font-mono text-sm leading-relaxed"
                            placeholder="Start typing your paste here..."
                        />
                    ) : (
                        <pre className="p-6 overflow-x-auto min-h-96">
                            <code className="font-mono text-sm text-gray-100 whitespace-pre-wrap">
                                {content || "Your paste is empty. Click 'Edit' to start."}
                            </code>
                        </pre>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                    <div className="flex items-center space-x-4">
                        {isEditing ? (
                            <>
                                <button onClick={handleSave} disabled={isLoading} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50">
                                    <Save size={16} className="mr-2" />
                                    {isLoading ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={handleCancel} className="flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
                                    <X size={16} className="mr-2" />
                                    Cancel
                                </button>
                            </>
                        ) : (
                            (mode === 'passcode' || mode === 'guest') && (
                                <button onClick={handleEdit} className="flex items-center px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors">
                                    <Edit size={16} className="mr-2" />
                                    Edit
                                </button>
                            )
                        )}
                         <button onClick={() => { resetMode(); navigate('/'); }} className="flex items-center px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors">
                            Back to Home
                        </button>
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap justify-center sm:justify-end gap-x-4 gap-y-1">
                        <span>Pub: {formatDate(pubDate)}</span>
                        <span>Last Edit: {formatDate(editDate)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Paste;
