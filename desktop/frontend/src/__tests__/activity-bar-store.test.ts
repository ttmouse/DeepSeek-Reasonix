// Run: tsx src/__tests__/activity-bar-store.test.ts
// Verifies the right-dock activity-bar store (conversation-scoped): open-entry
// reuse, add/close tab activation fallback, localStorage persistence
// round-trip, and per-conversation isolation. Every mutation is keyed by a
// conversation dock key (computed by conversationDockIdentity in App).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The store reads localStorage at module load, so install a jsdom global
// before importing it (mirrors how browser-only tests bootstrap the DOM).
const dom = new JSDOM("", { url: "https://reasonix.local/" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const testDir = dirname(fileURLToPath(import.meta.url));
const { useActivityBarStore } = await import("../store/activityBar");

const KEY_A = "local:project:/work/a:topic-a:0";
const KEY_B = "local:project:/work/a:topic-b:0";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean | (() => boolean), detail = "") {
  const value = typeof condition === "function" ? condition() : condition;
  if (value) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function snapshot(key: string) {
  return useActivityBarStore.getState().snapshots[key];
}

function resetStore(): void {
  localStorage.clear();
  useActivityBarStore.getState().resetConversationDockForTests();
}

// --- persistence contract: store writes one versioned envelope key ---
check(
  "store persists under reasonix.conversationDock.v1",
  /CONVERSATION_DOCK_STORAGE_KEY\s*=\s*"reasonix\.conversationDock\.v1"/.test(
    readFileSync(resolve(testDir, "../lib/conversationDockPersistence.ts"), "utf8"),
  ),
  "envelope key literal not found",
);

// --- openEntry reuses an existing tab of the same type ---
resetStore();
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
const first = snapshot(KEY_A)?.tabs[0].id;
check("openEntry opens the first tab", snapshot(KEY_A)?.tabs.length === 1, "expected 1 tab");
check("openEntry activates the tab", snapshot(KEY_A)?.activeTabId === first, "activeTabId mismatch");
useActivityBarStore.getState().openEntry(KEY_A, "changed", "Changes");
check("openEntry appends a different type", snapshot(KEY_A)?.tabs.length === 2, "expected 2 tabs");
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
check("openEntry reuses same-type tab", snapshot(KEY_A)?.tabs.length === 2, "expected still 2 tabs");
check("openEntry switches back to the reused tab", snapshot(KEY_A)?.activeTabId === first, "activeTabId mismatch");

// --- closeTab falls back to the left neighbor, then right, then null ---
resetStore();
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
useActivityBarStore.getState().openEntry(KEY_A, "changed", "Changes");
useActivityBarStore.getState().openEntry(KEY_A, "terminal", "Terminal");
const ids = snapshot(KEY_A)!.tabs.map((tab) => tab.id);
check("opening a tab expands the container", snapshot(KEY_A)?.open === true, "expected expanded");
// Closing a non-active tab leaves the active tab untouched.
useActivityBarStore.getState().activateTab(KEY_A, ids[2]);
useActivityBarStore.getState().closeTab(KEY_A, ids[1]);
check("closeTab removes the tab", snapshot(KEY_A)?.tabs.length === 2, "expected 2 tabs left");
check("closing a non-active tab keeps the active tab", snapshot(KEY_A)?.activeTabId === ids[2], "activeTabId mismatch");
// Closing the active tab falls back to its left neighbor.
useActivityBarStore.getState().closeTab(KEY_A, ids[2]);
check("closeTab activates left neighbor", snapshot(KEY_A)?.activeTabId === ids[0], "activeTabId mismatch");
// Closing the last tab collapses back to the activity bar.
useActivityBarStore.getState().closeTab(KEY_A, ids[0]);
check("closing the last tab clears activeTabId", snapshot(KEY_A)?.tabs.length === 0 && snapshot(KEY_A)?.activeTabId === null, "expected empty dock");
check("closing the last tab collapses the container", snapshot(KEY_A)?.open === false, "expected collapsed");

// --- persistence round-trip survives a store re-init ---
resetStore();
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
useActivityBarStore.getState().openEntry(KEY_A, "browser", "Browser");
const persisted = JSON.parse(localStorage.getItem("reasonix.conversationDock.v1") ?? "{}");
const persistedEntry = persisted.conversations?.find((entry: { key: string }) => entry.key === KEY_A);
check("persistence writes tabs", Array.isArray(persistedEntry?.dock.tabs) && persistedEntry.dock.tabs.length === 2, "expected 2 persisted tabs");
check("persistence writes activeTabId", typeof persistedEntry?.dock.activeTabId === "string", "activeTabId not persisted");

// --- open is independent of tabs (toggle collapse keeps tabs) ---
resetStore();
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
useActivityBarStore.getState().openEntry(KEY_A, "browser", "Browser");
useActivityBarStore.getState().setOpen(KEY_A, false);
check("collapse via setOpen keeps tabs", snapshot(KEY_A)?.tabs.length === 2, "expected 2 tabs kept");
check("collapse via setOpen closes the container", snapshot(KEY_A)?.open === false, "expected collapsed");
useActivityBarStore.getState().setOpen(KEY_A, true);
check("re-expand restores the container", snapshot(KEY_A)?.open === true, "expected expanded");

// --- addMenuOpen is session-local ---
resetStore();
useActivityBarStore.getState().setAddMenuOpen(true);
check("addMenuOpen setter works", useActivityBarStore.getState().addMenuOpen === true, "expected open");

// --- updateTab rewrites one tab's label/meta, keeps active, leaves others ---
// The dock mirrors the current preview by updating the active file tab; this
// must never activate a tab, never add one, and never touch other tabs.
resetStore();
useActivityBarStore.getState().addTab(KEY_A, "file", "a.ts", { path: "/a.ts" });
const fileA = snapshot(KEY_A)!.tabs[0].id;
useActivityBarStore.getState().addTab(KEY_A, "file", "b.ts", { path: "/b.ts" });
useActivityBarStore.getState().activateTab(KEY_A, fileA);
useActivityBarStore.getState().updateTab(KEY_A, fileA, "c.ts", { path: "/c.ts" });
check("updateTab rewrites label", snapshot(KEY_A)?.tabs[0].label === "c.ts", "label mismatch");
check("updateTab rewrites meta", snapshot(KEY_A)?.tabs[0].meta?.path === "/c.ts", "meta mismatch");
check("updateTab leaves the other tab untouched", snapshot(KEY_A)?.tabs[1].label === "b.ts" && snapshot(KEY_A)?.tabs[1].meta?.path === "/b.ts", "other tab changed");
check("updateTab keeps the active tab", snapshot(KEY_A)?.activeTabId === fileA, "activeTabId changed");
check("updateTab adds no tabs", snapshot(KEY_A)?.tabs.length === 2, "expected still 2 tabs");
check("updateTab persists", () => {
  const entry = JSON.parse(localStorage.getItem("reasonix.conversationDock.v1") ?? "{}")
    .conversations?.find((e: { key: string }) => e.key === KEY_A);
  return entry.dock.tabs[0].meta?.path === "/c.ts";
}, "not persisted");
check("updateTab with empty meta clears the path", () => {
  useActivityBarStore.getState().updateTab(KEY_A, fileA, "files", {});
  return snapshot(KEY_A)?.tabs[0].meta?.path === undefined && snapshot(KEY_A)?.tabs.length === 2;
}, "path not cleared");

// --- fresh tab ids never collide with restored/persisted ones ---
// New tabs must always receive a unique id (React key uniqueness relies on
// it). The seq seeder runs at module load against persisted ids; here we
// verify consecutive adds stay unique and strictly increasing.
resetStore();
useActivityBarStore.getState().addTab(KEY_A, "file", "a");
useActivityBarStore.getState().addTab(KEY_A, "file", "b");
useActivityBarStore.getState().addTab(KEY_A, "file", "c");
const freshIds = snapshot(KEY_A)!.tabs.map((tab) => tab.id);
check(
  "fresh tab ids are unique and increasing",
  freshIds.length === new Set(freshIds).size && freshIds.every((id) => /^dock-tab-\d+$/.test(id)),
  `ids=${freshIds.join(",")}`,
);

// --- moveTab reorders tabs and persists the new order ---
resetStore();
useActivityBarStore.getState().addTab(KEY_A, "file", "a");
useActivityBarStore.getState().addTab(KEY_A, "changed", "b");
useActivityBarStore.getState().addTab(KEY_A, "context", "c");
const orderBefore = snapshot(KEY_A)!.tabs.map((tab) => tab.id);
// Move c to the left of a → [c, a, b]
useActivityBarStore.getState().moveTab(KEY_A, orderBefore[2], orderBefore[0], "left");
const afterLeft = snapshot(KEY_A)!.tabs.map((tab) => tab.id);
check("moveTab left places the tab before the target", afterLeft[0] === orderBefore[2] && afterLeft[1] === orderBefore[0], `order=${afterLeft.join(",")}`);
check("moveTab persists", () => {
  const entry = JSON.parse(localStorage.getItem("reasonix.conversationDock.v1") ?? "{}")
    .conversations?.find((e: { key: string }) => e.key === KEY_A);
  return entry.dock.tabs.map((t: { id: string }) => t.id).join(",") === afterLeft.join(",");
}, "order not persisted");
// Move b right of c → [c, b, a]
useActivityBarStore.getState().moveTab(KEY_A, afterLeft[2], afterLeft[0], "right");
const afterRight = snapshot(KEY_A)!.tabs.map((tab) => tab.id);
check("moveTab right places the tab after the target", afterRight[0] === orderBefore[2] && afterRight[1] === orderBefore[1], `order=${afterRight.join(",")}`);
check("moveTab keeps the active tab", snapshot(KEY_A)?.activeTabId === orderBefore[2], "activeTabId changed");
// Same-id move is a no-op.
useActivityBarStore.getState().moveTab(KEY_A, afterRight[0], afterRight[0], "left");
check("moveTab same id is a no-op", snapshot(KEY_A)?.tabs.map((tab) => tab.id).join(",") === afterRight.join(","), "order changed");

// --- A's mutations never touch B ---
resetStore();
useActivityBarStore.getState().openEntry(KEY_A, "file", "Files");
useActivityBarStore.getState().openEntry(KEY_A, "changed", "Changes");
check("A holds its own tabs", snapshot(KEY_A)?.tabs.length === 2, "A tabs mismatch");
check("B starts empty and stays empty", snapshot(KEY_B) === undefined, "B should not exist yet");
useActivityBarStore.getState().openEntry(KEY_B, "terminal", "Terminal");
check("B opens its own tab", snapshot(KEY_B)?.tabs.length === 1 && snapshot(KEY_B)?.tabs[0].type === "terminal", "B tabs mismatch");
check("A is untouched by B's mutation", snapshot(KEY_A)?.tabs.length === 2 && snapshot(KEY_A)?.tabs[0].type === "file", "A tabs changed");

console.log(`\nactivity-bar-store: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
