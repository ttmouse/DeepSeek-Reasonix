// chatPathLinkify — linkify workspace file paths inside chat markdown
// (plan: docs/plan-file-open-in-chat.md).
//
// Two layers, both frontend, mirroring the local-path linkification pattern
// (lib/localPathLinks.ts) but routed to the workspace panel instead of the OS:
//
//   1. Trigger layer (pure shape heuristics): a remark plugin rewrites matching
//      text / inline-code nodes into `chat-path:` protocol links during the
//      worker parse, so the render tree carries the link and the source text is
//      untouched. No stat, no existence check — missing files still linkify,
//      the click layer is the backstop (same as Alma).
//   2. Click layer (App): resolve + stat (ReadFileForTab) → exists → open the
//      workspace panel (if closed) and route the resolved relative path through
//      WorkspacePanel's revealPathRequest.
//
// This module is DOM-free and runs inside markdown.worker.ts.

import { visit } from "unist-util-visit";
import type { Link, Parent, Root, Text } from "mdast";

export type ChatPathKind = "relative" | "abs" | "basename";

export interface ChatPathMatch {
  kind: ChatPathKind;
  /** The path text as it appears in the message (unescaped, unmodified). */
  raw: string;
}

/** Parse-time context supplied by the app (current session workspace roots). */
export interface ChatPathLinkifyContext {
  roots: readonly string[];
}

export const CHAT_PATH_PROTOCOL = "chat-path:";

const MAX_PATH_LENGTH = 512;
// Extensions gate every candidate: directories / extension-less tokens stay
// inert (Alma discriminator). 1–10 alphanumeric chars after the last dot.
const EXTENSION_RE = /\.[A-Za-z0-9]{1,10}$/;
// URL / data: URIs / @-prefixed tokens are handled elsewhere or never paths.
const FORBIDDEN_PREFIX_RE = /^(?:https?:\/\/|data:|@)/i;

// Candidate token: a run of non-whitespace that avoids quote/angle/markdown
// structure and CJK/ASCII sentence punctuation, so `foo.md。已生成` splits at
// `。` and `(foo.md)` does not swallow the parens. `.` is kept (extensions)
// and only stripped when actually trailing.
const PATH_TOKEN_RE = /[^\s<>"'`|，。；、！？（）\[\]{},;:：]+/g;

// Trailing closers that are more likely sentence punctuation than file-name
// characters. A trailing `)` is only stripped when parens are unbalanced —
// "Program Files (x86).md" keeps its closing paren, "(foo).md)." loses it.
const TRAIL_STRIP_RE = /[.)\]]+$/;

function stripTrailingClosers(raw: string): string {
  const stripped = raw.replace(TRAIL_STRIP_RE, "");
  if (stripped === raw) return raw;
  if (raw.slice(stripped.length).includes(")")) {
    const open = (raw.match(/\(/g) ?? []).length;
    const close = (raw.match(/\)/g) ?? []).length;
    if (close <= open) return raw;
  }
  return stripped;
}

/**
 * Shape-only path judgment for a single candidate token. Returns null for
 * anything that should not render as a workspace file link.
 *
 * - relative / bare-name branch: must carry an extension.
 * - absolute branch: must start with `/` AND hit one of the known workspace
 *   roots (single-workspace product semantics: cross-ws absolutes stay inert,
 *   unlike Alma which links them but cannot open them).
 * - excluded: directories (trailing `/`), whitespace/line breaks, URLs,
 *   `@` tokens, Windows/UNC shapes (owned by localPathLinks), plain `.`/`..`.
 */
