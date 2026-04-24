import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Eye, Code } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { addCommitBoundary } from "~/services/edit-history-local";
import { EditorToolbarActions } from "../EditorToolbarActions";
import { performTempUpload } from "~/services/temp-upload";
import { useTempEditConfirm } from "~/hooks/useTempEditConfirm";
import { TempEditUrlDialog } from "~/components/shared/TempEditUrlDialog";
import { TempDiffModal } from "../TempDiffModal";
import { useIsMobile } from "~/hooks/useIsMobile";
import {
  buildHtmlPreviewSrcDoc,
  buildMockGemihubScript,
  buildAdminGemihubScript,
  collectRelativeRefs,
  isAdminPreviewFile,
  resolveNavTarget,
  resolveSiblingPath,
  IMAGE_MIME_BY_EXT,
  type SiblingAssetMap,
} from "./html-preview-mock";

type HtmlEditMode = "preview" | "raw";

export function HtmlFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const editorCtx = useEditorContext();
  const [uploading, setUploading] = useState(false);
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);
  // Used to verify postMessage senders for the admin bridge. A handler that
  // matched on data shape alone would let any window in the same tab trigger
  // privileged admin requests through this editor.
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setContent(initialContent);
    setMode("preview");
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId]);

  // Flush pending content on unmount or fileId change (saveToCache identity changes)
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  const tempEditConfirm = useTempEditConfirm();

  const handleTempUpload = useCallback(async () => {
    try {
      const feedback = await performTempUpload({ fileName, fileId, content, t, confirm: tempEditConfirm.confirm, onStart: () => setUploading(true) });
      alert(feedback);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }, [content, fileName, fileId, t, tempEditConfirm.confirm]);

  const handleTempDownload = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", fileName }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) {
        alert(t("contextMenu.noTempFile"));
        return;
      }
      const { payload } = data.tempFile;
      setTempDiffData({
        fileName,
        fileId,
        currentContent: content,
        tempContent: payload.content,
        tempSavedAt: payload.savedAt,
        currentModifiedTime: "",
        isBinary: false,
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, content, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await addCommitBoundary(fileId);
    contentFromProps.current = false;
    setContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      editorCtx.setActiveSelection(
        sel ? { text: sel, start: ta.selectionStart, end: ta.selectionEnd } : null
      );
    },
    [editorCtx]
  );

  const [mode, setMode] = useState<HtmlEditMode>(
    initialContent ? "preview" : "raw"
  );

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  const isMobile = useIsMobile();

  // Sandboxed iframes (sandbox="allow-scripts" without allow-same-origin) run
  // with an opaque origin and cannot fetch from the network. Two consequences:
  //  (a) Hubwork pages that load `/__gemihub/api.js` get an inline mock that
  //      returns cached JSON directly.
  //  (b) Plain HTML files that reference sibling .js/.css/image files by
  //      relative path (e.g. public/deck/index.html → deck-stage.js) get
  //      their siblings inlined from the IndexedDB cache.
  // Admin pages (files under admin/) are a third case: instead of the cached
  // mock they use a live bridge that postMessages through the parent IDE to
  // /api/hubwork/admin/*, so cancelling a booking or sending a reply actually
  // runs the workflow against the real sheet + Gmail under the logged-in
  // user's OAuth.
  const isAdmin = isAdminPreviewFile(fileName);
  const needsMock = content.includes("/__gemihub/api.js");
  const [previewReady, setPreviewReady] = useState(true);
  const [mockScript, setMockScript] = useState("");
  const [siblings, setSiblings] = useState<SiblingAssetMap>({});
  const [unresolvedRefs, setUnresolvedRefs] = useState<string[]>([]);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  // `null` = not yet fetched; `"missing"` = fetched and no session (401 or null email).
  // Admin preview is gated on a confirmed-non-empty email to avoid serving a
  // fake "logged in" UI. If the session is missing, we render a login-prompt
  // overlay instead of the iframe.
  type AdminAuthState = "loading" | "ready" | "missing";
  const [adminAuthState, setAdminAuthState] = useState<AdminAuthState>("loading");

  useEffect(() => {
    if (!isAdmin) {
      setSessionEmail(null);
      setAdminAuthState("loading");
      return;
    }
    let cancelled = false;
    setAdminAuthState("loading");
    (async () => {
      try {
        const res = await fetch("/api/session/me");
        if (cancelled) return;
        if (!res.ok) {
          setSessionEmail(null);
          setAdminAuthState("missing");
          return;
        }
        const data = await res.json();
        const email = typeof data?.email === "string" && data.email.length > 0
          ? data.email
          : null;
        if (email) {
          setSessionEmail(email);
          setAdminAuthState("ready");
        } else {
          setSessionEmail(null);
          setAdminAuthState("missing");
        }
      } catch {
        if (!cancelled) {
          setSessionEmail(null);
          setAdminAuthState("missing");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    const relRefs = collectRelativeRefs(content);
    const needsSiblings = relRefs.length > 0;
    if (!needsMock && !needsSiblings) {
      setMockScript("");
      setSiblings({});
      setUnresolvedRefs([]);
      setPreviewReady(true);
      return;
    }
    setPreviewReady(false);
    let cancelled = false;
    (async () => {
      try {
        const { getCachedRemoteMeta, getCachedFile } = await import("~/services/indexeddb-cache");
        const meta = await getCachedRemoteMeta();
        if (cancelled) return;

        let newMockScript = "";
        if (needsMock) {
          if (isAdmin) {
            // Admin pages: only inject the live bridge after we've confirmed
            // the IDE session is valid. If not ready yet, leave mockScript
            // empty — the parent component renders a login prompt in place
            // of the iframe until `adminAuthState === "ready"`.
            if (adminAuthState === "ready" && sessionEmail) {
              newMockScript = buildAdminGemihubScript(sessionEmail);
            } else {
              newMockScript = "";
            }
          } else {
            const mockData: Record<string, string> = {};
            for (const [fid, fmeta] of Object.entries(meta?.files ?? {})) {
              if (fmeta.name?.startsWith("web/__gemihub/") && fmeta.name.endsWith(".json")) {
                const cached = await getCachedFile(fid);
                if (cached?.content) {
                  mockData[fmeta.name] = cached.content;
                }
              }
            }
            newMockScript = buildMockGemihubScript(mockData, content);
          }
        }

        const newSiblings: SiblingAssetMap = {};
        const unresolved: string[] = [];
        if (needsSiblings) {
          const currentName = meta?.files?.[fileId]?.name;
          const currentDir = currentName && currentName.includes("/")
            ? currentName.slice(0, currentName.lastIndexOf("/"))
            : "";
          const idByPath: Record<string, string> = {};
          for (const [fid, fmeta] of Object.entries(meta?.files ?? {})) {
            if (fmeta.name) idByPath[fmeta.name] = fid;
          }
          for (const { kind, ref } of relRefs) {
            const resolved = resolveSiblingPath(currentDir, ref);
            if (!resolved) { unresolved.push(ref); continue; }
            const fid = idByPath[resolved];
            if (!fid) { unresolved.push(ref); continue; }
            const cached = await getCachedFile(fid);
            if (cancelled) return;
            if (!cached?.content) { unresolved.push(ref); continue; }
            if (kind === "script" || kind === "style") {
              newSiblings[ref] = { kind, content: cached.content };
            } else if (kind === "image") {
              const dot = resolved.lastIndexOf(".");
              const ext = dot >= 0 ? resolved.slice(dot + 1).toLowerCase() : "";
              const mime = IMAGE_MIME_BY_EXT[ext];
              if (!mime) { unresolved.push(ref); continue; }
              newSiblings[ref] = {
                kind,
                content: cached.content,
                mime,
                base64: cached.encoding === "base64",
              };
            }
          }
        }

        if (cancelled) return;
        setMockScript(newMockScript);
        setSiblings(newSiblings);
        setUnresolvedRefs(unresolved);
        setPreviewReady(true);
      } catch {
        if (cancelled) return;
        setMockScript("");
        setSiblings({});
        setUnresolvedRefs([]);
        setPreviewReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [content, fileId, needsMock, isAdmin, sessionEmail, adminAuthState]);

  const srcDocWithScripts = useMemo(() => {
    return buildHtmlPreviewSrcDoc(content, mockScript, siblings);
  }, [content, mockScript, siblings]);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      // Mobile swipe → left/right gesture event (existing behaviour).
      if (e.data?.type === "gemihub-iframe-touch") {
        if (!isMobile) return;
        const { sx, sy, st, ex, ey, et } = e.data;
        const dx = ex - sx;
        const dy = ey - sy;
        const elapsed = et - st;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && elapsed < 300) {
          window.dispatchEvent(
            new CustomEvent("iframe-swipe", { detail: { direction: dx > 0 ? "right" : "left" } })
          );
        }
        return;
      }
      // In-iframe navigation attempt (link click, form submit, location override,
      // or mock gemihub.auth.require redirect). Resolve the path to a file in
      // the cache and emit a gemihub-request-navigate event that useActiveFile
      // turns into a full file-open (URL query update + right-panel switch).
      if (e.data?.type === "gemihub-iframe-navigate") {
        const rawPath = typeof e.data.path === "string" ? e.data.path : "";
        if (!rawPath) return;
        const { getCachedRemoteMeta } = await import("~/services/indexeddb-cache");
        const meta = await getCachedRemoteMeta();
        const idByPath: Record<string, string> = {};
        for (const [fid, fmeta] of Object.entries(meta?.files ?? {})) {
          if (fmeta.name) idByPath[fmeta.name] = fid;
        }
        const currentName = meta?.files?.[fileId]?.name;
        const currentDir = currentName && currentName.includes("/")
          ? currentName.slice(0, currentName.lastIndexOf("/"))
          : "";
        const target = resolveNavTarget(rawPath, currentDir, idByPath);
        if (target.type === "external") {
          window.open(target.url, "_blank", "noopener");
        } else if (target.type === "internal") {
          const fid = idByPath[target.fileName];
          if (!fid) return;
          const mt = meta?.files?.[fid]?.mimeType || "text/html";
          window.dispatchEvent(
            new CustomEvent("gemihub-request-navigate", {
              detail: { fileId: fid, fileName: target.fileName, mimeType: mt },
            })
          );
        } else if (target.type === "not-found") {
          console.warn("[gemihub-preview] no file for path", rawPath);
        }
        return;
      }
      // Admin preview bridge: iframe's gemihub.get/post posts here and waits
      // for a matching response. We forward to /api/hubwork/admin/* under the
      // IDE session cookie, then post the parsed JSON (or error details) back.
      if (e.data?.type === "gemihub-admin-request") {
        if (!isAdmin) return; // defensive: only the admin iframe should emit this
        // Verify the message actually came from our sandboxed admin iframe.
        // Without this, any window in the same tab (sibling iframe, popup,
        // browser extension content script) could fire a request and trigger
        // sheet writes / Gmail sends under the IDE session.
        // sandbox="allow-scripts" without allow-same-origin gives the iframe
        // an opaque origin that serializes to "null".
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow || e.source !== iframeWindow || e.origin !== "null") {
          return;
        }
        const { id, method, path, body } = e.data as {
          id?: string;
          method?: string;
          path?: string;
          body?: unknown;
        };
        if (!id) return;

        const reply = (payload: Record<string, unknown>) => {
          try {
            // e.source is verified above; sending back through it (with "*"
            // targetOrigin since the iframe's opaque origin can't be named
            // explicitly) only delivers to that one window.
            iframeWindow.postMessage({ type: "gemihub-admin-response", id, ...payload }, "*");
          } catch { /* iframe may have unmounted */ }
        };

        const cleanPath = String(path || "").replace(/^\/+/, "");
        if (!cleanPath) {
          reply({ ok: false, status: 400, error: "Empty path" });
          return;
        }
        // Restrict to safe path segments. Browsers normalize `..` in fetch
        // URLs before sending, so without this filter `../../session/me`
        // would reach unrelated IDE endpoints under the session cookie.
        // Percent-encoded `..` (`%2e%2e`) is also rejected in case a future
        // browser preserves the encoding.
        const pathSegments = cleanPath.split("/");
        const isBadSegment = (seg: string) =>
          seg === "" || seg === "." || seg === ".." ||
          seg.includes("\\") || /%2e/i.test(seg);
        if (pathSegments.some(isBadSegment)) {
          reply({ ok: false, status: 400, error: "Invalid path" });
          return;
        }
        const url = method === "GET" && body && typeof body === "object"
          ? `/api/hubwork/admin/${cleanPath}?${new URLSearchParams(
              Object.fromEntries(
                Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
              ),
            ).toString()}`
          : `/api/hubwork/admin/${cleanPath}`;

        try {
          const res = await fetch(url, {
            method: method === "POST" ? "POST" : "GET",
            headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
            body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
          });
          let data: unknown = null;
          try { data = await res.json(); } catch { /* non-JSON body */ }
          if (res.ok) {
            reply({ ok: true, data });
          } else {
            const errObj = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
            reply({
              ok: false,
              status: res.status,
              error: typeof errObj.error === "string" ? errObj.error : `HTTP ${res.status}`,
              response: data,
            });
          }
        } catch (err) {
          reply({
            ok: false,
            status: 0,
            error: err instanceof Error ? err.message : "Network error",
          });
        }
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isMobile, fileId, isAdmin]);

  const modes: { key: HtmlEditMode; icon: React.ReactNode; label: string }[] = [
    { key: "preview", icon: <Eye size={ICON.MD} />, label: t("mainViewer.preview") },
    { key: "raw", icon: <Code size={ICON.MD} />, label: t("mainViewer.raw") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Mode selector */}
        <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                mode === m.key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
              title={m.label}
            >
              {m.icon}
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        <EditorToolbarActions
          onDiffClick={onDiffClick}
          onHistoryClick={onHistoryClick}
          onTempUpload={handleTempUpload}
          onTempDownload={handleTempDownload}
          uploading={uploading}
        />
      </div>

      {/* Content area. The iframe is pinned to a relative wrapper so its size
          is driven by the flex layout, not by its default intrinsic size
          (300x150) or by inner content. Without this, scripts that read
          window.innerWidth/innerHeight (e.g. deck-stage's auto-scaler) can
          see a stale/oversized viewport and overflow the MainViewer. */}
      {mode === "preview" && isAdmin && adminAuthState === "missing" && (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
          <div className="max-w-sm w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow p-6 text-center space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              ログインが必要です
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              admin プレビューは Google Drive 所有者のセッションで動きます。再ログインしてください。
            </p>
            <a
              href="/auth/google"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-md"
            >
              Google でログイン
            </a>
          </div>
        </div>
      )}
      {mode === "preview" && isAdmin && adminAuthState === "loading" && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      )}
      {mode === "preview" && previewReady && (!isAdmin || adminAuthState === "ready") && (
        <div className="relative flex-1 overflow-hidden">
          {unresolvedRefs.length > 0 && (
            <div className="absolute inset-x-0 top-0 z-10 bg-amber-100 text-amber-900 text-xs px-3 py-1.5 border-b border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700">
              <span className="font-semibold">Missing in FileTree:</span>{" "}
              {unresolvedRefs.join(", ")}
              {" — "}
              <span className="opacity-75">preview cannot fetch external resources in a sandboxed iframe. Add these files to the FileTree next to the HTML.</span>
            </div>
          )}
          <iframe
            ref={iframeRef}
            srcDoc={srcDocWithScripts}
            className="absolute inset-0 h-full w-full border-0 bg-white"
            title={fileName}
            sandbox="allow-scripts"
          />
        </div>
      )}
      {/* Loading shown while siblings/mock script are being assembled. For
          admin pages the upstream gates ("missing" / "loading" auth states)
          render their own panels above, so we only need to cover the case
          where admin auth resolved to "ready" but the bridge script isn't
          built yet. */}
      {mode === "preview" && !previewReady && (!isAdmin || adminAuthState === "ready") && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      )}

      {mode === "raw" && (
        <div className="flex-1 p-4">
          <textarea
            value={content.replace(/^\u00A0$/gm, "")}
            onChange={(e) => updateContent(e.target.value)}
            onSelect={handleSelect}
            className="w-full h-full font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>
      )}

      {tempEditConfirm.visible && (
        <TempEditUrlDialog t={t} onYes={tempEditConfirm.onYes} onNo={tempEditConfirm.onNo} />
      )}
      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
