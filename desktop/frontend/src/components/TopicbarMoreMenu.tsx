import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  Download,
  FileDown,
  FileImage,
  FileJson,
  FileText,
  GitBranch,
  MoreHorizontal,
  TerminalSquare,
} from "lucide-react";

import { Tooltip } from "./Tooltip";

import { t } from "../lib/i18n";
import { writeClipboardText } from "../lib/clipboard";

/**
 * "More" overflow menu for the topic bar. The primary toolbar keeps only
 * file-opener and workspace-panel toggles; everything else (copy, export,
 * changes, terminal, session summary) lives here so the bar stays compact
 * even when the chat pane is squeezed to its 400px minimum.
 */
export function TopicbarMoreMenu({
  sessionHasContent,
  getSessionMarkdown,
  exportSession,
  openChangedDock,
  toggleTerminal,
  openSessionSummary,
  tasksOpen,
}: {
  sessionHasContent: boolean;
  getSessionMarkdown: () => string | Promise<string>;
  exportSession: (format: "markdown" | "json" | "pdf" | "image") => void;
  openChangedDock: () => void;
  toggleTerminal: () => void;
  openSessionSummary: () => void;
  tasksOpen: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setExportOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
    };
  }, [menuOpen]);

  const copySession = async () => {
    try {
      const value = await getSessionMarkdown();
      // writeClipboardText falls back from the async Clipboard API to the
      // Wails runtime bridge and finally a hidden-textarea execCommand, so
      // copy still works in desktop webviews that deny navigator.clipboard.
      await writeClipboardText(value);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setExportOpen(false);
  };

  return (
    <div ref={rootRef} className={`topicbar__more${menuOpen ? " topicbar__more--open" : ""}`}>
      <Tooltip label={t("topicBar.more")}>
        <button
          className="topicbar__action-btn topicbar__action-btn--icon topicbar__action-btn--utility"
          type="button"
          aria-label={t("topicBar.more")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
            setExportOpen(false);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </Tooltip>
      {menuOpen && (
        <div className="topicbar__more-menu" role="menu" aria-label={t("topicBar.more")}>
          <button className="topicbar__menu-item" type="button" role="menuitem" onClick={() => { closeMenu(); void copySession(); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? t("msg.copied") : t("topicBar.copyAll")}</span>
          </button>
          <div className={`topicbar__more-export${exportOpen ? " topicbar__more-export--open" : ""}`}>
            <button
              className="topicbar__menu-item"
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              disabled={!sessionHasContent}
              onClick={() => setExportOpen((open) => !open)}
            >
              <Download size={14} />
              <span>{t("topicBar.export")}</span>
            </button>
            {exportOpen && (
              <div className="topicbar__more-export-menu" role="menu" aria-label={t("topicBar.export")}>
                <button type="button" role="menuitem" disabled={!sessionHasContent} onClick={() => { closeMenu(); exportSession("markdown"); }}>
                  <FileText size={13} />
                  <span>{t("topicBar.exportMarkdown")}</span>
                </button>
                <button type="button" role="menuitem" disabled={!sessionHasContent} onClick={() => { closeMenu(); exportSession("json"); }}>
                  <FileJson size={13} />
                  <span>{t("topicBar.exportJson")}</span>
                </button>
                <button type="button" role="menuitem" disabled={!sessionHasContent} onClick={() => { closeMenu(); exportSession("pdf"); }}>
                  <FileDown size={13} />
                  <span>{t("topicBar.exportPdf")}</span>
                </button>
                <button type="button" role="menuitem" disabled={!sessionHasContent} onClick={() => { closeMenu(); exportSession("image"); }}>
                  <FileImage size={13} />
                  <span>{t("topicBar.exportImage")}</span>
                </button>
              </div>
            )}
          </div>
          <button className="topicbar__menu-item" type="button" role="menuitem" onClick={() => { closeMenu(); openChangedDock(); }}>
            <GitBranch size={14} />
            <span>{t("workspace.changedTab")}</span>
          </button>
          <button className="topicbar__menu-item" type="button" role="menuitem" onClick={() => { closeMenu(); toggleTerminal(); }}>
            <TerminalSquare size={14} />
            <span>{t("rightDock.terminal")}</span>
          </button>
          <button
            className={`topicbar__menu-item${tasksOpen ? " topicbar__menu-item--active" : ""}`}
            type="button"
            role="menuitem"
            aria-pressed={tasksOpen}
            onClick={() => { closeMenu(); openSessionSummary(); }}
          >
            <Activity size={14} />
            <span>{t("summary.session")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
