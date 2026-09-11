// TabContainer is the right dock's tab shell: the tab strip on top (with the
// + add menu) and the active tab's panel below, routed through TabContent.
// The ActivityBar sits to its left inside the workbench-dock (rendered by
// App); panel content is provided as a renderer because the panels need App's
// props. When the last tab is closed the container collapses (the
// conversation snapshot's `open` flips false in the store), so this component
// only renders while tabs exist.
//
// The whole shell is bound to ONE conversation via conversationDockInput:
// every action below is keyed to that conversation's snapshot, so tabs can
// never leak across conversations.

import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { ConversationDockIdentityInput } from "../../lib/conversationDockIdentity";
import { conversationDockKey } from "../../lib/conversationDockIdentity";
import { useActivityBarStore, useConversationDock, type TabItem, type TabType } from "../../store/activityBar";
import { TabAddMenu } from "./TabAddMenu";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface TabContainerProps {
  /** App-provided panel renderer for a given tab. */
  renderTab: (tab: TabItem) => ReactNode;
  /** Active session tab id — forwarded to the tab bar for workspace-scoped
   *  file operations in the file-tab context menu. */
  workspaceTabId?: string;
  /** Identity of the conversation this dock shell belongs to. */
  conversationDockInput: ConversationDockIdentityInput;
}

export function TabContainer({ renderTab, workspaceTabId, conversationDockInput }: TabContainerProps) {
  const dock = useConversationDock(conversationDockInput);
  const conversationKey = useMemo(() => conversationDockKey(conversationDockInput), [conversationDockInput]);
  const addMenuOpen = useActivityBarStore((s) => s.addMenuOpen);
  const setAddMenuOpen = useActivityBarStore((s) => s.setAddMenuOpen);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const tabs = dock.tabs;
  const activeTabId = dock.activeTabId;
  const addTab = dock.addTab;
  const closeTab = dock.closeTab;
  const activateTab = dock.activateTab;
  const moveTab = dock.moveTab;
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

  return (
    <div className="tab-container">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onMoveTab={moveTab}
        onAdd={() => setAddMenuOpen(!addMenuOpen)}
        addButtonRef={addButtonRef}
        workspaceTabId={workspaceTabId}
        conversationKey={conversationKey}
      />
      {addMenuOpen && <TabAddMenu anchorRef={addButtonRef} onPick={handlePickTab} onClose={() => setAddMenuOpen(false)} />}
      <div className="tab-container__content">
        <TabContent activeTab={activeTab} renderTab={renderTab} />
      </div>
    </div>
  );
}
