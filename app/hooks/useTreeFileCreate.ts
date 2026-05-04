import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  getCachedFile,
  setCachedFile,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  deleteCachedFile,
  deleteEditHistoryEntry,
  getLocalSyncMeta,
  setLocalSyncMeta,
  type CachedTreeNode,
} from "~/services/indexeddb-cache";
import { saveLocalEdit } from "~/services/edit-history-local";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { findFileByPath } from "~/utils/file-tree-operations";
import type { TranslationStrings } from "~/i18n/translations";
import type { UploadFile, UploadReturn } from "~/hooks/useFileUpload";
import { getUploadFileName } from "~/hooks/useFileUpload";
import { fileToBase64 } from "~/utils/file-bytes";

interface UseTreeFileCreateParams {
  treeItems: CachedTreeNode[];
  setTreeItems: Dispatch<SetStateAction<CachedTreeNode[]>>;
  rootFolderId: string;
  selectedFolderId: string | null;
  activeFileId: string | null;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  upload: (files: File[], folderId: string, namePrefix?: string, replaceMap?: Record<string, string>) => Promise<UploadReturn>;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFolderId: Dispatch<SetStateAction<string | null>>;
  fetchAndCacheTree: (refresh?: boolean) => Promise<void>;
  t: (key: keyof TranslationStrings) => string;
}

function normalizeImportPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function withUploadRelativePath(file: File, relativePath: string): File {
  const uploadFile = file as UploadFile;
  uploadFile.relativePathForUpload = normalizeImportPath(relativePath) || file.name;
  return uploadFile;
}

function folderPathFromId(folderId: string | null | undefined): string {
  return folderId?.startsWith("vfolder:") ? folderId.slice("vfolder:".length) : "";
}

function mimeTypeFromImportPath(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    js: "application/javascript",
    ts: "application/typescript",
    css: "text/css",
    html: "text/html",
    xml: "text/xml",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return ext ? map[ext] || "application/octet-stream" : "application/octet-stream";
}

