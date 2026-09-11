// activityBar owns the right dock's activity-bar + tab-container state per
// CONVERSATION: each conversation's set of open tabs, its active one, whether
// the tab container is expanded, and the transient + add-menu open flag.
// Panel contents stay in App (they need its props); this store only tracks
// which tab is open so the dock can switch between them.
//
// The dock follows the plan's interaction model: by default only the 48px
// activity bar is visible; opening an entry expands the tab container; closing
// the last tab collapses it back to the bar. `open` records that expanded
// state (true while ≥1 tab is open).
//
// The conversation key is supplied by callers (App computes it from the
// active TabMeta via conversationDockIdentity); every mutation is keyed so a
// delayed callback from conversation A can never write into conversation B's
// snapshot. Snapshots are persisted to localStorage per conversation (a
// versioned envelope, see conversationDockPersistence) so a restart restores
// each conversation's own tabs. The add menu stays session-local.
//
// A conversation with no record yet seeds lazily: first from the new envelope,
// then from the legacy project-scoped keys (one-time copy, then independent).

import { useMemo } from "react";
import { create } from "zustand";

import type { ConversationDockIdentityInput } from "../lib/conversationDockIdentity";
import { conversationDockKey } from "../lib/conversationDockIdentity";
import {
  allConversationDockRecords,
  migrateConversationDockRecord,
  readConversationDockLegacyContext,
  readConversationDockRecord,
  readLegacyDockSeed,
  registerConversationDockLegacyContext,
  resetConversationDockPersistenceForTests,
  updateConversationDock,
} from "../lib/conversationDockPersistence";

export type TabType = "file" | "changed" | "terminal" | "browser" | "remote" | "context" | "instructions";

export interface TabItem {
  id: string;
  type: TabType;
  label: string;
  meta?: Record<string, unknown>;
}

/** A conversation's dock work scene. maximized/previewActive are session-only
 *  (isolated per conversation but not persisted); everything else is durable. */
export type ConversationDockSnapshot = {
  tabs: TabItem[];
  activeTabId: string | null;
  open: boolean;
  maximized: boolean;
  previewActive: boolean;
};

export function defaultConversationDockSnapshot(): ConversationDockSnapshot {
  return { tabs: [], activeTabId: null, open: false, maximized: false, previewActive: false };
}

function snapshotFromDock(dock: { tabs: TabItem[]; activeTabId: string | null; open: boolean }): ConversationDockSnapshot {
  return {
    tabs: dock.tabs.map((tab) => ({ ...tab })),
    activeTabId: dock.activeTabId,
    open: dock.open,
    maximized: false,
    previewActive: false,
  };
}

// tabSeq must not collide with ids restored from the envelope (which may
// contain dock-tab-N from a previous session). Seed it past the highest
// persisted id so fresh tabs never duplicate an existing key.
let tabSeq = 0;

// Seed-context side channel (owned by conversationDockPersistence): the hook
// and App register each conversation's { scope, workspaceRoot } so a first
// mutation on a never-persisted conversation can copy the legacy project
// dock. This is a plain map (not React state).
export { registerConversationDockLegacyContext };

function loadConversationDockSeed(key: string): ConversationDockSnapshot {
  const record = readConversationDockRecord(key);
  if (record) return snapshotFromDock(record.dock);
  const context = readConversationDockLegacyContext(key);
  const legacy = context ? readLegacyDockSeed(context.workspaceRoot) : null;
  if (legacy) {
    return { ...snapshotFromDock(legacy), maximized: false, previewActive: false };
  }
  return defaultConversationDockSnapshot();
}

function ensureSnapshot(state: ConversationDockState, key: string): ConversationDockSnapshot {
  return state.snapshots[key] ?? loadConversationDockSeed(key);
}

function nextTabId(): string {
  tabSeq += 1;
  return `dock-tab-${tabSeq}`;
}

// Seed tabSeq from all persisted conversations at module load.
const initialSnapshots: Record<string, ConversationDockSnapshot> = {};
for (const { key, record } of allConversationDockRecords()) {
  for (const tab of record.dock.tabs) {
    const match = /^dock-tab-(\d+)$/.exec(tab.id);
    if (match) tabSeq = Math.max(tabSeq, Number(match[1]));
  }
  initialSnapshots[key] = snapshotFromDock(record.dock);
}

