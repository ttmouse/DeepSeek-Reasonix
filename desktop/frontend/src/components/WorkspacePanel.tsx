import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderTree,
  FolderX,
  GitBranch,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { asArray } from "../lib/array";
import { app } from "../lib/bridge";
import { useT } from "../lib/i18n";
import {
  clampWorkspaceSplitTreeWidth,
  initialWorkspaceSplitTreeWidth,
  resolveWorkspaceSplitTreeWidth,
  shouldInitializeWorkspaceSplitOnFileSelect,
  type WorkspaceSplitTreeWidthMode,
  workspaceSplitCanFit,
  workspaceSplitTreeWidthFromPointer,
} from "../lib/workspaceSplit";
import { createRafResizeUpdater } from "../lib/resizeDrag";
import { useWorkspaceRefresh } from "../lib/workspaceRefreshStore";
import { useWorkspaceRefreshInvalidation, workspaceRefreshFallbackSequence } from "../lib/workspaceRefreshInvalidation";
import { createWorkspaceRefreshScheduler } from "../lib/workspaceRefreshScheduler";
import { shouldScrollWorkspaceTreeSelection } from "../lib/workspaceTreeReveal";
import { mergeWorkspaceSearchResults } from "../lib/workspaceTreeSearch";
import {
  readWorkspaceTreeMemory,
  rememberWorkspaceTreeOpenDirs,
  touchWorkspaceTreeVisit,
  workspaceTreeVisitId,
} from "../lib/workspaceTreeMemory";
import type {
  DirEntry,
  FilePreview,
  GitCommitView,
  GitCommitDetailView,
  RewindResultView,
  WorkspaceChangeDetailView,
  WireCompletionSummary,
} from "../lib/types";
import { workspaceGitStatusLabel } from "../lib/workspaceChanges";
import { useWorkspaceChangesResource } from "../lib/useWorkspaceChangesResource";
import {
  completionGapLabel,
  completionReviewLabel,
  completionVerdictLabel,
} from "../lib/completionSummaryDisplay";
import { completionSummaryNeedsAttention } from "../lib/completionSummary";
import { formatWorkspaceReference, WORKSPACE_REF_DRAG_TYPE } from "../lib/workspaceDrag";
import { formatSelectionReference, languageFor } from "../lib/selectedTextContext";
import { cleanGitDiff } from "../lib/diff";
import { CodeViewer } from "./CodeViewer";
import { DiffView } from "./DiffView";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuItem, type ContextMenuPoint } from "./ContextMenu";
import { FloatingMenu, FloatingMenuItems } from "./FloatingMenu";
import { Markdown } from "./Markdown";
import { Tooltip } from "./Tooltip";
import { AnchoredPopover } from "./AnchoredPopover";
import { WorkspaceFileIcon } from "./WorkspaceFileIcon";
import { WorkspaceTreeMenu } from "./WorkspaceTreeMenu";

const WORKSPACE_TREE_MIN_WIDTH = 140;
const WORKSPACE_TREE_DEFAULT_WIDTH = 250;
const WORKSPACE_PREVIEW_MIN_WIDTH = 140;
const WORKSPACE_PREVIEW_TARGET_WIDTH = 360;
const WORKSPACE_DUAL_PANEL_TARGET_WIDTH = WORKSPACE_TREE_DEFAULT_WIDTH + WORKSPACE_PREVIEW_TARGET_WIDTH;
const WORKSPACE_CONTEXT_MENU_SELECTION_HEIGHT = 48;
const WORKSPACE_MAX_PREVIEW_TABS = 5;

// WorkspacePanel is unmounted when the dock switches tabs (context/files/
// changed), and the app restarts. Persist the tree width and the last opened
// file so both survive: keyed by the workspace memory key so different
// projects/sessions keep their own layout and open file.
const WORKSPACE_TREE_WIDTH_KEY = "workspacePanel:treeWidth";
const WORKSPACE_SELECTED_PATH_KEY = "workspacePanel:selectedPath";
const WORKSPACE_TREE_SCROLL_KEY = "workspacePanel:treeScroll";
// Independent "recently opened" history, kept separate from the live preview
// tabs so closing all previews does not wipe the recent-files menu.
const WORKSPACE_RECENT_PATHS_KEY = "workspacePanel:recentPaths";

// Session-level cache that survives WorkspacePanel unmounting when the dock
// switches between context / files / changed tabs. The dock renders a single
// active panel, so switching tabs unmounts this component; without a module
// cache the opened file, tree width and scroll position would reset on every
// tab switch.
const workspacePanelSession = new Map<string, { treeWidth?: number; selectedPath?: string | null; scrollTop?: number }>();

