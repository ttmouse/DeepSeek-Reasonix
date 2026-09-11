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
  open, maximized, preferredWidth, minWidth, liveWidth,
}: {
  viewportWidth: number; sidebarCollapsed: boolean; sidebarWidth: number;
  chatMinWidth: number; resizerWidth: number; open: boolean; maximized: boolean;
  preferredWidth: number; minWidth: number; liveWidth?: number | null;
}) {
  const availableWidth = availableWorkspacePanelWidth({
    viewportWidth, sidebarCollapsed, sidebarWidth, chatMinWidth, resizerWidth,
  });
  const resolvedWidth = resolveWorkspacePanelWidth({
    open, maximized, preferredWidth, minWidth, availableWidth,
  });
  const storedWidth = maximized ? preferredWidth : resolvedWidth;
  const renderWidth = liveWidth ?? storedWidth;
  // The dock is always a regular grid column: never detached into a floating
  // card, so the resizer stays mounted and the panel keeps its inset layout.
  const renderable = open && (maximized || availableWidth > 0);
  const gridOpen = open && !maximized;
  return { renderWidth, renderable, gridOpen };
}
