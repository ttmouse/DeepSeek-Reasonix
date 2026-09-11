// Run: tsx src/__tests__/launcher-card-state.test.ts
//
// Guards the floating launcher card state machine (the regressions this
// protects: the card's render condition and the toggle's pressed state must
// never diverge). Two layers:
//   1. Truth-table over resolveLauncherCardState — every combination of
//      spaceMode × dismissed.
//   2. Source contracts — App must drive the toggle through the shared
//      resolver (not inline the condition again), App must keep the card
//      mounted and floating while the dock panel is open, and DockLauncher
//      must keep reporting its space-yield mode upward.

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
process.stdout.write("truth table: spaceMode × dismissed\n");
for (const spaceMode of modes) {
  for (const dismissed of [false, true]) {
    const { renderable, visible } = resolveLauncherCardState({ spaceMode, dismissed });
    const tag = `m=${spaceMode} d=${dismissed}`;
    eq(renderable, spaceMode === "full", `renderable ${tag}`);
    eq(visible, spaceMode === "full" && !dismissed, `visible ${tag}`);
    // A visible card is always renderable (consistency invariant).
    assert.ok(!visible || renderable, `invariant: visible implies renderable ${tag}`);
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
  /const launcherCardSpaceMode = effectiveWorkspacePanelGridOpen \? "full" : launcherSpaceMode;/,
  "App folds an open dock panel into the space mode the resolver reads",
);
assert.doesNotMatch(
  appSource,
  /const launcherCardRenderable = !effectiveWorkspacePanelGridOpen && launcherSpaceMode === "full";/,
  "the renderable condition is not inlined in App (single source of truth)",
);
assert.match(
  appSource,
  /<DockLauncher[^>]*overlay=\{effectiveWorkspacePanelGridOpen\}/,
  "App keeps the card mounted and floating while the dock panel is open",
);
assert.match(
  dockLauncherSource,
  /if \(!overlay && spaceMode === "hidden"\) return null;/,
  "the card only yields the space when it is not floating over the dock",
);
assert.match(
  dockLauncherSource,
  /onSpaceModeChange\?\.\(next\)/,
  "DockLauncher keeps reporting its space-yield mode upward",
);

passed += 6; // the six assert.* checks above
process.stdout.write(`launcher card state: ${passed} checks passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
