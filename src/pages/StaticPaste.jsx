import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, utils } from '../lib/api';
import { AlertCircle } from 'lucide-react';

const StaticPaste = () => {
    const { slug } = useParams();
    const [paste, setPaste] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchPaste = async () => {
            if (!slug) {
                setError('No paste identifier provided.');
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            try {
                const entry = await db.getEntry(slug);
                if (entry) {
                    setPaste(entry);
                } else {
                    setError('Paste not found or has expired.');
                }
            } catch (err) {
                setError('Failed to load paste. It may have been deleted or expired.');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPaste();
    }, [slug]);

    const formatDate = (dateString) => utils.formatDate(dateString);

    if (isLoading) {
        return (
            <div className="bg-black min-h-screen flex items-center justify-center text-gray-300">
                Loading paste...
            </div>
        );
    }

    return (
        <div className="bg-black min-h-screen text-gray-300 font-sans flex justify-center py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl w-full space-y-6">
                <div className="text-center">
                    <h1 className="heading-xl">
                        {paste ? 'View Paste' : 'Error'}
                    </h1>
                    {paste && (
                        <p className="mt-2 muted">Read-only view</p>
                    )}
                </div>

                {error && (
                    <div className="rentry-error bg-red-900 text-white p-3 rounded-lg flex items-center">
                        <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span className="text-sm">{error}</span>
                    </div>
                )}

                {paste && (
                    <div className="surface overflow-hidden">
                        <pre className="p-6 overflow-x-auto min-h-96">
                            <code className="font-mono text-sm text-gray-100 whitespace-pre-wrap">
                                {paste.content}
                            </code>
                        </pre>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                    <Link to="/" className="btn">
                        Back to Home
                    </Link>
                    {paste && (
                        <div className="text-xs text-neutral-500 flex flex-wrap justify-center sm:justify-end gap-x-4 gap-y-1">
                            <span>Pub: {formatDate(paste.created_at)}</span>
                            {paste.is_guest && <span>Expires: {formatDate(paste.expires_at)}</span>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StaticPaste;
