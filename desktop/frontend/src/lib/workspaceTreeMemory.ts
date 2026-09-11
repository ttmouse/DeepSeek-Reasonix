// Conversation-scoped workspace navigation memory.
//
// The file tree's expanded dirs, selection, scroll position and recent paths
// belong to a conversation's dock work scene — keyed by
// `conversationDockKey\u0000dockTabId` — so two conversations of the same
// project keep independent trees, and switching tabs restores each one's own
// state. Persistence lives in the shared versioned envelope
// (reasonix.conversationDock.v1, see conversationDockPersistence) together
// with the dock snapshot, under the same 100-conversation cap.
//
// The one exception is the tree/preview width preference (GLOBAL_TREE_WIDTH_KEY
// — a window-level operation habit, not conversation content): it is stored in
// its own tiny key and stays global. Legacy project-scoped navigation from
// reasonix.workspaceState.v2 is copied lazily on a conversation's first read
// (registered via registerConversationDockLegacyContext), then independent.

import {
  readLegacyGlobalTreeWidth,
  readWorkspaceNavigation,
  registerConversationDockLegacyContext,
  writeWorkspaceNavigation,
} from "./conversationDockPersistence";
import { createWorkspaceTreePersistenceScheduler } from "./workspaceTreePersistence";

export type WorkspaceTreeWidthMode = "manual" | "even";

export interface WorkspaceTreeMemorySnapshot {
  openDirs: Set<string>;
  visitId: number;
  selectedFilePath: string | null;
  selectedChangePath: string | null;
  treeWidth: number | null;
  treeWidthMode: WorkspaceTreeWidthMode;
  scrollTop: number;
  dockTreeWidth: number | null;
  dockPreviewWidth: number | null;
  recentPaths: string[];
}

/** Memory key for the window-level tree/preview width preference. */
export const GLOBAL_TREE_WIDTH_KEY = "__global_tree_width__";
const GLOBAL_TREE_WIDTH_STORAGE_KEY = "reasonix.workspaceState.globalTreeWidth";

type PersistedGlobalTreeWidth = {
  treeWidth: number | null;
  treeWidthMode: WorkspaceTreeWidthMode;
  updatedAt: number;
};

// Runtime cache: snapshots for the keys visited this session (incl. the
// runtime-only visitId). Persisted state lives in the conversation envelope;
// this map is the cheap synchronous read layer and the coalesced-scroll
// source, and it seeds on demand from persistence / legacy.
const workspaceTreeMemory = new Map<string, WorkspaceTreeMemorySnapshot>();
let activeWorkspaceTreeKey = "";
let workspaceTreeVisitSequence = 0;

function defaultSnapshot(visitId = 0): WorkspaceTreeMemorySnapshot {
  return {
    openDirs: new Set([""]),
    visitId,
    selectedFilePath: null,
    selectedChangePath: null,
    treeWidth: null,
    treeWidthMode: "manual",
    scrollTop: 0,
    dockTreeWidth: null,
    dockPreviewWidth: null,
    recentPaths: [],
  };
}

function cloneSnapshot(snapshot: WorkspaceTreeMemorySnapshot): WorkspaceTreeMemorySnapshot {
  return { ...snapshot, openDirs: new Set(snapshot.openDirs) };
}

function splitMemoryKey(memoryKey: string): { conversationKey: string; dockTabId: string } {
  const separator = memoryKey.lastIndexOf("\u0000");
  if (separator < 0) return { conversationKey: memoryKey, dockTabId: "" };
  return { conversationKey: memoryKey.slice(0, separator), dockTabId: memoryKey.slice(separator + 1) };
}

function snapshotFromPersisted(state: {
  openDirs: string[];
  selectedFilePath: string | null;
  selectedChangePath: string | null;
  scrollTop: number;
  recentPaths: string[];
  updatedAt: number;
}, visitId: number): WorkspaceTreeMemorySnapshot {
  const openDirs = state.openDirs.length > 0 ? state.openDirs : [""];
  return {
    openDirs: new Set(openDirs),
    visitId,
    selectedFilePath: state.selectedFilePath,
    selectedChangePath: state.selectedChangePath,
    treeWidth: null,
    treeWidthMode: "manual",
    scrollTop: state.scrollTop,
    dockTreeWidth: null,
    dockPreviewWidth: null,
    recentPaths: state.recentPaths,
  };
}

// ── global tree width (window-level preference) ─────────────────────────────

function readPersistedGlobalTreeWidth(): { treeWidth: number | null; treeWidthMode: WorkspaceTreeWidthMode } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(GLOBAL_TREE_WIDTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedGlobalTreeWidth> | null;
      if (parsed && typeof parsed === "object") {
        return {
          treeWidth: typeof parsed.treeWidth === "number" && Number.isFinite(parsed.treeWidth) && parsed.treeWidth > 0
            ? parsed.treeWidth
            : null,
          treeWidthMode: parsed.treeWidthMode === "even" ? "even" : "manual",
        };
      }
    }
  } catch {
    // Corrupt storage falls through to the legacy fallback.
  }
  try {
    return readLegacyGlobalTreeWidth();
  } catch {
    return null;
  }
}

