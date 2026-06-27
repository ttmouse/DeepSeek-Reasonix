// DocViewPanel shows project documentation in a floating overlay.
// Docs are fetched from GitHub and cached at ~/.reasonix/help/.
// The component is self-contained: on mount it lists local docs and offers
// a pull-from-upstream action when the cache is empty.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, ExternalLink, FileText, Loader2, RefreshCw, Search, X, FileSearch, HardDrive } from "lucide-react";
import { useI18n, useT } from "../lib/i18n";
import { useDeferredClose } from "../lib/useMountTransition";
import type { HelpSearchHit } from "../lib/bridge";
import { ModalCloseButton } from "./ModalCloseButton";
import { Tooltip } from "./Tooltip";
import MarkdownRenderer from "./MarkdownRenderer";

const UPSTREAM_DOCS_BASE = "https://raw.githubusercontent.com/esengine/DeepSeek-Reasonix/main-v2/docs";

// Known doc files in the upstream docs/ directory.
// This is the fallback list used when index.json is not available.
const KNOWN_DOCS: DocMeta[] = [
  { id: "GUIDE", title: "Guide", titleZh: "使用指南", desc: "Configuration, permissions, plugins, and day-to-day usage" },
  { id: "GUIDE.zh-CN", title: "Guide (中文)", titleZh: "使用指南", desc: "配置、权限、插件及日常使用" },
  { id: "SPEC", title: "Spec", titleZh: "工程规范", desc: "Engineering contract, architecture, data types, roadmap" },
  { id: "BOT_GUIDE", title: "Bot Guide", titleZh: "机器人指南", desc: "Connect Feishu, Lark, and WeChat bots" },
  { id: "BOT_GUIDE.zh-CN", title: "Bot Guide (中文)", titleZh: "机器人指南", desc: "连接飞书、Lark、微信机器人" },
  { id: "CHECKPOINTS", title: "Checkpoints", titleZh: "检查点", desc: "Snapshot-based edit safety net (Esc-Esc, /rewind)" },
  { id: "MIGRATING", title: "Migration Guide", titleZh: "迁移指南", desc: "Moving from 0.x TypeScript to 1.0 Go rewrite" },
  { id: "CONFIG_PATHS", title: "Config Paths", titleZh: "配置路径", desc: "Reasonix home, config.toml, .env structure" },
  { id: "CONFIG_PATHS.zh-CN", title: "Config Paths (中文)", titleZh: "配置路径", desc: "Reasonix 主目录、config.toml、.env 结构" },
  { id: "REASONING_LANGUAGE", title: "Reasoning Language", titleZh: "推理语言", desc: "Visible reasoning text language preference" },
  { id: "REASONING_LANGUAGE.zh-CN", title: "Reasoning Language (中文)", titleZh: "推理语言", desc: "可见推理文字语言偏好" },
  { id: "SESSION_MEMORY_RETRIEVAL", title: "Memory Retrieval", titleZh: "记忆检索", desc: "BM25-based history/memory retrieval tools contract" },
  { id: "SESSION_REFERENCE_ARCHITECTURE", title: "Session References", titleZh: "会话引用架构", desc: "@past:chats feature design" },
  { id: "COLLABORATION_MODES.zh-CN", title: "协作模式", titleZh: "协作模式", desc: "Plan/Goal/Token Saver 三种协作模式" },
  { id: "DESKTOP_HOOKS.zh-CN", title: "桌面 Hooks", titleZh: "桌面 Hooks", desc: "桌面端 Hooks 配置、事件类型、负载格式" },
  { id: "GOAL_ENFORCEMENT.zh-CN", title: "Goal 强化模式", titleZh: "Goal 强化模式", desc: "Goal strict mode, quality checks, idle detection" },
  { id: "TOOL_APPROVAL_MODES.zh-CN", title: "工具审批模式", titleZh: "工具审批模式", desc: "Ask/Auto/YOLO 三种工具审批模式" },
  { id: "production_checklist", title: "Production Checklist", titleZh: "生产检查清单", desc: "Release gate checklist for v5.9.9" },
  { id: "production_checklist.zh-CN", title: "生产检查清单 (中文)", titleZh: "生产检查清单", desc: "v5.9.9 版本发布门禁检查清单" },
  { id: "RELEASING", title: "Releasing", titleZh: "发布流程", desc: "Branch model, canary/stable channels, release loop" },
];

