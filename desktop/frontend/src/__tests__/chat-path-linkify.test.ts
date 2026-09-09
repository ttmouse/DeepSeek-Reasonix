// Run: tsx src/__tests__/chat-path-linkify.test.ts
//
// Judgment matrix for the chat path linkification trigger layer
// (lib/chatPathLinkify.ts) + pipeline integration + click-layer resolution,
// aligned with the 8-rule Alma reproduction table in docs/plan-file-open-in-chat.md §7.

import { parseMarkdownToBlocks } from "../lib/markdownPipeline";
import { resolveChatPathToWorkspacePath } from "../lib/chatPathResolve";
import {
  chatPathFromHref,
  chatPathHref,
  isChatPathHref,
  looksLikeFilePath,
  remarkChatPathLinks,
  type ChatPathKind,
} from "../lib/chatPathLinkify";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createComponents } from "../components/markdownComponents";
import { hastBlockToJsx } from "../lib/hastJsx";

let passed = 0;
let failed = 0;

function ok(value: unknown, label: string) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(true, label);
  else ok(false, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ROOT = "/Users/douba/Projects/DeepSeek-Reasonix";
const CTX = { roots: [ROOT] };

function kindFor(text: string): ChatPathKind | null {
  return looksLikeFilePath(text, CTX)?.kind ?? null;
}

// ── 1. Pure shape judgment (looksLikeFilePath) ─────────────────────────────
process.stdout.write("\nlooksLikeFilePath judgment matrix\n");

eq(kindFor("click-test/测试文档.md"), "relative", "#1 relative CJK path");
eq(kindFor("click-test/不存在.md"), "relative", "#2 relative missing path still linkifies (no stat)");
eq(kindFor("src/lib/foo.ts"), "relative", "relative ts path");
eq(kindFor("./click-test/data.json"), "relative", "relative with ./ prefix");
eq(kindFor("a/b/c.d.ts"), "relative", "deep relative path");

eq(kindFor("click-test"), null, "#3 bare directory name");
eq(kindFor("click-test/"), null, "directory trailing slash");
eq(kindFor("README"), null, "no extension");
eq(kindFor("click-test/docs"), null, "directory with slash, no ext");

eq(kindFor("click-test/data.json"), "relative", "#4 relative data.json");

eq(kindFor("/Users/douba/Projects/XM/CLAUDE.md"), null, "#5 absolute cross-ws");

eq(kindFor("/etc/hosts"), null, "#6 /etc/hosts");
eq(kindFor("/tmp/x.log"), null, "absolute outside ws root");

eq(kindFor("data.json"), "basename", "#7 bare data.json");
eq(kindFor("测试文档.md"), "basename", "bare CJK name");

eq(kindFor(`${ROOT}/click-test/不存在.md`), "abs", "#8 absolute under ws root (missing still links)");
eq(kindFor(`${ROOT}/click-test/测试文档.md`), "abs", "absolute under ws root");

eq(kindFor("https://example.com/a.md"), null, "http(s) URL prefix");
eq(kindFor("data:text/plain,a.md"), null, "data: prefix");
eq(kindFor("@user/file.md"), null, "@-prefixed token");
eq(kindFor("foo bar.md"), null, "whitespace inside");
eq(kindFor("foo\nbar.md"), null, "newline inside");
eq(kindFor("C:\\x\\y.md"), null, "Windows drive path (owned by localPathLinks)");
eq(kindFor("\\nas\\share\\a.md"), null, "UNC shape");
eq(kindFor(".."), null, "bare ..");
eq(kindFor("."), null, "bare .");
eq(kindFor(`${"a".repeat(600)}.md`), null, "over 512 chars");
eq(kindFor("archive.tar.gz"), "basename", "compound extension");
eq(kindFor("folder/foo.MD"), "relative", "uppercase extension");
eq(kindFor("click-test/测试 文档.md"), null, "CJK path with space is not linked (accepted)");

eq(kindFor(`${ROOT}-sibling/a.md`), null, "root prefix sibling not matched");
eq(kindFor(`${ROOT}/a.md`), "abs", "root itself is a file");

// ── 2. href codec ──────────────────────────────────────────────────────────
process.stdout.write("\nchat-path href codec\n");
{
  const raw = "click-test/测试文档.md";
  const href = chatPathHref(raw);
  ok(isChatPathHref(href), "href carries chat-path protocol");
  eq(chatPathFromHref(href), raw, "href round-trips the raw path");
  ok(!isChatPathHref("file:///x.md"), "file:/// href is not chat-path");
  ok(!isChatPathHref(undefined), "undefined href is not chat-path");
  eq(chatPathFromHref("chat-path:%E2%9C%93"), "✓", "decodes utf-8 payload");
}

// ── 3. Remark plugin rewrite (mdast level) ─────────────────────────────────
process.stdout.write("\nremark plugin rewrite\n");
function parseLinks(text: string, ctx: { roots: readonly string[] } = CTX) {
  const processor = unified().use(remarkParse).use(() => remarkChatPathLinks(ctx));
  const tree = processor.runSync(processor.parse(text)) as Root;
  const links: Array<{ url: string; text: string }> = [];
  const walk = (node: unknown) => {
    if (node === null || typeof node !== "object") return;
    const n = node as { type?: string; children?: unknown[]; url?: string; value?: string };
    if (n.type === "link") {
      const child = (n.children?.[0] as { value?: string } | undefined);
      links.push({ url: n.url ?? "", text: child?.value ?? "" });
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(tree);
  return links.filter((link) => link.url.startsWith("chat-path:"));
}

{
  const links = parseLinks("文件在 click-test/测试文档.md 中，参考 click-test/data.json");
  eq(links.length, 2, "two paths in one sentence both linkify");
  eq(links[0]?.text, "click-test/测试文档.md", "first link text is the raw path");
  eq(links[1]?.text, "click-test/data.json", "second link text is the raw path");
}
{
  const links = parseLinks("运行 `click-test/data.json` 即可");
  eq(links.length, 1, "inline-code path linkifies");
  eq(links[0]?.text, "click-test/data.json", "inline-code link text");
}
{
  const links = parseLinks("```\nclick-test/data.json\n```\nfenced");
  eq(links.length, 0, "fenced code block untouched");
}
{
  const links = parseLinks("[见 click-test/data.json](https://example.com)");
  eq(links.length, 0, "markdown link internals untouched");
}
{
  const links = parseLinks(`绝对路径 ${ROOT}/click-test/a.md 与跨 ws /Users/douba/Projects/XM/CLAUDE.md`);
  eq(links.length, 1, "ws-root absolute links, cross-ws does not");
  eq(links[0]?.text, `${ROOT}/click-test/a.md`, "abs link text");
}
{
  const links = parseLinks("句尾 foo.md。已生成");
  eq(links.length, 1, "CJK period stops the token");
  eq(links[0]?.text, "foo.md", "trailing CJK punctuation stripped from link text");
}
{
  const disabledProcessor = unified().use(remarkParse).use(() => remarkChatPathLinks(undefined));
  const tree = disabledProcessor.runSync(disabledProcessor.parse("裸名 data.json 唯一")) as Root;
  const links = tree.children.filter((child) => child.type === "link");
  eq(links.length, 0, "plugin disabled when ctx is undefined");
}

// ── 4. Pipeline integration (worker path) ──────────────────────────────────
process.stdout.write("\npipeline integration\n");
{
  const blocks = parseMarkdownToBlocks("文件在 click-test/测试文档.md 中", { roots: [ROOT] });
  const html = renderToStaticMarkup(createElement(Fragment, {
    children: blocks.map((block) => createElement(Fragment, {
      key: block.key,
      children: hastBlockToJsx(block, createComponents()) as ReactNode,
    })),
  }));
  ok(html.includes("chat-path:"), "block render contains chat-path href");
  ok(html.includes("md-path-link"), "block render contains md-path-link class");
  ok(html.includes("click-test/测试文档.md"), "link text intact");
}
{
  const blocks = parseMarkdownToBlocks("跨 ws /Users/douba/Projects/XM/CLAUDE.md", { roots: [ROOT] });
  const html = renderToStaticMarkup(createElement(Fragment, {
    children: blocks.map((block) => createElement(Fragment, {
      key: block.key,
      children: hastBlockToJsx(block, createComponents()) as ReactNode,
    })),
  }));
  eq(html.includes("chat-path:"), false, "cross-ws absolute stays plain");
}
{
  const withCtx = parseMarkdownToBlocks("见 click-test/data.json", { roots: [ROOT] });
  const withoutCtx = parseMarkdownToBlocks("见 click-test/data.json");
  const htmlWith = renderToStaticMarkup(createElement(Fragment, {
    children: withCtx.map((block) => createElement(Fragment, {
      key: block.key, children: hastBlockToJsx(block, createComponents()) as ReactNode,
    })),
  }));
  const htmlWithout = renderToStaticMarkup(createElement(Fragment, {
    children: withoutCtx.map((block) => createElement(Fragment, {
      key: block.key, children: hastBlockToJsx(block, createComponents()) as ReactNode,
    })),
  }));
  ok(htmlWith.includes("md-path-link"), "pathCtx provided → linkified");
  eq(htmlWithout.includes("md-path-link"), false, "no pathCtx → plain text (no regression)");
}

// ── 5. Click-layer resolution (resolveChatPathToWorkspacePath) ─────────────
process.stdout.write("\nclick-layer resolution (acceptance table §7)\n");
{
  const TAB = "tab-1";
  const CWD = ROOT;
  const files = new Map<string, string>([
    ["click-test/测试文档.md", "ok"],
    ["click-test/data.json", "ok"],
    ["click-test/a.md", "ok"],
    ["docs/a.md", "ok"],
  ]);
  const deps = {
    searchFileRefs: async (id: string, query: string) => {
      eq(id, TAB, "basename search uses the active tab");
      const hits = Array.from(files.keys()).filter((p) => p.split("/").pop()?.toLowerCase().includes(query.toLowerCase()));
      return hits.map((p) => ({ name: p, isDir: false }));
    },
    readFile: async (id: string, rel: string) => {
      eq(id, TAB, "read/stat uses the active tab");
      return files.has(rel) ? { path: rel, body: "", size: 1, truncated: false, binary: false } : { path: rel, body: "", size: 0, truncated: false, binary: false, err: "no such file" };
    },
  };

  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "click-test/测试文档.md", "relative", deps), "click-test/测试文档.md", "#1 exists relative opens");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "click-test/不存在.md", "relative", deps), null, "#2 missing relative stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "click-test", "relative", deps), null, "#3 directory stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "click-test/data.json", "relative", deps), "click-test/data.json", "#4 exists relative opens");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "/Users/douba/Projects/XM/CLAUDE.md", "abs", deps), null, "#5 cross-ws absolute stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "/etc/hosts", "abs", deps), null, "#6 non-ws absolute stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "data.json", "basename", deps), "click-test/data.json", "#7 unique bare name opens the matching file");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "a.md", "basename", deps), null, "ambiguous bare name stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "missing.md", "basename", deps), null, "bare name without file-tree match stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, `${ROOT}/click-test/不存在.md`, "abs", deps), null, "#8 ws-root absolute missing stays silent");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, `${ROOT}/click-test/a.md`, "abs", deps), "click-test/a.md", "ws-root absolute opens");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "./click-test/a.md", "relative", deps), "click-test/a.md", "relative ./ prefix normalized");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "../escape.md", "relative", deps), null, "escape attempt rejected by read backstop");
  eq(await resolveChatPathToWorkspacePath(TAB, CWD, "click-test", "basename", deps), null, "directory bare name stays silent");
}

process.stdout.write(`\nchat-path-linkify: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
