import { isValidElement, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidCodeBlock } from "./MermaidCodeBlock";
import type { FileListItem } from "~/contexts/EditorContext";
import { getCachedFile, setCachedFile } from "~/services/indexeddb-cache";

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

function normalizeWikiPath(value: string): string {
  return value.trim().replace(/\.md$/i, "").toLowerCase();
}

function resolveWikiLinkFile(fileList: FileListItem[], target: string): FileListItem | null {
  const normalizedTarget = normalizeWikiPath(target);
  if (!normalizedTarget) return null;

  const pathMatch = fileList.find((f) => normalizeWikiPath(f.path) === normalizedTarget);
  if (pathMatch) return pathMatch;

  const basenameMatches = fileList.filter((f) => normalizeWikiPath(f.name) === normalizedTarget);
  return basenameMatches.length === 1 ? basenameMatches[0] : null;
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function nodeText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join("");
  if (value && typeof value === "object" && "props" in value) {
    return nodeText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

function isAudioName(name: string): boolean {
  return /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(name);
}

function isVideoName(name: string): boolean {
  return /\.(mp4|webm|ogv|mov|m4v)$/i.test(name);
}

function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

function parseEmbedSpec(raw: string): {
  fileName: string;
  subpath?: string;
  display?: string;
  width?: number;
  height?: number;
} {
  const pipeIdx = raw.lastIndexOf("|");
  const target = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  const display = pipeIdx >= 0 ? raw.slice(pipeIdx + 1).trim() : undefined;
  const hashIdx = target.indexOf("#");
  const fileName = (hashIdx >= 0 ? target.slice(0, hashIdx) : target).trim();
  const subpath = hashIdx >= 0 ? target.slice(hashIdx + 1).trim() : undefined;
  const sizeMatch = display?.match(/^(\d+)(?:x(\d+))?$/);
  return {
    fileName,
    subpath,
    display,
    width: sizeMatch ? Number(sizeMatch[1]) : undefined,
    height: sizeMatch?.[2] ? Number(sizeMatch[2]) : undefined,
  };
}

function parseImageSize(alt: string | undefined): { width?: number; height?: number } {
  const match = alt?.trim().match(/^(\d+)(?:x(\d+))?$/);
  return {
    width: match ? Number(match[1]) : undefined,
    height: match?.[2] ? Number(match[2]) : undefined,
  };
}

function extractMarkdownSubpath(content: string, subpath?: string): string {
  if (!subpath) return content;

  if (subpath.startsWith("^")) {
    const blockId = subpath.slice(1);
    const lines = content.split("\n");
    const markerIndex = lines.findIndex((line) => line.trim() === `^${blockId}`);
    if (markerIndex < 0) return "";
    let start = markerIndex - 1;
    while (start >= 0 && lines[start].trim() !== "") start--;
    return lines.slice(start + 1, markerIndex).join("\n").trim();
  }

  const wantedSlug = slugifyHeading(subpath);
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return match ? slugifyHeading(match[2]) === wantedSlug : false;
  });
  if (headingIndex < 0) return "";

  const currentLevel = lines[headingIndex].match(/^(#{1,6})/)?.[1].length ?? 1;
  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= currentLevel) {
      end = i;
      break;
    }
  }
  return lines.slice(headingIndex, end).join("\n").trim();
}

function pdfUrl(fileId: string, subpath?: string, rawVersion = 0): { src: string; height?: number } {
  const params = new URLSearchParams();
  if (subpath) {
    for (const piece of subpath.split("#")) {
      const [key, value] = piece.split("=");
      if (key === "page" && value) params.set("page", value);
      if (key === "height" && value) params.set("height", value);
    }
  }
  const hash = params.toString();
  return {
    src: `/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}&v=${rawVersion}${hash ? `#${hash}` : ""}`,
    height: params.get("height") ? Number(params.get("height")) : undefined,
  };
}

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

function preprocessEmbeds(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(
        /!\[\[([^\]\n]+?)\]\]/g,
        (_, rawSpec) => {
          const spec = String(rawSpec).trim();
          const display = parseEmbedSpec(spec).display || spec;
          return `![${display}](__embed__${encodeURIComponent(spec)})`;
        }
      );
    })
    .join("");
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

