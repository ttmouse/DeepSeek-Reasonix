// Run: tsx src/__tests__/conversation-dock-integration.test.tsx
// React integration: useConversationDock binds one dock shell per conversation
// key, the first render after a switch shows ONLY the target conversation's
// state, mutations never leak across conversations, and lifecycle actions
// (/new, clear, fork) start each conversation on an independent empty scene.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);

const { createElement, useState, useCallback } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { useActivityBarStore, useConversationDock } = await import("../store/activityBar");
const { conversationDockKey } = await import("../lib/conversationDockIdentity");
type ConversationDockIdentityInput = import("../lib/conversationDockIdentity").ConversationDockIdentityInput;

let passed = 0;
let failed = 0;
function ok(value: boolean, label: string): void {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

const ROOT = "/work/repo";
function inputFor(topicId: string, generation = 0, scope = "project"): ConversationDockIdentityInput {
  return { tabId: "tab-x", scope, workspaceRoot: ROOT, topicId, sessionGeneration: generation };
}

// Harness: renders the conversation dock of the CURRENT input into data
// attributes so assertions can read exactly what React rendered.
function DockHarness({ input }: { input: ConversationDockIdentityInput }) {
  const dock = useConversationDock(input);
  return createElement("div", {
    "data-testid": "dock",
    "data-tabs": JSON.stringify(dock.tabs.map((tab) => tab.label)),
    "data-active": dock.activeTabId ?? "",
    "data-open": String(dock.open),
    "data-maximized": String(dock.maximized),
  });
}

function AppHarness() {
  const [input, setInput] = useState(inputFor("topic-a", 0));
  const switchTo = useCallback((next: ConversationDockIdentityInput) => setInput(next), []);
  return createElement(
    "div",
    null,
    createElement(DockHarness, { input }),
    createElement("button", { id: "switch-a", onClick: () => switchTo(inputFor("topic-a", 0)) }),
    createElement("button", { id: "switch-b", onClick: () => switchTo(inputFor("topic-b", 0)) }),
    createElement("button", { id: "switch-new", onClick: () => switchTo(inputFor("topic-c", 0)) }),
  );
}

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);
await act(async () => {
  root.render(createElement(AppHarness));
});

function rendered(): { tabs: string[]; active: string; open: boolean; maximized: boolean } {
  const el = document.querySelector<HTMLElement>('[data-testid="dock"]')!;
  const tabs = JSON.parse(el.dataset.tabs ?? "[]") as string[];
  return { tabs, active: el.dataset.active ?? "", open: el.dataset.open === "true", maximized: el.dataset.maximized === "true" };
}

console.log("\nconversation dock integration");

const keyA = conversationDockKey(inputFor("topic-a", 0));
const keyB = conversationDockKey(inputFor("topic-b", 0));
const keyC = conversationDockKey(inputFor("topic-c", 0));

ok(keyA !== keyB && keyB !== keyC, "distinct conversation identities produce distinct keys");
ok(rendered().tabs.length === 0 && rendered().open === false, "a fresh conversation mounts with an empty collapsed dock");

// Conversation A opens a file tab and expands; B must never see it.
await act(async () => {
  useActivityBarStore.getState().openEntry(keyA, "file", "src/App.tsx");
});
ok(rendered().tabs.join(",") === "src/App.tsx" && rendered().open === true, "A's file tab and expanded state render immediately");

await act(async () => {
  document.querySelector<HTMLButtonElement>("#switch-b")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
let firstRenderAfterSwitch = rendered();
ok(firstRenderAfterSwitch.tabs.length === 0 && firstRenderAfterSwitch.open === false, "switching shows B's own empty dock on the first frame (no A leakage)");

// B opens its own tabs; A stays untouched.
await act(async () => {
  useActivityBarStore.getState().openEntry(keyB, "file", "README.md");
  useActivityBarStore.getState().addTab(keyB, "terminal", "Terminal");
});
ok(rendered().tabs.join(",") === "README.md,Terminal", "B accumulates its own tabs");

await act(async () => {
  document.querySelector<HTMLButtonElement>("#switch-a")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
ok(rendered().tabs.join(",") === "src/App.tsx" && rendered().open === true, "returning to A restores its tabs and expansion");

// A's mutation after switching away must not touch B.
await act(async () => {
  useActivityBarStore.getState().setMaximized(keyA, true);
});
const snapshotB = useActivityBarStore.getState().snapshots[keyB];
ok(snapshotB.maximized === false && rendered().maximized === true, "A's mutation never leaks into B's snapshot");

// Closing A's last tab collapses only A.
await act(async () => {
  useActivityBarStore.getState().closeTab(keyA, useActivityBarStore.getState().snapshots[keyA].activeTabId!);
});
ok(rendered().open === false && rendered().tabs.length === 0, "closing the last dock tab collapses only the current conversation");
await act(async () => {
  document.querySelector<HTMLButtonElement>("#switch-b")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
ok(rendered().open === true && rendered().tabs.join(",") === "README.md,Terminal", "B's collapsed-independent dock is unaffected by A");

// /new, clear, fork: a brand-new identity starts empty and never inherits.
await act(async () => {
  document.querySelector<HTMLButtonElement>("#switch-new")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
ok(rendered().tabs.length === 0 && rendered().open === false, "/new/clear/fork conversation starts empty without inheriting A or B");

// Same topic, later generation = new scene.
await act(async () => {
  root.render(createElement(DockHarness, { input: inputFor("topic-b", 1) }));
});
ok(rendered().tabs.length === 0 && rendered().open === false, "a regenerated conversation (fork/clear) starts a fresh scene");

await act(async () => {
  root.unmount();
});
dom.window.close();

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
