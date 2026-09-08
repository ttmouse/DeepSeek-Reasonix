// markdownComponents — the shared components map for both Markdown render
// paths: react-markdown (streaming) and the worker-parsed block renderer
// (history). Kept in its own CSS-free module so the worker-path renderer and
// plain-tsx tests can import it without pulling the katex stylesheet.
//
// Fenced code blocks go through CodeViewer for syntax highlighting; inline
// code is a styled <code>. Mermaid fences lazy-load the diagram renderer.
// Links open in the system browser via RichMarkdownLink. Oversized tables
// virtualize their body rows.

import { lazy, Suspense } from "react";
import type { Components } from "react-markdown";
import { CodeViewer } from "./CodeViewer";
import { StreamWidget } from "./StreamWidget";
import { RichMarkdownLink } from "./githubLink";
import { MarkdownTable } from "./MarkdownTable";
import { MarkdownImage } from "./MarkdownImage";

const MermaidDiagram = lazy(() => import("./MermaidDiagram"));

// The components map is shared by the main-thread react-markdown renderer
// (streaming path) and the worker-parsed block renderer (history path), so
// both produce byte-identical DOM for the same document.
export function createComponents(): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
    code: ({ className, children }) => {
      const text = String(children ?? "");
      const match = /language-([\w-]+)/.exec(className ?? "");
      const lang = match?.[1];
      const isBlock = match !== null || text.includes("\n");
      if (isBlock) {
        const value = text.replace(/\n$/, "");
        if (lang === "widget") {
          return <StreamWidget value={value} />;
        }
        if (lang === "mermaid") {
          return (
            <Suspense fallback={<CodeViewer value={value} language="mermaid" scrollMode="bounded" maxHeight="min(60vh, 28rem)" />}>
              <MermaidDiagram definition={value} />
            </Suspense>
          );
        }
        return <CodeViewer value={value} language={lang} scrollMode="bounded" maxHeight="min(60vh, 28rem)" />;
      }
      return <code className="md-code">{children}</code>;
    },
    a: ({ href, children }) => <RichMarkdownLink href={href}>{children}</RichMarkdownLink>,
    img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} />,
  };
}
