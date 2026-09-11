export function availableWorkspacePanelWidth({
  viewportWidth,
  sidebarCollapsed,
  sidebarWidth,
  chatMinWidth,
  resizerWidth,
}: {
  viewportWidth: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatMinWidth: number;
  resizerWidth: number;
}): number {
  return Math.max(0, viewportWidth - (sidebarCollapsed ? 0 : sidebarWidth) - chatMinWidth - resizerWidth);
}

export function resolveWorkspacePanelWidth({
  open,
  maximized,
  preferredWidth,
  minWidth,
  availableWidth,
}: {
  open: boolean;
  maximized: boolean;
  preferredWidth: number;
  minWidth: number;
  availableWidth: number;
}): number {
  if (!open || maximized) return preferredWidth;
  return Math.min(Math.max(minWidth, preferredWidth), Math.max(0, availableWidth));
}

export function resolveLiveWorkspacePanelWidth({
  viewportWidth,
  sidebarCollapsed,
  sidebarWidth,
  chatMinWidth,
  resizerWidth,
  open,
  maximized,
  preferredWidth,
  minWidth,
}: {
  viewportWidth: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatMinWidth: number;
  resizerWidth: number;
  open: boolean;
  maximized: boolean;
  preferredWidth: number;
  minWidth: number;
}): number {
  return resolveWorkspacePanelWidth({
    open,
    maximized,
    preferredWidth,
    minWidth,
    availableWidth: availableWorkspacePanelWidth({
      viewportWidth,
      sidebarCollapsed,
      sidebarWidth,
      chatMinWidth,
      resizerWidth,
    }),
  });
}

export function workspacePanelAriaMinWidth(minWidth: number, renderedWidth: number): number {
  return Math.min(minWidth, renderedWidth);
}

export function resolveWorkspacePanelPlacement({
  viewportWidth, sidebarCollapsed, sidebarWidth, chatMinWidth, resizerWidth,
  open, maximized, preferredWidth, minWidth, minRenderWidth, liveWidth,
}: {
  viewportWidth: number; sidebarCollapsed: boolean; sidebarWidth: number;
  chatMinWidth: number; resizerWidth: number; open: boolean; maximized: boolean;
  preferredWidth: number; minWidth: number; minRenderWidth: number; liveWidth?: number | null;
}) {
  const availableWidth = availableWorkspacePanelWidth({
    viewportWidth, sidebarCollapsed, sidebarWidth, chatMinWidth, resizerWidth,
  });
  const resolvedWidth = resolveWorkspacePanelWidth({
    open, maximized, preferredWidth, minWidth, availableWidth,
  });
  // Overlay follows the width the dock would actually render at, not the raw
  // free space: a dock dragged below minRenderWidth (minWidth sits under the
  // render floor) must float even while the viewport still has room for it.
  const overlay = open && !maximized && resolvedWidth < minRenderWidth;
  const storedWidth = maximized
    ? preferredWidth
    : overlay ? Math.min(preferredWidth, Math.max(minWidth, viewportWidth - 16)) : resolvedWidth;
  const renderWidth = liveWidth ?? storedWidth;
  const renderable = open && (maximized || overlay || renderWidth >= minRenderWidth);
  // The dock occupies a grid column whenever it is open and not in overlay
  // mode. The width floor for a readable column (minRenderWidth) governs
  // overlay only; it must not suppress the grid column itself, or a narrow
  // saved dock width (< minRenderWidth) would render the dock at zero width.
  const gridOpen = open && !maximized && !overlay;
  return { renderWidth, overlay, renderable, gridOpen };
}
