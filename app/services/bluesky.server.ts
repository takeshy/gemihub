import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { NodeOAuthClient, type NodeSavedState, type NodeSavedSession } from "@atproto/oauth-client-node";
import { Agent } from "@atproto/api";
import { getFirestore, isFirestoreAvailable } from "./firestore.server";
import type { BlueskyPost } from "./bluesky";

export function blueskyOwner(tokens: { email?: string; rootFolderId: string; currentOrgId?: string; currentProjectId?: string }) {
  if (!tokens.email && !tokens.rootFolderId) throw new Error("Sign in before connecting Bluesky");
  return JSON.stringify([tokens.email?.toLowerCase() || "", tokens.rootFolderId, tokens.currentOrgId || "", tokens.currentProjectId || ""]);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const scope = "atproto repo:app.bsky.feed.post?action=create blob:image/*";
const locks = new Set<string>();
function encryptionKey() {
  const secret = process.env.BLUESKY_STORAGE_SECRET || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("Bluesky storage is not configured");
  return createHash("sha256").update(`bluesky:${secret || "local-dev-bluesky"}`).digest();
}
function encrypt(value: unknown) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64"); }
function decrypt<T>(value: string): T { const data = Buffer.from(value, "base64"); const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString()); }
interface Stored { payload: string; expiresAt: number }
let firestoreUsable: Promise<boolean> | null = null;
/** Firestore when it works; off Cloud Run, credentials without access (e.g. a developer's ADC) fall back to local files. */
function firestoreEnabled() {
  if (!isFirestoreAvailable()) return Promise.resolve(false);
  if (process.env.K_SERVICE) return Promise.resolve(true);
  firestoreUsable ??= getFirestore().collection("blueskyConnections").limit(1).get().then(() => true, (error: { code?: number }) => {
    if (error.code !== 7 && error.code !== 16) { firestoreUsable = null; throw error; }
    console.warn("[bluesky] Firestore is not accessible; storing connections under BLUESKY_STATE_DIR");
    return false;
  });
  return firestoreUsable;
}
export function blueskyOrigin() {
  const configured = process.env.BLUESKY_PUBLIC_URL || process.env.GOOGLE_REDIRECT_URI;
  if (!configured) throw new Error("Set BLUESKY_PUBLIC_URL to the public GemiHub origin");
  const url = new URL(configured);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))) throw new Error("Bluesky requires a public HTTPS origin");
  return url.origin;
}
const isLoopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1";
/** Loopback clients must redirect to 127.0.0.1 (not localhost), like the desktop app. */
export function blueskyCallbackUrl() {
  const url = new URL("/auth/bluesky/callback", blueskyOrigin());
  if (url.protocol === "http:") url.hostname = "127.0.0.1";
  return url.toString();
}
export function blueskyMetadata() {
  const origin = blueskyOrigin();
  const callback = blueskyCallbackUrl();
  return {
    client_id: origin.startsWith("http:") ? `http://localhost?${new URLSearchParams({ redirect_uri: callback, scope })}` : `${origin}/api/bluesky/client-metadata.json`,
    client_name: "GemiHub", client_uri: origin, redirect_uris: [callback] as [string],
    grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
    response_types: ["code"] as ["code"], application_type: "web" as const,
    token_endpoint_auth_method: "none" as const, dpop_bound_access_tokens: true, scope,
  };
}
export function blueskyStorage(owner: string) {
  const account = hash(owner);
  const directory = resolve(process.env.BLUESKY_STATE_DIR || "data/bluesky", account);
  const ref = (key: string) => getFirestore().collection("blueskyConnections").doc(account).collection("values").doc(hash(key));
  const file = (key: string) => join(directory, `${hash(key)}.json`);
  return {
    async get<T>(key: string): Promise<T | undefined> {
      let stored: Stored | undefined;
      if (await firestoreEnabled()) { const snapshot = await ref(key).get(); stored = snapshot.exists ? snapshot.data() as Stored : undefined; }
      else { try { stored = JSON.parse(await readFile(file(key), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
      if (!stored || (stored.expiresAt && stored.expiresAt <= Date.now())) return undefined;
      return decrypt<T>(stored.payload);
    },
    async set(key: string, value: unknown, expiresAt = 0) {
      const record = { payload: encrypt(value), expiresAt };
      if (await firestoreEnabled()) await ref(key).set(record);
      else { await mkdir(directory, { recursive: true, mode: 0o700 }); const target = file(key), temp = `${target}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(record), { mode: 0o600 }); await rename(temp, target); }
    },
    async del(key: string) { if (await firestoreEnabled()) await ref(key).delete(); else await unlink(file(key)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
    async lock<T>(key: string, work: () => T | PromiseLike<T>): Promise<T> {
      const id = `${account}:${key}`, owner = randomUUID();
      if (locks.has(id)) throw new Error("A Bluesky operation is already running");
      locks.add(id);
      let lease: ReturnType<typeof ref> | undefined;
      try {
        lease = await firestoreEnabled() ? ref(`lock:${key}`) : undefined;
        const acquired = lease;
        if (acquired) await getFirestore().runTransaction(async tx => { const snapshot = await tx.get(acquired); if (snapshot.exists && snapshot.get("until") > Date.now()) throw new Error("A Bluesky operation is already running"); tx.set(acquired, { owner, until: Date.now() + 300_000 }); });
        return await work();
      } finally {
        locks.delete(id);
        const held = lease;
        if (held) await getFirestore().runTransaction(async tx => { const snapshot = await tx.get(held); if (snapshot.get("owner") === owner) tx.delete(held); });
      }
    },
  };
}
export function blueskyClient(owner: string) {
  const store = blueskyStorage(owner);
  return new NodeOAuthClient({
    clientMetadata: blueskyMetadata(),
    stateStore: { get: key => store.get<NodeSavedState>(`state:${key}`), set: (key, value) => store.set(`state:${key}`, value, Date.now() + 600_000), del: key => store.del(`state:${key}`) },
    sessionStore: { get: key => store.get<NodeSavedSession>(`session:${key}`), set: (key, value) => store.set(`session:${key}`, value), del: key => store.del(`session:${key}`) },
    requestLock: (key, work) => store.lock(`oauth:${key}`, work),
  });
}
export interface BlueskyBinding { did: string; handle: string }
export async function getBlueskyConnection(owner: string) { return await blueskyStorage(owner).get<BlueskyBinding>("connection"); }
export async function disconnectBluesky(owner: string) {
  const store = blueskyStorage(owner);
  await store.lock("account", async () => { const connection = await getBlueskyConnection(owner); if (connection) await blueskyClient(owner).revoke(connection.did); await store.del("connection"); });
}

export function validateBlueskyPosts(value: unknown): asserts value is BlueskyPost[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Invalid publication selection");
  const seen = new Set<string>(); const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const post of value) {
    if (!post || typeof post.id !== "string" || !post.id || post.id.length > 4096 || seen.has(post.id) || typeof post.text !== "string" || (!post.text.trim() && !post.images?.length) || Buffer.byteLength(post.text) > 3000 || [...segmenter.segment(post.text)].length > 300 || typeof post.createdAt !== "string" || !Number.isFinite(Date.parse(post.createdAt)) || typeof post.parent !== "string" || (post.parent && !seen.has(post.parent))) throw new Error("Invalid Bluesky post");
    if (post.images !== undefined) {
      if (!Array.isArray(post.images) || post.images.length > 4) throw new Error("Invalid Bluesky images");
      for (const image of post.images) { if (!image || typeof image.data !== "string" || image.data.length > 1_333_336 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || typeof image.alt !== "string" || image.alt.length > 2000 || !["image/jpeg", "image/png", "image/webp"].includes(image.mime)) throw new Error("Invalid Bluesky image"); const data = Buffer.from(image.data, "base64"); if (!data.length || data.length > 1_000_000) throw new Error("Invalid Bluesky image size"); }
    }
    seen.add(post.id);
  }
}
export async function publishBluesky(owner: string, posts: BlueskyPost[], did: string) {
  validateBlueskyPosts(posts);
  return blueskyStorage(owner).lock("account", async () => {
    const connection = await getBlueskyConnection(owner);
    if (!connection || connection.did !== did) throw new Error("Bluesky account changed. Reopen the preview");
    const session = await blueskyClient(owner).restore(did);
    const agent = new Agent(session);
    return publishBlueskyRecords(agent, did, posts);
  });
}
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
/**
 * Deterministic record keys let a retry find a post whose response was lost.
 * app.bsky.feed.post requires TID keys, so the key is a valid TID: the post's
 * time in microseconds, with the sub-millisecond part and clock id from a hash
 * (same derivation as GemiHub Desktop).
 */
export function blueskyRecordKey(did: string, post: BlueskyPost): string {
  const sum = createHash("sha256").update(JSON.stringify([did, post.id, post.text, post.createdAt, post.parent, post.images ?? null])).digest();
  const millis = Date.parse(post.createdAt);
  const micros = BigInt(Number.isFinite(millis) ? millis : 0) * 1000n + BigInt(sum.readUInt32BE(0) % 1000);
  let tid = (micros << 10n) | BigInt(sum.readUInt16BE(4) & 0x3ff);
  let key = "";
  for (let index = 0; index < 13; index++) { key = TID_ALPHABET[Number(tid & 31n)] + key; tid >>= 5n; }
  return key;
}
export async function publishBlueskyRecords(agent: Agent, did: string, posts: BlueskyPost[]) {
  validateBlueskyPosts(posts);
  const refs = new Map<string, { uri: string; cid: string }>();
  const roots = new Map<string, { uri: string; cid: string }>();
  const urls: string[] = [];
  for (const post of posts) {
    const rkey = blueskyRecordKey(did, post);
    const facets = blueskyLinkFacets(post.text);
    const record: Record<string, unknown> = { ...(facets.length ? { facets } : {}), $type: "app.bsky.feed.post", text: post.text, createdAt: post.createdAt,
      ...(post.parent ? { reply: { root: roots.get(post.parent)!, parent: refs.get(post.parent)! } } : {}),
    };
    let result: { uri: string; cid: string };
    try {
      const existing = await agent.com.atproto.repo.getRecord({ repo: did, collection: "app.bsky.feed.post", rkey });
      // Compare the fields we submitted; additional PDS metadata is harmless.
      const value = existing.data.value as typeof record;
      if (value.text !== record.text || JSON.stringify(value.reply) !== JSON.stringify(record.reply) || JSON.stringify(value.facets) !== JSON.stringify(record.facets)) throw new Error("Existing Bluesky post differs from the preview");
      if (!existing.data.cid) throw new Error("Invalid Bluesky record");
      result = { uri: existing.data.uri, cid: existing.data.cid };
    } catch (error) {
      if ((error as { error?: string }).error !== "RecordNotFound") throw error;
      if (post.images?.length) {
        const images = [];
        for (const image of post.images) {
          const uploaded = await agent.uploadBlob(Buffer.from(image.data, "base64"), { encoding: image.mime });
          images.push({ alt: image.alt, image: uploaded.data.blob });
        }
        record.embed = { $type: "app.bsky.embed.images", images };
      }
      record.createdAt = new Date().toISOString();
      const created = await agent.com.atproto.repo.createRecord({ repo: did, collection: "app.bsky.feed.post", rkey, record });
      result = { uri: created.data.uri, cid: created.data.cid };
    }
    refs.set(post.id, result); roots.set(post.id, post.parent ? roots.get(post.parent)! : result);
    urls.push(`https://bsky.app/profile/${did}/post/${rkey}`);
  }
  return { urls };
}

export function blueskyLinkFacets(text: string) {
  const facets = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gu)) {
    const uri = match[0].replace(/[.,!?;:、。！？\]}]+$/u, "");
    try { if (!new URL(uri).hostname) continue; } catch { continue; }
    const start = Buffer.byteLength(text.slice(0, match.index));
    facets.push({ index: { byteStart: start, byteEnd: start + Buffer.byteLength(uri) }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  return facets;
}