interface DocMeta {
  id: string;
  title: string;
  titleZh: string;
  desc: string;
}

type PullStatus = "idle" | "pulling" | "done" | "error";

export function DocViewPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { status, requestClose } = useDeferredClose(onClose, 240);
  const [localDocs, setLocalDocs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string>("");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [pullStatus, setPullStatus] = useState<PullStatus>("idle");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HelpSearchHit[] | null>(null);
  const [remoteIndex, setRemoteIndex] = useState<DocMeta[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch remote doc index from GitHub (when upstream has docs/index.json)
  useEffect(() => {
    fetch(`${UPSTREAM_DOCS_BASE}/index.json`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && Array.isArray(data)) setRemoteIndex(data);
      })
      .catch(() => {/* ignore — fall back to KNOWN_DOCS */});
  }, []);

  // List local docs on mount
  useEffect(() => {
    if (window.go?.main?.App) {
      window.go.main.App.ListHelpDocs().then((names: string[]) => {
        const safe: string[] = names ?? [];
        setLocalDocs(safe);
        setLoaded(true);
        // Auto-select first doc if we have any
        if (safe.length > 0 && !selectedDoc) {
          setSelectedDoc(safe[0]);
        }
      }).catch(() => {
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced content search when query changes (3+ chars)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      if (window.go?.main?.App) {
        window.go.main.App.SearchHelpDocs(q).then((hits: HelpSearchHit[]) => {
          setSearchResults(hits ?? []);
        }).catch(() => setSearchResults([]));
      }
    }, 250);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load doc content when selection changes
  useEffect(() => {
    if (!selectedDoc) {
      setDocContent("");
      return;
    }
    // Check if already locally cached
    if (localDocs.includes(selectedDoc)) {
      loadLocalDoc(selectedDoc);
    } else {
      // Not cached — pull just this doc from GitHub
      pullSingleDoc(selectedDoc);
    }
  }, [selectedDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLocalDoc = useCallback(async (docId: string) => {
    setLoadingDoc(true);
    try {
      if (window.go?.main?.App) {
        const content = await window.go.main.App.LoadHelpDoc(docId);
        setDocContent(content || `# ${docId}\n\n*Document not found locally.*`);
      } else {
        // Fallback for dev: try fetch from GitHub directly
        const resp = await fetch(`${UPSTREAM_DOCS_BASE}/${docId}.md`);
        if (resp.ok) {
          setDocContent(await resp.text());
        } else {
          setDocContent(`# ${docId}\n\n*Failed to load document.*`);
        }
      }
    } catch {
      setDocContent(`# ${docId}\n\n*Error loading document.*`);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const pullSingleDoc = useCallback(async (docId: string) => {
    setLoadingDoc(true);
    try {
      const resp = await fetch(`${UPSTREAM_DOCS_BASE}/${docId}.md`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const content = await resp.text();
      setDocContent(content);
      // Cache it locally via Go backend
      if (window.go?.main?.App) {
        await window.go.main.App.SaveHelpDoc(docId, content);
        setLocalDocs((prev) => prev.includes(docId) ? prev : [...prev, docId]);
      }
    } catch {
      setDocContent(`# ${docId}\n\n*Failed to load document.*`);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const pullAllDocs = useCallback(async () => {
    setPullStatus("pulling");
    let successCount = 0;
    const isZh = locale === "zh" || locale === "zh-TW";
    // Only pull relevant language docs
    const toPull = (remoteIndex ?? KNOWN_DOCS).filter((d) => {
      const isChinese = d.id.endsWith(".zh-CN");
      return isZh ? isChinese : !isChinese;
    });
    try {
      for (const doc of toPull) {
        try {
          const resp = await fetch(`${UPSTREAM_DOCS_BASE}/${doc.id}.md`);
          if (!resp.ok) continue;
          const content = await resp.text();
          if (window.go?.main?.App) {
            await window.go.main.App.SaveHelpDoc(doc.id, content);
          }
          successCount++;
        } catch {
          // Continue with next doc
        }
      }
      // Refresh local docs list
      if (window.go?.main?.App) {
        const names = await window.go.main.App.ListHelpDocs();
        const safe: string[] = names ?? [];
        setLocalDocs(safe);
        if (safe.length > 0 && !selectedDoc) {
          setSelectedDoc(safe[0]);
        }
      }
      setPullStatus("done");
      setTimeout(() => setPullStatus("idle"), 3000);
    } catch {
      setPullStatus("error");
      setTimeout(() => setPullStatus("idle"), 5000);
    }
  }, [locale, remoteIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute filtered doc list based on locale and search
  const docIndex = useMemo(() => remoteIndex ?? KNOWN_DOCS, [remoteIndex]);
  const filteredDocs = useMemo(() => {
    const isZh = locale === "zh" || locale === "zh-TW";
    let docs = docIndex;
    // Filter by locale: prefer matching language
    if (isZh) {
      docs = docIndex.filter((d) => d.id.endsWith(".zh-CN"));
    } else {
      docs = docIndex.filter((d) => !d.id.endsWith(".zh-CN"));
    }
    // Append any locally-cached docs not in the known list
    // (handles docs manually added or pulled from upstream that aren't in KNOWN_DOCS)
    if (localDocs.length > 0) {
      const knownIds = new Set(docs.map((d) => d.id));
      const extra = localDocs
        .filter((id) => !knownIds.has(id))
        .map((id) => ({
          id,
          title: id,
          titleZh: id,
          desc: "Cached locally",
        }));
      if (extra.length > 0) {
        docs = [...docs, ...extra];
      }
    }
    // Apply title/description search only (when no content search results)
    if (searchQuery.trim() && !searchResults) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter((d) =>
        d.title.toLowerCase().includes(q) ||
        d.titleZh.toLowerCase().includes(q) ||
        d.desc.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
      );
    }
    return docs;
  }, [locale, searchQuery, searchResults, localDocs]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      requestClose();
    }
  }, [requestClose]);

  return (
    <div
      className="management-modal-backdrop doc-view-backdrop"
      data-state={status}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="management-modal doc-view-modal" data-state={status}>
        <header className="management-modal__head doc-view__head">
          <div className="management-modal__title doc-view__title">
            <BookOpen size={18} />
            <span>{t("docView.title")}</span>
          </div>
          <div className="doc-view__head-actions">
            {!loaded || localDocs.length === 0 ? (
              <Tooltip label={t("docView.pullDocs")}>
                <button
                  className="chip chip--primary"
                  type="button"
                  disabled={pullStatus === "pulling"}
                  onClick={pullAllDocs}
                >
                  {pullStatus === "pulling" ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  <span>{pullStatus === "pulling" ? t("docView.pulling") : t("docView.pullFromUpstream")}</span>
                </button>
              </Tooltip>
            ) : (
              <Tooltip label={t("docView.refresh")}>
                <button
                  className="chip chip--icon"
                  type="button"
                  disabled={pullStatus === "pulling"}
                  onClick={pullAllDocs}
                  aria-label={t("docView.refresh")}
                >
                  {pullStatus === "pulling" ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                </button>
              </Tooltip>
            )}
            <ModalCloseButton label={t("common.close")} onClick={requestClose} />
          </div>
        </header>

        <div className="doc-view__body">
          {/* Sidebar: doc list */}
          <aside className="doc-view__sidebar">
            <div className="doc-view__search">
              <Search size={13} className="doc-view__search-icon" />
              <input
                ref={searchInputRef}
                className="doc-view__search-input"
                type="text"
                placeholder={t("docView.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="doc-view__search-clear"
                  type="button"
                  onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                  aria-label={t("common.close")}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <nav className="doc-view__nav" aria-label={t("docView.title")}>
              {searchResults !== null ? (
                // Content search results
                searchResults.length === 0 ? (
                  <div className="doc-view__empty">{t("docView.noMatch")}</div>
                ) : (
                  searchResults.map((hit) => {
                    const isSelected = selectedDoc === hit.docID;
                    return (
                      <button
                        key={hit.docID}
                        className={`doc-view__nav-item${isSelected ? " doc-view__nav-item--active" : ""}`}
                        type="button"
                        onClick={() => setSelectedDoc(hit.docID)}
                      >
                        <div className="doc-view__nav-item-icon">
                          <FileSearch size={13} />
                        </div>
                        <div className="doc-view__nav-item-text">
                          <div className="doc-view__nav-item-title">{hit.docID}</div>
                          <div className="doc-view__nav-item-desc doc-view__nav-item-snippet">{hit.snippet}</div>
                        </div>
                      </button>
                    );
                  })
                )
              ) : filteredDocs.length === 0 ? (
                <div className="doc-view__empty">
                  {searchQuery ? t("docView.noMatch") : t("docView.noDocs")}
                </div>
              ) : (
                filteredDocs.map((doc) => {
                  const isSelected = selectedDoc === doc.id;
                  const isCached = localDocs.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      className={`doc-view__nav-item${isSelected ? " doc-view__nav-item--active" : ""}`}
                      type="button"
                      onClick={() => setSelectedDoc(doc.id)}
                    >
                      <div className="doc-view__nav-item-icon">
                        {isSelected && loadingDoc ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <FileText size={13} />
                        )}
                      </div>
                      <div className="doc-view__nav-item-text">
                        <div className="doc-view__nav-item-title">
                          {locale === "zh" || locale === "zh-TW" ? doc.titleZh : doc.title}
                        </div>
                        <div className="doc-view__nav-item-desc">{doc.desc}</div>
                      </div>
                      <div className="doc-view__nav-item-meta">
                        {isCached && <HardDrive size={11} className="doc-view__cached-icon" />}
                      </div>
                    </button>
                  );
                })
              )}
            </nav>

            <div className="doc-view__sidebar-footer">
              <a
                className="doc-view__upstream-link"
                href="https://github.com/esengine/DeepSeek-Reasonix/tree/main-v2/docs"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={12} />
                <span>{t("docView.viewOnGitHub")}</span>
              </a>
            </div>
          </aside>

          {/* Content area */}
          <main className="doc-view__content">
            {!selectedDoc ? (
              <div className="doc-view__welcome">
                <BookOpen size={48} className="doc-view__welcome-icon" />
                <h2>{t("docView.welcomeTitle")}</h2>
                <p>{t("docView.welcomeDesc")}</p>
                {localDocs.length === 0 && (
                  <button
                    className="chip chip--primary doc-view__welcome-cta"
                    type="button"
                    disabled={pullStatus === "pulling"}
                    onClick={pullAllDocs}
                  >
                    {pullStatus === "pulling" ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>{t("docView.pullFromUpstream")}</span>
                  </button>
                )}
              </div>
            ) : loadingDoc ? (
              <div className="doc-view__loading">
                <Loader2 size={24} className="spin" />
                <span>{t("docView.loadingDoc")}</span>
              </div>
            ) : (
              <div className="doc-view__markdown">
                <MarkdownRenderer text={docContent} />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// Minimal hook to get current locale.
function useLocale(): string {
  const { locale } = useI18n?.() ?? { locale: "en" };
  return locale;
}

