import { tr } from "../shared/i18n.ts";

// Detection only: GemiHub never copies, deletes or rewrites the old note files.
export async function hasLegacyNotes(accessToken: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!accessToken) throw new Error(tr("旧ノートの確認に必要なGoogle認証がありません。もう一度ログインしてください。"));
  const headers = { Authorization: `Bearer ${accessToken}` };
  let pageToken = "";
  do {
    const query = new URLSearchParams({ q: "name = 'settings.json' and trashed = false", pageSize: "100",
      fields: "nextPageToken,files(id,size,mimeType)", ...(pageToken ? { pageToken } : {}) });
    const listing = await fetcher(`https://www.googleapis.com/drive/v3/files?${query}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!listing.ok) throw new Error(tr("旧ノートの設定を確認できませんでした。Google Driveの利用を許可して、もう一度ログインしてください。"));
    const data = await listing.json() as { nextPageToken?: string; files?: { id: string; size?: string; mimeType?: string }[] };
    for (const file of data.files || []) {
      if (file.mimeType?.startsWith("application/vnd.google-apps.")) continue;
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(tr("旧ノートの設定を確認できませんでした。Google Driveの利用を許可して、もう一度ログインしてください。"));
      const reader = response.body?.getReader();
      if (!reader) continue;
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > 2 * 1024 * 1024) throw new Error(tr("旧ノートの設定ファイルが大きすぎるため確認できませんでした。"));
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { continue; }
      if (isLegacyNotesSettings(value)) return true;
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return false;
}

export function isLegacyNotesSettings(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  const encryption = settings.encryption;
  return (settings.apiPlan === "free" || settings.apiPlan === "paid") && Array.isArray(settings.mcpServers)
    && !!encryption && typeof encryption === "object"
    && ["publicKey", "encryptedPrivateKey", "salt"].every(key => typeof (encryption as Record<string, unknown>)[key] === "string");
}