export function looksLikeFilePath(text: string, ctx: ChatPathLinkifyContext): ChatPathMatch | null {
  if (text.length === 0 || text.length > MAX_PATH_LENGTH) return null;
  if (/\s/.test(text)) return null;
  if (FORBIDDEN_PREFIX_RE.test(text)) return null;
  if (text.endsWith("/") || text.endsWith("\\")) return null;
  if (!EXTENSION_RE.test(text)) return null;
  if (text === "." || text === "..") return null;

  if (text.startsWith("/")) {
    if (!ctx.roots.some((root) => text === root || text.startsWith(root + "/"))) return null;
    return { kind: "abs", raw: text };
  }
  // Backslash shapes (Windows / UNC / escaped separators) belong to the
  // local-path opener, not the workspace panel.
  if (text.includes("\\")) return null;
  if (text.includes("/")) return { kind: "relative", raw: text };
  return { kind: "basename", raw: text };
}

/** Builds the `chat-path:` href used on the rendered link. */
export function chatPathHref(raw: string): string {
  return CHAT_PATH_PROTOCOL + encodeURIComponent(raw);
}

export function isChatPathHref(href: string | undefined | null): href is string {
  return typeof href === "string" && href.startsWith(CHAT_PATH_PROTOCOL);
}

/** Recovers the original path text from a `chat-path:` href. */
export function chatPathFromHref(href: string): string {
  const encoded = href.slice(CHAT_PATH_PROTOCOL.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function chatPathLinkNode(raw: string): Link {
  return {
    type: "link",
    url: chatPathHref(raw),
    title: null,
    children: [{ type: "text", value: raw }],
  };
}

/** Splits a plain text run into plain segments and clickable path links. */
function splitTextIntoChatPathNodes(text: string, ctx: ChatPathLinkifyContext): Array<Text | Link> {
  const nodes: Array<Text | Link> = [];
  let cursor = 0;
  PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(text)) !== null) {
    const raw = match[0];
    const stripped = stripTrailingClosers(raw);
    const candidate = looksLikeFilePath(stripped, ctx);
    if (!candidate) continue;
    if (match.index > cursor) nodes.push({ type: "text", value: text.slice(cursor, match.index) });
    // The link text drops sentence-punctuation closers (`foo.md。` → `foo.md`),
    // keeping the closer as plain text.
    nodes.push(chatPathLinkNode(stripped));
    cursor = match.index + raw.length;
  }
  if (cursor === 0 && nodes.length === 0) return [];
  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes;
}

/**
 * Remark plugin: rewrites plain-text and inline-code nodes containing
 * workspace file paths into `chat-path:` links, so both the streaming
 * renderer and the worker-parsed history renderer share the same linkified
 * DOM. Fenced code blocks are deliberately untouched (sample paths inside
 * them are mostly noise; a later phase can opt in).
 *
 * `ctx` undefined disables the plugin entirely — surfaces without a workspace
 * context (tool cards, file previews) keep rendering plain text.
 */
export function remarkChatPathLinks(ctx?: ChatPathLinkifyContext) {
  return (tree: Root) => {
    if (!ctx) return;
    const plan: Array<{ parent: Parent; index: number; nodes: Array<Text | Link> }> = [];

    visit(tree, "text", (node: Text, index: number | undefined, parent) => {
      if (parent === undefined || parent === null || index === undefined || index === null) return;
      // Skip link internals: rewriting their text would nest <a> elements
      // (mdast forbids links inside links) and double-fire on click.
      if (parent.type === "link" || parent.type === "linkReference") return;
      const nodes = splitTextIntoChatPathNodes(node.value, ctx);
      if (nodes.length === 0) return;
      plan.push({ parent, index, nodes });
    });

    visit(tree, "inlineCode", (node: { type: "inlineCode"; value: string }, index: number | undefined, parent) => {
      if (parent === undefined || parent === null || index === undefined || index === null) return;
      if (parent.type === "link" || parent.type === "linkReference") return;
      const candidate = looksLikeFilePath(node.value, ctx);
      if (!candidate) return;
      plan.push({ parent, index, nodes: [chatPathLinkNode(candidate.raw)] });
    });

    // Back-to-front keeps earlier indices valid within the same parent.
    for (let i = plan.length - 1; i >= 0; i--) {
      const { parent, index, nodes } = plan[i];
      parent.children.splice(index, 1, ...nodes);
    }
  };
}