function readWorkspacePanelPreference<T>(key: string, memoryKey: string): T | null {
  try {
    const raw = localStorage.getItem(`${key}:${memoryKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeWorkspacePanelPreference(key: string, memoryKey: string, value: unknown): void {
  try {
    localStorage.setItem(`${key}:${memoryKey}`, JSON.stringify(value));
  } catch {
    /* ignore quota / storage failures */
  }
}

function rememberWorkspacePanelSession(
  memoryKey: string,
  patch: { treeWidth?: number; selectedPath?: string | null; scrollTop?: number },
): void {
  const current = workspacePanelSession.get(memoryKey) ?? {};
  workspacePanelSession.set(memoryKey, { ...current, ...patch });
}

type WorkspaceRevealRequest = { id: number; path: string };
type WorkspaceFileListRequest = { id: number; paths: string[] };
type WorkspaceChangeListEntry = { key: string; path: string; meta: string; time: string; detail: string };
type WorkspaceChangeListRequest = { id: number; changes: WorkspaceChangeListEntry[] };

function clampWorkspaceTreeWidth(width: number, panelWidth?: number): number {
  return clampWorkspaceSplitTreeWidth({
    width,
    panelWidth,
    treeMinWidth: WORKSPACE_TREE_MIN_WIDTH,
    previewMinWidth: WORKSPACE_PREVIEW_MIN_WIDTH,
  });
}

function entryPath(dir: string, entry: DirEntry): string {
  const prefix = dir === "" || dir.endsWith("/") ? dir : dir + "/";
  return prefix + entry.name + (entry.isDir ? "/" : "");
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parentPath(path: string): string {
  const clean = path.replace(/\/$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

// Push a path to the front of a bounded MRU list (dedup + cap), used by both
// the live preview tabs and the recent-files history.
function pushRecentPath(paths: string[], path: string): string[] {
  return [...paths.filter((tab) => tab !== path), path].slice(-WORKSPACE_MAX_PREVIEW_TABS);
}

function parentDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [""];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc += parts[i] + "/";
    dirs.push(acc);
  }
  return dirs;
}

function topLevelDirPath(path: string): string {
  const first = path.split("/").find(Boolean);
  return first ? `${first}/` : "";
}

function renderMediaPreview(preview: FilePreview): ReactElement | null {
  if (!preview.url) return null;
  if (preview.kind === "image") {
    return (
      <div className="workspace-media workspace-media--image">
        <img src={preview.url} alt={basename(preview.path)} decoding="async" draggable={false} />
      </div>
    );
  }
  if (preview.kind === "pdf") {
    return (
      <iframe
        className="workspace-media workspace-media--pdf"
        src={preview.url}
        title={basename(preview.path)}
      />
    );
  }
  return null;
}

function formatCommitDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}
interface TreeRow {
  key: string;
  path: string;
  depth: number;
  entry: DirEntry;
  active: boolean;
  isOpen?: boolean;
  isSearch?: boolean;
  compactPaths?: string[];
  displayName?: string;
}

export function WorkspacePanel({
  open,
  tabId,
  cwd,
  maximized,
  panelWidth,
  onClose,
  onToggleMaximized,
  onPreviewModeChange,
  onAddToChat,
  onAddCodeToChat,
  onOpenInTerminal,
  onRequestPanelWidth,
  onFileTreeRefresh,
  onSessionRevertCommitted,
  dockTreeWidth,
  dockPreviewWidth,
  onRestoreDockWidths,
  initialViewMode = "files",
  revealPathRequest,
  changeRevealRequest,
  fileListRequest,
  changeListRequest,
  showViewTabs = true,
  workspaceScopeKey: workspaceScopeKeyProp,
  workspaceMemoryKey: workspaceMemoryKeyProp,
  workspaceMemoryVisitId: workspaceMemoryVisitIdProp,
  creationMode = false,
  completionSummary,
}: {
  open: boolean;
  tabId?: string;
  cwd?: string;
  maximized: boolean;
  panelWidth?: number;
  onClose: () => void;
  onToggleMaximized: () => void;
  onPreviewModeChange?: (active: boolean) => void;
  onAddToChat?: (text: string) => void;
  onAddCodeToChat?: (path: string, code: string) => void;
  onOpenInTerminal?: (path: string) => void;
  onRequestPanelWidth?: (width: number) => void;
  onFileTreeRefresh?: () => void;
  onSessionRevertCommitted?: (tabId: string, result: RewindResultView) => void;
  dockTreeWidth?: number;
  dockPreviewWidth?: number;
  onRestoreDockWidths?: (treeWidth: number, previewWidth: number) => void;
  initialViewMode?: "files" | "changed";
  revealPathRequest?: WorkspaceRevealRequest | null;
  changeRevealRequest?: WorkspaceRevealRequest | null;
  fileListRequest?: WorkspaceFileListRequest | null;
  changeListRequest?: WorkspaceChangeListRequest | null;
  showViewTabs?: boolean;
  workspaceScopeKey?: string;
  workspaceMemoryKey?: string;
  workspaceMemoryVisitId?: number;
  creationMode?: boolean;
  completionSummary?: WireCompletionSummary;
}) {
  const t = useT();
  const workspaceTabId = tabId ?? "";
  const workspaceScopeKey = workspaceScopeKeyProp ?? `${workspaceTabId}\u0000${cwd ?? ""}`;
  const workspaceMemoryKey = workspaceMemoryKeyProp ?? workspaceScopeKey;
  const workspaceMemoryVisitId = workspaceMemoryVisitIdProp ?? workspaceTreeVisitId(workspaceMemoryKey);
  const workspaceRefresh = useWorkspaceRefresh(workspaceTabId, workspaceScopeKey, open);
  const {
    workspaceChanges,
    loadingWorkspaceChanges,
    workspaceChangesErr,
    loadWorkspaceChanges,
    resetWorkspaceChanges,
  } = useWorkspaceChangesResource(workspaceTabId, workspaceScopeKey, workspaceRefresh.revisions.workingTree);
  const initialWorkspaceMemory = readWorkspaceTreeMemory(workspaceMemoryKey);
  const panelRef = useRef<HTMLElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const [entriesByDir, setEntriesByDir] = useState<Record<string, DirEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(
    () => new Set(initialWorkspaceMemory?.openDirs ?? [""]),
  );
  const [revealedRootPaths, setRevealedRootPaths] = useState<Set<string> | null>(
    () => initialWorkspaceMemory && initialWorkspaceMemory.visitId !== workspaceMemoryVisitId ? new Set() : null,
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(() => {
    const session = workspacePanelSession.get(workspaceMemoryKey);
    if (session && session.selectedPath !== undefined) return session.selectedPath;
    const saved = readWorkspacePanelPreference<string>(WORKSPACE_SELECTED_PATH_KEY, workspaceMemoryKey);
    return saved && typeof saved === "string" ? saved : null;
  });
  const [selectedChange, setSelectedChange] = useState<{ scopeKey: string; path: string } | null>(null);
  const selectedChangePath = selectedChange?.scopeKey === workspaceScopeKey ? selectedChange.path : null;
  const setSelectedChangePath = useCallback((path: string | null) => {
    setSelectedChange(path ? { scopeKey: workspaceScopeKey, path } : null);
  }, [workspaceScopeKey]);
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    const session = workspacePanelSession.get(workspaceMemoryKey);
    if (session && session.selectedPath) return [session.selectedPath];
    const saved = readWorkspacePanelPreference<string>(WORKSPACE_SELECTED_PATH_KEY, workspaceMemoryKey);
    return saved && typeof saved === "string" ? [saved] : [];
  });
  // Recently opened files menu: an independent history that survives closing
  // all preview tabs (openTabs above is the live preview state).
  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    const saved = readWorkspacePanelPreference<string[]>(WORKSPACE_RECENT_PATHS_KEY, workspaceMemoryKey);
    return Array.isArray(saved) ? saved.slice(0, WORKSPACE_MAX_PREVIEW_TABS) : [];
  });
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [viewMode, setViewMode] = useState<"files" | "changed">(initialViewMode);
  // Both creation and regular workspaces use the same three-layer change view;
  // keep the prop in the seam for older callers while making history collapsed
  // by default everywhere.
  const groupedChangesLayout = creationMode !== false || viewMode === "changed";
  const [gitHistory, setGitHistory] = useState<GitCommitView[]>([]);
  const [changeDetail, setChangeDetail] = useState<WorkspaceChangeDetailView | null>(null);
  const [loadingChangeDetail, setLoadingChangeDetail] = useState(false);
  const [changeDetailErr, setChangeDetailErr] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetailView | null>(null);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string; path: string } | null>(null);
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  const [treeBlankMenuPoint, setTreeBlankMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [filter, setFilter] = useState("");
  const [searchResults, setSearchResults] = useState<DirEntry[] | null>(null);
  const [scopedFilePaths, setScopedFilePaths] = useState<string[] | null>(null);
  const [scopedChangeRows, setScopedChangeRows] = useState<WorkspaceChangeListEntry[] | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const session = workspacePanelSession.get(workspaceMemoryKey);
    if (session && session.treeWidth != null) return clampWorkspaceTreeWidth(session.treeWidth);
    const saved = readWorkspacePanelPreference<number>(WORKSPACE_TREE_WIDTH_KEY, workspaceMemoryKey);
    return saved != null && Number.isFinite(saved) ? clampWorkspaceTreeWidth(saved) : WORKSPACE_TREE_DEFAULT_WIDTH;
  });
  const [treeWidthMode, setTreeWidthMode] = useState<WorkspaceSplitTreeWidthMode>("manual");
  const [treeResizing, setTreeResizing] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [codeSearchRequestPending, setCodeSearchRequestPending] = useState(false);
  const [codeSearchRequestPath, setCodeSearchRequestPath] = useState<string | null>(null);
  /** Changes overview: commit history is secondary and starts collapsed. */
  const [commitHistoryOpen, setCommitHistoryOpen] = useState(false);
  const lastPreviewModeActiveRef = useRef<boolean | null>(null);
  const lastRevealRequestIdRef = useRef<number | null>(null);
  const dismissedRevealRequestIdRef = useRef<number | null>(null);
  const lastChangeRevealRequestIdRef = useRef<number | null>(null);
  const dismissedChangeRevealRequestIdRef = useRef<number | null>(null);
  const lastFileListRequestIdRef = useRef<number | null>(null);
  const dismissedFileListRequestIdRef = useRef<number | null>(null);
  const lastChangeListRequestIdRef = useRef<number | null>(null);
  const dismissedChangeListRequestIdRef = useRef<number | null>(null);
  const currentWorkspaceScopeKeyRef = useRef(workspaceScopeKey);
  const lastWorkspaceScopeKeyRef = useRef(workspaceScopeKey);
  const changeDetailRequestIdRef = useRef(0);
  const gitHistoryRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const commitDetailRequestIdRef = useRef(0);
  const dirLoadGenerationRef = useRef(0);
  const dirLoadRequestIdsRef = useRef<Record<string, number>>({});
  const compactProbeInFlightRef = useRef(new Set<string>());
  const recentAnchorRef = useRef<HTMLButtonElement>(null);
  const openDirsRef = useRef(openDirs);
  const pendingTreeRevealPathRef = useRef<string | null>(null);
  const workingTreeRefreshSchedulerRef = useRef<ReturnType<typeof createWorkspaceRefreshScheduler> | null>(null);
  const gitMetaRefreshSchedulerRef = useRef<ReturnType<typeof createWorkspaceRefreshScheduler> | null>(null);
  if (!workingTreeRefreshSchedulerRef.current) {
    workingTreeRefreshSchedulerRef.current = createWorkspaceRefreshScheduler(300);
  }
  if (!gitMetaRefreshSchedulerRef.current) {
    gitMetaRefreshSchedulerRef.current = createWorkspaceRefreshScheduler(750);
  }
  currentWorkspaceScopeKeyRef.current = workspaceScopeKey;

  useEffect(() => {
    openDirsRef.current = openDirs;
  }, [openDirs]);

  const updateOpenDirs = useCallback(
    (update: (previous: ReadonlySet<string>) => Set<string>) => {
      setOpenDirs((previous) => {
        const next = update(previous);
        rememberWorkspaceTreeOpenDirs(workspaceMemoryKey, next, workspaceMemoryVisitId);
        return next;
      });
    },
    [workspaceMemoryKey, workspaceMemoryVisitId],
  );

  useEffect(() => {
    const remembered = readWorkspaceTreeMemory(workspaceMemoryKey);
    const nextOpenDirs = new Set(remembered?.openDirs ?? [""]);
    setOpenDirs(nextOpenDirs);
    openDirsRef.current = nextOpenDirs;
    setRevealedRootPaths(remembered && remembered.visitId !== workspaceMemoryVisitId ? new Set() : null);
    if (remembered) touchWorkspaceTreeVisit(workspaceMemoryKey, workspaceMemoryVisitId);
    else rememberWorkspaceTreeOpenDirs(workspaceMemoryKey, nextOpenDirs, workspaceMemoryVisitId);
    // Restore the persisted dock widths owned by the app shell (upstream
    // integration): tree and preview widths are remembered per project.
    if (dockTreeWidth != null || dockPreviewWidth != null) {
      onRestoreDockWidths?.(dockTreeWidth ?? WORKSPACE_TREE_DEFAULT_WIDTH, dockPreviewWidth ?? 0);
    }
  }, [workspaceMemoryKey, workspaceMemoryVisitId, dockTreeWidth, dockPreviewWidth, onRestoreDockWidths]);

  const loadDir = useCallback(async (dir: string) => {
    const requestTabId = workspaceTabId;
    const requestScopeKey = workspaceScopeKey;
    const generation = dirLoadGenerationRef.current;
    const requestId = (dirLoadRequestIdsRef.current[dir] ?? 0) + 1;
    dirLoadRequestIdsRef.current[dir] = requestId;
    const entries = asArray(await app.ListDirForTab(requestTabId, dir).catch((): DirEntry[] => []));
    if (
      currentWorkspaceScopeKeyRef.current !== requestScopeKey ||
      dirLoadGenerationRef.current !== generation ||
      dirLoadRequestIdsRef.current[dir] !== requestId
    ) return null;
    setEntriesByDir((prev) => ({ ...prev, [dir]: entries }));
    return entries;
  }, [workspaceScopeKey, workspaceTabId]);

  const loadGitHistory = useCallback(async () => {
    const requestId = ++gitHistoryRequestIdRef.current;
    const requestTabId = workspaceTabId;
    const requestScopeKey = workspaceScopeKey;
    setLoadingHistory(true);
    try {
      const result = await app.WorkspaceGitHistory(requestTabId, selectedChangePath || "");
      if (gitHistoryRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setGitHistory(result || []);
      }
    } catch (err) {
      if (gitHistoryRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setGitHistory([]);
      }
    } finally {
      if (gitHistoryRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setLoadingHistory(false);
      }
    }
  }, [selectedChangePath, workspaceScopeKey, workspaceTabId]);

  const loadChangeDetail = useCallback(async () => {
    const requestId = ++changeDetailRequestIdRef.current;
    const requestTabId = workspaceTabId;
    const requestScopeKey = workspaceScopeKey;
    const requestPath = selectedChangePath;
    if (!requestPath) {
      setChangeDetail(null);
      setChangeDetailErr("");
      setLoadingChangeDetail(false);
      return;
    }
    setLoadingChangeDetail(true);
    setChangeDetailErr("");
    try {
      const detail = await app.WorkspaceChangeDetail(requestTabId, requestPath);
      if (changeDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setChangeDetail(detail ?? null);
      }
    } catch (err) {
      if (changeDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setChangeDetail(null);
        setChangeDetailErr(String((err as { message?: unknown })?.message ?? err));
      }
    } finally {
      if (changeDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
        setLoadingChangeDetail(false);
      }
    }
  }, [selectedChangePath, workspaceScopeKey, workspaceTabId]);

  const toggleCommit = useCallback((hash: string) => {
    setExpandedCommit((prev) => {
      const next = prev === hash ? null : hash;
      if (next) onRequestPanelWidth?.(WORKSPACE_DUAL_PANEL_TARGET_WIDTH);
      return next;
    });
  }, [onRequestPanelWidth]);

  useEffect(() => {
    if (!open) return;
    if (expandedCommit) {
      const requestId = ++commitDetailRequestIdRef.current;
      const requestTabId = workspaceTabId;
      const requestScopeKey = workspaceScopeKey;
      let live = true;
      setLoadingCommit(true);
      app
        .WorkspaceGitCommitDetail(requestTabId, expandedCommit, selectedChangePath || "")
        .then((detail) => {
          if (live && commitDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
            setCommitDetail(detail);
          }
        })
        .catch(() => {
          if (live && commitDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
            setCommitDetail(null);
          }
        })
        .finally(() => {
          if (live && commitDetailRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
            setLoadingCommit(false);
          }
        });
      return () => {
        live = false;
      };
    } else {
      commitDetailRequestIdRef.current += 1;
      setCommitDetail(null);
    }
  }, [expandedCommit, selectedChangePath, open, workspaceScopeKey, workspaceTabId]);

  const selectFile = useCallback(
    (path: string) => {
      const initializeSplit = shouldInitializeWorkspaceSplitOnFileSelect({
        previewVisible: openTabs.length > 0 || selectedFilePath !== null,
        treeVisible,
      });
      if (initializeSplit) {
        // Preserve a user-resized (manual) tree width: only first-time splits
        // (no saved width yet) default to an even 50/50 division. Reopening a
        // file after closing its preview must keep the remembered width, not
        // snap back to the initial split.
        setTreeWidth(initialWorkspaceSplitTreeWidth({
          panelWidth,
          savedTreeWidth: treeWidthMode === "manual" ? treeWidth : null,
          treeMinWidth: WORKSPACE_TREE_MIN_WIDTH,
          previewMinWidth: WORKSPACE_PREVIEW_MIN_WIDTH,
        }));
        setTreeWidthMode("even");
      }
      pendingTreeRevealPathRef.current = path;
      setSelectedFilePath(path);
      setScopedFilePaths((current) => {
        if (current) dismissedFileListRequestIdRef.current = lastFileListRequestIdRef.current;
        return null;
      });
      setScopedChangeRows((current) => {
        if (current) dismissedChangeListRequestIdRef.current = lastChangeListRequestIdRef.current;
        return null;
      });
      setFilter("");
      setOpenTabs((tabs) => pushRecentPath(tabs, path));
      setRecentPaths((paths) => pushRecentPath(paths, path));
      const dirs = parentDirs(path);
      updateOpenDirs((prev) => new Set([...Array.from(prev), ...dirs]));
      dirs.forEach((dir) => void loadDir(dir));
    },
    [loadDir, openTabs.length, panelWidth, selectedFilePath, treeVisible, treeWidth, treeWidthMode, updateOpenDirs],
  );

  const selectChange = useCallback((path: string) => {
    setSelectedChangePath(path);
    setExpandedCommit(null);
    setCommitDetail(null);
  }, [setSelectedChangePath]);

  useEffect(() => {
    if (!open) return;
    dirLoadGenerationRef.current += 1;
    dirLoadRequestIdsRef.current = {};
    compactProbeInFlightRef.current.clear();
    setEntriesByDir({});
    setGitHistory([]);
    changeDetailRequestIdRef.current += 1;
    setChangeDetail(null);
    setChangeDetailErr("");
    setLoadingChangeDetail(false);
    setExpandedCommit(null);
    setCommitDetail(null);
    setSelectionMenu(null);
    setTreeMenu(null);
    setFilter("");
    setScopedFilePaths(null);
    setScopedChangeRows(null);
    setTreeVisible(true);
    void loadDir("");
    // Preload every remembered expanded directory so the tree grows back to
    // its previous height right away. Without this, switching to 概览 and back
    // remounts the panel with only the root level loaded; the restored scroll
    // position stays pending forever because the tree never grows tall enough
    // to reach it (deep dirs would only load on demand via probe/click).
    const remembered = readWorkspaceTreeMemory(workspaceMemoryKey);
    remembered?.openDirs.forEach((dir) => {
      if (dir !== "") void loadDir(dir);
    });
  }, [cwd, loadDir, open, workspaceMemoryKey]);

  useEffect(() => {
    if (!open) return;
    if (lastWorkspaceScopeKeyRef.current === workspaceScopeKey) return;
    lastWorkspaceScopeKeyRef.current = workspaceScopeKey;
    workingTreeRefreshSchedulerRef.current?.cancel();
    gitMetaRefreshSchedulerRef.current?.cancel();
    resetWorkspaceChanges();
    changeDetailRequestIdRef.current += 1;
    gitHistoryRequestIdRef.current += 1;
    commitDetailRequestIdRef.current += 1;
    setChangeDetail(null);
    setChangeDetailErr("");
    setLoadingChangeDetail(false);
    setGitHistory([]);
    setCommitHistoryOpen(false);
    setExpandedCommit(null);
    setCommitDetail(null);
    setScopedChangeRows(null);
    setSelectedChangePath(null);
    lastChangeRevealRequestIdRef.current = null;
    dismissedChangeRevealRequestIdRef.current = null;
    lastChangeListRequestIdRef.current = null;
    dismissedChangeListRequestIdRef.current = null;
    // Scope switch resets change-view data; the file preview (selectedFilePath/
    // openTabs) belongs to the files view and must survive tab switches.
  }, [open, viewMode, workspaceScopeKey]);

  useEffect(() => () => {
    workingTreeRefreshSchedulerRef.current?.cancel();
    gitMetaRefreshSchedulerRef.current?.cancel();
  }, []);

  // A tab/scope switch must discard the floating menus: their text and paths
  // were captured from the previous scope, while add-to-chat routes to
  // whatever tab is active at click time — a menu surviving a keyboard tab
  // switch would add the old scope's selection to the new session.
  useEffect(() => {
    setSelectionMenu(null);
    setTreeMenu(null);
    setTreeBlankMenuPoint(null);
  }, [tabId, workspaceScopeKey]);

  useEffect(() => {
    if (!open) return;
    setViewMode(initialViewMode);
    setCommitHistoryOpen(false);
    setExpandedCommit(null);
    setCommitDetail(null);
    changeDetailRequestIdRef.current += 1;
    setChangeDetail(null);
    setChangeDetailErr("");
    setLoadingChangeDetail(false);
    setSelectionMenu(null);
    setTreeMenu(null);
    setRecentOpen(false);
    if (initialViewMode === "changed") {
      setScopedFilePaths(null);
      setSelectedChangePath(null);
      return;
    }
    setScopedChangeRows(null);
    setTreeVisible(true);
  }, [initialViewMode, open]);

  useEffect(() => {
    if (!open || fileListRequest) return;
    lastFileListRequestIdRef.current = null;
    dismissedFileListRequestIdRef.current = null;
    setScopedFilePaths(null);
  }, [fileListRequest, open]);

  useEffect(() => {
    if (!open || !fileListRequest) return;
    const paths = Array.from(new Set(fileListRequest.paths.map((path) => path.trim()).filter(Boolean)));
    const scopedPathsSettled =
      scopedFilePaths !== null &&
      scopedFilePaths.length === paths.length &&
      scopedFilePaths.every((path, index) => path === paths[index]);
    if (dismissedFileListRequestIdRef.current === fileListRequest.id) return;
    if (lastFileListRequestIdRef.current === fileListRequest.id && viewMode === "files" && scopedPathsSettled) return;
    lastFileListRequestIdRef.current = fileListRequest.id;
    dismissedFileListRequestIdRef.current = null;
    if (paths.length === 0) {
      setScopedFilePaths(null);
      return;
    }
    setViewMode("files");
    setTreeVisible(true);
    setScopedFilePaths(paths);
    setSelectedFilePath(null);
    setOpenTabs([]);
    setPreview(null);
    setFilter("");
    setExpandedCommit(null);
    setCommitDetail(null);
    setSelectionMenu(null);
    setTreeMenu(null);
    const dirs = Array.from(new Set(paths.flatMap(parentDirs)));
    updateOpenDirs((prev) => new Set([...Array.from(prev), ...dirs]));
    dirs.forEach((dir) => void loadDir(dir));
  }, [fileListRequest, loadDir, open, scopedFilePaths, updateOpenDirs, viewMode]);

  useEffect(() => {
    if (!open || changeListRequest) return;
    lastChangeListRequestIdRef.current = null;
    dismissedChangeListRequestIdRef.current = null;
    setScopedChangeRows(null);
  }, [changeListRequest, open]);

  useEffect(() => {
    if (!open || !changeListRequest) return;
    const changes = changeListRequest.changes
      .map((change) => ({ ...change, path: change.path.trim() }))
      .filter((change) => change.path.length > 0);
    const scopedChangesSettled =
      scopedChangeRows !== null &&
      scopedChangeRows.length === changes.length &&
      scopedChangeRows.every((change, index) => change.path === changes[index]?.path);
    if (dismissedChangeListRequestIdRef.current === changeListRequest.id) return;
    if (lastChangeListRequestIdRef.current === changeListRequest.id && viewMode === "changed" && scopedChangesSettled) return;
    lastChangeListRequestIdRef.current = changeListRequest.id;
    dismissedChangeListRequestIdRef.current = null;
    if (changes.length === 0) {
      setScopedChangeRows(null);
      return;
    }
    setViewMode("changed");
    setScopedChangeRows(changes);
    setScopedFilePaths(null);
    setSelectedChangePath(null);
    setFilter("");
    setExpandedCommit(null);
    setCommitDetail(null);
    setSelectionMenu(null);
    setTreeMenu(null);
  }, [changeListRequest, open, scopedChangeRows, viewMode]);

  useEffect(() => {
    if (!open || revealPathRequest) return;
    lastRevealRequestIdRef.current = null;
    dismissedRevealRequestIdRef.current = null;
  }, [open, revealPathRequest]);

  useEffect(() => {
    if (!open || !revealPathRequest) return;
    if (dismissedRevealRequestIdRef.current === revealPathRequest.id) return;
    if (
      lastRevealRequestIdRef.current === revealPathRequest.id &&
      selectedFilePath === revealPathRequest.path &&
      viewMode === "files"
    ) {
      return;
    }
    lastRevealRequestIdRef.current = revealPathRequest.id;
    dismissedRevealRequestIdRef.current = null;
    setViewMode("files");
    setTreeVisible(true);
    setScopedFilePaths(null);
    setScopedChangeRows(null);
    setExpandedCommit(null);
    setCommitDetail(null);
    selectFile(revealPathRequest.path);
  }, [open, revealPathRequest, selectFile, selectedFilePath, viewMode]);

  useEffect(() => {
    if (!open || changeRevealRequest) return;
    lastChangeRevealRequestIdRef.current = null;
    dismissedChangeRevealRequestIdRef.current = null;
  }, [changeRevealRequest, open]);

  useEffect(() => {
    if (!open || !changeRevealRequest) return;
    if (dismissedChangeRevealRequestIdRef.current === changeRevealRequest.id) return;
    if (
      lastChangeRevealRequestIdRef.current === changeRevealRequest.id &&
      selectedChangePath === changeRevealRequest.path &&
      viewMode === "changed"
    ) {
      return;
    }
    lastChangeRevealRequestIdRef.current = changeRevealRequest.id;
    dismissedChangeRevealRequestIdRef.current = null;
    setViewMode("changed");
    setScopedFilePaths(null);
    setScopedChangeRows(null);
    setSelectedChangePath(changeRevealRequest.path);
    setFilter("");
    setExpandedCommit(null);
    setCommitDetail(null);
    setSelectionMenu(null);
    setTreeMenu(null);
  }, [changeRevealRequest, open, selectedChangePath, viewMode]);

  useEffect(() => {
    if (!open) return;
    if (viewMode === "changed") {
      void loadWorkspaceChanges();
      if (selectedChangePath) void loadChangeDetail();
      if (commitHistoryOpen) void loadGitHistory();
    } else {
      changeDetailRequestIdRef.current += 1;
      setChangeDetail(null);
      setChangeDetailErr("");
      setLoadingChangeDetail(false);
    }
  }, [commitHistoryOpen, selectedChangePath, viewMode, loadChangeDetail, loadGitHistory, loadWorkspaceChanges, open]);

  useEffect(() => {
    if (!selectionMenu && !treeMenu) return;
    const close = () => {
      setSelectionMenu(null);
      setTreeMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // Dismiss on mousedown rather than click: the trailing click a drag-selection
    // emits would otherwise close the toolbar the instant mouseup opens it. A fresh
    // mousedown only fires when the user starts another interaction, and FloatingMenu
    // stops propagation so pressing its buttons never counts as an outside press.
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectionMenu, treeMenu]);

  const refreshWorkspaceList = useCallback(() => {
    setTreeBlankMenuPoint(null);
    setSelectionMenu(null);
    setTreeMenu(null);
    if (viewMode === "changed") {
      workingTreeRefreshSchedulerRef.current?.cancel();
      gitMetaRefreshSchedulerRef.current?.cancel();
      void loadWorkspaceChanges();
      if (selectedChangePath) void loadChangeDetail();
      // Manual refresh is the explicit escape hatch and includes collapsed
      // history even when ordinary file writes do not.
      void loadGitHistory();
      return;
    }
    onFileTreeRefresh?.();
    const dirs = Array.from(openDirsRef.current);
    dirs.forEach((dir) => void loadDir(dir));
  }, [loadChangeDetail, loadGitHistory, loadWorkspaceChanges, loadDir, onFileTreeRefresh, selectedChangePath, viewMode]);

  const refreshSelected = useCallback(() => {
    if (!selectedFilePath) return;
    const requestId = ++previewRequestIdRef.current;
    const requestScopeKey = workspaceScopeKey;
    let live = true;
    setLoadingPreview(true);
    app
      .ReadFileForTab(workspaceTabId, selectedFilePath)
      .then((next) => {
        if (live && previewRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) setPreview(next);
      })
      .catch((err) => {
        if (live && previewRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) {
          setPreview({
            path: selectedFilePath,
            body: "",
            size: 0,
            truncated: false,
            binary: false,
            err: String(err?.message ?? err),
          });
        }
      })
      .finally(() => {
        if (live && previewRequestIdRef.current === requestId && currentWorkspaceScopeKeyRef.current === requestScopeKey) setLoadingPreview(false);
      });
    return () => {
      live = false;
    };
  }, [selectedFilePath, workspaceScopeKey, workspaceTabId]);

  useEffect(() => {
    if (!open || !selectedFilePath) return;
    return refreshSelected();
  }, [open, refreshSelected, selectedFilePath]);

  // On mount, if a persisted file was restored, expand its parent directories
  // so the tree reveals the file (mirrors selectFile's dir expansion).
  const restoredPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (restoredPathRef.current === selectedFilePath) return;
    restoredPathRef.current = selectedFilePath;
    if (!selectedFilePath) return;
    const dirs = parentDirs(selectedFilePath);
    updateOpenDirs((prev) => new Set([...Array.from(prev), ...dirs]));
    dirs.forEach((dir) => void loadDir(dir));
  }, [open, selectedFilePath, updateOpenDirs, loadDir]);

  // Persist the tree width and last opened file across dock-tab switches and
  // app restarts so the files panel restores the same layout and preview.
  // Written on every change (not gated on `open`) so the final state lands in
  // the module session cache even when the component unmounts mid-interaction.
  useEffect(() => {
    rememberWorkspacePanelSession(workspaceMemoryKey, { treeWidth });
    writeWorkspacePanelPreference(WORKSPACE_TREE_WIDTH_KEY, workspaceMemoryKey, treeWidth);
  }, [treeWidth, workspaceMemoryKey]);

  useEffect(() => {
    if (selectedFilePath) {
      rememberWorkspacePanelSession(workspaceMemoryKey, { selectedPath: selectedFilePath });
      writeWorkspacePanelPreference(WORKSPACE_SELECTED_PATH_KEY, workspaceMemoryKey, selectedFilePath);
    } else {
      rememberWorkspacePanelSession(workspaceMemoryKey, { selectedPath: null });
      writeWorkspacePanelPreference(WORKSPACE_SELECTED_PATH_KEY, workspaceMemoryKey, null);
    }
  }, [selectedFilePath, workspaceMemoryKey]);

  useEffect(() => {
    writeWorkspacePanelPreference(WORKSPACE_RECENT_PATHS_KEY, workspaceMemoryKey, recentPaths);
  }, [recentPaths, workspaceMemoryKey]);

  // Unmount: flush whatever the latest state is into the session cache.
  // The cleanup closure must read refs (not render-scoped values) because the
  // effect's deps are empty, so its closure would otherwise hold the first
  // render's treeWidth/selectedFilePath and clobber the cache with initial values.
  const latestTreeWidthRef = useRef(treeWidth);
  const latestSelectedFilePathRef = useRef(selectedFilePath);
  const latestScrollTopRef = useRef(0);
  latestTreeWidthRef.current = treeWidth;
  latestSelectedFilePathRef.current = selectedFilePath;
  useEffect(() => {
    return () => {
      rememberWorkspacePanelSession(workspaceMemoryKey, {
        treeWidth: latestTreeWidthRef.current,
        selectedPath: latestSelectedFilePathRef.current,
        scrollTop: latestScrollTopRef.current,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMemoryKey]);

  // Track and persist the tree scroll position so switching tabs or
  // restarting restores where the user was in the directory tree.
  useEffect(() => {
    const el = treeRef.current;
    if (!open || !el) return;
    const onScroll = () => {
      latestScrollTopRef.current = el.scrollTop;
      rememberWorkspacePanelSession(workspaceMemoryKey, { scrollTop: el.scrollTop });
      writeWorkspacePanelPreference(WORKSPACE_TREE_SCROLL_KEY, workspaceMemoryKey, el.scrollTop);
    };
    // Do NOT call onScroll() on mount: the freshly mounted element sits at
    // scrollTop 0, so persisting it here would overwrite the saved offset
    // before the restoration effect (virtualizer.scrollToOffset) runs. Only
    // real user scrolling and the restoration scroll event persist values.
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open, workspaceMemoryKey]);

  useWorkspaceRefreshInvalidation({ commitHistoryOpen,
    filter,
    gitMetaSchedulerRef: gitMetaRefreshSchedulerRef,
    loadChangeDetail,
    loadDir,
    loadGitHistory,
    loadWorkspaceChanges,
    open,
    openDirsRef,
    refreshSelected,
    selectedPath: selectedChangePath,
    setSearchResults,
    viewMode,
    workingTreeSchedulerRef: workingTreeRefreshSchedulerRef,
    workspaceRefresh,
    workspaceScopeKey,
  });

  const toggleDir = useCallback(
    (dir: string, compactPaths: string[] = [dir]) => {
      const firstPath = compactPaths[0] ?? dir;
      const rootPath = topLevelDirPath(firstPath);
      if (revealedRootPaths !== null && !revealedRootPaths.has(rootPath)) {
        setRevealedRootPaths((current) => new Set([...(current ?? []), rootPath]));
        const remembered = openDirsRef.current;
        if (!remembered.has(firstPath)) {
          updateOpenDirs((previous) => new Set([...previous, ...compactPaths]));
          compactPaths.forEach((path) => void loadDir(path));
          return;
        }
        remembered.forEach((path) => {
          if (path === rootPath || path.startsWith(rootPath)) void loadDir(path);
        });
        return;
      }

      const isOpen = openDirsRef.current.has(firstPath);
      updateOpenDirs((previous) => {
        const next = new Set(previous);
        compactPaths.forEach((path) => {
          if (isOpen) next.delete(path);
          else next.add(path);
        });
        return next;
      });
      if (!isOpen) compactPaths.forEach((path) => void loadDir(path));
    },
    [loadDir, revealedRootPaths, updateOpenDirs],
  );

  const sessionChanges = useMemo(
    () => workspaceChanges?.files.filter((c) => c.sources.includes("session")) ?? [],
    [workspaceChanges],
  );
  /** Working-tree files that are not already covered by the session section. */
  const gitWorkingChanges = useMemo(
    () =>
      workspaceChanges?.files.filter(
        (c) => c.sources.includes("git") && !c.sources.includes("session"),
      ) ?? [],
    [workspaceChanges],
  );
  const hasFileChanges = sessionChanges.length > 0 || gitWorkingChanges.length > 0;
  const workspaceGitWarning = workspaceChanges && (!workspaceChanges.gitAvailable || workspaceChanges.gitErr?.trim())
    ? t("workspace.gitUnavailable")
    : null;

  const renderChangeScope = (title: string, changes: typeof sessionChanges) => (
    <div className="workspace-change-scope">
      <div className="workspace-change-scope__head">
        <span className="workspace-change-scope__title">{title}</span>
        <span className="workspace-change-scope__meta">{t("context.changedMeta", { count: changes.length })}</span>
      </div>
      <div className="workspace-change-scope__list">
        {changes.map((change) => {
          const dir = parentPath(change.path);
          return (
            <div key={change.path} className="workspace-change-row">
              <button
                className="workspace-change"
                type="button"
                onClick={() => selectChange(change.path)}
              >
                <FileText size={14} />
                <span className="workspace-change__body">
                  <span className="workspace-change__name">{basename(change.path)}</span>
                  {dir && <span className="workspace-change__path">{dir}</span>}
                  {change.latestPrompt && <span className="workspace-change__detail">{change.latestPrompt}</span>}
                </span>
                <span className="workspace-change__meta">
                  {change.gitStatus && <span className="workspace-change__badge workspace-change__badge--git">{workspaceGitStatusLabel(change.gitStatus, t)}</span>}
                </span>
              </button>
              {change.canSessionRevert && change.sources.includes("session") && (
                <button
                  type="button"
                  className="workspace-change__revert"
                  title={t("workspace.revertSessionFile")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      const plan = await app.PreviewWorkspaceFileRevertForTab(workspaceTabId, change.path);
                      if (!plan?.ok && !plan?.canFiles && !(plan?.conflicts?.length)) {
                        return;
                      }
					  const resolution = plan?.conflicts?.length ? "overwrite_checkpoint" : "";
                      if (plan?.conflicts?.length) {
                        const ok = window.confirm(
                          t("workspace.revertSessionFileConflict", {
                            path: change.path,
                            conflicts: (plan.conflicts || []).join("\n"),
                          }),
                        );
                        if (!ok) return;
                      }
                      const result = await app.CommitWorkspaceFileRevertForTab(
                        workspaceTabId,
                        plan.planId || "",
                        resolution,
                      );
                      if (result?.ok) {
                        onSessionRevertCommitted?.(workspaceTabId, result);
                        void loadWorkspaceChanges();
                        if (selectedChangePath === change.path) void loadChangeDetail();
                      }
                    })();
                  }}
                >
                  {t("workspace.revertSessionFileShort")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const changedMode = viewMode === "changed";
  const activeSelectedPath = changedMode ? selectedChangePath : selectedFilePath;
  const currentFileName = activeSelectedPath ? basename(activeSelectedPath) : t("workspace.noFile");
  // Line 1: the bare file name. Line 2 (previewPathLabel) shows the
  // breadcrumb up to the file's directory — the file name itself already
  // sits on line 1, so repeating it would be redundant.
  const previewTitle = changedMode && !selectedChangePath
    ? scopedChangeRows ? t("context.sessionChanges") : t("workspace.changedTab")
    : currentFileName;
  // Changed overview shows just the project name (matching the file-preview
  // breadcrumb); hovering reveals the full absolute workspace root.
  const previewSubtitleCrumbs = changedMode && !selectedChangePath && !scopedChangeRows
    ? (cwd ? [{ label: basename(cwd), full: cwd }] : [])
    : [];
  const previewFullPath = activeSelectedPath || "";
  // Breadcrumb segments plus each segment's full absolute path for hover:
  // segment 0 is the project name (compact), segments 1..n are the file's
  // directory chain. Hovering any segment shows the system absolute path.
  const previewCrumbs = previewFullPath ? (() => {
    const root = basename(cwd ?? "");
    const dirParts = parentPath(previewFullPath).split("/").filter(Boolean);
    const dirLabels: { label: string; full: string }[] = [];
    let acc = "";
    for (const part of dirParts) {
      acc += (acc ? "/" : "") + part;
      dirLabels.push({ label: part, full: `${cwd ?? ""}/${acc}` });
    }
    const crumbs = [{ label: root, full: cwd ?? "" }];
    // Skip duplicate leading segment (root name repeats when the file sits
    // directly under the project).
    if (dirParts.length > 0 && dirParts[0] !== root) crumbs.push(...dirLabels);
    return crumbs;
  })() : [];
  const recentFiles = useMemo(() => [...recentPaths].reverse(), [recentPaths]);

  const workspaceSearchFallbackSequence = workspaceRefreshFallbackSequence(workspaceRefresh);

  useEffect(() => {
    const q = filter.trim();
    if (!open || viewMode === "changed" || !q || scopedFilePaths) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    app.SearchFileRefsForTab(workspaceTabId, q).then((results) => {
      if (!cancelled) setSearchResults(asArray(results));
    }).catch(() => {
      if (!cancelled) setSearchResults(null);
    });
    return () => { cancelled = true; };
  }, [filter, viewMode, scopedFilePaths, open, workspaceRefresh.revisions.tree, workspaceSearchFallbackSequence, workspaceScopeKey, workspaceTabId]);

  const flattened = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (scopedFilePaths) {
      return scopedFilePaths
        .map((path) => ({ path, entry: { name: basename(path), isDir: false } }))
        .filter((row) => !q || row.path.toLowerCase().includes(q))
        .sort((a, b) => a.path.localeCompare(b.path));
    }
    const rows: { path: string; entry: DirEntry }[] = [];
    for (const [dir, entries] of Object.entries(entriesByDir)) {
      for (const entry of entries) {
        rows.push({ path: entryPath(dir, entry), entry });
      }
    }
    if (!q) return null;
    return mergeWorkspaceSearchResults(rows, searchResults)
      .filter((row) => row.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [entriesByDir, filter, scopedFilePaths, searchResults]);

  const treeRows = useMemo<TreeRow[]>(() => {
    if (flattened) {
      return flattened.map(({ path, entry }) => ({
        key: path,
        path,
        depth: 0,
        entry,
        active: selectedFilePath === path,
        isSearch: true,
      }));
    }
    const acc: TreeRow[] = [];
    const build = (dir: string, depth: number) => {
      const entries = entriesByDir[dir] ?? [];
      for (const entry of entries) {
        const firstPath = entryPath(dir, entry);
        if (!entry.isDir) {
          acc.push({
            key: firstPath,
            path: firstPath,
            depth,
            entry,
            active: selectedFilePath === firstPath,
            isOpen: false,
          });
          continue;
        }

        const compactPaths = [firstPath];
        const compactNames = [entry.name];
        let lastPath = firstPath;
        let lastEntry = entry;
        while (true) {
          const children = entriesByDir[lastPath];
          if (!children || children.length !== 1 || !children[0]?.isDir) break;
          lastEntry = children[0];
          lastPath = entryPath(lastPath, lastEntry);
          compactPaths.push(lastPath);
          compactNames.push(lastEntry.name);
        }
        const rootPath = topLevelDirPath(firstPath);
        const isRevealed = revealedRootPaths === null || revealedRootPaths.has(rootPath);
        const isOpen = isRevealed && openDirs.has(firstPath);
        acc.push({
          key: lastPath,
          path: lastPath,
          depth,
          entry: lastEntry,
          active: selectedFilePath === lastPath,
          isOpen,
          compactPaths,
          displayName: compactNames.join(" / "),
        });
        if (isOpen) {
          build(lastPath, depth + 1);
        }
      }
    };
    build("", 0);
    return acc;
  }, [flattened, entriesByDir, openDirs, revealedRootPaths, selectedFilePath]);
  const getTreeRowKey = useCallback((index: number) => treeRows[index]?.key ?? index, [treeRows]);

  const virtualizer = useVirtualizer({
    count: treeRows.length,
    getScrollElement: () => treeRef.current,
    estimateSize: () => 24,
    getItemKey: getTreeRowKey,
    overscan: 10,
    directDomUpdates: true,
  });
  // Restore the persisted scroll position once the tree has grown tall enough
  // to actually reach it. The tree loads asynchronously layer by layer: the
  // first render usually has only the top-level rows, so scrolling then would
  // clamp the saved offset to the (tiny) current scrollable range and lose the
  // position forever. Keep a pending target and retry on every tree change
  // until the tree's total height exceeds it, then scroll once.
  const pendingScrollRestoreRef = useRef<number | null>(null);
  // Reset the pending restore whenever the view mode changes: the saved offset
  // belongs to the previous mode's tree, and re-applying it to a shorter list
  // (e.g. files -> changed) scrolls past the end and leaves a blank band at
  // the top. Each mode restores its own offset on its own data.
  const previousViewModeRef = useRef(viewMode);
  if (previousViewModeRef.current !== viewMode) {
    previousViewModeRef.current = viewMode;
    pendingScrollRestoreRef.current = null;
  }
  useEffect(() => {
    if (!open || treeRows.length === 0) return;
    if (pendingScrollRestoreRef.current == null) {
      const saved = workspacePanelSession.get(workspaceMemoryKey)?.scrollTop
        ?? readWorkspacePanelPreference<number>(WORKSPACE_TREE_SCROLL_KEY, workspaceMemoryKey);
      if (saved == null || !Number.isFinite(saved) || saved <= 0) return;
      pendingScrollRestoreRef.current = saved;
    }
    const target = pendingScrollRestoreRef.current;
    // Strictly less-than: when the tree's total height equals the saved offset
    // exactly, it is still reachable — using <= would leave the restore
    // pending forever and the tree stuck at the top.
    if (virtualizer.getTotalSize() < target) return; // tree not tall enough yet
    virtualizer.scrollToOffset(target, { align: "start" });
    latestScrollTopRef.current = target;
    pendingScrollRestoreRef.current = null;
  }, [open, treeRows.length, virtualizer.getTotalSize(), workspaceMemoryKey, virtualizer]);

  const virtualTreeItems = virtualizer.getVirtualItems();
  const compactProbePaths = virtualTreeItems
    .map((item) => treeRows[item.index])
    .filter((row): row is TreeRow => Boolean(row?.entry.isDir && entriesByDir[row.path] === undefined))
    .map((row) => row.path);
  const compactProbeKey = compactProbePaths.join("\u0000");

  useEffect(() => {
    if (!open || !compactProbeKey) return;
    compactProbePaths.forEach((path) => {
      if (compactProbeInFlightRef.current.has(path)) return;
      compactProbeInFlightRef.current.add(path);
      void loadDir(path).finally(() => compactProbeInFlightRef.current.delete(path));
    });
  }, [compactProbeKey, loadDir, open]);

  const searchPlaceholder = t(scopedFilePaths ? "workspace.filterReferencedFiles" : changedMode ? "workspace.filterChanges" : "workspace.filter");

  const filePreviewActive = openTabs.length > 0 || selectedFilePath !== null;
  const changeDetailActive = changedMode && expandedCommit !== null;
  const previewVisible = changedMode || filePreviewActive;
  const splitPanesFit = useMemo(
    () =>
      workspaceSplitCanFit({
        panelWidth,
        treeMinWidth: WORKSPACE_TREE_MIN_WIDTH,
        previewMinWidth: WORKSPACE_PREVIEW_MIN_WIDTH,
      }),
    [panelWidth],
  );
  const actualTreeVisible = changedMode ? false : treeVisible && (!previewVisible || splitPanesFit);
  const previewModeActive = open && (filePreviewActive || changeDetailActive);
  const embeddedDockMode = !showViewTabs;
  const showFileTools = true;
  const effectiveTreeWidth = useMemo(
    () =>
      resolveWorkspaceSplitTreeWidth({
        mode: treeWidthMode,
        currentTreeWidth: treeWidth,
        panelWidth,
        treeMinWidth: WORKSPACE_TREE_MIN_WIDTH,
        previewMinWidth: WORKSPACE_PREVIEW_MIN_WIDTH,
      }),
    [panelWidth, treeWidth, treeWidthMode],
  );
  const maxTreeWidthForPanel = useMemo(
    () => Math.max(WORKSPACE_TREE_MIN_WIDTH, (panelWidth ?? WORKSPACE_DUAL_PANEL_TARGET_WIDTH) - WORKSPACE_PREVIEW_MIN_WIDTH),
    [panelWidth],
  );

  useEffect(() => {
    const pendingRevealPath = pendingTreeRevealPathRef.current;
    if (!pendingRevealPath) return;
    if (!selectedFilePath || pendingRevealPath !== selectedFilePath) {
      pendingTreeRevealPathRef.current = null;
      return;
    }
    const selectedIndex = treeRows.findIndex((row) => row.path === selectedFilePath);
    if (!shouldScrollWorkspaceTreeSelection({ selectedPath: selectedFilePath, pendingRevealPath, actualTreeVisible, selectedIndex })) return;
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    pendingTreeRevealPathRef.current = null;
  }, [selectedFilePath, actualTreeVisible, treeRows, virtualizer]);

  const panelStyle = useMemo(
    () =>
      ({
        "--workspace-tree-width": `${effectiveTreeWidth}px`,
        "--workspace-preview-min-width": `${WORKSPACE_PREVIEW_MIN_WIDTH}px`,
      }) as CSSProperties,
    [effectiveTreeWidth],
  );

  useEffect(() => {
    if (lastPreviewModeActiveRef.current === previewModeActive) return;
    lastPreviewModeActiveRef.current = previewModeActive;
    onPreviewModeChange?.(previewModeActive);
  }, [onPreviewModeChange, previewModeActive]);

  useEffect(() => {
    if (open && !treeVisible && !previewVisible) onClose();
  }, [onClose, open, previewVisible, treeVisible]);

  const hideTreeOrClosePanel = useCallback(() => {
    if (previewVisible) {
      setTreeVisible(false);
    } else {
      onClose();
    }
  }, [onClose, previewVisible]);

  const toggleTreeRail = useCallback(() => {
    // Toggle visibility only — never adjust the tree width here. The width is
    // the user's persisted/resized value; showing the tree must not clobber it.
    setTreeVisible(!actualTreeVisible);
  }, [actualTreeVisible]);

  const closePreviewArea = useCallback(() => {
    if (lastRevealRequestIdRef.current === revealPathRequest?.id) {
      dismissedRevealRequestIdRef.current = revealPathRequest.id;
    }
    if (lastChangeRevealRequestIdRef.current === changeRevealRequest?.id) {
      dismissedChangeRevealRequestIdRef.current = changeRevealRequest.id;
    }
    // Close every preview tab at once — a single close action should not
    // require one click per open file. The recent-files menu (recentPaths)
    // is intentionally left untouched so it survives this action.
    setOpenTabs([]);
    setSelectedFilePath(null);
    setPreview(null);
    setSelectionMenu(null);
    setTreeMenu(null);
    setTreeVisible(true);
  }, [changeRevealRequest, revealPathRequest]);

  const closeActivePreview = useCallback(() => {
    if (viewMode === "changed") {
      if (lastChangeRevealRequestIdRef.current === changeRevealRequest?.id) {
        dismissedChangeRevealRequestIdRef.current = changeRevealRequest.id;
      }
      setSelectedChangePath(null);
      setExpandedCommit(null);
      setCommitDetail(null);
      return;
    }
    closePreviewArea();
  }, [changeRevealRequest, closePreviewArea, setSelectedChangePath, viewMode]);

  const setSavedTreeWidth = useCallback(
    (width: number) => {
      const next = clampWorkspaceTreeWidth(width, panelWidth);
      setTreeWidth(next);
      setTreeWidthMode("manual");
    },
    [panelWidth],
  );

  const startTreeResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!treeVisible) return;
      const panel = panelRef.current;
      const rect = panel?.getBoundingClientRect();
      if (!panel || !rect) return;
      event.preventDefault();
      const committedTreeWidth = clampWorkspaceTreeWidth(effectiveTreeWidth, panelWidth);
      setTreeWidth(committedTreeWidth);
      setTreeWidthMode("manual");
      setTreeResizing(true);
      let nextWidth = committedTreeWidth;
      const liveResize = createRafResizeUpdater({
        target: panel,
        separator: event.currentTarget,
        cssVar: "--workspace-tree-width",
      });
      const onMove = (moveEvent: PointerEvent) => {
        nextWidth = workspaceSplitTreeWidthFromPointer({
          clientX: moveEvent.clientX,
          panelLeft: rect.left,
          panelWidth: rect.width,
          treeMinWidth: WORKSPACE_TREE_MIN_WIDTH,
          previewMinWidth: WORKSPACE_PREVIEW_MIN_WIDTH,
          treeOnRight: true,
        });
        liveResize.schedule(nextWidth);
      };
      const onDone = () => {
        liveResize.flush();
        setTreeWidth(nextWidth);
        setTreeResizing(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onDone);
        window.removeEventListener("pointercancel", onDone);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onDone);
      window.addEventListener("pointercancel", onDone);
    },
    [effectiveTreeWidth, panelWidth, treeVisible],
  );

  const resizeTreeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setSavedTreeWidth(effectiveTreeWidth + (event.key === "ArrowRight" ? 16 : -16));
      } else if (event.key === "Home") {
        event.preventDefault();
        setSavedTreeWidth(WORKSPACE_TREE_MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        setSavedTreeWidth(maxTreeWidthForPanel);
      }
    },
    [effectiveTreeWidth, maxTreeWidthForPanel, setSavedTreeWidth],
  );

  useEffect(() => {
    setCodeSearchRequestPending(false);
    setCodeSearchRequestPath(null);
  }, [selectedFilePath]);

  const consumeCodeSearchRequest = useCallback(() => {
    setCodeSearchRequestPending(false);
  }, []);

  if (!open) return null;

  const selectedTextFromPreview = (): string => {
    const root = previewBodyRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const node = container instanceof Element ? container : container.parentElement;
    if (!node || !root.contains(node)) return "";
    return selection.toString();
  };

  const openSelectionMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectedFilePath || loadingPreview || preview?.err || preview?.binary || preview?.kind) return;
    const text = selectedTextFromPreview();
    if (text.trim() === "") return;
    event.preventDefault();
    event.stopPropagation();
    setSelectionMenu({ x: event.clientX, y: event.clientY, text, path: selectedFilePath });
  };

  // Selecting code with the mouse pops the "Add to Chat" button right away,
  // so a snippet is one click from the composer instead of right-click →
  // menu item. The right-click menu (openSelectionMenu) stays as a fallback.
  const showSelectionToolbar = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Mouseup on the floating button bubbles back here through the portal's
    // React tree; let the button handle it.
    if ((event.target as HTMLElement | null)?.closest(".floating-menu")) return;
    if (!selectedFilePath || loadingPreview || preview?.err || preview?.binary || preview?.kind) return;
    const text = selectedTextFromPreview();
    if (text.trim() === "") return;
    setSelectionMenu({ x: event.clientX, y: event.clientY + 8, text, path: selectedFilePath });
  };

  const addSelectionToChat = () => {
    if (!selectionMenu) return;
    if (onAddCodeToChat) onAddCodeToChat(selectionMenu.path, selectionMenu.text);
    else onAddToChat?.(formatSelectionReference(selectionMenu.path, selectionMenu.text));
    setSelectionMenu(null);
  };

  const openTreeMenu = (event: ReactMouseEvent<HTMLElement>, path: string, isDir: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    setTreeBlankMenuPoint(null);
    setSelectionMenu(null);
    setTreeMenu({ x: event.clientX, y: event.clientY, path, isDir });
  };

  const openTreeBlankMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".workspace-tree__row,.workspace-change,button,input,textarea,select")) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectionMenu(null);
    setTreeMenu(null);
    setTreeBlankMenuPoint(contextMenuPointFromEvent(event));
  };

  const startTreeDrag = (event: ReactDragEvent<HTMLElement>, path: string, isDir: boolean) => {
    const ref = formatWorkspaceReference(path, isDir);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(WORKSPACE_REF_DRAG_TYPE, JSON.stringify({ path, isDir }));
    event.dataTransfer.setData("text/plain", ref);
  };

  const addTreeReferenceToChat = () => {
    if (!treeMenu) return;
    onAddToChat?.(formatWorkspaceReference(treeMenu.path, treeMenu.isDir));
    setTreeMenu(null);
  };

  const addTreeFileToChat = async () => {
    if (!treeMenu || treeMenu.isDir) return;
    const target = treeMenu;
    const requestTabId = workspaceTabId;
    const requestScopeKey = workspaceScopeKey;
    setTreeMenu(null);
    try {
      const file = await app.ReadFileForTab(requestTabId, target.path);
      if (currentWorkspaceScopeKeyRef.current !== requestScopeKey) return;
      if (file.err || file.binary || file.kind) {
        onAddToChat?.(formatWorkspaceReference(target.path, false));
        return;
      }
      const body = file.truncated ? `${file.body}\n\n${t("workspace.truncated")}` : file.body;
      if (onAddCodeToChat) onAddCodeToChat(target.path, body);
      else onAddToChat?.(formatSelectionReference(target.path, body));
    } catch {
      if (currentWorkspaceScopeKeyRef.current !== requestScopeKey) return;
      onAddToChat?.(formatWorkspaceReference(target.path, false));
    }
  };

  const renderNormalRow = (row: TreeRow) => {
    const { path, depth, entry, isOpen, active, compactPaths = [path], displayName = entry.name } = row;
    return (
      <button
        key={path}
        className={`workspace-tree__row${active ? " workspace-tree__row--active" : ""}`}
        data-workspace-path={path}
        draggable
        onDragStart={(event) => startTreeDrag(event, path, entry.isDir)}
        onClick={() => {
          if (entry.isDir) {
            toggleDir(path, compactPaths);
          } else {
            if (selectedFilePath === path) {
              setSelectedFilePath(null);
            } else {
              selectFile(path);
            }
          }
        }}
        onContextMenu={(event) => openTreeMenu(event, path, entry.isDir)}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {depth > 0 && (
          <span className="workspace-tree__guides" aria-hidden="true">
            {Array.from({ length: depth }, (_, index) => (
              <span
                className="workspace-tree__guide"
                key={index}
                style={{ left: 14 + index * 14 }}
              />
            ))}
          </span>
        )}
        {entry.isDir ? (
          <ChevronRight
            size={13}
            className={`workspace-tree__chev ${isOpen ? "workspace-tree__chev--open" : ""}`}
            style={{
              transition: "transform 0.15s ease",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            }}
          />
        ) : (
          <span className="workspace-tree__chev" />
        )}
        {entry.isDir ? (
          <Folder size={14} className="workspace-tree__icon workspace-tree__icon--dir" />
        ) : (
          <WorkspaceFileIcon fileName={entry.name} />
        )}
        <span className="workspace-tree__name">{displayName}</span>
      </button>
    );
  };

  const renderSearchRow = (row: TreeRow) => {
    const { path, entry, active } = row;
    const dir = parentPath(path);
    return (
      <button
        key={path}
        className={`workspace-tree__row workspace-tree__row--search${active ? " workspace-tree__row--active" : ""}`}
        data-workspace-path={path}
        draggable
        onDragStart={(event) => startTreeDrag(event, path, entry.isDir)}
        onClick={() => {
          if (entry.isDir) {
            toggleDir(path);
          } else {
            if (selectedFilePath === path) {
              setSelectedFilePath(null);
            } else {
              selectFile(path);
            }
          }
        }}
        onContextMenu={(event) => openTreeMenu(event, path, entry.isDir)}
      >
        {entry.isDir ? (
          <Folder size={14} className="workspace-tree__icon workspace-tree__icon--dir" />
        ) : (
          <WorkspaceFileIcon fileName={entry.name} />
        )}
        <span className="workspace-tree__result">
          <span className="workspace-tree__result-name">{basename(path)}</span>
          {dir && <span className="workspace-tree__result-dir">{dir}</span>}
        </span>
      </button>
    );
  };

  const isMarkdown = selectedFilePath?.toLowerCase().endsWith(".md") ?? false;
  const codePreviewActive = Boolean(
    selectedFilePath &&
      !changedMode &&
      preview &&
      !loadingPreview &&
      !preview.err &&
      !preview.kind &&
      !preview.binary &&
      !isMarkdown,
  );
  const openCodeSearch = () => {
    if (!codePreviewActive || !selectedFilePath) return;
    setCodeSearchRequestPath(selectedFilePath);
    setCodeSearchRequestPending(true);
  };
  const treeBlankMenuItems: ContextMenuItem[] = [
    {
      key: "refresh-tree",
      icon: <RefreshCw size={13} />,
      label: t(viewMode === "changed" ? "workspace.refreshChanges" : "workspace.refreshTree"),
      onSelect: refreshWorkspaceList,
    },
  ];

  return (
    <aside
      ref={panelRef}
      className={`workspace-panel${embeddedDockMode ? " workspace-panel--embedded" : ""}${changedMode ? " workspace-panel--detail-only" : ""}${changedMode && !selectedChangePath ? " workspace-panel--changed-overview" : ""}${previewVisible && actualTreeVisible ? " workspace-panel--split-preview" : ""}${actualTreeVisible ? "" : " workspace-panel--tree-hidden"}${previewVisible ? "" : " workspace-panel--preview-hidden"}${treeResizing ? " workspace-panel--tree-resizing" : ""}`}
      aria-label={t("workspace.title")}
      style={panelStyle}
      onKeyDownCapture={(event) => {
        if (
          codePreviewActive
          && (event.ctrlKey || event.metaKey)
          && event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          openCodeSearch();
        }
      }}
    >
      {previewVisible && <section className="workspace-preview">
        <header className="workspace-preview__head">
          <div className="workspace-current-file" aria-label={t("workspace.currentFile")}>
            {changedMode && !selectedChangePath ? (
              <GitBranch size={15} className="workspace-current-file__icon" />
            ) : activeSelectedPath ? (
              <WorkspaceFileIcon fileName={basename(activeSelectedPath)} className="workspace-current-file__icon" />
            ) : (
              <FileText size={15} className="workspace-current-file__icon" />
            )}
            <div className="workspace-current-file__text">
              <Tooltip label={activeSelectedPath ?? undefined}>
                <span className="workspace-current-file__name">{previewTitle}</span>
              </Tooltip>
              {previewSubtitleCrumbs.length > 0 && (
                <span className="workspace-current-file__path">
                  {previewSubtitleCrumbs.map((crumb, index) => (
                    <span key={index} className="workspace-current-file__crumb">
                      {index > 0 && <span className="workspace-current-file__crumb-sep" aria-hidden="true">›</span>}
                      <Tooltip label={crumb.full}>
                        <span>{crumb.label}</span>
                      </Tooltip>
                    </span>
                  ))}
                </span>
              )}
              {previewCrumbs.length > 0 && (
                <span className="workspace-current-file__path">
                  {previewCrumbs.map((crumb, index) => (
                    <span key={index} className="workspace-current-file__crumb">
                      {index > 0 && <span className="workspace-current-file__crumb-sep" aria-hidden="true">›</span>}
                      <Tooltip label={crumb.full}>
                        <span>{crumb.label}</span>
                      </Tooltip>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <Tooltip label={t("workspace.recentFiles")}>
              <button
                ref={recentAnchorRef}
                className={`workspace-current-file__recent${recentOpen ? " workspace-current-file__recent--open" : ""}`}
                type="button"
                aria-label={t("workspace.recentFiles")}
                aria-expanded={recentOpen}
                onClick={() => setRecentOpen((open) => !open)}
              >
                <ChevronDown size={13} />
              </button>
            </Tooltip>
          </div>

          <div className="workspace-preview__window-actions">
            {codePreviewActive && (
              <Tooltip label={t("workspace.searchPlaceholder")}>
                <button
                  className="workspace-iconbtn"
                  type="button"
                  aria-label={t("workspace.searchPlaceholder")}
                  aria-keyshortcuts="Control+F Meta+F"
                  onClick={openCodeSearch}
                >
                  <Search size={15} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={maximized ? t("workspace.restore") : t("workspace.maximize")}>
              <button className="workspace-iconbtn" onClick={onToggleMaximized}>
                {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </Tooltip>
            {previewVisible && !changedMode && (
              <Tooltip label={actualTreeVisible ? t("workspace.hideTree") : t("workspace.showTree")}>
                <button
                  className={`workspace-iconbtn${actualTreeVisible ? " workspace-iconbtn--on" : ""}`}
                  type="button"
                  aria-label={actualTreeVisible ? t("workspace.hideTree") : t("workspace.showTree")}
                  aria-pressed={actualTreeVisible}
                  onClick={toggleTreeRail}
                >
                  <FolderTree size={15} />
                </button>
              </Tooltip>
            )}
            {activeSelectedPath && (
              <Tooltip label={t("workspace.closePreview")}>
                <button className="workspace-iconbtn" onClick={closeActivePreview}>
                  <X size={15} />
                </button>
              </Tooltip>
            )}
          </div>
          <AnchoredPopover
            open={recentOpen}
            anchorRef={recentAnchorRef}
            onClose={() => setRecentOpen(false)}
            className="workspace-recent-menu"
            align="start"
            offset={6}
            placement="bottom"
          >
            <div className="workspace-recent-menu__title">{t("workspace.recentFiles")}</div>
            <div className="workspace-recent-menu__list">
              {recentFiles.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`workspace-recent-menu__item${path === selectedFilePath ? " workspace-recent-menu__item--active" : ""}`}
                  onClick={() => {
                    setSelectedFilePath(path);
                    setRecentOpen(false);
                  }}
                >
                  <FileText size={14} />
                  <span>
                    <span className="workspace-recent-menu__name">{basename(path)}</span>
                    <span className="workspace-recent-menu__path">{parentPath(path)}</span>
                  </span>
                </button>
              ))}
            </div>
          </AnchoredPopover>
        </header>

        <div
          className={`workspace-preview__body${codePreviewActive ? " workspace-preview__body--code" : ""}`}
          ref={previewBodyRef}
          onContextMenu={openSelectionMenu}
          onMouseUp={showSelectionToolbar}
        >
          {viewMode === "changed" && scopedChangeRows ? (
            <div className="workspace-change-scope">
              <div className="workspace-change-scope__head">
                <span className="workspace-change-scope__title">{t("context.sessionChanges")}</span>
                <span className="workspace-change-scope__meta">{t("context.changedMeta", { count: scopedChangeRows.length })}</span>
                <Tooltip label={t("workspace.clearChangeScope")}>
                  <button
                    type="button"
                    aria-label={t("workspace.clearChangeScope")}
                    onClick={() => {
                      dismissedChangeListRequestIdRef.current = lastChangeListRequestIdRef.current;
                      setScopedChangeRows(null);
                      setSelectedChangePath(null);
                      setExpandedCommit(null);
                      setCommitDetail(null);
                    }}
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
              <div className="workspace-change-scope__list">
                {scopedChangeRows.map((change) => {
                  const dir = parentPath(change.path);
                  return (
                    <button
                      key={change.key}
                      className="workspace-change"
                      type="button"
                      onClick={() => {
                        dismissedChangeListRequestIdRef.current = lastChangeListRequestIdRef.current;
                        setScopedChangeRows(null);
                        selectChange(change.path);
                      }}
                    >
                      <FileText size={14} />
                      <span className="workspace-change__body">
                        <span className="workspace-change__name">{basename(change.path)}</span>
                        {dir && <span className="workspace-change__path">{dir}</span>}
                        {change.detail && <span className="workspace-change__detail">{change.detail}</span>}
                      </span>
                      <span className="workspace-change__meta">
                        <span className="workspace-change__badge workspace-change__badge--git">{change.meta}</span>
                        {change.time && <span className="workspace-change__badge">{change.time}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : viewMode === "changed" && !selectedChangePath ? (
            <div className="workspace-git-history">
              {completionSummary && (
                <section
                  className={`workspace-note workspace-completion-summary${completionSummaryNeedsAttention(completionSummary) ? " workspace-completion-summary--attention" : ""}`}
                  aria-label={t("completion.panelTitle")}
                >
                  <div className="workspace-completion-summary__head">
                    <strong>{t("completion.panelTitle")}</strong>
                    <span>{completionReviewLabel(completionSummary.preset, t)}</span>
                    <span>{completionVerdictLabel(completionSummary.verdict, t)}</span>
                  </div>
                  <div className="workspace-completion-summary__metrics">
                    <span>{t("completion.mutations", { count: completionSummary.mutations })}</span>
                    <span>{t("completion.checksPassed", { count: completionSummary.checks_passed })}</span>
                    <span className={completionSummary.checks_failed > 0 ? "workspace-completion-summary__metric--attention" : undefined}>
                      {t("completion.checksFailed", { count: completionSummary.checks_failed })}
                    </span>
                    <span className={completionSummary.checks_suppressed > 0 ? "workspace-completion-summary__metric--attention" : undefined}>
                      {t("completion.checksSkipped", { count: completionSummary.checks_suppressed })}
                    </span>
                  </div>
                  <div className="workspace-completion-summary__details">
                    <span>{t("completion.review", { status: completionReviewLabel(completionSummary.review, t) })}</span>
                    {(completionSummary.gap_kinds?.length ?? 0) > 0 && (
                      <span>{t("completion.gaps", { gaps: completionSummary.gap_kinds!.map((gap) => completionGapLabel(gap, t)).join(t("notice.deliveryRequirementSeparator")) })}</span>
                    )}
                    {completionSummary.constraint_degraded && <span>{t("completion.constraintsLimited")}</span>}
                  </div>
                </section>
              )}
              {workspaceGitWarning && (
                <div className="workspace-note workspace-note--warning" role="status">
                  {workspaceGitWarning}
                </div>
              )}
              {workspaceChangesErr && (
                <div className="workspace-note workspace-note--error" role="alert">
                  {t("workspace.changesUnavailable")}: {workspaceChangesErr}
                </div>
              )}
              {groupedChangesLayout ? (
                <>
                  {sessionChanges.length > 0 && renderChangeScope(t("context.sessionChanges"), sessionChanges)}
                  {gitWorkingChanges.length > 0 && renderChangeScope(t("workspace.workingChanges"), gitWorkingChanges)}
                  {!loadingWorkspaceChanges && !workspaceChangesErr && !hasFileChanges && !workspaceGitWarning && (
                    <div className="workspace-empty">{t("context.noChanges")}</div>
                  )}
                  {loadingWorkspaceChanges && !workspaceChanges && (
                    <div className="workspace-empty">{t("workspace.loadingChanges")}</div>
                  )}
                  {loadingHistory ? (
                    <div className="workspace-empty">{t("workspace.loading")}</div>
                  ) : (
                    <section className={`workspace-commit-history${commitHistoryOpen ? " workspace-commit-history--open" : ""}`}>
                      <button
                        className="workspace-commit-history__toggle"
                        type="button"
                        aria-expanded={commitHistoryOpen}
                        onClick={() => {
                          setCommitHistoryOpen((open) => !open);
                          setExpandedCommit(null);
                        }}
                      >
                        {commitHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span>{t("workspace.commitHistory")}</span>
                        <small>{t("workspace.commitHistoryMeta", { count: gitHistory.length })}</small>
                      </button>
                      {commitHistoryOpen && (
                        <div className="workspace-git-history__list">
                          {gitHistory.map((commit) => (
                            <div key={commit.hash} className={`workspace-git-history__item${expandedCommit === commit.hash ? " workspace-git-history__item--expanded" : ""}`}>
                              <button
                                className="workspace-git-history__head"
                                onClick={() => void toggleCommit(commit.hash)}
                              >
                                <div className="workspace-git-history__head-top">
                                  {expandedCommit === commit.hash ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  <span className="workspace-git-history__message">{commit.message}</span>
                                </div>
                                <div className="workspace-git-history__head-bottom">
                                  <span className="workspace-git-history__author">{commit.author}</span>
                                  <span className="workspace-git-history__date">
                                    {formatCommitDate(commit.date)} <span className="workspace-git-history__hash">{commit.hash.substring(0, 7)}</span>
                                  </span>
                                </div>
                              </button>
                              {expandedCommit === commit.hash && (
                                <div className="workspace-git-history__detail">
                                  {loadingCommit ? (
                                    <div className="workspace-empty">{t("workspace.loading")}</div>
                                  ) : commitDetail?.diff ? (
                                    <CodeViewer value={cleanGitDiff(commitDetail.diff)} language="diff" />
                                  ) : commitDetail?.files ? (
                                    <div className="workspace-git-history__files">
                                      {commitDetail.files.map((file) => (
                                        <button
                                          key={file}
                                          className="workspace-git-history__file"
                                          onClick={() => selectChange(file)}
                                        >
                                          <FileText size={14} /> {file}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="workspace-empty">No details available</div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                </>
              ) : (
                <>
                  {sessionChanges.length > 0 && renderChangeScope(t("workspace.changedTab"), sessionChanges)}
                  {gitWorkingChanges.length > 0 && renderChangeScope(t("workspace.workingChanges"), gitWorkingChanges)}
                  {loadingHistory ? (
                    <div className="workspace-empty">{t("workspace.loading")}</div>
                  ) : gitHistory.length === 0 && !hasFileChanges ? (
                    <div className="workspace-empty">{workspaceGitWarning ? t("workspace.gitChangesUnknown") : t("workspace.noChanges")}</div>
                  ) : (
                    <div className="workspace-git-history__list">
                      {gitHistory.map((commit) => (
                        <div key={commit.hash} className={`workspace-git-history__item${expandedCommit === commit.hash ? " workspace-git-history__item--expanded" : ""}`}>
                          <button
                            className="workspace-git-history__head"
                            onClick={() => void toggleCommit(commit.hash)}
                          >
                            <div className="workspace-git-history__head-top">
                              {expandedCommit === commit.hash ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="workspace-git-history__message">{commit.message}</span>
                            </div>
                            <div className="workspace-git-history__head-bottom">
                              <span className="workspace-git-history__author">{commit.author}</span>
                              <span className="workspace-git-history__date">
                                {formatCommitDate(commit.date)} <span className="workspace-git-history__hash">{commit.hash.substring(0, 7)}</span>
                              </span>
                            </div>
                          </button>
                          {expandedCommit === commit.hash && (
                            <div className="workspace-git-history__detail">
                              {loadingCommit ? (
                                <div className="workspace-empty">{t("workspace.loading")}</div>
                              ) : commitDetail?.diff ? (
                                <CodeViewer value={cleanGitDiff(commitDetail.diff)} language="diff" />
                              ) : commitDetail?.files ? (
                                <div className="workspace-git-history__files">
                                  {commitDetail.files.map((file) => (
                                    <button
                                      key={file}
                                      className="workspace-git-history__file"
                                      onClick={() => selectChange(file)}
                                    >
                                      <FileText size={14} /> {file}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="workspace-empty">No details available</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : viewMode === "changed" && selectedChangePath ? (
            <div className="workspace-git-history">
              <section className="workspace-current-change">
                <header className="workspace-current-change__head">
                  <div>
                    <strong>{t("workspace.currentChanges")}</strong>
                    {changeDetail?.source && (
                      <span>{t(changeDetail.source === "git" ? "workspace.currentChangesSourceGit" : "workspace.currentChangesSourceSession")}</span>
                    )}
                  </div>
                  {(changeDetail?.added || changeDetail?.removed) ? (
                    <small>
                      <span className="workspace-current-change__added">+{changeDetail.added ?? 0}</span>
                      <span className="workspace-current-change__removed">-{changeDetail.removed ?? 0}</span>
                    </small>
                  ) : null}
                </header>
                <div className="workspace-current-change__body">
                  {loadingChangeDetail ? (
                    <div className="workspace-empty">{t("workspace.loading")}</div>
                  ) : changeDetailErr ? (
                    <div className="workspace-empty workspace-empty--error">{t("workspace.changeDetailUnavailable")}: {changeDetailErr}</div>
                  ) : changeDetail?.truncated ? (
                    <div className="workspace-empty">{t("workspace.changeDetailTooLarge")}</div>
                  ) : changeDetail?.binary ? (
                    <div className="workspace-empty">{t("workspace.binaryChange")}</div>
                  ) : changeDetail?.diff ? (
                    changeDetail.diff.includes("@@") ? (
                      <DiffView diff={changeDetail.diff} language={languageFor(selectedChangePath)} />
                    ) : (
                      <CodeViewer value={changeDetail.diff} language="diff" />
                    )
                  ) : (
                    <div className="workspace-empty">{t("workspace.noCurrentDiff")}</div>
                  )}
                </div>
              </section>
              <section className={`workspace-commit-history${commitHistoryOpen ? " workspace-commit-history--open" : ""}`}>
                <button
                  className="workspace-commit-history__toggle"
                  type="button"
                  aria-expanded={commitHistoryOpen}
                  onClick={() => {
                    setCommitHistoryOpen((value) => !value);
                    setExpandedCommit(null);
                  }}
                >
                  {commitHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{t("workspace.commitHistory")}</span>
                  <small>{loadingHistory ? t("workspace.loading") : t("workspace.commitHistoryMeta", { count: gitHistory.length })}</small>
                </button>
                {commitHistoryOpen && (
                  loadingHistory ? (
                    <div className="workspace-empty">{t("workspace.loading")}</div>
                  ) : gitHistory.length === 0 ? (
                    <div className="workspace-empty">{t("workspace.noCommitHistory")}</div>
                  ) : (
                    <div className="workspace-git-history__list">
                      {gitHistory.map((commit) => (
                        <div key={commit.hash} className={`workspace-git-history__item${expandedCommit === commit.hash ? " workspace-git-history__item--expanded" : ""}`}>
                          <button className="workspace-git-history__head" onClick={() => void toggleCommit(commit.hash)}>
                            <div className="workspace-git-history__head-top">
                              {expandedCommit === commit.hash ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="workspace-git-history__message">{commit.message}</span>
                            </div>
                            <div className="workspace-git-history__head-bottom">
                              <span className="workspace-git-history__author">{commit.author}</span>
                              <span className="workspace-git-history__date">
                                {formatCommitDate(commit.date)} <span className="workspace-git-history__hash">{commit.hash.substring(0, 7)}</span>
                              </span>
                            </div>
                          </button>
                          {expandedCommit === commit.hash && (
                            <div className="workspace-git-history__detail">
                              {loadingCommit ? (
                                <div className="workspace-empty">{t("workspace.loading")}</div>
                              ) : commitDetail?.diff ? (
                                <CodeViewer value={cleanGitDiff(commitDetail.diff)} language="diff" />
                              ) : (
                                <div className="workspace-empty">{t("workspace.noCommitDetail")}</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </section>
            </div>
          ) : !selectedFilePath ? (
            <div className="workspace-empty">{t("workspace.pickFile")}</div>
          ) : loadingPreview ? (
            <div className="workspace-empty">{t("workspace.loading")}</div>
          ) : preview?.err ? (
            <div className="workspace-empty workspace-empty--error">
              {/no such file|not found|enoent/i.test(preview.err) ? t("workspace.fileDeleted") : preview.err}
            </div>
          ) : preview?.kind ? (
            renderMediaPreview(preview)
          ) : preview?.binary ? (
            <div className="workspace-empty">{t("workspace.binary")}</div>
          ) : preview ? (
            <>
              {preview.truncated && <div className="workspace-note">{t("workspace.truncated")}</div>}
              {isMarkdown ? (
                <Markdown text={preview.body} />
              ) : (
                <CodeViewer
                  value={preview.body || " "}
                  language={languageFor(selectedFilePath)}
                  sourceSize={preview.size}
                  showLineNumbers
                  searchRequestPending={codeSearchRequestPending && codeSearchRequestPath === selectedFilePath}
                  onSearchRequestConsumed={consumeCodeSearchRequest}
                />
              )}
            </>
          ) : null}
          {selectionMenu && (
            <FloatingMenu x={selectionMenu.x} y={selectionMenu.y} estimatedHeight={WORKSPACE_CONTEXT_MENU_SELECTION_HEIGHT}>
              <FloatingMenuItems
                items={[
                  {
                    icon: <MessageSquarePlus size={14} />,
                    label: t("workspace.addSelectionToChat"),
                    onSelect: addSelectionToChat,
                  },
                ]}
              />
            </FloatingMenu>
          )}
        </div>
      </section>}

      {actualTreeVisible && previewVisible && (
        <button
          className="workspace-tree-resizer"
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("workspace.resizeTree")}
          aria-valuemin={WORKSPACE_TREE_MIN_WIDTH}
          aria-valuemax={maxTreeWidthForPanel}
          aria-valuenow={effectiveTreeWidth}
          onPointerDown={startTreeResize}
          onKeyDown={resizeTreeWithKeyboard}
          onDoubleClick={() => setSavedTreeWidth(WORKSPACE_TREE_DEFAULT_WIDTH)}
        />
      )}

      <section className="workspace-files">
        {showFileTools && (
          <div className={`workspace-files__tools${embeddedDockMode ? " workspace-files__tools--embedded" : ""}`}>
            {showViewTabs && (
              <Tooltip label={previewVisible ? t("workspace.hideTree") : t("workspace.close")}>
                <button
                  className="workspace-iconbtn workspace-iconbtn--on"
                  type="button"
                  aria-label={previewVisible ? t("workspace.hideTree") : t("workspace.close")}
                  onClick={hideTreeOrClosePanel}
                >
                  {previewVisible ? <FolderX size={15} /> : <X size={15} />}
                </button>
              </Tooltip>
            )}
            {showViewTabs && (
              <div className="workspace-files__tabs" role="tablist" aria-label={t("workspace.viewMode")}>
                <button
                  className={viewMode === "files" ? "workspace-files__tab workspace-files__tab--active" : "workspace-files__tab"}
                  onClick={() => {
                    setViewMode("files");
                  }}
                >
                  {t("workspace.filesTab")}
                </button>
                <button
                  className={viewMode === "changed" ? "workspace-files__tab workspace-files__tab--active" : "workspace-files__tab"}
                  onClick={() => {
                    setSelectedChangePath(null);
                    setViewMode("changed");
                  }}
                >
                  <GitBranch size={13} />
                  {t("workspace.changedTab")}
                </button>
              </div>
            )}
            <Tooltip label={t("workspace.refreshChanges")}>
              <button
                className="workspace-iconbtn"
                type="button"
                aria-label={t("workspace.refreshChanges")}
                aria-busy={loadingPreview || loadingHistory}
                onClick={() => {
                  refreshWorkspaceList();
                  if (viewMode === "files") void refreshSelected();
                }}
              >
                <RefreshCw size={14} />
              </button>
            </Tooltip>
            {workspaceRefresh.watchState !== "active" && (
              <span
                className="workspace-watch-status"
                role="status"
                title={t(workspaceRefresh.watchState === "degraded" ? "workspace.watchDegraded" : "workspace.watchUnavailable")}
                aria-label={t(workspaceRefresh.watchState === "degraded" ? "workspace.watchDegraded" : "workspace.watchUnavailable")}
              >
                •
              </span>
            )}
          </div>
        )}

        <div className="workspace-search">
          <Search size={14} />
          <input ref={filterRef} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={searchPlaceholder} />
        </div>
        {scopedFilePaths && (
          <div className="workspace-files__scope">
            <span className="workspace-files__scope-title">{t("context.referencedFiles")}</span>
            <span className="workspace-files__scope-meta">{t("context.readMeta", { count: scopedFilePaths.length })}</span>
            <Tooltip label={t("workspace.clearFileScope")}>
              <button
                type="button"
                aria-label={t("workspace.clearFileScope")}
                onClick={() => {
                  dismissedFileListRequestIdRef.current = lastFileListRequestIdRef.current;
                  setScopedFilePaths(null);
                  setFilter("");
                }}
              >
                <X size={12} />
              </button>
            </Tooltip>
          </div>
        )}
        <div
          className="workspace-tree"
          ref={treeRef}
          onContextMenu={openTreeBlankMenu}
          style={{
            height: "100%",
            overflow: "auto",
            position: "relative",
          }}
        >
          {treeRows.length > 0 ? (
            <div
              ref={virtualizer.containerRef}
              className="workspace-tree__sizer"
              style={{
                width: "100%",
                position: "relative",
              }}
            >
              {virtualTreeItems.map((row) => {
                const item = treeRows[row.index];
                if (!item) return null;
                return (
                  <div
                    key={item.key}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                    }}
                  >
                    {item.isSearch ? renderSearchRow(item) : renderNormalRow(item)}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
      {treeMenu && (
        <WorkspaceTreeMenu
          target={treeMenu}
          workspaceTabId={workspaceTabId}
          isScopeCurrent={() => currentWorkspaceScopeKeyRef.current === workspaceScopeKey}
          onClose={() => setTreeMenu(null)}
          onOpenInTerminal={onOpenInTerminal}
          onAddReference={addTreeReferenceToChat}
          onAddFile={() => void addTreeFileToChat()}
        />
      )}
      <ContextMenu
        open={Boolean(treeBlankMenuPoint)}
        point={treeBlankMenuPoint}
        items={treeBlankMenuItems}
        minWidth={150}
        ariaLabel={t("workspace.treeMenu")}
        onClose={() => setTreeBlankMenuPoint(null)}
      />
    </aside>
  );
}
