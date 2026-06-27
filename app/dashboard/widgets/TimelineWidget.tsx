import { lazy, memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Code, Image, Loader2, PenLine, Pencil, Pin, Plus, Search, Send, Trash2, X } from "lucide-react";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { QuickOpenDialog } from "~/components/ide/QuickOpenDialog";
import { WikiEmbed } from "~/components/editor/WikiEmbed";
import { resolveWikiTarget, WikiLinkPreview } from "~/components/editor/WikiLinkPreview";
import { useEditorContext, type FileListItem } from "~/contexts/EditorContext";
import { useI18n } from "~/i18n/context";
import { findFileByNameLocal, readFileLocal, saveBinaryFileLocal, writeFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { slugifyHeading } from "~/utils/wiki-subpath";
import type { WidgetContext } from "../types";
import { FilePreviewModal } from "./FilePreviewModal";

const MarkdownEditor = lazy(() => import("~/components/editor/MarkdownEditor").then((mod) => ({ default: mod.MarkdownEditor })));

type ComposerMode = "raw" | "wysiwyg";

interface TimelineConfig {
  name?: string;
  path?: string;
  latestCount?: number;
  composerMode?: ComposerMode;
}

interface TimelinePost {
  id: string;
  createdAt: string;
  pinned: boolean;
  content: string;
  index: number;
  sourcePath: string;
}

interface ParsedPostBlock {
  raw: string;
  post: TimelinePost | null;
}

interface PendingImage {
  file: File;
  previewUrl: string;
}

interface TimelineFilters {
  word: string;
  tags: string;
  from: string;
  to: string;
  pinnedOnly: boolean;
}

const POST_MARKER_RE = /<!--\s*timeline-post:\s*([^>]+?)\s*-->/;
const ISO_DATE_LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const POST_ID_RE = /^id:\s*([A-Za-z0-9_-]+)\s*$/i;
const PINNED_RE = /^pinned:\s*(true|false)\s*$/i;
const COLLAPSE_LINE_LIMIT = 8;
const COLLAPSE_CHAR_LIMIT = 520;
const COLLAPSE_EMBED_LIMIT = 1;
const DEFAULT_LATEST_COUNT = 20;
const TIMELINE_ROOT = "Dashboards/Timeline";
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function extractPostTags(content: string): string[] {
  const tags = new Set<string>();
  const re = /(^|[\s([{])#([^\s#.,;:!?()[\]{}'"`<>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const tag = match[2].replace(/\/+$/g, "").trim();
    if (tag) tags.add(tag);
  }
  return Array.from(tags);
}

function parseTagFilter(value: string): string[] {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
    .filter(Boolean);
}

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|#\[\]\n\r\t]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "Timeline";
}

function inferNameFromLegacyPath(path?: string): string {
  if (!path) return "";
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return sanitizeName(base);
}

function timelineDir(name: string): string {
  return `${TIMELINE_ROOT}/${sanitizeName(name)}`;
}

function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function postIdFromDate(date: Date): string {
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    pad(date.getMilliseconds(), 3),
  ].join("");
}

function dayFilePath(name: string, date: Date): string {
  return `${timelineDir(name)}/${dateKey(date)}.md`;
}

function parsePostBlock(raw: string, index: number, sourcePath: string): TimelinePost | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const marker = trimmed.match(POST_MARKER_RE);
  const withoutMarker = trimmed.replace(POST_MARKER_RE, "").trim();
  const lines = withoutMarker.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const dateFromLine = ISO_DATE_LINE_RE.test(firstLine) ? firstLine : "";
  const createdAt = marker?.[1]?.trim() || dateFromLine || new Date(0).toISOString();
  const bodyStart = dateFromLine ? 1 : 0;
  const maybeId = lines[bodyStart]?.trim() ?? "";
  const idMatch = maybeId.match(POST_ID_RE);
  const maybePinned = lines[idMatch ? bodyStart + 1 : bodyStart]?.trim() ?? "";
  const pinnedMatch = maybePinned.match(PINNED_RE);
  const contentStart = (idMatch ? bodyStart + 1 : bodyStart) + (pinnedMatch ? 1 : 0);
  const body = lines.slice(contentStart).join("\n").trim();
  if (!body) return null;
  return {
    id: idMatch?.[1] || `${createdAt}-${index}`,
    createdAt,
    pinned: pinnedMatch?.[1]?.toLowerCase() === "true",
    content: body,
    index,
    sourcePath,
  };
}

