// BrowserPanel renders one browser page inside the right dock. Each dock tab
// of type "browser" maps to exactly one page: the panel reads the page's URL /
// history / loading / zoom from browserPagesStore (keyed by the dock tab id)
// and pushes the page label back into the dock tab through updateTab, so every
// page gets its own tab at the top of the dock — instead of upstream's single
// "browser" dock tab wrapping an inner page-tab strip.
//
// Rendering is an <iframe> (Wails exposes one webview, so native guest views
// like upstream's Electron shell are not available here). The sandbox keeps
// the panel's security posture from the original single-page panel: scripts,
// forms and popups allowed, same-origin removed (opaque origin), so the loaded
// page can never touch the app's own document. A side effect is that the page
// title is not readable, so the dock tab label falls back to the URL.
//
// Per-page state lives in the store rather than component state because
// TabContent unmounts inactive panels: switching dock tabs would otherwise
// lose every page's history and address draft.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Loader2, Plus, RotateCw, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { zoomPercent } from "../lib/browserAddress";
import { useT } from "../lib/i18n";
import { useActivityBarStore } from "../store/activityBar";
import { NAVIGATION_TIMEOUT_MS, useBrowserPagesStore } from "../store/browserPages";

/** Compact tab label for a URL: host + path (+ search), truncated. */
function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let label = parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
    if (parsed.search) label += parsed.search;
    return label.length > 48 ? `${label.slice(0, 45)}…` : label;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}

export function BrowserPanel({ tabId, conversationKey }: { tabId: string; conversationKey: string }) {
  const t = useT();
  const page = useBrowserPagesStore((s) => s.pages[tabId]);
  const draft = useBrowserPagesStore((s) => s.drafts[tabId]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Bumping this nonce forces the iframe to remount on reload even when the
  // URL is unchanged (key includes the nonce). It is panel-local: a reload is
  // momentary, so losing it on a tab switch is fine.
  const [reloadNonce, setReloadNonce] = useState(0);
  const store = useBrowserPagesStore.getState;

  // Seed the page state on first mount from the dock tab's persisted meta
  // (activityBar restores tabs across restarts; the last URL rides in meta).
  useEffect(() => {
    if (useBrowserPagesStore.getState().pages[tabId]) return;
    const tab = useActivityBarStore.getState().snapshots[conversationKey]?.tabs.find((entry) => entry.id === tabId);
    const initialUrl = typeof tab?.meta?.url === "string" ? tab.meta.url : undefined;
    store().openPage(tabId, initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, conversationKey]);

  // Loading watchdog: a page that never fires load (X-Frame-Options refusal,
  // dead host, blocked sandbox) must surface an error with retry.
  useEffect(() => {
    if (!page?.loading) return;
    const timer = window.setTimeout(() => {
      const current = useBrowserPagesStore.getState().pages[tabId];
      if (current?.loading && !current.error) {
        store().setError(tabId, t("browser.loadFailed", { url: current.url }));
      }
    }, NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [page?.loading, page?.url, store, t, tabId]);

  // Keep the dock tab label (and persisted URL) in sync with the page.
  useEffect(() => {
    if (!page) return;
    useActivityBarStore.getState().updateTab(conversationKey, tabId, page.title || displayUrl(page.url), { url: page.url });
  }, [page, tabId, conversationKey]);

  const onFrameLoad = useCallback(() => {
    store().setLoading(tabId, false);
    store().setError(tabId, null);
    // Title reads are blocked by the sandbox (opaque origin), so this only
    // ever applies to a future sandbox change; keep the attempt cheap and safe.
    try {
      const doc = frameRef.current?.contentDocument;
      if (doc?.title) store().setTitle(tabId, doc.title);
    } catch {
      /* cross-origin / sandboxed — the tab label stays the URL */
    }
  }, [store, tabId]);

  const reload = useCallback(() => {
    store().reload(tabId);
    setReloadNonce((nonce) => nonce + 1);
  }, [store, tabId]);

  const addNewPage = useCallback(() => {
    useActivityBarStore.getState().addTab(conversationKey, "browser", t("rightDock.browser"));
  }, [t, conversationKey]);

  if (!page) return null; // seeded by the mount effect above

  const addressValue = draft ?? page.url;
  const submitAddress = () => {
    store().navigate(tabId, addressValue);
    store().clearDraft(tabId);
  };

  return (
    <div className="browser-panel">
      <div className="browser-panel__toolbar">
        <button type="button" className="browser-panel__nav" aria-label={t("browser.back")} disabled={page.historyIndex <= 0}
          onClick={() => store().goBack(tabId)}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className="browser-panel__nav" aria-label={t("browser.forward")} disabled={page.historyIndex >= page.history.length - 1}
          onClick={() => store().goForward(tabId)}>
          <ArrowRight size={14} />
        </button>
        <button type="button" className="browser-panel__nav" aria-label={t("browser.reload")} onClick={reload}>
          <RotateCw size={14} />
        </button>
        <form
          className="browser-panel__address"
          onSubmit={(event) => {
            event.preventDefault();
            submitAddress();
          }}
        >
          <input
            value={addressValue}
            onChange={(event) => store().setDraft(tabId, event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                store().clearDraft(tabId);
                event.currentTarget.blur();
              }
            }}
            placeholder={t("browser.addressPlaceholder")}
            spellCheck={false}
            aria-label={t("browser.addressPlaceholder")}
          />
        </form>
        <button type="button" className="browser-panel__nav" aria-label={t("browser.zoomOut")} onClick={() => store().zoom(tabId, -1)}>
          <ZoomOut size={14} />
        </button>
        <button type="button" className="browser-panel__zoom" aria-label={t("browser.zoomReset")} onClick={() => store().zoom(tabId, 0)}>
          {zoomPercent(page.zoom)}%
        </button>
        <button type="button" className="browser-panel__nav" aria-label={t("browser.zoomIn")} onClick={() => store().zoom(tabId, 1)}>
          <ZoomIn size={14} />
        </button>
        <button type="button" className="browser-panel__nav" aria-label={t("browser.newTab")} onClick={addNewPage}>
          <Plus size={14} />
        </button>
      </div>
      <div className="browser-panel__frame">
        {page.error ? (
          <div className="browser-panel__error" role="alert">
            <TriangleAlert size={22} aria-hidden="true" />
            <p className="browser-panel__error-title">{t("browser.errorTitle")}</p>
            <p className="browser-panel__error-detail">{page.error}</p>
            <code className="browser-panel__error-url">{page.url}</code>
            <button type="button" className="btn btn--small" onClick={reload}>{t("browser.retry")}</button>
          </div>
        ) : (
          <div className="browser-panel__surface" style={{ zoom: page.zoom } as CSSProperties}>
            <iframe
              ref={frameRef}
              key={`${page.url}:${reloadNonce}`}
              src={page.url}
              title={t("browser.frameTitle")}
              sandbox="allow-scripts allow-forms allow-popups"
              onLoad={onFrameLoad}
            />
          </div>
        )}
        {page.loading && (
          <div className="browser-panel__loading" role="status" aria-live="polite">
            <Loader2 size={20} className="browser-panel__loading-spinner" aria-hidden="true" />
            <span className="browser-panel__loading-text">{t("browser.loading")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
