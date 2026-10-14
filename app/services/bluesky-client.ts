import { useEffect, useState } from "react";
import { findFileByNameLocalLoose, readFileBinaryLocal } from "./drive-local";
import { prepareBlueskyImage, BLUESKY_CHANGED_EVENT, type BlueskyAdapter, type BlueskyConnection, type BlueskyPost } from "./bluesky";

/** The channel the authorization popup reports its outcome on (see auth.bluesky.callback). */
const BLUESKY_CALLBACK_CHANNEL = "gemihub-bluesky";

async function call(operation: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/bluesky", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...data }) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "Bluesky request failed");
  return result;
}
function changed() { window.dispatchEvent(new Event(BLUESKY_CHANGED_EVENT)); }

export const webBluesky: BlueskyAdapter = {
  async image(candidates: string[], alt: string) {
    for (const candidate of candidates) {
      const file = await findFileByNameLocalLoose(candidate);
      if (file) return prepareBlueskyImage(await readFileBinaryLocal(file.id), file.mimeType, alt);
    }
    throw new Error(`Cannot find the image in this Workspace: ${candidates[0] ?? alt}`);
  },
  async status() { const response = await fetch("/api/bluesky"); if (!response.ok) throw new Error("Could not check Bluesky connection"); return response.json(); },
  /** Resolves once Bluesky authorization finished; rejects when it failed, timed out or was aborted. */
  async connect(handle: string, signal?: AbortSignal) {
    const popup = window.open("about:blank", "gemihub-bluesky", "popup,width=600,height=760");
    if (!popup) throw new Error("Allow the Bluesky authorization popup");
    const channel = new BroadcastChannel(BLUESKY_CALLBACK_CHANNEL);
    let cleanup = () => {};
    try {
      const result = await call("connect", { handle });
      const url = new URL(result.url); if (url.protocol !== "https:") throw new Error("Invalid authorization URL");
      popup.location.href = url.href;
      // popup.closed is unreliable once the provider isolates its pages, so wait for the callback or a cancel.
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Bluesky authorization timed out")), 10 * 60_000);
        const onAbort = () => reject(new Error("Bluesky authorization was cancelled"));
        channel.onmessage = (event: MessageEvent) => {
          if (event.data?.type !== "gemihub:bluesky-callback") return;
          if (event.data.ok) resolve(); else reject(new Error("Could not connect Bluesky"));
        };
        if (signal?.aborted) onAbort();
        signal?.addEventListener("abort", onAbort);
        cleanup = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
      });
    } catch (error) { popup.close(); throw error; } finally { cleanup(); channel.close(); changed(); }
  },
  async disconnect() { try { await call("disconnect"); } finally { changed(); } },
  async publish(posts: BlueskyPost[], did: string) { return call("publish", { posts, did }); },
};

/** The current connection, refreshed whenever it changes in this tab. */
export function useBlueskyConnection(): BlueskyConnection | null {
  const [connection, setConnection] = useState<BlueskyConnection | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => webBluesky.status()
      .then(value => { if (active) setConnection(value); })
      .catch(() => { if (active) setConnection({ connected: false }); });
    void load();
    window.addEventListener(BLUESKY_CHANGED_EVENT, load);
    return () => { active = false; window.removeEventListener(BLUESKY_CHANGED_EVENT, load); };
  }, []);
  return connection;
}
