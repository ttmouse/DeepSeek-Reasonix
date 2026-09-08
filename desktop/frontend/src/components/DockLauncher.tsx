// DockLauncher is the floating menu shown over the transcript's top-right
// corner while the right dock is collapsed. It lists the dock's entry points
// (overview / files / changed / instructions); clicking one expands the dock
// to that panel. The changed (改动) entry and the branch row are git-only:
// both appear only when the active workspace reports a git branch. Remote
// (远程) is intentionally absent — it stays reachable via the sidebar/status
// bar and settings. Once the dock is open the launcher itself is hidden (the
// panel replaces it), so the menu only ever appears in the collapsed state.
// Visual reference: a rounded floating popover card with a title header, icon
// rows, diff totals on the changed row and trailing chevrons. The diff stats
// are polled lightly (every few seconds) because the launcher is exactly the
// surface that makes agent edits visible live.
// The branch row opens a switcher modelled on the ChatGPT reference: a search
// input filters the branch list, and a pinned bottom action creates and checks
// out a new branch from whatever is typed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { app } from "../lib/bridge";
import { Activity, Check, ChevronRight, Command, FileDiff, FileText, GitBranch, Plus, Search, Server } from "lucide-react";
import type { ComponentType } from "react";
import type { TabType } from "../store/activityBar";
import { ACTIVITY_BAR_ENTRIES } from "./ActivityBar/activityBarConfig";

const ENTRY_ICONS: Record<TabType, ComponentType<{ size?: number | string; className?: string }>> = {
  file: FileText,
  changed: FileDiff,
  context: Activity,
  remote: Server,
  // Entries beyond the exposed set are not listed yet; keep a stub so the
  // map stays total if a future config adds them.
  instructions: Command,
  terminal: FileText,
  browser: FileText,
};

// Poll cadence for the whole-tree diff tally. The backend call is a bounded
// git numstat probe, cheap enough to repeat while the launcher is visible.
const DIFF_STATS_POLL_MS = 5000;

// Mirrors the backend's validGitBranchName so the create action is only
// enabled for names git would accept.
function isValidBranchName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("..") ||
      trimmed.endsWith("/") || trimmed.endsWith(".") || trimmed.includes("@{")) {
    return false;
  }
  return !/[\s~^:?*[\\\t\n]/.test(trimmed);
}

// Space priority for the docked launcher: the panel yields FIRST. The panel
// only appears when the surface is at least 1010px wide (history keeps ~770px
// of the 800px comfort target while the panel is docked); below that the
// panel hides and the history stretches/compresses to fill the whole window —
// the panel never squeezes the history while visible.
const HIDE_BELOW_WIDTH = 1010;

type SpaceMode = "full" | "hidden";

interface DiffStats {
  added: number;
  removed: number;
}

interface DockLauncherProps {
  onSelect: (entryId: string) => void;
  /** Current git branch for the active workspace; omitted when unknown. */
  gitBranch?: string;
}

