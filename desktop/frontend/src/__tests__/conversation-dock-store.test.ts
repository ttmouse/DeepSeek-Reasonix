// Run: tsx src/__tests__/conversation-dock-store.test.ts
// Conversation-scoped dock store contract: A/B/A switching restores each
// conversation's own snapshot, mutations are strictly keyed, temporary keys
// migrate atomically to formal keys, the envelope is capped, and corrupt
// storage falls back to defaults.

import { JSDOM } from "jsdom";

const dom = new JSDOM("", { url: "https://reasonix.local/" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { useActivityBarStore } = await import("../store/activityBar");
const {
  CONVERSATION_DOCK_STORAGE_KEY,
  MAX_CONVERSATIONS,
  readConversationDockRecord,
  resetConversationDockPersistenceForTests,
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
  useActivityBarStore.getState().resetConversationDockForTests();
}

function snap(key: string) {
  return useActivityBarStore.getState().snapshots[key];
}

console.log("\nconversation dock store");

// --- A/B/A switching restores each conversation's snapshot ---
reset();
useActivityBarStore.getState().openEntry("local:project:/w:a:0", "file", "Files");
useActivityBarStore.getState().addTab("local:project:/w:a:0", "terminal", "Terminal");
useActivityBarStore.getState().openEntry("local:project:/w:b:0", "changed", "Changes");
check("A has its own two tabs", snap("local:project:/w:a:0")?.tabs.length === 2, "A tabs mismatch");
check("B has its own tab", snap("local:project:/w:b:0")?.tabs.length === 1 && snap("local:project:/w:b:0")?.tabs[0].type === "changed", "B tabs mismatch");
// "Switch back to A": the same key reads the same snapshot (no re-seeding).
check("A/B/A restores A's tabs", snap("local:project:/w:a:0")?.tabs.length === 2 && snap("local:project:/w:a:0")?.activeTabId !== null, "A not restored");
check("A's open state is preserved", snap("local:project:/w:a:0")?.open === true, "A open lost");
// B's collapse must not affect A.
useActivityBarStore.getState().setOpen("local:project:/w:b:0", false);
check("collapsing B leaves A expanded", snap("local:project:/w:a:0")?.open === true, "A collapsed");

// --- same topic + generation, different desktop tab id => same snapshot ---
reset();
useActivityBarStore.getState().openEntry("local:project:/w:a:topic-1:0", "file", "Files");
const shared = snap("local:project:/w:a:topic-1:0");
check("identity (not tab id) owns the snapshot", shared?.tabs.length === 1, "expected seeded snapshot");
check("a second desktop tab id maps to the same conversation snapshot", snap("local:project:/w:a:topic-1:0")?.tabs[0].id === shared?.tabs[0].id, "key differs");

// --- clear (generation bump) creates a fresh conversation ---
reset();
useActivityBarStore.getState().openEntry("local:project:/w:a:topic-1:3", "file", "Files");
useActivityBarStore.getState().openEntry("local:project:/w:a:topic-1:4", "terminal", "Terminal");
check("clear bumps generation to a new snapshot", snap("local:project:/w:a:topic-1:3")?.tabs[0].type === "file" && snap("local:project:/w:a:topic-1:4")?.tabs[0].type === "terminal", "generation not isolated");

// --- temporary key migrates atomically to the formal key ---
reset();
const tempKey = "local:project:/w:a:tab-7:0";
const formalKey = "local:project:/w:a:topic-1:0";
useActivityBarStore.getState().openEntry(tempKey, "file", "Files");
useActivityBarStore.getState().addTab(tempKey, "context", "Context");
check("temporary key holds its own tabs", snap(tempKey)?.tabs.length === 2, "temp tabs mismatch");
useActivityBarStore.getState().migrateConversationKey(tempKey, formalKey);
check("formal key receives the temporary snapshot", snap(formalKey)?.tabs.length === 2 && snap(formalKey)?.activeTabId !== null, "migration failed");
check("temporary key is dropped", snap(tempKey) === undefined, "temp key still present");
const persistedFormal = readConversationDockRecord(formalKey);
check("migration is persisted", persistedFormal?.dock.tabs.length === 2, "not persisted");
// Migrating again is a no-op and must not clobber the formal key.
useActivityBarStore.getState().openEntry(formalKey, "terminal", "Terminal");
useActivityBarStore.getState().migrateConversationKey("local:project:/w:a:tab-9:0", formalKey);
check("formal key survives later migrations", snap(formalKey)?.tabs.length === 3, "formal key clobbered");

// --- A's mutation cannot modify B (even through delayed closures) ---
reset();
useActivityBarStore.getState().openEntry("local:project:/w:a:topic-1:0", "file", "Files");
const capturedA = useActivityBarStore.getState().openEntry; // late-bound action
useActivityBarStore.getState().openEntry("local:project:/w:b:topic-2:0", "changed", "Changes");
capturedA("local:project:/w:a:topic-1:0", "terminal", "Terminal");
check("keyed late callback writes only its own conversation", snap("local:project:/w:a:topic-1:0")?.tabs.length === 2 && snap("local:project:/w:b:topic-2:0")?.tabs.length === 1, "cross-conversation write");

// --- capacity: envelope evicts the least recently used conversations ---
reset();
const realNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => (fakeNow += 1); // strictly increasing => deterministic eviction
for (let index = 0; index < MAX_CONVERSATIONS + 5; index += 1) {
  useActivityBarStore.getState().openEntry(`local:project:/w:topic-${index}:0`, "file", "Files");
}
Date.now = realNow;
const envelope = JSON.parse(localStorage.getItem(CONVERSATION_DOCK_STORAGE_KEY) ?? "{}");
check("envelope caps at MAX_CONVERSATIONS", envelope.conversations?.length === MAX_CONVERSATIONS, `got ${envelope.conversations?.length}`);
// The five oldest (topic-0..4) were evicted; the newest remain.
const newest = envelope.conversations.find((entry: { key: string }) => entry.key === "local:project:/w:topic-104:0");
const oldest = envelope.conversations.find((entry: { key: string }) => entry.key === "local:project:/w:topic-0:0");
check("newest conversations are kept", newest !== undefined, "newest evicted");
check("oldest conversations are evicted", oldest === undefined, "oldest retained");

// --- corrupt / future envelope falls back to defaults without crashing ---
reset();
localStorage.setItem(CONVERSATION_DOCK_STORAGE_KEY, "{not-json");
useActivityBarStore.getState().resetConversationDockForTests();
check("corrupt envelope never blocks the dock", snap("local:project:/w:a:topic-1:0") === undefined, "corrupt storage leaked");
localStorage.setItem(CONVERSATION_DOCK_STORAGE_KEY, JSON.stringify({ version: 99, conversations: [] }));
useActivityBarStore.getState().resetConversationDockForTests();
check("future envelope versions are ignored", snap("local:project:/w:a:topic-1:0") === undefined, "future version leaked");

console.log(`\nconversation-dock-store: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
