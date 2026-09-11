// Conversation-scoped right-dock identity.
//
// The right dock's "work scene" (open tabs, active tab, expanded state, tree
// navigation) belongs to a conversation, not to the project and not to the
// desktop tab shell. Every dock snapshot is stored under a conversationDockKey
// that must be stable across desktop-tab switches and app restarts, and must
// change exactly when the conversation identity changes:
//
//   - same topicId + sessionGeneration  -> same key (tab switches restore it)
//   - /new or fork (different topic)    -> different key (fresh workspace)
//   - clear (generation bump)           -> different key (fresh workspace)
//   - controller rebuild / metadata fill-> same key (keep the workspace)
//
// Identity fields may not be complete while a tab is being created; the
// fallback order is topicId -> sessionPath -> tabId (temporary). A temporary
// key must be atomically migrated to the formal key once the topic arrives —
// never reset (see conversationDockPersistence.migrateConversationDockRecord).
//
// Key formats:
//   local:  local:<scope>:<normalized-workspace-root>:<identity>:<generation>
//   remote: remote:<host-id>:<workspace>:<identity>:<generation>
// The identity segment is topicId (or sessionPath, or tabId as a temporary
// stand-in). Generation maps undefined and 0 to the same value so the initial
// generation stays stable until a clear/new bumps it.

import type { RemoteTabRefView } from "./remoteTypes";

export type ConversationDockIdentityInput = {
  tabId?: string;
  scope?: string;
  workspaceRoot?: string;
  topicId?: string;
  sessionPath?: string;
  sessionGeneration?: number;
  remote?: RemoteTabRefView;
};

/** Which identity segment the key was derived from, in fallback order. */
export type ConversationDockIdentityKind = "topic" | "session" | "temporary";

export function conversationDockIdentityKind(input: ConversationDockIdentityInput): ConversationDockIdentityKind {
  if (input.topicId?.trim()) return "topic";
  if (input.sessionPath?.trim()) return "session";
  return "temporary";
}

/** Normalize a workspace path for use inside a key segment: trim, unify path
 *  separators, and drop trailing slashes so equivalent roots hash alike. */
function normalizeConversationWorkspaceRoot(root: string): string {
  const normalized = root.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized;
}

function identitySegment(input: ConversationDockIdentityInput): string {
  const topic = input.topicId?.trim();
  if (topic) return topic;
  const session = input.sessionPath?.trim();
  if (session) return session;
  return input.tabId?.trim() ?? "";
}

function generationSegment(input: ConversationDockIdentityInput): string {
  // sessionGeneration is a uint64 with omitempty on the wire: undefined and 0
  // are the same initial generation, so both map to "0" and stay stable until
  // a clear/new bumps the value.
  return String(input.sessionGeneration ?? 0);
}

export function conversationDockKey(input: ConversationDockIdentityInput): string {
  const generation = generationSegment(input);
  const identity = identitySegment(input);
  if (input.remote?.hostId) {
    const host = input.remote.hostId.trim() || "unknown-host";
    const workspace = normalizeConversationWorkspaceRoot(input.remote.workspace ?? "");
    return `remote:${host}:${workspace}:${identity}:${generation}`;
  }
  // No identity at all (no active tab yet): return the stable placeholder so
  // the empty dock never claims a conversation of its own.
  if (!identity && !input.workspaceRoot?.trim() && !input.scope?.trim()) {
    return EMPTY_CONVERSATION_DOCK_KEY;
  }
  const scope = input.scope?.trim() || "project";
  const root = normalizeConversationWorkspaceRoot(input.workspaceRoot ?? "");
  return `local:${scope}:${root}:${identity}:${generation}`;
}

/** Stable key for the dock while no session tab is active at all. */
export const EMPTY_CONVERSATION_DOCK_KEY = "local:::";

/** True when the key is the no-active-tab placeholder. */
export function isEmptyConversationDockKey(key: string): boolean {
  return key === EMPTY_CONVERSATION_DOCK_KEY;
}