export function useTreeFileCreate({
  treeItems,
  setTreeItems,
  rootFolderId,
  selectedFolderId,
  activeFileId,
  onSelectFile,
  upload,
  setExpandedFolders,
  setSelectedFolderId,
  fetchAndCacheTree,
  t,
}: UseTreeFileCreateParams) {
  const [createFileDialog, setCreateFileDialog] = useState<{
    open: boolean; name: string; ext: string; customExt: string; addDateTime: boolean; addLocation: boolean;
  }>({ open: false, name: "", ext: ".md", customExt: "", addDateTime: false, addLocation: false });

  const [folderDialog, setFolderDialog] = useState<{ open: boolean; name: string; targetFolderId: string | null }>({ open: false, name: "", targetFolderId: null });

  const handleCreateFolder = useCallback(() => {
    setFolderDialog({ open: true, name: "", targetFolderId: selectedFolderId });
  }, [selectedFolderId]);

  const handleCreateFolderSubmit = useCallback(() => {
    const name = folderDialog.name.trim();
    if (!name) return;
    const targetId = folderDialog.targetFolderId;
    setFolderDialog({ open: false, name: "", targetFolderId: null });

    // Determine parent path from the folder selected when the dialog was opened
    const parentPath = targetId?.startsWith("vfolder:")
      ? targetId.slice("vfolder:".length)
      : "";
    const folderPath = parentPath ? `${parentPath}/${name}` : name;
    const folderId = `vfolder:${folderPath}`;

    // Add virtual folder node to tree locally
    const newFolder: CachedTreeNode = {
      id: folderId,
      name,
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      children: [],
    };

    setTreeItems((prev) => {
      if (!parentPath) {
        // Add to root
        return [...prev, newFolder].sort((a, b) => {
          if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }
      // Add into the parent virtual folder
      const insertIntoFolder = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
        nodes.map((n) => {
          if (n.id === targetId && n.children) {
            return {
              ...n,
              children: [...n.children, newFolder].sort((a, b) => {
                if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
                return a.name.localeCompare(b.name);
              }),
            };
          }
          if (n.children) {
            return { ...n, children: insertIntoFolder(n.children) };
          }
          return n;
        });
      return insertIntoFolder(prev);
    });

    // Expand parent and the new folder
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (targetId) next.add(targetId);
      next.add(folderId);
      return next;
    });
    setSelectedFolderId(folderId);
  }, [folderDialog, setTreeItems, setExpandedFolders, setSelectedFolderId]);

  const handleCreateFile = useCallback(() => {
    const saved = localStorage.getItem("createFileOptions");
    const opts = saved ? JSON.parse(saved) : {};
    setCreateFileDialog({ open: true, name: "", ext: ".md", customExt: "", addDateTime: !!opts.addDateTime, addLocation: !!opts.addLocation });
  }, []);

  const expandZipFiles = useCallback(async (files: File[]): Promise<File[]> => {
    const imported: File[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        const relativePath = normalizeImportPath(file.webkitRelativePath || file.name);
        imported.push(withUploadRelativePath(file, relativePath));
        continue;
      }

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);
      for (const [entryPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const normalizedPath = normalizeImportPath(entryPath);
        if (!normalizedPath || normalizedPath.startsWith("__MACOSX/") || normalizedPath.endsWith("/.DS_Store")) continue;
        const blob = await entry.async("blob");
        const extracted = new File([blob], normalizedPath.split("/").pop() || normalizedPath, {
          type: mimeTypeFromImportPath(normalizedPath),
        });
        imported.push(withUploadRelativePath(extracted, normalizedPath));
      }
    }
    return imported;
  }, []);

  const importFilesToFolder = useCallback(async (
    inputFiles: File[],
    targetFolderId: string | null | undefined,
    options?: { expandZip?: boolean },
  ) => {
    if (inputFiles.length === 0) return;

    let files: File[];
    try {
      files = options?.expandZip === false
        ? inputFiles.map((file) => withUploadRelativePath(file, normalizeImportPath(file.webkitRelativePath || file.name)))
        : await expandZipFiles(inputFiles);
    } catch {
      alert(t("contextMenu.importFailed"));
      return;
    }
    if (files.length === 0) return;

    const namePrefix = folderPathFromId(targetFolderId) || undefined;
    const seenImportPaths = new Set<string>();
    const duplicateImportPaths = new Set<string>();
    for (const file of files) {
      const uploadName = getUploadFileName(file);
      const fullPath = namePrefix ? `${namePrefix}/${uploadName}` : uploadName;
      if (seenImportPaths.has(fullPath)) {
        duplicateImportPaths.add(fullPath);
      } else {
        seenImportPaths.add(fullPath);
      }
    }
    if (duplicateImportPaths.size > 0) {
      const names = Array.from(duplicateImportPaths).join(", ");
      alert(t("contextMenu.importDuplicatePaths").replace("{name}", names));
      return;
    }

    // Check for duplicates
    const duplicates: { file: File; existing: CachedTreeNode; uploadName: string; fullPath: string }[] = [];
    for (const file of files) {
      const uploadName = getUploadFileName(file);
      const fullPath = namePrefix ? `${namePrefix}/${uploadName}` : uploadName;
      const existing = findFileByPath(treeItems, fullPath);
      if (existing) duplicates.push({ file, existing, uploadName, fullPath });
    }
    if (duplicates.length > 0) {
      const names = duplicates.map((d) => d.fullPath).join(", ");
      const msg = t("contextMenu.fileAlreadyExists").replace("{name}", names);
      if (!confirm(msg)) return;
    }

    const duplicateSet = new Set(duplicates.map((d) => d.file));
    const textDuplicates = duplicates.filter((d) => !isBinaryMimeType(d.existing.mimeType));
    const binaryDuplicates = duplicates.filter((d) => isBinaryMimeType(d.existing.mimeType));
    const newFiles = files.filter((f) => !duplicateSet.has(f));

    // Text duplicates: local cache update only
    for (const { file, existing, fullPath } of textDuplicates) {
      const content = await file.text();
      const rawContentBase64 = await fileToBase64(file);
      const saved = await saveLocalEdit(existing.id, fullPath, content);
      if (!saved) continue;
      const existingCache = await getCachedFile(existing.id);
      await setCachedFile({
        fileId: existing.id,
        content,
        rawContentBase64,
        md5Checksum: existingCache?.md5Checksum ?? "",
        modifiedTime: new Date().toISOString(),
        cachedAt: Date.now(),
        fileName: fullPath,
      });
      window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: existing.id } }));
      if (existing.id === activeFileId) {
        window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: [existing.id] } }));
      }
    }

    // Binary duplicates: server update via replaceMap
    if (binaryDuplicates.length > 0) {
      const replaceMap: Record<string, string> = {};
      const binaryFiles = binaryDuplicates.map((d) => {
        replaceMap[d.uploadName] = d.existing.id;
        return d.file;
      });
      const result = await upload(binaryFiles, rootFolderId, namePrefix, replaceMap);
      if (result.ok) {
        await fetchAndCacheTree();
        const meta = await getCachedRemoteMeta();
        const localMeta = await getLocalSyncMeta();
        for (const { file, existing, uploadName } of binaryDuplicates) {
          if (result.failedNames.has(uploadName)) continue;
          const base64 = await fileToBase64(file);
          const rm = meta?.files?.[existing.id];
          await setCachedFile({
            fileId: existing.id,
            content: base64,
            md5Checksum: rm?.md5Checksum ?? "",
            modifiedTime: rm?.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: rm?.name ?? uploadName,
            encoding: "base64",
          });
          window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: existing.id } }));
          if (localMeta) {
            localMeta.files[existing.id] = {
              md5Checksum: rm?.md5Checksum ?? "",
              modifiedTime: rm?.modifiedTime ?? "",
              name: rm?.name,
              size: rm?.size,
            };
          }
        }
        if (localMeta) {
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
      }
    }

    // New files: normal upload
    if (newFiles.length > 0) {
      const result = await upload(newFiles, rootFolderId, namePrefix);
      if (result.ok) {
        // Register every uploaded file in localSyncMeta BEFORE fetchAndCacheTree.
        // buildTreeFromMeta's local-first filter hides remote entries that
        // aren't tracked locally, so skipping this leaves newly uploaded
        // files invisible until the next sync.
        const localMeta = await getLocalSyncMeta();
        for (const file of newFiles) {
          const uploadName = getUploadFileName(file);
          const uploaded = result.fileMap.get(uploadName);
          if (!uploaded) continue;
          if (isBinaryMimeType(uploaded.mimeType)) {
            const base64 = await fileToBase64(file);
            await setCachedFile({
              fileId: uploaded.id,
              content: base64,
              md5Checksum: uploaded.md5Checksum ?? "",
              modifiedTime: uploaded.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: uploaded.name ?? uploadName,
              encoding: "base64",
            });
          } else {
            const content = await file.text();
            const rawContentBase64 = await fileToBase64(file);
            await setCachedFile({
              fileId: uploaded.id,
              content,
              rawContentBase64,
              md5Checksum: uploaded.md5Checksum ?? "",
              modifiedTime: uploaded.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: uploaded.name ?? uploadName,
            });
          }
          window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: uploaded.id } }));
          if (localMeta) {
            localMeta.files[uploaded.id] = {
              md5Checksum: uploaded.md5Checksum ?? "",
              modifiedTime: uploaded.modifiedTime ?? "",
              name: uploaded.name,
            };
          }
        }
        if (localMeta) {
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
        await fetchAndCacheTree();
      }
    }

    // Expand folder
    if (targetFolderId && targetFolderId !== rootFolderId) {
      setExpandedFolders((prev) => new Set(prev).add(targetFolderId));
    }
  }, [activeFileId, expandZipFiles, fetchAndCacheTree, rootFolderId, setExpandedFolders, t, treeItems, upload]);

  const handleUploadClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      await importFilesToFolder(files, selectedFolderId, { expandZip: false });
    };
    input.click();
  }, [importFilesToFolder, selectedFolderId]);

  const handleImportClick = useCallback((targetFolderId: string, mode: "files" | "folder") => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (mode === "folder") {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    } else {
      input.accept = ".zip,*/*";
    }
    input.onchange = async () => {
      await importFilesToFolder(Array.from(input.files || []), targetFolderId);
    };
    input.click();
  }, [importFilesToFolder]);

  const buildDefaultName = useCallback(() => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `daily/${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}_${p(now.getHours())}_${p(now.getMinutes())}_${p(now.getSeconds())}`;
  }, []);

  const handleCreateFileSubmit = useCallback(async () => {
    const defaultName = buildDefaultName();
    const name = createFileDialog.name.trim() || defaultName;
    const ext = createFileDialog.ext === "custom"
      ? (createFileDialog.customExt.startsWith(".") ? createFileDialog.customExt : "." + createFileDialog.customExt)
      : createFileDialog.ext;
    const fileName = name + ext;
    const { addDateTime, addLocation } = createFileDialog;

    localStorage.setItem("createFileOptions", JSON.stringify({ addDateTime, addLocation }));
    setCreateFileDialog((prev) => ({ ...prev, open: false }));

    // Build initial YAML frontmatter from optional metadata (markdown only)
    const isMd = fileName.endsWith(".md");
    const frontmatterLines: string[] = [];
    if (isMd && addDateTime) {
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      frontmatterLines.push(`date: ${ts}`);
    }
    if (isMd && addLocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });
        frontmatterLines.push(`location:`);
        frontmatterLines.push(`  latitude: ${pos.coords.latitude}`);
        frontmatterLines.push(`  longitude: ${pos.coords.longitude}`);
      } catch {
        // Location unavailable — skip
      }
    }
    const initialContent = frontmatterLines.length > 0
      ? `---\n${frontmatterLines.join("\n")}\n---\n\n`
      : "";

    // Prepend selected folder path
    const folderPath = selectedFolderId?.startsWith("vfolder:")
      ? selectedFolderId.slice("vfolder:".length)
      : "";
    const fullName = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Check for duplicate
    const existing = findFileByPath(treeItems, fullName);
    if (existing) {
      const msg = t("contextMenu.fileAlreadyExists").replace("{name}", fileName);
      if (!confirm(msg)) return;
      // Overwrite existing file
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", fileId: existing.id, content: initialContent }),
        });
        if (res.ok) {
          const data = await res.json();
          await setCachedFile({
            fileId: existing.id,
            content: initialContent,
            md5Checksum: data.md5Checksum ?? "",
            modifiedTime: data.file?.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: existing.name,
          });
          onSelectFile(existing.id, existing.name, existing.mimeType);
        }
      } catch { /* ignore */ }
      return;
    }

    // Generate temporary ID — Drive file is created in the background below
    const tempId = `new:${fullName}`;
    const mimeType = fileName.endsWith(".yaml") || fileName.endsWith(".yml")
      ? "text/yaml"
      : "text/plain";

    // Seed IndexedDB cache with initial content
    await setCachedFile({
      fileId: tempId,
      content: initialContent,
      md5Checksum: "",
      modifiedTime: "",
      cachedAt: Date.now(),
      fileName: fullName,
    });

    // Add the new file to the tree optimistically
    // fullName may contain "/" (e.g. "2026/02/14_15_30_45.md") — split into
    // virtual folder path + base name, creating intermediate vfolder nodes
    const fullParts = fullName.split("/");
    const baseName = fullParts.pop()!;
    // folderParts = all path segments that should be virtual folders
    const folderParts = fullParts; // e.g. ["2026", "02"]

    const newNode: CachedTreeNode = {
      id: tempId,
      name: baseName,
      mimeType,
      isFolder: false,
      modifiedTime: new Date().toISOString(),
    };

    const sortNodes = (nodes: CachedTreeNode[]) =>
      nodes.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    setTreeItems((prev) => {
      // Ensure all intermediate virtual folders exist, then insert the file
      const ensureAndInsert = (
        nodes: CachedTreeNode[],
        remainingParts: string[],
        pathSoFar: string,
      ): CachedTreeNode[] => {
        if (remainingParts.length === 0) {
          // Leaf level — insert the file here
          return sortNodes([...nodes, newNode]);
        }
        const [nextPart, ...rest] = remainingParts;
        const nextPath = pathSoFar ? `${pathSoFar}/${nextPart}` : nextPart;
        const vfolderId = `vfolder:${nextPath}`;
        const existing = nodes.find((n) => n.id === vfolderId);
        if (existing) {
          // Folder exists — recurse into it
          return nodes.map((n) =>
            n.id === vfolderId
              ? { ...n, children: ensureAndInsert(n.children ?? [], rest, nextPath) }
              : n,
          );
        }
        // Create new virtual folder node with nested children
        // Build the chain of remaining folders
        let innerChildren: CachedTreeNode[] = [newNode];
        for (let i = rest.length - 1; i >= 0; i--) {
          const partPath = nextPath + "/" + rest.slice(0, i + 1).join("/");
          const innerFolderId = `vfolder:${partPath}`;
          innerChildren = [{
            id: innerFolderId,
            name: rest[i],
            mimeType: "application/vnd.google-apps.folder",
            isFolder: true,
            children: innerChildren,
          }];
        }
        const newFolder: CachedTreeNode = {
          id: vfolderId,
          name: nextPart,
          mimeType: "application/vnd.google-apps.folder",
          isFolder: true,
          children: rest.length === 0 ? [newNode] : innerChildren,
        };
        return sortNodes([...nodes, newFolder]);
      };
      return ensureAndInsert(prev, folderParts, "");
    });

    // Expand all intermediate virtual folders + parent
    {
      const foldersToExpand: string[] = [];
      let pathAcc = "";
      for (const part of folderParts) {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
        foldersToExpand.push(`vfolder:${pathAcc}`);
      }
      if (foldersToExpand.length > 0) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          for (const f of foldersToExpand) next.add(f);
          return next;
        });
      }
    }

    // Open the file immediately
    onSelectFile(tempId, baseName, mimeType);

    // Create Drive file in background — migrate IDs when done
    fetch("/api/drive/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name: fullName, content: initialContent, mimeType }),
    }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const file = data.file;
      // Read current content from cache (user may have already typed)
      const cached = await getCachedFile(tempId);
      if (!cached) return; // temp entry was removed (e.g. file renamed/deleted before migration)
      const currentContent = cached.content;

      // Clean up editHistory for temp ID — content will be synced to Drive below
      await deleteEditHistoryEntry(tempId);

      // If user edited before migration, push content to Drive and get final checksum
      let finalMd5 = file.md5Checksum ?? "";
      let finalModifiedTime = file.modifiedTime ?? "";
      if (currentContent && currentContent !== initialContent) {
        try {
          const updateRes = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", fileId: file.id, content: currentContent }),
          });
          if (updateRes.ok) {
            const updateData = await updateRes.json();
            finalMd5 = updateData.md5Checksum ?? finalMd5;
            finalModifiedTime = updateData.file?.modifiedTime ?? finalModifiedTime;
          }
        } catch {
          // Content upload failed — file exists on Drive with empty content
        }
      }

      // Swap cache entries: delete temp, create real
      await deleteCachedFile(tempId);
      await setCachedFile({
        fileId: file.id,
        content: currentContent,
        md5Checksum: finalMd5,
        modifiedTime: finalModifiedTime,
        cachedAt: Date.now(),
        fileName: file.name,
      });

      // Update localSyncMeta so push/pull recognizes this file
      try {
        const localMeta = await getLocalSyncMeta();
        if (localMeta) {
          localMeta.files[file.id] = {
            md5Checksum: finalMd5,
            modifiedTime: finalModifiedTime,
          };
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
      } catch {
        // Non-critical — next pull will fix the inconsistency
      }

      // Update cachedRemoteMeta so computeSyncDiff doesn't treat this as localOnly
      try {
        const remoteMeta = await getCachedRemoteMeta();
        if (remoteMeta) {
          remoteMeta.files[file.id] = {
            name: file.name,
            mimeType: file.mimeType ?? mimeType,
            md5Checksum: finalMd5,
            modifiedTime: finalModifiedTime,
            createdTime: file.createdTime ?? "",
          };
          remoteMeta.lastUpdatedAt = new Date().toISOString();
          remoteMeta.cachedAt = Date.now();
          await setCachedRemoteMeta(remoteMeta);
        }
      } catch {
        // Non-critical — next pull will fix the inconsistency
      }

      // Notify tree, _index, and useFileWithCache to migrate
      window.dispatchEvent(
        new CustomEvent("file-id-migrated", {
          detail: { oldId: tempId, newId: file.id, fileName: file.name, mimeType: file.mimeType },
        })
      );
      // Trigger push count recalculation
      window.dispatchEvent(
        new CustomEvent("file-modified", { detail: { fileId: file.id } })
      );
    }).catch(() => {});
  }, [createFileDialog, selectedFolderId, onSelectFile, treeItems, t, buildDefaultName, setTreeItems, setExpandedFolders]);

  return {
    createFileDialog,
    setCreateFileDialog,
    folderDialog,
    setFolderDialog,
    handleCreateFolder,
    handleCreateFolderSubmit,
    handleCreateFile,
    handleUploadClick,
    handleImportClick,
    handleCreateFileSubmit,
    buildDefaultName,
  };
}
