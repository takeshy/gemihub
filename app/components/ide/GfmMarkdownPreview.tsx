"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidCodeBlock } from "./MermaidCodeBlock";

export default function GfmMarkdownPreview({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        p({ children, ...props }) {
          // NBSP-only paragraphs are blank line markers from wysimark-lite.
          // Render them as empty spacers instead of showing &nbsp; text.
          const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
          if (text === "\u00A0") {
            return <p {...props}>&nbsp;</p>;
          }
          return <p {...props}>{children}</p>;
        },
        code({ className, children, ...props }) {
          const match = /language-mermaid/.exec(className || "");
          if (match) {
            const code = String(children).replace(/\n$/, "");
            return <MermaidCodeBlock code={code} />;
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