export type ConversationDockState = {
  snapshots: Record<string, ConversationDockSnapshot>;
  addMenuOpen: boolean;
  /** Open the entry's default tab, switching to it when one of that type exists. */
  openEntry: (key: string, type: TabType, label: string, meta?: Record<string, unknown>) => void;
  /** Append a new tab of the given type and activate it. */
  addTab: (key: string, type: TabType, label: string, meta?: Record<string, unknown>) => void;
  /** Update a tab's label and meta (e.g. a file tab whose preview file changes
   *  its title from 文件 to the file name). */
  updateTab: (key: string, tabId: string, label: string, meta?: Record<string, unknown>) => void;
  closeTab: (key: string, tabId: string) => void;
  activateTab: (key: string, tabId: string) => void;
  /** Move a tab so it lands on the left/right side of another tab. */
  moveTab: (key: string, fromId: string, toId: string, side: "left" | "right") => void;
  /** Collapse/expand the tab container without touching the tab list. */
  setOpen: (key: string, open: boolean) => void;
  /** Session-only view flags, isolated per conversation. */
  setMaximized: (key: string, maximized: boolean) => void;
  setPreviewActive: (key: string, active: boolean) => void;
  /** Atomically move a temporary key's snapshot onto its formal key. */
  migrateConversationKey: (from: string, to: string) => void;
  setAddMenuOpen: (open: boolean) => void;
  resetConversationDockForTests: () => void;
};

export const useActivityBarStore = create<ConversationDockState>((set) => ({
  snapshots: initialSnapshots,
  addMenuOpen: false,
  openEntry: (key, type, label, meta) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      const existing = current.tabs.find((tab) => tab.type === type);
      if (existing) {
        updateConversationDock(key, { tabs: current.tabs, activeTabId: existing.id, open: true });
        return { snapshots: { ...state.snapshots, [key]: { ...current, activeTabId: existing.id, open: true } } };
      }
      const tab: TabItem = { id: nextTabId(), type, label, meta };
      const tabs = [...current.tabs, tab];
      updateConversationDock(key, { tabs, activeTabId: tab.id, open: true });
      return { snapshots: { ...state.snapshots, [key]: { ...current, tabs, activeTabId: tab.id, open: true } } };
    }),
  addTab: (key, type, label, meta) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      const tab: TabItem = { id: nextTabId(), type, label, meta };
      const tabs = [...current.tabs, tab];
      updateConversationDock(key, { tabs, activeTabId: tab.id, open: true });
      return { snapshots: { ...state.snapshots, [key]: { ...current, tabs, activeTabId: tab.id, open: true } } };
    }),
  updateTab: (key, tabId, label, meta) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      const tabs = current.tabs.map((tab) => (tab.id === tabId ? { ...tab, label, ...(meta ? { meta } : {}) } : tab));
      updateConversationDock(key, { tabs, activeTabId: current.activeTabId });
      return { snapshots: { ...state.snapshots, [key]: { ...current, tabs } } };
    }),
  closeTab: (key, tabId) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      const index = current.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return state;
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      let activeTabId = current.activeTabId;
      if (current.activeTabId === tabId) {
        // Fall back to the neighbor on the left, then the right, then null.
        activeTabId = tabs[index - 1]?.id ?? tabs[index]?.id ?? null;
      }
      // Closing the last tab collapses the container back to the activity bar.
      const open = tabs.length > 0;
      updateConversationDock(key, { tabs, activeTabId, open });
      return { snapshots: { ...state.snapshots, [key]: { ...current, tabs, activeTabId, open } } };
    }),
  activateTab: (key, tabId) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      if (!current.tabs.some((tab) => tab.id === tabId)) return state;
      updateConversationDock(key, { tabs: current.tabs, activeTabId: tabId, open: true });
      return { snapshots: { ...state.snapshots, [key]: { ...current, activeTabId: tabId, open: true } } };
    }),
  moveTab: (key, fromId, toId, side) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      if (fromId === toId) return state;
      const tabs = [...current.tabs];
      const fromIndex = tabs.findIndex((tab) => tab.id === fromId);
      if (fromIndex < 0) return state;
      const [moved] = tabs.splice(fromIndex, 1);
      const toIndex = tabs.findIndex((tab) => tab.id === toId);
      if (toIndex < 0) return state;
      tabs.splice(side === "right" ? toIndex + 1 : toIndex, 0, moved);
      updateConversationDock(key, { tabs, activeTabId: current.activeTabId });
      return { snapshots: { ...state.snapshots, [key]: { ...current, tabs } } };
    }),
  setOpen: (key, open) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      if (current.open === open) return state;
      updateConversationDock(key, { tabs: current.tabs, activeTabId: current.activeTabId, open });
      return { snapshots: { ...state.snapshots, [key]: { ...current, open } } };
    }),
  setMaximized: (key, maximized) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      if (current.maximized === maximized) return state;
      return { snapshots: { ...state.snapshots, [key]: { ...current, maximized } } };
    }),
  setPreviewActive: (key, active) =>
    set((state) => {
      const current = ensureSnapshot(state, key);
      if (current.previewActive === active) return state;
      return { snapshots: { ...state.snapshots, [key]: { ...current, previewActive: active } } };
    }),
  migrateConversationKey: (from, to) => {
    if (from === to) return;
    migrateConversationDockRecord(from, to);
    set((state) => {
      if (state.snapshots[to]) {
        const next = { ...state.snapshots };
        delete next[from];
        return { snapshots: next };
      }
      const fromSnapshot = state.snapshots[from];
      if (!fromSnapshot) return state;
      const next = { ...state.snapshots, [to]: fromSnapshot };
      delete next[from];
      return { snapshots: next };
    });
  },
  setAddMenuOpen: (open) => set({ addMenuOpen: open }),
  resetConversationDockForTests: () => {
    resetConversationDockPersistenceForTests();
    set({ snapshots: {}, addMenuOpen: false });
    tabSeq = 0;
  },
}));

