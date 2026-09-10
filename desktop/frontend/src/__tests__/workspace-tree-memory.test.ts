// Run: tsx src/__tests__/workspace-tree-memory.test.ts
// Conversation-scoped workspace navigation memory: per-conversation isolation,
// immediate in-memory scroll updates with coalesced persistence, and safe
// handling of corrupt/future storage. Persistence lives in the shared
// conversation envelope (reasonix.conversationDock.v1).

import { JSDOM } from "jsdom";
import {
  flushWorkspaceTreeMemory,
  readWorkspaceTreeMemory,
  rememberWorkspaceTreeScroll,
  rememberWorkspaceTreeState,
  resetWorkspaceTreeMemoryForTests,
} from "../lib/workspaceTreeMemory";
import {
  CONVERSATION_DOCK_STORAGE_KEY,
  registerConversationDockLegacyContext,
  resetConversationDockPersistenceForTests,
} from "../lib/conversationDockPersistence";
import {
  createWorkspaceTreePersistenceScheduler,
  type WorkspaceTreePersistenceClock,
} from "../lib/workspaceTreePersistence";

let passed = 0;
function ok(value: boolean, label: string): void {
  if (!value) throw new Error(label);
  passed += 1;
  process.stdout.write(`  PASS  ${label}\n`);
}

const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.localStorage = dom.window.localStorage;

console.log("\nconversation-scoped workspace memory");
resetWorkspaceTreeMemoryForTests();
resetConversationDockPersistenceForTests();

const keyA = "local:project:/work/a:topic-1:0\u0000dock-tab-1";
const keyB = "local:project:/work/a:topic-2:0\u0000dock-tab-1";

rememberWorkspaceTreeState(keyA, {
  openDirs: new Set(["", "src/"]),
  selectedFilePath: "src/App.tsx",
  selectedChangePath: "src/store.ts",
  scrollTop: 144,
});
rememberWorkspaceTreeState(keyB, { selectedFilePath: "README.md" });

const projectA = readWorkspaceTreeMemory(keyA);
const projectB = readWorkspaceTreeMemory(keyB);
ok(projectA?.selectedFilePath === "src/App.tsx", "restores the file selection independently");
ok(projectA?.selectedChangePath === "src/store.ts", "restores the change selection independently");
ok(projectA?.openDirs.has("src/") === true && projectA.scrollTop === 144, "restores expanded directories and tree scroll");
ok(projectB?.selectedFilePath === "README.md", "keeps conversation state isolated by key");
ok(readWorkspaceTreeMemory("local:project:/work/a:topic-3:0\u0000dock-tab-1") === null, "unvisited conversations read null");

// The envelope is versioned and holds both dock + navigation per conversation.
const persisted = JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "null") as {
  version?: number;
  conversations?: Array<{ key?: string; workspaceNavigation?: Record<string, unknown> }>;
} | null;
ok(persisted?.version === 1, "writes an explicit schema version (conversation envelope)");
const convA = persisted?.conversations?.find((entry) => entry.key === "local:project:/work/a:topic-1:0");
ok(convA?.workspaceNavigation?.["dock-tab-1"] !== undefined, "navigation persists inside the conversation record");

let synchronousWrites = 0;
const originalStorage = globalThis.localStorage;
const countingStorage: Storage = {
  get length() { return originalStorage.length; },
  clear: () => originalStorage.clear(),
  getItem: (key) => originalStorage.getItem(key),
  key: (index) => originalStorage.key(index),
  removeItem: (key) => originalStorage.removeItem(key),
  setItem: (key, value) => {
    synchronousWrites += 1;
    originalStorage.setItem(key, value);
  },
};
globalThis.localStorage = countingStorage;
for (let index = 0; index < 120; index += 1) rememberWorkspaceTreeScroll(keyA, 200 + index);
ok(synchronousWrites === 0, "keeps high-frequency scroll updates off the synchronous storage path");
ok(readWorkspaceTreeMemory(keyA)?.scrollTop === 319, "updates the in-memory scroll position immediately");
flushWorkspaceTreeMemory();
ok(synchronousWrites === 1, "coalesces 120 scroll updates into one durable write");
globalThis.localStorage = originalStorage;
const scrollPersisted = JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "{}")
  .conversations.find((entry: { key: string }) => entry.key === "local:project:/work/a:topic-1:0")
  .workspaceNavigation["dock-tab-1"].scrollTop;
