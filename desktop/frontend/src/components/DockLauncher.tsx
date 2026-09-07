// DockLauncher is the floating menu shown over the transcript's top-right
// corner while the right dock is collapsed. It lists the dock's entry points
// (overview / files / changed / remote / instructions); clicking one expands
// the dock to that panel. Once the dock is open the launcher itself is hidden
// (the panel replaces it), so the menu only ever appears in the collapsed
// state. Visual reference: a rounded floating popover card with a title
// header, icon rows and trailing chevrons.

import { useT } from "../lib/i18n";
import { Activity, ChevronRight, FileText, GitBranch, Server } from "lucide-react";
import type { ComponentType } from "react";
import type { TabType } from "../store/activityBar";
import { ACTIVITY_BAR_ENTRIES } from "./ActivityBar/activityBarConfig";

const ENTRY_ICONS: Record<TabType, ComponentType<{ size?: number | string; className?: string }>> = {
  file: FileText,
  changed: GitBranch,
  context: Activity,
  remote: Server,
  // Entries beyond the exposed set are not listed yet; keep a stub so the
  // map stays total if a future config adds them.
  instructions: FileText,
  terminal: FileText,
  browser: FileText,
};

interface DockLauncherProps {
  onSelect: (entryId: string) => void;
}

export function DockLauncher({ onSelect }: DockLauncherProps) {
  const t = useT();
  const mainEntries = ACTIVITY_BAR_ENTRIES.filter((entry) => entry.group !== "secondary");
  const secondaryEntries = ACTIVITY_BAR_ENTRIES.filter((entry) => entry.group === "secondary");

  const renderEntry = (entry: (typeof ACTIVITY_BAR_ENTRIES)[number]) => {
    const Icon = ENTRY_ICONS[entry.defaultTab];
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
        <ChevronRight size={14} className="dock-launcher__entry-chevron" />
      </button>
    );
  };

  return (
    <div className="dock-launcher" role="toolbar" aria-label={t("rightDock.launcher")}>
      <div className="dock-launcher__header">{t("rightDock.launcherTitle")}</div>
      {mainEntries.map(renderEntry)}
      {secondaryEntries.length > 0 && <div className="dock-launcher__divider" role="presentation" />}
      {secondaryEntries.map(renderEntry)}
    </div>
  );
}
