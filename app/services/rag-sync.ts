// Shared RAG registration helpers for sync operations (client-side)

import { isRagEligible } from "~/constants/rag";

async function tryRagRegister(
  fileId: string,
  content: string,
  fileName: string
): Promise<{ ok: boolean; skipped?: boolean; ragFileInfo?: { checksum: string; uploadedAt: number; fileId: string | null }; storeName?: string }> {
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "ragRegister", fileId, content, fileName }),
  });
  if (!res.ok) return { ok: false };
  return await res.json();
}

async function saveRagUpdates(
  updates: Array<{ fileName: string; ragFileInfo: { checksum: string; uploadedAt: number; fileId: string | null; status: "registered" | "pending" } }>,
  storeName: string
): Promise<void> {
  await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "ragSave", updates, storeName }),
  });
}

async function tryRagRetryPending(): Promise<void> {
  try {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ragRetryPending" }),
    });
  } catch {
    // best-effort retry
  }
}

/**
 * Register a single newly created/uploaded file for RAG (best-effort, fire-and-forget).
 * Extension eligibility is checked client-side; exclude patterns are checked server-side.
 */
export function ragRegisterNewFile(fileId: string, fileName: string, content?: string): void {
  if (!isRagEligible(fileName)) return;
  ragRegisterInBackground([{ fileId, fileName, content: content ?? "" }]);
}

export function ragRegisterInBackground(
  filesToPush: Array<{ fileId: string; content: string; fileName: string }>
): void {
  (async () => {
    const eligibleFiles = filesToPush.filter((f) => isRagEligible(f.fileName));
    if (eligibleFiles.length === 0) return;

    const pendingUpdates = eligibleFiles.map((f) => ({
      fileName: f.fileName,
      ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null as string | null, status: "pending" as const },
    }));
    await saveRagUpdates(pendingUpdates, "");

    const ragUpdates: Array<{ fileName: string; ragFileInfo: { checksum: string; uploadedAt: number; fileId: string | null; status: "registered" | "pending" } }> = [];
    let ragStoreName = "";
    for (const f of eligibleFiles) {
      try {
        const ragResult = await tryRagRegister(f.fileId, f.content, f.fileName);
        if (!ragResult.ok) {
          ragUpdates.push({ fileName: f.fileName, ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" } });
        } else if (!ragResult.skipped && ragResult.ragFileInfo) {
          ragUpdates.push({ fileName: f.fileName, ragFileInfo: { ...ragResult.ragFileInfo, status: "registered" } });
          if (ragResult.storeName) ragStoreName = ragResult.storeName;
        }
      } catch {
        ragUpdates.push({ fileName: f.fileName, ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" } });
      }
    }
    if (ragUpdates.length > 0) {
      await saveRagUpdates(ragUpdates, ragStoreName);
    }
    await tryRagRetryPending();
  })().catch(() => {});
}
