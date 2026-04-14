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

const TABS = [
  { id: 1, label: 'Tab 1' },
  { id: 2, label: 'Tab 2' },
  { id: 3, label: 'Tab 3' },
];

// ── Code block ────────────────────────────────────────────────────────────
const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const code = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');

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

// ── Tab bar ───────────────────────────────────────────────────────────────
const TabBar = ({ activeTab, onTabChange, tabStates }) => {
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

// ── Per-tab initial state factory ─────────────────────────────────────────
const makeTab = () => ({
  content: '',
  editedContent: '',
  isEditing: false,   // tabs with content → view mode; empty → edit mode after load
  isLoading: true,
  isFetched: false,
  entryId: null,
  entrySlug: null,
  entryFiles: [],
  editDate: null,
  isDirty: false,
});

// ── Main ──────────────────────────────────────────────────────────────────
const Paste = ({ mode }) => {
  const [activeTab, setActiveTab] = useState(1);
  const [tabStates, setTabStates] = useState(() =>
    Object.fromEntries(TABS.map(t => [t.id, makeTab()]))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [hasAuthError, setHasAuthError] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [sharedFiles, setSharedFiles] = useState([]);

  const { mode: appMode, resetMode } = useApp();
  const navigate = useNavigate();
  const isGuest = mode === 'guest';
  const isAuthenticated = appMode === 'passcode';

  // Load ALL files for the user (cross-tab) into one shared list
  const loadSharedFiles = useCallback(async () => {
    try {
      const files = isGuest
        ? await db.getGuestFiles()
        : await db.getMyFiles();
      setSharedFiles(Array.isArray(files) ? files : []);
    } catch (e) {
      console.warn('[Paste] Failed to load shared files', e);
    }
  }, [isGuest]);

  const cur = tabStates[activeTab];

  // ── Update a single tab ───────────────────────────────────────────────
  const setTab = useCallback((tabId, patch) => {
    setTabStates(prev => ({
      ...prev,
      [tabId]: { ...prev[tabId], ...(typeof patch === 'function' ? patch(prev[tabId]) : patch) },
    }));
  }, []);

  // ── Load one tab's entry ──────────────────────────────────────────────
  const loadTab = useCallback(async (tabId) => {
    if (tabStates[tabId].isFetched) return;
    setTab(tabId, { isLoading: true });

    try {
      if (mode === 'admin') {
        if (appMode !== 'passcode') { navigate('/'); return; }
        const entry = await db.getEntryByPasscode(tabId);
        if (entry) {
          setTab(tabId, {
            content: entry.content || '',
            editedContent: entry.content || '',
            isEditing: false,
            entryId: entry.id,
            entrySlug: entry.slug,
            entryFiles: entry.files || [],
            editDate: new Date(entry.updated_at || entry.created_at),
            isLoading: false,
            isFetched: true,
            isDirty: false,
          });
          if (entry.slug) await db.incrementViews(entry.slug);
        } else {
          // Empty tab — open editor immediately, no button needed
          setTab(tabId, { isEditing: true, isLoading: false, isFetched: true });
        }
      } else {
        // Guest: slug guest-tab-N
        const guestSlug = `guest-tab-${tabId}`;
        try {
          const entry = await db.getEntry(guestSlug);
          if (entry?.content) {
            setTab(tabId, {
              content: entry.content,
              editedContent: entry.content,
              isEditing: false,
              entryId: entry.id,
              entrySlug: guestSlug,
              entryFiles: entry.files || [],
              editDate: new Date(entry.updated_at || entry.created_at),
              isLoading: false,
              isFetched: true,
              isDirty: false,
            });
          } else {
            setTab(tabId, { isEditing: true, isLoading: false, isFetched: true, entrySlug: guestSlug });
          }
        } catch {
          setTab(tabId, { isEditing: true, isLoading: false, isFetched: true, entrySlug: guestSlug });
        }
      }
    } catch (err) {
      if (err?.message?.match(/401|Unauthorized|Token/)) {
        setHasAuthError(true);
        await resetMode();
        window.location.href = '/';
        return;
      }
      setError('Failed to load. Please try again.');
      setTab(tabId, { isLoading: false, isFetched: true });
    }
  }, [tabStates, mode, appMode, navigate, resetMode, setTab]);

  // Load active tab on mount + whenever it changes (lazy)
  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  // Load shared files once when component is ready
  useEffect(() => { loadSharedFiles(); }, [loadSharedFiles]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setError('');
  };

  // ── Edit / Cancel / Save ──────────────────────────────────────────────
  const handleEdit   = () => setTab(activeTab, t => ({ ...t, isEditing: true, editedContent: t.content }));
  const handleCancel = () => setTab(activeTab, t => ({ ...t, isEditing: false, editedContent: t.content, isDirty: false }));

  const handleChange = (val) => setTab(activeTab, t => ({ ...t, editedContent: val, isDirty: val !== t.content }));

  const handleSave = async () => {
    setIsSaving(true); setError('');
    try {
      const slug = cur.entrySlug || (!isGuest ? utils.generateSlug() : `guest-tab-${activeTab}`);
      const saved = await db.createOrUpdateEntry({
        slug,
        content: cur.editedContent,
        is_guest: isGuest,
        tab_id: activeTab,
      }, activeTab);
      setTab(activeTab, t => ({
        ...t,
        content: saved.content,
        editedContent: saved.content,
        entryId: saved.id,
        entrySlug: saved.slug || slug,
        editDate: new Date(saved.updated_at || saved.created_at),
        isEditing: false,
        isDirty: false,
      }));
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Ctrl+S
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && cur.isEditing) {
        e.preventDefault(); handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, activeTab]);

  const handleLogout = async () => { await resetMode(); navigate('/'); };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="paste-shell">
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

      <main className="paste-main">
        <div className="paste-container">

          {error && (
            <div className="paste-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <TabBar activeTab={activeTab} onTabChange={handleTabChange} tabStates={tabStates} />

          {TABS.map(tab => (
            <div
              key={tab.id}
              id={`tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              hidden={activeTab !== tab.id}
            >
              {activeTab === tab.id && (
                tabStates[tab.id].isLoading ? (
                  <div className="paste-loading">
                    <div className="paste-loading__dot" />
                    <div className="paste-loading__dot" style={{ animationDelay: '0.15s' }} />
                    <div className="paste-loading__dot" style={{ animationDelay: '0.3s' }} />
                  </div>
                ) : (
                  <div className="paste-panel">
                    <div className="surface paste-editor-wrap">
                      {tabStates[tab.id].isEditing ? (
                        <textarea
                          value={tabStates[tab.id].editedContent}
                          onChange={e => handleChange(e.target.value)}
                          className="paste-textarea"
                          placeholder="Start typing… (Markdown supported)"
                          aria-label={`Tab ${tab.id} editor`}
                          autoFocus={activeTab === tab.id}
                        />
                      ) : (
                        <div className="paste-prose">
                          {tabStates[tab.id].content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
                              {tabStates[tab.id].content}
                            </ReactMarkdown>
                          ) : (
                            // Empty but saved state — shouldn't normally reach here
                            <div className="paste-empty"><p>Nothing here yet.</p></div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="paste-actions">
                      <div className="paste-actions__left">
                        {tabStates[tab.id].isEditing ? (
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
                            <button onClick={handleCancel} className="btn" aria-label="Cancel">
                              <X size={15} aria-hidden="true" />
                              <span>Cancel</span>
                            </button>
                          </>
                        ) : (
                          <button onClick={handleEdit} className="btn" aria-label="Edit">
                            <Edit size={15} aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                        )}
                      </div>
                      {tabStates[tab.id].editDate && (
                        <span className="paste-meta">{utils.formatDate(tabStates[tab.id].editDate)}</span>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          ))}
        </div>

        {(isGuest || isAuthenticated) && (
          <button
            onClick={() => setIsFileManagerOpen(true)}
            className="paste-fab"
            aria-label="File manager"
            title="File Manager"
          >
            <Files size={22} aria-hidden="true" />
          </button>
        )}
      </main>

      <FileManager
        isOpen={isFileManagerOpen}
        onClose={() => setIsFileManagerOpen(false)}
        entryId={cur.entryId}
        files={sharedFiles}
        onFilesChange={() => loadSharedFiles()}
      />
    </div>
  );
};

export default Paste;
