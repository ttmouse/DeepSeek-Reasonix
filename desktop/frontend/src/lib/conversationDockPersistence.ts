// Versioned persistence for the conversation-scoped right dock.
//
// One envelope (`reasonix.conversationDock.v1`) holds every conversation's
// dock snapshot AND workspace navigation, so a single eviction policy bounds
// localStorage growth and a restart restores both the open tabs and the tree
// selection per conversation. Old project-scoped keys are kept (never deleted)
// and copied lazily on a conversation's first open — the copy is one-time, so
// two conversations of the same project diverge from then on.
//
// Transient state never lands here: the + add menu, drag intermediates,
// loading/error, request sequences, and maximized/preview flags are session
// only (the latter live in the in-memory snapshot, see store/activityBar).

import type { TabItem } from "../store/activityBar";

export type PersistedConversationDock = {
  tabs: TabItem[];
  activeTabId: string | null;
  open: boolean;
  updatedAt: number;
};

export type PersistedWorkspaceTreeState = {
  openDirs: string[];
  selectedFilePath: string | null;
  selectedChangePath: string | null;
  scrollTop: number;
  recentPaths: string[];
  updatedAt: number;
};

export type ConversationDockRecord = {
  dock: PersistedConversationDock;
  /** Navigation state per dock file tab id within this conversation. */
  workspaceNavigation: Record<string, PersistedWorkspaceTreeState>;
  updatedAt: number;
};

export type PersistedConversationEnvelope = {
  version: 1;
  conversations: Array<ConversationDockRecord & { key: string }>;
};

export const CONVERSATION_DOCK_STORAGE_KEY = "reasonix.conversationDock.v1";
export const MAX_CONVERSATIONS = 100;
export const MAX_RECENT_PATHS = 10;

// Legacy keys (project-scoped predecessors, kept for migration only).
const LEGACY_DOCK_TABS_KEY = "reasonix.dock.tabs";
const LEGACY_WORKSPACE_PANEL_OPEN_KEY = "reasonix.workspacePanel.open";
const LEGACY_WORKSPACE_STATE_KEY = "reasonix.workspaceState.v2";
const LEGACY_WORKSPACE_STATE_VERSION = 2;
/** Legacy reserved project key holding the window-level tree width preference. */
const GLOBAL_TREE_WIDTH_LEGACY_KEY = "__global_tree_width__";

const records = new Map<string, ConversationDockRecord>();
let hydrated = false;

// Legacy migration context: App registers each active conversation's
// { scope, workspaceRoot } so a first read/mutation of a never-persisted
// conversation can copy the old project-scoped dock + navigation once.
// (The conversation key encodes this too, but path segments may contain
// colons — parsing it back would be fragile.)
export type ConversationDockLegacyContext = { scope: string; workspaceRoot: string };
const legacyContexts = new Map<string, ConversationDockLegacyContext>();

export function registerConversationDockLegacyContext(key: string, context: ConversationDockLegacyContext): void {
  legacyContexts.set(key, context);
}

export function readConversationDockLegacyContext(key: string): ConversationDockLegacyContext | undefined {
  return legacyContexts.get(key);
}

function defaultRecord(): ConversationDockRecord {
  return {
    dock: { tabs: [], activeTabId: null, open: false, updatedAt: 0 },
    workspaceNavigation: {},
    updatedAt: 0,
  };
}

function now(): number {
  return Date.now();
}

// ── envelope hydration / write ──────────────────────────────────────────────

export function hydrateConversationDockPersistence(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const parsed = JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "null") as Partial<PersistedConversationEnvelope> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.conversations)) return;
    for (const entry of parsed.conversations) {
      if (!entry || typeof entry.key !== "string" || !entry.dock || typeof entry.dock !== "object") continue;
      const dock = sanitizeDock(entry.dock);
      const navigation: Record<string, PersistedWorkspaceTreeState> = {};
      if (entry.workspaceNavigation && typeof entry.workspaceNavigation === "object") {
        for (const [tabId, state] of Object.entries(entry.workspaceNavigation)) {
          const sanitized = sanitizeNavigation(state);
          if (sanitized) navigation[tabId] = sanitized;
        }
      }
      records.set(entry.key, {
        dock,
        workspaceNavigation: navigation,
        updatedAt: typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      });
    }
  } catch {
    // Corrupt or newer storage must never prevent the dock from opening.
  }
}