function parsePostBlocks(content: string, sourcePath: string): ParsedPostBlock[] {
  return content
    .split(/^\s*---\s*$/m)
    .map((raw, index) => ({ raw: raw.trim(), post: parsePostBlock(raw, index, sourcePath) }))
    .filter((block) => block.raw);
}

function splitPosts(content: string, sourcePath: string): TimelinePost[] {
  return parsePostBlocks(content, sourcePath)
    .map((block) => block.post)
    .filter((post): post is TimelinePost => post !== null);
}

function appendPost(content: string, postBlock: string): string {
  const current = content.trim();
  if (!current) return `${postBlock}\n`;
  return `${current}\n\n---\n\n${postBlock}\n`;
}

function serializeBlocks(blocks: ParsedPostBlock[]): string {
  return blocks.map((block) => block.raw.trim()).filter(Boolean).join("\n\n---\n\n") + "\n";
}

function replacePostContent(content: string, sourcePath: string, postId: string, nextBody: string): string | null {
  let changed = false;
  const blocks = parsePostBlocks(content, sourcePath).map((block) => {
    if (block.post?.id !== postId) return block;
    changed = true;
    return {
      raw: `${block.post.createdAt}\nid: ${block.post.id}${block.post.pinned ? "\npinned: true" : ""}\n\n${nextBody.trim()}`,
      post: block.post,
    };
  });
  return changed ? serializeBlocks(blocks) : null;
}

function setPostPinnedContent(content: string, sourcePath: string, postId: string, pinned: boolean): string | null {
  let changed = false;
  const blocks = parsePostBlocks(content, sourcePath).map((block) => {
    if (block.post?.id !== postId) return block;
    changed = true;
    return {
      raw: `${block.post.createdAt}\nid: ${block.post.id}${pinned ? "\npinned: true" : ""}\n\n${block.post.content}`,
      post: { ...block.post, pinned },
    };
  });
  return changed ? serializeBlocks(blocks) : null;
}

function deletePostContent(content: string, sourcePath: string, postId: string): string | null {
  const blocks = parsePostBlocks(content, sourcePath);
  const next = blocks.filter((block) => block.post?.id !== postId);
  return next.length === blocks.length ? null : serializeBlocks(next);
}

function uniquePostId(date: Date, currentContent: string, sourcePath: string): string {
  const base = postIdFromDate(date);
  const ids = new Set(splitPosts(currentContent, sourcePath).map((post) => post.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function textForCollapse(content: string): string {
  return content
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .trim();
}

function shouldCollapsePost(content: string, fileList: FileListItem[]): boolean {
  const markdownEmbedCount = (content.match(/!\[\[([^\]\n]+?)\]\]/g) ?? []).filter((embed) => {
    const spec = embed.slice(3, -2);
    return isMarkdownEmbed(spec, fileList);
  }).length;
  if (markdownEmbedCount > 0) return true;
  const embedCount = (content.match(/!\[\[[^\]]+\]\]/g) ?? []).length + (content.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  if (embedCount > COLLAPSE_EMBED_LIMIT) return true;
  if (embedCount > 0 && content.split(/\r?\n/).filter((line) => line.trim()).length > 3) return true;
  const text = textForCollapse(content);
  if (!text) return embedCount > 0 && content.split(/\r?\n/).length > 3;
  return text.length > COLLAPSE_CHAR_LIMIT || text.split(/\r?\n/).length > COLLAPSE_LINE_LIMIT;
}

function embedTarget(spec: string): string {
  return spec.split("|")[0].trim();
}

function isMarkdownEmbed(spec: string, fileList: FileListItem[]): boolean {
  const file = resolveWikiTarget(fileList, embedTarget(spec));
  return !!file && /\.(md|markdown)$/i.test(file.name);
}

function collapsedContent(content: string, fileList: FileListItem[]): string {
  const lines = content.split(/\r?\n/);
  const byLines = lines.length > COLLAPSE_LINE_LIMIT
    ? lines.slice(0, COLLAPSE_LINE_LIMIT).join("\n").trim()
    : content.trim();
  const clipped = byLines.length <= COLLAPSE_CHAR_LIMIT ? byLines : byLines.slice(0, COLLAPSE_CHAR_LIMIT).trimEnd();
  const withoutExpandedMarkdownEmbeds = clipped.replace(/!\[\[([^\]\n]+?)\]\]/g, (match, spec: string) => {
    const target = embedTarget(spec);
    return isMarkdownEmbed(spec, fileList) ? `[[${target}]]` : match;
  });
  return `${withoutExpandedMarkdownEmbeds}\n\n...`;
}

function imageExt(file: File): string {
  return IMAGE_EXT_BY_MIME[file.type] || file.name.split(".").pop()?.toLowerCase() || "png";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.name);
}

