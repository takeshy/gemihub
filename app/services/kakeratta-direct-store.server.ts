import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { getFirestore, isFirestoreAvailable } from "./firestore.server";
import type { DirectState, DirectStore } from "./kakeratta-direct";

interface RecordData { payload: string; expiresAt: number; owner: string; lockedUntil: number }
const localLocks = new Map<string, string>();
const registryLocks = new Map<string, Promise<void>>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function encode(state: DirectState): string { return gzipSync(JSON.stringify(state)).toString("base64"); }
function decode(record: RecordData): DirectState { return JSON.parse(gunzipSync(Buffer.from(record.payload, "base64")).toString()); }
const fresh = (id: string): DirectState => ({ id, claimId: randomUUID(), expiresAt: Date.now() + 25 * 60 * 60_000, messages: [], rounds: 0, comments: 0 });

interface ConnectionBinding { fingerprint: string; scope: string }
export function directConnectionFingerprint(rootFolderId: string, url: string, headers: Record<string, string>): string {
  return hash(JSON.stringify([rootFolderId, url, [...new Headers(headers).entries()].sort(([a], [b]) => a.localeCompare(b))]));
}

export async function bindLocalDirectConnection(rootFolderId: string, fingerprint: string, activate = false, directoryRoot = resolve(process.env.KAKERATTA_STATE_DIR || "data/kakeratta-requests")) {
  const file = join(directoryRoot, `${hash(rootFolderId)}.connection.json`);
  const previous = registryLocks.get(file) ?? Promise.resolve();
  let unlock!: () => void;
  const pending = new Promise<void>(resolve => { unlock = resolve; });
  registryLocks.set(file, pending);
  await previous;
  let binding: ConnectionBinding;
  async function read(): Promise<ConnectionBinding | undefined> {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  try {
    await mkdir(directoryRoot, { recursive: true, mode: 0o700 });
    const existing = await read();
    if (existing && existing.fingerprint !== fingerprint && !activate) throw new Error("Connection changed; save the connection settings");
    binding = existing?.fingerprint === fingerprint ? existing : { fingerprint, scope: randomUUID() };
    if (binding !== existing) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(binding), { mode: 0o600 });
      await rename(temporary, file);
    }
  } finally { unlock(); if (registryLocks.get(file) === pending) registryLocks.delete(file); }
  return { scope: binding.scope, async isCurrent() { return (await read())?.scope === binding.scope; } };
}

async function bindDirectConnection(rootFolderId: string, url: string, headers: Record<string, string>, activate = false) {
  const fingerprint = directConnectionFingerprint(rootFolderId, url, headers);
  if (!isFirestoreAvailable()) return bindLocalDirectConnection(rootFolderId, fingerprint, activate);
  const db = getFirestore();
  const ref = db.collection("kakerattaDirectConnections").doc(hash(rootFolderId));
  const binding = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.exists ? snapshot.data() as ConnectionBinding : undefined;
    if (existing && existing.fingerprint !== fingerprint && !activate) throw new Error("Connection changed; save the connection settings");
    const next = existing?.fingerprint === fingerprint ? existing : { fingerprint, scope: randomUUID() };
    if (next !== existing) tx.set(ref, next);
    return next;
  });
  return { scope: binding.scope, async isCurrent() { return (await ref.get()).get("scope") === binding.scope; } };
}

export async function activateDirectConnection(rootFolderId: string, url: string, headers: Record<string, string>): Promise<void> {
  await bindDirectConnection(rootFolderId, url, headers, true);
}