function sanitizeDock(value: unknown): PersistedConversationDock {
  const dock = value as Partial<PersistedConversationDock> | null;
  const tabs = Array.isArray(dock?.tabs) ? dock.tabs : [];
  const seen = new Set<string>();
  const valid = tabs.filter((tab): tab is TabItem => {
    if (!tab || typeof tab.id !== "string" || typeof tab.type !== "string") return false;
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  const activeTabId = valid.some((tab) => tab.id === dock?.activeTabId)
    ? dock?.activeTabId ?? null
    : valid[valid.length - 1]?.id ?? null;
  return {
    tabs: valid,
    activeTabId,
    open: dock?.open === true && valid.length > 0,
    updatedAt: typeof dock?.updatedAt === "number" && Number.isFinite(dock.updatedAt) ? dock.updatedAt : 0,
  };
}

function sanitizeNavigation(value: unknown): PersistedWorkspaceTreeState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<PersistedWorkspaceTreeState>;
  const openDirs = Array.isArray(state.openDirs)
    ? state.openDirs.filter((path): path is string => typeof path === "string")
    : [];
  return {
    openDirs: openDirs.length > 0 ? openDirs : [""],
    selectedFilePath: typeof state.selectedFilePath === "string" && state.selectedFilePath.length > 0 ? state.selectedFilePath : null,
    selectedChangePath: typeof state.selectedChangePath === "string" && state.selectedChangePath.length > 0 ? state.selectedChangePath : null,
    scrollTop: typeof state.scrollTop === "number" && Number.isFinite(state.scrollTop) && state.scrollTop >= 0 ? state.scrollTop : 0,
    recentPaths: Array.isArray(state.recentPaths)
      ? state.recentPaths.filter((path): path is string => typeof path === "string").slice(0, MAX_RECENT_PATHS)
      : [],
    updatedAt: typeof state.updatedAt === "number" && Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
  };
}

function persistEnvelope(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Evict oldest by updatedAt beyond the cap, then serialize.
    const entries = Array.from(records.entries())
      .map(([key, record]) => ({ key, record }))
      .sort((a, b) => b.record.updatedAt - a.record.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    const envelope: PersistedConversationEnvelope = {
      version: 1,
      conversations: entries.map(({ key, record }) => ({
        key,
        dock: record.dock,
        workspaceNavigation: record.workspaceNavigation,
        updatedAt: record.updatedAt,
      })),
    };
    localStorage.setItem(CONVERSATION_DOCK_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage can be disabled or full; the in-memory state still works.
  }
}

// ── conversation records ────────────────────────────────────────────────────

export function readConversationDockRecord(key: string): ConversationDockRecord | null {
  hydrateConversationDockPersistence();
  const record = records.get(key);
  if (!record) return null;
  return {
    dock: { ...record.dock, tabs: record.dock.tabs.map((tab) => ({ ...tab })) },
    workspaceNavigation: record.workspaceNavigation,
    updatedAt: record.updatedAt,
  };
}

function touch(record: ConversationDockRecord): void {
  record.updatedAt = now();
  record.dock.updatedAt = record.updatedAt;
}

/** Apply a dock patch to the record, persisting the envelope. */
export function updateConversationDock(key: string, patch: Partial<PersistedConversationDock>): void {
  hydrateConversationDockPersistence();
  let record = records.get(key);
  if (!record) {
    record = defaultRecord();
    records.set(key, record);
  }
  record.dock = {
    ...record.dock,
    ...patch,
    tabs: patch.tabs ? patch.tabs.map((tab) => ({ ...tab })) : record.dock.tabs,
  };
  touch(record);
  persistEnvelope();
}

/** All hydrated conversation records, for store seeding at module load. */
export function allConversationDockRecords(): Array<{ key: string; record: ConversationDockRecord }> {
  hydrateConversationDockPersistence();
  return Array.from(records.entries()).map(([key, record]) => ({
    key,
    record: {
      dock: { ...record.dock, tabs: record.dock.tabs.map((tab) => ({ ...tab })) },
      workspaceNavigation: record.workspaceNavigation,
      updatedAt: record.updatedAt,
    },
  }));
}

/** Copy a temporary key's record onto the formal key (startup identity
 *  upgrade). If the formal key already has a record, the formal one wins and
 *  the temporary one is dropped. */
export function migrateConversationDockRecord(from: string, to: string): void {
  if (from === to) return;
  hydrateConversationDockPersistence();
  const source = records.get(from);
  const target = records.get(to);
  if (source && !target) {
    records.set(to, {
      dock: { ...source.dock, tabs: source.dock.tabs.map((tab) => ({ ...tab })) },
      workspaceNavigation: source.workspaceNavigation,
      updatedAt: source.updatedAt,
    });
  }
  records.delete(from);
  persistEnvelope();
}

export function resetConversationDockPersistenceForTests(): void {
  records.clear();
  legacyContexts.clear();
  hydrated = false;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(CONVERSATION_DOCK_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures in test environments.
  }
}

// ── workspace navigation (shared envelope) ──────────────────────────────────

export function readWorkspaceNavigation(key: string, dockTabId: string): PersistedWorkspaceTreeState | null {
  hydrateConversationDockPersistence();
  const record = records.get(key);
  const state = record?.workspaceNavigation[dockTabId];
  if (state) return { ...state, openDirs: [...state.openDirs] };
  // Lazy legacy copy: the first read of a conversation file tab with no
  // navigation record inherits the old project-scoped tree state exactly
  // once; afterwards the copy diverges on its own.
  const context = legacyContexts.get(key);
  if (!context) return null;
  const legacy = readLegacyWorkspaceNavigation(context.scope, context.workspaceRoot);
  if (!legacy) return null;
  const seeded: PersistedWorkspaceTreeState = {
    openDirs: [...legacy.openDirs],
    selectedFilePath: legacy.selectedFilePath,
    selectedChangePath: legacy.selectedChangePath,
    scrollTop: legacy.scrollTop,
    recentPaths: [...legacy.recentPaths],
    updatedAt: now(),
  };
  const target = records.get(key) ?? defaultRecord();
  records.set(key, target);
  target.workspaceNavigation[dockTabId] = seeded;
  touch(target);
  persistEnvelope();
  return { ...seeded, openDirs: [...seeded.openDirs] };
}

export function writeWorkspaceNavigation(key: string, dockTabId: string, patch: Partial<Omit<PersistedWorkspaceTreeState, "updatedAt">>): void {
  hydrateConversationDockPersistence();
  let record = records.get(key);
  if (!record) {
    record = defaultRecord();
    records.set(key, record);
  }
  const current = record.workspaceNavigation[dockTabId] ?? {
    openDirs: [""],
    selectedFilePath: null,
    selectedChangePath: null,
    scrollTop: 0,
    recentPaths: [],
    updatedAt: 0,
  };
  record.workspaceNavigation[dockTabId] = {
    ...current,
    ...patch,
    openDirs: patch.openDirs ? [...patch.openDirs] : [...current.openDirs],
    updatedAt: now(),
  };
  touch(record);
  persistEnvelope();
}

export function removeWorkspaceNavigation(key: string, dockTabId: string): void {
  hydrateConversationDockPersistence();
  const record = records.get(key);
  if (!record || !record.workspaceNavigation[dockTabId]) return;
  delete record.workspaceNavigation[dockTabId];
  touch(record);
  persistEnvelope();
}

// ── legacy migration (lazy one-time copy) ──────────────────────────────────

function legacyDockTabsStorageKey(workspaceRoot: string): string {
  return workspaceRoot ? `${LEGACY_DOCK_TABS_KEY}.${workspaceRoot}` : LEGACY_DOCK_TABS_KEY;
}

function legacyWorkspacePanelOpenStorageKey(workspaceRoot: string): string {
  return workspaceRoot ? `${LEGACY_WORKSPACE_PANEL_OPEN_KEY}.${workspaceRoot}` : LEGACY_WORKSPACE_PANEL_OPEN_KEY;
}

function readLegacyWorkspacePanelOpen(workspaceRoot: string): boolean | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(legacyWorkspacePanelOpenStorageKey(workspaceRoot));
    if (raw !== null) return raw !== "0";
    const legacyRaw = localStorage.getItem(LEGACY_WORKSPACE_PANEL_OPEN_KEY);
    if (legacyRaw !== null) return legacyRaw !== "0";
    return null;
  } catch {
    return null;
  }
}

