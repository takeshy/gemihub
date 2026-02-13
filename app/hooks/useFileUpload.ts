import { useState, useCallback } from "react";
import { ragRegisterNewFile } from "~/services/rag-sync";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
  /** Map from original file name to uploaded Drive file metadata */
  fileMap: Map<string, UploadedFile>;
}

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);

  const upload = useCallback(
    async (files: File[], folderId: string, namePrefix?: string, replaceMap?: Record<string, string>): Promise<UploadReturn> => {
      const fail: UploadReturn = { ok: false, failedNames: new Set(), fileMap: new Map() };
      if (files.length === 0) return fail;

      setUploading(true);

      // Initialize progress with client-side size checks
      const initial: UploadProgress[] = files.map((f) => {
        if (f.size > MAX_FILE_SIZE) {
          return {
            name: f.name,
            status: "error" as const,
            error: `Too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`,
          };
        }
        return { name: f.name, status: "uploading" as const };
      });
      setProgress(initial);

      const validFiles = files.filter((f) => f.size <= MAX_FILE_SIZE);
      if (validFiles.length === 0) {
        setUploading(false);
        return fail;
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
    []
  );

  const clearProgress = useCallback(() => {
    setProgress([]);
  }, []);

  return { uploading, progress, upload, clearProgress };
}
