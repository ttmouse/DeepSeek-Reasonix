// Run: tsx src/__tests__/composer-running-mode-switch.test.tsx

import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../components/Composer";
import { LocaleProvider } from "../lib/i18n";
import { ToastProvider } from "../lib/toast";
import type { AppBindings } from "../lib/bridge";
import type { CollaborationMode, ToolApprovalMode } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(value: boolean, label: string) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(true, label);
  else ok(false, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function flushTimers(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PointerEvent = dom.window.MouseEvent as unknown as typeof PointerEvent;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.File = dom.window.File;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.ResizeObserver = TestResizeObserver;
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
  return dom;
}

function mockApp(methods: Partial<AppBindings>) {
  window.go = {
    main: {
      App: {
        Commands: async () => [],
        Models: async () => [],
        ModelsForTab: async () => [],
        SlashArgs: async () => ({ items: [], from: 0 }),
        ...methods,
      } as Partial<AppBindings> as AppBindings,
    },
  };
}

async function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing root");
  const root = createRoot(rootEl);
  const calls: {
    toolApprovalMode: ToolApprovalMode[];
    collaborationMode: CollaborationMode[];
    effort: string[];
  } = { toolApprovalMode: [], collaborationMode: [], effort: [] };
  let currentProps: Parameters<typeof Composer>[0] = {
    running: true,
    collaborationMode: "normal",
    toolApprovalMode: "ask" as ToolApprovalMode,
    goal: "",
    cwd: "/repo",
    tabId: "tab-a",
    modelLabel: "DeepSeek-R1",
    turnStartAt: Date.now(),
    effort: { supported: true, current: "auto", default: "auto", levels: ["low", "medium", "high"] },
    onSend: () => {},
    onCancel: async () => ({ discardedItemIds: [] }),
    onCycleMode: () => {},
    onSetMode: () => {},
    onSetCollaborationMode: (mode) => calls.collaborationMode.push(mode),
    onSetToolApprovalMode: (mode) => calls.toolApprovalMode.push(mode),
    onToggleYoloApprovalMode: () => {},
    onClearGoal: () => {},
    onSwitchModel: () => {},
    onSetEffort: (level: string) => calls.effort.push(level),
    ready: true,
    ...props,
  };
  const paint = async (nextProps: Partial<Parameters<typeof Composer>[0]> = {}) => {
    currentProps = { ...currentProps, ...nextProps };
    await act(async () => {
      root.render(
        <LocaleProvider>
          <ToastProvider>
            <Composer {...currentProps} />
          </ToastProvider>
        </LocaleProvider>,
      );
      await flushTimers();
    });
  };
  await paint();
  return { root, calls, rerender: paint };
}

async function teardown(root: ReturnType<typeof createRoot>, dom: JSDOM) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

async function click(element: Element | null, label: string) {
  if (!element) throw new Error(`${label} did not render`);
  await act(async () => {
    (element as HTMLElement).click();
    await flushTimers();
  });
}

function query<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

console.log("\ncomposer running mode switch");

{
  const dom = installDom();
  mockApp({});
  const { root, calls } = await renderComposer();

  const approvalTrigger = query<HTMLButtonElement>(".composer-approval-trigger");
  if (!approvalTrigger) throw new Error("approval trigger did not render");
  eq(approvalTrigger.disabled, false, "approval mode trigger stays enabled while a turn runs");

  await click(approvalTrigger, "approval trigger");
  const approvalItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".composer-approval-popup__item"));
  eq(approvalItems.length, 3, "approval popup lists ask/auto/yolo while a turn runs");
  ok(approvalItems.every((item) => !item.disabled), "approval popup items stay enabled while a turn runs");

  const yoloItem = approvalItems.find((item) => item.textContent?.includes("YOLO"));
  await click(yoloItem ?? null, "yolo item");
  eq(calls.toolApprovalMode.join(","), "yolo", "switching approval mode mid-turn reaches the controller");

  const mainTrigger = query<HTMLButtonElement>(".composer-menu-trigger");
  if (!mainTrigger) throw new Error("main menu trigger did not render");
  eq(mainTrigger.disabled, false, "main menu trigger stays enabled while a turn runs");

  await click(mainTrigger, "main menu trigger");
  const taskModeItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".composer-main-menu button[role=\"menuitemradio\"]"));
  ok(taskModeItems.length >= 2, "main menu exposes plan/goal mode items");
  ok(taskModeItems.every((item) => !item.disabled), "task mode items stay enabled while a turn runs");

  await click(taskModeItems[0], "plan mode item");
  eq(calls.collaborationMode.join(","), "plan", "switching task mode mid-turn reaches the controller");

  const moreTrigger = query<HTMLButtonElement>(".composer-more-trigger");
  if (!moreTrigger) throw new Error("effort menu trigger did not render");
  eq(moreTrigger.disabled, false, "effort menu trigger stays enabled while a turn runs");

  const effortTrigger = query<HTMLButtonElement>(".effortsw__trigger");
  if (!effortTrigger) throw new Error("effort switcher did not render");
  eq(effortTrigger.disabled, false, "effort switcher stays enabled while a turn runs");

  await click(effortTrigger, "effort switcher");
  const effortItem = Array.from(document.querySelectorAll<HTMLButtonElement>(".effortsw__menu button"))
    .find((item) => item.textContent?.trim() === "high");
  await click(effortItem ?? null, "high effort item");
  eq(calls.effort.join(","), "high", "switching effort mid-turn reaches the controller");

  await teardown(root, dom);
}

{
  const dom = installDom();
  mockApp({});
  const { root, calls } = await renderComposer({ disabled: true });

  const approvalTrigger = query<HTMLButtonElement>(".composer-approval-trigger");
  if (!approvalTrigger) throw new Error("approval trigger did not render");
  eq(approvalTrigger.disabled, true, "a locked composer still disables the approval trigger");
  const mainTrigger = query<HTMLButtonElement>(".composer-menu-trigger");
  eq(mainTrigger?.disabled, true, "a locked composer still disables the main menu trigger");

  await click(approvalTrigger, "approval trigger");
  eq(document.querySelectorAll(".composer-approval-popup__item").length, 0, "a locked composer never opens the approval popup");
  eq(calls.toolApprovalMode.length, 0, "a locked composer cannot change approval mode");

  await teardown(root, dom);
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
