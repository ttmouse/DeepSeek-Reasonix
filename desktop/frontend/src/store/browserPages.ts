// browserPages owns the per-page state of the dock browser. Each dock tab of
// type "browser" maps to exactly one page here (keyed by the dock tab id), so
// switching dock tabs keeps every page's URL / history / loading / zoom alive
// even though TabContent unmounts inactive panels. The dock tab's label is
// synced by the panel through the activityBar store (updateTab), which is also
// what makes "each page = one tab at the top of the dock" work: the page state
// and the dock tab share the same id.
//
// Page state is deliberately session-local (no localStorage): reopening the
// app restores the dock tabs (activityBar persistence) and their last URL via
// the tab meta, but not the full navigation history.

import { create } from "zustand";

import { normalizeAddress, zoomStep } from "../lib/browserAddress";

export interface BrowserPageState {
  /** Currently displayed URL (normalized). */
  url: string;
  /** Navigation history for back/forward (oldest first). */
  history: string[];
  historyIndex: number;
  /** Page title when readable (same-origin); otherwise empty. */
  title: string;
  loading: boolean;
  /** Human-readable load error, or null while the page is usable. */
  error: string | null;
  /** Zoom factor (1 = 100%). */
  zoom: number;
}

export const DEFAULT_HOME = "https://example.com";
export const NAVIGATION_TIMEOUT_MS = 20_000;

export type BrowserPagesState = {
  pages: Record<string, BrowserPageState>;
  /** Address-bar drafts per tab id (the panel unmounts on tab switch, so the
   *  draft must outlive the component to keep a half-typed address). */
  drafts: Record<string, string>;
  openPage(tabId: string, initialUrl?: string): void;
  /** Navigate the page to a (possibly bare) address; normalizes first. */
  navigate(tabId: string, rawUrl: string): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  setLoading(tabId: string, loading: boolean): void;
  setTitle(tabId: string, title: string): void;
  setError(tabId: string, error: string | null): void;
  zoom(tabId: string, direction: -1 | 0 | 1): void;
  setDraft(tabId: string, value: string): void;
  clearDraft(tabId: string): void;
  /** Remove all state for a closed dock tab. */
  dropPage(tabId: string): void;
};

function createPage(url: string): BrowserPageState {
  return { url, history: [url], historyIndex: 0, title: "", loading: true, error: null, zoom: 1 };
}

export const useBrowserPagesStore = create<BrowserPagesState>((set, get) => ({
  pages: {},
  drafts: {},

  openPage: (tabId, initialUrl) => {
    const url = normalizeAddress(initialUrl ?? "") ?? DEFAULT_HOME;
    set((state) => ({ pages: { ...state.pages, [tabId]: createPage(url) } }));
  },

  navigate: (tabId, rawUrl) => {
    const url = normalizeAddress(rawUrl);
    if (!url) return;
    const page = get().pages[tabId];
    if (!page) {
      get().openPage(tabId, url);
      return;
    }
    // Truncate the forward stack, then append: standard browser semantics.
    const history = [...page.history.slice(0, page.historyIndex + 1), url];
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: {
          ...page,
          url,
          history,
          historyIndex: history.length - 1,
          title: "",
          loading: true,
          error: null,
        },
      },
    }));
  },

  goBack: (tabId) => {
    const page = get().pages[tabId];
    if (!page || page.historyIndex <= 0) return;
    const historyIndex = page.historyIndex - 1;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, historyIndex, url: page.history[historyIndex], loading: true, error: null },
      },
    }));
  },

  goForward: (tabId) => {
    const page = get().pages[tabId];
    if (!page || page.historyIndex >= page.history.length - 1) return;
    const historyIndex = page.historyIndex + 1;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, historyIndex, url: page.history[historyIndex], loading: true, error: null },
      },
    }));
  },

  reload: (tabId) => {
    const page = get().pages[tabId];
    if (!page) return;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, loading: true, error: null },
      },
    }));
  },

  setLoading: (tabId, loading) => {
    const page = get().pages[tabId];
    if (!page) return;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, loading },
      },
    }));
  },

  setTitle: (tabId, title) => {
    const page = get().pages[tabId];
    if (!page) return;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, title },
      },
    }));
  },

  setError: (tabId, error) => {
    const page = get().pages[tabId];
    if (!page) return;
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, error, loading: false },
      },
    }));
  },

  zoom: (tabId, direction) => {
    const page = get().pages[tabId];
    if (!page) return;
    const zoom = zoomStep(page.zoom, direction);
    set((state) => ({
      pages: {
        ...state.pages,
        [tabId]: { ...page, zoom },
      },
    }));
  },

  setDraft: (tabId, value) => set((state) => ({ drafts: { ...state.drafts, [tabId]: value } })),
  clearDraft: (tabId) => {
    const drafts = { ...get().drafts };
    delete drafts[tabId];
    set({ drafts });
  },

  dropPage: (tabId) => {
    const pages = { ...get().pages };
    const drafts = { ...get().drafts };
    delete pages[tabId];
    delete drafts[tabId];
    set({ pages, drafts });
  },
}));
