import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidCodeBlock } from "./MermaidCodeBlock";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hProperties?: Record<string, string>;
  };
};

type CalloutInfo = {
  type: string;
  title: string;
  fold?: "open" | "closed";
  icon: string;
};

const calloutAliases: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const supportedCallouts = new Set([
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
]);

const calloutIcons: Record<string, string> = {
  note: "i",
  abstract: "≡",
  info: "i",
  todo: "✓",
  tip: "⚑",
  success: "✓",
  question: "?",
  warning: "!",
  failure: "×",
  danger: "!",
  bug: "●",
  example: "□",
  quote: "“",
};

const calloutStyles: Record<string, string> = {
  note: "border-blue-500/70 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  abstract: "border-cyan-600/70 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  info: "border-blue-500/70 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  todo: "border-blue-500/70 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  tip: "border-teal-500/70 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  success: "border-green-500/70 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  question: "border-amber-500/70 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  warning: "border-amber-500/70 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  failure: "border-red-500/70 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  danger: "border-red-500/70 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  bug: "border-red-500/70 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  example: "border-violet-500/70 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  quote: "border-zinc-500/70 bg-zinc-50 text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function parseCalloutMarker(value: string): (CalloutInfo & { rest?: string }) | null {
  const match = value.match(/^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n([\s\S]*))?$/);
  if (!match) return null;

  const rawType = match[1].toLowerCase();
  const normalizedType = calloutAliases[rawType] || rawType;
  const type = supportedCallouts.has(normalizedType) ? normalizedType : "note";
  const fold = match[2] === "+" ? "open" : match[2] === "-" ? "closed" : undefined;
  const title = match[3]?.trim() || titleCase(rawType);

  return {
    type,
    title,
    fold,
    icon: calloutIcons[type] || calloutIcons.note,
    rest: match[4],
  };
}

function visitBlockquotes(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    const first = node.children?.[0];
    const firstText = first?.type === "paragraph" ? first.children?.[0] : undefined;
    if (firstText?.type === "text" && typeof firstText.value === "string") {
      const callout = parseCalloutMarker(firstText.value);
      if (callout) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-callout": callout.type,
            "data-callout-title": callout.title,
            "data-callout-icon": callout.icon,
            ...(callout.fold ? { "data-callout-fold": callout.fold } : {}),
          },
        };

        if (callout.rest) {
          firstText.value = callout.rest;
        } else if ((first?.children?.length || 0) <= 1) {
          node.children = node.children?.slice(1);
        } else {
          first?.children?.shift();
        }
      }
    }
  }

  node.children?.forEach(visitBlockquotes);
}

function remarkCallouts() {
  return (tree: MarkdownNode) => visitBlockquotes(tree);
}

export default function GfmMarkdownPreview({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCallouts]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        blockquote({ children, node, ...props }) {
          const calloutProps = props as typeof props & Record<string, unknown>;
          const calloutType = String(calloutProps["data-callout"] || "");
          if (!calloutType) {
            return <blockquote {...props}>{children}</blockquote>;
          }

          const title = String(calloutProps["data-callout-title"] || titleCase(calloutType));
          const icon = String(calloutProps["data-callout-icon"] || calloutIcons.note);
          const fold = String(calloutProps["data-callout-fold"] || "");
          const isClosed = fold === "closed";
          const style = calloutStyles[calloutType] || calloutStyles.note;
          void node;

          return (
            <blockquote
              {...props}
              className={`not-prose my-4 rounded-md border-l-4 px-4 py-3 ${style}`}
            >
              <div className={`flex items-center gap-2 font-bold leading-snug ${isClosed ? "" : "mb-2"}`}>
                <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-current text-xs leading-none text-white">
                  <span className="text-white">{icon}</span>
                </span>
                <span className="min-w-0 flex-1">{title}</span>
              </div>
              {!isClosed && (
                <div className="text-gray-900 dark:text-gray-100 [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6">
                  {children}
                </div>
              )}
            </blockquote>
          );
        },
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