/** Legacy project-scoped dock tabs for a workspace root (or null). */
export function readLegacyDockSeed(workspaceRoot: string): { tabs: TabItem[]; activeTabId: string | null; open: boolean } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(legacyDockTabsStorageKey(workspaceRoot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs?: TabItem[]; activeTabId?: string | null };
    const seen = new Set<string>();
    const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).filter((tab): tab is TabItem => {
      if (!tab || typeof tab.id !== "string" || typeof tab.type !== "string") return false;
      if (seen.has(tab.id)) return false;
      seen.add(tab.id);
      return true;
    });
    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId ?? null : tabs[tabs.length - 1]?.id ?? null;
    const legacyOpen = readLegacyWorkspacePanelOpen(workspaceRoot);
    // A dock with zero tabs is never "expanded" (the legacy app collapsed it).
    const open = tabs.length > 0 && legacyOpen !== false;
    return { tabs, activeTabId, open };
  } catch {
    return null;
  }
}

type LegacyProjectState = {
  openDirs: string[];
  selectedFilePath: string | null;
  selectedChangePath: string | null;
  scrollTop: number;
  recentPaths: string[];
  treeWidth?: number | null;
  treeWidthMode?: "manual" | "even";
};

let legacyProjects: Record<string, LegacyProjectState> | null = null;

