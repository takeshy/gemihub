import { useState, useCallback } from "react";
import { ragRegisterNewFile } from "~/services/rag-sync";
import { parallelProcess } from "~/utils/parallel";

export const FREE_UPLOAD_SIZE_LIMIT_BYTES = 20 * 1024 * 1024; // 20MB
const UPLOAD_CONCURRENCY = 3;

export interface UploadProgress {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime?: string;
  mimeType?: string;
}

export interface UploadReturn {
  ok: boolean;
  failedNames: Set<string>;
  /** Map from client upload path to uploaded Drive file metadata */
  fileMap: Map<string, UploadedFile>;
}

export type UploadFile = File & {
  relativePathForUpload?: string;
};

export function getUploadFileName(file: File): string {
  const uploadFile = file as UploadFile;
  return uploadFile.relativePathForUpload || uploadFile.webkitRelativePath || file.name;
}

export function buildUploadFormData(
  file: File,
  options: {
    folderId: string;
    clientName: string;
    namePrefix?: string;
    replaceFileId?: string;
    deferMeta: boolean;
  },
): FormData {
  const formData = new FormData();
  formData.set("intent", "upload-file");
  formData.set("folderId", options.folderId);
  formData.set("clientPath", options.clientName);
  formData.set("fileName", file.name);
  formData.set("mimeType", file.type || "application/octet-stream");
  formData.set("size", String(file.size));
  formData.set("file", file);
  if (options.deferMeta) formData.set("deferMeta", "true");
  if (options.namePrefix) formData.set("namePrefix", options.namePrefix);
  if (options.replaceFileId) formData.set("replaceFileId", options.replaceFileId);
  return formData;
}

async function finalizeUploadMetadata(folderId: string, files: UploadedFile[]): Promise<Set<string>> {
  const failedIds = new Set<string>();
  if (files.length === 0) return failedIds;

  try {
    const response = await fetch("/api/drive/upload-resumable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "complete-batch",
        folderId,
        fileIds: files.map((file) => file.id),
      }),
    });
    if (response.ok) return failedIds;
  } catch {
    // Fall back to serialized completion below. The content is already on Drive,
    // so retrying metadata registration must not upload the file a second time.
  }

  for (const file of files) {
    try {
      const response = await fetch("/api/drive/upload-resumable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "complete", folderId, fileId: file.id }),
      });
      if (!response.ok) failedIds.add(file.id);
    } catch {
      failedIds.add(file.id);
    }
  }
  return failedIds;
}

export function useFileUpload(sizeLimitBytes: number | null = FREE_UPLOAD_SIZE_LIMIT_BYTES) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);

  const upload = useCallback(
    async (files: File[], folderId: string, namePrefix?: string, replaceMap?: Record<string, string>): Promise<UploadReturn> => {
      const fail: UploadReturn = { ok: false, failedNames: new Set(), fileMap: new Map() };
      if (files.length === 0) return fail;

      setUploading(true);

      // Initialize progress with client-side size checks
      const initial: UploadProgress[] = files.map((f) => {
        const name = getUploadFileName(f);
        if (sizeLimitBytes !== null && f.size > sizeLimitBytes) {
          const limitMB = Math.round(sizeLimitBytes / 1024 / 1024);
          return {
            name,
            status: "error" as const,
            error: `Too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max ${limitMB}MB.`,
          };
        }
        return { name, status: "uploading" as const };
      });
      setProgress(initial);

      const validFiles = sizeLimitBytes === null
        ? files
        : files.filter((f) => f.size <= sizeLimitBytes);
      if (validFiles.length === 0) {
        setUploading(false);
        return fail;
      }

      const failedNames = new Set<string>();
      const fileMap = new Map<string, UploadedFile>();

      const deferMeta = validFiles.length > 1;
      const results = await parallelProcess(validFiles, async (f) => {
        const clientName = getUploadFileName(f);
        try {
          const replaceFileId = replaceMap?.[clientName] || replaceMap?.[f.name];
          const formData = buildUploadFormData(f, {
            folderId,
            clientName,
            namePrefix,
            replaceFileId,
            deferMeta,
          });

          const uploadRes = await fetch("/api/drive/upload-resumable", {
            method: "POST",
            body: formData,
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok || !uploadData.file) {
            const error = uploadData.error || "Upload failed";
            failedNames.add(clientName);
            failedNames.add(f.name);
            setProgress((prev) =>
              prev.map((p) => (p.name === clientName ? { ...p, status: "error", error } : p))
            );
            return { file: f, clientName, error };
          }

          const completed = uploadData.file as UploadedFile;
          return { file: f, clientName, completed };
        } catch {
          const error = "Network error";
          failedNames.add(clientName);
          failedNames.add(f.name);
          setProgress((prev) =>
            prev.map((p) =>
              p.name === clientName ? { ...p, status: "error", error } : p
            )
          );
          return { file: f, clientName, error };
        }
      }, UPLOAD_CONCURRENCY);

      const completedFiles = results.flatMap((result) => result.completed ? [result.completed] : []);
      const metadataFailures = deferMeta
        ? await finalizeUploadMetadata(folderId, completedFiles)
        : new Set<string>();

      for (const result of results) {
        const { file, clientName, completed } = result;
        if (!completed) continue;
        if (metadataFailures.has(completed.id)) {
          const error = "Uploaded, but sync registration failed";
          failedNames.add(clientName);
          failedNames.add(file.name);
          setProgress((prev) =>
            prev.map((p) => (p.name === clientName ? { ...p, status: "error", error } : p))
          );
          continue;
        }

        ragRegisterNewFile(completed.id, completed.name);
        fileMap.set(clientName, completed);
        fileMap.set(file.name, completed);
        setProgress((prev) =>
          prev.map((p) => (p.name === clientName ? { ...p, status: "done" } : p))
        );
      }

      setUploading(false);
      return { ok: true, failedNames, fileMap };
    },
    [sizeLimitBytes]
  );

  const clearProgress = useCallback(() => {
    setProgress([]);
  }, []);

  return { uploading, progress, upload, clearProgress };
}