/** Firestore leases coordinate replicas; self-hosted local mode uses one process. */
export async function createDirectStore(rootFolderId: string, url: string, headers: Record<string, string>): Promise<DirectStore> {
  const { scope, isCurrent } = await bindDirectConnection(rootFolderId, url, headers);
  const owner = randomUUID();
  if (isFirestoreAvailable()) {
    const db = getFirestore();
    const collection = db.collection("kakerattaDirectRequests").doc(scope).collection("requests");
    const ref = (id: string) => collection.doc(hash(id));
    return {
      isCurrent,
      async list() {
        const expired = await collection.where("expiresAt", "<=", Date.now()).limit(50).get();
        await Promise.all(expired.docs.map(doc => db.runTransaction(async tx => {
          const current = await tx.get(doc.ref);
          if (current.exists && current.get("expiresAt") <= Date.now() && current.get("lockedUntil") <= Date.now()) tx.delete(doc.ref);
        })));
        const snapshot = await collection.where("expiresAt", ">", Date.now()).get();
        return snapshot.docs.map(doc => decode(doc.data() as RecordData));
      },
      async acquire(id) {
        return db.runTransaction(async tx => {
          const doc = ref(id);
          const snapshot = await tx.get(doc);
          const record = snapshot.exists ? snapshot.data() as RecordData : undefined;
          if (record && record.lockedUntil > Date.now()) return null;
          const state = record && record.expiresAt > Date.now() ? decode(record) : fresh(id);
          tx.set(doc, { payload: encode(state), expiresAt: state.expiresAt, owner, lockedUntil: Date.now() + 10 * 60_000 });
          return state;
        });
      },
      async save(state) {
        await db.runTransaction(async tx => {
          const doc = ref(state.id);
          const snapshot = await tx.get(doc);
          if (snapshot.get("owner") !== owner || snapshot.get("lockedUntil") <= Date.now()) throw new Error("Direct request lease lost");
          tx.update(doc, { payload: encode(state), expiresAt: state.expiresAt });
        });
      },
      async finish(id) {
        await db.runTransaction(async tx => {
          const doc = ref(id);
          const snapshot = await tx.get(doc);
          if (snapshot.get("owner") === owner) tx.delete(doc);
        });
      },
      async release(id) {
        await db.runTransaction(async tx => {
          const doc = ref(id);
          const snapshot = await tx.get(doc);
          if (snapshot.get("owner") === owner) tx.update(doc, { lockedUntil: 0 });
        });
      },
    };
  }
  return { ...createLocalDirectStore(scope), isCurrent };
}

export function createLocalDirectStore(scope: string, directoryRoot = resolve(process.env.KAKERATTA_STATE_DIR || "data/kakeratta-requests")): DirectStore {
  const owner = randomUUID();
  const directory = join(directoryRoot, scope);
  const path = (id: string) => join(directory, `${hash(id)}.json`);
  async function load(file: string): Promise<RecordData | undefined> {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async function persist(state: DirectState) {
    const file = path(state.id);
    if (localLocks.get(file) !== owner) throw new Error("Direct request lease lost");
    const temporary = `${file}.${owner}.tmp`;
    await writeFile(temporary, JSON.stringify({ payload: encode(state), expiresAt: state.expiresAt, owner, lockedUntil: 0 }), { mode: 0o600 });
    await rename(temporary, file);
  }
  return {
    async list() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const states: DirectState[] = [];
      for (const name of await readdir(directory)) {
        if (!name.endsWith(".json")) continue;
        const record = await load(join(directory, name));
        if (record && record.expiresAt > Date.now()) states.push(decode(record));
        else if (record && !localLocks.has(join(directory, name))) await unlink(join(directory, name)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
      return states;
    },
    async acquire(id) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path(id);
      if (localLocks.has(file)) return null;
      localLocks.set(file, owner);
      try {
        const record = await load(file);
        const state = record && record.expiresAt > Date.now() ? decode(record) : fresh(id);
        await persist(state);
        return state;
      } catch (error) { localLocks.delete(file); throw error; }
    },
    save: persist,
    async finish(id) {
      if (localLocks.get(path(id)) !== owner) throw new Error("Direct request lease lost");
      await unlink(path(id)).catch(error => { if (error.code !== "ENOENT") throw error; });
    },
    async release(id) { if (localLocks.get(path(id)) === owner) localLocks.delete(path(id)); },
  };
}
