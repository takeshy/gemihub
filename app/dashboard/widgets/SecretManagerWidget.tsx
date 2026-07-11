import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileKey2,
  Folder,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import {
  deleteFileLocal,
  findFileByNameLocal,
  listFilesLocal,
  readFileLocal,
  renameFileLocal,
  writeFileLocal,
} from "~/services/drive-local";
import {
  encryptFileContent,
  decryptFileContent,
  decryptWithPrivateKey,
  getEncryptedFileMetadata,
  isEncryptedFile,
} from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import type { SecretManagerConfig, SecretTreeDir, SecretTreeNode } from "../secret-manager";
import {
  buildSecretTree,
  matchesSecretSearch,
  normalizeSecretFolder,
  secretFilePath,
} from "../secret-manager";
import { parallelProcess } from "~/utils/parallel";
import type { EncryptionSettings } from "~/types/settings";

interface SecretEntry {
  id: string;
  name: string;
  description: string;
  publicMetadata: Record<string, string>;
  modifiedTime?: string;
}

interface MetadataField {
  id: string;
  key: string;
  value: string;
}

function metadataFields(metadata: Record<string, string>): MetadataField[] {
  return Object.entries(metadata).map(([key, value], index) => ({ id: `${index}-${key}`, key, value }));
}

function metadataRecord(fields: MetadataField[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const key = field.key.trim();
    if (key && !["description", "__proto__", "prototype", "constructor"].includes(key)) {
      result[key] = field.value;
    }
  }
  return result;
}

interface SecretManagerWidgetProps {
  config: unknown;
  encryptionSettings?: EncryptionSettings;
}

function displayName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.encrypted$/i, "");
}

