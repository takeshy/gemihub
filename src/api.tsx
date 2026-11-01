import { tr } from "../shared/i18n";
import { getLocale } from "../shared/i18n";
import { createContext, useContext } from "react";

async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-Omaiweb-Language": getLocale(), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || tr("操作できませんでした"));
  return v;
}

export type ApiClient = typeof api;
const ApiContext = createContext<ApiClient>(api);
export const ApiProvider = ApiContext.Provider;
export const useApi = () => useContext(ApiContext);
