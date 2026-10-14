import { randomBytes } from "node:crypto";
import type { Route } from "./+types/auth.bluesky.callback";
import { requireAuth } from "~/services/session.server";
import { redirect } from "react-router";
import { blueskyOrigin, blueskyOwner, blueskyClient, blueskyStorage, getBlueskyConnection } from "~/services/bluesky.server";
export async function loader({ request }: Route.LoaderArgs) {
  // Loopback OAuth returns to 127.0.0.1, but the session cookie belongs to the configured host.
  const url = new URL(request.url), origin = blueskyOrigin();
  if (url.origin !== origin && url.hostname === "127.0.0.1") return redirect(`${origin}${url.pathname}${url.search}`);
  const tokens = await requireAuth(request);
  const owner = blueskyOwner(tokens);
  let success = false;
  try {
    await blueskyStorage(owner).lock("account", async () => {
      const client = blueskyClient(owner);
      const previous = await getBlueskyConnection(owner);
      const { session } = await client.callback(new URL(request.url).searchParams);
      // The granted scopes cover posting only (no getProfile), so read the handle from the DID document like the desktop app.
      const identity = await client.identityResolver.resolve(session.did).catch(() => null);
      const handle = identity && identity.handle !== "handle.invalid" ? identity.handle : "";
      await blueskyStorage(owner).set("connection", { did: session.did, handle });
      if (previous && previous.did !== session.did) await client.revoke(previous.did).catch(() => {});
      success = true;
    });
  } catch (error) {
    // Log only the message: never expose provider URLs or callback parameters to the page.
    console.error("[bluesky] callback failed:", error instanceof Error ? error.message : error);
  }
  // Tell the GemiHub tab the outcome, then close; the text stays for when the script cannot run.
  const nonce = randomBytes(16).toString("base64");
  const message = JSON.stringify({ type: "gemihub:bluesky-callback", ok: success });
  // A BroadcastChannel reaches the GemiHub tab even when the provider's pages cut window.opener.
  const script = `try { const channel = new BroadcastChannel("gemihub-bluesky"); channel.postMessage(${message}); channel.close(); window.close(); } catch {}`;
  return new Response(`<!doctype html><html><meta charset="utf-8"><title>GemiHub · Bluesky</title><p>${success ? "Bluesky connected. You can close this window and return to GemiHub." : "Could not connect Bluesky. Close this window and try again from GemiHub."}</p><script nonce="${nonce}">${script}</script></html>`, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'` } });
}