export function DockLauncher({ onSelect, gitBranch }: DockLauncherProps) {
  const t = useT();
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesErr, setBranchesErr] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [switchingBranch, setSwitchingBranch] = useState("");
  const [branchSwitchErr, setBranchSwitchErr] = useState("");
  // Local mirror of the active branch: the App-level meta value refreshes on a
  // cached cadence, so after a checkout we flip this immediately and let the
  // prop catch up (prop wins whenever it diverges from local optimism).
  const [activeBranch, setActiveBranch] = useState(gitBranch);
  const [spaceMode, setSpaceMode] = useState<SpaceMode>("full");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const branchSearchRef = useRef<HTMLInputElement | null>(null);
  const statsReloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    setActiveBranch(gitBranch);
  }, [gitBranch]);

  // Track the transcript surface width (our offset parent) so the panel can
  // yield the space entirely when the surface gets too narrow.
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setSpaceMode(width < HIDE_BELOW_WIDTH ? "hidden" : "full");
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Mirror the current tier onto <html> so siblings OUTSIDE the transcript
  // surface (the footer/composer) can reserve the same right inset via plain
  // CSS — no App-level re-render on every resize tick. The footer's composer
  // then lines up with the history column above it.
  useEffect(() => {
    document.documentElement.dataset.dockLauncher = spaceMode;
    return () => {
      delete document.documentElement.dataset.dockLauncher;
    };
  }, [spaceMode]);

  // Dismiss the branch switcher on any click outside the launcher card, plus
  // Escape — baseline popover behavior.
  useEffect(() => {
    if (!branchMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setBranchMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [branchMenuOpen]);

  // Diff totals are a git concept — skip polling entirely for non-git
  // workspaces (the changed entry is hidden there anyway).
  useEffect(() => {
    let cancelled = false;
    if (!gitBranch) {
      setDiffStats(null);
      return;
    }
    const load = async () => {
      try {
        // Empty tab id resolves to the active tab on the backend.
        const result = await app.WorkspaceChanges("");
        if (cancelled) return;
        setDiffStats({ added: result?.added ?? 0, removed: result?.removed ?? 0 });
      } catch {
        // Keep the last known totals; a transient git failure should not
        // blank the badge.
      }
    };
    statsReloadRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), DIFF_STATS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gitBranch]);

  const loadBranches = async () => {
    setBranchesLoading(true);
    setBranchesErr("");
    try {
      const list = await app.GitBranches();
      setBranches(Array.isArray(list) ? list : []);
    } catch (error) {
      setBranchesErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchesLoading(false);
    }
  };

  const toggleBranchMenu = () => {
    const next = !branchMenuOpen;
    setBranchMenuOpen(next);
    setBranchSwitchErr("");
    setBranchQuery("");
    if (next && branches.length === 0 && !branchesLoading) void loadBranches();
    if (next) window.setTimeout(() => branchSearchRef.current?.focus(), 0);
  };

  const finishBranchSwitch = (branch: string) => {
    setActiveBranch(branch);
    setBranchMenuOpen(false);
    setBranchQuery("");
    // The working tree just changed under the diff badge.
    statsReloadRef.current();
  };

  const checkoutBranch = async (branch: string) => {
    if (switchingBranch) return;
    setSwitchingBranch(branch);
    setBranchSwitchErr("");
    try {
      await app.GitCheckout(branch);
      finishBranchSwitch(branch);
    } catch (error) {
      setBranchSwitchErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingBranch("");
    }
  };

  const createBranch = async (name: string) => {
    if (switchingBranch) return;
    setSwitchingBranch(name);
    setBranchSwitchErr("");
    try {
      await app.GitCreateBranch(name);
      finishBranchSwitch(name);
    } catch (error) {
      setBranchSwitchErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingBranch("");
    }
  };

  // The changed (改动) entry is git-derived (git status / diff), so it is only
  // shown when the active workspace is a git repo; the branch row below is
  // gated the same way via activeBranch.
  const isGitProject = Boolean(gitBranch);
  const mainEntries = ACTIVITY_BAR_ENTRIES.filter(
    (entry) => entry.group !== "secondary" && (entry.id !== "changed" || isGitProject),
  );
  const secondaryEntries = ACTIVITY_BAR_ENTRIES.filter((entry) => entry.group === "secondary");
  const showDiffStats = (diffStats?.added ?? 0) + (diffStats?.removed ?? 0) > 0;
  const trimmedQuery = branchQuery.trim();
  const filteredBranches = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return q ? branches.filter((branch) => branch.toLowerCase().includes(q)) : branches;
  }, [branches, trimmedQuery]);
  const exactMatch = filteredBranches.some((branch) => branch === trimmedQuery);
  const canCreate = trimmedQuery !== "" && !exactMatch && isValidBranchName(trimmedQuery);

  const renderEntry = (entry: (typeof ACTIVITY_BAR_ENTRIES)[number]) => {
    const Icon = ENTRY_ICONS[entry.defaultTab];
    const isChanged = entry.id === "changed";
    return (
      <button
        key={entry.id}
        type="button"
        className="dock-launcher__entry"
        aria-label={t(entry.labelKey as never)}
        onClick={() => onSelect(entry.id)}
      >
        <Icon size={16} />
        <span className="dock-launcher__entry-label">{t(entry.labelKey as never)}</span>
        {isChanged && diffStats && showDiffStats ? (
          <span className="dock-launcher__entry-stats">
            <span className="dock-launcher__entry-stats-added">+{diffStats.added.toLocaleString()}</span>
            <span className="dock-launcher__entry-stats-removed">-{diffStats.removed.toLocaleString()}</span>
          </span>
        ) : null}
        <ChevronRight size={14} className="dock-launcher__entry-chevron" />
      </button>
    );
  };

  if (spaceMode === "hidden") return null;

  return (
    <div
      ref={rootRef}
      className="dock-launcher"
      role="toolbar"
      aria-label={t("rightDock.launcher")}
    >
      <div className="dock-launcher__header">{t("rightDock.launcherTitle")}</div>
      {mainEntries.map(renderEntry)}
      {activeBranch ? (
        <div className="dock-launcher__branch-wrap">
          <button
            type="button"
            className={`dock-launcher__entry${branchMenuOpen ? " dock-launcher__entry--open" : ""}`}
            aria-label={`${t("status.gitBranchTitle")}: ${activeBranch}`}
            aria-expanded={branchMenuOpen}
            title={`${t("status.gitBranchTitle")}: ${activeBranch}`}
            onClick={toggleBranchMenu}
          >
            <GitBranch size={16} />
            <span className="dock-launcher__entry-label">{activeBranch}</span>
            <ChevronRight size={14} className="dock-launcher__entry-chevron dock-launcher__entry-chevron--down" />
          </button>
          {branchMenuOpen ? (
            <div className="dock-launcher__branch-menu" role="menu" aria-label={t("rightDock.switchBranch")}>
              <div className="dock-launcher__branch-search">
                <Search size={13} />
                <input
                  ref={branchSearchRef}
                  type="text"
                  value={branchQuery}
                  placeholder={t("rightDock.branchSearchPlaceholder")}
                  onChange={(event) => {
                    setBranchQuery(event.target.value);
                    setBranchSwitchErr("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (exactMatch) void checkoutBranch(trimmedQuery);
                    else if (canCreate) void createBranch(trimmedQuery);
                  }}
                />
              </div>
              <div className="dock-launcher__branch-section">{t("rightDock.branchSection")}</div>
              <div className="dock-launcher__branch-list">
                {branchesLoading ? <div className="dock-launcher__branch-menu-note">{t("rightDock.branchMenuLoading")}</div> : null}
                {!branchesLoading && branchesErr ? <div className="dock-launcher__branch-menu-note dock-launcher__branch-menu-note--err">{branchesErr}</div> : null}
                {!branchesLoading && !branchesErr && filteredBranches.length === 0 ? (
                  <div className="dock-launcher__branch-menu-note">{t("rightDock.branchNoMatch")}</div>
                ) : null}
                {filteredBranches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    role="menuitem"
                    className={`dock-launcher__branch-item${branch === activeBranch ? " dock-launcher__branch-item--active" : ""}`}
                    title={branch}
                    disabled={switchingBranch !== ""}
                    onClick={() => void checkoutBranch(branch)}
                  >
                    <GitBranch size={14} />
                    <span className="dock-launcher__branch-item-name">{branch}</span>
                    {switchingBranch === branch ? (
                      <span className="dock-launcher__branch-menu-spinner" aria-hidden="true" />
                    ) : branch === activeBranch ? (
                      <Check size={14} />
                    ) : null}
                  </button>
                ))}
              </div>
              {branchSwitchErr ? <div className="dock-launcher__branch-menu-note dock-launcher__branch-menu-note--err">{branchSwitchErr}</div> : null}
              <div className="dock-launcher__branch-create">
                <button
                  type="button"
                  role="menuitem"
                  className="dock-launcher__branch-item dock-launcher__branch-item--create"
                  disabled={!canCreate || switchingBranch !== ""}
                  title={canCreate ? trimmedQuery : undefined}
                  onClick={() => void createBranch(trimmedQuery)}
                >
                  {switchingBranch === trimmedQuery ? (
                    <span className="dock-launcher__branch-menu-spinner" aria-hidden="true" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span className="dock-launcher__branch-item-name">
                    {t("rightDock.branchCreate")}
                    {trimmedQuery ? ` ${trimmedQuery}` : ""}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {secondaryEntries.length > 0 && <div className="dock-launcher__divider" role="presentation" />}
      {secondaryEntries.map(renderEntry)}
    </div>
  );
}
