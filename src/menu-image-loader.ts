import type { ApiClient } from "./api";
import type { MenuImageData } from "../server/menu-image-domain";

// Share only pending requests within one API context. Every later mount revalidates access.
const pending = new WeakMap<ApiClient, Map<string, Promise<MenuImageData>>>();
export function loadMenuImage(api: ApiClient, path: string): Promise<MenuImageData> {
  let requests = pending.get(api);
  if (!requests) { requests = new Map(); pending.set(api, requests); }
  const existing = requests.get(path);
  if (existing) return existing;
  const request = Promise.resolve().then(() => api<MenuImageData>(path)).finally(() => requests!.delete(path));
  requests.set(path, request);
  return request;
}