function relativeSecretPath(path: string, folder: string): string {
  return folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

export default function SecretManagerWidget({ config, encryptionSettings: encryption }: SecretManagerWidgetProps) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as SecretManagerConfig;
  const folder = normalizeSecretFolder(cfg.folder ?? "");
  const encryptionReady = Boolean(
    encryption?.publicKey && encryption.encryptedPrivateKey && encryption.salt,
  );

  const [entries, setEntries] = useState<SecretEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [description, setDescription] = useState("");
  const [publicMetadataFields, setPublicMetadataFields] = useState<MetadataField[]>([]);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<SecretEntry | null>(null);
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");

  const refresh = useCallback(async () => {
    const result = await listFilesLocal(folder || undefined, {
      limit: 100000,
      sortBy: "name",
      sortOrder: "asc",
    });
    const encryptedFiles = result.files.filter((file) => file.name.toLowerCase().endsWith(".encrypted"));
    const next = await parallelProcess(encryptedFiles, async (file): Promise<SecretEntry> => {
      try {
        const content = await readFileLocal(file.id);
        const metadata = isEncryptedFile(content) ? getEncryptedFileMetadata(content) : {};
        return {
          ...file,
          description: metadata.description ?? "",
          publicMetadata: metadata.publicMetadata ?? {},
        };
      } catch {
        return { ...file, description: "", publicMetadata: {} };
      }
    }, 5);
    setEntries(next);
  }, [folder]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    };
    window.addEventListener("file-modified", schedule);
    window.addEventListener("files-pulled", schedule);
    window.addEventListener("tree-meta-updated", schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("file-modified", schedule);
      window.removeEventListener("files-pulled", schedule);
      window.removeEventListener("tree-meta-updated", schedule);
    };
  }, [refresh]);

  const filtered = useMemo(
    () => (entries ?? []).filter((entry) =>
      matchesSecretSearch(entry.name, entry.description, query, entry.publicMetadata)
    ),
    [entries, query],
  );
  const tree = useMemo(
    () => buildSecretTree(filtered, (entry) => relativeSecretPath(entry.name, folder)),
    [filtered, folder],
  );
  const entryById = useMemo(
    () => new Map(filtered.map((entry) => [entry.id, entry])),
    [filtered],
  );

  const openSecret = useCallback((entry: SecretEntry) => setViewing(entry), []);

  const moveSecret = useCallback(async (entry: SecretEntry, targetDirectory: string) => {
    setMoveError("");
    try {
      const newPath = secretFilePath(folder, displayName(entry.name), targetDirectory);
      if (newPath === entry.name) return;
      if (await findFileByNameLocal(newPath)) {
        setMoveError(t("secretManager.duplicate"));
        return;
      }
      await renameFileLocal(entry.id, newPath);
      await refresh();
    } catch {
      setMoveError(t("secretManager.updateFailed"));
    }
  }, [folder, refresh, t]);

  const deleteSecret = useCallback(async (entry: SecretEntry) => {
    if (!window.confirm(t("secretManager.deleteConfirm").replace("{name}", displayName(entry.name)))) return;
    try {
      await deleteFileLocal(entry.id);
      await refresh();
    } catch {
      setMoveError(t("secretManager.deleteFailed"));
    }
  }, [refresh, t]);

  const resetCreate = () => {
    setName("");
    setDirectory("");
    setDescription("");
    setPublicMetadataFields([]);
    setValue("");
    setError("");
  };

  const createSecret = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!encryptionReady || !encryption) {
      setError(t("secretManager.encryptionRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const path = secretFilePath(folder, name, directory);
      if (await findFileByNameLocal(path)) {
        setError(t("secretManager.duplicate"));
        return;
      }
      // The local tree can lag another device. Verify the actual Drive path
      // before creating; offline creations remain queued by writeFileLocal.
      if (typeof navigator === "undefined" || navigator.onLine) {
        const remoteCheck = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "findByName", name: path }),
        });
        if (!remoteCheck.ok) throw new Error("Remote name check failed");
        const remoteData = await remoteCheck.json() as { file?: { id: string } | null };
        if (remoteData.file) {
          setError(t("secretManager.duplicate"));
          return;
        }
      }
      const encrypted = await encryptFileContent(
        value,
        encryption.publicKey,
        encryption.encryptedPrivateKey,
        encryption.salt,
        { description, publicMetadata: metadataRecord(publicMetadataFields) },
      );
      await writeFileLocal(path, encrypted);
      await refresh();
      setCreateOpen(false);
      resetCreate();
    } catch (createError) {
      setError(createError instanceof Error && createError.message === "Invalid secret name"
        ? t("secretManager.invalidName")
        : t("secretManager.createFailed"));
    } finally {
      setSaving(false);
    }
  }, [description, directory, encryption, encryptionReady, folder, name, publicMetadataFields, refresh, t, value]);

  const renderSecretEntry = (entry: SecretEntry) => (
    <div
      key={entry.id}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", entry.id);
        event.dataTransfer.effectAllowed = "move";
        setDraggingId(entry.id);
      }}
      onDragEnd={() => setDraggingId(null)}
      onClick={() => openSecret(entry)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") openSecret(entry);
      }}
      className={`group flex cursor-pointer items-start gap-2 border-b border-gray-100 px-3 py-2 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60 ${
        draggingId === entry.id ? "opacity-50" : ""
      }`}
    >
      <FileKey2 size={16} className="mt-0.5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
          {displayName(entry.name)}
        </div>
        {entry.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {entry.description}
          </div>
        )}
        {Object.keys(entry.publicMetadata).length > 0 && (
          <div className="mt-1 space-y-0.5">
            {Object.entries(entry.publicMetadata).map(([key, metadataValue]) => (
              <div key={key} className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-600 dark:text-gray-300">{key}:</span>{" "}{metadataValue}
              </div>
            ))}
          </div>
        )}
        {entry.modifiedTime && (
          <div className="mt-0.5 truncate text-[10px] text-gray-400">
            {new Date(entry.modifiedTime).toLocaleString()}
          </div>
        )}
      </div>
      <button
        type="button"
        title={t("secretManager.delete")}
        onClick={(event) => { event.stopPropagation(); void deleteSecret(entry); }}
        className="shrink-0 rounded p-1 text-gray-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const countFiles = (node: SecretTreeNode<SecretEntry>): number =>
    node.kind === "file" ? 1 : node.children.reduce((sum, child) => sum + countFiles(child), 0);

  const renderDirNode = (dir: SecretTreeDir<SecretEntry>): ReactNode => {
    const expanded = query.trim() !== "" || (groupExpanded[dir.path] ?? false);
    const isDragOver = dragOverPath === dir.path;
    return (
      <div key={`dir:${dir.path}`} className="border-b border-amber-100 dark:border-amber-900/40">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setGroupExpanded((previous) => ({
            ...previous,
            [dir.path]: !(previous[dir.path] ?? false),
          }))}
          onDragOver={(event) => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDragEnter={() => { if (draggingId) setDragOverPath(dir.path); }}
          onDragLeave={() => setDragOverPath((current) => current === dir.path ? null : current)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverPath(null);
            const id = event.dataTransfer.getData("text/plain");
            const entry = entryById.get(id);
            setDraggingId(null);
            if (entry) void moveSecret(entry, dir.path);
          }}
          className={`flex w-full items-center gap-2 border-l-4 border-amber-400 bg-amber-50 px-3 py-2.5 text-left transition-colors hover:border-amber-500 hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/35 dark:hover:bg-amber-900/40 ${
            isDragOver ? "ring-2 ring-inset ring-blue-400 dark:ring-blue-500" : ""
          }`}
        >
          {expanded
            ? <ChevronDown size={17} className="shrink-0 text-amber-600 dark:text-amber-400" />
            : <ChevronRight size={17} className="shrink-0 text-amber-600 dark:text-amber-400" />}
          <Folder size={18} className="shrink-0 fill-amber-200 text-amber-600 dark:fill-amber-800 dark:text-amber-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-950 dark:text-amber-100" title={dir.name}>
            {dir.name}
          </span>
          <span className="min-w-6 shrink-0 rounded-full bg-amber-200 px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-800 dark:text-amber-100">
            {countFiles(dir)}
          </span>
        </button>
        {expanded && (
          <div className="ml-5 border-l-2 border-amber-200 dark:border-amber-800/70">
            {dir.children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node: SecretTreeNode<SecretEntry>): ReactNode =>
    node.kind === "dir" ? renderDirNode(node) : renderSecretEntry(node.entry);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
        <Search size={13} className="shrink-0 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("secretManager.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-xs text-gray-900 placeholder-gray-400 focus:outline-none dark:text-gray-100"
        />
        <span className="text-[10px] tabular-nums text-gray-400">{filtered.length}</span>
        <button
          type="button"
          disabled={!encryptionReady}
          onClick={() => {
            resetCreate();
            setCreateOpen(true);
          }}
          title={encryptionReady ? t("secretManager.newSecret") : t("secretManager.encryptionRequired")}
          className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
          {t("secretManager.newSecret")}
        </button>
      </div>

      {!encryptionReady && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          {t("secretManager.encryptionRequired")}
        </div>
      )}

      {moveError && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {moveError}
          <button type="button" onClick={() => setMoveError("")} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"><X size={12} /></button>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 overflow-y-auto ${dragOverPath === "" ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
        onDragOver={(event) => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDragEnter={(event) => { if (draggingId && event.target === event.currentTarget) setDragOverPath(""); }}
        onDragLeave={(event) => { if (event.target === event.currentTarget) setDragOverPath((current) => current === "" ? null : current); }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setDragOverPath(null);
          const id = event.dataTransfer.getData("text/plain");
          const entry = entryById.get(id);
          setDraggingId(null);
          if (entry) void moveSecret(entry, "");
        }}
      >
        {entries === null && (
          <div className="flex justify-center p-5"><Loader2 size={17} className="animate-spin text-gray-400" /></div>
        )}
        {entries !== null && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-gray-400">
            <LockKeyhole size={22} />
            {t("secretManager.empty")}
          </div>
        )}
        {tree.map(renderNode)}
      </div>

      {createOpen && (
        <SecretDialog title={t("secretManager.newSecret")} onClose={() => setCreateOpen(false)}>
          <form onSubmit={createSecret} className="space-y-3">
            <SecretField label={t("secretManager.name")}>
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("secretManager.namePlaceholder")} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            </SecretField>
            <SecretField label={t("secretManager.directory")} hint={t("secretManager.directoryHint")}>
              <input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder={t("secretManager.directoryPlaceholder")} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            </SecretField>
            <SecretField label={t("secretManager.description")} hint={t("secretManager.metadataHint")}>
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("secretManager.descriptionPlaceholder")} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            </SecretField>
            <PublicMetadataEditor fields={publicMetadataFields} onChange={setPublicMetadataFields} />
            <SecretField label={t("secretManager.value")}>
              <textarea required rows={7} value={value} onChange={(event) => setValue(event.target.value)} placeholder={t("secretManager.valuePlaceholder")} autoComplete="off" spellCheck={false} className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            </SecretField>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <DialogActions saving={saving} submitLabel={t("secretManager.create")} cancelLabel={t("common.cancel")} onCancel={() => setCreateOpen(false)} />
          </form>
        </SecretDialog>
      )}

      {viewing && (
        <SecretViewDialog
          entry={viewing}
          folder={folder}
          encryptionSettings={encryption}
          onClose={() => setViewing(null)}
          onSaved={async () => {
            await refresh();
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

function currentDirectoryOf(entryName: string, folder: string): string {
  const relative = relativeSecretPath(entryName, folder);
  const idx = relative.lastIndexOf("/");
  return idx === -1 ? "" : relative.slice(0, idx);
}

function SecretViewDialog({
  entry,
  folder,
  encryptionSettings,
  onClose,
  onSaved,
}: {
  entry: SecretEntry;
  folder: string;
  encryptionSettings?: EncryptionSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [encryptedContent, setEncryptedContent] = useState("");
  const [secretValue, setSecretValue] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDirectory, setDraftDirectory] = useState(() => currentDirectoryOf(entry.name, folder));
  const [draftDescription, setDraftDescription] = useState(entry.description);
  const [draftMetadataFields, setDraftMetadataFields] = useState<MetadataField[]>(
    () => metadataFields(entry.publicMetadata),
  );
  const [draftValue, setDraftValue] = useState("");
  const openFailedMessage = t("secretManager.openFailed");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError("");
      setError("");
      setEncryptedContent("");
      setSecretValue(null);
      setPassword("");
      setEditMode(false);
      try {
        const content = await readFileLocal(entry.id);
        if (cancelled) return;
        setEncryptedContent(content);
        if (!isEncryptedFile(content)) {
          setSecretValue(content);
          return;
        }
        const privateKey = cryptoCache.getPrivateKey();
        const cachedPassword = cryptoCache.getPassword();
        if (privateKey || cachedPassword) {
          try {
            const plain = privateKey
              ? await decryptWithPrivateKey(content, privateKey)
              : await decryptFileContent(content, cachedPassword!);
            if (!cancelled) setSecretValue(plain);
          } catch {
            // Keep the modal locked; the user can enter the correct password.
          }
        }
      } catch {
        if (!cancelled) setLoadError(openFailedMessage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.id, openFailedMessage]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || !encryptedContent) return;
    setDecrypting(true);
    setError("");
    try {
      const plain = await decryptFileContent(encryptedContent, password);
      cryptoCache.setPassword(password);
      setSecretValue(plain);
      setPassword("");
    } catch {
      setError(t("crypt.wrongPassword"));
    } finally {
      setDecrypting(false);
    }
  };

  const copySecret = async () => {
    if (secretValue === null) return;
    try {
      await navigator.clipboard.writeText(secretValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission may be unavailable; keep the value selectable.
    }
  };

  const beginEdit = () => {
    if (secretValue === null) return;
    setDraftDirectory(currentDirectoryOf(entry.name, folder));
    setDraftDescription(entry.description);
    setDraftMetadataFields(metadataFields(entry.publicMetadata));
    setDraftValue(secretValue);
    setError("");
    setEditMode(true);
  };

  const saveSecret = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !encryptionSettings?.publicKey ||
      !encryptionSettings.encryptedPrivateKey ||
      !encryptionSettings.salt
    ) {
      setError(t("secretManager.encryptionRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const newPath = secretFilePath(folder, displayName(entry.name), draftDirectory);
      if (newPath !== entry.name) {
        if (await findFileByNameLocal(newPath)) {
          setError(t("secretManager.duplicate"));
          return;
        }
        await renameFileLocal(entry.id, newPath);
      }
      const encrypted = await encryptFileContent(
        draftValue,
        encryptionSettings.publicKey,
        encryptionSettings.encryptedPrivateKey,
        encryptionSettings.salt,
        {
          description: draftDescription,
          publicMetadata: metadataRecord(draftMetadataFields),
        },
      );
      await writeFileLocal(newPath, encrypted, { existingFileId: entry.id });
      await onSaved();
    } catch {
      setError(t("secretManager.updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SecretDialog
      title={displayName(entry.name)}
      onClose={onClose}
      headerActions={
        <button
          type="button"
          title={t("secretManager.openFile")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("plugin-select-file", { detail: { fileId: entry.id, fileName: entry.name } }),
            );
            onClose();
          }}
          className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ExternalLink size={15} />
        </button>
      }
    >
      {editMode && secretValue !== null ? (
        <form onSubmit={saveSecret} className="space-y-3">
          <SecretField label={t("secretManager.directory")} hint={t("secretManager.directoryHint")}>
            <input value={draftDirectory} onChange={(event) => setDraftDirectory(event.target.value)} placeholder={t("secretManager.directoryPlaceholder")} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
          </SecretField>
          <SecretField label={t("secretManager.description")} hint={t("secretManager.metadataHint")}>
            <textarea rows={3} value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
          </SecretField>
          <PublicMetadataEditor fields={draftMetadataFields} onChange={setDraftMetadataFields} />
          <SecretField label={t("secretManager.value")}>
            <textarea rows={7} required value={draftValue} onChange={(event) => setDraftValue(event.target.value)} autoComplete="off" spellCheck={false} className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
          </SecretField>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <DialogActions saving={saving} submitLabel={t("common.save")} cancelLabel={t("common.cancel")} onCancel={() => setEditMode(false)} />
        </form>
      ) : (
        <div className="space-y-3">
          {entry.description && <p className="text-sm text-gray-600 dark:text-gray-300">{entry.description}</p>}
          {Object.keys(entry.publicMetadata).length > 0 && (
            <dl className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/60">
              {Object.entries(entry.publicMetadata).map(([key, metadataValue]) => (
                <div key={key} className="grid grid-cols-[minmax(90px,1fr)_2fr] gap-2 py-0.5">
                  <dt className="font-medium text-gray-500 dark:text-gray-400">{key}</dt>
                  <dd className="break-all text-gray-800 dark:text-gray-100">{metadataValue}</dd>
                </div>
              ))}
            </dl>
          )}

          {loading ? (
            <div className="flex justify-center p-5"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
          ) : loadError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
          ) : secretValue === null ? (
            <form onSubmit={unlock} className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("crypt.enterPasswordDesc")}</p>
              <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("crypt.passwordPlaceholder")} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex justify-end">
                <button type="submit" disabled={decrypting || !password} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {decrypting && <Loader2 size={12} className="animate-spin" />}
                  {t("crypt.unlock")}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t("secretManager.value")}</span>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={beginEdit} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"><Pencil size={12} /> {t("memo.edit")}</button>
                  <button type="button" onClick={copySecret} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"><Copy size={12} /> {copied ? t("memo.copied") : t("memo.copy")}</button>
                </div>
              </div>
              <textarea readOnly rows={6} value={secretValue} spellCheck={false} className="w-full resize-y rounded border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            </div>
          )}
          {!loading && error && secretValue !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </SecretDialog>
  );
}

function PublicMetadataEditor({ fields, onChange }: { fields: MetadataField[]; onChange: (fields: MetadataField[]) => void }) {
  const { t } = useI18n();
  const update = (id: string, patch: Partial<MetadataField>) => {
    onChange(fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t("secretManager.publicMetadata")}</span>
        <button
          type="button"
          onClick={() => onChange([...fields, { id: crypto.randomUUID(), key: "", value: "" }])}
          className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          <Plus size={11} /> {t("secretManager.addField")}
        </button>
      </div>
      {fields.map((field) => (
        <div key={field.id} className="flex gap-1.5">
          <input
            value={field.key}
            onChange={(event) => update(field.id, { key: event.target.value })}
            placeholder={t("secretManager.fieldName")}
            className="w-1/3 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <input
            value={field.value}
            onChange={(event) => update(field.id, { value: event.target.value })}
            placeholder={t("secretManager.fieldValue")}
            className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <button type="button" onClick={() => onChange(fields.filter((item) => item.id !== field.id))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-800"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function SecretDialog({ title, headerActions, onClose, children }: { title: string; headerActions?: ReactNode; onClose: () => void; children: ReactNode }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: position.x,
      baseY: position.y,
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = drag.baseX + event.clientX - drag.startX;
    const nextY = drag.baseY + event.clientY - drag.startY;
    setPosition({
      x: Math.min(window.innerWidth / 2 - 48, Math.max(-window.innerWidth / 2 + 48, nextX)),
      y: Math.min(window.innerHeight / 2 - 32, Math.max(-window.innerHeight / 2 + 32, nextY)),
    });
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={modalRef}
        className="absolute flex min-h-[280px] min-w-[320px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        style={{
          left: "50%",
          top: "50%",
          width: "min(32rem, calc(100vw - 2rem))",
          height: "min(38rem, calc(100vh - 2rem))",
          maxWidth: "calc(100vw - 1rem)",
          maxHeight: "calc(100vh - 1rem)",
          resize: "both",
          transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
        }}
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="flex shrink-0 cursor-move touch-none select-none items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700"
        >
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <div className="flex shrink-0 items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
            {headerActions}
            <button type="button" onClick={onClose} className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={15} /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function SecretField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-amber-600 dark:text-amber-400">{hint}</span>}
    </label>
  );
}

function DialogActions({ saving, submitLabel, cancelLabel, onCancel }: { saving: boolean; submitLabel: string; cancelLabel: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{cancelLabel}</button>
      <button type="submit" disabled={saving} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {saving && <Loader2 size={12} className="animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}
