import { memo, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import { normalizeMath } from "./mathNormalize";
import { createComponents } from "./markdownComponents";
import { createReasonixRemarkPlugins, reasonixRehypePlugins } from "./markdownRemarkPlugins";
import { markdownImageUrlTransform, markdownUrlTransform } from "../lib/markdownPipeline";
import { useChatPathContext } from "../lib/chatPathContext";

// Markdown rendering via react-markdown + remark-gfm (tables, task lists,
// strike, autolinks) and remark-math + rehype-katex for $/$$ KaTeX math.
// This is the STREAMING path (incremental commits of a live answer); history
// rows render worker-parsed HAST blocks through MarkdownHistory instead, with
// the same plugins, components map, and urlTransform.
//
// The math pre-pass repairs LLM-native delimiters and display structure.
// remarkMathPolicy then classifies parsed inline-math AST nodes using their
// surrounding prose, avoiding false positives on currency and env vars.
//
// file:/// hrefs come from local-path linkification (remarkLocalPathLinks)
// and must survive URL sanitisation; markdownUrlTransform (shared with the
// worker parse pipeline) keeps them while blanking javascript: and friends.
// chat-path: hrefs (chat path linkification) ride the same exemption and are
// rendered by the `a` component as workspace-panel links.

const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
  bare = false,
}: {
  text: string;
  bare?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mathContent = useMemo(() => normalizeMath(text), [text]);
  const components = useMemo(() => createComponents(), []);
  const chatPath = useChatPathContext();
  // Chat-path linkification needs the workspace roots at parse time; the
  // plugin array is rebuilt only when the context changes so streaming
  // commits keep their existing remark processor.
  const remarkPlugins = useMemo(
    () => createReasonixRemarkPlugins(chatPath ? { roots: chatPath.roots } : undefined),
    [chatPath],
  );
  const content = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={reasonixRehypePlugins}
      components={components}
      // file:/// and chat-path: anchors (local + chat path linkification) are
      // safe to keep; the default transform would blank them along with
      // javascript: etc.
      urlTransform={(value, key, node) => node.tagName === "img" && key === "src"
        ? markdownImageUrlTransform(value)
        : markdownUrlTransform(value)}
    >
      {mathContent}
    </ReactMarkdown>
  );
  return bare ? content : <div className="md" ref={containerRef}>{content}</div>;
});

export default MarkdownRenderer;