function EmbeddedFile({
  rawSpec,
  fileList,
  embedDepth,
  onWikiLinkClick,
}: {
  rawSpec: string;
  fileList: FileListItem[];
  embedDepth: number;
  onWikiLinkClick?: (fileId: string, fileName: string, heading?: string) => void;
}) {
  const spec = parseEmbedSpec(rawSpec);
  const file = resolveWikiLinkFile(fileList, spec.fileName);
  const fileId = file?.id;
  const fileName = file?.name;
  const filePath = file?.path;
  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "missing" | "error">("idle");
  const [rawVersion, setRawVersion] = useState(0);

  useEffect(() => {
    if (!fileId || !fileName || (!isMarkdownName(fileName) && !fileName.toLowerCase().endsWith(".canvas"))) return;
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        const cached = await getCachedFile(fileId);
        if (cached?.content != null) {
          if (!cancelled) {
            setContent(cached.content);
            setStatus("loaded");
          }
          return;
        }
        const res = await fetch(`/api/drive/files?action=read&fileId=${encodeURIComponent(fileId)}`);
        if (!res.ok) throw new Error("Failed to load embedded file");
        const data = await res.json();
        const loadedContent = typeof data.content === "string" ? data.content : "";
        await setCachedFile({
          fileId,
          content: loadedContent,
          md5Checksum: data.md5Checksum ?? "",
          modifiedTime: data.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName: filePath || fileName,
        });
        if (!cancelled) {
          setContent(loadedContent);
          setStatus("loaded");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fileId, fileName, filePath]);

  useEffect(() => {
    if (!file) return;
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string; content?: string }>).detail;
      if (detail?.fileId === file.id && typeof detail.content === "string") {
        setContent(detail.content);
        setStatus("loaded");
        setRawVersion((version) => version + 1);
        return;
      }
      if (detail?.fileId === file.id) {
        setRawVersion((version) => version + 1);
        const cached = await getCachedFile(file.id);
        if (cached?.content != null) {
          setContent(cached.content);
          setStatus("loaded");
        }
      }
    };
    window.addEventListener("wiki-links-updated", handler);
    window.addEventListener("file-cached", handler);
    window.addEventListener("file-modified", handler);
    return () => {
      window.removeEventListener("wiki-links-updated", handler);
      window.removeEventListener("file-cached", handler);
      window.removeEventListener("file-modified", handler);
    };
  }, [file]);

  if (!file) {
    return <span className="text-sm text-gray-500 dark:text-gray-400">{spec.fileName} (not found)</span>;
  }

  const rawUrl = `/api/drive/files?action=raw&fileId=${encodeURIComponent(file.id)}&v=${rawVersion}`;
  const lowerName = file.name.toLowerCase();
  if (isImageName(file.name)) {
    return (
      <img
        src={rawUrl}
        alt={spec.display || file.name}
        width={spec.width}
        height={spec.height}
        className="my-3 max-w-full rounded-md border border-gray-200 dark:border-gray-700"
      />
    );
  }

  if (isAudioName(file.name)) {
    return <audio src={rawUrl} controls className="my-3 w-full" />;
  }

  if (isVideoName(file.name)) {
    return <video src={rawUrl} controls className="my-3 max-h-[520px] w-full rounded-md bg-black" />;
  }

  if (lowerName.endsWith(".pdf")) {
    const pdf = pdfUrl(file.id, spec.subpath, rawVersion);
    return (
      <iframe
        title={file.name}
        src={pdf.src}
        className="my-3 w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
        style={{ height: pdf.height || spec.height || 520 }}
      />
    );
  }

  if (lowerName.endsWith(".canvas")) {
    return <EmbeddedCanvas content={content} status={status} name={file.name} />;
  }

  if (isMarkdownName(file.name)) {
    if (embedDepth >= 3) {
      return <div className="my-3 text-sm text-gray-500 dark:text-gray-400">Embed depth limit reached: {file.name}</div>;
    }
    if (status === "loading" || status === "idle") {
      return <div className="my-3 text-sm text-gray-500 dark:text-gray-400">Loading {file.name}...</div>;
    }
    if (status === "error" || content == null) {
      return <div className="my-3 text-sm text-red-500">Failed to load {file.name}</div>;
    }
    const embeddedContent = extractMarkdownSubpath(content, spec.subpath);
    return (
      <div className="not-prose my-3 rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <GfmMarkdownPreview
            content={embeddedContent || content}
            fileList={fileList}
            onWikiLinkClick={onWikiLinkClick}
            embedDepth={embedDepth + 1}
          />
        </div>
      </div>
    );
  }

  return (
    <a href={rawUrl} className="text-purple-600 hover:underline dark:text-purple-400">
      {file.name}
    </a>
  );
}

