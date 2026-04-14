import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { db, utils } from '../lib/api';
import { Edit, Save, X, AlertCircle, Files, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import FileManager from '../components/FileManager';

// ── Tab labels (UI only — all tabs share the same entry per passcode) ──────
const TABS = [
  { id: 1, label: 'Tab 1' },
  { id: 2, label: 'Tab 2' },
  { id: 3, label: 'Tab 3' },
];

// ── Code block ───────────────────────────────────────────────────────────
const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const code = String(children).replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className || '');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return !inline ? (
    <div className="relative my-4">
      <div className="absolute right-2 top-2 z-10">
        <button onClick={handleCopy} aria-label="Copy code"
          className="text-xs bg-neutral-800 text-neutral-300 px-2 py-1 rounded hover:bg-neutral-700 transition-colors duration-150">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter language={match?.[1] || ''} style={tomorrow} PreTag="div" {...props}>
        {code}
      </SyntaxHighlighter>
    </div>
  ) : <code className={className} {...props}>{children}</code>;
};

// ── Tab bar ──────────────────────────────────────────────────────────────
const TabBar = ({ activeTab, onTabChange, isDirty }) => {
  const indicatorRef = useRef(null);
  const tabRefs = useRef({});

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    const ind = indicatorRef.current;
    if (!el || !ind) return;
    ind.style.transform = `translateX(${el.offsetLeft}px)`;
    ind.style.width = `${el.offsetWidth}px`;
  }, [activeTab]);

  return (
    <div className="tab-bar" role="tablist" aria-label="Content tabs">
      <div ref={indicatorRef} className="tab-indicator" aria-hidden="true" />
      {TABS.map(tab => (
        <button
          key={tab.id}
          ref={el => tabRefs.current[tab.id] = el}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          onClick={() => onTabChange(tab.id)}
          className={`tab-btn ${activeTab === tab.id ? 'tab-btn--active' : ''}`}
        >
          {tab.label}
          {/* Dirty dot only on the active tab (they all share same data) */}
          {activeTab === tab.id && isDirty && (
            <span className="tab-dot" aria-label="unsaved changes" />
          )}
        </button>
      ))}
    </div>
  );
};

