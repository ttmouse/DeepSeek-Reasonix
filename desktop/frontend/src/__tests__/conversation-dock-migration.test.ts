// Run: tsx src/__tests__/conversation-dock-migration.test.ts
// Legacy migration contract: a conversation's first open copies the old
// project-scoped dock and navigation state exactly once, then the copy is
// fully independent. Corrupt legacy data falls back to defaults.

import { JSDOM } from "jsdom";

const dom = new JSDOM("", { url: "https://reasonix.local/" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { useActivityBarStore } = await import("../store/activityBar");
const {
  CONVERSATION_DOCK_STORAGE_KEY,
  readConversationDockRecord,
  readLegacyDockSeed,
  readLegacyWorkspaceNavigation,
  registerConversationDockLegacyContext,
  resetConversationDockPersistenceForTests,
  resetLegacyWorkspacePersistenceCacheForTests,
} = await import("../lib/conversationDockPersistence");

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function reset(): void {
  localStorage.clear();
  resetConversationDockPersistenceForTests();
  resetLegacyWorkspacePersistenceCacheForTests();
  useActivityBarStore.getState().resetConversationDockForTests();
}

console.log("\nconversation dock migration");

const ROOT = "/work/legacy";

// --- legacy dock tabs + open preference seed the first conversation ---
reset();
localStorage.setItem(
  "reasonix.dock.tabs." + ROOT,
  JSON.stringify({
    tabs: [
      { id: "dock-tab-1", type: "file", label: "Files", meta: { path: "/a.ts" } },
      { id: "dock-tab-2", type: "changed", label: "Changes" },
    ],
    activeTabId: "dock-tab-2",
  }),
);
localStorage.setItem("reasonix.workspacePanel.open." + ROOT, "1");

const seed = readLegacyDockSeed(ROOT);
check("legacy seed copies tabs", seed?.tabs.length === 2 && seed.tabs[1].type === "changed", "tabs not copied");
check("legacy seed copies activeTabId", seed?.activeTabId === "dock-tab-2", "active tab not copied");
check("legacy seed derives open from the workspacePanel preference", seed?.open === true, "open mismatch");

// A conversation with no envelope record seeds from legacy on first use.
// App registers the identity context for the active conversation (mirrored
// here) so imperative store callers can seed too.
const key = "local:project:" + ROOT + ":topic-9:0";
registerConversationDockLegacyContext(key, { scope: "project", workspaceRoot: ROOT });
useActivityBarStore.getState().openEntry(key, "file", "Files"); // first mutation seeds
const snapshot = useActivityBarStore.getState().snapshots[key];
// openEntry reuses the legacy file tab, so the snapshot keeps both legacy tabs.
check("first conversation of a project inherits the legacy dock", snapshot?.tabs.length === 2, "legacy dock not inherited");
check("legacy dock tabs keep their ids in the inherited snapshot", snapshot?.tabs.some((tab) => tab.id === "dock-tab-1") === true, "legacy ids lost");
check("the inherited snapshot activates the reused legacy tab", snapshot?.activeTabId === "dock-tab-1", "legacy activation lost");

// --- the copy is one-time: mutating the copy never rewrites the legacy key ---
useActivityBarStore.getState().closeTab(key, "dock-tab-1");
const legacyAfter = JSON.parse(localStorage.getItem("reasonix.dock.tabs." + ROOT) ?? "{}");
check("legacy key is untouched after the copy diverges", legacyAfter.tabs.length === 2, "legacy key rewritten");

// --- a second conversation of the same project also seeds, then diverges ---
const keyB = "local:project:" + ROOT + ":topic-10:0";
registerConversationDockLegacyContext(keyB, { scope: "project", workspaceRoot: ROOT });
useActivityBarStore.getState().openEntry(keyB, "terminal", "Terminal");
check("second conversation copies the same legacy tabs", useActivityBarStore.getState().snapshots[keyB]?.tabs.length === 3, "second copy missing");
check("the two copies are not shared references", useActivityBarStore.getState().snapshots[key].tabs !== useActivityBarStore.getState().snapshots[keyB].tabs, "shared reference");

// --- legacy global open preference falls back for a root without its own key ---
reset();
localStorage.setItem("reasonix.workspacePanel.open", "0");
localStorage.setItem("reasonix.dock.tabs." + ROOT, JSON.stringify({ tabs: [{ id: "dock-tab-1", type: "file", label: "Files" }], activeTabId: "dock-tab-1" }));
const globalFallback = readLegacyDockSeed(ROOT);
check("legacy global open preference applies when the project key is missing", globalFallback?.open === false, "global fallback mismatch");

// --- collapsed-with-tabs legacy state keeps the tabs but starts closed ---
reset();
localStorage.setItem("reasonix.dock.tabs." + ROOT, JSON.stringify({ tabs: [{ id: "dock-tab-1", type: "file", label: "Files" }], activeTabId: "dock-tab-1" }));
localStorage.setItem("reasonix.workspacePanel.open." + ROOT, "0");
const collapsedSeed = readLegacyDockSeed(ROOT);
check("collapsed legacy state keeps tabs but starts closed", collapsedSeed?.tabs.length === 1 && collapsedSeed?.open === false, "collapsed seed mismatch");

// --- legacy project navigation (workspaceState.v2) seeds per conversation ---
reset();
localStorage.setItem(
  "reasonix.workspaceState.v2",
  JSON.stringify({
    version: 2,
    projects: [
      {
        key: "project\u0000" + ROOT,
        state: {
          openDirs: ["", "src/"],
          selectedFilePath: "src/App.tsx",
          selectedChangePath: "src/store.ts",
          scrollTop: 144,
          recentPaths: ["src/App.tsx", "README.md"],
          updatedAt: 1,
        },
      },
    ],
  }),
);
const legacyNav = readLegacyWorkspaceNavigation("project", ROOT);
check("legacy navigation seed restores selections", legacyNav?.selectedFilePath === "src/App.tsx" && legacyNav?.selectedChangePath === "src/store.ts", "selection not restored");
check("legacy navigation seed restores dirs and scroll", legacyNav?.openDirs.includes("src/") === true && legacyNav?.scrollTop === 144, "dirs/scroll not restored");
check("legacy navigation seed restores recent paths", legacyNav?.recentPaths.includes("README.md") === true, "recent paths not restored");
check("legacy navigation seed for a foreign project is null", readLegacyWorkspaceNavigation("project", "/other") === null, "foreign project leaked");

// --- corrupt legacy data falls back to defaults ---
reset();
localStorage.setItem("reasonix.dock.tabs." + ROOT, "{not-json");
check("corrupt legacy tabs produce null (defaults)", readLegacyDockSeed(ROOT) === null, "corrupt tabs leaked");
localStorage.setItem("reasonix.workspaceState.v2", "not-json");
check("corrupt legacy navigation produces null", readLegacyWorkspaceNavigation("project", ROOT) === null, "corrupt nav leaked");

// --- legacy keys are never deleted (rollback safety) ---
reset();
localStorage.setItem("reasonix.dock.tabs." + ROOT, JSON.stringify({ tabs: [{ id: "dock-tab-1", type: "file", label: "Files" }], activeTabId: "dock-tab-1" }));
useActivityBarStore.getState().openEntry("local:project:" + ROOT + ":topic-9:0", "file", "Files");
const legacyKept = localStorage.getItem("reasonix.dock.tabs." + ROOT);
check("legacy keys survive the migration", legacyKept !== null && legacyKept.includes("dock-tab-1"), "legacy key deleted");

// --- migrated state is durable in the new envelope ---
reset();
localStorage.setItem("reasonix.dock.tabs." + ROOT, JSON.stringify({ tabs: [{ id: "dock-tab-1", type: "file", label: "Files" }], activeTabId: "dock-tab-1" }));
registerConversationDockLegacyContext("local:project:" + ROOT + ":topic-9:0", { scope: "project", workspaceRoot: ROOT });
useActivityBarStore.getState().openEntry("local:project:" + ROOT + ":topic-9:0", "file", "Files");
const record = readConversationDockRecord("local:project:" + ROOT + ":topic-9:0");
check("migration writes the new envelope", record?.dock.tabs.length === 1 && JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "{}").conversations?.length === 1, "envelope not written");

console.log(`\nconversation-dock-migration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
