import { getLocale } from "../shared/i18n";
import { createContext, useContext } from "react";
import { readApiResponse } from "./api-response";

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
  return readApiResponse<T>(r);
}

export type ApiClient = typeof api;
const ApiContext = createContext<ApiClient>(api);
export const ApiProvider = ApiContext.Provider;
export const useApi = () => useContext(ApiContext);