function readLegacyProjects(): Record<string, LegacyProjectState> {
  if (legacyProjects) return legacyProjects;
  legacyProjects = {};
  if (typeof localStorage === "undefined") return legacyProjects;
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_WORKSPACE_STATE_KEY) ?? "null") as
      | { version?: number; projects?: Array<{ key?: string; state?: Partial<LegacyProjectState> }> }
      | null;
    if (!parsed || parsed.version !== LEGACY_WORKSPACE_STATE_VERSION || !Array.isArray(parsed.projects)) return legacyProjects;
    for (const project of parsed.projects) {
      if (!project || typeof project.key !== "string" || !project.state || typeof project.state !== "object") continue;
      const state = project.state;
      legacyProjects[project.key] = {
        openDirs: Array.isArray(state.openDirs)
          ? state.openDirs.filter((path): path is string => typeof path === "string")
          : [""],
        selectedFilePath: typeof state.selectedFilePath === "string" && state.selectedFilePath.length > 0 ? state.selectedFilePath : null,
        selectedChangePath: typeof state.selectedChangePath === "string" && state.selectedChangePath.length > 0 ? state.selectedChangePath : null,
        scrollTop: typeof state.scrollTop === "number" && Number.isFinite(state.scrollTop) && state.scrollTop >= 0 ? state.scrollTop : 0,
        recentPaths: Array.isArray(state.recentPaths)
          ? state.recentPaths.filter((path): path is string => typeof path === "string").slice(0, MAX_RECENT_PATHS)
          : [],
        treeWidth: typeof state.treeWidth === "number" && Number.isFinite(state.treeWidth) && state.treeWidth > 0 ? state.treeWidth : null,
        treeWidthMode: state.treeWidthMode === "even" ? "even" : "manual",
      };
    }
  } catch {
    // Corrupt legacy storage must never block the migration.
  }
  return legacyProjects;
}

/** Legacy project-level navigation state for `scope\u0000workspaceRoot`, or null. */
export function readLegacyWorkspaceNavigation(scope: string, workspaceRoot: string): LegacyProjectState | null {
  const projects = readLegacyProjects();
  const project = projects[`${scope}\u0000${workspaceRoot}`];
  return project ? { ...project, openDirs: [...project.openDirs] } : null;
}

/** Legacy window-level tree width preference (v2 stored it under a reserved
 *  project key), or null when the user never changed it. */
export function readLegacyGlobalTreeWidth(): { treeWidth: number | null; treeWidthMode: "manual" | "even" } | null {
  const projects = readLegacyProjects();
  const global = projects[GLOBAL_TREE_WIDTH_LEGACY_KEY];
  if (!global) return null;
  return { treeWidth: global.treeWidth ?? null, treeWidthMode: global.treeWidthMode === "even" ? "even" : "manual" };
}

export function resetLegacyWorkspacePersistenceCacheForTests(): void {
  legacyProjects = null;
}