async function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

async function savePostImage(name: string, date: Date, postId: string, file: File, index: number): Promise<string> {
  const base = `${timelineDir(name)}/attachments/${dateKey(date)}/${postId}_${String(index + 1).padStart(2, "0")}`;
  let candidate = `${base}.${imageExt(file)}`;
  let suffix = 2;
  while (await findFileByNameLocal(candidate)) {
    candidate = `${base}-${suffix++}.${imageExt(file)}`;
  }
  await saveBinaryFileLocal(candidate, await imageToBase64(file), file.type || "image/png");
  return candidate;
}

async function localFileList(): Promise<FileListItem[]> {
  const meta = await getCachedRemoteMeta();
  return Object.entries(meta?.files ?? {}).map(([id, entry]) => ({
    id,
    name: entry.name.split("/").pop() ?? entry.name,
    path: entry.name,
  }));
}

async function loadTimelineFiles(
  name: string,
  limit: number,
  skip = 0,
  filters: TimelineFilters = { word: "", tags: "", from: "", to: "", pinnedOnly: false },
): Promise<{ posts: TimelinePost[]; fileList: FileListItem[]; hasMore: boolean }> {
  const meta = await getCachedRemoteMeta();
  const prefix = `${timelineDir(name)}/`;
  const word = filters.word.trim().toLowerCase();
  const tagFilter = parseTagFilter(filters.tags);
  const from = filters.from;
  const to = filters.to || filters.from;
  const dayFiles = Object.entries(meta?.files ?? {})
    .filter(([, entry]) => entry.name.startsWith(prefix) && !entry.name.includes("/attachments/") && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name.slice(prefix.length)))
    .filter(([, entry]) => {
      const day = entry.name.slice(prefix.length, prefix.length + 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    })
    .sort((a, b) => b[1].name.localeCompare(a[1].name));

  const posts: TimelinePost[] = [];
  for (const [fileId, entry] of dayFiles) {
    try {
      const dayPosts = splitPosts(await readFileLocal(fileId), entry.name).filter((post) => {
        const postDay = dateKey(new Date(post.createdAt));
        if (from && postDay < from) return false;
        if (to && postDay > to) return false;
        if (word && !post.content.toLowerCase().includes(word)) return false;
        if (tagFilter.length > 0) {
          const postTags = new Set(extractPostTags(post.content).map((tag) => tag.toLowerCase()));
          if (tagFilter.some((tag) => !postTags.has(tag))) return false;
        }
        if (filters.pinnedOnly && !post.pinned) return false;
        return true;
      });
      posts.push(...dayPosts);
      posts.sort((a, b) => {
        const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        return byTime || b.index - a.index;
      });
      if (posts.length >= skip + limit + 1) {
        posts.length = skip + limit + 1;
        break;
      }
    } catch {
      // Skip unreadable day files; other days can still render.
    }
  }
  const selected = posts.slice(skip, skip + limit);
  selected.sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return byTime || a.index - b.index;
  });
  return { posts: selected, fileList: await localFileList(), hasMore: posts.length > skip + limit };
}

function wikiTargetPath(target: string): string {
  const clean = target.split("#")[0].split("|")[0].trim();
  if (!clean) return "";
  return clean.endsWith(".md") ? clean : `${clean}.md`;
}

