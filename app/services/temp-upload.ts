import type { TranslationStrings } from "~/i18n/translations";

/**
 * Perform a temp upload with an optional edit URL.
 *
 * `confirm` is a function that returns a Promise resolving to true (issue URL)
 * or false (no URL). Callers provide their own UI (e.g. portal dialog).
 * `onStart` is called after the user confirms, right before the upload begins.
 *
 * Returns a feedback message string on success, or throws on failure.
 */
export async function performTempUpload(opts: {
  fileName: string;
  fileId: string;
  content: string;
  t: (key: keyof TranslationStrings) => string;
  confirm: () => Promise<boolean>;
  onStart?: () => void;
}): Promise<string> {
  const { fileName, fileId, content, t } = opts;
  const wantUrl = await opts.confirm();
  opts.onStart?.();

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
