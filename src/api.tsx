import { tr } from "../shared/i18n";
import { getLocale } from "../shared/i18n";
import { createContext, useContext } from "react";

async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  options?: { signal?: AbortSignal; keepalive?: boolean },
): Promise<T> {
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-Gemihub-Language": getLocale(), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: options?.signal,
    keepalive: options?.keepalive,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || tr("操作できませんでした"));
  return v;
}

export type ApiClient = typeof api;
const ApiContext = createContext<ApiClient>(api);
export const ApiProvider = ApiContext.Provider;
export const useApi = () => useContext(ApiContext);
