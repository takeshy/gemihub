import type { TranslationStrings } from "~/i18n/translations";

/**
 * Perform a temp upload with an optional edit URL.
 *
 * Shows a confirm dialog asking whether to generate an edit URL.
 * - Yes → calls `generateEditUrl` action (save + URL generation + clipboard copy)
 * - No  → calls `save` action (save only)
 *
 * Returns a feedback message string on success, or throws on failure.
 */
export async function performTempUpload(opts: {
  fileName: string;
  fileId: string;
  content: string;
  t: (key: keyof TranslationStrings) => string;
}): Promise<string> {
  const { fileName, fileId, content, t } = opts;
  const wantUrl = confirm(t("contextMenu.tempEditUrlConfirm"));

  if (wantUrl) {
    const res = await fetch("/api/drive/temp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generateEditUrl", fileName, fileId, content }),
    });
    if (!res.ok) throw new Error("Temp upload failed");
    const { token } = await res.json();
    const editUrl = `${window.location.origin}/api/temp-edit/${token}/${encodeURIComponent(fileName)}`;
    try { await navigator.clipboard.writeText(editUrl); } catch { /* clipboard unavailable */ }
    return t("contextMenu.tempUrlCopied");
  } else {
    const res = await fetch("/api/drive/temp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", fileName, fileId, content }),
    });
    if (!res.ok) throw new Error("Temp upload failed");
    return t("contextMenu.tempUploaded");
  }
}
