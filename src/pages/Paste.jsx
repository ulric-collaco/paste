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

// ── Tab configuration ─────────────────────────────────────────────────────
const TABS = [
  { id: 1, label: 'Tab 1' },
  { id: 2, label: 'Tab 2' },
  { id: 3, label: 'Tab 3' },
];

function getSlugForTab(tabId, isGuest) {
  return isGuest ? `guest-tab-${tabId}` : null; // admin tabs are per-passcode, no slug needed
}

// ── Code block component ──────────────────────────────────────────────────
const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const code = String(children).replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  return !inline ? (
    <div className="relative my-4">
      <div className="absolute right-2 top-2 z-10">
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          className="text-xs bg-neutral-800 text-neutral-300 px-2 py-1 rounded hover:bg-neutral-700 transition-colors duration-150"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter language={language} style={tomorrow} PreTag="div" {...props}>
        {code}
      </SyntaxHighlighter>
    </div>
  ) : (
    <code className={className} {...props}>{children}</code>
  );
};

// ── Tab bar component ─────────────────────────────────────────────────────
const TabBar = ({ activeTab, onTabChange, tabStates }) => {
  const indicatorRef = useRef(null);
  const tabRefs = useRef({});

  useEffect(() => {
    const activeEl = tabRefs.current[activeTab];
    const indicator = indicatorRef.current;
    if (!activeEl || !indicator) return;
    const parent = activeEl.offsetParent;
    indicator.style.transform = `translateX(${activeEl.offsetLeft}px)`;
    indicator.style.width = `${activeEl.offsetWidth}px`;
  }, [activeTab]);

  return (
    <div className="tab-bar" role="tablist" aria-label="Content tabs">
      {/* Sliding indicator */}
      <div ref={indicatorRef} className="tab-indicator" aria-hidden="true" />
      {TABS.map(tab => {
        const isDirty = tabStates[tab.id]?.isDirty;
        return (
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
            {isDirty && <span className="tab-dot" aria-label="unsaved changes" />}
          </button>
        );
      })}
    </div>
  );
};

// ── Per-tab state ─────────────────────────────────────────────────────────
function makeEmptyTab() {
  return {
    content: '',
    editedContent: '',
    isEditing: false,
    isLoading: true,
    pubDate: null,
    editDate: null,
    slug: null,
    entryFiles: [],
    entryId: null,
    isDirty: false,
  };
}

