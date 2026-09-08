// Run: tsx src/__tests__/launcher-card-state.test.ts
//
// Guards the floating launcher card state machine (the regressions this
// protects: the card's render condition and the toggle's pressed state must
// never diverge). Two layers:
//   1. Truth-table over resolveLauncherCardState — every combination of
//      gridOpen × spaceMode × dismissed.
//   2. Source contracts — App must drive the toggle through the shared
//      resolver (not inline the condition again), and DockLauncher must keep
//      reporting its space-yield mode upward.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLauncherCardState, type SpaceMode } from "../lib/launcherCardState";

let passed = 0;
let failed = 0;

function eq<T>(actual: T, expected: T, label: string) {
  if (Object.is(actual, expected)) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}: expected ${String(expected)}, got ${String(actual)}\n`);
    failed += 1;
  }
}

const modes: SpaceMode[] = ["full", "hidden"];

// ---- 1. Truth table -------------------------------------------------------
process.stdout.write("truth table: gridOpen × spaceMode × dismissed\n");
for (const gridOpen of [false, true]) {
  for (const spaceMode of modes) {
    for (const dismissed of [false, true]) {
      const { renderable, visible } = resolveLauncherCardState({ gridOpen, spaceMode, dismissed });
      const tag = `g=${gridOpen} m=${spaceMode} d=${dismissed}`;
      eq(renderable, !gridOpen && spaceMode === "full", `renderable ${tag}`);
      eq(visible, !gridOpen && spaceMode === "full" && !dismissed, `visible ${tag}`);
      // A visible card is always renderable (consistency invariant).
      assert.ok(!visible || renderable, `invariant: visible implies renderable ${tag}`);
    }
  }
}

// ---- 2. Source contracts --------------------------------------------------
process.stdout.write("source contracts\n");
const testDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDir, "../App.tsx"), "utf8");
const dockLauncherSource = readFileSync(resolve(testDir, "../components/DockLauncher.tsx"), "utf8");

assert.match(
  appSource,
  /const \{ renderable: launcherCardRenderable, visible: launcherCardVisible \} = resolveLauncherCardState\(\{/,
  "App drives the launcher toggle through the shared resolver",
);
assert.match(
  appSource,
  /gridOpen: effectiveWorkspacePanelGridOpen,\s*spaceMode: launcherSpaceMode,\s*dismissed: launcherDismissed,/,
  "App feeds gridOpen / spaceMode / dismissed into the resolver",
);
assert.doesNotMatch(
  appSource,
  /const launcherCardRenderable = !effectiveWorkspacePanelGridOpen && launcherSpaceMode === "full";/,
  "the renderable condition is not inlined in App (single source of truth)",
);
assert.match(
  dockLauncherSource,
  /onSpaceModeChange\?\.\(next\)/,
  "DockLauncher keeps reporting its space-yield mode upward",
);

passed += 4; // the four assert.* checks above
process.stdout.write(`launcher card state: ${passed} checks passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
