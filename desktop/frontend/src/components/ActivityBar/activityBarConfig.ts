// dockEntries lists the right-dock entry points shown in the floating
// launcher (and used by App to map an entry id to its default tab): an id, a
// translated label key, and the default tab type each entry opens. Kept
// icon-free so App can import it synchronously without pulling lucide into
// the initial bundle — DockLauncher (lazy) attaches the icons.
//
// Scope note: the base views (files / changed / context / instructions) are
// exposed; remote (远程) is intentionally NOT listed — it stays reachable via
// the sidebar/status-bar switcher, the command palette and settings, but most
// users never use it, so it does not clutter the workspace menu. Terminal /
// browser are also not listed yet. DockLauncher further hides the changed
// (改动) entry for non-git projects; the branch row only renders when the
// active workspace reports a git branch.

import type { TabType } from "../../store/activityBar";

export interface DockEntryConfig {
  id: string;
  labelKey: string;
  defaultTab: TabType;
  /** "secondary" entries render below a divider in the launcher popover. */
  group?: "main" | "secondary";
}

export const ACTIVITY_BAR_ENTRIES: DockEntryConfig[] = [
  { id: "context", labelKey: "rightDock.overview", defaultTab: "context" },
  { id: "files", labelKey: "workspace.filesTab", defaultTab: "file" },
  { id: "changed", labelKey: "workspace.changedTab", defaultTab: "changed" },
  { id: "instructions", labelKey: "instruction.title", defaultTab: "instructions", group: "secondary" },
];
