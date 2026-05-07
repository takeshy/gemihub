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

function parseJsonText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

      if (sizeLimitBytes === null) {
        const failedNames = new Set<string>();
        const fileMap = new Map<string, UploadedFile>();

        for (const f of validFiles) {
          const clientName = getUploadFileName(f);
          try {
            const sessionRes = await fetch("/api/drive/upload-resumable", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                intent: "create-session",
                folderId,
                namePrefix,
                clientPath: clientName,
                fileName: f.name,
                mimeType: f.type || "application/octet-stream",
                size: f.size,
                replaceFileId: replaceMap?.[clientName] || replaceMap?.[f.name],
              }),
            });
            const sessionData = await sessionRes.json().catch(() => ({}));
            if (!sessionRes.ok || !sessionData.uploadUrl) {
              const error = sessionData.error || "Upload failed";
              failedNames.add(clientName);
              failedNames.add(f.name);
              setProgress((prev) =>
                prev.map((p) => (p.name === clientName ? { ...p, status: "error", error } : p))
              );
              continue;
            }

            const uploadRes = await fetch(sessionData.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": f.type || "application/octet-stream" },
              body: f,
            });
            const uploadText = await uploadRes.text();
            const uploaded = parseJsonText(uploadText) as (UploadedFile & { error?: unknown }) | null;
            if (!uploadRes.ok || !uploaded?.id) {
              const error = uploaded && "error" in uploaded
                ? String((uploaded as { error?: unknown }).error)
                : uploadText || "Upload failed";
              failedNames.add(clientName);
              failedNames.add(f.name);
              setProgress((prev) =>
                prev.map((p) => (p.name === clientName ? { ...p, status: "error", error } : p))
              );
              continue;
            }

            const completeRes = await fetch("/api/drive/upload-resumable", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                intent: "complete",
                folderId,
                fileId: uploaded.id,
              }),
            });
            const completeData = await completeRes.json().catch(() => ({}));
            if (!completeRes.ok || !completeData.file) {
              const error = completeData.error || "Upload completed but metadata update failed";
              failedNames.add(clientName);
              failedNames.add(f.name);
              setProgress((prev) =>
                prev.map((p) => (p.name === clientName ? { ...p, status: "error", error } : p))
              );
              continue;
            }

            const completed = completeData.file as UploadedFile;
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
      }

      const formData = new FormData();
      formData.set("folderId", folderId);
      if (namePrefix) {
        formData.set("namePrefix", namePrefix);
      }
      if (replaceMap && Object.keys(replaceMap).length > 0) {
        formData.set("replaceMap", JSON.stringify(replaceMap));
      }
      for (const f of validFiles) {
        formData.append("files", f);
        formData.append("filePaths", getUploadFileName(f));
      }

      try {
        const res = await fetch("/api/drive/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setProgress((prev) =>
            prev.map((p) =>
              p.status === "uploading"
                ? { ...p, status: "error", error: data.error || "Upload failed" }
                : p
            )
          );
          setUploading(false);
          return fail;
        }

        const data = await res.json();
        const resultMap = new Map<string, { file?: unknown; error?: string }>();
        for (const r of data.results) {
          resultMap.set(r.name, r);
        }

        const failedNames = new Set<string>();
        const fileMap = new Map<string, UploadedFile>();
        for (const [name, result] of resultMap) {
          if (result.error) {
            failedNames.add(name);
          } else if (result.file) {
            const f = result.file as UploadedFile;
            ragRegisterNewFile(f.id, f.name);
            fileMap.set(name, f);
          }
        }

        setProgress((prev) =>
          prev.map((p) => {
            if (p.status !== "uploading") return p;
            const result = resultMap.get(p.name);
            if (result?.error) {
              return { ...p, status: "error", error: result.error };
            }
            return { ...p, status: "done" };
          })
        );

        setUploading(false);
        return { ok: true, failedNames, fileMap };
      } catch {
        setProgress((prev) =>
          prev.map((p) =>
            p.status === "uploading"
              ? { ...p, status: "error", error: "Network error" }
              : p
          )
        );
        setUploading(false);
        return fail;
      }
    },
    [sizeLimitBytes]
  );

  const clearProgress = useCallback(() => {
    setProgress([]);
  }, []);

  return { uploading, progress, upload, clearProgress };
}