/** Bound view + actions for one conversation's dock. The key is derived from
 *  the identity input; the snapshot is read synchronously (no effect-based
 *  switch), so switching conversations shows the right dock on the first
 *  frame. Every returned action is bound to this key. */
export function useConversationDock(input: ConversationDockIdentityInput): ConversationDockSnapshot & {
  openEntry: (type: TabType, label: string, meta?: Record<string, unknown>) => void;
  addTab: (type: TabType, label: string, meta?: Record<string, unknown>) => void;
  updateTab: (tabId: string, label: string, meta?: Record<string, unknown>) => void;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  moveTab: (fromId: string, toId: string, side: "left" | "right") => void;
  setOpen: (open: boolean) => void;
  setMaximized: (maximized: boolean) => void;
  setPreviewActive: (active: boolean) => void;
} {
  const key = useMemo(() => conversationDockKey(input), [input]);
  const snapshot = useActivityBarStore((s) => s.snapshots[key]);
  const resolved = useMemo(() => {
    registerConversationDockLegacyContext(key, { scope: input.scope ?? "", workspaceRoot: input.workspaceRoot ?? "" });
    return snapshot ?? loadConversationDockSeed(key);
  }, [snapshot, key, input]);
  const actions = useMemo(() => {
    const store = useActivityBarStore.getState;
    return {
      openEntry: (type: TabType, label: string, meta?: Record<string, unknown>) => store().openEntry(key, type, label, meta),
      addTab: (type: TabType, label: string, meta?: Record<string, unknown>) => store().addTab(key, type, label, meta),
      updateTab: (tabId: string, label: string, meta?: Record<string, unknown>) => store().updateTab(key, tabId, label, meta),
      closeTab: (tabId: string) => store().closeTab(key, tabId),
      activateTab: (tabId: string) => store().activateTab(key, tabId),
      moveTab: (fromId: string, toId: string, side: "left" | "right") => store().moveTab(key, fromId, toId, side),
      setOpen: (open: boolean) => store().setOpen(key, open),
      setMaximized: (maximized: boolean) => store().setMaximized(key, maximized),
      setPreviewActive: (active: boolean) => store().setPreviewActive(key, active),
    };
  }, [key]);
  return useMemo(() => ({ ...resolved, ...actions }), [resolved, actions]);
}
