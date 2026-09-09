// chatPathResolve — click-layer resolution for chat path links.
//
// Turns the linkified path text into a workspace-relative path that exists,
// or returns null (silent no-op, Alma parity). Resolution is backend-free in
// shape but uses the tab bridge for the file tree basename search (bare
// names) and the read/stat backstop (relative/absolute paths).

import type { ChatPathKind } from "./chatPathLinkify";
import type { DirEntry, FilePreview } from "./types";

export interface ChatPathResolveDeps {
  /** Workspace file-tree search by basename (SearchFileRefsForTab). */
  searchFileRefs: (tabId: string, query: string) => Promise<DirEntry[]>;
  /** Read + stat a workspace-relative path (ReadFileForTab; rejects escapes,
   *  directories and missing files through `err`). */
  readFile: (tabId: string, rel: string) => Promise<FilePreview>;
}

/**
 * Resolves a linkified path to a workspace-relative path ready for
 * WorkspacePanel.selectFile, or null when it should not open:
 *
 * - abs: must be under `cwd` (trigger layer already filtered; double check).
 * - relative: normalized, existence backstopped by readFile.
 * - basename: unique exact basename match in the file tree, existence
 *   included; ambiguity or no match → null.
 */
export async function resolveChatPathToWorkspacePath(
  tabId: string,
  cwd: string,
  pathText: string,
  kind: ChatPathKind,
  deps: ChatPathResolveDeps,
): Promise<string | null> {
  let rel: string | null = null;
  if (kind === "abs") {
    if (pathText !== cwd && !pathText.startsWith(cwd + "/")) return null;
    rel = pathText.slice(cwd.length).replace(/^[/\\]+/, "") || null;
  } else if (kind === "relative") {
    rel = pathText.replace(/^\.\//, "").replace(/\\/g, "/");
  } else {
    const matches = (await deps.searchFileRefs(tabId, pathText).catch(() => []))
      .filter((entry) => !entry.isDir && (entry.name.split("/").pop()?.toLowerCase() === pathText.toLowerCase()));
    if (matches.length !== 1) return null;
    rel = matches[0].name;
  }
  if (!rel || rel === "." || rel === "..") return null;
  const preview = await deps.readFile(tabId, rel).catch(() => null);
  if (!preview || preview.err) return null;
  return rel;
}
