// chatPathContext — app-level wiring for chat path links (click layer).
// The App wraps the transcript in a provider carrying the current workspace
// roots (linkification context) and the open handler; markdown render
// components read it instead of threading props through every row.

import { createContext, useContext } from "react";
import type { ChatPathKind } from "./chatPathLinkify";

export interface ChatPathContextValue {
  /** Known workspace roots (currently the active session's cwd). */
  roots: readonly string[];
  /**
   * Click handler: resolves the path against the workspace (relative →
   * cwd-joined, basename → unique file-tree match, absolute → ws-root
   * relative), opens the workspace panel if closed, and routes it to the
   * panel. Must be silent when the file does not resolve.
   */
  onOpenChatFile: (pathText: string, kind: ChatPathKind) => void;
}

export const ChatPathContext = createContext<ChatPathContextValue | null>(null);

export function useChatPathContext(): ChatPathContextValue | null {
  return useContext(ChatPathContext);
}