export default function TimelineWidget({
  config,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t, language } = useI18n();
  const editorCtx = useEditorContext();
  const cfg = (config ?? {}) as TimelineConfig;
  const name = sanitizeName(typeof cfg.name === "string" && cfg.name.trim() ? cfg.name : inferNameFromLegacyPath(cfg.path));
  const latestCount =
    typeof cfg.latestCount === "number" && Number.isFinite(cfg.latestCount) && cfg.latestCount > 0
      ? Math.floor(cfg.latestCount)
      : DEFAULT_LATEST_COUNT;
  const composerMode: ComposerMode = cfg.composerMode === "wysiwyg" ? "wysiwyg" : "raw";

  const [posts, setPosts] = useState<TimelinePost[]>([]);
  const [loadedCount, setLoadedCount] = useState(latestCount);
  const [hasOlderPosts, setHasOlderPosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(() => new Set());
  const [resolvedFiles, setResolvedFiles] = useState<FileListItem[]>([]);
  const [showWikiLinkPicker, setShowWikiLinkPicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [wordInput, setWordInput] = useState("");
  const [filters, setFilters] = useState<TimelineFilters>({ word: "", tags: "", from: "", to: "", pinnedOnly: false });
  const [previewFile, setPreviewFile] = useState<{ fileId: string; fileName: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef<PendingImage[]>([]);
  const wikiLinkStartRef = useRef(0);

  const scrollToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);
  const imageInputId = useId();

  const previewFileList = useMemo(() => {
    const byPath = new Map<string, FileListItem>();
    [...editorCtx.fileList, ...resolvedFiles].forEach((item) => byPath.set(item.path, item));
    return Array.from(byPath.values());
  }, [editorCtx.fileList, resolvedFiles]);

  const refresh = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadTimelineFiles(name, loadedCount, 0, filters);
      setPosts(loaded.posts);
      setResolvedFiles(loaded.fileList);
      setHasOlderPosts(loaded.hasMore);
    } catch {
      setError(t("dashboard.fileNotFound"));
    } finally {
      setLoading(false);
    }
  }, [name, loadedCount, filters, t]);

  useEffect(() => {
    setLoadedCount(latestCount);
  }, [name, latestCount, filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((prev) => {
        const word = wordInput.trim();
        return prev.word === word ? prev : { ...prev, word };
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [wordInput]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadOlder = useCallback(async () => {
    if (!name || loadingOlder) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    setError(null);
    try {
      const nextCount = loadedCount + latestCount;
      const loaded = await loadTimelineFiles(name, nextCount, 0, filters);
      setLoadedCount(nextCount);
      setPosts(loaded.posts);
      setResolvedFiles(loaded.fileList);
      setHasOlderPosts(loaded.hasMore);
      requestAnimationFrame(() => {
        const nextEl = listRef.current;
        if (!nextEl) return;
        nextEl.scrollTop = nextEl.scrollHeight - prevHeight + nextEl.scrollTop;
      });
    } catch {
      setError(t("dashboard.fileNotFound"));
    } finally {
      setLoadingOlder(false);
    }
  }, [name, loadingOlder, loadedCount, latestCount, filters, t]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(scrollToLatest);
    const timers = [80, 240, 600].map((delay) => window.setTimeout(scrollToLatest, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [name, posts.length, loading, scrollToLatest]);

  const createAndOpenMissingNote = useCallback(async (target: string) => {
    const path = wikiTargetPath(target);
    if (!path) return;
    const existing = await findFileByNameLocal(path);
    const result = existing ?? await writeFileLocal(path, `# ${path.split("/").pop()?.replace(/\.md$/i, "") ?? "New Note"}\n`);
    const fileId = "id" in result ? result.id : result.fileId;
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId, fileName: path, mimeType: "text/markdown" },
      }),
    );
  }, []);

  const openWikiPreview = useCallback((fileId: string, fileName: string, heading?: string) => {
    if (heading) sessionStorage.setItem("pending-wiki-heading", slugifyHeading(heading));
    else sessionStorage.removeItem("pending-wiki-heading");
    const file = previewFileList.find((item) => item.id === fileId);
    setPreviewFile({ fileId, fileName: file?.path || fileName });
  }, [previewFileList]);

  const navigateToPreviewFile = useCallback((file: { fileId: string; fileName: string }) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.fileId, fileName: file.fileName, mimeType: "text/markdown" },
      }),
    );
  }, []);

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files).filter(isImageFile);
    setImages((prev) => {
      const slots = Math.max(0, 8 - prev.length);
      const next = selected
        .slice(0, slots)
        .map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
      return [...prev, ...next];
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setDraft("");
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
    setError(null);
    setShowWikiLinkPicker(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const startEditing = (post: TimelinePost) => {
    setEditingPostId(post.id);
    setEditDraft(post.content);
    setExpandedPosts((prev) => new Set(prev).add(post.id));
  };

  const cancelEditing = () => {
    setEditingPostId(null);
    setEditDraft("");
  };

  const saveEditing = async (post: TimelinePost) => {
    const nextBody = editDraft.trim();
    if (!nextBody) return;
    setSavingPostId(post.id);
    setError(null);
    try {
      const file = await findFileByNameLocal(post.sourcePath);
      if (!file) throw new Error("file not found");
      const current = await readFileLocal(file.id);
      const nextContent = replacePostContent(current, post.sourcePath, post.id, nextBody);
      if (nextContent == null) throw new Error("post not found");
      await writeFileLocal(post.sourcePath, nextContent, { existingFileId: file.id });
      cancelEditing();
      await refresh();
    } catch {
      setError(t("dashboard.writeFailed"));
    } finally {
      setSavingPostId(null);
    }
  };

  const deletePost = async (post: TimelinePost) => {
    if (!confirm(t("dashboard.timelineDeleteConfirm"))) return;
    setSavingPostId(post.id);
    setError(null);
    try {
      const file = await findFileByNameLocal(post.sourcePath);
      if (!file) throw new Error("file not found");
      const current = await readFileLocal(file.id);
      const nextContent = deletePostContent(current, post.sourcePath, post.id);
      if (nextContent == null) throw new Error("post not found");
      await writeFileLocal(post.sourcePath, nextContent, { existingFileId: file.id });
      await refresh();
    } catch {
      setError(t("dashboard.writeFailed"));
    } finally {
      setSavingPostId(null);
    }
  };

  const submitPost = async () => {
    if (!name || posting) return;
    const body = draft.trim();
    if (!body && images.length === 0) return;
    setPosting(true);
    setError(null);
    try {
      const now = new Date();
      const path = dayFilePath(name, now);
      const existing = await findFileByNameLocal(path);
      const current = existing ? await readFileLocal(existing.id) : "";
      const postId = uniquePostId(now, current, path);
      const imageLines: string[] = [];
      for (const [index, pending] of images.entries()) {
        const imagePath = await savePostImage(name, now, postId, pending.file, index);
        imageLines.push(`![[${imagePath}]]`);
      }
      const postBody = [body, ...imageLines].filter(Boolean).join("\n\n");
      const nextContent = appendPost(current, `${now.toISOString()}\nid: ${postId}\n\n${postBody}`);
      await writeFileLocal(path, nextContent, existing ? { existingFileId: existing.id } : undefined);
      closeComposer();
      await refresh();
      window.dispatchEvent(new CustomEvent("dashboard-data-changed", { detail: { folder: timelineDir(name) } }));
    } catch {
      setError(t("dashboard.writeFailed"));
    } finally {
      setPosting(false);
    }
  };

  const togglePinned = async (post: TimelinePost) => {
    setSavingPostId(post.id);
    setError(null);
    try {
      const file = await findFileByNameLocal(post.sourcePath);
      if (!file) throw new Error("file not found");
      const current = await readFileLocal(file.id);
      const nextContent = setPostPinnedContent(current, post.sourcePath, post.id, !post.pinned);
      if (nextContent == null) throw new Error("post not found");
      await writeFileLocal(post.sourcePath, nextContent, { existingFileId: file.id });
      await refresh();
    } catch {
      setError(t("dashboard.writeFailed"));
    } finally {
      setSavingPostId(null);
    }
  };

  const filterByTag = useCallback((tag: string) => {
    setFilters((prev) => ({ ...prev, tags: `#${tag}` }));
    setShowFilters(true);
  }, []);

  const clearFilters = useCallback(() => {
    setWordInput("");
    setFilters({ word: "", tags: "", from: "", to: "", pinnedOnly: false });
  }, []);

  if (!name) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-sm text-gray-400">
        {t("dashboard.timelineNoFile")}
      </div>
    );
  }

  const hasFilters = !!(wordInput || filters.word || filters.tags || filters.from || filters.to || filters.pinnedOnly);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-2 py-1 dark:border-gray-800">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {name}
        </span>
        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          title={t("dashboard.filter")}
          className={`relative flex items-center rounded px-1 py-0.5 ${
            showFilters || hasFilters
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          }`}
        >
          <Search size={12} />
          {hasFilters && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            title={t("dashboard.timelineFilterClear")}
            className="flex items-center rounded px-1 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {showFilters && (
      <div className="shrink-0 border-b border-gray-100 px-2 py-2 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[120px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={wordInput}
              onChange={(e) => setWordInput(e.target.value)}
              placeholder={t("dashboard.timelineFilterWord")}
              className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
            />
          </div>
          <input
            type="text"
            value={filters.tags}
            onChange={(e) => setFilters((prev) => ({ ...prev, tags: e.target.value }))}
            placeholder={t("dashboard.timelineFilterTags")}
            className="h-8 min-w-[120px] flex-1 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
          />
          <input
            type="date"
            value={filters.from}
            aria-label={t("dashboard.timelineFilterFrom")}
            onChange={(e) => {
              const from = e.target.value;
              setFilters((prev) => {
                const to = from && (!prev.to || prev.to < from) ? from : prev.to;
                return { ...prev, from, to };
              });
            }}
            className="h-8 w-[9.8rem] rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
          />
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            aria-label={t("dashboard.timelineFilterTo")}
            onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            className="h-8 w-[9.8rem] rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
          />
          <button
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, pinnedOnly: !prev.pinnedOnly }))}
            className={`flex h-8 items-center gap-1 rounded-md border px-2 text-sm ${
              filters.pinnedOnly
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                : "border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
            title={t("dashboard.timelinePinnedOnly")}
          >
            <Pin size={13} className={filters.pinnedOnly ? "fill-current" : ""} />
            <span className="whitespace-nowrap">{t("dashboard.timelinePinnedOnly")}</span>
          </button>
          {(wordInput || filters.word || filters.tags || filters.from || filters.to || filters.pinnedOnly) && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title={t("dashboard.timelineFilterClear")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      )}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto"
        onLoadCapture={scrollToLatest}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-gray-400">
            {t("dashboard.timelineEmpty")}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {hasOlderPosts && (
              <div className="flex justify-center px-3 py-2">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
                >
                  {loadingOlder ? t("dashboard.loading") : t("dashboard.timelineLoadOlder")}
                </button>
              </div>
            )}
            {posts.map((post) => (
              <TimelinePostView
                key={`${post.sourcePath}:${post.id}`}
                post={post}
                fileList={previewFileList}
                language={language}
                expanded={expandedPosts.has(post.id)}
                onToggle={() => {
                  setExpandedPosts((prev) => {
                    const next = new Set(prev);
                    if (next.has(post.id)) next.delete(post.id);
                    else next.add(post.id);
                    return next;
                  });
                }}
                onWikiLinkClick={openWikiPreview}
                onMissingWikiLinkClick={createAndOpenMissingNote}
                isEditing={editingPostId === post.id}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                onEdit={() => startEditing(post)}
                onCancelEdit={cancelEditing}
                onSaveEdit={() => saveEditing(post)}
                onDelete={() => deletePost(post)}
                onTogglePinned={() => togglePinned(post)}
                onTagClick={filterByTag}
                saving={savingPostId === post.id}
                showMoreLabel={t("dashboard.timelineShowMore")}
                showLessLabel={t("dashboard.timelineShowLess")}
                pinLabel={t("dashboard.timelinePin")}
                unpinLabel={t("dashboard.timelineUnpin")}
                saveLabel={t("common.save")}
                cancelLabel={t("common.cancel")}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 p-2 dark:border-gray-800">
        {!composerOpen ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="group flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition-all hover:w-auto hover:gap-1.5 hover:px-3 hover:bg-blue-700"
              title={t("dashboard.timelineNew")}
            >
              <Plus size={17} />
              <span className="hidden whitespace-nowrap text-sm font-medium group-hover:inline">
                {t("dashboard.timelineNew")}
              </span>
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex justify-end">
              <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
                <span className={`flex items-center gap-1 rounded px-2 py-1 ${composerMode === "raw" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "text-gray-500"}`}>
                  {composerMode === "raw" ? <Code size={12} /> : <PenLine size={12} />}
                  {composerMode === "raw" ? t("mainViewer.raw") : t("mainViewer.wysiwyg")}
                </span>
              </div>
            </div>
            {composerMode === "wysiwyg" ? (
              <div
                className="h-28 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700"
                onKeyDownCapture={() => {}}
              >
                <Suspense fallback={<Loader2 size={18} className="mx-auto mt-8 animate-spin text-gray-400" />}>
                  <MarkdownEditor
                    value={draft}
                    onChange={setDraft}
                    placeholder={t("dashboard.timelinePlaceholder")}
                    enableInternalLinks
                    renderInternalLinkPreview={(target) => <WikiLinkPreview target={target} fileList={previewFileList} t={t} />}
                    renderInternalEmbed={(spec) => <WikiEmbed spec={spec} fileList={previewFileList} t={t} />}
                    onInternalLinkClick={(target) => {
                      const file = previewFileList.find((f) => {
                        const targetPath = wikiTargetPath(target).toLowerCase();
                        return f.path.toLowerCase() === targetPath || f.name.toLowerCase() === targetPath || f.name.replace(/\.md$/i, "").toLowerCase() === target.toLowerCase();
                      });
                      if (file) {
                        window.dispatchEvent(new CustomEvent("plugin-select-file", { detail: { fileId: file.id, fileName: file.path, mimeType: "text/markdown" } }));
                      } else {
                        void createAndOpenMissingNote(target);
                      }
                    }}
                  />
                </Suspense>
              </div>
            ) : (
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    const pos = e.target.selectionStart;
                    const before = e.target.value.slice(0, pos);
                    if (before.endsWith("[[")) {
                      wikiLinkStartRef.current = pos - 2;
                      setShowWikiLinkPicker(true);
                    }
                  }}
                  placeholder={t("dashboard.timelinePlaceholder")}
                  autoFocus
                  className="h-24 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
                />
                <QuickOpenDialog
                  open={showWikiLinkPicker}
                  fileList={previewFileList}
                  zClass="z-[80]"
                  onClose={() => {
                    setShowWikiLinkPicker(false);
                    setTimeout(() => textareaRef.current?.focus(), 0);
                  }}
                  onSelectFile={(_id, fileName) => {
                    const linkPath = fileName;
                    const start = wikiLinkStartRef.current;
                    const before = draft.slice(0, start);
                    const after = draft.slice(start + 2);
                    setDraft(`${before}[[${linkPath}]]${after}`);
                    setShowWikiLinkPicker(false);
                    setTimeout(() => {
                      const ta = textareaRef.current;
                      if (!ta) return;
                      const newPos = start + linkPath.length + 4;
                      ta.focus();
                      ta.setSelectionRange(newPos, newPos);
                    }, 0);
                  }}
                />
              </div>
            )}
            {images.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {images.map((img, index) => (
                  <div key={img.previewUrl} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                    <img src={img.previewUrl} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"
                      title={t("dashboard.cancel")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <input
                  id={imageInputId}
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => addImages(e.target.files)}
                />
                <label
                  htmlFor={imageInputId}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  title={t("dashboard.timelineAttachImage")}
                >
                  <Image size={16} />
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={closeComposer}
                  disabled={posting}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t("dashboard.cancel")}
                </button>
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={posting || (!draft.trim() && images.length === 0)}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t("dashboard.timelinePost")}
                </button>
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          </div>
        )}
      </div>
      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.fileId}
          fileName={previewFile.fileName}
          onNavigate={() => {
            navigateToPreviewFile(previewFile);
            setPreviewFile(null);
          }}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

function TimelinePostViewComponent({
  post,
  fileList,
  language,
  expanded,
  onToggle,
  onWikiLinkClick,
  onMissingWikiLinkClick,
  isEditing,
  editDraft,
  onEditDraftChange,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onTogglePinned,
  onTagClick,
  saving,
  showMoreLabel,
  showLessLabel,
  pinLabel,
  unpinLabel,
  saveLabel,
  cancelLabel,
}: {
  post: TimelinePost;
  fileList: FileListItem[];
  language: string;
  expanded: boolean;
  onToggle: () => void;
  onWikiLinkClick: (fileId: string, fileName: string, heading?: string) => void;
  onMissingWikiLinkClick: (target: string) => void;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onTogglePinned: () => void;
  onTagClick: (tag: string) => void;
  saving: boolean;
  showMoreLabel: string;
  showLessLabel: string;
  pinLabel: string;
  unpinLabel: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  const collapsible = shouldCollapsePost(post.content, fileList);
  const visibleContent = collapsible && !expanded ? collapsedContent(post.content, fileList) : post.content;
  const tags = extractPostTags(post.content);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editWikiLinkStartRef = useRef(0);
  const [showEditWikiLinkPicker, setShowEditWikiLinkPicker] = useState(false);

  return (
    <article className="px-3 py-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-400">
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <time className="shrink-0">
            {new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(post.createdAt))}
          </time>
          <span className="truncate font-mono">{post.id}</span>
        </div>
        {!isEditing && (
          <div className="flex shrink-0 items-center gap-1 opacity-60 hover:opacity-100">
            <button
              type="button"
              onClick={onTogglePinned}
              disabled={saving}
              className={`rounded p-1 disabled:opacity-50 ${
                post.pinned
                  ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              }`}
              title={post.pinned ? unpinLabel : pinLabel}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Pin size={12} className={post.pinned ? "fill-current" : ""} />}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title={saveLabel}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/30"
              title="Delete"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              ref={editTextareaRef}
              value={editDraft}
              onChange={(e) => {
                onEditDraftChange(e.target.value);
                const pos = e.target.selectionStart;
                const before = e.target.value.slice(0, pos);
                if (before.endsWith("[[")) {
                  editWikiLinkStartRef.current = pos - 2;
                  setShowEditWikiLinkPicker(true);
                }
              }}
              className="h-28 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-base text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900/40"
            />
            <QuickOpenDialog
              open={showEditWikiLinkPicker}
              fileList={fileList}
              zClass="z-[80]"
              onClose={() => {
                setShowEditWikiLinkPicker(false);
                setTimeout(() => editTextareaRef.current?.focus(), 0);
              }}
              onSelectFile={(_id, fileName) => {
                const start = editWikiLinkStartRef.current;
                const before = editDraft.slice(0, start);
                const after = editDraft.slice(start + 2);
                onEditDraftChange(`${before}[[${fileName}]]${after}`);
                setShowEditWikiLinkPicker(false);
                setTimeout(() => {
                  const ta = editTextareaRef.current;
                  if (!ta) return;
                  const newPos = start + fileName.length + 4;
                  ta.focus();
                  ta.setSelectionRange(newPos, newPos);
                }, 0);
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={saving || !editDraft.trim()}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saveLabel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="prose max-w-none text-base leading-relaxed dark:prose-invert prose-p:my-1.5 prose-img:rounded-md">
            <GfmMarkdownPreview
              content={visibleContent}
              fileList={fileList}
              onWikiLinkClick={onWikiLinkClick}
              onMissingWikiLinkClick={onMissingWikiLinkClick}
            />
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onTagClick(tag)}
                  className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? showLessLabel : showMoreLabel}
            </button>
          )}
        </>
      )}
    </article>
  );
}

const TimelinePostView = memo(TimelinePostViewComponent, (prev, next) => {
  return (
    prev.post.id === next.post.id &&
    prev.post.createdAt === next.post.createdAt &&
    prev.post.content === next.post.content &&
    prev.post.sourcePath === next.post.sourcePath &&
    prev.fileList === next.fileList &&
    prev.language === next.language &&
    prev.expanded === next.expanded &&
    prev.isEditing === next.isEditing &&
    prev.editDraft === next.editDraft &&
    prev.saving === next.saving &&
    prev.showMoreLabel === next.showMoreLabel &&
    prev.showLessLabel === next.showLessLabel &&
    prev.pinLabel === next.pinLabel &&
    prev.unpinLabel === next.unpinLabel &&
    prev.saveLabel === next.saveLabel &&
    prev.cancelLabel === next.cancelLabel
  );
});
