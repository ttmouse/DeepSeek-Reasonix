// Run: tsx src/__tests__/browser-pages-store.test.ts
// Verifies the dock browser's per-page store: seeding, navigation history
// semantics (append / truncate-forward), back/forward bounds, loading/error
// transitions, zoom presets, address drafts, and page teardown on tab close.
// Also covers the address normalizer (bare host → https, loopback → http).

import { normalizeAddress, zoomPercent, zoomStep } from "../lib/browserAddress";
import { DEFAULT_HOME, useBrowserPagesStore } from "../store/browserPages";

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

function resetStore(): void {
  useBrowserPagesStore.setState({ pages: {}, drafts: {} });
}

// --- address normalization ---
check("bare host becomes https", normalizeAddress("example.com") === "https://example.com");
check("loopback host becomes http", normalizeAddress("localhost:8080") === "http://localhost:8080");
check("explicit https passes through", normalizeAddress("https://a.b/c") === "https://a.b/c");
check("about: scheme passes through", normalizeAddress("about:blank") === "about:blank");
check("blank input is rejected", normalizeAddress("   ") === null);

// --- zoom presets ---
check("zoom steps up", zoomStep(1, 1) === 1.1, `got ${zoomStep(1, 1)}`);
check("zoom steps down", zoomStep(1, -1) === 0.9, `got ${zoomStep(1, -1)}`);
check("zoom resets to 100%", zoomStep(1.75, 0) === 1);
check("zoom percent rounds", zoomPercent(1.1) === 110);

// --- openPage seeding ---
resetStore();
useBrowserPagesStore.getState().openPage("dock-tab-1");
const seeded = useBrowserPagesStore.getState().pages["dock-tab-1"];
check("openPage seeds the default home", seeded?.url === DEFAULT_HOME, `got ${seeded?.url}`);
check("openPage starts loading", seeded?.loading === true);
check("openPage starts with one history entry", seeded?.history.length === 1);
check("openPage resets zoom to 100%", seeded?.zoom === 1);

resetStore();
useBrowserPagesStore.getState().openPage("dock-tab-1", "example.com");
check("openPage normalizes the initial URL", useBrowserPagesStore.getState().pages["dock-tab-1"].url === "https://example.com");

// --- navigate: append + truncate forward stack ---
resetStore();
const s = useBrowserPagesStore.getState();
s.openPage("t1", "https://a.com");
s.navigate("t1", "b.com");
s.navigate("t1", "https://c.com");
const afterForward = useBrowserPagesStore.getState().pages.t1;
check("navigate appends history", afterForward.history.length === 3, `got ${afterForward.history.length}`);
check("navigate moves historyIndex", afterForward.historyIndex === 2);
check("navigate activates loading", afterForward.loading === true);
check("navigate clears error", afterForward.error === null);

// Back twice, then navigate: the forward stack must be truncated.
s.goBack("t1");
s.goBack("t1");
const afterBack = useBrowserPagesStore.getState().pages.t1;
check("goBack moves to earlier entry", afterBack.url === "https://a.com", `got ${afterBack.url}`);
check("goBack reaches the first entry", afterBack.historyIndex === 0, `got ${afterBack.historyIndex}`);
s.navigate("t1", "https://d.com");
const afterTruncate = useBrowserPagesStore.getState().pages.t1;
check("navigate truncates the forward stack", afterTruncate.history.length === 2, `got ${afterTruncate.history.length}`);
check("navigate lands on the new URL", afterTruncate.url === "https://d.com");

// --- back / forward bounds ---
resetStore();
s.openPage("t1", "https://a.com");
s.goBack("t1");
check("goBack is a no-op at the first entry", useBrowserPagesStore.getState().pages.t1.url === "https://a.com");
s.goForward("t1");
check("goForward is a no-op at the last entry", useBrowserPagesStore.getState().pages.t1.url === "https://a.com");

// --- loading / error transitions ---
resetStore();
s.openPage("t1");
s.setLoading("t1", false);
check("setLoading clears the flag", useBrowserPagesStore.getState().pages.t1.loading === false);
s.setError("t1", "timeout");
check("setError surfaces the message", useBrowserPagesStore.getState().pages.t1.error === "timeout");
check("setError stops loading", useBrowserPagesStore.getState().pages.t1.loading === false);
s.navigate("t1", "https://x.com");
check("navigate clears a previous error", useBrowserPagesStore.getState().pages.t1.error === null);

// --- reload keeps the URL ---
resetStore();
s.openPage("t1", "https://a.com");
s.setLoading("t1", false);
s.reload("t1");
const afterReload = useBrowserPagesStore.getState().pages.t1;
check("reload keeps the URL", afterReload.url === "https://a.com");
check("reload re-enters loading", afterReload.loading === true);

// --- drafts ---
resetStore();
s.openPage("t1");
s.setDraft("t1", "half-typed");
check("draft is stored per tab", useBrowserPagesStore.getState().drafts.t1 === "half-typed");
s.clearDraft("t1");
check("draft clears", useBrowserPagesStore.getState().drafts.t1 === undefined);

// --- teardown on close ---
resetStore();
s.openPage("t1");
s.openPage("t2");
s.setDraft("t1", "draft");
s.dropPage("t1");
const afterDrop = useBrowserPagesStore.getState();
check("dropPage removes the page", afterDrop.pages.t1 === undefined);
check("dropPage keeps other pages", afterDrop.pages.t2 !== undefined);
check("dropPage removes the draft", afterDrop.drafts.t1 === undefined);

// --- unknown tab actions are safe no-ops ---
resetStore();
useBrowserPagesStore.getState().goBack("missing");
useBrowserPagesStore.getState().zoom("missing", 1);
useBrowserPagesStore.getState().setError("missing", "x");
check("actions on unknown tabs are safe", true);

if (failed > 0) {
  console.error(`\nbrowser-pages-store: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nbrowser-pages-store: all ${passed} checks passed`);