function persistGlobalTreeWidth(treeWidth: number | null, treeWidthMode: WorkspaceTreeWidthMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    const envelope: PersistedGlobalTreeWidth = { treeWidth, treeWidthMode, updatedAt: Date.now() };
    localStorage.setItem(GLOBAL_TREE_WIDTH_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage can be disabled or full; the in-memory state still works.
  }
}

// ── public API (unchanged surface, conversation-scoped storage) ─────────────

export function workspaceTreeVisitId(memoryKey: string): number {
  if (activeWorkspaceTreeKey !== memoryKey) {
    activeWorkspaceTreeKey = memoryKey;
    workspaceTreeVisitSequence += 1;
  }
  return workspaceTreeVisitSequence;
}

export function readWorkspaceTreeMemory(memoryKey: string): WorkspaceTreeMemorySnapshot | null {
  const cached = workspaceTreeMemory.get(memoryKey);
  if (cached) return cloneSnapshot(cached);
  if (memoryKey === GLOBAL_TREE_WIDTH_KEY) {
    const global = readPersistedGlobalTreeWidth();
    if (!global) return null;
    const snapshot = { ...defaultSnapshot(), treeWidth: global.treeWidth, treeWidthMode: global.treeWidthMode };
    workspaceTreeMemory.set(memoryKey, snapshot);
    return cloneSnapshot(snapshot);
  }
  const { conversationKey, dockTabId } = splitMemoryKey(memoryKey);
  const state = readWorkspaceNavigation(conversationKey, dockTabId);
  if (!state) return null;
  const snapshot = snapshotFromPersisted(state, workspaceTreeVisitId(memoryKey));
  workspaceTreeMemory.set(memoryKey, snapshot);
  return cloneSnapshot(snapshot);
}

export function rememberWorkspaceTreeState(
  memoryKey: string,
  patch: Partial<Omit<WorkspaceTreeMemorySnapshot, "openDirs">> & { openDirs?: ReadonlySet<string> },
): void {
  const current = workspaceTreeMemory.get(memoryKey) ?? readWorkspaceTreeMemory(memoryKey) ?? defaultSnapshot();
  const next: WorkspaceTreeMemorySnapshot = {
    ...current,
    ...patch,
    openDirs: patch.openDirs ? new Set(patch.openDirs) : new Set(current.openDirs),
  };
  workspaceTreeMemory.set(memoryKey, next);
  // An immediate state write already includes the latest in-memory scroll
  // position, so retire any trailing scroll write instead of duplicating it.
  deferredScrollPersistence.cancel();
  if (memoryKey === GLOBAL_TREE_WIDTH_KEY) {
    persistGlobalTreeWidth(next.treeWidth, next.treeWidthMode);
    return;
  }
  const { conversationKey, dockTabId } = splitMemoryKey(memoryKey);
  writeWorkspaceNavigation(conversationKey, dockTabId, {
    openDirs: Array.from(next.openDirs),
    selectedFilePath: next.selectedFilePath,
    selectedChangePath: next.selectedChangePath,
    scrollTop: next.scrollTop,
    recentPaths: next.recentPaths,
  });
}

export function rememberWorkspaceTreeScroll(memoryKey: string, scrollTop: number): void {
  const current = workspaceTreeMemory.get(memoryKey) ?? readWorkspaceTreeMemory(memoryKey) ?? defaultSnapshot();
  workspaceTreeMemory.set(memoryKey, {
    ...current,
    openDirs: new Set(current.openDirs),
    scrollTop: Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : current.scrollTop,
  });
  deferredScrollPersistence.schedule(memoryKey);
}

export function flushWorkspaceTreeMemory(): void {
  deferredScrollPersistence.flush();
}

export function rememberWorkspaceTreeOpenDirs(memoryKey: string, openDirs: ReadonlySet<string>, visitId: number): void {
  rememberWorkspaceTreeState(memoryKey, { openDirs, visitId });
}

export function touchWorkspaceTreeVisit(memoryKey: string, visitId: number): void {
  const current = workspaceTreeMemory.get(memoryKey) ?? readWorkspaceTreeMemory(memoryKey) ?? defaultSnapshot();
  workspaceTreeMemory.set(memoryKey, { ...current, openDirs: new Set(current.openDirs), visitId });
}

export function resetWorkspaceTreeMemoryForTests(): void {
  deferredScrollPersistence.cancel();
  workspaceTreeMemory.clear();
  activeWorkspaceTreeKey = "";
  workspaceTreeVisitSequence = 0;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(GLOBAL_TREE_WIDTH_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures in test environments.
  }
}

// The scroll scheduler flushes only the coalesced key's cached scrollTop into
// the conversation envelope — never the whole map.
const deferredScrollPersistence = createWorkspaceTreePersistenceScheduler((memoryKey) => {
  if (memoryKey === GLOBAL_TREE_WIDTH_KEY) return;
  const cached = workspaceTreeMemory.get(memoryKey);
  if (!cached) return;
  const { conversationKey, dockTabId } = splitMemoryKey(memoryKey);
  writeWorkspaceNavigation(conversationKey, dockTabId, { scrollTop: cached.scrollTop });
});

// Legacy migration context for workspace navigation (registered by App via
// the store hook — see registerConversationDockLegacyContext). Re-exported so
// callers that register the dock context also cover navigation seeding.
export { registerConversationDockLegacyContext };
