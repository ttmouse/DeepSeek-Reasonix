// Decision logic for the floating launcher card (DockLauncher) and its
// top-right toggle. The card is on screen while it has room to occupy
// (spaceMode "full") and the user has not dismissed it. An open dock panel
// makes the card float over the transcript instead, which the caller folds
// into spaceMode — the dock's own open state is deliberately not part of this
// decision. Keeping this as a pure function lets the toggle's pressed state
// and the card's render condition share one source of truth that is
// unit-tested directly (see src/__tests__/launcher-card-state.test.ts).
export type SpaceMode = "full" | "hidden";

export interface LauncherCardInput {
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

export function resolveLauncherCardState({ spaceMode, dismissed }: LauncherCardInput): LauncherCardState {
  const renderable = spaceMode === "full";
  return { renderable, visible: renderable && !dismissed };
}
