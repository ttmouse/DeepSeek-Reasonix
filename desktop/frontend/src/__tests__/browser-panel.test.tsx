// Run: tsx src/__tests__/browser-panel.test.tsx
// Verifies the dock browser panel: it renders the page's address in the
// toolbar, keeps the dock tab label in sync (page URL → tab label), updates
// the store when the user submits an address, and shows an error card with a
// retry button when the page fails to load.
//
// Bootstrap note: react / react-dom / the components are imported dynamically
// AFTER the jsdom globals are installed. A static import would initialize
// react-dom before `window`/`document` exist, silently breaking its event
// delegation (input events would never reach onChange).

import { JSDOM } from "jsdom";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".css")) {
      return nextResolve("./asset-stub-for-tests.ts", { ...context, parentURL: import.meta.url });
    }
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });

const [{ createRoot }, React, { BrowserPanel }, { LocaleProvider }, { useActivityBarStore }, { useBrowserPagesStore }] = await Promise.all([
  import("react-dom/client"),
  import("react"),
  import("../components/BrowserPanel"),
  import("../lib/i18n"),
  import("../store/activityBar"),
  import("../store/browserPages"),
]);
const { act } = React;

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

const TAB_ID = "dock-tab-1";
const KEY = "local:project:/w:test:0";
const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

useActivityBarStore.setState({
  snapshots: {
    [KEY]: {
      tabs: [{ id: TAB_ID, type: "browser", label: "浏览器", meta: { url: "https://example.com" } }],
      activeTabId: TAB_ID,
      open: true,
      maximized: false,
      previewActive: false,
    },
  },
  addMenuOpen: false,
});
useBrowserPagesStore.setState({ pages: {}, drafts: {} });
useBrowserPagesStore.getState().openPage(TAB_ID, "https://example.com");

const root = createRoot(container);
await act(async () => {
  root.render(
    <LocaleProvider>
      <BrowserPanel tabId={TAB_ID} conversationKey={KEY} />
    </LocaleProvider>,
  );
});

// Address bar reflects the page URL.
const address = container.querySelector<HTMLInputElement>(".browser-panel__address input");
check("address bar shows the page URL", address?.value === "https://example.com", `got ${address?.value}`);

// Tab label syncs to the display URL (title unreadable under the sandbox).
const tab = useActivityBarStore.getState().snapshots[KEY]?.tabs.find((entry) => entry.id === TAB_ID);
check("dock tab label becomes the page URL", tab?.label === "example.com", `got ${tab?.label}`);
check("dock tab meta keeps the URL", tab?.meta?.url === "https://example.com");

// Typing an address stores the draft, then submitting navigates + relabels.
await act(async () => {
  if (!address) throw new Error("missing address input");
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(address, "news.example.org");
  address.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  address.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
check("typing stores the address draft", useBrowserPagesStore.getState().drafts[TAB_ID] === "news.example.org");
await act(async () => {
  container.querySelector(".browser-panel__address")
    ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
});
const afterNavigate = useBrowserPagesStore.getState().pages[TAB_ID];
check("navigate normalizes the submitted address", afterNavigate.url === "https://news.example.org", `got ${afterNavigate.url}`);
const relabeled = useActivityBarStore.getState().snapshots[KEY]?.tabs.find((entry) => entry.id === TAB_ID);
check("dock tab label follows the navigation", relabeled?.label === "news.example.org", `got ${relabeled?.label}`);

// Error state renders the retry affordance.
await act(async () => {
  useBrowserPagesStore.getState().setError(TAB_ID, "timed out");
});
const retry = container.querySelector(".browser-panel__error button");
check("error card shows a retry button", retry !== null);

if (failed > 0) {
  console.error(`\nbrowser-panel: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nbrowser-panel: all ${passed} checks passed`);