// ── Main ─────────────────────────────────────────────────────────────────
const Paste = ({ mode }) => {
  const [activeTab, setActiveTab] = useState(1);

  // Shared entry state — all tabs read/write the same entry
  const [content, setContent]         = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [isEditing, setIsEditing]     = useState(false);
  const [isLoading, setIsLoading]     = useState(true);
  const [isSaving, setIsSaving]       = useState(false);
  const [entryId, setEntryId]         = useState(null);
  const [entrySlug, setEntrySlug]     = useState(null);
  const [entryFiles, setEntryFiles]   = useState([]);
  const [pubDate, setPubDate]         = useState(null);
  const [editDate, setEditDate]       = useState(null);
  const [isDirty, setIsDirty]         = useState(false);
  const [error, setError]             = useState('');
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);

  const { mode: appMode, resetMode } = useApp();
  const navigate = useNavigate();
  const isGuest = mode === 'guest';
  const isAuthenticated = appMode === 'passcode';

  // ── Load the single shared entry ────────────────────────────────────────
  const loadEntry = useCallback(async () => {
    setIsLoading(true);
    try {
      if (mode === 'admin') {
        if (appMode !== 'passcode') { navigate('/'); return; }
        const entry = await db.getEntryByPasscode();
        if (entry) {
          setContent(entry.content || '');
          setEditedContent(entry.content || '');
          setPubDate(new Date(entry.created_at));
          setEditDate(new Date(entry.updated_at || entry.created_at));
          setEntrySlug(entry.slug);
          setEntryId(entry.id);
          setEntryFiles(entry.files || []);
          await db.incrementViews(entry.slug);
        } else {
          setContent(''); setEditedContent('');
          setPubDate(new Date()); setEditDate(new Date());
          setIsEditing(true); // auto-open editor if no content yet
        }
      } else {
        // Guest — single shared guest paste
        try {
          const entry = await db.getEntry('guest-paste');
          if (entry?.content) {
            setContent(entry.content); setEditedContent(entry.content);
            setPubDate(new Date(entry.created_at));
            setEditDate(new Date(entry.updated_at || entry.created_at));
            setEntrySlug(entry.slug); setEntryId(entry.id);
            setEntryFiles(entry.files || []);
          } else {
            setContent(''); setEditedContent(''); setIsEditing(true);
          }
        } catch {
          setContent(''); setEditedContent(''); setIsEditing(true);
        }
      }
    } catch (err) {
      if (err?.message?.includes('401') || err?.message?.includes('Unauthorized') || err?.message?.includes('Token')) {
        await resetMode();
        window.location.href = '/';
        return;
      }
      setError('Failed to load. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [mode, appMode, navigate, resetMode]);

  useEffect(() => { loadEntry(); }, []);

  // ── Edit / Cancel / Save ────────────────────────────────────────────────
  const handleEdit   = () => { setEditedContent(content); setIsEditing(true); };
  const handleCancel = () => { setEditedContent(content); setIsEditing(false); setIsDirty(false); };

  const handleContentChange = (val) => {
    setEditedContent(val);
    setIsDirty(val !== content);
  };

  const handleSave = async () => {
    setIsSaving(true); setError('');
    try {
      const slug = entrySlug || (!isGuest ? utils.generateSlug() : undefined);
      const saved = await db.createOrUpdateEntry({
        slug: slug || '',
        content: editedContent,
        is_guest: isGuest,
      });
      setContent(saved.content);
      setEditedContent(saved.content);
      setEditDate(new Date(saved.updated_at || saved.created_at));
      setEntryId(saved.id);
      setEntrySlug(saved.slug);
      setIsEditing(false);
      setIsDirty(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Ctrl+S
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && isEditing) {
        e.preventDefault(); handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing, editedContent]);

  const handleLogout = async () => { await resetMode(); navigate('/'); };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="paste-shell">
      {/* Header */}
      <header className="paste-header">
        <div className="paste-header__inner">
          <div className="paste-header__left">
            <button onClick={handleLogout} className="btn btn-ghost paste-back-btn" aria-label="Back to home">
              <ChevronLeft size={16} />
              <span className="paste-back-label">Back</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="paste-main">
        <div className="paste-container">

          {error && (
            <div className="paste-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Tab bar — purely UI, all tabs share the same content */}
          <TabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isDirty={isDirty}
          />

          {/* Single panel — tab switch is instant, no re-fetch */}
          {isLoading ? (
            <div className="paste-loading">
              <div className="paste-loading__dot" />
              <div className="paste-loading__dot" style={{ animationDelay: '0.15s' }} />
              <div className="paste-loading__dot" style={{ animationDelay: '0.3s' }} />
            </div>
          ) : (
            <div className="paste-panel">
              {/* Editor / viewer */}
              <div className="surface paste-editor-wrap">
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={e => handleContentChange(e.target.value)}
                    className="paste-textarea"
                    placeholder="Start typing… (Markdown supported)"
                    aria-label="Paste content editor"
                    autoFocus
                  />
                ) : (
                  <div className="paste-prose">
                    {content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
                        {content}
                      </ReactMarkdown>
                    ) : (
                      <div className="paste-empty">
                        <p>Nothing here yet.</p>
                        <button onClick={() => setIsEditing(true)} className="btn btn-primary mt-3">
                          Start writing
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action bar */}
              <div className="paste-actions">
                <div className="paste-actions__left">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn btn-primary"
                        aria-label="Save (Ctrl+S)"
                      >
                        <Save size={15} aria-hidden="true" />
                        <span>{isSaving ? 'Saving…' : 'Save'}</span>
                      </button>
                      <button onClick={handleCancel} className="btn" aria-label="Cancel editing">
                        <X size={15} aria-hidden="true" />
                        <span>Cancel</span>
                      </button>
                    </>
                  ) : (
                    <button onClick={handleEdit} className="btn" aria-label="Edit paste">
                      <Edit size={15} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  )}
                </div>
                {editDate && (
                  <span className="paste-meta">{utils.formatDate(editDate)}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* FAB — file manager (only when entry exists) */}
        {(isGuest || isAuthenticated) && (
          <button
            onClick={() => entryId && setIsFileManagerOpen(true)}
            disabled={!entryId}
            className={`paste-fab ${!entryId ? 'paste-fab--disabled' : ''}`}
            aria-label={entryId ? 'Open file manager' : 'Save first to manage files'}
            title={entryId ? 'File Manager' : 'Save your paste first'}
          >
            <Files size={22} aria-hidden="true" />
          </button>
        )}
      </main>

      <FileManager
        isOpen={isFileManagerOpen}
        onClose={() => setIsFileManagerOpen(false)}
        entryId={entryId}
        files={entryFiles}
        onFilesChange={setEntryFiles}
      />
    </div>
  );
};

export default Paste;