ok(scrollPersisted === 319, "the coalesced write lands in the conversation envelope");

let nextHandle = 1;
const frames = new Map<number, () => void>();
const timers = new Map<number, () => void>();
const fakeClock: WorkspaceTreePersistenceClock = {
  requestFrame(callback) {
    const handle = nextHandle++;
    frames.set(handle, callback);
    return handle;
  },
  cancelFrame(handle) {
    frames.delete(handle);
  },
  setTimer(callback) {
    const handle = nextHandle++;
    timers.set(handle, callback);
    return handle as unknown as ReturnType<typeof setTimeout>;
  },
  clearTimer(handle) {
    timers.delete(handle as unknown as number);
  },
};
const persistedKeys: string[] = [];
const scheduler = createWorkspaceTreePersistenceScheduler((key) => persistedKeys.push(key), 200, fakeClock);
for (let index = 0; index < 120; index += 1) scheduler.schedule(keyA);
ok(frames.size === 1 && timers.size === 0, "allows at most one persistence scheduling frame");
for (const callback of Array.from(frames.values())) callback();
frames.clear();
ok(timers.size === 1 && persistedKeys.length === 0, "waits for the quiet-period timer after the frame");
for (const callback of Array.from(timers.values())) callback();
timers.clear();
ok(persistedKeys.join(",") === keyA, "persists the final key once after the quiet period");

scheduler.schedule(keyB);
scheduler.flush();
ok(
  frames.size === 0 && persistedKeys[persistedKeys.length - 1] === keyB,
  "flushes pending state before a scope or page exit",
);

// Legacy v2 navigation seeds a conversation's first read, then diverges.
resetWorkspaceTreeMemoryForTests();
resetConversationDockPersistenceForTests();
localStorage.setItem(
  "reasonix.workspaceState.v2",
  JSON.stringify({
    version: 2,
    projects: [{ key: "project\u0000/work/legacy", state: { openDirs: ["", "src/"], selectedFilePath: "src/App.tsx", scrollTop: 77 } }],
  }),
);
registerConversationDockLegacyContext("local:project:/work/legacy:topic-9:0", { scope: "project", workspaceRoot: "/work/legacy" });
const legacySeeded = readWorkspaceTreeMemory("local:project:/work/legacy:topic-9:0\u0000dock-tab-1");
ok(legacySeeded?.selectedFilePath === "src/App.tsx" && legacySeeded.scrollTop === 77, "seeds legacy project navigation on first read");
const legacyPersisted = JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "{}").conversations?.find(
  (entry: { key: string }) => entry.key === "local:project:/work/legacy:topic-9:0",
);
ok(legacyPersisted?.workspaceNavigation?.["dock-tab-1"] !== undefined, "the legacy copy lands in the conversation record");
// The copy is one-time: diverging writes never touch the v2 key.
rememberWorkspaceTreeState("local:project:/work/legacy:topic-9:0\u0000dock-tab-1", { selectedFilePath: "src/other.ts" });
const legacyRaw = JSON.parse(localStorage.getItem("reasonix.workspaceState.v2") ?? "{}");
ok(legacyRaw.projects[0].state.selectedFilePath === "src/App.tsx", "legacy key is untouched after the copy diverges");

resetWorkspaceTreeMemoryForTests();
resetConversationDockPersistenceForTests();
localStorage.setItem(CONVERSATION_DOCK_STORAGE_KEY, JSON.stringify({ version: 99, conversations: [{ key: "future", dock: { tabs: [] } }] }));
ok(readWorkspaceTreeMemory("future\u0000tab") === null, "safely ignores storage from an unsupported future schema");

resetWorkspaceTreeMemoryForTests();
resetConversationDockPersistenceForTests();
localStorage.setItem(CONVERSATION_DOCK_STORAGE_KEY, "{not-json");
ok(readWorkspaceTreeMemory("broken\u0000tab") === null, "a corrupt cache cannot prevent workspace startup");

dom.window.close();
console.log(`\n${passed} passed, 0 failed, ${passed} total`);
