import { useState, useCallback } from "react";
import { ragRegisterNewFile } from "~/services/rag-sync";

export const FREE_UPLOAD_SIZE_LIMIT_BYTES = 20 * 1024 * 1024; // 20MB

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

      for (const f of validFiles) {
        const clientName = getUploadFileName(f);
        try {
          const formData = new FormData();
          formData.set("intent", "upload-file");
          formData.set("folderId", folderId);
          formData.set("clientPath", clientName);
          formData.set("fileName", f.name);
          formData.set("mimeType", f.type || "application/octet-stream");
          formData.set("size", String(f.size));
          formData.set("file", f);
          if (namePrefix) {
            formData.set("namePrefix", namePrefix);
          }
          const replaceFileId = replaceMap?.[clientName] || replaceMap?.[f.name];
          if (replaceFileId) {
            formData.set("replaceFileId", replaceFileId);
          }

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
            continue;
          }

          const completed = uploadData.file as UploadedFile;
          ragRegisterNewFile(completed.id, completed.name);
          fileMap.set(clientName, completed);
          fileMap.set(f.name, completed);
          setProgress((prev) =>
            prev.map((p) => (p.name === clientName ? { ...p, status: "done" } : p))
          );
        } catch {
          failedNames.add(clientName);
          failedNames.add(f.name);
          setProgress((prev) =>
            prev.map((p) =>
              p.name === clientName ? { ...p, status: "error", error: "Network error" } : p
            )
          );
        }
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
