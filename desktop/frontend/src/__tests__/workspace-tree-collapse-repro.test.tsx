// Run: node_modules/.bin/tsx src/__tests__/workspace-tree-collapse-repro.test.tsx
//
// Regression test: collapsing a directory while the tree is scrolled deep, then
// re-expanding it, must leave the viewport covered — no blank bands at the top
// or bottom. Reproduces the WKWebView quirk where the browser clamps scrollTop
// when the sizer shrinks but fires no scroll event, so the virtualizer's
// logical offset goes stale and the mounted window drifts away from the
// viewport. Emulated here with a sticky-clamp scrollTop shim on the tree
// element (JSDOM has no layout, so it never clamps on its own).

import { act } from "react";
import type { DirEntry } from "../lib/types";
import { flushPromises, renderFilesWorkspace, waitFor } from "./workspace-panel-test-harness";

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

function info(label: string, value: unknown) {
  process.stdout.write(`  INFO  ${label}: ${String(value)}\n`);
}

console.log("\nworkspace tree collapse/expand repro");

const FILES_PER_DIR = 30;
const dirEntries = (prefix: string): DirEntry[] =>
  Array.from({ length: FILES_PER_DIR }, (_, i) => ({ name: `${prefix}-file-${String(i).padStart(2, "0")}.ts`, isDir: false }));

{
  const { dom, root } = await renderFilesWorkspace({
    ListDirForTab: async (_tabId, dir) => {
      if (dir === "") {
        return [
          { name: "big-a", isDir: true },
          { name: "big-b", isDir: true },
          { name: "tail.ts", isDir: false },
        ];
      }
      if (dir === "big-a/") return dirEntries("a");
      if (dir === "big-b/") return dirEntries("b");
      return [];
    },
  });

  const tree = () => document.querySelector<HTMLElement>(".workspace-tree")!;
  const sizer = () => document.querySelector<HTMLElement>(".workspace-tree__sizer")!;
  const rows = () =>
    Array.from(document.querySelectorAll<HTMLElement>(".workspace-tree__sizer > div")).map((wrapper) => ({
      path: wrapper.querySelector<HTMLElement>("[data-workspace-path]")?.dataset.workspacePath ?? "",
      transform: wrapper.style.transform,
    }));
  const starts = () => rows().map((r) => Number(/(-?[\d.]+)px/.exec(r.transform)?.[1] ?? NaN));
  const scrollTo = async (top: number) => {
    await act(async () => {
      tree().scrollTop = top;
      tree().dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await flushPromises();
    });
  };
  const click = async (path: string) => {
    const row = document.querySelector<HTMLElement>(`[data-workspace-path="${path}"]`);
    if (!row) throw new Error(`missing row ${path}`);
    await act(async () => {
      row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
  };

  await waitFor("initial rows", () => rows().length > 0);

  // Sticky scrollTop clamp shim: JSDOM has no layout, so it never clamps
  // scrollTop when content shrinks. A real viewport clamps (and remembers the
  // clamped position) as soon as the scrollable extent shrinks below it — and
  // WKWebView does not reliably fire the scroll event for that clamp. The
  // shim models exactly that: reads clamp against the sizer height minus the
  // 300px viewport and persist the clamp, writes just store.
  let scrollStore = 0;
  const viewportHeight = 300;
  Object.defineProperty(tree(), "scrollTop", {
    configurable: true,
    get: () => {
      const max = Math.max(0, (Number.parseInt(sizer().style.height, 10) || 0) - viewportHeight);
      scrollStore = Math.min(scrollStore, max);
      return scrollStore;
    },
    set: (value: number) => {
      scrollStore = value;
    },
  });

  // Expand big-a (visible at scrollTop 0), then scroll to big-b and expand it.
  await click("big-a/");
  await waitFor("big-a expanded", () => document.querySelector('[data-workspace-path="big-a/a-file-05.ts"]') != null);
  await scrollTo(650);
  await click("big-b/");
  await act(async () => { await flushPromises(); });
  info("after click big-b scrollTop", tree().scrollTop);
  info("after click big-b sizer", sizer().style.height);
  info("after click big-b rows", rows().map((r) => r.path).join(", "));
  await waitFor("big-b expanded", () => document.querySelector('[data-workspace-path="big-b/b-file-05.ts"]') != null);

  // total: 1 + 30 + 30 + 1 = 62 rows * 24 = 1488
  await waitFor("full sizer", () => sizer().style.height === `${63 * 24}px`);
  ok(sizer().style.height === `${63 * 24}px`, `expanded sizer height is ${sizer().style.height} (expect ${63 * 24}px)`);

  // Scroll so big-b (offset 744) is in view, then collapse it while scrolled.
  await scrollTo(744);
  tree().addEventListener("scroll", () => {
    process.stdout.write(`  EVT   scroll event, scrollTop now ${tree().scrollTop}\n`);
  });
  await click("big-b/");
  await waitFor("big-b collapsed", () => document.querySelector('[data-workspace-path="big-b/b-file-00.ts"]') == null);

  // Collapsed: 3 + 30 = 33 rows = 792px. The shim clamps scrollTop 744 -> 492
  // on read (as a real viewport would) and fires no scroll event, so the
  // virtualizer's logical offset stays stale unless the panel resyncs it.
  await act(async () => {
    await flushPromises();
  });
  const collapsedStarts = starts();
  const collapsedScroll = tree().scrollTop;
  info("collapsed sizer", sizer().style.height);
  info("collapsed scrollTop", collapsedScroll);
  info("collapsed mounted", `${collapsedStarts.length} rows, min=${Math.min(...collapsedStarts)}, max=${Math.max(...collapsedStarts)}`);
  const collapsedCovered = Math.min(...collapsedStarts) <= collapsedScroll && Math.max(...collapsedStarts) + 24 >= collapsedScroll + 300;
  ok(sizer().style.height === `${33 * 24}px`, `collapsed sizer height is ${sizer().style.height} (expect ${33 * 24}px)`);
  ok(collapsedCovered, `collapsed viewport covered at scrollTop=${collapsedScroll}`);

  // Re-expand big-b while still at the clamped scroll position.
  await click("big-b/");
  await waitFor("big-b re-expanded", () => document.querySelector('[data-workspace-path="big-b/b-file-05.ts"]') != null);
  await act(async () => {
    await flushPromises();
  });

  const reStarts = starts();
  const rePaths = rows().map((r) => r.path);
  const scrollTopNow = tree().scrollTop;
  info("after re-expand", `scrollTop=${scrollTopNow}, sizer=${sizer().style.height}, mounted=${reStarts.length}, min=${Math.min(...reStarts)}, max=${Math.max(...reStarts)}`);
  info("mounted rows", rePaths.join(", "));
  const reCovered = Math.min(...reStarts) <= scrollTopNow && Math.max(...reStarts) + 24 >= scrollTopNow + 300;
  ok(reCovered, `re-expanded viewport covered at scrollTop=${scrollTopNow}`);
  ok(sizer().style.height === `${63 * 24}px`, `re-expanded sizer height is ${sizer().style.height} (expect ${63 * 24}px)`);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
