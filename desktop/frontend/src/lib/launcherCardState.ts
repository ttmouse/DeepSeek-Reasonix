// Decision logic for the floating launcher card (DockLauncher) and its
// top-right toggle. The card is on screen only when all three hold: the right
// dock is collapsed, the transcript surface is wide enough for the card to
// yield space (spaceMode "full"), and the user has not dismissed it. Keeping
// this as a pure function lets the toggle's pressed state and the card's
// render condition share one source of truth that is unit-tested directly
// (see src/__tests__/launcher-card-state.test.ts).
export type SpaceMode = "full" | "hidden";

export interface LauncherCardInput {
  /** True while the right dock panel is open (the card is replaced by it). */
  gridOpen: boolean;
  /** Space-yield mode reported by the card itself via onSpaceModeChange. */
  spaceMode: SpaceMode;
  /** True when the user dismissed the card with the launcher toggle. */
  dismissed: boolean;
}

export interface LauncherCardState {
  /** The card could be on screen if not dismissed — the toggle is actionable. */
  renderable: boolean;
  /** The card is actually on screen — the toggle shows its pressed state. */
  visible: boolean;
}

export function resolveLauncherCardState({ gridOpen, spaceMode, dismissed }: LauncherCardInput): LauncherCardState {
  const renderable = !gridOpen && spaceMode === "full";
  return { renderable, visible: renderable && !dismissed };
}
