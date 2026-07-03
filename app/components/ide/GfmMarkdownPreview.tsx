import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidCodeBlock } from "./MermaidCodeBlock";
import { WikiEmbed } from "~/components/editor/WikiEmbed";
import { useI18n } from "~/i18n/context";
import { slugifyHeading } from "~/utils/wiki-subpath";
import { isLocalDocumentHref, localHrefHeading, resolveLocalHrefFile } from "~/utils/wiki-links";
import type { FileListItem } from "~/contexts/EditorContext";

/** Recursively extract plain text from react-markdown children. */
function nodeText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join("");
  if (value && typeof value === "object" && "props" in value) {
    return nodeText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

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

function preprocessWikiLinks(content: string): string {
  // Split by code fences and inline code spans to avoid processing inside them
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code block/span — leave as-is
      return part.replace(
        /\[\[([^\]|#\n]+?)(?:#([^\]|\n]+?))?(?:\|([^\]\n]+?))?\]\]/g,
        (_, fileName, heading, displayText) => {
          const trimmedName = fileName.trim();
          const trimmedHeading = heading?.trim();
          const display = displayText?.trim() || (trimmedHeading ? `${trimmedName} > ${trimmedHeading}` : trimmedName);
          const encoded =
            encodeURIComponent(trimmedName) +
            (trimmedHeading ? "#" + encodeURIComponent(trimmedHeading) : "");
          return `[${display}](__wl__${encoded})`;
        }
      );
    })
    .join("");
}

// Convert `![[spec]]` embeds into image markdown with an `__embed__` src so the
// `img` renderer can resolve them. Runs before preprocessWikiLinks (which only
// handles `[[...]]` links) so the leading `!` is consumed here.
function preprocessEmbeds(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code block/span — leave as-is
      return part.replace(/!\[\[([^\]\n]+?)\]\]/g, (_, spec) => {
        return `![](__embed__${encodeURIComponent(spec.trim())})`;
      });
    })
    .join("");
}

function GfmMarkdownPreview({
  content,
  fileList,
  currentFilePath,
  onWikiLinkClick,
  onMissingWikiLinkClick,
}: {
  content: string;
  fileList?: FileListItem[];
  currentFilePath?: string;
  onWikiLinkClick?: (fileId: string, fileName: string, heading?: string) => void;
  onMissingWikiLinkClick?: (target: string) => void;
}) {
  const { t } = useI18n();
  const processedContent = useMemo(() => (
    fileList ? preprocessWikiLinks(preprocessEmbeds(content)) : content
  ), [content, fileList]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCallouts]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        img({ src, ...props }) {
          if (typeof src === "string" && src.startsWith("__embed__") && fileList) {
            const spec = decodeURIComponent(src.slice("__embed__".length));
            return <WikiEmbed spec={spec} fileList={fileList} t={t} />;
          }
          return <img src={src} {...props} />;
        },
        h1: ({ children }) => <h1 id={slugifyHeading(nodeText(children))}>{children}</h1>,
        h2: ({ children }) => <h2 id={slugifyHeading(nodeText(children))}>{children}</h2>,
        h3: ({ children }) => <h3 id={slugifyHeading(nodeText(children))}>{children}</h3>,
        h4: ({ children }) => <h4 id={slugifyHeading(nodeText(children))}>{children}</h4>,
        h5: ({ children }) => <h5 id={slugifyHeading(nodeText(children))}>{children}</h5>,
        h6: ({ children }) => <h6 id={slugifyHeading(nodeText(children))}>{children}</h6>,
        a({ href, children, ...props }) {
          if (href?.startsWith("__wl__") && fileList) {
            const raw = decodeURIComponent(href.slice("__wl__".length));
            const hashIdx = raw.indexOf("#");
            const fileName = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
            const heading = hashIdx >= 0 ? raw.slice(hashIdx + 1) : undefined;
            if (!fileName) {
              // Same-file heading link — scroll to the slugified heading id
              return (
                <a
                  href={`#${heading ? slugifyHeading(heading) : ""}`}
                  className="text-purple-600 dark:text-purple-400 hover:underline"
                >
                  {children}
                </a>
              );
            }
            const lowerFileName = fileName.toLowerCase();
            const lowerNoExt = lowerFileName.replace(/\.md$/i, "");
            const file = fileList.find((f) => {
              const name = f.name.toLowerCase();
              const path = f.path.toLowerCase();
              return (
                name === lowerFileName ||
                name.replace(/\.md$/i, "") === lowerNoExt ||
                path === lowerFileName ||
                path.replace(/\.md$/i, "") === lowerNoExt
              );
            });
            return (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (file && onWikiLinkClick) onWikiLinkClick(file.id, file.name, heading);
                  if (!file && onMissingWikiLinkClick) onMissingWikiLinkClick(fileName);
                }}
                className="text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                title={file ? file.path || file.name : `${fileName} (not found)`}
              >
                {children}
              </a>
            );
          }
          if (href && fileList && currentFilePath && isLocalDocumentHref(href)) {
            const file = resolveLocalHrefFile(fileList, currentFilePath, href);
            const heading = localHrefHeading(href);
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (file && onWikiLinkClick) onWikiLinkClick(file.id, file.name, heading);
                  if (!file && onMissingWikiLinkClick) onMissingWikiLinkClick(href);
                }}
                className="text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                title={file ? file.path || file.name : `${href} (not found)`}
              >
                {children}
              </a>
            );
          }
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        },
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
      {processedContent}
    </ReactMarkdown>
  );
}

export default memo(GfmMarkdownPreview);