function EmbeddedCanvas({
  content,
  status,
  name,
}: {
  content: string | null;
  status: "idle" | "loading" | "loaded" | "missing" | "error";
  name: string;
}) {
  if (status === "loading" || status === "idle") {
    return <div className="my-3 text-sm text-gray-500 dark:text-gray-400">Loading {name}...</div>;
  }
  if (status === "error" || !content) {
    return <div className="my-3 text-sm text-red-500">Failed to load {name}</div>;
  }
  try {
    const parsed = JSON.parse(content) as { nodes?: Array<{ id?: string; type?: string; x?: number; y?: number; width?: number; height?: number }> };
    const nodes = (parsed.nodes || []).filter((node) => typeof node.x === "number" && typeof node.y === "number");
    if (nodes.length === 0) {
      return <div className="my-3 text-sm text-gray-500 dark:text-gray-400">{name} is empty</div>;
    }
    const minX = Math.min(...nodes.map((node) => node.x || 0));
    const minY = Math.min(...nodes.map((node) => node.y || 0));
    const maxX = Math.max(...nodes.map((node) => (node.x || 0) + (node.width || 180)));
    const maxY = Math.max(...nodes.map((node) => (node.y || 0) + (node.height || 100)));
    const width = Math.max(320, maxX - minX + 40);
    const height = Math.max(180, maxY - minY + 40);
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="my-3 h-72 w-full rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
        {nodes.map((node, i) => (
          <rect
            key={node.id || i}
            x={(node.x || 0) - minX + 20}
            y={(node.y || 0) - minY + 20}
            width={node.width || 180}
            height={node.height || 100}
            rx={6}
            className="fill-white stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600"
          />
        ))}
      </svg>
    );
  } catch {
    return <div className="my-3 text-sm text-red-500">Invalid canvas: {name}</div>;
  }
}

export default function GfmMarkdownPreview({
  content,
  fileList,
  onWikiLinkClick,
  embedDepth = 0,
}: {
  content: string;
  fileList?: FileListItem[];
  onWikiLinkClick?: (fileId: string, fileName: string, heading?: string) => void;
  embedDepth?: number;
}) {
  const processedContent = fileList ? preprocessWikiLinks(preprocessEmbeds(content)) : content;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCallouts]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        a({ href, children, ...props }) {
          if (href?.startsWith("__wl__") && fileList) {
            const raw = decodeURIComponent(href.slice("__wl__".length));
            const hashIdx = raw.indexOf("#");
            const fileName = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
            const heading = hashIdx >= 0 ? raw.slice(hashIdx + 1) : undefined;
            if (!fileName) {
              // Same-file heading link
              return (
                <a href={`#${heading}`} className="text-purple-600 dark:text-purple-400 hover:underline">
                  {children}
                </a>
              );
            }
            const file = resolveWikiLinkFile(fileList, fileName);
            return (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (file && onWikiLinkClick) onWikiLinkClick(file.id, file.name, heading);
                }}
                className="text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                title={file ? file.path || file.name : `${fileName} (not found)`}
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
          const childArray = Array.isArray(children) ? children : [children];
          if (
            childArray.length === 1
            && isValidElement(childArray[0])
            && childArray[0].type === EmbeddedFile
          ) {
            return <>{children}</>;
          }
          return <p {...props}>{children}</p>;
        },
        img({ src, alt, ...props }) {
          if (src?.startsWith("__embed__") && fileList) {
            const rawSpec = decodeURIComponent(src.slice("__embed__".length));
            return (
              <EmbeddedFile
                rawSpec={rawSpec}
                fileList={fileList}
                onWikiLinkClick={onWikiLinkClick}
                embedDepth={embedDepth}
              />
            );
          }
          const size = parseImageSize(alt);
          return (
            <img
              src={src}
              alt={alt}
              width={size.width}
              height={size.height}
              className="max-w-full rounded-md"
              {...props}
            />
          );
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
        h1({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h1 id={id || undefined} {...props}>{children}</h1>;
        },
        h2({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h2 id={id || undefined} {...props}>{children}</h2>;
        },
        h3({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h3 id={id || undefined} {...props}>{children}</h3>;
        },
        h4({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h4 id={id || undefined} {...props}>{children}</h4>;
        },
        h5({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h5 id={id || undefined} {...props}>{children}</h5>;
        },
        h6({ children, ...props }) {
          const id = slugifyHeading(nodeText(children));
          return <h6 id={id || undefined} {...props}>{children}</h6>;
        },
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}