// ── Main Paste component ──────────────────────────────────────────────────
const Paste = ({ mode }) => {
  const [activeTab, setActiveTab] = useState(1);
  const [tabStates, setTabStates] = useState(() =>
    Object.fromEntries(TABS.map(t => [t.id, makeEmptyTab()]))
  );
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [hasAuthError, setHasAuthError] = useState(false);

  const { mode: appMode, resetMode } = useApp();
  const navigate = useNavigate();

  const isGuest = mode === 'guest';
  const currentTab = tabStates[activeTab];

  // ── Update a single tab's state ─────────────────────────────────────────
  const setTab = useCallback((tabId, updater) => {
    setTabStates(prev => ({
      ...prev,
      [tabId]: typeof updater === 'function' ? updater(prev[tabId]) : { ...prev[tabId], ...updater },
    }));
  }, []);

  // ── Load a tab's content on first visit ────────────────────────────────
  const loadTab = useCallback(async (tabId) => {
    if (!tabStates[tabId].isLoading && tabStates[tabId].slug !== undefined) return; // already loaded
    setTab(tabId, { isLoading: true });
    try {
      if (mode === 'admin') {
        if (appMode !== 'passcode') { navigate('/'); return; }
        const entry = await db.getEntryByPasscode(tabId);
        if (entry) {
          setTab(tabId, {
            content: entry.content || '',
            editedContent: entry.content || '',
            pubDate: new Date(entry.created_at),
            editDate: new Date(entry.updated_at || entry.created_at),
            slug: entry.slug,
            entryId: entry.id,
            entryFiles: entry.files || [],
            isLoading: false,
            isDirty: false,
          });
          await db.incrementViews(entry.slug);
        } else {
          setTab(tabId, { content: '', editedContent: '', pubDate: new Date(), editDate: new Date(), entryId: null, entryFiles: [], isLoading: false, slug: null, isDirty: false });
        }
      } else {
        // Guest: each tab has its own slug
        const guestSlug = getSlugForTab(tabId, true);
        try {
          const entry = await db.getEntry(guestSlug);
          if (entry && entry.content) {
            setTab(tabId, {
              content: entry.content,
              editedContent: entry.content,
              pubDate: new Date(entry.created_at),
              editDate: new Date(entry.updated_at || entry.created_at),
              slug: guestSlug,
              entryId: entry.id,
              entryFiles: entry.files || [],
              isLoading: false,
              isEditing: false,
              isDirty: false,
            });
          } else {
            setTab(tabId, { content: '', editedContent: '', pubDate: new Date(), editDate: new Date(), slug: guestSlug, entryId: null, entryFiles: [], isLoading: false, isEditing: true, isDirty: false });
          }
        } catch {
          setTab(tabId, { content: '', editedContent: '', pubDate: new Date(), editDate: new Date(), slug: guestSlug, entryId: null, entryFiles: [], isLoading: false, isEditing: true, isDirty: false });
        }
      }
    } catch (err) {
      if (err.message && (err.message.includes('Token') || err.message.includes('401') || err.message.includes('Unauthorized'))) {
        setHasAuthError(true);
        await resetMode();
        window.location.href = '/';
        return;
      }
      setError('Failed to load paste. Please try again.');
      setTab(tabId, { isLoading: false });
    }
  }, [mode, appMode, navigate, resetMode, setTab]);

  // Load tab 1 on mount, load others on first switch
  useEffect(() => { loadTab(1); }, []);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setError('');
    // Lazy-load: only fetch if this tab hasn't been loaded yet
    if (tabStates[tabId].isLoading) {
      loadTab(tabId);
    }
  };

  // ── Edit / Save / Cancel ────────────────────────────────────────────────
  const handleEdit = () => setTab(activeTab, t => ({ ...t, isEditing: true, editedContent: t.content }));
  const handleCancel = () => setTab(activeTab, t => ({ ...t, isEditing: false, editedContent: t.content, isDirty: false }));

  const handleContentChange = (val) => {
    setTab(activeTab, t => ({ ...t, editedContent: val, isDirty: val !== t.content }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      let currentSlug = currentTab.slug;
      if (!currentSlug && !isGuest) currentSlug = utils.generateSlug();

      const entryData = {
        slug: currentSlug,
        content: currentTab.editedContent,
        is_guest: isGuest,
        tab_id: isGuest ? undefined : activeTab, // admin tabs tracked server-side by tab_id
      };

      const saved = await db.createOrUpdateEntry(entryData, activeTab);
      setTab(activeTab, t => ({
        ...t,
        content: saved.content,
        editDate: new Date(saved.updated_at || saved.created_at),
        entryId: saved.id,
        slug: saved.slug || currentSlug,
        isEditing: false,
        isDirty: false,
      }));
    } catch (err) {
      setError('Failed to save paste.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Keyboard shortcut: Ctrl+S saves ────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentTab.isEditing) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTab, activeTab]);

  const handleLogout = async () => {
    await resetMode();
    navigate('/');
  };

  const isAuthenticated = appMode === 'passcode';

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="paste-shell">
      {/* Header */}
      <header className="paste-header">
        <div className="paste-header__inner">
          <div className="paste-header__left">
            <button
              onClick={handleLogout}
              className="btn btn-ghost paste-back-btn"
              aria-label="Back to home"
            >
              <ChevronLeft size={16} />
              <span className="paste-back-label">Back</span>
            </button>
            <div className="paste-title-block">
              <h1 className="paste-title">
                {isGuest ? 'Quick Drop' : 'Clipboard'}
              </h1>
              <p className="paste-subtitle">
                {isGuest ? 'Temporary space — shared across devices' : 'Your synced clipboard'}
              </p>
            </div>
          </div>

          <div className="paste-header__right">
            {!isGuest && (
              <a
                href={currentTab.slug ? `/v/${currentTab.slug}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`btn ${!currentTab.slug ? 'opacity-40 pointer-events-none' : ''}`}
                aria-disabled={!currentTab.slug}
              >
                Share
              </a>
            )}
            {isGuest && currentTab.slug && (
              <CopyShareLinkButton slug={currentTab.slug} />
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="paste-main">
        <div className="paste-container">

          {/* Error banner */}
          {error && (
            <div className="paste-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Tab bar */}
          <TabBar
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tabStates={tabStates}
          />

          {/* Tab panels */}
          {TABS.map(tab => (
            <div
              key={tab.id}
              id={`tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              hidden={activeTab !== tab.id}
              className="paste-panel"
            >
              {activeTab === tab.id && (
                tabStates[tab.id].isLoading ? (
                  <div className="paste-loading">
                    <div className="paste-loading__dot" />
                    <div className="paste-loading__dot" style={{ animationDelay: '0.15s' }} />
                    <div className="paste-loading__dot" style={{ animationDelay: '0.3s' }} />
                  </div>
                ) : (
                  <>
                    {/* Editor / Viewer */}
                    <div className="surface paste-editor-wrap">
                      {tabStates[tab.id].isEditing ? (
                        <textarea
                          value={tabStates[tab.id].editedContent}
                          onChange={e => handleContentChange(e.target.value)}
                          className="textarea paste-textarea"
                          placeholder={`Tab ${tab.id} — start typing…`}
                          aria-label={`Tab ${tab.id} content editor`}
                          autoFocus
                        />
                      ) : (
                        <div className="prose paste-prose">
                          {tabStates[tab.id].content ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{ code: CodeBlock }}
                            >
                              {tabStates[tab.id].content}
                            </ReactMarkdown>
                          ) : (
                            <div className="paste-empty">
                              <p>Nothing here yet.</p>
                              <button
                                onClick={() => setTab(tab.id, t => ({ ...t, isEditing: true }))}
                                className="btn btn-primary mt-3"
                              >
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
                        {tabStates[tab.id].isEditing ? (
                          <>
                            <button
                              onClick={handleSave}
                              disabled={isSaving}
                              className="btn btn-primary"
                              aria-label="Save paste (Ctrl+S)"
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

                      <div className="paste-meta">
                        {tabStates[tab.id].pubDate && (
                          <span title="Created">
                            {utils.formatDate(tabStates[tab.id].pubDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )
              )}
            </div>
          ))}
        </div>

        {/* FAB — File manager */}
        {(isGuest || isAuthenticated) && (
          <button
            onClick={() => currentTab.entryId && setIsFileManagerOpen(true)}
            disabled={!currentTab.entryId}
            className={`paste-fab ${!currentTab.entryId ? 'paste-fab--disabled' : ''}`}
            aria-label={currentTab.entryId ? 'Open file manager' : 'Save your paste first to manage files'}
            title={currentTab.entryId ? 'File Manager' : 'Save your paste first'}
          >
            <Files size={22} aria-hidden="true" />
          </button>
        )}
      </main>

      {/* File manager modal */}
      <FileManager
        isOpen={isFileManagerOpen}
        onClose={() => setIsFileManagerOpen(false)}
        entryId={currentTab.entryId}
        files={currentTab.entryFiles}
        onFilesChange={files => setTab(activeTab, t => ({ ...t, entryFiles: files }))}
      />
    </div>
  );
};

export default Paste;

// ── Share link copy button ────────────────────────────────────────────────
const CopyShareLinkButton = ({ slug }) => {
  const [copied, setCopied] = React.useState(false);
  const url = `${window.location.origin}/v/${slug || 'guest-paste'}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button onClick={handleCopy} className="btn btn-primary" aria-live="polite">
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
};
