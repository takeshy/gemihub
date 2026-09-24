/** Fetch Drive content in the browser so file bytes bypass the app server. */
export async function fetchDriveFileDirect(fileId: string, signal?: AbortSignal): Promise<Response> {
  const tokenResponse = await fetch("/api/google/picker", { cache: "no-store", signal });
  if (!tokenResponse.ok) throw new Error(`Could not authorize download (${tokenResponse.status})`);
  const { accessToken } = await tokenResponse.json() as { accessToken?: string };
  if (!accessToken) throw new Error("Drive access token is unavailable");

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  if (!response.ok) throw new Error(`Drive download failed (${response.status})`);
  return response;
}

type SaveFilePicker = (options: { suggestedName: string }) => Promise<{
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}>;

/** Save directly from Drive; stream to disk where the browser supports it. */
export async function downloadDriveFileDirect(fileId: string, fileName: string): Promise<void> {
  const browserWindow = window as Window & { showSaveFilePicker?: SaveFilePicker };
  // The picker needs the original click's user activation, before any awaits.
  const handle = browserWindow.showSaveFilePicker
    ? await browserWindow.showSaveFilePicker({ suggestedName: fileName })
    : null;
  const response = await fetchDriveFileDirect(fileId);

  if (handle && response.body) {
    const writable = await handle.createWritable();
    await response.body.pipeTo(writable);
    return;
  }

  // Browsers without the File System Access API still download from Drive,
  // but must keep the Blob in browser memory until the save begins.
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
