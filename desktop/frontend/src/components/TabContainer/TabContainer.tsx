// TabContainer is the right dock's tab shell: the tab strip on top (with the
// + add menu) and the active tab's panel below, routed through TabContent.
// The ActivityBar sits to its left inside the workbench-dock (rendered by
// App); panel content is provided as a renderer because the panels need App's
// props. When the last tab is closed the container collapses (activityBarOpen
// flips false in the store), so this component only renders while tabs exist.
//
// Closing a browser dock tab also drops its per-page state (URL / history /
// zoom live in browserPagesStore under the dock tab id). The cleanup lives
// here rather than in App so the store stays out of the initial bundle:
// TabContainer is lazy-loaded, so browserPages rides the lazy chunk.

import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useActivityBarStore, type TabItem, type TabType } from "../../store/activityBar";
import { useBrowserPagesStore } from "../../store/browserPages";
import { TabAddMenu } from "./TabAddMenu";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface TabContainerProps {
  /** App-provided panel renderer for a given tab. */
  renderTab: (tab: TabItem) => ReactNode;
  /** Active session tab id — forwarded to the tab bar for workspace-scoped
   *  file operations in the file-tab context menu. */
  workspaceTabId?: string;
}

export function TabContainer({ renderTab, workspaceTabId }: TabContainerProps) {
  const tabs = useActivityBarStore((s) => s.tabs);
  const activeTabId = useActivityBarStore((s) => s.activeTabId);
  const addMenuOpen = useActivityBarStore((s) => s.addMenuOpen);
  const addTab = useActivityBarStore((s) => s.addTab);
  const closeTab = useActivityBarStore((s) => s.closeTab);
  const activateTab = useActivityBarStore((s) => s.activateTab);
  const moveTab = useActivityBarStore((s) => s.moveTab);
  const setAddMenuOpen = useActivityBarStore((s) => s.setAddMenuOpen);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  // Closing the add menu on outside click / Escape lives inside TabAddMenu
  // (it knows its own bounds); the panel itself must not swallow those clicks.

  // Every panel type can be added repeatedly, so the pick handler always
  // appends a fresh tab (no dedup via openEntry).
  const handlePickTab = useCallback(
    (type: TabType, label: string) => {
      addTab(type, label);
    },
    [addTab],
  );

  // Every close path (tab bar ×, context-menu close-others / close-to-right)
  // funnels through here: close the dock tab and, for browser pages, drop the
  // per-page state so a later tab with the same id can never resurrect it.
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = useActivityBarStore.getState().tabs.find((entry) => entry.id === tabId);
      closeTab(tabId);
      if (tab?.type === "browser") useBrowserPagesStore.getState().dropPage(tabId);
    },
    [closeTab],
  );

  return (
    <div className="tab-container">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={handleCloseTab}
        onMoveTab={moveTab}
        onAdd={() => setAddMenuOpen(!addMenuOpen)}
        addButtonRef={addButtonRef}
        workspaceTabId={workspaceTabId}
      />
      {addMenuOpen && <TabAddMenu anchorRef={addButtonRef} onPick={handlePickTab} onClose={() => setAddMenuOpen(false)} />}
      <div className="tab-container__content">
        <TabContent activeTab={activeTab} renderTab={renderTab} />
      </div>
    </div>
  );
}
